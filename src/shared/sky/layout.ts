// The scene of one year's sky: every position, ready to draw. The component only draws what this
// returns. Deterministic: the same input (in any order) gives the same scene on every computer.

import type { Hemisphere, SkyInput, SkyLine, SkyMark } from './index'
import type { SkyEvent } from './events'
import { eventOf } from './events'
import { capitalise, figureOfMonth, figureSegments } from './figures'
import { isNewMoonNight, moonLitPath, moonPhase, phaseIndex } from './moon'
import { rng } from './random'

export const SKY_WIDTH = 800
export const SKY_HEIGHT = 460

/** The wheel of the year: an ellipse the twelve months sit on, January at the top, clockwise. */
export const WHEEL = { cx: 400, cy: 232, rx: 318, ry: 150 } as const
const FIGURE_SIZE = 64
const MOON_R = 20
const LOOSE_MIN = 36
const LOOSE_MAX = 60
const FIELD_STARS = 60
const MAX_HALOS = 3
/** Inside the box by this much: nothing drawn sits on the very edge. */
const MARGIN = 3

const r1 = (v: number): number => Math.round(v * 10) / 10
const clampX = (x: number): number => Math.min(SKY_WIDTH - MARGIN, Math.max(MARGIN, x))
const clampY = (y: number): number => Math.min(SKY_HEIGHT - MARGIN, Math.max(MARGIN, y))

export interface SkyPoint {
  x: number
  y: number
}

export interface SkyStar extends SkyPoint {
  day: string
  text: string
  /** Its place in the month: star j of the figure, or a loose star once the figure is complete. */
  index: number
  loose: boolean
}

export interface SkySegment {
  a: SkyPoint
  b: SkyPoint
  /** The indices of its two stars in the month. */
  ia: number
  ib: number
  /** The star that completed it (index in the month). */
  at: number
}

export interface SkyMonth {
  month: string
  figureId: string
  /** The figure's name in the UI language, with its article: "o Barco". */
  figureName: string
  centre: SkyPoint
  stars: SkyStar[]
  segments: SkySegment[]
  /** The label under the figure ("O Barco", or the name the user gave), or null for the current month. */
  label: string | null
  /** Whether the label is a name the user gave. */
  named: boolean
}

export interface SkyGrain extends SkyPoint {
  key: string
  day: string
  at: number
  r: number
}

export interface SkyHalo extends SkyPoint {
  key: string
  day: string
  at: number
  /** 0, 1 or 2: the ring's place around the star. */
  ring: number
  r: number
}

export interface SkyFieldStar extends SkyPoint {
  r: number
}

export interface SkyMoon extends SkyPoint {
  r: number
  phase: number
  /** 0–7, the name of the phase. */
  phaseIndex: number
  /** The lit part, as a closed path. */
  lit: string
}

export interface SkyEcho {
  day: string
  text: string
  years: number
}

export interface SkyScene {
  year: number
  /** The night drawn: today for this year's sky, the year's last day for an earlier one. */
  night: string
  months: SkyMonth[]
  grains: SkyGrain[]
  halos: SkyHalo[]
  field: SkyFieldStar[]
  /** The very first Meditation of all, when it is in this year. */
  firstStar: SkyStar | null
  moon: SkyMoon
  /** The star of this date in an earlier year, when it is in this year's sky. */
  echo: (SkyEcho & SkyPoint) | null
  /** Tonight's rare night (this year's sky only, and only when events are on). */
  event: SkyEvent | null
  /** A moonless night: twice the faint background stars. */
  dark: boolean
}

export interface SceneOptions {
  /** Rare nights on (the `sky.events` setting). */
  events?: boolean
}

// ---- the parts that never change --------------------------------------------------

/** Three arcs and five meridians of an old star chart, very faint, behind everything. */
export const CHART_ARCS: readonly string[] = (() => {
  const cx = 400
  const cy = SKY_HEIGHT + 520
  const out: string[] = []
  for (const r of [560, 720, 880]) out.push(`M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}`)
  return out
})()

export const CHART_MERIDIANS: readonly string[] = (() => {
  const cx = 400
  const cy = SKY_HEIGHT + 520
  return [-125, -105, -90, -75, -55].map((a) => {
    const t = (a * Math.PI) / 180
    return `M${r1(cx + Math.cos(t) * 560)} ${r1(cy + Math.sin(t) * 560)}L${r1(cx + Math.cos(t) * 1300)} ${r1(cy + Math.sin(t) * 1300)}`
  })
})()

