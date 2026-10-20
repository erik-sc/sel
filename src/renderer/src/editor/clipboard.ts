// Clipboard formats: serialising blocks, and validating what comes back.
// The internal JSON mime types can be written by any application (or a hostile
// page the user copied from), so nothing in them is trusted. Pure; unit tested.
import type { BlockProps, BlockType, DatabaseView, Op, PropertyValue, RichText, ViewFilter, ViewSort } from '@shared/types'
import { sourceIdOf } from '../../../shared/linked'
import { sanitizeChartConfig } from '../../../shared/chart'
import { sanitizeCalcs } from '@shared/database/calcConfig'
import type { GetBlock } from './ops'
import { ALL_TYPES, isTextType } from './blockTypes'
import { isColorValue, parseRichText, textOf } from './richtext-dom'
import { isSafeImageUrl, sanitizeHref } from './sanitize'

export const MIME_BLOCKS = 'application/x-sel-blocks'
export const MIME_RICHTEXT = 'application/x-sel-richtext'
export const MIME_DRAG = 'application/x-sel-drag'

/** Limits for clipboard payloads; anything beyond them is dropped. */
export const MAX_CLIP_JSON_LENGTH = 8_000_000
export const MAX_CLIP_NODES = 5000
export const MAX_CLIP_DEPTH = 32
const MAX_ICON_LENGTH = 32
/** Bounds for the views a linked database view carries through the clipboard. */
const MAX_CLIP_VIEWS = 50
const MAX_VIEW_ITEMS = 200
const MAX_VIEW_NAME_LENGTH = 100
const MAX_FILTER_TEXT_LENGTH = 1000
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const VIEW_TYPES: readonly string[] = ['table', 'board', 'list', 'gallery', 'calendar', 'chart', 'calc']
const FILTER_OPERATORS: readonly string[] = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'is_empty',
  'is_not_empty',
  'gt',
  'lt',
  'checked',
  'unchecked'
]
const MAX_LANGUAGE_LENGTH = 32
const LANGUAGE_RE = /^[\w+#.-]+( [\w+#.-]+)*$/

export interface ClipNode {
  type: BlockType
  props: BlockProps
  children: ClipNode[]
}

/**
 * Block types that can travel through the clipboard. Sub-pages and databases cannot:
 * they own content that a copy would have to duplicate. The exception is a linked
 * database view, which owns nothing but its views (see `isClipNode`).
 */
const CLIP_TYPES: ReadonlySet<string> = new Set(ALL_TYPES.filter((t) => t !== 'page' && t !== 'database'))

function isClipType(type: unknown): type is BlockType {
  return typeof type === 'string' && CLIP_TYPES.has(type)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

/** A `database` node is only accepted as a linked view: with a well-formed `sourceId`. */
function isLinkedClip(type: unknown, props: unknown): boolean {
  return type === 'database' && props !== null && typeof props === 'object' && isId((props as { sourceId?: unknown }).sourceId)
}

function cleanFilterValue(value: unknown): PropertyValue | undefined {
  if (typeof value === 'string') return value.slice(0, MAX_FILTER_TEXT_LENGTH)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.filter(isId).slice(0, MAX_VIEW_ITEMS)
  if (value && typeof value === 'object') {
    const date = value as { start?: unknown; end?: unknown }
    if (typeof date.start !== 'string' || date.start.length > 40) return undefined
    return typeof date.end === 'string' && date.end.length <= 40 ? { start: date.start, end: date.end } : { start: date.start }
  }
  return undefined
}

/**
 * The views of a linked database view, rebuilt field by field from untrusted JSON.
 * Only shapes are checked here: whether a property id exists in the source's schema
 * is decided when the view is shown, by the database's own normalisation layer.
 */
export function cleanViews(value: unknown): DatabaseView[] {
  if (!Array.isArray(value)) return []
  const out: DatabaseView[] = []
  const seen = new Set<string>()
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_VIEW_ITEMS) : [])
  const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  for (const raw of value.slice(0, MAX_CLIP_VIEWS)) {
    if (!plain(raw) || !isId(raw.id) || seen.has(raw.id)) continue
    if (typeof raw.type !== 'string' || !VIEW_TYPES.includes(raw.type)) continue
    seen.add(raw.id)
    const filters: ViewFilter[] = []
    for (const f of list(raw.filters)) {
      if (!plain(f) || !isId(f.propertyId) || typeof f.operator !== 'string' || !FILTER_OPERATORS.includes(f.operator)) continue
      const filter: ViewFilter = { propertyId: f.propertyId, operator: f.operator as ViewFilter['operator'] }
      const filterValue = cleanFilterValue(f.value)
      if (filterValue !== undefined) filter.value = filterValue
      filters.push(filter)
    }
    const sorts: ViewSort[] = []
    for (const s of list(raw.sorts)) {
      if (plain(s) && isId(s.propertyId)) sorts.push({ propertyId: s.propertyId, direction: s.direction === 'desc' ? 'desc' : 'asc' })
    }
    const view: DatabaseView = {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_VIEW_NAME_LENGTH) : '',
      type: raw.type as DatabaseView['type'],
      visibleProperties: list(raw.visibleProperties).filter(isId),
      filters,
      sorts
    }
    if (plain(raw.propertyWidths)) {
      const widths: Record<string, number> = {}
      for (const key of Object.keys(raw.propertyWidths).slice(0, MAX_VIEW_ITEMS)) {
        const width = raw.propertyWidths[key]
        if (isId(key) && typeof width === 'number' && Number.isFinite(width)) widths[key] = width
      }
      view.propertyWidths = widths
    }
    if (isId(raw.groupBy)) view.groupBy = raw.groupBy
    // Shape only, like everything else here; a chart view without one gets its default when shown.
    const chart = sanitizeChartConfig(raw.chart)
    if (chart) view.chart = chart
    const calcs = sanitizeCalcs(raw.calcs)
    if (calcs) view.calcs = calcs
    out.push(view)
  }
  return out
}

