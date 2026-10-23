import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { ImportCounts, ImportFormat } from '../../shared/transfer'
import type { DatabaseView, PropertySchema, PropertyValue } from '../../shared/types'
import { INDEX_MARKER } from '../data/exportAll'
import { MAX_IMPORT_BYTES, parseInline } from '../markdown'
import { plainText } from '../../shared/richtext'
import { csvToDatabase } from './columns'
import { parseCsv } from './csv'
import type { ImportSource, SourceFile } from './source'

/**
 * What an import of a Notion export or an Obsidian vault will make, worked out before anything
 * is written: the pages and databases, nested as the folders nest them, each with its Markdown
 * whose links already point at the new pages (`sel://page/<id>`, the ids given here), and the
 * images to copy in. The preview shows its counts; ./run.ts makes it.
 *
 * The layout both formats share, and sel's own export too (./exportZip.ts):
 * - `Page.md` is a page; a folder `Page/` next to it holds its sub-pages.
 * - `Table.csv` is a database (Notion's `Table_all.csv` wins over `Table.csv`); a folder `Table/`
 *   next to it holds the pages of its rows, matched to the rows by title.
 * - A folder with no page of its name is a page of that name, when it holds any Markdown.
 * - Everything else is an attachment: images are copied in where a page shows them.
 * Notion ends names with the page's id (`Page 0123…cdef.md`), which is dropped from titles.
 */

export interface PlanNode {
  id: string
  kind: 'page' | 'database'
  title: string
  icon?: string
  /** The page's content, links rewritten; an image to copy in is `sel-import:<n>`, `n` its index in `ImportPlan.images`. */
  markdown: string
  /** A row of a database: its values. */
  values?: Record<string, PropertyValue>
  database?: { schema: Record<string, PropertySchema>; views: DatabaseView[] }
  /** Sub-pages, or a database's rows. */
  children: PlanNode[]
}

export interface ImportPlan {
  format: ImportFormat
  sourceName: string
  nodes: PlanNode[]
  images: SourceFile[]
  counts: ImportCounts
}

export const IMAGE_PLACEHOLDER = 'sel-import:'
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i
const NOTION_ID = /\s+([0-9a-f]{32})$/i
const MAX_TITLE_CHARS = 2000

interface Draft extends PlanNode {
  children: Draft[]
  /** The Markdown as read, rewritten in the second pass. */
  raw: string
  /** The folder the Markdown sits in, for its relative links. */
  dir: string
  /** A row: the columns whose `Key: value` lines Notion writes under the title. */
  columns?: string[]
  row?: boolean
}

interface Dir {
  md: SourceFile[]
  csv: SourceFile[]
  sub: Set<string>
  /** Some Markdown or CSV lies inside. */
  content: boolean
}

const extOf = (path: string): string => posix.extname(path).toLowerCase()
const stemOf = (path: string): string => {
  const name = posix.basename(path)
  const ext = posix.extname(name)
  return ext ? name.slice(0, -ext.length) : name
}
const lower = (s: string): string => s.toLowerCase()
/** A title compared loosely: case, spaces and the characters a file name cannot hold do not count. */
const loose = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[<>:"/\\|?*#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>~])/g, '\\$1')
}

function safeDecode(href: string): string | null {
  try {
    return decodeURIComponent(href)
  } catch {
    return null
  }
}

/** The plain text of a line of inline Markdown (a heading's). */
function plainHeading(text: string): string {
  return plainText(parseInline(text)).trim()
}

