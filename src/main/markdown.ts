import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BrowserWindow } from 'electron'
import type {
  Block,
  BlockProps,
  BlockType,
  DatabaseView,
  Mark,
  PropertySchema,
  PropertyValue,
  RichText
} from '../shared/types'
import { sourceIdOf } from '../shared/linked'
import { plainText } from '../shared/richtext'
import type { Repository, TreeInput } from './db/repository'
import { readFileCapped } from './fsutil'
// The chart engine is the renderer's own (pure, no DOM): an exported chart shows the numbers that are on screen.
import { buildChartData, chartCaption, chartTable } from '../renderer/src/database/logic/chart'
import { CHART_KIND_LABELS, chartConfigOf } from '../renderer/src/database/logic/chartConfig'
import { normalizeDatabase, sanitizeViews } from '../renderer/src/database/logic/normalize'
import { queryRows } from '../renderer/src/database/logic/query'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const TOO_LARGE = `The file is too large to import (max ${MAX_IMPORT_BYTES / 1024 / 1024} MB)`
/** A document that parses into more blocks than this is refused rather than half-imported. */
export const MAX_IMPORT_BLOCKS = 200_000
const MAX_TITLE_CHARS = 2000
/** List items nested deeper than this become siblings of the deepest allowed level. */
const MAX_NESTING = 32
/**
 * Characters the inline parser may spend on delimiters that turn out to have
 * no closing partner. Each such miss scans the rest of its paragraph, which is
 * quadratic on input built for it ("*a *a *a …"); once the budget is spent the
 * remaining text is imported literally instead of freezing the main process.
 */
const INLINE_SCAN_BUDGET = 50_000_000
/** Link targets an imported document may carry; anything else is kept as plain text. */
const LINK_RE = /^(https?:\/\/|mailto:|sel:\/\/)/i
const LIST_TYPES = new Set<BlockType>(['bulleted_list', 'numbered_list', 'to_do', 'toggle'])
const INDENT = '    '

// =================================================================== export

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>~])/g, '\\$1')
}

function wrap(text: string, open: string, close = open): string {
  // Emphasis markers must hug the text, so whitespace is moved outside them.
  const core = text.trim()
  if (!core) return text
  const start = text.length - text.trimStart().length
  return `${text.slice(0, start)}${open}${core}${close}${text.slice(start + core.length)}`
}

export function inlineToMarkdown(rt: RichText | undefined): string {
  if (!Array.isArray(rt)) return ''
  let out = ''
  for (const span of rt) {
    if (!Array.isArray(span) || typeof span[0] !== 'string' || !span[0]) continue
    const marks: Mark[] = Array.isArray(span[1]) ? span[1] : []
    const has = (k: string): boolean => marks.some((m) => m[0] === k)
    let text: string
    if (has('c')) {
      const longest = Math.max(0, ...(span[0].match(/`+/g) ?? []).map((r) => r.length))
      const fence = '`'.repeat(longest + 1)
      const pad = longest > 0 ? ' ' : ''
      text = `${fence}${pad}${span[0].replace(/\n/g, ' ')}${pad}${fence}`
    } else {
      text = escapeText(span[0])
    }
    if (has('b')) text = wrap(text, '**')
    if (has('i')) text = wrap(text, '*')
    if (has('s')) text = wrap(text, '~~')
    if (has('u')) text = wrap(text, '<u>', '</u>')
    const link = marks.find((m) => m[0] === 'a')
    if (link && typeof link[1] === 'string') text = `[${text}](${link[1].replace(/[()\s]/g, encodeURIComponent)})`
    out += text
  }
  return out
}

/** Keeps a paragraph from being read as a heading/list/quote when re-parsed. */
function guardLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6}\s|[-+]\s)/, (_, ws: string, tok: string) => `${ws}\\${tok}`)
    .replace(/^(\s*\d+)([.)]\s)/, (_, num: string, tok: string) => `${num}\\${tok}`)
}

function textLines(rt: RichText | undefined, guard = true): string[] {
  const lines = inlineToMarkdown(rt).split('\n')
  return lines.map((l, i) => (guard ? guardLineStart(l) : l) + (i < lines.length - 1 ? '  ' : ''))
}

