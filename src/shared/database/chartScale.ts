// Chart geometry that does not need a DOM: axis ticks, number bins, label fitting,
// label collisions and arcs. Pure and unit-tested; the SVG renderer only places things.

const NICE_STEPS = [1, 2, 2.5, 5, 10]
const INTEGER_STEPS = [1, 2, 5, 10]

/** Removes binary noise (`0.30000000000000004`) from a value that is a multiple of `step`. */
function tidy(value: number, step: number): number {
  const decimals = Math.max(0, Math.min(12, Math.ceil(-Math.log10(step)) + 2))
  const rounded = Number(value.toFixed(decimals))
  return rounded === 0 ? 0 : rounded
}

/** The smallest "round" step (1, 2, 2.5, 5 × a power of ten) that is not below `rough`. */
export function niceStep(rough: number, integer = false): number {
  if (!(rough > 0) || !isFinite(rough)) return 1
  const power = Math.pow(10, Math.floor(Math.log10(rough)))
  const fraction = rough / power
  const steps = integer ? INTEGER_STEPS : NICE_STEPS
  const step = (steps.find((s) => s >= fraction - 1e-9) ?? 10) * power
  return integer ? Math.max(1, step) : step
}

export interface Ticks {
  /** First and last tick: the axis domain. */
  min: number
  max: number
  step: number
  values: number[]
}

/**
 * Axis ticks that cover [min, max] with round numbers, about `target` of them.
 * A degenerate or non-finite range still gives a usable axis (never an empty one),
 * and `integer` keeps counts from being cut into halves.
 */
export function niceTicks(min: number, max: number, target = 5, integer = false): Ticks {
  let lo = isFinite(min) ? min : 0
  let hi = isFinite(max) ? max : 0
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo === hi) {
    // One value: an axis from zero to it (or 0..1 when it is zero itself).
    if (lo === 0) hi = 1
    else if (lo > 0) lo = 0
    else hi = 0
  }
  const count = Math.max(1, Math.min(20, Math.floor(isFinite(target) ? target : 5)))
  let step = niceStep((hi - lo) / count, integer)
  let first = Math.floor(lo / step + 1e-9) * step
  let last = Math.ceil(hi / step - 1e-9) * step
  // Rounding outwards can add ticks: widen the step until the axis is not crowded.
  for (let guard = 0; guard < 8 && (last - first) / step > count + 1; guard++) {
    step = niceStep(step * 1.01, integer)
    first = Math.floor(lo / step + 1e-9) * step
    last = Math.ceil(hi / step - 1e-9) * step
  }
  const values: number[] = []
  const n = Math.round((last - first) / step)
  for (let i = 0; i <= n; i++) values.push(tidy(first + i * step, step))
  return { min: values[0], max: values[values.length - 1], step, values }
}

export interface Bins {
  start: number
  step: number
  count: number
}

/** At most `maxBins` equal, round-edged buckets `[start + i·step, start + (i+1)·step)` that cover [min, max]. */
export function niceBins(min: number, max: number, maxBins = 10): Bins {
  if (!isFinite(min) || !isFinite(max) || max <= min) return { start: isFinite(min) ? min : 0, step: 1, count: 1 }
  const limit = Math.max(1, Math.floor(maxBins))
  let step = niceStep((max - min) / limit)
  for (let guard = 0; guard < 64; guard++) {
    const start = tidy(Math.floor(min / step + 1e-9) * step, step)
    const count = Math.floor((max - start) / step + 1e-9) + 1
    if (count <= limit) return { start, step, count }
    step = niceStep(step * 1.01)
  }
  return { start: min, step: max - min, count: 1 }
}

/** Index of the bin a value falls in (the last bin also takes the upper edge). */
export function binIndex(value: number, bins: Bins): number {
  const index = Math.floor((value - bins.start) / bins.step + 1e-9)
  return Math.max(0, Math.min(bins.count - 1, index))
}

