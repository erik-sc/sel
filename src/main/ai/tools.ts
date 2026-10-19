import { plainText } from '../../shared/richtext'
import type { Block, PropertySchema } from '../../shared/types'
import type { Repository } from '../db/repository'
import { describeSchema, type WorkspaceSource } from './context'
import { truncateMiddle } from './prompts'
import { TOOL_CAPS } from './toolspecs'

/**
 * The workspace as tools: what Herman and his council may look up while they answer, beyond
 * what the prompt already carries. Every tool reads; none writes. A change is still only ever
 * proposed (shared/actions.ts) and made by the window when the user presses Apply.
 *
 * The tools reach the model through a small MCP server (../mcp.ts) that the Claude Code program
 * starts for one request and that asks this process over a private pipe (./toolhost.ts). What
 * they return is the user's content: text for the model to read, and data like every section
 * of a prompt. Ids are shown in square brackets, as in the WORKSPACE section.
 */

/** What a tool needs of the repository, beyond what the prompt's context already uses. */
export interface ToolSource extends WorkspaceSource {
  /** The blocks directly inside a block, in order (for a database: its rows). */
  children(id: string): Block[]
  /** A row's property value as text. */
  cellText?(schema: PropertySchema, row: Block): string
}

// ---- text --------------------------------------------------------------------

const oneLine = (text: string, max: number): string =>
  text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

export function titleOf(block: Block | null | undefined): string {
  const text = oneLine(plainText(block?.props.title).replace(/[[\]]/g, ' '), TOOL_CAPS.title)
  return text || 'Untitled'
}

export const live = (block: Block | null | undefined): block is Block =>
  !!block && block.trashedAt === null && (block.type === 'page' || block.type === 'database')

export const label = (block: Block): string =>
  `${block.props.icon ? `${oneLine(String(block.props.icon), 8)} ` : ''}${titleOf(block)} [${block.id}]${block.type === 'database' ? ' (database)' : ''}`

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** "Projects / Q4 / Launch": where a block sits. */
export function pathOf(source: Pick<ToolSource, 'ancestors'>, id: string): string {
  const path = source.ancestors(id).filter(live).map(titleOf)
  return path.length ? path.join(' / ') : 'the top level'
}

/** True when a page holds nothing: no text in any of its blocks and no page inside it. */
function isEmpty(source: ToolSource, page: Block): boolean {
  if (page.type !== 'page') return false
  for (const child of source.children(page.id)) {
    if (child.trashedAt !== null) continue
    if (child.type === 'page' || child.type === 'database') return false
    if (plainText(child.props.title).trim() || child.content.length) return false
    if (child.type !== 'text') return false
  }
  return true
}

const ROW_TITLE_NAMES = new Set(['title', 'name'])

function cell(source: ToolSource, property: PropertySchema, row: Block): string {
  if (property.type === 'title') return titleOf(row)
  if (source.cellText) return oneLine(source.cellText(property, row), TOOL_CAPS.cell)
  const value = row.props.values?.[property.id]
  if (value === undefined || value === null) return ''
  if (Array.isArray(value))
    return oneLine(
      value.map((item) => property.options?.find((option) => option.id === item)?.name ?? String(item)).join(', '),
      TOOL_CAPS.cell
    )
  if (typeof value === 'object') {
    const range = value as { start?: unknown; end?: unknown }
    if (typeof range.start === 'string') return typeof range.end === 'string' && range.end ? `${range.start} → ${range.end}` : range.start
    return oneLine(JSON.stringify(value), TOOL_CAPS.cell)
  }
  if (property.type === 'checkbox') return value === true ? 'yes' : 'no'
  return oneLine(property.options?.find((option) => option.id === value)?.name ?? String(value), TOOL_CAPS.cell)
}

// ---- the tools ---------------------------------------------------------------

