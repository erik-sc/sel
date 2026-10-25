// Tree navigation and structural edits (split, merge, indent, move, drop...).
// Everything here is pure: it reads blocks through a getter and returns the ops
// to commit, so the rules can be unit tested without a DOM.
import type { Block, BlockProps, BlockType, Op, RichText } from '@shared/types'
import type { GetBlock } from './ops'
import { DEFAULT_CALLOUT_ICON, continuesOnEnter, isPlainTextType, isTextType } from './blockTypes'
import { MAX_BESIDE, canShareRow, rowsOf } from './layout'
import { concat, rtLength, slice, textOf } from './richtext-dom'
import { END, textSel, type DropTarget, type Place, type PropsPatch, type Sel } from './types'

export interface Tree {
  pageId: string
  get: GetBlock
}

/** What a key press on the block structure resolves to. */
export type Plan =
  | { do: 'commit'; ops: Op[]; after: Sel }
  | { do: 'turnText' }
  | { do: 'outdent' }
  | { do: 'focus'; id: string; where: 'start' | 'end' }
  | { do: 'select'; id: string }
  | null

function titleOf(b: Block | undefined): RichText {
  return b?.props.title ?? []
}

function isContainer(b: Block): boolean {
  return b.type === 'page' || b.type === 'database'
}

/** True for blocks that hold the caret (rich text, code or an equation's TeX). */
export function isEditable(b: Block): boolean {
  return isTextType(b.type) || isPlainTextType(b.type)
}

// ---- navigation ----------------------------------------------------------

/** Child ids that are part of the document (trashed sub-pages stay in `content`). */
export function liveChildren(tree: Tree, b: Block | undefined): string[] {
  if (!b) return []
  return b.content.filter((c) => {
    const child = tree.get(c)
    return !!child && !child.trashedAt
  })
}

/** Children rendered under the block: none for sub-pages, databases and collapsed toggles. */
export function visibleChildren(tree: Tree, b: Block | undefined): string[] {
  if (!b || isContainer(b)) return []
  if (b.type === 'toggle' && b.props.collapsed) return []
  return liveChildren(tree, b)
}

/** Visible blocks of the page in document order. */
export function order(tree: Tree): string[] {
  const out: string[] = []
  const walk = (ids: string[]): void => {
    for (const id of ids) {
      out.push(id)
      walk(visibleChildren(tree, tree.get(id)))
    }
  }
  walk(liveChildren(tree, tree.get(tree.pageId)))
  return out
}

export function siblings(tree: Tree, id: string): string[] {
  const b = tree.get(id)
  return liveChildren(tree, b?.parentId ? tree.get(b.parentId) : undefined)
}

export function prevSibling(tree: Tree, id: string, skip?: ReadonlySet<string>): string | null {
  const sib = siblings(tree, id)
  for (let i = sib.indexOf(id) - 1; i >= 0; i--) if (!skip?.has(sib[i])) return sib[i]
  return null
}

export function nextSibling(tree: Tree, id: string): string | null {
  const sib = siblings(tree, id)
  const i = sib.indexOf(id)
  return i >= 0 && i + 1 < sib.length ? sib[i + 1] : null
}

/** The block above in document order; the page itself (its title) above the first block. */
export function prevVisible(tree: Tree, id: string): string | null {
  if (id === tree.pageId) return null
  const b = tree.get(id)
  if (!b) return tree.pageId
  let cur = prevSibling(tree, id)
  if (!cur) return b.parentId ?? tree.pageId
  for (;;) {
    const kids = visibleChildren(tree, tree.get(cur))
    if (!kids.length) return cur
    cur = kids[kids.length - 1]
  }
}

/** The block below in document order, or null after the last one. */
export function nextVisible(tree: Tree, id: string): string | null {
  if (id === tree.pageId) return liveChildren(tree, tree.get(id))[0] ?? null
  const kids = visibleChildren(tree, tree.get(id))
  if (kids.length) return kids[0]
  let cur: string | null = id
  while (cur && cur !== tree.pageId) {
    const next = nextSibling(tree, cur)
    if (next) return next
    cur = tree.get(cur)?.parentId ?? null
  }
  return null
}

