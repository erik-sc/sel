import type { AiRequest } from '../../shared/ai'
import { isRelationId } from '../../shared/relation'
import { plainText } from '../../shared/richtext'
import type { Block, SearchResult } from '../../shared/types'
import { truncateMiddle } from './prompts'

/**
 * What a question is asked against, beyond the page in front: where that page sits, what else
 * is in the workspace, which databases exist and how they are shaped, and the pages that seem
 * to bear on the question. All of it is read here, in the main process, from what is stored;
 * a renderer sends none of it. In the prompt it is data like the page itself: fenced, and
 * never instructions.
 *
 * Ids are shown in square brackets after a title. They are what a proposal to build something
 * (shared/actions.ts) refers to; the window checks every one of them before it acts.
 */

/** What this module needs of the repository and the Markdown exporter. */
export interface WorkspaceSource {
  get(id: string): Block | null
  ancestors(id: string): Block[]
  listRoot(): Block[]
  listChildren(pageId: string): Block[]
  listRecent(limit: number): Block[]
  listDatabases(): Block[]
  search(text: string, limit: number): SearchResult[]
  pageToMarkdown(id: string): { title: string; markdown: string }
}

export const CONTEXT_CAPS = {
  title: 80,
  /** Lines of the page outline, and how deep it goes. */
  outline: 70,
  depth: 2,
  children: 40,
  databases: 12,
  properties: 16,
  options: 12,
  recent: 8,
  /** Words of the question that are searched for, and pages offered as related. */
  keywords: 6,
  related: 4,
  excerpt: 2400,
  workspace: 14_000,
  relatedSection: 12_000
} as const

export interface WorkspaceContext {
  /** Body of the WORKSPACE section. */
  workspace?: string
  /** Body of the RELATED section. */
  related?: string
}

/** A title as one line of the outline. */
function title(block: Block | null | undefined): string {
  const text = plainText(block?.props.title)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'Untitled'
  return text.length > CONTEXT_CAPS.title ? `${text.slice(0, CONTEXT_CAPS.title - 1)}…` : text
}

const live = (block: Block | null | undefined): block is Block =>
  !!block && block.trashedAt === null && (block.type === 'page' || block.type === 'database')

const label = (block: Block): string => `${title(block)} [${block.id}]${block.type === 'database' ? ' (database)' : ''}`

function oneLine(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''
}

/**
 * "Name (title), Status (select: To do, Doing, Done), Due (date), Projects (relation to Projects)":
 * the shape of a database, from its stored schema. `source` names the databases relations point at.
 */
export function describeSchema(database: Block, source?: Pick<WorkspaceSource, 'get'>): string {
  const schema = database.props.schema
  if (!schema || typeof schema !== 'object') return ''
  const parts: string[] = []
  for (const property of Object.values(schema)) {
    if (parts.length >= CONTEXT_CAPS.properties) break
    if (!property || typeof property !== 'object') continue
    const name = oneLine(property.name, 60)
    const type = oneLine(property.type, 20)
    // Computed values (times, rollups, formulas) are never written by a proposal.
    if (!name || !type || type === 'created_time' || type === 'last_edited_time' || type === 'rollup' || type === 'formula') continue
    if (type === 'relation') {
      const target = isRelationId(property.relation?.databaseId) ? source?.get(property.relation.databaseId) : null
      parts.push(`${name} (relation${target && target.type === 'database' ? ` to ${title(target)}` : ''})`)
      continue
    }
    const options = Array.isArray(property.options)
      ? property.options
          .map((option) => oneLine(option?.name, 40))
          .filter(Boolean)
          .slice(0, CONTEXT_CAPS.options)
      : []
    parts.push(`${name} (${type}${options.length ? `: ${options.join(', ')}` : ''})`)
  }
  return parts.join(', ')
}

function outline(source: WorkspaceSource, lines: string[], blocks: readonly Block[], depth: number): void {
  for (const block of blocks) {
    if (lines.length >= CONTEXT_CAPS.outline) return
    if (!live(block)) continue
    lines.push(`${'  '.repeat(depth)}- ${label(block)}`)
    // Rows of a database are pages too; they are counted with the database, not listed here.
    if (block.type === 'page' && depth + 1 < CONTEXT_CAPS.depth) outline(source, lines, source.listChildren(block.id), depth + 1)
  }
}

const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'about after again also been before being could does doing done each from have here into just like make more most much need only other over page pages please should some such than that their them then there these they this those what when where which while will with would your ' +
    'agora ainda algo algum alguma antes aqui cada como depois dela dele dessa desse desta deste devo disso esta este estao fazer isso mais mesmo minha minhas muito nada onde para pela pelo pode posso qual quando quais quero sobre tambem tenho todo todos tudo uma umas voce'
  ).split(' ')
)

