// Row windowing of the table view: row height from the design token, the range
// of rows near the viewport, and scrolling to a row that is not rendered.
import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import * as L from '../logic'

/** Only used until the stylesheet has been read (first render, detached nodes). */
const FALLBACK_ROW_HEIGHT = 36
/** Tables with fewer rows than this are rendered whole. */
export const WINDOW_THRESHOLD = 200
/** Rows rendered above and below the viewport. */
const OVERSCAN_ROWS = 15
/** Rows rendered before the first measurement. */
const INITIAL_ROWS = 80

/**
 * Height of one table row. The CSS token --table-row-height is the single source
 * of truth (database.css sizes .db-tr with it), so windowing can never drift from layout.
 */
function readRowHeight(el: HTMLElement | null): number {
  if (!el) return FALLBACK_ROW_HEIGHT
  const raw = getComputedStyle(el).getPropertyValue('--table-row-height').trim()
  const px = /^\d*\.?\d+px$/.test(raw) ? parseFloat(raw) : NaN
  if (px > 0) return px
  // Not a plain pixel length (e.g. calc()): fall back to what was actually laid out.
  const measured = el.querySelector<HTMLElement>('.db-tr')?.offsetHeight
  return measured && measured > 0 ? measured : FALLBACK_ROW_HEIGHT
}

export function useRowHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(FALLBACK_ROW_HEIGHT)
  useLayoutEffect(() => {
    const update = (): void => {
      const next = readRowHeight(ref.current)
      setHeight((prev) => (prev === next ? prev : next))
    }
    update()
    // Appearance settings rewrite tokens at runtime (root attributes or a <style> element).
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [ref])
  return height
}

/** Renders only the rows near the viewport once the table gets long. */
export function useWindowedRange(
  ref: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  enabled: boolean
): { start: number; end: number } {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, INITIAL_ROWS) })
  useLayoutEffect(() => {
    if (!enabled) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const next = L.windowRange(count, rowHeight, -rect.top, window.innerHeight, OVERSCAN_ROWS)
      setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }
    // One measurement per frame, however many scroll events arrive.
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    // Capture phase: scroll events of every ancestor scroller reach the document.
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [ref, count, rowHeight, enabled])
  return enabled ? { start: Math.min(range.start, count), end: Math.min(range.end, count) } : { start: 0, end: count }
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}

/** Brings the row at `index` to the middle of its scroller, whether or not it is rendered. */
export function scrollToRow(body: HTMLElement, index: number, rowHeight: number): void {
  const top = body.getBoundingClientRect().top + index * rowHeight
  const parent = scrollParent(body)
  if (parent) {
    parent.scrollTop += top - parent.getBoundingClientRect().top - parent.clientHeight / 2
  } else {
    window.scrollBy(0, top - window.innerHeight / 2)
  }
}