/** True when `ancestor` is on the parent chain of `id` (within this page). */
export function isDescendant(tree: Tree, id: string, ancestor: string): boolean {
  const seen = new Set<string>()
  for (let b = tree.get(id); b && b.parentId && !seen.has(b.id); b = tree.get(b.parentId)) {
    if (b.parentId === ancestor) return true
    if (b.id === tree.pageId) break
    seen.add(b.id)
  }
  return false
}

/** Drops ids whose ancestor is also in the list; returns the rest in document order. */
export function topLevel(tree: Tree, ids: readonly string[]): string[] {
  const set = new Set(ids)
  const hasSelectedAncestor = (id: string): boolean => {
    const seen = new Set<string>([id])
    for (let p = tree.get(id)?.parentId; p && p !== tree.pageId && !seen.has(p); p = tree.get(p)?.parentId) {
      if (set.has(p)) return true
      seen.add(p)
    }
    return false
  }
  const tops = [...set].filter((id) => tree.get(id) && !hasSelectedAncestor(id))
  if (tops.length < 2) return tops
  const index = new Map(order(tree).map((id, i) => [id, i]))
  return tops.sort((a, b) => (index.get(a) ?? -1) - (index.get(b) ?? -1))
}

// ---- columns: the heads of a row ------------------------------------------

/**
 * The row (layout.ts) that `id` heads a column of: two or more of the page's own blocks drawn side
 * by side, `id` among them. Null for a block in no row, a block alone in its row, or a nested one.
 */
export function rowOfHead(tree: Tree, id: string): Block[] | null {
  if (tree.get(id)?.parentId !== tree.pageId) return null
  const row = pageRowOf(tree, id)?.row
  return row && row.length > 1 ? row : null
}

/** Whether `id` sits right under a column's head: one of the lines of that column below its head. */
function inColumn(tree: Tree, id: string): boolean {
  const parentId = tree.get(id)?.parentId
  return !!parentId && parentId !== tree.pageId && !!rowOfHead(tree, parentId)
}

/** The ids of every column's head on the page (rows of two or more), from one pass over its blocks. */
function rowHeads(tree: Tree): Set<string> {
  const kids = liveChildren(tree, tree.get(tree.pageId))
    .map(tree.get)
    .filter((b): b is Block => !!b)
  const heads = new Set<string>()
  for (const row of rowsOf(kids, { top: true })) if (row.length > 1) for (const b of row) heads.add(b.id)
  return heads
}

/**
 * Whether Shift+Tab on `ids` would take them out of a row of columns (outdentOps puts them after
 * it): they are lines right under a column's head. Read before the ops are applied, and only when
 * outdentOps gives some.
 */
export function outdentLeavesRow(tree: Tree, ids: readonly string[]): boolean {
  const first = topLevel(tree, ids)[0]
  return !!first && inColumn(tree, first)
}

/** Head types whose children are drawn indented under them in a column (editor.css), so they stay theirs. */
const HOLDS_ITS_CHILDREN: ReadonlySet<BlockType> = new Set<BlockType>(['toggle', 'bulleted_list', 'numbered_list', 'to_do'])

// ---- text structure: split and merge -------------------------------------

/**
 * Enter in a text block.
 *
 * The text after the caret always lands directly below the text before it:
 * - a block that shows children, or the head of a column, gets the new block as its *first
 *   child* (so the existing children are never left behind above the text that was split off,
 *   and a column's new line stays in the column instead of splitting the row);
 * - otherwise the new block is the next sibling.
 * The children always stay with the original block. Enter on an empty block
 * resets its type or, when it is the last nested one, lifts it out one level (out of the row,
 * for the last line of a column: outdentOps).
 */
