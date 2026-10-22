// Keys the app's lists share: moving along a list with one Tab stop (roving tabindex), and the
// keyboard's way to open a context menu. The conventions they follow are written down in
// docs/codebase-knowledge/50-conventions.md ("Teclado e leitor de tela").

interface Keyed {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

let menuKeyAt = Number.NEGATIVE_INFINITY

/**
 * Whether the key opens a context menu: the Menu key or Shift+F10. When it does, a `contextmenu`
 * event the system sends after it is an echo (see `isMenuKeyEcho`): the caller opens the menu
 * on the key and lets the echo go.
 */
export function takeMenuKey(event: Keyed): boolean {
  const plain = !event.ctrlKey && !event.altKey && !event.metaKey
  const yes = plain && ((event.key === 'ContextMenu' && !event.shiftKey) || (event.key === 'F10' && event.shiftKey))
  if (yes) menuKeyAt = performance.now()
  return yes
}

/** A `contextmenu` event that follows a Menu key already handled (Windows sends one on key up). */
export function isMenuKeyEcho(): boolean {
  return performance.now() - menuKeyAt < 1000
}

export type Orientation = 'vertical' | 'horizontal'

/**
 * Where a roving key goes in a list of `count` items from `index`: the next or previous one
 * (no wrapping), the first (Home) or the last (End). Null when the key is not one of them, or
 * when it would not move.
 */
export function rovingTarget(key: string, index: number, count: number, orientation: Orientation): number | null {
  if (count <= 0) return null
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  let to: number
  if (key === next) to = Math.min(count - 1, index + 1)
  else if (key === previous) to = Math.max(0, index - 1)
  else if (key === 'Home') to = 0
  else if (key === 'End') to = count - 1
  else return null
  return to === index ? null : to
}

/** Where a menu opened from the keyboard goes: under the element that has the focus. */
export function keyboardAnchor(el: Element): DOMRect {
  return el.getBoundingClientRect()
}

/**
 * Moves the focus among the items `selector` finds in `container` for a roving key, from the
 * one that has it. True when the key was one (and so is taken), even at an end.
 */
export function moveFocusAmong(container: Element, selector: string, key: string, orientation: Orientation): boolean {
  const keys = orientation === 'vertical' ? ['ArrowUp', 'ArrowDown', 'Home', 'End'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(key)) return false
  const items = [...container.querySelectorAll<HTMLElement>(selector)]
  const index = items.indexOf(document.activeElement as HTMLElement)
  const to = rovingTarget(key, index, items.length, orientation)
  if (to !== null) items[to].focus()
  return true
}
