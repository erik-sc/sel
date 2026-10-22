// Comparing two snapshots of a page. Pure (no DOM, no store); unit tested.
//
// Two layers:
//   - `wordDiff`: a Myers diff over word tokens, with a size guard;
//   - `diffSnapshots`: a block-tree diff by id (added / removed / changed / moved), which uses
//     the word diff for the text of changed blocks and lists changed properties.
//
// Direction: `from` is the page as it is now, `to` is the version being looked at. "Added"
// therefore means "in the version, not in the page": what restoring would bring back.
import { canonicalJson, type SnapshotBlock, type SnapshotContent, type SnapshotRow } from '../../../shared/versions'
import { plainText } from '../../../shared/richtext'
import type { BlockType, PropertySchema, PropertyValue } from '@shared/types'

// ------------------------------------------------------------------ word diff

export type WordOpKind = 'equal' | 'insert' | 'delete'

export interface WordOp {
  kind: WordOpKind
  text: string
}

export interface WordDiffLimits {
  /** Combined length of both texts, in UTF-16 code units. */
  chars: number
  /** Combined number of tokens. */
  tokens: number
  /** Number of inserted plus deleted tokens the search goes up to. */
  edits: number
}

export const WORD_DIFF_LIMITS: WordDiffLimits = { chars: 40_000, tokens: 8_000, edits: 1_500 }

type Segmenter = { segment(text: string): Iterable<{ segment: string }> }
let segmenter: Segmenter | null | undefined

function wordSegmenter(): Segmenter | null {
  if (segmenter === undefined) {
    const ctor = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => Segmenter }).Segmenter
    segmenter = typeof ctor === 'function' ? new ctor('und', { granularity: 'word' }) : null
  }
  return segmenter
}

/** Fallback when `Intl.Segmenter` is missing: words, runs of spaces, then whole code points. */
const TOKEN_RE = /[\p{L}\p{N}\p{M}_]+|\s+|[\s\S]/gu

/**
 * Splits text into words, runs of white space and punctuation. Tokens never cut a grapheme
 * cluster in two (an emoji with modifiers or a ZWJ sequence stays whole), and joining them
 * gives the text back.
 */
export function tokenize(text: string): string[] {
  if (!text) return []
  const seg = wordSegmenter()
  if (!seg) return text.match(TOKEN_RE) ?? []
  const out: string[] = []
  for (const part of seg.segment(text)) out.push(part.segment)
  return out
}

function push(out: WordOp[], kind: WordOpKind, text: string): void {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ kind, text })
}

/**
 * Joins edits that only a space separates: "[-ask-]{+send+} [-Ana-]{+the+}" reads better as
 * "[-ask Ana-]{+send the+}". The space goes to both sides, so each still spells its text.
 */
function joinAcrossSpaces(ops: WordOp[]): WordOp[] {
  const out: WordOp[] = []
  let deleted = ''
  let inserted = ''
  let open = false
  let gap = ''
  const flush = (): void => {
    // White space both sides of a replacement end with was not replaced.
    let tail = ''
    if (deleted && inserted) {
      const a = /\s+$/.exec(deleted)?.[0] ?? ''
      const b = /\s+$/.exec(inserted)?.[0] ?? ''
      let n = 0
      while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
      if (n > 0 && n < deleted.length && n < inserted.length) {
        tail = deleted.slice(deleted.length - n)
        deleted = deleted.slice(0, deleted.length - n)
        inserted = inserted.slice(0, inserted.length - n)
      }
    }
    push(out, 'delete', deleted)
    push(out, 'insert', inserted)
    push(out, 'equal', tail + gap)
    deleted = ''
    inserted = ''
    gap = ''
    open = false
  }
  for (const op of ops) {
    if (op.kind === 'equal') {
      if (open && !gap && !op.text.trim()) gap = op.text
      else {
        flush()
        push(out, 'equal', op.text)
      }
      continue
    }
    if (gap) {
      deleted += gap
      inserted += gap
      gap = ''
    }
    open = true
    if (op.kind === 'delete') deleted += op.text
    else inserted += op.text
  }
  flush()
  return out
}

/**
 * The shortest edit script from `from` to `to`, word by word (Myers, O((N+M)·D)).
 * Within a replaced stretch the deleted words come before the inserted ones, and edits
 * separated only by white space are joined into one stretch.
 * Returns null when the texts are too large or too different for a word-level result to be
 * worth its cost: the caller then says "this block changed" without the detail.
 */