export function splitPlan(tree: Tree, id: string, start: number, end: number, newId: () => string): Plan {
  const b = tree.get(id)
  if (!b || !b.parentId) return null
  const title = titleOf(b)
  const len = rtLength(title)
  const nested = b.parentId !== tree.pageId
  if (len === 0) {
    const last = !nextSibling(tree, id)
    if (b.type !== 'text') return nested && continuesOnEnter(b.type) && last ? { do: 'outdent' } : { do: 'turnText' }
    if (nested && last) return { do: 'outdent' }
  }
  const row = nested ? null : rowOfHead(tree, id)
  const from = Math.max(0, Math.min(start, end, len))
  const to = Math.min(len, Math.max(start, end))
  const type: BlockType = continuesOnEnter(b.type) ? b.type : 'text'
  const fresh = (t: BlockType): BlockProps => (t === 'to_do' ? { checked: false } : {})
  const id2 = newId()
  if (from === 0 && to === 0 && len > 0) {
    if (row) return headStartPlan(tree, b, row, id2, fresh(type), type)
    // Caret at the very start: push the block down by inserting an empty one above.
    return {
      do: 'commit',
      ops: [{ op: 'create', input: { id: id2, type, parentId: b.parentId, afterId: prevSibling(tree, id), props: fresh(type) } }],
      after: textSel(id, 0)
    }
  }
  const ops: Op[] = []
  if (from < len) ops.push({ op: 'update', id, patch: { props: { title: slice(title, 0, from) } } })
  const right = slice(title, to)
  if (row || visibleChildren(tree, b).length > 0) {
    const childType: BlockType = b.type === 'toggle' ? 'text' : type
    // A collapsed toggle heading a column opens, so the new line is seen where it is typed.
    if (b.type === 'toggle' && b.props.collapsed) ops.push({ op: 'update', id, patch: { props: { collapsed: false } } })
    ops.push({
      op: 'create',
      input: { id: id2, type: childType, parentId: id, afterId: null, props: { ...fresh(childType), title: right } }
    })
  } else {
    ops.push({ op: 'create', input: { id: id2, type, parentId: b.parentId, afterId: id, props: { ...fresh(type), title: right } } })
  }
  return { do: 'commit', ops, after: textSel(id2, 0) }
}

/**
 * Enter at the very start of a column's head: the empty line goes above it inside the column. The
 * new block takes the head's place in the row (and its `beside`), the head becomes its first child
 * and the head's children follow it there, flush at the column's edge, so the column reads as before
 * with an empty line on top. A toggle, list item or to-do keeps its children, which are drawn
 * indented under it (HOLDS_ITS_CHILDREN). The next column keeps its place beside the new head.
 * Backspace in the new empty head undoes it (liftFirstLinePlan).
 */
function headStartPlan(tree: Tree, b: Block, row: readonly Block[], id2: string, props: BlockProps, type: BlockType): Plan {
  const beside = b.props.beside === true
  const ops: Op[] = [
    {
      op: 'create',
      input: { id: id2, type, parentId: tree.pageId, afterId: prevSibling(tree, b.id), props: beside ? { ...props, beside: true } : props }
    },
    { op: 'move', id: b.id, parentId: id2, afterId: null }
  ]
  if (beside) ops.push({ op: 'update', id: b.id, patch: { props: { beside: null } } })
  if (!HOLDS_ITS_CHILDREN.has(b.type)) {
    let after = b.id
    for (const c of b.content) {
      ops.push({ op: 'move', id: c, parentId: id2, afterId: after })
      after = c
    }
  }
  const next = row[row.findIndex((x) => x.id === b.id) + 1]
  if (next) ops.push({ op: 'update', id: next.id, patch: { props: { beside: true } } })
  return { do: 'commit', ops, after: textSel(b.id, 0) }
}