function search(source: ToolSource, args: Record<string, unknown>): string {
  const query = typeof args['query'] === 'string' ? args['query'].trim().slice(0, 200) : ''
  if (!query) throw new ToolError('Say what to search for.')
  const limit = clamp(args['limit'], 1, TOOL_CAPS.search, 12)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const result of source.search(query, limit * 2)) {
    if (seen.has(result.pageId) || lines.length >= limit) continue
    seen.add(result.pageId)
    const page = source.get(result.pageId)
    if (!live(page)) continue
    const snippet = result.snippet ? oneLine(result.snippet, 200) : ''
    // Archived pages are found only here, by asking; the line says they were put away.
    lines.push(`- ${label(page)}${result.archived ? ' (archived)' : ''}, in ${pathOf(source, page.id)}${snippet ? `: “${snippet}”` : ''}`)
  }
  return lines.length ? lines.join('\n') : `Nothing matches “${query}”.`
}

function outline(source: ToolSource, args: Record<string, unknown>): string {
  const depth = clamp(args['depth'], 1, TOOL_CAPS.outlineDepth, 2)
  const rootId = typeof args['root'] === 'string' ? args['root'] : null
  const root = rootId ? source.get(rootId) : null
  if (rootId && !live(root)) throw new ToolError('No page has that id.')
  const lines: string[] = []
  let more = false
  const walk = (blocks: readonly Block[], level: number): void => {
    for (const block of blocks) {
      if (!live(block)) continue
      if (lines.length >= TOOL_CAPS.outlineLines) {
        more = true
        return
      }
      const notes: string[] = [`edited ${day(block.updatedAt)}`]
      if (block.type === 'database') notes.unshift(`${block.content.length} row${block.content.length === 1 ? '' : 's'}`)
      const inside = block.type === 'page' ? source.listChildren(block.id).filter(live) : []
      if (block.type === 'page' && !inside.length && isEmpty(source, block)) notes.push('empty')
      lines.push(`${'  '.repeat(level)}- ${label(block)} (${notes.join(', ')})`)
      if (inside.length && level + 1 < depth) walk(inside, level + 1)
      else if (inside.length) lines.push(`${'  '.repeat(level + 1)}- (${inside.length} more inside)`)
    }
  }
  walk(root ? source.listChildren(root.id) : source.listRoot(), 0)
  const head = root ? `Inside ${label(root)}, in ${pathOf(source, root.id)}:` : 'The workspace, from the top:'
  if (!lines.length) return `${head}\n(nothing)`
  return `${head}\n${lines.join('\n')}${more ? '\n- (and more: ask for a smaller part with "root")' : ''}`
}

function database(source: ToolSource, block: Block, offset: number, limit: number): string {
  const schema = block.props.schema ?? {}
  const properties = Object.values(schema).filter(
    (property) => property && property.type !== 'created_time' && property.type !== 'last_edited_time'
  )
  const titleProperty = properties.find((property) => property.type === 'title')
  const others = properties.filter((property) => property.type !== 'title')
  const rows = source.children(block.id).filter((row) => row.type === 'page' && row.trashedAt === null)
  const lines = [`Database ${label(block)}, in ${pathOf(source, block.id)}. ${rows.length} row${rows.length === 1 ? '' : 's'}.`]
  const shape = describeSchema(block)
  if (shape) lines.push(`Properties: ${shape}`)
  const shown = rows.slice(offset, offset + limit)
  if (shown.length) {
    lines.push('', `Rows ${offset + 1}–${offset + shown.length}:`)
    for (const row of shown) {
      const values = others.map((property) => [property.name, cell(source, property, row)] as const).filter(([, value]) => value)
      const name = titleProperty && !ROW_TITLE_NAMES.has(titleProperty.name.toLowerCase()) ? `${titleProperty.name}: ` : ''
      lines.push(
        `- ${name}${titleOf(row)} [${row.id}]${values.length ? ` | ${values.map(([key, value]) => `${oneLine(key, 60)}: ${value}`).join(' | ')}` : ''}`
      )
    }
    if (offset + shown.length < rows.length)
      lines.push(`- (${rows.length - offset - shown.length} more: read again with offset ${offset + shown.length})`)
  }
  return lines.join('\n')
}

