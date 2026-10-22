// Windowing for the views whose items vary in height: list rows, board cards, gallery rows.
// Only the items near the viewport are drawn; spacers stand in for the others, sized from
// the heights measured so far (and their average for items never drawn). The table has its
// own, simpler windowing (tableWindow.ts): its rows all have the same height.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Lists with fewer items than this are drawn whole. */
export const WINDOW_MIN_ITEMS = 200
/** Pixels drawn beyond the viewport, above and below. */
const OVERSCAN_PX = 800
/** Items drawn before the viewport was first measured. */
const INITIAL_ITEMS = 40

export type WindowSlot =
  /** Items `start` (included) to `end` (excluded), drawn. */
  | { kind: 'items'; start: number; end: number }
  /** A spacer of `height` px in place of the items between two drawn runs. */
  | { kind: 'spacer'; key: string; height: number }

export interface WindowOptions {
  /** One stable key per item, in order. */
  keys: readonly string[]
  /** Height of an item until one has been measured, in px. */
  estimate: number
  /** Space between two items (the container's `gap`), in px. */
  gap: number
  /**
   * Items drawn wherever the viewport is: the focused one (or the focus would fall to the
   * page and its place be lost), the one being edited, a list's Tab stop.
   */
  pinned?: readonly number[]
  enabled: boolean
}

export interface ItemWindow {
  slots: WindowSlot[]
  /** Ref for the element of the item with `key`: its height is measured while it is drawn. */
  measure: (key: string) => (el: HTMLElement | null) => (() => void) | undefined
}

/** The first index whose item ends below `y` (offsets[i + 1] > y). */
function firstEndingBelow(offsets: Float64Array, count: number, y: number): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid + 1] > y) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** The first index whose item starts at or below `y`. */
function firstStartingBelow(offsets: Float64Array, count: number, y: number): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid] >= y) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * The drawn part of a list whose top is `ref`. Its scroller may be any ancestor (the view's
 * body, the page): only the list's position in the window counts.
 */
export function useItemWindow(ref: RefObject<HTMLElement | null>, options: WindowOptions): ItemWindow {
  const { keys, estimate, gap, pinned, enabled } = options
  const count = keys.length
  const heights = useRef(new Map<string, number>())
  const [measured, setMeasured] = useState(0)

  // offsets[i] is where item i starts, gaps included; offsets[count] is past the last gap.
  const offsets = useMemo(() => {
    if (!enabled) return null
    let sum = 0
    let n = 0
    for (const h of heights.current.values()) {
      sum += h
      n++
    }
    const fallback = n ? sum / n : estimate
    const out = new Float64Array(count + 1)
    for (let i = 0; i < count; i++) out[i + 1] = out[i] + (heights.current.get(keys[i]) ?? fallback) + gap
    return out
    // `measured` stands for new heights in the map.
  }, [enabled, keys, count, estimate, gap, measured])

  const [range, setRange] = useState({ start: 0, end: Math.min(count, INITIAL_ITEMS) })
  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets

  useLayoutEffect(() => {
    if (!enabled) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const el = ref.current
      const table = offsetsRef.current
      if (!el || !table) return
      const top = -el.getBoundingClientRect().top
      const start = firstEndingBelow(table, count, top - OVERSCAN_PX)
      const end = Math.max(start, firstStartingBelow(table, count, top + window.innerHeight + OVERSCAN_PX))
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
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
  }, [ref, enabled, count, offsets])

  // One observer for every drawn item; a batch of new heights is one re-render.
  const observer = useRef<ResizeObserver | null>(null)
  const keyOf = useRef(new WeakMap<Element, string>())
  const refs = useRef(new Map<string, (el: HTMLElement | null) => (() => void) | undefined>())
  const measure = useCallback((key: string) => {
    let fn = refs.current.get(key)
    if (fn) return fn
    fn = (el) => {
      if (!el || typeof ResizeObserver === 'undefined') return undefined
      observer.current ??= new ResizeObserver((entries) => {
        let changed = false
        for (const entry of entries) {
          const id = keyOf.current.get(entry.target)
          const h = (entry.target as HTMLElement).offsetHeight
          if (id === undefined || h <= 0 || heights.current.get(id) === h) continue
          heights.current.set(id, h)
          changed = true
        }
        if (changed) setMeasured((n) => n + 1)
      })
      keyOf.current.set(el, key)
      observer.current.observe(el)
      return () => observer.current?.unobserve(el)
    }
    refs.current.set(key, fn)
    return fn
  }, [])

  useLayoutEffect(() => () => observer.current?.disconnect(), [])

  const slots = useMemo((): WindowSlot[] => {
    if (!enabled || !offsets) return [{ kind: 'items', start: 0, end: count }]
    const start = Math.min(range.start, count)
    const end = Math.min(range.end, count)
    const drawn = new Set<number>()
    for (let i = start; i < end; i++) drawn.add(i)
    for (const i of pinned ?? []) if (i >= 0 && i < count) drawn.add(i)
    const order = [...drawn].sort((a, b) => a - b)
    const out: WindowSlot[] = []
    // A spacer takes the place of items `from`..`to` - 1; as one item of the list it gets one gap of its own.
    const spacer = (from: number, to: number): void => {
      if (to > from) out.push({ kind: 'spacer', key: `spacer-${from}`, height: Math.max(0, offsets[to] - offsets[from] - gap) })
    }
    let cursor = 0
    for (let k = 0; k < order.length; ) {
      const first = order[k]
      let last = first
      while (k + 1 < order.length && order[k + 1] === last + 1) last = order[++k]
      k++
      spacer(cursor, first)
      out.push({ kind: 'items', start: first, end: last + 1 })
      cursor = last + 1
    }
    spacer(cursor, count)
    return out
  }, [enabled, offsets, range, count, pinned, gap])

  return { slots, measure }
}

/** The `gap` of a flex or grid container, in px (0 when it has none or is not laid out). */
export function useGap(ref: RefObject<HTMLElement | null>, axis: 'row' | 'column' = 'row'): number {
  const [gap, setGap] = useState(0)
  // Gaps are fixed lengths in database.css: read once the container is laid out.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const style = getComputedStyle(el)
    const value = parseFloat(axis === 'row' ? style.rowGap : style.columnGap)
    setGap(Number.isFinite(value) ? value : 0)
  }, [ref, axis])
  return gap
}