/**
 * Backspace at the start of an empty head whose first line holds text: the reverse of
 * headStartPlan. The head goes, its first line takes its place in the row (with its `beside`) and
 * the head's other lines follow under that line, so they keep their column; the next column keeps
 * its place beside it. The caret goes to the start of that line. Null when the head is not empty,
 * its first line is not text, or that line is a toggle, list item or to-do (HOLDS_ITS_CHILDREN)
 * and the head has other lines: under it they would be indented, or hidden in a collapsed toggle.
 * Enter at the start of such a head leaves it as the new head's only line, so the round trip holds.
 */
function liftFirstLinePlan(tree: Tree, b: Block, row: readonly Block[]): Plan {
  const live = liveChildren(tree, b)
  const fb = live.length > 0 ? tree.get(live[0]) : undefined
  if (!fb || !isTextType(fb.type) || rtLength(titleOf(b)) > 0) return null
  // A toggle, list item or to-do draws what it holds indented (or hidden, when collapsed): the
  // head's other lines would stop reading as the column, so only the caret moves.
  if (HOLDS_ITS_CHILDREN.has(fb.type) && live.length > 1) return null
  const ops: Op[] = [{ op: 'move', id: fb.id, parentId: tree.pageId, afterId: b.id }]
  if (b.props.beside === true) ops.push({ op: 'update', id: fb.id, patch: { props: { beside: true } } })
  else if (fb.props.beside === true) ops.push({ op: 'update', id: fb.id, patch: { props: { beside: null } } })
  let after: string | null = fb.content[fb.content.length - 1] ?? null
  for (const c of b.content) {
    if (c === fb.id) continue
    ops.push({ op: 'move', id: c, parentId: fb.id, afterId: after })
    after = c
  }
  ops.push({ op: 'delete', id: b.id })
  const next = row[row.findIndex((x) => x.id === b.id) + 1]
  if (next) ops.push({ op: 'update', id: next.id, patch: { props: { beside: true } } })
  return { do: 'commit', ops, after: textSel(fb.id, 0) }
}

/** Moves the children of `b` out so they follow it as siblings (used before deleting it). */
export function hoistChildrenOps(b: Block): Op[] {
  const ops: Op[] = []
  let after = b.id
  for (const c of b.content) {
    ops.push({ op: 'move', id: c, parentId: b.parentId, afterId: after })
    after = c
  }
  return ops
}

/**
 * Backspace with the caret at the start of a text block.
 *
 * In a row of columns, a head is never merged into another block: an empty head with nothing
 * under it is deleted (the row closes up, layout.ts's repair) and the caret goes to the end of the
 * block above in reading order; an empty head whose first line holds text gives its place to that
 * line (liftFirstLinePlan, so Enter then Backspace at the start of a column cancel out); any other
 * head only moves the caret there. The last line of a
 * column merges into the line above it, like a block at the top of the page, instead of being
 * lifted out of the column.
 */
export function backspacePlan(tree: Tree, id: string): Plan {
  const b = tree.get(id)
  if (!b) return null
  if (b.type !== 'text') return { do: 'turnText' }
  if (b.parentId !== tree.pageId && !nextSibling(tree, id) && !inColumn(tree, id)) return { do: 'outdent' }
  const prev = prevVisible(tree, id)
  if (!prev) return null
  const pb = prev === tree.pageId ? undefined : tree.get(prev)
  const mine = titleOf(b)
  const empty = rtLength(mine) === 0
  const row = rowOfHead(tree, id)
  if (row) {
    const lifted = empty ? liftFirstLinePlan(tree, b, row) : null
    if (lifted) return lifted
    if (!empty || b.content.length > 0) return { do: 'focus', id: prev, where: 'end' }
    const after: Sel = !pb || isEditable(pb) ? textSel(prev, END) : { kind: 'blocks', ids: [prev] }
    return { do: 'commit', ops: [{ op: 'delete', id }], after }
  }
  if (prev === tree.pageId) return { do: 'focus', id: prev, where: 'end' }
  if (!pb) return null
  if (isTextType(pb.type)) {
    const theirs = titleOf(pb)
    const ops: Op[] = []
    if (!empty) ops.push({ op: 'update', id: prev, patch: { props: { title: concat(theirs, mine) } } })
    ops.push(...hoistChildrenOps(b), { op: 'delete', id })
    return { do: 'commit', ops, after: textSel(prev, rtLength(theirs)) }
  }
  if (empty && b.content.length === 0) {
    return {
      do: 'commit',
      ops: [{ op: 'delete', id }],
      after: isPlainTextType(pb.type) ? textSel(prev, END) : { kind: 'blocks', ids: [prev] }
    }
  }
  return { do: 'focus', id: prev, where: 'end' }
}