export function wordDiff(from: string, to: string, limits: WordDiffLimits = WORD_DIFF_LIMITS): WordOp[] | null {
  if (from === to) return from ? [{ kind: 'equal', text: from }] : []
  if (from.length + to.length > limits.chars) return null
  const a = tokenize(from)
  const b = tokenize(to)
  if (a.length + b.length > limits.tokens) return null

  // Whatever both ends share needs no search.
  let start = 0
  const shortest = Math.min(a.length, b.length)
  while (start < shortest && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  const out: WordOp[] = []
  push(out, 'equal', a.slice(0, start).join(''))

  if (n === 0 || m === 0) {
    push(out, 'delete', a.slice(start, endA).join(''))
    push(out, 'insert', b.slice(start, endB).join(''))
  } else {
    const max = Math.min(n + m, limits.edits)
    // trace[d] holds the furthest x reached on each diagonal k = -d, -d+2 … d after d edits.
    const trace: Int32Array[] = []
    let v = new Int32Array(1)
    let found = -1
    for (let d = 0; d <= max && found < 0; d++) {
      const next = new Int32Array(d + 1)
      for (let i = 0; i <= d; i++) {
        const k = -d + 2 * i
        let x: number
        if (d === 0) x = 0
        else {
          // From diagonal k-1 (a deletion: index i-1 of the previous row) or k+1 (an insertion: index i).
          const down = i < d ? v[i] : -1
          const right = i > 0 ? v[i - 1] + 1 : -1
          x = i === 0 || (i !== d && right <= down) ? down : right
        }
        let y = x - k
        while (x < n && y < m && a[start + x] === b[start + y]) {
          x++
          y++
        }
        next[i] = x
        if (x >= n && y >= m) {
          found = d
          break
        }
      }
      trace.push(next)
      v = next
    }
    if (found < 0) return null

    // Walk back from the end, collecting the edits in reverse.
    const steps: { kind: WordOpKind; token: string }[] = []
    let x = n
    let y = m
    for (let d = found; d > 0; d--) {
      const prev = trace[d - 1]
      const k = x - y
      const i = (k + d) / 2
      const down = i < d ? prev[i] : -1
      const right = i > 0 ? prev[i - 1] + 1 : -1
      const insertion = i === 0 || (i !== d && right <= down)
      const fromX = insertion ? down : right - 1
      const fromY = insertion ? fromX - (k + 1) : fromX - (k - 1)
      const midX = insertion ? fromX : fromX + 1
      while (x > midX) {
        x--
        y--
        steps.push({ kind: 'equal', token: a[start + x] })
      }
      if (insertion) steps.push({ kind: 'insert', token: b[start + fromY] })
      else steps.push({ kind: 'delete', token: a[start + fromX] })
      x = fromX
      y = fromY
    }
    while (x > 0) {
      x--
      steps.push({ kind: 'equal', token: a[start + x] })
    }
    // Forward again; inside a run of edits, deletions are emitted before insertions.
    let deleted = ''
    let inserted = ''
    const flush = (): void => {
      push(out, 'delete', deleted)
      push(out, 'insert', inserted)
      deleted = ''
      inserted = ''
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i]
      if (step.kind === 'equal') {
        flush()
        push(out, 'equal', step.token)
      } else if (step.kind === 'delete') deleted += step.token
      else inserted += step.token
    }
    flush()
  }
  push(out, 'equal', a.slice(endA).join(''))
  return joinAcrossSpaces(out)
}

// ------------------------------------------------------------------ tree diff

export type DiffStatus = 'same' | 'added' | 'removed' | 'changed'

/** One property that differs, in words: what the page has now and what the version has. */
export interface PropChange {
  label: string
  from: string
  to: string
}

export interface BlockChange {
  id: string
  status: DiffStatus
  /** Same block, other parent or other place among its siblings. */
  moved: boolean
  /** Word-level changes of the block's text; absent when the text is the same. */
  text?: WordOp[]
  /** The text changed, but it is too large to compare word by word. */
  textTooLarge?: boolean
  props: PropChange[]
}

export interface CellChange {
  propertyId: string
  from: PropertyValue | undefined
  to: PropertyValue | undefined
}

export interface RowChange {
  id: string
  status: DiffStatus
  moved: boolean
  title?: WordOp[]
  iconChanged: boolean
  cells: CellChange[]
}