/** Lower edge of a bin, without floating-point noise. */
export function binEdge(index: number, bins: Bins): number {
  return tidy(bins.start + index * bins.step, bins.step)
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export type Measure = (text: string) => number

/** Width of a text when nothing can measure it (tests, a canvas that failed): an average glyph per character. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return [...text].length * fontSize * 0.56
}

export const ELLIPSIS = '…'

/**
 * The longest prefix of `text` that fits `maxWidth` with an ellipsis, or the text
 * itself when it fits. Empty when not even the ellipsis fits.
 */
export function truncateLabel(text: string, maxWidth: number, measure: Measure): string {
  if (!text || !(maxWidth > 0)) return ''
  if (measure(text) <= maxWidth) return text
  if (measure(ELLIPSIS) > maxWidth) return ''
  const chars = [...text]
  let lo = 0
  let hi = chars.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? ELLIPSIS : chars.slice(0, lo).join('').trimEnd() + ELLIPSIS
}

/**
 * Every how many slots an axis label can be drawn so that neighbours keep `gap`
 * between them: 1 when each slot is wide enough for the widest label.
 */
export function labelStride(slotWidth: number, labelWidth: number, gap = 8): number {
  if (!(slotWidth > 0)) return 1
  return Math.max(1, Math.ceil((Math.max(0, labelWidth) + gap) / slotWidth))
}

export interface LabelBox {
  x: number
  y: number
  width: number
  height: number
}

function overlaps(a: LabelBox, b: LabelBox, padding: number): boolean {
  return a.x < b.x + b.width + padding && b.x < a.x + a.width + padding && a.y < b.y + b.height + padding && b.y < a.y + a.height + padding
}

/**
 * Which labels to draw so that none touches another: earlier boxes win, a later one
 * that would collide with a kept one is hidden. `bounds` also hides what would be clipped.
 */
export function hideCollidingLabels(boxes: readonly (LabelBox | null)[], padding = 2, bounds?: LabelBox): boolean[] {
  const kept: LabelBox[] = []
  return boxes.map((box) => {
    if (!box || !(box.width > 0) || !(box.height > 0)) return false
    if (bounds) {
      const inside =
        box.x >= bounds.x - 0.5 &&
        box.y >= bounds.y - 0.5 &&
        box.x + box.width <= bounds.x + bounds.width + 0.5 &&
        box.y + box.height <= bounds.y + bounds.height + 0.5
      if (!inside) return false
    }
    if (kept.some((other) => overlaps(box, other, padding))) return false
    kept.push(box)
    return true
  })
}

// ---------------------------------------------------------------------------
// Arcs (pie / donut)
// ---------------------------------------------------------------------------

function point(cx: number, cy: number, radius: number, angle: number): string {
  return `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`
}

/**
 * Path of a ring segment between two angles (radians, clockwise from 3 o'clock).
 * `inner` 0 gives a pie slice. A full turn is drawn as two halves, since an arc
 * whose ends coincide draws nothing.
 */
export function arcPath(cx: number, cy: number, inner: number, outer: number, from: number, to: number): string {
  const sweep = to - from
  if (!(sweep > 0) || !(outer > 0)) return ''
  if (sweep >= Math.PI * 2 - 1e-6) {
    const mid = from + Math.PI
    const ring = (r: number, clockwise: 0 | 1): string =>
      `M ${point(cx, cy, r, from)} A ${r} ${r} 0 1 ${clockwise} ${point(cx, cy, r, mid)} A ${r} ${r} 0 1 ${clockwise} ${point(cx, cy, r, from)} Z`
    return inner > 0 ? `${ring(outer, 1)} ${ring(inner, 0)}` : ring(outer, 1)
  }
  const large = sweep > Math.PI ? 1 : 0
  const outerArc = `M ${point(cx, cy, outer, from)} A ${outer} ${outer} 0 ${large} 1 ${point(cx, cy, outer, to)}`
  if (!(inner > 0)) return `${outerArc} L ${cx.toFixed(2)} ${cy.toFixed(2)} Z`
  return `${outerArc} L ${point(cx, cy, inner, to)} A ${inner} ${inner} 0 ${large} 0 ${point(cx, cy, inner, from)} Z`
}

export interface Slice {
  index: number
  from: number
  to: number
  /** Share of the whole, 0..1. */
  share: number
}

/**
 * Angles of the slices of a pie, starting at 12 o'clock and going clockwise.
 * Values that are not positive get no slice (they cannot be drawn as a part of a whole).
 */
export function pieSlices(values: readonly (number | null)[]): Slice[] {
  let total = 0
  for (const v of values) if (typeof v === 'number' && isFinite(v) && v > 0) total += v
  if (!(total > 0)) return []
  const out: Slice[] = []
  let angle = -Math.PI / 2
  values.forEach((v, index) => {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return
    const share = v / total
    const to = angle + share * Math.PI * 2
    out.push({ index, from: angle, to, share })
    angle = to
  })
  return out
}
