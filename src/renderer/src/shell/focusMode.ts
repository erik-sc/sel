// Focus mode: when the hidden tab strip and top bar come back, and which Escape leaves. Pure:
// numbers and key facts go in, a yes or no comes out. Free of the DOM, React and the store.

/** The pointer this close to the top of the window brings the bars back. */
export const REVEAL_EDGE_PX = 6
/** Once shown, the bars stay until the pointer is this far below them. */
export const HIDE_SLACK_PX = 24

/**
 * Whether the bars show after the pointer moved to `y` (from the top of the window). They come
 * back only at the very edge, so reading near the top of the page does not flash them, and go
 * again only well below their own bottom edge (`barsBottom`), so they do not flicker at the border.
 */
export function revealAfterMove(revealed: boolean, y: number, barsBottom: number): boolean {
  if (!revealed) return y <= REVEAL_EDGE_PX
  return y <= barsBottom + HIDE_SLACK_PX
}

export interface EscapeFacts {
  key: string
  /** Something on the page already used the key: a menu, the find bar, the editor's selection. */
  defaultPrevented: boolean
  isComposing: boolean
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** A plain Escape that nothing else took leaves focus mode. */
export function escapeLeavesFocus(event: EscapeFacts, focusMode: boolean): boolean {
  return (
    focusMode &&
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
  )
}