/** The words of a question worth searching for: the longer ones, in the order they were written, without the commonest. */
export function keywords(text: string, max: number = CONTEXT_CAPS.keywords): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.slice(0, 2000).split(/[^\p{L}\p{N}]+/u)) {
    const word = raw.toLowerCase()
    const plain = word.normalize('NFD').replace(/\p{M}+/gu, '')
    if (plain.length < 4 || STOPWORDS.has(plain) || seen.has(plain)) continue
    seen.add(plain)
    out.push(word)
  }
  // Longer words say more about what is asked.
  return out
    .map((word, index) => ({ word, index }))
    .sort((a, b) => b.word.length - a.word.length || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.word)
}

/** Pages other than the one in front that the question seems to be about, the likeliest first. */
export function relatedPages(source: WorkspaceSource, question: string, exclude: string | null): { id: string; hits: number }[] {
  const scores = new Map<string, number>()
  for (const word of keywords(question)) {
    const seen = new Set<string>()
    let results: SearchResult[] = []
    try {
      results = source.search(word, 8)
    } catch {
      /* a word the index cannot take: the others still count */
    }
    for (const result of results) {
      // Archived pages come up only when the assistant searches for them, not on their own.
      if (result.pageId === exclude || seen.has(result.pageId) || result.archived) continue
      seen.add(result.pageId)
      // A hit in a title weighs more than one in the text.
      scores.set(result.pageId, (scores.get(result.pageId) ?? 0) + (result.id === result.pageId ? 2 : 1))
    }
  }
  return [...scores.entries()]
    .map(([id, hits]) => ({ id, hits }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, CONTEXT_CAPS.related)
}

/**
 * The context of one question (`ask`): the WORKSPACE and RELATED section bodies. Never throws:
 * a part that cannot be read is left out, and the question is still answered.
 */
export function buildWorkspace(source: WorkspaceSource, request: AiRequest, now: Date = new Date()): WorkspaceContext {
  const parts: string[] = []
  const part = (build: () => string | null): void => {
    try {
      const text = build()
      if (text) parts.push(text)
    } catch (err) {
      console.error('[ai] part of the context could not be read', err)
    }
  }

  parts.push(
    `Now: ${new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}`
  )

  const current = request.pageId ? source.get(request.pageId) : null
  part(() => {
    if (!live(current)) return 'Current page: none (the user is not on a page)'
    const path = source.ancestors(current.id).filter(live).map(title)
    const lines = [
      `Current page: ${label(current)}`,
      `Where it is: ${path.length ? `${path.join(' / ')} / ${title(current)}` : 'at the top level'}`
    ]
    if (current.type === 'database') {
      const schema = describeSchema(current, source)
      lines.push(
        `It is a database with ${current.content.length} row${current.content.length === 1 ? '' : 's'}${schema ? `. Properties: ${schema}` : ''}`
      )
    } else {
      const children = source.listChildren(current.id).filter(live).slice(0, CONTEXT_CAPS.children)
      if (children.length) lines.push('Inside it:', ...children.map((child) => `- ${label(child)}`))
    }
    return lines.join('\n')
  })

  part(() => {
    const lines: string[] = []
    outline(source, lines, source.listRoot(), 0)
    if (!lines.length) return null
    return `Pages of the workspace (the top levels):\n${lines.join('\n')}${lines.length >= CONTEXT_CAPS.outline ? '\n- (and more)' : ''}`
  })

  part(() => {
    const databases = source.listDatabases().filter(live).slice(0, CONTEXT_CAPS.databases)
    if (!databases.length) return null
    const lines = databases.map((database) => {
      const schema = describeSchema(database, source)
      return `- ${title(database)} [${database.id}], ${database.content.length} row${database.content.length === 1 ? '' : 's'}${schema ? `. Properties: ${schema}` : ''}`
    })
    return `Databases:\n${lines.join('\n')}`
  })

  part(() => {
    const recent = source
      .listRecent(CONTEXT_CAPS.recent + 1)
      .filter((block) => live(block) && block.id !== current?.id)
      .slice(0, CONTEXT_CAPS.recent)
    return recent.length ? `Edited lately:\n${recent.map((block) => `- ${label(block)}`).join('\n')}` : null
  })

  const out: WorkspaceContext = { workspace: truncateMiddle(parts.join('\n\n'), CONTEXT_CAPS.workspace) }

  try {
    // What was asked now, and the question before it: a follow-up often leaves the subject out.
    const earlier = [...(request.history ?? [])].reverse().find((turn) => turn.role === 'user')?.text ?? ''
    const excerpts: string[] = []
    for (const { id } of relatedPages(source, `${request.instruction ?? ''} ${earlier}`, live(current) ? current.id : null)) {
      const page = source.get(id)
      if (!live(page)) continue
      const { markdown } = source.pageToMarkdown(id)
      if (!markdown.trim()) continue
      const path = source.ancestors(id).filter(live).map(title)
      excerpts.push(
        `=== ${label(page)}${path.length ? `, in ${path.join(' / ')}` : ''} ===\n${truncateMiddle(markdown.trim(), CONTEXT_CAPS.excerpt)}`
      )
    }
    if (excerpts.length) out.related = truncateMiddle(excerpts.join('\n\n'), CONTEXT_CAPS.relatedSection)
  } catch (err) {
    console.error('[ai] related pages could not be read', err)
  }
  return out
}