function cellText(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function formatValue(schema: PropertySchema, row: Block): string {
  if (schema.type === 'title') return inlineToMarkdown(row.props.title)
  if (schema.type === 'created_time') return new Date(row.createdAt).toISOString()
  if (schema.type === 'last_edited_time') return new Date(row.updatedAt).toISOString()
  const value: PropertyValue | undefined = row.props.values?.[schema.id]
  if (value === undefined || value === null) return ''
  const optionName = (id: unknown): string => schema.options?.find((o) => o.id === id)?.name ?? ''
  switch (schema.type) {
    case 'checkbox':
      return value === true ? '☑' : '☐'
    case 'select':
      return escapeText(optionName(value))
    case 'multi_select':
      return Array.isArray(value) ? value.map(optionName).filter(Boolean).map(escapeText).join(', ') : ''
    case 'date':
      if (typeof value === 'object' && !Array.isArray(value)) return value.end ? `${value.start} → ${value.end}` : value.start
      return ''
    case 'url':
      return typeof value === 'string' ? value : ''
    default:
      return typeof value === 'string' || typeof value === 'number' ? escapeText(String(value)) : ''
  }
}

/**
 * The database whose schema and rows `db` shows: itself, or its source when it is a
 * linked view. Null when that source is gone, in the trash or not a database.
 */
function sourceOf(repo: Repository, db: Block): Block | null {
  const sourceId = sourceIdOf(db)
  if (sourceId === null) return db
  const source = repo.get(sourceId)
  return source && source.type === 'database' && source.trashedAt === null && sourceIdOf(source) === null ? source : null
}

/**
 * A chart view as the table of numbers it draws, under a caption that says what they are.
 * The view's filters apply, exactly as on screen; the rows themselves are not listed.
 */
function chartToMarkdown(repo: Repository, db: Block, source: Block, title: string): string[] {
  const schema = normalizeDatabase(source).schema
  const view = sanitizeViews(db.props.views ?? [], schema)[0]
  const rows = queryRows(
    repo.children(source.id).filter((row) => row.type === 'page' && row.trashedAt === null),
    schema,
    view
  )
  const data = buildChartData(rows, schema, chartConfigOf(view, schema))
  const table = chartTable(data)
  const cell = (text: string): string => cellText(escapeText(text))
  const lines: string[] = []
  if (title) lines.push(`**${title}**`, '')
  const name = escapeText(view?.name ?? '')
  lines.push(`*${name ? `${name} – ` : ''}${CHART_KIND_LABELS[data.kind]} chart: ${escapeText(chartCaption(data))}*`, '')
  lines.push(`| ${table.header.map(cell).join(' | ')} |`)
  lines.push(`| ${table.header.map((_, index) => (index === 0 ? '---' : '---:')).join(' | ')} |`)
  for (const row of table.rows) lines.push(`| ${row.map(cell).join(' | ')} |`)
  return lines
}

/**
 * A database as a table. A linked view exports its source's rows with the columns
 * of its own first view, under its own title when it has one.
 */
function databaseToMarkdown(repo: Repository, db: Block, withTitle = true): string[] {
  const source = sourceOf(repo, db)
  const ownTitle = inlineToMarkdown(db.props.title)
  if (!source) return withTitle && ownTitle ? [`**${ownTitle}**`] : []
  const schema = source.props.schema ?? {}
  const view = db.props.views?.[0]
  if (view?.type === 'chart') return chartToMarkdown(repo, db, source, withTitle ? ownTitle || inlineToMarkdown(source.props.title) : '')
  let columns = (view?.visibleProperties ?? Object.keys(schema)).filter((id) => schema[id])
  if (!columns.length) columns = Object.keys(schema)
  const titleId = Object.keys(schema).find((id) => schema[id].type === 'title')
  if (titleId && !columns.includes(titleId)) columns.unshift(titleId)
  const lines: string[] = []
  const title = withTitle ? ownTitle || inlineToMarkdown(source.props.title) : ''
  if (title) lines.push(`**${title}**`, '')
  if (!columns.length) return lines.length ? lines.slice(0, 1) : []
  lines.push(`| ${columns.map((id) => cellText(escapeText(schema[id].name))).join(' | ')} |`)
  lines.push(`| ${columns.map(() => '---').join(' | ')} |`)
  for (const row of repo.children(source.id)) {
    if (row.trashedAt !== null) continue
    lines.push(`| ${columns.map((id) => cellText(formatValue(schema[id], row))).join(' | ')} |`)
  }
  return lines
}

function blocksToLines(repo: Repository, blocks: Block[], depth: number): string[] {
  const lines: string[] = []
  let prevList = false
  let number = 0
  for (const b of blocks) {
    if (b.trashedAt !== null) continue
    number = b.type === 'numbered_list' ? number + 1 : 0
    const chunk = blockToLines(repo, b, number, depth)
    if (!chunk.length) continue
    const isList = LIST_TYPES.has(b.type)
    if (lines.length && !(isList && prevList)) lines.push('')
    lines.push(...chunk)
    prevList = isList
  }
  return lines
}

function blockToLines(repo: Repository, b: Block, number: number, depth: number): string[] {
  // Guard against pathological nesting (and corrupt cyclic content).
  const kids = (): string[] =>
    depth < 64 && b.content.length ? blocksToLines(repo, repo.children(b.id), depth + 1) : []
  const below = (lines: string[]): string[] => {
    const k = kids()
    return k.length ? [...lines, '', ...k] : lines
  }
  const p = b.props
  switch (b.type) {
    case 'text':
      return below(textLines(p.title))
    case 'heading_1':
    case 'heading_2':
    case 'heading_3': {
      const level = Number(b.type.slice(-1))
      return below([`${'#'.repeat(level)} ${inlineToMarkdown(p.title).replace(/\n/g, ' ')}`])
    }
    case 'bulleted_list':
    case 'numbered_list':
    case 'to_do':
    case 'toggle': {
      const marker =
        b.type === 'numbered_list' ? `${number}. ` : b.type === 'to_do' ? `- [${p.checked ? 'x' : ' '}] ` : '- '
      const text = textLines(p.title, false)
      const out = text.map((l, i) => (i === 0 ? marker + l : INDENT + l))
      for (const l of kids()) out.push(l ? INDENT + l : '')
      return out
    }
    case 'quote':
    case 'callout': {
      const text = textLines(p.title)
      if (b.type === 'callout' && p.icon) text[0] = `${p.icon} ${text[0]}`
      return below(text).map((l) => (l ? `> ${l}` : '>'))
    }
    case 'code': {
      const code = plainText(p.title)
      const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((r) => r.length))
      const fence = '`'.repeat(longest + 1)
      return [`${fence}${(p.language ?? '').replace(/[^\w+#.-]/g, '')}`, ...code.split('\n'), fence]
    }
    case 'divider':
      return ['---']
    case 'image': {
      if (!p.url) return []
      const alt = plainText(p.caption).replace(/[[\]\n]/g, ' ')
      return [`![${alt}](${p.url.replace(/[()\s]/g, encodeURIComponent)})`]
    }
    case 'bookmark': {
      if (!p.url) return []
      const label = inlineToMarkdown(p.caption?.length ? p.caption : p.title) || escapeText(p.url)
      return [`[${label}](${p.url.replace(/[()\s]/g, encodeURIComponent)})`]
    }
    case 'page': {
      const title = inlineToMarkdown(p.title) || 'Untitled'
      return [`[${title}](sel://page/${b.id})`]
    }
    case 'database':
      return databaseToMarkdown(repo, b)
    default:
      return []
  }
}