/**
 * Delete with the caret at the end of a text block: pulls the next block's text in. A column's
 * head is never pulled in (the end of one column, or the block above a row): nothing happens.
 */
export function deleteForwardPlan(tree: Tree, id: string): Plan {
  const b = tree.get(id)
  const next = nextVisible(tree, id)
  const nb = next ? tree.get(next) : undefined
  if (!b || !next || !nb) return null
  if (!isTextType(nb.type)) return { do: 'select', id: next }
  if (rowOfHead(tree, next)) return null
  const mine = titleOf(b)
  const theirs = titleOf(nb)
  const ops: Op[] = []
  if (rtLength(theirs) > 0) ops.push({ op: 'update', id, patch: { props: { title: concat(mine, theirs) } } })
  ops.push(...hoistChildrenOps(nb), { op: 'delete', id: next })
  return { do: 'commit', ops, after: textSel(id, rtLength(mine)) }
}

// ---- block structure: type, indent, move ---------------------------------

/** Props patch that turns `b` into `type`, optionally replacing its title. */
export function turnIntoPatch(b: Block, type: BlockType, title?: RichText): PropsPatch {
  const props: PropsPatch = {}
  if (isPlainTextType(type) || isPlainTextType(b.type)) {
    // Code and equations hold plain text: marks do not survive the conversion in either direction.
    const plain = textOf(title ?? titleOf(b))
    props.title = plain ? [[plain]] : []
  } else if (title !== undefined) props.title = title
  if (b.type === 'to_do' && type !== 'to_do') props.checked = null
  if (b.type === 'code' && type !== 'code') props.language = null
  if (type === 'to_do' && b.type !== 'to_do') props.checked = false
  if (type === 'callout' && !b.props.icon) props.icon = DEFAULT_CALLOUT_ICON
  return props
}

export function turnIntoOps(tree: Tree, ids: readonly string[], type: BlockType): Op[] {
  const ops: Op[] = []
  for (const id of ids) {
    const b = tree.get(id)
    if (!b || b.type === type || !isEditable(b)) continue
    ops.push({ op: 'update', id, patch: { type, props: turnIntoPatch(b, type) } })
  }
  return ops
}

function sameParent(tree: Tree, ids: readonly string[], parentId: string | null): boolean {
  return ids.every((id) => tree.get(id)?.parentId === parentId)
}

/** Tab: the blocks become the last children of the sibling above them. A column's head stays (no ops). */
export function indentOps(tree: Tree, ids: readonly string[]): Op[] {
  const tops = topLevel(tree, ids)
  if (!tops.length) return []
  const heads = rowHeads(tree)
  if (tops.some((id) => heads.has(id))) return []
  const target = prevSibling(tree, tops[0], new Set(tops))
  const tb = target ? tree.get(target) : undefined
  if (!target || !tb || !isTextType(tb.type) || !sameParent(tree, tops, tb.parentId)) return []
  const ops: Op[] = []
  if (tb.type === 'toggle' && tb.props.collapsed) ops.push({ op: 'update', id: target, patch: { props: { collapsed: false } } })
  let after: string | null = tb.content[tb.content.length - 1] ?? null
  for (const id of tops) {
    ops.push({ op: 'move', id, parentId: target, afterId: after })
    after = id
  }
  return ops
}

