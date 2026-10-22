// When each thing on the sky moves, in multiples of the app's --duration (300 ms), for the eight
// moments of docs/plans/sky.md (reference: docs/plans/sky/animations.html). Pure: the chart reads
// it and sets `--w` (wait) and `--n` (length) on what moves. Only what is new moves, once.
import type { SkyScene, SkyStar } from '@shared/sky'

/** What to play on the sky this time. Everything not named here is simply drawn. */
export interface SkyPlay {
  /** 15: the first opening on this computer — the whole sky draws itself, star by star. */
  first?: boolean
  /** 1: stars not seen yet (their days), played one after another. */
  stars?: string[]
  /** 8: months that became constellations. */
  named?: string[]
  /** 9: grains of dust that arrived. */
  grains?: string[]
  /** 10: pomodoro halos that arrived (after a shooting star). */
  halos?: string[]
  /** The passing part of tonight's rare night. */
  event?: boolean
  /** 14: the moon rises a little (Close the day's rest). */
  moonRise?: boolean
  /** Units before anything starts (the screen's own fade, the rest's dimming). */
  delay?: number
}

export interface Timing {
  w: number
  n: number
}

export interface Timeline {
  /**
   * New stars (1): the star before it answers at `start` (`handoff`), the pen draws from it, and
   * the new star pops at `w` with a glint just before.
   */
  stars: Map<string, Timing & { start: number; handoff: string | null }>
  /** Stars appearing in the first opening (15). */
  reveal: Map<string, Timing>
  /** Segments by key `${month}:${a}-${b}`: drawn (dash) or lit for a moment (glow). */
  segments: Map<string, Timing & { mode: 'dash' | 'glow' }>
  /** Stars breathing in a wave (8). */
  breathe: Map<string, Timing>
  /** Month labels writing themselves. */
  labels: Map<string, Timing>
  grains: Map<string, Timing>
  halos: Map<string, Timing>
  /** The shooting star before the halos (10). */
  meteor: Timing | null
  /** The chart's arcs drawing themselves (15). */
  arcs: Timing | null
  /** The background stars and the dust fading in (15). */
  field: Timing | null
  moon: Timing | null
  event: Timing | null
  /** When everything has finished, in units. */
  end: number
}

export const segmentKey = (month: string, a: number, b: number): string => `${month}:${Math.min(a, b)}-${Math.max(a, b)}`

/** Stars animated one by one in the first opening; the rest appear together. */
const FIRST_MAX = 120
/** The first opening's stars fit in this many units (≈ 6 s of the ≈ 9 s). */
const FIRST_WINDOW = 20
/** One new star (animation 1): ≈ 2.8 s. */
const STAR_UNITS = 9.5
const MAX_NEW_STARS = 3
const MAX_GRAINS = 12

function allStars(scene: SkyScene): SkyStar[] {
  return scene.months.flatMap((m) => m.stars).sort((a, b) => (a.day < b.day ? -1 : 1))
}