/** Serializes a page (or database) and its content to Markdown. */
export function pageToMarkdown(repo: Repository, id: string): { title: string; markdown: string } {
  const page = repo.get(id)
  if (!page) throw new Error(`Block not found: ${id}`)
  // A linked view without a title of its own goes by its source's.
  const named = page.props.title?.length ? page : ((page.type === 'database' && sourceOf(repo, page)) || page)
  const title = plainText(named.props.title).trim() || 'Untitled'
  const lines = [`# ${inlineToMarkdown(named.props.title).replace(/\n/g, ' ') || 'Untitled'}`]
  const body = page.type === 'database' ? databaseToMarkdown(repo, page, false) : blocksToLines(repo, repo.children(id), 0)
  if (body.length) lines.push('', ...body)
  return { title, markdown: lines.join('\n') + '\n' }
}

/** Serializes some blocks (each with its content) to Markdown, in the order given: what the AI actions read of a selection. */
export function blocksToMarkdown(repo: Repository, blocks: Block[]): string {
  return blocksToLines(repo, blocks, 0).join('\n')
}

// =================================================================== import

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

function pushSpan(out: RichText, text: string, marks: Mark[]): void {
  if (!text) return
  const last = out[out.length - 1]
  if (last && sameMarks(last[1], marks)) {
    last[0] += text
    return
  }
  out.push(marks.length ? [text, marks.map((m) => [...m] as Mark)] : [text])
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c)