/** A short, faint stroke across the wheel between each pair of months, like a zodiac's divisions. */
export const WHEEL_TICKS: readonly string[] = Array.from({ length: 12 }, (_, k) => {
  const a = -Math.PI / 2 + ((k + 0.5) * Math.PI * 2) / 12
  const p = (f: number): string => `${r1(WHEEL.cx + Math.cos(a) * WHEEL.rx * f)} ${r1(WHEEL.cy + Math.sin(a) * WHEEL.ry * f)}`
  return `M${p(0.95)}L${p(1.05)}`
})

/** Where month k (0 = January) sits on the wheel. */
export function monthCentre(k: number): SkyPoint {
  const a = -Math.PI / 2 + (k * Math.PI * 2) / 12
  return { x: WHEEL.cx + Math.cos(a) * WHEEL.rx, y: WHEEL.cy + Math.sin(a) * WHEEL.ry }
}

/** The Milky Way: a fixed band across the sky, from bottom left to top right, gently waving. */
export function milkyWay(t: number): SkyPoint {
  return { x: -20 + t * 840, y: 400 - t * 330 + Math.sin(t * Math.PI * 2.2) * 12 }
}

// ---- building a scene ---------------------------------------------------------------

function sortedLines(lines: readonly SkyLine[]): SkyLine[] {
  const byDay = new Map<string, SkyLine>()
  for (const line of lines) {
    const text = typeof line.text === 'string' ? line.text.trim() : ''
    if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(line.day)) continue
    byDay.set(line.day, { day: line.day, text })
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
}