export interface DiffCounts {
  added: number
  removed: number
  changed: number
  moved: number
}

export interface TreeDiff {
  blocks: Map<string, BlockChange>
  /**
   * Child ids to show under each parent: the version's order, with the blocks that only the
   * page has slotted in where they are (so that a removed block is seen in place).
   */
  children: Map<string, string[]>
  rows: Map<string, RowChange>
  /** Rows to show: the version's, with the page-only ones where they are. */
  rowOrder: string[]
  /** Changes to the database itself: properties and views. */
  schema: PropChange[]
  counts: DiffCounts
  identical: boolean
}

const TYPE_NAMES: Record<BlockType, string> = {
  page: 'Page',
  text: 'Text',
  heading_1: 'Heading 1',
  heading_2: 'Heading 2',
  heading_3: 'Heading 3',
  bulleted_list: 'Bulleted list',
  numbered_list: 'Numbered list',
  to_do: 'To-do',
  toggle: 'Toggle',
  quote: 'Quote',
  callout: 'Callout',
  code: 'Code',
  divider: 'Divider',
  image: 'Image',
  bookmark: 'Bookmark',
  database: 'Database',
  equation: 'Equation'
}

export function typeName(type: BlockType): string {
  return TYPE_NAMES[type] ?? 'Block'
}

function same(a: unknown, b: unknown): boolean {
  return a === b || canonicalJson(a ?? null) === canonicalJson(b ?? null)
}