/** Index of the closing `delim` after `from`, honouring backslash escapes; -1 if none. */
function findClose(src: string, delim: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') {
      j++
      continue
    }
    if (!src.startsWith(delim, j)) continue
    if (/\s/.test(src[j - 1] ?? ' ')) continue
    if (delim.length === 1) {
      // A lone marker, not one half of `**` / `__`.
      if (src[j + 1] === delim || src[j - 1] === delim) {
        while (src[j + 1] === delim) j++
        continue
      }
      if (delim === '_' && isWordChar(src[j + 1])) continue
    }
    return j
  }
  return -1
}

let scanBudget = INLINE_SCAN_BUDGET

function parseInto(src: string, marks: Mark[], out: RichText, depth: number): void {
  let buf = ''
  /** Charges a delimiter that found no partner; see INLINE_SCAN_BUDGET. */
  const miss = (from: number): void => {
    scanBudget -= src.length - from
  }
  const flush = (): void => {
    pushSpan(out, buf, marks)
    buf = ''
  }
  const withMark = (m: Mark): Mark[] => (marks.some((x) => x[0] === m[0]) ? marks : [...marks, m])
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length && /[!-/:-@[-`{-~]/.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (depth < 12 && scanBudget > 0) {
      if (ch === '`') {
        const run = /^`+/.exec(src.slice(i))![0]
        let end = src.indexOf(run, i + run.length)
        // The closing run must be exactly as long as the opening one.
        while (end >= 0 && src[end + run.length] === '`') {
          let skip = end
          while (src[skip] === '`') skip++
          end = src.indexOf(run, skip)
        }
        if (end >= 0) {
          let code = src.slice(i + run.length, end)
          if (/^ .* $/s.test(code) && code.trim()) code = code.slice(1, -1)
          flush()
          pushSpan(out, code, withMark(['c']))
          i = end + run.length
          continue
        }
        miss(i)
      }
      if (ch === '*' || ch === '_' || ch === '~') {
        const run = /^(\*{1,3}|_{1,3}|~~)/.exec(src.slice(i))?.[0]
        const opensWord = ch !== '_' || !isWordChar(src[i - 1])
        if (run && opensWord && !/\s/.test(src[i + run.length] ?? ' ')) {
          const end = findClose(src, run, i + run.length + 1)
          if (end >= 0) {
            let inner = marks
            const add = (m: Mark): void => {
              if (!inner.some((x) => x[0] === m[0])) inner = [...inner, m]
            }
            if (run === '~~') add(['s'])
            else {
              if (run.length >= 2) add(['b'])
              if (run.length !== 2) add(['i'])
            }
            flush()
            parseInto(src.slice(i + run.length, end), inner, out, depth + 1)
            i = end + run.length
            continue
          }
          miss(i)
        }
      }
      if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
        const start = ch === '!' ? i + 1 : i
        const m = /^\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(src.slice(start))
        if (m && m[2]) {
          const url = safeDecode(m[2])
          flush()
          // A link the app would refuse to open is imported as its text only.
          parseInto(m[1] || m[2], LINK_RE.test(url) ? withMark(['a', url]) : marks, out, depth + 1)
          i = start + m[0].length
          continue
        }
        miss(i)
      }
      if (ch === '<') {
        const rest = src.slice(i)
        const u = /^<u>([\s\S]*?)<\/u>/i.exec(rest)
        if (u) {
          flush()
          parseInto(u[1], withMark(['u']), out, depth + 1)
          i += u[0].length
          continue
        }
        const br = /^<br\s*\/?>/i.exec(rest)
        if (br) {
          buf += '\n'
          i += br[0].length
          continue
        }
        const auto = /^<(https?:\/\/[^>\s]+)>/.exec(rest)
        if (auto) {
          flush()
          pushSpan(out, auto[1], withMark(['a', auto[1]]))
          i += auto[0].length
          continue
        }
        if (/^<u>/i.test(rest)) miss(i)
      }
    }
    buf += ch
    i++
  }
  flush()
}

function safeDecode(url: string): string {
  // Export percent-encodes parentheses and spaces; undo only those.
  return url.replace(/%(28|29|20)/gi, (m) => decodeURIComponent(m))
}

function inline(src: string): RichText {
  const out: RichText = []
  parseInto(src, [], out, 0)
  return out
}