function readPage(source: ToolSource, args: Record<string, unknown>): string {
  const id = typeof args['id'] === 'string' ? args['id'] : ''
  const page = id ? source.get(id) : null
  if (!live(page)) throw new ToolError('No page or database has that id.')
  if (page.type === 'database') return database(source, page, 0, 30)
  const inside = source.listChildren(page.id).filter(live)
  const head = [`Page ${label(page)}, in ${pathOf(source, page.id)}. Edited ${day(page.updatedAt)}.`]
  if (inside.length)
    head.push(`Inside it: ${inside.slice(0, 40).map(label).join('; ')}${inside.length > 40 ? `; and ${inside.length - 40} more` : ''}`)
  const { markdown } = source.pageToMarkdown(page.id)
  return `${head.join('\n')}\n\n${truncateMiddle(markdown.trim(), TOOL_CAPS.page)}`
}

function readDatabase(source: ToolSource, args: Record<string, unknown>): string {
  const id = typeof args['id'] === 'string' ? args['id'] : ''
  const block = id ? source.get(id) : null
  if (!live(block) || block.type !== 'database') throw new ToolError('No database has that id.')
  return database(source, block, clamp(args['offset'], 0, 1_000_000, 0), clamp(args['limit'], 1, TOOL_CAPS.rows, 50))
}

function recent(source: ToolSource, args: Record<string, unknown>): string {
  const blocks = source.listRecent(clamp(args['limit'], 1, TOOL_CAPS.recent, 15)).filter(live)
  return blocks.length
    ? blocks.map((block) => `- ${label(block)}, in ${pathOf(source, block.id)}, edited ${day(block.updatedAt)}`).join('\n')
    : 'Nothing has been edited yet.'
}

function audit(source: ToolSource, now: number): string {
  const pages: { block: Block; parent: Block | null }[] = []
  const crowded: { parent: Block | null; count: number }[] = []
  let cut = false
  const walk = (blocks: readonly Block[], parent: Block | null): void => {
    const here = blocks.filter(live)
    if (here.length >= 15) crowded.push({ parent, count: here.length })
    for (const block of here) {
      if (pages.length >= TOOL_CAPS.auditPages) {
        cut = true
        return
      }
      pages.push({ block, parent })
      if (block.type === 'page') walk(source.listChildren(block.id), block)
    }
  }
  walk(source.listRoot(), null)

  const list = (items: readonly string[]): string =>
    items.slice(0, TOOL_CAPS.auditList).join('\n') +
    (items.length > TOOL_CAPS.auditList ? `\n- (and ${items.length - TOOL_CAPS.auditList} more)` : '')
  const where = (parent: Block | null): string => (parent ? `in ${titleOf(parent)} [${parent.id}]` : 'at the top level')
  const sections: string[] = [`${pages.length} pages and databases${cut ? ' looked at (the workspace is larger; the rest was not)' : ''}.`]

  const byTitle = new Map<string, Block[]>()
  for (const { block } of pages) {
    const key = titleOf(block).toLowerCase()
    if (key === 'untitled') continue
    byTitle.set(key, [...(byTitle.get(key) ?? []), block])
  }
  const duplicates = [...byTitle.values()].filter((group) => group.length > 1)
  if (duplicates.length)
    sections.push(
      `Same title more than once:\n${list(duplicates.map((group) => `- ${titleOf(group[0])}: ${group.map((block) => `[${block.id}] in ${pathOf(source, block.id)}`).join('; ')}`))}`
    )

  const untitled = pages.filter(({ block }) => titleOf(block) === 'Untitled')
  if (untitled.length)
    sections.push(
      `Untitled:\n${list(untitled.map(({ block, parent }) => `- [${block.id}] ${where(parent)}, edited ${day(block.updatedAt)}`))}`
    )

  const empty = pages.filter(({ block }) => block.type === 'page' && !source.listChildren(block.id).some(live) && isEmpty(source, block))
  if (empty.length) sections.push(`Empty pages:\n${list(empty.map(({ block, parent }) => `- ${label(block)} ${where(parent)}`))}`)

  const stale = pages
    .filter(({ block }) => now - block.updatedAt > TOOL_CAPS.staleDays * 86_400_000)
    .sort((a, b) => a.block.updatedAt - b.block.updatedAt)
  if (stale.length)
    sections.push(
      `Untouched for more than ${TOOL_CAPS.staleDays} days, the oldest first:\n${list(stale.map(({ block, parent }) => `- ${label(block)} ${where(parent)}, edited ${day(block.updatedAt)}`))}`
    )

  if (crowded.length)
    sections.push(
      `Crowded places (many pages side by side):\n${list(crowded.sort((a, b) => b.count - a.count).map(({ parent, count }) => `- ${count} ${where(parent)}`))}`
    )

  const bare = pages.filter(({ block }) => block.type === 'database' && block.content.length === 0)
  if (bare.length) sections.push(`Databases without rows:\n${list(bare.map(({ block, parent }) => `- ${label(block)} ${where(parent)}`))}`)

  if (sections.length === 1) sections.push('Nothing stands out: no duplicates, nothing empty, untitled or long untouched.')
  return sections.join('\n\n')
}