function colorName(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Default'
  const background = value.endsWith('_background')
  const name = background ? value.slice(0, -'_background'.length) : value
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${background ? ' background' : ''}`
}

const short = (value: unknown, max = 60): string => {
  const text = typeof value === 'string' ? value : ''
  if (!text) return 'None'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** An icon in words: an emoji shows as itself, a drawn icon by its kind. */
const iconName = (icon: unknown): string => {
  if (typeof icon !== 'string' || !icon) return 'None'
  if (icon.startsWith('shape:')) return 'Shape'
  if (icon.startsWith('icon:')) return `Icon (${icon.slice(5)})`
  return short(icon)
}

/** The word diff of two texts, or the fact that it is not available. */
function textChange(from: string, to: string): Pick<BlockChange, 'text' | 'textTooLarge'> {
  if (from === to) return {}
  const ops = wordDiff(from, to)
  return ops ? { text: ops } : { textTooLarge: true }
}

/** What differs between two states of the same block, apart from its text and its children. */
function propChanges(from: SnapshotBlock, to: SnapshotBlock, isRoot: boolean): PropChange[] {
  const out: PropChange[] = []
  const a = from.props
  const b = to.props
  if (from.type !== to.type) out.push({ label: 'Type', from: typeName(from.type), to: typeName(to.type) })
  if (from.type === 'to_do' || to.type === 'to_do') {
    if (!!a.checked !== !!b.checked)
      out.push({ label: 'To-do', from: a.checked ? 'Checked' : 'Unchecked', to: b.checked ? 'Checked' : 'Unchecked' })
  }
  if (from.type === 'toggle' || to.type === 'toggle') {
    if (!!a.collapsed !== !!b.collapsed)
      out.push({ label: 'Toggle', from: a.collapsed ? 'Collapsed' : 'Open', to: b.collapsed ? 'Collapsed' : 'Open' })
  }
  if ((a.color ?? '') !== (b.color ?? '')) out.push({ label: 'Colour', from: colorName(a.color), to: colorName(b.color) })
  if ((a.language ?? '') !== (b.language ?? ''))
    out.push({
      label: 'Language',
      from: short(a.language) === 'None' ? 'Plain text' : short(a.language),
      to: short(b.language) === 'None' ? 'Plain text' : short(b.language)
    })
  if ((a.icon ?? '') !== (b.icon ?? '')) {
    out.push({ label: 'Icon', from: iconName(a.icon), to: iconName(b.icon) })
  }
  if ((a.url ?? '') !== (b.url ?? '')) out.push({ label: to.type === 'image' ? 'Image' : 'Link', from: short(a.url), to: short(b.url) })
  if ((a.cover ?? '') !== (b.cover ?? ''))
    out.push({ label: 'Cover', from: a.cover ? 'Set' : 'None', to: b.cover ? (a.cover ? 'Changed' : 'Set') : 'None' })
  if (isRoot && !!a.fullWidth !== !!b.fullWidth)
    out.push({ label: 'Width', from: a.fullWidth ? 'Full width' : 'Default', to: b.fullWidth ? 'Full width' : 'Default' })
  const captionFrom = plainText(a.caption)
  const captionTo = plainText(b.caption)
  if (captionFrom !== captionTo) out.push({ label: 'Caption', from: short(captionFrom), to: short(captionTo) })
  if (!!a.beside !== !!b.beside) {
    const place = (beside: boolean | undefined): string => (beside ? 'Beside the block before' : 'Below the block before')
    out.push({ label: 'Place', from: place(a.beside), to: place(b.beside) })
  }
  if ((a.sourceId ?? '') !== (b.sourceId ?? ''))
    out.push({ label: 'Source database', from: a.sourceId ? 'Another database' : 'None', to: b.sourceId ? 'This database' : 'None' })
  if (plainText(a.title) === plainText(b.title) && !same(a.title ?? [], b.title ?? [])) {
    out.push({ label: 'Formatting', from: 'Current formatting', to: 'Formatting of this version' })
  }
  if (isRoot && a.values !== undefined && !same(a.values, b.values))
    out.push({ label: 'Properties', from: 'Current values', to: 'Values of this version' })
  return out
}

const PROPERTY_TYPE_NAMES: Record<string, string> = {
  title: 'Title',
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'Link',
  created_time: 'Created time',
  last_edited_time: 'Last edited time',
  relation: 'Relation',
  rollup: 'Rollup',
  formula: 'Formula'
}

/** Properties added, removed, renamed or retyped, and whether the views differ. */
function schemaChanges(from: SnapshotBlock, to: SnapshotBlock): PropChange[] {
  const out: PropChange[] = []
  const a = (from.props.schema ?? {}) as Record<string, PropertySchema | undefined>
  const b = (to.props.schema ?? {}) as Record<string, PropertySchema | undefined>
  for (const id of Object.keys(b)) {
    const next = b[id]
    const prev = Object.hasOwn(a, id) ? a[id] : undefined
    if (!next) continue
    if (!prev) out.push({ label: 'Property', from: 'Not there', to: next.name })
    else if (prev.name !== next.name) out.push({ label: 'Property name', from: prev.name, to: next.name })
    else if (prev.type !== next.type) {
      out.push({ label: next.name, from: PROPERTY_TYPE_NAMES[prev.type] ?? prev.type, to: PROPERTY_TYPE_NAMES[next.type] ?? next.type })
    } else if (next.type === 'formula' && !same(prev.formula, next.formula)) {
      out.push({ label: next.name, from: 'Current formula', to: 'Formula of this version' })
    } else if (!same(prev, next)) out.push({ label: next.name, from: 'Current options', to: 'Options of this version' })
  }
  for (const id of Object.keys(a)) {
    const prev = a[id]
    if (prev && !Object.hasOwn(b, id)) out.push({ label: 'Property', from: prev.name, to: 'Not there' })
  }
  if (!same(Object.keys(a), Object.keys(b)) && Object.keys(a).length === Object.keys(b).length && !out.length) {
    out.push({ label: 'Property order', from: 'Current order', to: 'Order of this version' })
  }
  const viewsFrom = Array.isArray(from.props.views) ? from.props.views : []
  const viewsTo = Array.isArray(to.props.views) ? to.props.views : []
  if (!same(viewsFrom, viewsTo)) {
    const names = (views: { name?: string }[]): string => views.map((v) => v.name || 'Untitled').join(', ') || 'None'
    out.push({ label: 'Views', from: names(viewsFrom), to: names(viewsTo) })
  }
  return out
}

/** Members of `order` that keep their relative order in `reference` (a longest common subsequence). */
function stable(order: string[], reference: string[]): Set<string> {
  const position = new Map(reference.map((id, index) => [id, index]))
  const seq = order.filter((id) => position.has(id))
  // Longest increasing subsequence of the reference positions, by patience sorting.
  const tails: number[] = []
  const tailIndex: number[] = []
  const previous: number[] = new Array(seq.length).fill(-1)
  seq.forEach((id, index) => {
    const value = position.get(id) as number
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid] < value) lo = mid + 1
      else hi = mid
    }
    tails[lo] = value
    tailIndex[lo] = index
    previous[index] = lo > 0 ? tailIndex[lo - 1] : -1
  })
  const keep = new Set<string>()
  for (let index = tails.length ? tailIndex[tails.length - 1] : -1; index >= 0; index = previous[index]) keep.add(seq[index])
  return keep
}

/**
 * `to` with the members of `from` it lacks put where they are in `from`: each right after
 * the nearest earlier sibling that `to` also has (or first).
 */
function mergeOrder(to: string[], from: string[], isExtra: (id: string) => boolean): string[] {
  const out = [...to]
  const inTo = new Set(to)
  let anchor = -1
  for (const id of from) {
    if (inTo.has(id)) {
      anchor = out.indexOf(id)
      continue
    }
    if (!isExtra(id)) continue
    out.splice(anchor + 1, 0, id)
    anchor += 1
  }
  return out
}

export function diffSnapshots(from: SnapshotContent, to: SnapshotContent): TreeDiff {
  const fromBlocks = new Map(from.blocks.map((b) => [b.id, b]))
  const fromRefs = new Set(from.refs.map((r) => r.id))
  const toRefs = new Set(to.refs.map((r) => r.id))
  const fromRoot = from.blocks[0]
  const toRoot = to.blocks[0]
  const counts: DiffCounts = { added: 0, removed: 0, changed: 0, moved: 0 }
  const blocks = new Map<string, BlockChange>()
  const children = new Map<string, string[]>()

  const parentIn = (content: SnapshotContent): Map<string, string> => {
    const out = new Map<string, string>()
    for (const b of content.blocks) for (const child of b.content) out.set(child, b.id === content.rootId ? '' : b.id)
    return out
  }
  // The roots are "the same block" even when a version is shown against another page's state.
  const fromParent = parentIn(from)
  const toParent = parentIn(to)

  // ---- blocks of the version: same, changed, added
  for (const b of to.blocks) {
    const isRoot = b.id === toRoot.id
    const prev = isRoot ? fromRoot : fromBlocks.get(b.id)
    if (!prev || (!isRoot && prev.id === fromRoot.id)) {
      blocks.set(b.id, { id: b.id, status: 'added', moved: false, props: [] })
      counts.added++
      continue
    }
    const change: BlockChange = { id: b.id, status: 'same', moved: false, props: propChanges(prev, b, isRoot) }
    Object.assign(change, textChange(plainText(prev.props.title), plainText(b.props.title)))
    if (change.text || change.textTooLarge || change.props.length) change.status = 'changed'
    // Anything else that differs (a prop this module has no words for) still counts as a change.
    else if (prev.type !== b.type || !same(withoutLists(prev.props), withoutLists(b.props))) change.status = 'changed'
    if (!isRoot && fromParent.get(b.id) !== toParent.get(b.id)) change.moved = true
    blocks.set(b.id, change)
  }
  // ---- nested pages and databases: references on both sides
  for (const id of toRefs) {
    if (fromRefs.has(id)) blocks.set(id, { id, status: 'same', moved: fromParent.get(id) !== toParent.get(id), props: [] })
    else {
      blocks.set(id, { id, status: 'added', moved: false, props: [] })
      counts.added++
    }
  }
  // ---- what only the page has: removed blocks; nested pages are never removed, they move to the end
  const kept: string[] = []
  for (const b of from.blocks) {
    if (b.id === fromRoot.id || blocks.has(b.id)) continue
    blocks.set(b.id, { id: b.id, status: 'removed', moved: false, props: [] })
    counts.removed++
  }
  for (const id of fromRefs) {
    if (blocks.has(id)) continue
    blocks.set(id, { id, status: 'same', moved: true, props: [] })
    kept.push(id)
  }

  // ---- order: moved among siblings, and the merged child lists
  const removed = (id: string): boolean => blocks.get(id)?.status === 'removed'
  for (const b of to.blocks) {
    const prev = b.id === toRoot.id ? fromRoot : fromBlocks.get(b.id)
    const before = prev ? prev.content : []
    const steady = stable(b.content, before)
    for (const id of b.content) {
      const change = blocks.get(id)
      if (change && change.status !== 'added' && !change.moved && before.includes(id) && !steady.has(id)) change.moved = true
    }
    const merged = mergeOrder(b.content, before, removed)
    children.set(b.id, b.id === toRoot.id ? [...merged, ...kept] : merged)
  }
  // Children of removed blocks are shown under them, as the page has them.
  for (const b of from.blocks) {
    if (removed(b.id))
      children.set(
        b.id,
        b.content.filter((id) => removed(id))
      )
  }
  for (const change of blocks.values()) {
    if (change.status === 'changed') counts.changed++
    else if (change.status === 'same' && change.moved) counts.moved++
  }

  // ---- rows of a database
  const rows = new Map<string, RowChange>()
  let rowOrder: string[] = []
  const schema = toRoot.type === 'database' && fromRoot.type === 'database' ? schemaChanges(fromRoot, toRoot) : []
  if (to.rows || from.rows) {
    const fromRows = new Map((from.rows ?? []).map((r) => [r.id, r]))
    const toRows = to.rows ?? []
    const fromOrder = (from.rows ?? []).map((r) => r.id)
    const toOrder = toRows.map((r) => r.id)
    const steady = stable(toOrder, fromOrder)
    const properties = new Set([...Object.keys(toRoot.props.schema ?? {}), ...Object.keys(fromRoot.props.schema ?? {})])
    for (const row of toRows) {
      const prev = fromRows.get(row.id)
      if (!prev) {
        rows.set(row.id, { id: row.id, status: 'added', moved: false, iconChanged: false, cells: [] })
        counts.added++
        continue
      }
      const change = rowChange(prev, row, properties)
      change.moved = !steady.has(row.id)
      if (change.status === 'changed') counts.changed++
      else if (change.moved) counts.moved++
      rows.set(row.id, change)
    }
    // Rows made since the version are kept by a restore, after the version's rows.
    const later = fromOrder.filter((id) => !rows.has(id))
    for (const id of later) rows.set(id, { id, status: 'same', moved: false, iconChanged: false, cells: [] })
    rowOrder = [...toOrder, ...later]
  }

  const rootChange = blocks.get(toRoot.id)
  if (rootChange && schema.length && rootChange.status === 'same') {
    rootChange.status = 'changed'
    counts.changed++
  }
  const identical = counts.added + counts.removed + counts.changed + counts.moved === 0
  return { blocks, children, rows, rowOrder, schema, counts, identical }
}

/** Props compared for "is this block the same": everything but what the database comparison words itself. */
function withoutLists(props: SnapshotBlock['props']): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...props }
  delete rest['schema']
  delete rest['views']
  return rest
}

function rowChange(from: SnapshotRow, to: SnapshotRow, properties: Set<string>): RowChange {
  const change: RowChange = { id: to.id, status: 'same', moved: false, iconChanged: (from.icon ?? '') !== (to.icon ?? ''), cells: [] }
  const titleFrom = plainText(from.title)
  const titleTo = plainText(to.title)
  if (titleFrom !== titleTo)
    change.title = wordDiff(titleFrom, titleTo) ?? [
      { kind: 'delete', text: titleFrom },
      { kind: 'insert', text: titleTo }
    ]
  for (const id of properties) {
    const a = Object.hasOwn(from.values, id) ? from.values[id] : undefined
    const b = Object.hasOwn(to.values, id) ? to.values[id] : undefined
    if (!same(emptyToNull(a), emptyToNull(b))) change.cells.push({ propertyId: id, from: a, to: b })
  }
  if (change.title || change.iconChanged || change.cells.length) change.status = 'changed'
  return change
}

/** An unset cell, an empty text and an empty selection all show as an empty cell. */
function emptyToNull(value: PropertyValue | undefined): PropertyValue {
  if (value === undefined || value === null || value === '') return null
  if (Array.isArray(value) && value.length === 0) return null
  return value
}

/** "3 blocks changed, 1 added, 2 removed, 1 moved", or the fact that nothing differs. */
export function summarize(counts: DiffCounts, noun = 'block'): string {
  const parts: string[] = []
  const plural = (n: number): string => (n === 1 ? noun : `${noun}s`)
  if (counts.changed) parts.push(`${counts.changed} ${plural(counts.changed)} changed`)
  if (counts.added) parts.push(parts.length ? `${counts.added} added` : `${counts.added} ${plural(counts.added)} added`)
  if (counts.removed) parts.push(parts.length ? `${counts.removed} removed` : `${counts.removed} ${plural(counts.removed)} removed`)
  if (counts.moved) parts.push(parts.length ? `${counts.moved} moved` : `${counts.moved} ${plural(counts.moved)} moved`)
  return parts.length ? parts.join(', ') : 'No differences'
}