/** Block props whose values have not been validated yet. */
export type UntrustedProps = { readonly [K in keyof BlockProps]?: unknown }

/**
 * Keeps only the props that mean something for `type`, each validated: rich text
 * marks are checked, urls must pass the same allow-lists the renderer uses, and
 * free-form strings are bounded. Unknown keys never get through.
 */
export function cleanProps(type: BlockType, src: UntrustedProps): BlockProps {
  const props: BlockProps = {}
  if (isTextType(type)) {
    if (src.title !== undefined) props.title = parseRichText(src.title)
  } else if (type === 'code') {
    const plain = textOf(parseRichText(src.title))
    if (plain) props.title = [[plain]]
    const language = typeof src.language === 'string' ? src.language.trim().toLowerCase() : ''
    if (language && language.length <= MAX_LANGUAGE_LENGTH && LANGUAGE_RE.test(language)) props.language = language
  } else if (type === 'equation') {
    const plain = textOf(parseRichText(src.title))
    if (plain) props.title = [[plain]]
  }
  if (type === 'to_do' && typeof src.checked === 'boolean') props.checked = src.checked
  if (type === 'toggle' && typeof src.collapsed === 'boolean') props.collapsed = src.collapsed
  if (type === 'callout' && typeof src.icon === 'string' && src.icon && src.icon.length <= MAX_ICON_LENGTH) props.icon = src.icon
  if (type === 'image') {
    if (typeof src.url === 'string' && isSafeImageUrl(src.url)) props.url = src.url
    if (src.caption !== undefined) {
      const caption = textOf(parseRichText(src.caption)).replace(/\n/g, ' ')
      if (caption) props.caption = [[caption]]
    }
  }
  if (type === 'bookmark' && typeof src.url === 'string') {
    const href = sanitizeHref(src.url)
    if (href && !href.toLowerCase().startsWith('mailto:')) props.url = href
  }
  if (type === 'database') {
    // Only a linked view gets here: its link, its views and its title / icon override.
    // Schema, values and anything else a database could carry never do.
    if (isId(src.sourceId)) props.sourceId = src.sourceId
    props.views = cleanViews(src.views)
    const title = textOf(parseRichText(src.title)).replace(/\n/g, ' ')
    if (title) props.title = [[title]]
    if (typeof src.icon === 'string' && src.icon && src.icon.length <= MAX_ICON_LENGTH) props.icon = src.icon
    if (src.beside === true) props.beside = true
    return props
  }
  if (isColorValue(src.color)) props.color = src.color
  return props
}

/**
 * Structural validation of untrusted block JSON: allow-listed types, validated
 * props, bounded depth and node count. Malformed nodes are skipped.
 */