/** Parses one run of inline Markdown (emphasis, code, links) into rich text. */
export function parseInline(src: string): RichText {
  scanBudget = INLINE_SCAN_BUDGET
  return inline(src)
}

interface Node extends TreeInput {
  props: BlockProps
  children: Node[]
}

/** The text of an ATX heading without its optional closing run of #s ("## Title ##"). */
function headingText(rest: string): string {
  let end = rest.length
  while (end > 0 && rest[end - 1] === '#') end--
  if (end === rest.length) return rest
  if (end === 0) return ''
  return /\s/.test(rest[end - 1]) ? rest.slice(0, end).trimEnd() : rest
}

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

/** Tested against a trimmed line. No two adjacent whitespace runs, so a failed match stays linear. */
const TABLE_DIVIDER = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/

function tableToDatabase(header: string[], rows: string[][]): Node {
  const schema: Record<string, PropertySchema> = {}
  const ids = header.map((name, i) => {
    const id = i === 0 ? 'title' : `col${i}`
    schema[id] = { id, name: plainText(inline(name)) || `Column ${i + 1}`, type: i === 0 ? 'title' : 'text' }
    return id
  })
  const view: DatabaseView = {
    id: randomUUID(),
    name: 'Table',
    type: 'table',
    visibleProperties: ids,
    filters: [],
    sorts: []
  }
  const children = rows.map((cells): Node => {
    const values: Record<string, PropertyValue> = {}
    for (let i = 1; i < ids.length; i++) {
      const text = plainText(inline(cells[i] ?? ''))
      if (text) values[ids[i]] = text
    }
    return { type: 'page', props: { title: inline(cells[0] ?? ''), values }, children: [] }
  })
  return { type: 'database', props: { title: [], schema, views: [view] }, children }
}

function isSafeImageUrl(url: string): boolean {
  return /^(https?:\/\/|sel-file:\/\/files\/|data:image\/(png|jpe?g|gif|webp|avif);base64,)/i.test(url)
}

