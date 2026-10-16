// The real moon in the middle of the wheel: the phase comes from the date alone (a mean synodic month
// counted from a known new moon), which is right to within a day, plenty for a drawing.

import type { Hemisphere } from './index'

export const SYNODIC_MONTH = 29.530588853
/** A new moon: 2000-01-06 18:14 UTC. */
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14)
const DAY_MS = 86_400_000

/** The moon's age as a fraction of the cycle (0 = new, 0.5 = full), at local noon of `day` ('YYYY-MM-DD'). */
export function moonPhase(day: string): number {
  const t = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12).getTime()
  const p = ((t - NEW_MOON_EPOCH) / DAY_MS / SYNODIC_MONTH) % 1
  return p < 0 ? p + 1 : p
}

/** 0 new · 1 waxing crescent · 2 first quarter · 3 waxing gibbous · 4 full · 5 waning gibbous · 6 last quarter · 7 waning crescent. */
export function phaseIndex(p: number): number {
  return Math.round(p * 8) % 8
}

/** Distance from `p` to `target` around the cycle, in days. */
function daysFrom(p: number, target: number): number {
  const d = Math.abs(p - target) % 1
  return Math.min(d, 1 - d) * SYNODIC_MONTH
}

/** The one night of each cycle closest to the full moon. */
export function isFullMoonNight(day: string): boolean {
  return daysFrom(moonPhase(day), 0.5) <= 0.5
}

/** The one night of each cycle closest to the new moon: the sky gets darker and fuller. */
export function isNewMoonNight(day: string): boolean {
  return daysFrom(moonPhase(day), 0) <= 0.5
}

/** Which side is lit: north of the equator a waxing moon is lit on the right, south of it on the left. */
export function litSide(p: number, hemisphere: Hemisphere): 'left' | 'right' {
  const waxing = p < 0.5
  return waxing === (hemisphere === 'north') ? 'right' : 'left'
}

const r1 = (v: number): number => Math.round(v * 10) / 10

/** The lit part of a moon of radius `r` centred on (cx, cy), as a closed path. */
export function moonLitPath(cx: number, cy: number, r: number, p: number, hemisphere: Hemisphere): string {
  const k = Math.cos(2 * Math.PI * p)
  const rx = Math.abs(k) * r
  const right = litSide(p, hemisphere) === 'right'
  const bulgeRight = k > 0 ? right : !right
  return (
    `M${r1(cx)} ${r1(cy - r)}A${r} ${r} 0 0 ${right ? 1 : 0} ${r1(cx)} ${r1(cy + r)}` +
    `A${r1(rx)} ${r} 0 0 ${bulgeRight ? 0 : 1} ${r1(cx)} ${r1(cy - r)}Z`
  )
}