export function parseClipNodes(value: unknown): ClipNode[] {
  let budget = MAX_CLIP_NODES
  const walk = (list: unknown, depth: number): ClipNode[] => {
    if (!Array.isArray(list) || depth >= MAX_CLIP_DEPTH) return []
    const out: ClipNode[] = []
    for (const v of list) {
      if (budget <= 0) break
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue
      const n = v as { type?: unknown; props?: unknown; children?: unknown }
      const src: UntrustedProps = n.props && typeof n.props === 'object' && !Array.isArray(n.props) ? n.props : {}
      if (isLinkedClip(n.type, src)) {
        // A linked view has no children of its own, whatever the payload claims.
        budget--
        out.push({ type: 'database', props: cleanProps('database', src), children: [] })
        continue
      }
      if (!isClipType(n.type)) continue
      budget--
      out.push({ type: n.type, props: cleanProps(n.type, src), children: walk(n.children, depth + 1) })
    }
    return out
  }
  return walk(value, 0)
}

function parseJson(json: string): unknown {
  if (!json || json.length > MAX_CLIP_JSON_LENGTH) return null
  try {
    return JSON.parse(json) as unknown
  } catch {
    return null
  }
}

/** Blocks from a `MIME_BLOCKS` clipboard string; empty when it is missing or invalid. */
export function parseClipboardBlocks(json: string): ClipNode[] {
  return parseClipNodes(parseJson(json))
}

/** Rich text from a `MIME_RICHTEXT` clipboard string; empty when it is missing or invalid. */
export function parseClipboardRichText(json: string): RichText {
  return parseRichText(parseJson(json))
}

/**
 * Snapshot of blocks and their descendants; sub-pages and databases are left out.
 * A linked database view is kept: its copy is another view of the same source.
 */
export function serializeBlocks(get: GetBlock, ids: readonly string[], depth = 0): ClipNode[] {
  if (depth >= MAX_CLIP_DEPTH) return []
  const out: ClipNode[] = []
  for (const id of ids) {
    const b = get(id)
    if (!b) continue
    if (sourceIdOf(b) !== null) {
      out.push({ type: 'database', props: cleanProps('database', b.props), children: [] })
      continue
    }
    if (!isClipType(b.type)) continue
    out.push({ type: b.type, props: cleanProps(b.type, b.props), children: serializeBlocks(get, b.content, depth + 1) })
  }
  return out
}

/** Appends the ops that create `node` and its subtree; returns the id of the new root. */
function buildNode(node: ClipNode, parentId: string, afterId: string | null | undefined, newId: () => string, ops: Op[]): string {
  const id = newId()
  ops.push({ op: 'create', input: { id, type: node.type, parentId, afterId, props: structuredClone(node.props) } })
  let after: string | null = null
  for (const child of node.children) after = buildNode(child, id, after, newId, ops)
  return id
}

/** Ops creating `nodes` one after another under `parentId`, starting after `afterId`. */
export function buildCreateOps(
  nodes: readonly ClipNode[],
  parentId: string,
  afterId: string | null | undefined,
  newId: () => string
): { ops: Op[]; ids: string[] } {
  const ops: Op[] = []
  const ids: string[] = []
  let after = afterId
  for (const node of nodes) {
    after = buildNode(node, parentId, after, newId, ops)
    ids.push(after)
  }
  return { ops, ids }
}

/** Markdown-ish plain text for the system clipboard. */
export function nodesToText(nodes: readonly ClipNode[], depth = 0): string[] {
  const lines: string[] = []
  const pad = '  '.repeat(depth)
  let n = 0
  for (const node of nodes) {
    const t = textOf(node.props.title)
    n = node.type === 'numbered_list' ? n + 1 : 0
    switch (node.type) {
      case 'heading_1':
        lines.push(`${pad}# ${t}`)
        break
      case 'heading_2':
        lines.push(`${pad}## ${t}`)
        break
      case 'heading_3':
        lines.push(`${pad}### ${t}`)
        break
      case 'bulleted_list':
        lines.push(`${pad}- ${t}`)
        break
      case 'numbered_list':
        lines.push(`${pad}${n}. ${t}`)
        break
      case 'to_do':
        lines.push(`${pad}- [${node.props.checked ? 'x' : ' '}] ${t}`)
        break
      case 'quote':
        lines.push(`${pad}> ${t}`)
        break
      case 'code':
        lines.push('```' + (node.props.language ?? ''), t, '```')
        break
      case 'equation':
        lines.push(`${pad}$$`, t, `${pad}$$`)
        break
      case 'divider':
        lines.push('---')
        break
      case 'image':
      case 'bookmark':
        lines.push(`${pad}${node.props.url ?? ''}`)
        break
      default:
        lines.push(`${pad}${t}`)
    }
    lines.push(...nodesToText(node.children, depth + 1))
  }
  return lines
}