/** Parses a pragmatic subset of CommonMark/GFM into a block tree. */
export function parseMarkdown(source: string): { title: string | null; nodes: Node[] } {
  scanBudget = INLINE_SCAN_BUDGET
  const lines = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\t/g, INDENT).split('\n')
  const root: Node[] = []
  let title: string | null = null
  let stack: { indent: number; node: Node }[] = []
  let para: { node: Node; text: string } | null = null

  const flush = (): void => {
    if (!para) return
    para.node.props.title = inline(para.text.trimEnd())
    para = null
  }
  const container = (indent: number): Node[] => {
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    return stack.length ? stack[stack.length - 1].node.children : root
  }
  /** `raw` is the untrimmed source line: two trailing spaces or a backslash make a hard break. */
  const appendText = (line: string, raw: string): void => {
    if (!para) return
    const backslash = line.endsWith('\\')
    const hard = backslash || raw.endsWith('  ')
    para.text += (backslash ? line.slice(0, -1) : line).trim() + (hard ? '\n' : ' ')
  }

  // Front matter is metadata, not content.
  let i = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0 && lines.slice(1, end).every((l) => /^\s*$|^[\w-]+\s*:|^\s+\S|^\s*-\s/.test(l))) i = end + 1
  }

  for (; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) {
      flush()
      continue
    }
    const indent = raw.length - raw.trimStart().length
    const text = raw.trim()

    const fence = /^(`{3,}|~{3,})([^`]*)$/.exec(text)
    if (fence) {
      flush()
      const body: string[] = []
      const close = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`)
      for (i++; i < lines.length && !close.test(lines[i]); i++) {
        body.push(lines[i].startsWith(' '.repeat(indent)) ? lines[i].slice(indent) : lines[i].trimStart())
      }
      const props: BlockProps = { title: body.length ? [[body.join('\n')]] : [] }
      const language = fence[2].trim().split(/\s/, 1)[0]
      if (language) props.language = language.toLowerCase().slice(0, 40)
      container(indent).push({ type: 'code', props, children: [] })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(text)
    if (heading) {
      flush()
      stack = []
      const content = headingText(heading[2])
      if (heading[1].length === 1 && title === null && root.length === 0) {
        title = plainText(inline(content))
      } else {
        const level = Math.min(3, heading[1].length) as 1 | 2 | 3
        root.push({ type: `heading_${level}`, props: { title: inline(content) }, children: [] })
      }
      continue
    }

    if (/^([-*_])(\s*\1){2,}$/.test(text)) {
      flush()
      container(indent).push({ type: 'divider', props: {}, children: [] })
      continue
    }

    if (text.startsWith('>')) {
      flush()
      const body: string[] = []
      for (; i < lines.length && lines[i].trim().startsWith('>'); i++) body.push(lines[i].trim().replace(/^>\s?/, ''))
      i--
      const joined = body.join('\n').trim()
      container(indent).push({ type: 'quote', props: { title: inline(joined) }, children: [] })
      continue
    }

    if (text.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_DIVIDER.test(lines[i + 1].trim())) {
      const header = splitTableRow(text)
      if (splitTableRow(lines[i + 1]).length === header.length) {
        flush()
        const rows: string[][] = []
        for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) rows.push(splitTableRow(lines[i]))
        i--
        stack = []
        root.push(tableToDatabase(header, rows))
        continue
      }
    }

    const item = /^([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(text)
    if (item) {
      flush()
      const target = container(indent)
      const todo = /^\[([ xX])\]\s+(.*)$/.exec(item[2])
      const node: Node = todo
        ? { type: 'to_do', props: { checked: todo[1] !== ' ' }, children: [] }
        : { type: /^\d/.test(item[1]) ? 'numbered_list' : 'bulleted_list', props: {}, children: [] }
      target.push(node)
      if (stack.length < MAX_NESTING) stack.push({ indent, node })
      para = { node, text: '' }
      appendText(todo ? todo[2] : item[2], raw)
      continue
    }

    const image = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)$/.exec(text)
    if (image && isSafeImageUrl(image[2])) {
      flush()
      const props: BlockProps = { url: safeDecode(image[2]) }
      if (image[1].trim()) props.caption = [[image[1].trim()]]
      container(indent).push({ type: 'image', props, children: [] })
      continue
    }

    if (para) {
      // Lazy continuation of the paragraph / list item in progress.
      appendText(text, raw)
      continue
    }
    const node: Node = { type: 'text', props: {}, children: [] }
    container(indent).push(node)
    para = { node, text: '' }
    appendText(text, raw)
  }
  flush()
  return { title, nodes: root }
}

/** Creates a new page under `parentId` from Markdown source, atomically. */
export function importMarkdownText(
  repo: Repository,
  source: string,
  parentId: string | null,
  fallbackTitle = 'Untitled'
): Block {
  if (source.length > MAX_IMPORT_BYTES) throw new Error(TOO_LARGE)
  const { title, nodes } = parseMarkdown(source)
  let count = 0
  const pending = [...nodes]
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (++count > MAX_IMPORT_BLOCKS) throw new Error('The file has too many blocks to import')
    for (const child of node.children) pending.push(child)
  }
  const pageTitle = (title ?? fallbackTitle).trim().slice(0, MAX_TITLE_CHARS) || 'Untitled'
  return repo.createTree({ type: 'page', props: { title: [[pageTitle]] }, children: nodes }, parentId)
}

// ================================================================== dialogs

/** A file name suggestion for the save dialog: no separators, reserved names or trailing dots. */
export function safeFileName(title: string): string {
  const name = title
    // Bounded first, so the patterns below only ever run on a short string.
    .slice(0, 200)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return name && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? name : 'Untitled'
}

export async function exportMarkdown(
  repo: Repository,
  win: BrowserWindow | null,
  id: string
): Promise<{ saved: boolean; path?: string }> {
  const { dialog } = await import('electron')
  const { title, markdown } = pageToMarkdown(repo, id)
  const options = {
    title: 'Export as Markdown',
    defaultPath: `${safeFileName(title)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false }
  await writeFile(result.filePath, markdown, 'utf8')
  return { saved: true, path: result.filePath }
}

export async function importMarkdown(
  repo: Repository,
  win: BrowserWindow | null,
  parentId: string | null
): Promise<Block | null> {
  const { dialog } = await import('electron')
  if (parentId !== null && !repo.get(parentId)) throw new Error(`Block not found: ${parentId}`)
  const options = {
    title: 'Import Markdown',
    properties: ['openFile' as const],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const file = result.filePaths[0]
  if (result.canceled || !file) return null
  const source = (await readFileCapped(file, MAX_IMPORT_BYTES, TOO_LARGE)).toString('utf8')
  return importMarkdownText(repo, source, parentId, basename(file, extname(file)))
}