function sortedMarks(marks: readonly SkyMark[]): SkyMark[] {
  const byKey = new Map<string, SkyMark>()
  for (const m of marks) if (m.key && /^\d{4}-\d{2}-\d{2}$/.test(m.day) && !byKey.has(m.key)) byKey.set(m.key, m)
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** The years that have at least one star, newest first. */
export function yearsWithStars(input: Pick<SkyInput, 'meditations'>): number[] {
  const years = new Set<number>()
  for (const line of sortedLines(input.meditations)) years.add(Number(line.day.slice(0, 4)))
  return [...years].sort((a, b) => b - a)
}

/** The earlier skies to list under this year's: years with stars, other than `year`, newest first. */
export function earlierSkies(input: Pick<SkyInput, 'meditations'>, year: number): number[] {
  return yearsWithStars(input).filter((y) => y < year)
}

/** The first Meditation of all, or null. */
export function firstStarDay(input: Pick<SkyInput, 'meditations'>): string | null {
  return sortedLines(input.meditations)[0]?.day ?? null
}

/** A line written on today's date in an earlier year, the most recent such year. */
export function echoOf(input: Pick<SkyInput, 'meditations'>, today: string): SkyEcho | null {
  const year = Number(today.slice(0, 4))
  const md = today.slice(5)
  const leap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const alsoLeapDay = md === '02-28' && !leap(year)
  let best: SkyEcho | null = null
  for (const line of sortedLines(input.meditations)) {
    const then = Number(line.day.slice(0, 4))
    if (then >= year) continue
    const lmd = line.day.slice(5)
    if (lmd !== md && !(alsoLeapDay && lmd === '02-29')) continue
    if (!best || then > Number(best.day.slice(0, 4))) best = { day: line.day, text: line.text, years: year - then }
  }
  return best
}

function placeFigure(month: string, k: number): { pts: SkyPoint[]; centre: SkyPoint } {
  const fig = figureOfMonth(month)
  const centre = monthCentre(k)
  const rot = (rng('sel-sky-rot:' + month)() - 0.5) * 0.5
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const pts = fig.stars.map(([x, y]) => {
    const dx = ((x - 50) * FIGURE_SIZE) / 100
    const dy = ((y - 50) * FIGURE_SIZE) / 100
    return { x: r1(centre.x + dx * c - dy * s), y: r1(centre.y + dx * s + dy * c) }
  })
  return { pts, centre }
}

function looseStar(centre: SkyPoint, day: string): SkyPoint {
  const r = rng('sel-sky-loose:' + day)
  const a = r() * Math.PI * 2
  const d = LOOSE_MIN + r() * (LOOSE_MAX - LOOSE_MIN)
  return { x: r1(clampX(centre.x + Math.cos(a) * d)), y: r1(clampY(centre.y + Math.sin(a) * d)) }
}

function grainAt(mark: SkyMark): SkyGrain {
  const r = rng(mark.key)
  const t = 0.03 + r() * 0.94
  const base = milkyWay(t)
  const off = (r() + r() + r() - 1.5) * 24
  // across the band: the normal of its direction (840, -330)
  const nx = 330 / 902.5
  const ny = 840 / 902.5
  return {
    key: mark.key,
    day: mark.day,
    at: mark.at,
    x: r1(clampX(base.x + nx * off)),
    y: r1(clampY(base.y + ny * off)),
    r: r1(0.6 + r() * 0.5)
  }
}

function fieldStars(year: number, dark: boolean): SkyFieldStar[] {
  const out: SkyFieldStar[] = []
  const r = rng('sel-sky-field:' + year)
  for (let i = 0; i < FIELD_STARS; i++) out.push({ x: r1(r() * SKY_WIDTH), y: r1(r() * SKY_HEIGHT), r: r1(0.4 + r() * 0.5) })
  if (dark) {
    const d = rng('sel-sky-field-dark:' + year)
    for (let i = 0; i < FIELD_STARS; i++) out.push({ x: r1(d() * SKY_WIDTH), y: r1(d() * SKY_HEIGHT), r: r1(0.3 + d() * 0.4) })
  }
  return out
}

/** The moon in the middle of the wheel, as it is on the night `day`. */
export function skyMoon(day: string, hemisphere: Hemisphere): SkyMoon {
  const p = moonPhase(day)
  return {
    x: WHEEL.cx,
    y: WHEEL.cy,
    r: MOON_R,
    phase: p,
    phaseIndex: phaseIndex(p),
    lit: moonLitPath(WHEEL.cx, WHEEL.cy, MOON_R, p, hemisphere)
  }
}

/** The sky of `year`, as seen on `today` ('YYYY-MM-DD'). */
export function skyScene(input: SkyInput, year: number, today: string, options: SceneOptions = {}): SkyScene {
  const lines = sortedLines(input.meditations)
  const first = lines[0]?.day ?? null
  const thisYear = Number(today.slice(0, 4)) === year
  const night = thisYear ? today : `${year}-12-31`
  const currentMonth = today.slice(0, 7)
  const prefix = `${year}-`

  // the months, each drawing its figure one star a day
  const months: SkyMonth[] = []
  const starOfDay = new Map<string, SkyStar>()
  let firstStar: SkyStar | null = null
  for (let k = 0; k < 12; k++) {
    const month = `${year}-${String(k + 1).padStart(2, '0')}`
    const own = lines.filter((l) => l.day.startsWith(month))
    if (own.length === 0) continue
    const fig = figureOfMonth(month)
    const { pts, centre } = placeFigure(month, k)
    const stars: SkyStar[] = own.map((line, j) => {
      const loose = j >= pts.length
      const p = loose ? looseStar(centre, line.day) : pts[j]
      const star: SkyStar = { day: line.day, text: line.text, index: j, loose, x: p.x, y: p.y }
      starOfDay.set(line.day, star)
      if (line.day === first) firstStar = star
      return star
    })
    const lit = Math.min(own.length, pts.length)
    const segments: SkySegment[] = figureSegments(fig)
      .filter((s) => s.at < lit)
      .map((s) => ({ a: pts[s.a], b: pts[s.b], ia: s.a, ib: s.b, at: s.at }))
    const past = month < currentMonth
    const given = input.names[month]
    const figureName = input.locale === 'pt-BR' ? fig.pt : fig.en
    months.push({
      month,
      figureId: fig.id,
      figureName,
      centre: { x: r1(centre.x), y: r1(centre.y) },
      stars,
      segments,
      label: past ? (given ? given : capitalise(figureName)) : null,
      named: past && !!given
    })
  }

  // pomodoros: a halo ring on the day's star (up to three), or a grain when the day has no star
  const halos: SkyHalo[] = []
  const grainMarks = sortedMarks(input.grains).filter((g) => g.day.startsWith(prefix))
  const ringsOfDay = new Map<string, number>()
  for (const p of sortedMarks(input.pomodoros).sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1))) {
    if (!p.day.startsWith(prefix)) continue
    const star = starOfDay.get(p.day)
    if (!star) {
      grainMarks.push(p)
      continue
    }
    const ring = ringsOfDay.get(p.day) ?? 0
    if (ring >= MAX_HALOS) continue
    ringsOfDay.set(p.day, ring + 1)
    halos.push({ key: p.key, day: p.day, at: p.at, ring, r: r1(4.2 + 1.6 * ring), x: star.x, y: star.y })
  }
  const grains = grainMarks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(grainAt)

  const echoLine = thisYear ? null : echoOf(input, today)
  const echoStar = echoLine ? starOfDay.get(echoLine.day) : undefined
  const dark = isNewMoonNight(night)

  return {
    year,
    night,
    months,
    grains,
    halos,
    field: fieldStars(year, dark),
    firstStar,
    moon: skyMoon(night, input.hemisphere),
    echo: echoLine && echoStar ? { ...echoLine, x: echoStar.x, y: echoStar.y } : null,
    event: thisYear && options.events !== false ? eventOf(today, { hemisphere: input.hemisphere, firstStarDay: first }) : null,
    dark
  }
}