/**
 * Shift+Tab: the blocks move out to follow their parent. A no-op at the top level. Out of a
 * column (its head is the parent) they follow the whole row, never landing between two columns.
 */
export function outdentOps(tree: Tree, ids: readonly string[]): Op[] {
  const tops = topLevel(tree, ids)
  const first = tops.length ? tree.get(tops[0]) : undefined
  const parent = first?.parentId ? tree.get(first.parentId) : undefined
  if (!first || !parent || parent.id === tree.pageId || !parent.parentId) return []
  if (!sameParent(tree, tops, parent.id)) return []
  const ops: Op[] = []
  const row = rowOfHead(tree, parent.id)
  let after = row ? row[row.length - 1].id : parent.id
  for (const id of tops) {
    ops.push({ op: 'move', id, parentId: parent.parentId, afterId: after })
    after = id
  }
  return ops
}

/** Ctrl+Shift+Arrow: swaps the blocks with the sibling above/below. A no-op at the edges. */
export function moveOps(tree: Tree, ids: readonly string[], dir: -1 | 1): Op[] {
  const tops = topLevel(tree, ids)
  const first = tops.length ? tree.get(tops[0]) : undefined
  if (!first || !sameParent(tree, tops, first.parentId)) return []
  const set = new Set(tops)
  if (dir < 0) {
    const prev = prevSibling(tree, tops[0], set)
    return prev ? [{ op: 'move', id: prev, parentId: first.parentId, afterId: tops[tops.length - 1] }] : []
  }
  const next = nextSibling(tree, tops[tops.length - 1])
  return next ? [{ op: 'move', id: next, parentId: first.parentId, afterId: prevSibling(tree, tops[0], set) }] : []
}

// ---- drag & drop ---------------------------------------------------------

/**
 * Parent and position for a drop target, ignoring the blocks being moved. A place in the list, not
 * in a row: `right` is after the target and `left` before it (moveToOps makes the row).
 */
export function placeForDrop(tree: Tree, drop: DropTarget, moving: ReadonlySet<string> = new Set()): Place | null {
  const t = tree.get(drop.id)
  if (!t || !t.parentId) return null
  if (drop.pos === 'inside') {
    const kids = t.content.filter((c) => !moving.has(c))
    return { parentId: t.id, afterId: kids[kids.length - 1] ?? null }
  }
  if (drop.pos === 'after' || drop.pos === 'right') return { parentId: t.parentId, afterId: t.id }
  return { parentId: t.parentId, afterId: prevSibling(tree, t.id, moving) }
}

/** True when the drop would put a block inside itself or one of its descendants. */
export function isDropIntoSelf(tree: Tree, tops: readonly string[], drop: DropTarget): boolean {
  return tops.includes(drop.id) || tops.some((id) => isDescendant(tree, drop.id, id))
}

/** The page's own blocks, and the row (layout.ts) that holds `id` among them; null when `id` is not one of them. */
function pageRowOf(tree: Tree, id: string): { kids: Block[]; row: Block[] } | null {
  const kids = liveChildren(tree, tree.get(tree.pageId))
    .map(tree.get)
    .filter((b): b is Block => !!b)
  const row = rowsOf(kids, { top: true }).find((r) => r.some((b) => b.id === id))
  return row ? { kids, row } : null
}

/**
 * Whether the dragged blocks `ids` may be dropped beside `targetId`, on its left or right: the
 * target is one of the page's own blocks and may share a row, so may every dragged block, none of
 * them is the target or holds it, and the target's row has room for those of them it does not
 * hold yet (MAX_BESIDE). Dropping beside a nested block is not offered.
 */
