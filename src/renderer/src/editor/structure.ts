// Tree navigation and structural edits (split, merge, indent, move, drop...).
// Everything here is pure: it reads blocks through a getter and returns the ops
// to commit, so the rules can be unit tested without a DOM.
import type { Block, BlockProps, BlockType, Op, RichText } from '@shared/types'
import type { GetBlock } from './ops'
import { DEFAULT_CALLOUT_ICON, continuesOnEnter, isTextType } from './blockTypes'
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

/** True for blocks that hold the caret (rich text or code). */
export function isEditable(b: Block): boolean {
  return isTextType(b.type) || b.type === 'code'
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

// ---- text structure: split and merge -------------------------------------

/**
 * Enter in a text block.
 *
 * The text after the caret always lands directly below the text before it:
 * - a block that shows children gets the new block as its *first child* (so the
 *   existing children are never left behind above the text that was split off);
 * - otherwise the new block is the next sibling.
 * The children always stay with the original block. Enter on an empty block
 * resets its type or, when it is the last nested one, lifts it out one level.
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
  const from = Math.max(0, Math.min(start, end, len))
  const to = Math.min(len, Math.max(start, end))
  const type: BlockType = continuesOnEnter(b.type) ? b.type : 'text'
  const fresh = (t: BlockType): BlockProps => (t === 'to_do' ? { checked: false } : {})
  const id2 = newId()
  if (from === 0 && to === 0 && len > 0) {
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
  if (visibleChildren(tree, b).length > 0) {
    const childType: BlockType = b.type === 'toggle' ? 'text' : type
    ops.push({ op: 'create', input: { id: id2, type: childType, parentId: id, afterId: null, props: { ...fresh(childType), title: right } } })
  } else {
    ops.push({ op: 'create', input: { id: id2, type, parentId: b.parentId, afterId: id, props: { ...fresh(type), title: right } } })
  }
  return { do: 'commit', ops, after: textSel(id2, 0) }
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

/** Backspace with the caret at the start of a text block. */
export function backspacePlan(tree: Tree, id: string): Plan {
  const b = tree.get(id)
  if (!b) return null
  if (b.type !== 'text') return { do: 'turnText' }
  if (b.parentId !== tree.pageId && !nextSibling(tree, id)) return { do: 'outdent' }
  const prev = prevVisible(tree, id)
  if (!prev) return null
  if (prev === tree.pageId) return { do: 'focus', id: prev, where: 'end' }
  const pb = tree.get(prev)
  if (!pb) return null
  const mine = titleOf(b)
  const empty = rtLength(mine) === 0
  if (isTextType(pb.type)) {
    const theirs = titleOf(pb)
    const ops: Op[] = []
    if (!empty) ops.push({ op: 'update', id: prev, patch: { props: { title: concat(theirs, mine) } } })
    ops.push(...hoistChildrenOps(b), { op: 'delete', id })
    return { do: 'commit', ops, after: textSel(prev, rtLength(theirs)) }
  }
  if (empty && b.content.length === 0) {
    return { do: 'commit', ops: [{ op: 'delete', id }], after: pb.type === 'code' ? textSel(prev, END) : { kind: 'blocks', ids: [prev] } }
  }
  return { do: 'focus', id: prev, where: 'end' }
}

/** Delete with the caret at the end of a text block: pulls the next block's text in. */
export function deleteForwardPlan(tree: Tree, id: string): Plan {
  const b = tree.get(id)
  const next = nextVisible(tree, id)
  const nb = next ? tree.get(next) : undefined
  if (!b || !next || !nb) return null
  if (!isTextType(nb.type)) return { do: 'select', id: next }
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
  if (type === 'code' || b.type === 'code') {
    // Code holds plain text: marks do not survive the conversion in either direction.
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

/** Tab: the blocks become the last children of the sibling above them. */
export function indentOps(tree: Tree, ids: readonly string[]): Op[] {
  const tops = topLevel(tree, ids)
  if (!tops.length) return []
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

/** Shift+Tab: the blocks move out to follow their parent. A no-op at the top level. */
export function outdentOps(tree: Tree, ids: readonly string[]): Op[] {
  const tops = topLevel(tree, ids)
  const first = tops.length ? tree.get(tops[0]) : undefined
  const parent = first?.parentId ? tree.get(first.parentId) : undefined
  if (!first || !parent || parent.id === tree.pageId || !parent.parentId) return []
  if (!sameParent(tree, tops, parent.id)) return []
  const ops: Op[] = []
  let after = parent.id
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

/** Parent and position for a drop target, ignoring the blocks being moved. */
export function placeForDrop(tree: Tree, drop: DropTarget, moving: ReadonlySet<string> = new Set()): Place | null {
  const t = tree.get(drop.id)
  if (!t || !t.parentId) return null
  if (drop.pos === 'inside') {
    const kids = t.content.filter((c) => !moving.has(c))
    return { parentId: t.id, afterId: kids[kids.length - 1] ?? null }
  }
  if (drop.pos === 'after') return { parentId: t.parentId, afterId: t.id }
  return { parentId: t.parentId, afterId: prevSibling(tree, t.id, moving) }
}

/** True when the drop would put a block inside itself or one of its descendants. */
export function isDropIntoSelf(tree: Tree, tops: readonly string[], drop: DropTarget): boolean {
  return tops.includes(drop.id) || tops.some((id) => isDescendant(tree, drop.id, id))
}

/** Ops moving `ids` to the drop target; empty when the drop is invalid. */
export function moveToOps(tree: Tree, ids: readonly string[], drop: DropTarget): { ops: Op[]; moved: string[] } {
  const tops = topLevel(tree, ids)
  const none = { ops: [], moved: [] }
  if (!tops.length || isDropIntoSelf(tree, tops, drop)) return none
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