export function timeline(scene: SkyScene, play: SkyPlay | null): Timeline {
  const t: Timeline = {
    stars: new Map(),
    reveal: new Map(),
    segments: new Map(),
    breathe: new Map(),
    labels: new Map(),
    grains: new Map(),
    halos: new Map(),
    meteor: null,
    arcs: null,
    field: null,
    moon: null,
    event: null,
    end: 0
  }
  if (!play) return t
  let w = play.delay ?? 0
  const monthOf = new Map(scene.months.map((m) => [m.month, m]))

  if (play.first) {
    t.arcs = { w, n: 5 }
    t.field = { w: w + 3, n: 3 }
    const stars = allStars(scene)
    const animated = Math.min(stars.length, FIRST_MAX)
    const step = animated > 0 ? Math.min(0.75, FIRST_WINDOW / animated) : 0
    const start = w + 6
    const lastOfMonth = new Map<string, number>()
    stars.forEach((star, i) => {
      const at = i < FIRST_MAX ? start + i * step : start + FIRST_WINDOW
      t.reveal.set(star.day, { w: at, n: 1.5 })
      const month = star.day.slice(0, 7)
      lastOfMonth.set(month, at)
      for (const s of monthOf.get(month)?.segments ?? [])
        if (s.at === star.index && !star.loose) t.segments.set(segmentKey(month, s.ia, s.ib), { w: at, n: 1.2, mode: 'dash' })
    })
    for (const [month, at] of lastOfMonth) if (monthOf.get(month)?.label) t.labels.set(month, { w: at + 1.5, n: 3 })
    for (const g of scene.grains) t.grains.set(g.key, { w: w + 3, n: 3 })
    for (const h of scene.halos) t.halos.set(h.key, { w: (t.reveal.get(h.day)?.w ?? w) + 1, n: 3 })
    const last = stars.length ? start + Math.min(FIRST_WINDOW, (animated - 1) * step) + 2 : w + 6
    t.moon = { w: last + 1, n: 6 }
    w = t.moon.w + 6
  } else if (play.moonRise) {
    t.moon = { w, n: 6 }
    w += 4
  }

  // 1: each new star, one after another
  const fresh = (play.stars ?? []).filter((day) => !t.reveal.has(day)).slice(-MAX_NEW_STARS)
  for (const day of fresh) {
    const month = monthOf.get(day.slice(0, 7))
    const star = month?.stars.find((s) => s.day === day)
    if (!month || !star) continue
    const before = star.index > 0 ? month.stars[star.index - 1].day : null
    t.stars.set(day, { w: w + 6.6, n: 2, start: w, handoff: before })
    if (!star.loose) {
      for (const s of month.segments)
        if (s.at === star.index) t.segments.set(segmentKey(month.month, s.ia, s.ib), { w: w + 0.8, n: 6, mode: 'dash' })
    }
    w += STAR_UNITS
  }

  // 8: the figure breathes, in the order its stars lit, then the name writes itself
  for (const key of play.named ?? []) {
    const month = monthOf.get(key)
    if (!month || !month.label) continue
    const figureStars = month.stars.filter((s) => !s.loose)
    figureStars.forEach((s, i) => t.breathe.set(s.day, { w: w + 0.5 + i * 0.4, n: 7 }))
    for (const s of month.segments) {
      const k = segmentKey(month.month, s.ia, s.ib)
      if (!t.segments.has(k)) t.segments.set(k, { w: w + 0.5 + s.at * 0.4, n: 9, mode: 'glow' })
    }
    const span = 0.5 + figureStars.length * 0.4
    t.labels.set(month.month, { w: w + span + 3, n: 6 })
    w += span + 3 + 6
  }

  // 9: dust, one grain after another
  const grains = (play.grains ?? []).filter((k) => !t.grains.has(k)).slice(-MAX_GRAINS)
  grains.forEach((key, i) => t.grains.set(key, { w: w + i * 1.5, n: 5 }))
  if (grains.length) w += (grains.length - 1) * 1.5 + 5

  // 10: a shooting star, then the pen draws the halo
  const halos = (play.halos ?? []).filter((k) => !t.halos.has(k))
  if (halos.length) {
    t.meteor = { w, n: 4 }
    halos.forEach((key, i) => t.halos.set(key, { w: w + 4.4 + i * 1.2, n: 5 }))
    w += 4.4 + (halos.length - 1) * 1.2 + 5
  }

  if (play.event && scene.event) {
    t.event = { w: w + 1, n: 0 }
    w += 1 + 16
  }

  const ends = [w, ...[t.moon, ...t.labels.values(), ...t.reveal.values()].filter((x): x is Timing => !!x).map((x) => x.w + x.n)]
  // the new star settles from accent into ink over 16 units
  for (const s of t.stars.values()) ends.push(s.w + 0.5 + 16)
  for (const g of t.grains.values()) ends.push(g.w + g.n)
  for (const h of t.halos.values()) ends.push(h.w + h.n)
  t.end = Math.max(...ends)
  return t
}