export function canDropBeside(tree: Tree, ids: readonly string[], targetId: string): boolean {
  const tops = topLevel(tree, ids)
  const target = tree.get(targetId)
  if (!tops.length || !target || target.parentId !== tree.pageId || !canShareRow(target, true)) return false
  if (isDropIntoSelf(tree, tops, { id: targetId, pos: 'right' })) return false
  if (!tops.every((id) => canShareRow(tree.get(id), true))) return false
  const found = pageRowOf(tree, targetId)
  if (!found) return false
  const moving = new Set(tops)
  return found.row.filter((b) => !moving.has(b.id)).length + tops.length <= MAX_BESIDE
}

/** Whether the slash items "2 columns" and "3 columns" may make a row at the block `id`: it is one of the page's own blocks and in no row. */
export function canMakeColumns(tree: Tree, id: string): boolean {
  if (tree.get(id)?.parentId !== tree.pageId) return false
  return pageRowOf(tree, id)?.row.length === 1
}

/**
 * Ops for the slash items "2 columns" and "3 columns" typed in the block `id`: a row of `count`
 * empty text blocks right after it, or in its place when it holds nothing else: no text (`title`
 * is its text once the slash query is taken out) and nothing under it, whatever its kind (an empty
 * heading or to-do too). Returns the ops and the first
 * column, where the caret goes; null when no row may be made there (`canMakeColumns`).
 */
export function columnsOps(
  tree: Tree,
  id: string,
  title: RichText,
  count: number,
  newId: () => string
): { ops: Op[]; first: string } | null {
  const b = tree.get(id)
  if (!b || !canMakeColumns(tree, id) || count < 2 || count > MAX_BESIDE) return null
  const ops: Op[] = []
  // Nothing else in the block (an empty heading or to-do too, as the design note says): the row takes its place.
  const replace = isTextType(b.type) && rtLength(title) === 0 && b.content.length === 0
  if (!replace) ops.push({ op: 'update', id, patch: { props: { title } } })
  let after = id
  const columns: string[] = []
  for (let i = 0; i < count; i++) {
    const column = newId()
    ops.push({
      op: 'create',
      input: { id: column, type: 'text', parentId: tree.pageId, afterId: after, props: i > 0 ? { beside: true } : {} }
    })
    columns.push(column)
    after = column
  }
  if (replace) ops.push({ op: 'delete', id })
  return { ops, first: columns[0] }
}

/**
 * Where a drop above or below a column of a row lands, so that such a drop never splits the row.
 * Above the first column is above the row. Above another column is beside it, on its left, when
 * the row has room (`canDropBeside`), and above the row when it has not. Below a column that is
 * not the last one is the end of that column (its last child) for a text block, and below the row
 * for any other. Every other drop is returned as it is.
 */
export function dropInRow(tree: Tree, ids: readonly string[], drop: DropTarget): DropTarget {
  if (drop.pos !== 'before' && drop.pos !== 'after') return drop
  if (tree.get(drop.id)?.parentId !== tree.pageId || isDropIntoSelf(tree, topLevel(tree, ids), drop)) return drop
  const row = pageRowOf(tree, drop.id)?.row
  if (!row || row.length < 2) return drop
  const at = row.findIndex((b) => b.id === drop.id)
  if (drop.pos === 'before') {
    if (at === 0) return drop
    return canDropBeside(tree, ids, drop.id) ? { id: drop.id, pos: 'left' } : { id: row[0].id, pos: 'before' }
  }
  if (at === row.length - 1) return drop
  return isTextType(row[at].type) ? { id: drop.id, pos: 'inside' } : { id: row[row.length - 1].id, pos: 'after' }
}

/**
 * Ops putting the blocks `tops` beside the block `drop.id`: right after it, or right before it,
 * taking its place in the row. In the new row every block but the first is marked `beside` and
 * the first is not; the mark is written for each block whose mark or neighbour changes, so the
 * row repair (layout.ts) leaves this row whole and repairs only the rows the blocks left. Empty
 * when the drop is not allowed (`canDropBeside`) or changes nothing.
 */