// ---- calling -------------------------------------------------------------------

/** A mistake in how a tool was called: said to the model, which can try again. */
export class ToolError extends Error {}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback
}

/**
 * Runs one tool. Throws a ToolError for a call that cannot be answered (an unknown id, a
 * missing argument); anything else that goes wrong is the caller's to log.
 */
export function callTool(source: ToolSource, name: string, rawArgs: unknown, now: number = Date.now()): string {
  const args = rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {}
  switch (name) {
    case 'search':
      return search(source, args)
    case 'outline':
      return outline(source, args)
    case 'read_page':
      return readPage(source, args)
    case 'read_database':
      return readDatabase(source, args)
    case 'recent':
      return recent(source, args)
    case 'audit':
      return audit(source, now)
    default:
      throw new ToolError(`There is no tool called ${oneLine(String(name), 40)}.`)
  }
}

/** What a tool says a little about, for the window to show while a member works: "reading “Projects”". */
export function toolActivity(source: Pick<ToolSource, 'get'>, name: string, rawArgs: unknown): string {
  const args = rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {}
  const named = (id: unknown): string => {
    const block = typeof id === 'string' ? source.get(id) : null
    return live(block) ? `“${titleOf(block).slice(0, 40)}”` : 'a page'
  }
  switch (name) {
    case 'search':
      return `searching for “${typeof args['query'] === 'string' ? oneLine(args['query'], 40) : ''}”`
    case 'outline':
      return args['root'] ? `looking inside ${named(args['root'])}` : 'looking over the workspace'
    case 'read_page':
      return `reading ${named(args['id'])}`
    case 'read_database':
      return `reading ${named(args['id'])}`
    case 'recent':
      return 'looking at what changed lately'
    case 'audit':
      return 'checking the workspace'
    default:
      return 'looking'
  }
}

/** The repository as the tools read it, with the Markdown converter they read pages through. */
export function repositorySource(repo: Repository, markdown: Pick<typeof import('../markdown'), 'pageToMarkdown'>): ToolSource {
  return {
    get: (id) => repo.get(id),
    ancestors: (id) => repo.ancestors(id),
    listRoot: () => repo.listRoot(),
    listChildren: (id) => repo.listChildren(id),
    listRecent: (limit) => repo.listRecent(limit),
    listDatabases: () => repo.listDatabases({ archived: false }),
    search: (text, limit) => repo.search(text, limit),
    pageToMarkdown: (id) => markdown.pageToMarkdown(repo, id),
    children: (id) => repo.children(id)
  }
}
