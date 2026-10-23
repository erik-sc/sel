// Where the text caret of the page is on screen, for what floats over the page and must keep out
// of its way: the persona's corner (Dock.tsx) and the conversation balloon (ai/Balloon.tsx).
import type { Box } from './mood'

/** The conversation balloon: its own fields are not the page's caret. */
const BALLOON = '.ai-balloon'

export function editable(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
}

/** Where the caret is on screen, when it is in the page (not in a panel, a dialog, the balloon or a field of the shell). */
export function caretBox(area: HTMLElement): Box | null {
  const active = document.activeElement
  if (!editable(active) || !area.contains(active) || active.closest(BALLOON)) return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  let rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    // An empty line has no box of its own: the block it is in stands for it.
    const node = selection.focusNode
    const element = node instanceof Element ? node : node?.parentElement
    if (!element) return null
    rect = element.getBoundingClientRect()
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}