/** A YAML front matter's simple keys: `key: value`, `key: [a, b]` and `key:` followed by `- item` lines. */
export function splitFrontmatter(text: string): { data: [string, string][]; rest: string } {
  const source = text.replace(/^﻿/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(source)
  if (!m) return { data: [], rest: source }
  const entries: { key: string; values: string[] }[] = []
  const unquote = (v: string): string => v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    const last = entries[entries.length - 1]
    if (item && last) {
      last.values.push(unquote(item[1]))
      continue
    }
    const kv = /^([A-Za-z0-9_][\w .-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const value = kv[2].trim()
    const inline = /^\[(.*)\]$/.exec(value)
    entries.push({ key: kv[1].trim(), values: inline ? inline[1].split(',').map(unquote).filter(Boolean) : value ? [unquote(value)] : [] })
  }
  return { data: entries.map(({ key, values }): [string, string] => [key, values.join(', ')]), rest: source.slice(m[0].length) }
}

export async function planImport(
  source: ImportSource,
  format: ImportFormat,
  pause: () => Promise<void> = async () => undefined
): Promise<ImportPlan> {
  const notion = format === 'notion'
  const clean = (stem: string): string => {
    const name = notion ? stem.replace(/_all$/i, '').replace(NOTION_ID, '') : stem
    return name.trim().slice(0, MAX_TITLE_CHARS) || 'Untitled'
  }

  // ---- the folders, and what is in each
  const dirs = new Map<string, Dir>()
  const dirOf = (path: string): Dir => {
    let dir = dirs.get(path)
    if (!dir) {
      dir = { md: [], csv: [], sub: new Set(), content: false }
      dirs.set(path, dir)
      if (path) dirOf(posix.dirname(path) === '.' ? '' : posix.dirname(path)).sub.add(posix.basename(path))
    }
    return dir
  }
  const attachByPath = new Map<string, SourceFile>()
  const attachByName = new Map<string, SourceFile[]>()
  dirOf('')
  let index: SourceFile | null = null
  for (const file of source.files) {
    const parent = posix.dirname(file.path) === '.' ? '' : posix.dirname(file.path)
    const ext = extOf(file.path)
    if (ext === '.md' || ext === '.markdown' || ext === '.csv') {
      if (file.path === 'index.md') index = file
      const dir = dirOf(parent)
      if (ext === '.csv') dir.csv.push(file)
      else dir.md.push(file)
      for (let up = parent; ; up = posix.dirname(up) === '.' ? '' : posix.dirname(up)) {
        dirOf(up).content = true
        if (!up) break
      }
    } else {
      dirOf(parent)
      attachByPath.set(lower(file.path), file)
      const name = lower(posix.basename(file.path))
      const list = attachByName.get(name)
      if (list) list.push(file)
      else attachByName.set(name, [file])
    }
  }

  // A sel export's index lists the pages in their order; it is not a page itself.
  let indexText: string | null = null
  if (index) {
    const text = (await index.read(MAX_IMPORT_BYTES)).toString('utf8')
    if (splitFrontmatter(text).data.some(([k, v]) => `${k}: ${v}` === INDEX_MARKER)) {
      indexText = text
      dirOf('').md = dirOf('').md.filter((f) => f !== index)
    }
  }
  const selExport = indexText !== null

  // ---- the tree
  const byPath = new Map<string, Draft>()
  const byStem = new Map<string, Draft[]>()
  const byNotionId = new Map<string, Draft>()
  const pagePaths: [string, Draft][] = []
  const register = (node: Draft, path: string, named: boolean): void => {
    byPath.set(lower(path), node)
    if (!named) return
    const stem = stemOf(path)
    pagePaths.push([lower(path.replace(/\.(md|markdown|csv)$/i, '')), node])
    for (const key of new Set([lower(stem), lower(clean(stem))])) {
      const list = byStem.get(key)
      if (list) list.push(node)
      else byStem.set(key, [node])
    }
    const id = NOTION_ID.exec(stem.replace(/_all$/i, ''))?.[1]
    if (id) byNotionId.set(lower(id), node)
  }
  const read = async (file: SourceFile): Promise<string> => {
    await pause()
    return (await file.read(MAX_IMPORT_BYTES)).toString('utf8')
  }
  const draft = (kind: Draft['kind'], title: string, dir: string, raw = ''): Draft => ({
    id: randomUUID(),
    kind,
    title,
    markdown: '',
    raw,
    dir,
    children: []
  })
  const firstHeading = (text: string): string | null => {
    const body = splitFrontmatter(text).rest
    const line = body.split(/\r?\n/).find((l) => l.trim())
    const m = line ? /^#\s+(.+?)(?:\s+#+)?\s*$/.exec(line.trim()) : null
    return m ? plainHeading(m[1]) : null
  }

  const folderPage = async (path: string): Promise<Draft> => {
    const node = draft('page', clean(posix.basename(path)), path)
    register(node, path, false)
    node.children = await buildDir(path)
    return node
  }

  const buildDatabase = async (
    dir: string,
    csv: SourceFile,
    base: string,
    table: SourceFile | undefined,
    rowsDir: string | null
  ): Promise<Draft> => {
    const rows = parseCsv(await read(csv))
    const header = rows[0] ?? []
    const db = csvToDatabase(header, rows.slice(1))
    const node = draft('database', clean(base), dir)
    node.database = { schema: db.schema, views: db.views }
    register(node, csv.path, true)
    if (table) {
      register(node, table.path, true)
      const heading = firstHeading(await read(table))
      if (heading) node.title = heading.slice(0, MAX_TITLE_CHARS)
    }
    const rowDrafts = db.rows.map((row) => {
      const child = draft('page', row.title.slice(0, MAX_TITLE_CHARS) || 'Untitled', rowsDir ?? dir)
      child.values = row.values
      child.row = true
      child.columns = header.slice(1).map((h) => h.trim())
      return child
    })
    node.children = rowDrafts
    if (rowsDir) {
      register(node, rowsDir, false)
      const info = dirs.get(rowsDir)
      const matched = new Set<Draft>()
      const usedSub = new Set<string>()
      for (const md of info?.md ?? []) {
        const text = await read(md)
        const stem = stemOf(md.path)
        const key = loose(firstHeading(text) ?? clean(stem))
        let row = rowDrafts.find((r) => !matched.has(r) && loose(r.title) === key)
        // Notion shortens long titles in file names.
        if (!row && key.length >= 20) row = rowDrafts.find((r) => !matched.has(r) && loose(r.title).startsWith(key))
        if (!row) {
          row = draft('page', firstHeading(text) ?? clean(stem), rowsDir)
          row.row = true
          row.values = {}
          node.children.push(row)
        }
        matched.add(row)
        row.raw = text
        row.dir = rowsDir
        register(row, md.path, true)
        if (info?.sub.has(stem)) {
          usedSub.add(stem)
          const sub = posix.join(rowsDir, stem)
          register(row, sub, false)
          row.children = await buildDir(sub)
        }
      }
      for (const name of info?.sub ?? []) {
        const sub = posix.join(rowsDir, name)
        if (usedSub.has(name) || !dirs.get(sub)?.content) continue
        const extra = await folderPage(sub)
        extra.row = true
        extra.values = {}
        node.children.push(extra)
      }
    }
    return node
  }

  const buildDir = async (path: string): Promise<Draft[]> => {
    const info = dirs.get(path)
    if (!info) return []
    const out: Draft[] = []
    const usedMd = new Set<SourceFile>()
    const usedSub = new Set<string>()
    const csvByBase = new Map<string, SourceFile[]>()
    for (const csv of info.csv) {
      const stem = stemOf(csv.path)
      const base = stem.replace(/_all$/i, '')
      const list = csvByBase.get(base)
      // The `_all` table first: it has every row, the other only those its view shows.
      if (list) list[/_all$/i.test(stem) ? 'unshift' : 'push'](csv)
      else csvByBase.set(base, [csv])
    }
    for (const [base, [csv, ...others]] of csvByBase) {
      // sel's own export writes the table as Markdown next to the CSV: the CSV is the database.
      const table = info.md.find((md) => stemOf(md.path) === base)
      if (table) usedMd.add(table)
      const rowsDir = info.sub.has(base) ? posix.join(path, base) : null
      if (rowsDir) usedSub.add(base)
      const db = await buildDatabase(path, csv, base, table, rowsDir)
      for (const other of others) register(db, other.path, true)
      out.push(db)
    }
    for (const md of info.md) {
      if (usedMd.has(md)) continue
      const stem = stemOf(md.path)
      const node = draft('page', clean(stem), path, await read(md))
      register(node, md.path, true)
      if (info.sub.has(stem)) {
        usedSub.add(stem)
        const sub = posix.join(path, stem)
        register(node, sub, false)
        node.children = await buildDir(sub)
      }
      out.push(node)
    }
    for (const name of info.sub) {
      const sub = posix.join(path, name)
      if (usedSub.has(name) || !dirs.get(sub)?.content) continue
      out.push(await folderPage(sub))
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
  }

  const nodes = await buildDir('')

  // ---- the links, now that every page has its id
  const images: SourceFile[] = []
  const imageIndex = new Map<SourceFile, number>()
  const counts: ImportCounts = { pages: 0, databases: 0, attachments: 0, skipped: 0, unresolved: 0 }
  const skippedFiles = new Set<SourceFile>()

  const pageByName = (target: string, from: Draft): Draft | null => {
    const t = target.trim().replace(/\.(md|markdown)$/i, '')
    if (!t) return null
    const key = lower(t)
    if (t.includes('/')) {
      const exact = byPath.get(`${key}.md`) ?? byPath.get(lower(posix.join(from.dir, t)) + '.md')
      if (exact) return exact
      const found = pagePaths.filter(([path]) => path.endsWith(`/${key}`) || path === key)
      return found.length ? found.sort((a, b) => a[0].length - b[0].length)[0][1] : null
    }
    const list = byStem.get(key)
    if (!list?.length) return null
    return list.find((n) => n.dir === from.dir) ?? [...list].sort((a, b) => a.dir.length - b.dir.length)[0]
  }
  const attachmentByName = (target: string, from: Draft): SourceFile | null => {
    const t = target.trim()
    if (!t) return null
    const direct = attachByPath.get(lower(posix.join(from.dir, t))) ?? attachByPath.get(lower(t))
    if (direct) return direct
    const list = attachByName.get(lower(posix.basename(t)))
    if (!list?.length) return null
    if (t.includes('/')) return list.find((f) => lower(f.path).endsWith(`/${lower(t)}`)) ?? null
    return list.find((f) => posix.dirname(f.path) === from.dir) ?? list[0]
  }
  const image = (alt: string, file: SourceFile): string => {
    let n = imageIndex.get(file)
    if (n === undefined) {
      n = images.length
      images.push(file)
      imageIndex.set(file, n)
    }
    return `\n\n![${alt.replace(/[[\]\n]/g, ' ')}](${IMAGE_PLACEHOLDER}${n})\n\n`
  }
  const skip = (file: SourceFile | null): void => {
    if (file && skippedFiles.has(file)) return
    if (file) skippedFiles.add(file)
    counts.skipped += 1
  }
  const pageLink = (text: string, node: Draft): string => `[${text || escapeText(node.title)}](sel://page/${node.id})`

  const wikilink = (from: Draft, bang: string, inner: string): string => {
    const bar = inner.search(/\\?\|/)
    const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim()
    const alias =
      bar >= 0
        ? inner
            .slice(bar)
            .replace(/^\\?\|/, '')
            .trim()
        : ''
    const hash = target.indexOf('#')
    const name = hash >= 0 ? target.slice(0, hash).trim() : target
    const shown = escapeText(alias && !(bang && /^\d+(x\d+)?$/.test(alias)) ? alias : target.replace(/#\^?/, ' › '))
    if (!name) return shown
    const hasOtherExt = /\.[A-Za-z0-9]{1,8}$/.test(name) && !/\.(md|markdown)$/i.test(name)
    if (hasOtherExt) {
      const file = attachmentByName(name, from)
      if (file && bang && IMAGE_EXT.test(file.path)) return image(alias && !/^\d+(x\d+)?$/.test(alias) ? alias : '', file)
      skip(file)
      return shown
    }
    const page = pageByName(name, from)
    if (page) return pageLink(alias ? escapeText(alias) : escapeText(page.title), page)
    counts.unresolved += 1
    return shown
  }

  const mdlink = (from: Draft, whole: string, bang: string, text: string, href: string): string => {
    if (/^(https?:|mailto:)/i.test(href)) {
      const id = /notion\.so\/.*?([0-9a-f]{32})(?:[?#].*)?$/i.exec(href)?.[1]
      const page = id && !bang ? byNotionId.get(lower(id)) : undefined
      return page ? pageLink(text, page) : whole
    }
    if (/^sel:\/\//i.test(href) || href.startsWith(IMAGE_PLACEHOLDER)) return whole
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return text
    const decoded = safeDecode(href.replace(/[?#].*$/, ''))
    if (!decoded) return text
    const path = posix.normalize(posix.join(from.dir, decoded))
    if (path.startsWith('..')) {
      counts.unresolved += 1
      return text
    }
    if (bang) {
      const file = attachByPath.get(lower(path))
      if (file && IMAGE_EXT.test(file.path)) return image(text, file)
      skip(file ?? null)
      return text
    }
    const page = byPath.get(lower(path)) ?? byPath.get(`${lower(path)}.md`)
    if (page) return pageLink(text, page)
    const file = attachByPath.get(lower(path))
    if (file) {
      skip(file)
      return text
    }
    counts.unresolved += 1
    return text
  }

  const LINK = /(!?)\[((?:\\.|[^\]\\])*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g
  const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g
  const rewriteLine = (from: Draft, line: string): string =>
    line
      .split(/(`+[^`]*`+)/)
      .map((part, i) =>
        i % 2
          ? part
          : part
              .replace(WIKI, (_m, bang: string, inner: string) => wikilink(from, bang, inner))
              .replace(LINK, (whole, bang: string, text: string, angled?: string, plain?: string) =>
                mdlink(from, whole, bang, text, angled ?? plain ?? '')
              )
      )
      .join('')

  const rewrite = (from: Draft): string => {
    const { data, rest } = splitFrontmatter(from.raw)
    let lines = rest.replace(/\r\n?/g, '\n').split('\n')
    // The title, written again as the first heading.
    const first = lines.findIndex((l) => l.trim())
    const heading = first >= 0 ? /^#\s+(.+?)(?:\s+#+)?\s*$/.exec(lines[first].trim()) : null
    if (heading) {
      const text = plainHeading(heading[1])
      if ((notion || selExport) && !from.row && text) {
        from.title = text.slice(0, MAX_TITLE_CHARS)
        lines.splice(first, 1)
      } else if (loose(text) === loose(from.title)) lines.splice(first, 1)
    }
    // Notion writes a row's values under its title (`Status: Done`): they are in the table already.
    if (from.columns?.length) {
      const keys = new Set(from.columns.map(lower))
      let at = lines.findIndex((l) => l.trim())
      while (at >= 0 && at < lines.length) {
        const kv = /^([^:]{1,200}):\s/.exec(lines[at]) ?? /^([^:]{1,200}):$/.exec(lines[at].trim())
        if (!kv || !keys.has(lower(kv[1].trim()))) break
        lines.splice(at, 1)
      }
    }
    // Front matter: an emoji `icon` becomes the page's icon; the rest is listed at the top.
    const listed: string[] = []
    for (const [key, value] of data) {
      if (key === 'icon' && value && [...value].length <= 4 && !/[\w\s]/.test(value)) from.icon = value
      else if (value && !/^(cssclass(es)?|position|sel-export)$/i.test(key)) listed.push(`- **${escapeText(key)}:** ${value}`)
    }
    if (listed.length) lines = [...listed, '', ...lines]
    let fence: string | null = null
    const out = lines.map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null
        return line
      }
      if (marker) {
        fence = marker
        return line
      }
      return rewriteLine(from, line)
    })
    return out.join('\n')
  }

  const order = new Map<string, number>()
  if (indexText) {
    let n = 0
    for (const m of indexText.matchAll(LINK)) {
      const decoded = safeDecode((m[3] ?? m[4] ?? '').replace(/[?#].*$/, ''))
      const page = decoded ? byPath.get(lower(posix.normalize(decoded))) : undefined
      if (page && !order.has(page.id)) order.set(page.id, n++)
    }
  }

  const finish = async (list: Draft[]): Promise<void> => {
    if (order.size) list.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    for (const node of list) {
      await pause()
      if (node.kind === 'database') counts.databases += 1
      else counts.pages += 1
      node.markdown = node.raw ? rewrite(node) : ''
      node.raw = ''
      // Rows keep the table's order; everything else follows the index when there is one.
      if (node.kind === 'database') {
        const keep = [...node.children]
        await finish(node.children)
        node.children.splice(0, node.children.length, ...keep)
      } else await finish(node.children)
    }
  }
  await finish(nodes)
  counts.attachments = images.length

  const strip = (node: Draft): PlanNode => {
    const out: PlanNode = { id: node.id, kind: node.kind, title: node.title, markdown: node.markdown, children: node.children.map(strip) }
    if (node.icon) out.icon = node.icon
    if (node.values) out.values = node.values
    if (node.database) out.database = node.database
    return out
  }
  return { format, sourceName: source.name, nodes: nodes.map(strip), images, counts }
}