function besideOps(tree: Tree, tops: readonly string[], drop: DropTarget): Op[] {
  if (!canDropBeside(tree, tops, drop.id)) return []
  const found = pageRowOf(tree, drop.id)
  if (!found) return []
  const { kids, row } = found
  const moving = new Set(tops)
  const stay = row.filter((b) => !moving.has(b.id)).map((b) => b.id)
  const at = stay.indexOf(drop.id) + (drop.pos === 'right' ? 1 : 0)
  const next = [...stay.slice(0, at), ...tops, ...stay.slice(at)]
  if (next.length === row.length && next.every((id, i) => id === row[i].id)) return []

  const ops: Op[] = []
  let after = drop.pos === 'right' ? drop.id : prevSibling(tree, drop.id, moving)
  for (const id of tops) {
    ops.push({ op: 'move', id, parentId: tree.pageId, afterId: after })
    after = id
  }
  const previous = new Map(kids.map((b, i) => [b.id, kids[i - 1]?.id ?? null]))
  next.forEach((id, i) => {
    const beside = i > 0
    const marked = tree.get(id)?.props.beside === true
    if (marked === beside && !moving.has(id) && (!beside || previous.get(id) === next[i - 1])) return
    ops.push({ op: 'update', id, patch: { props: { beside: beside ? true : null } } })
  })
  // The block that now follows the row starts a row of its own, even when it followed the same
  // block before (a row's head dragged beside the block above it).
  const rest = kids.filter((b) => !moving.has(b.id))
  const following = rest[rest.findIndex((b) => b.id === stay[stay.length - 1]) + 1]
  if (following?.props.beside === true) ops.push({ op: 'update', id: following.id, patch: { props: { beside: null } } })
  return ops
}

/** Ops moving `ids` to the drop target; empty when the drop is invalid. */
export function moveToOps(tree: Tree, ids: readonly string[], drop: DropTarget): { ops: Op[]; moved: string[] } {
  const tops = topLevel(tree, ids)
  const none = { ops: [], moved: [] }
  if (!tops.length || isDropIntoSelf(tree, tops, drop)) return none
  if (drop.pos === 'left' || drop.pos === 'right') {
    const ops = besideOps(tree, tops, drop)
    return ops.length ? { ops, moved: tops } : none
  }
  const target = tree.get(drop.id)
  if (drop.pos === 'inside' && (!target || isContainer(target))) return none
  const place = placeForDrop(tree, drop, new Set(tops))
  if (!place) return none
  const ops: Op[] = []
  if (drop.pos === 'inside' && target?.type === 'toggle' && target.props.collapsed) {
    ops.push({ op: 'update', id: target.id, patch: { props: { collapsed: false } } })
  }
  let after = place.afterId
  for (const id of tops) {
    ops.push({ op: 'move', id, parentId: place.parentId, afterId: after })
    after = id
  }
  // Above or below a block of the page is a line of its own, as the drop line shows: the first
  // block dropped never joins the row it lands after (the last column of a row, dragged below it).
  const first = tree.get(tops[0])
  if (drop.pos !== 'inside' && place.parentId === tree.pageId && first?.props.beside === true) {
    ops.push({ op: 'update', id: first.id, patch: { props: { beside: null } } })
  }
  return { ops, moved: tops }
}

// ---- redo ----------------------------------------------------------------

/**
 * Undoing the creation of a page/database only sends it to the trash (containers
 * are never hard-deleted), so redo must restore it rather than create it again.
 */
export function redoPlan(ops: readonly Op[], get: GetBlock): { restore: string[]; ops: Op[] } {
  const restore: string[] = []
  const rest: Op[] = []
  for (const op of ops) {
    const existing = op.op === 'create' && op.input.id ? get(op.input.id) : undefined
    if (existing) {
      if (existing.trashedAt) restore.push(existing.id)
    } else rest.push(op)
  }
  return { restore, ops: rest }
}
