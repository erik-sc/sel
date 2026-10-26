// Which rows of a Tasks list the user has picked (Shift+arrows, Shift+click, "Select all"), as a
// value and the moves that change it. Pure: no React, no DOM, no store. The list's order is the
// order of its rows on screen; a selection is always kept in that order.

export interface Selection {
  /** Where a range starts: the row the selection began on. Null when nothing is selected. */
  anchor: string | null
  /** The selected rows, in the list's order. */
  ids: readonly string[]
}

export const NO_SELECTION: Selection = { anchor: null, ids: [] }

/** The keys act on the rows together from this many on; one row is just that row. */
export const MANY = 2

/** The rows from `a` to `b`, either way round, inclusive. Empty when either is not in the list. */
export function rangeBetween(order: readonly string[], a: string, b: string): string[] {
  const from = order.indexOf(a)
  const to = order.indexOf(b)
  if (from < 0 || to < 0) return []
  return order.slice(Math.min(from, to), Math.max(from, to) + 1)
}

export function isSelected(selection: Selection, id: string): boolean {
  return selection.ids.includes(id)
}

/**
 * Shift+Up / Shift+Down on the focused row: the selection grows (or shrinks back) towards the
 * row next to it. A selection that does not hold the focused row starts again from it. `focus` is
 * the row the focus moves to: the neighbour, or the same row at an end of the list.
 */
export function extend(
  selection: Selection,
  order: readonly string[],
  focused: string,
  direction: 1 | -1
): { selection: Selection; focus: string } {
  const at = order.indexOf(focused)
  if (at < 0) return { selection, focus: focused }
  const anchor = selection.anchor && isSelected(selection, focused) && order.includes(selection.anchor) ? selection.anchor : focused
  const focus = order[Math.max(0, Math.min(order.length - 1, at + direction))]
  return { selection: { anchor, ids: rangeBetween(order, anchor, focus) }, focus }
}

/** Shift+click on `id`: the rows from the anchor (or, with no selection, from `from`, the row last focused). */
export function selectRange(selection: Selection, order: readonly string[], id: string, from: string | null): Selection {
  const anchor = selection.anchor && order.includes(selection.anchor) ? selection.anchor : from
  if (!anchor) return order.includes(id) ? { anchor: id, ids: [id] } : selection
  const ids = rangeBetween(order, anchor, id)
  return ids.length ? { anchor, ids } : selection
}

export function selectAll(order: readonly string[]): Selection {
  return order.length ? { anchor: order[0], ids: [...order] } : NO_SELECTION
}

/** The selection once the list has changed: rows that left it (completed, deleted, moved to another list) drop out. */
export function prune(selection: Selection, order: readonly string[]): Selection {
  if (!selection.ids.length) return selection
  const present = new Set(order)
  const ids = selection.ids.filter((id) => present.has(id))
  if (ids.length === selection.ids.length) return selection
  if (!ids.length) return NO_SELECTION
  return { anchor: selection.anchor && present.has(selection.anchor) ? selection.anchor : ids[0], ids }
}

/** Whether the keys of a focused row act on the selection rather than on the row alone. */
export function actsOnMany(selection: Selection, focused: string): boolean {
  return selection.ids.length >= MANY && isSelected(selection, focused)
}
