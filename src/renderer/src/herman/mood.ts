// Which pose Herman takes, from what is going on around him. Pure; unit tested.
import type { HermanCorner } from '@shared/herman'
import type { HermanMood } from './gate'
import type { Pose } from './poses'

export interface PoseInput {
  mood: HermanMood
  /** The user is turned to him: the pointer is on him, he has the focus, or a message is being written to him. */
  attended?: boolean
  /** He is saying something of his own (a nudge, his introduction). */
  saying?: boolean
  /** The quiet hours, or a window nobody is looking at. */
  asleep?: boolean
}

/**
 * A request in progress comes first (thinking, speaking, then pleased or concerned for a
 * moment); then his own line; then the user's attention; sleep only when nothing else is going on.
 */
export function poseFor({ mood, attended, saying, asleep }: PoseInput): Exclude<Pose, 'speaking2' | 'blink'> {
  if (mood !== 'idle') return mood
  if (saying) return 'speaking'
  if (attended) return 'listening'
  return asleep ? 'sleeping' : 'resting'
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** True when `box`, grown by `margin` on every side, touches `other`. */
export function near(box: Box, other: Box, margin: number): boolean {
  return (
    other.left < box.right + margin && other.right > box.left - margin && other.top < box.bottom + margin && other.bottom > box.top - margin
  )
}

/** The corner of `area` that the point is closest to. */
export function nearestCorner(area: Box, x: number, y: number): HermanCorner {
  const horizontal = x < (area.left + area.right) / 2 ? 'left' : 'right'
  const vertical = y < (area.top + area.bottom) / 2 ? 'top' : 'bottom'
  return `${vertical}-${horizontal}`
}

/** The corner an arrow key moves him to from `corner`. */
export function cornerAfterKey(corner: HermanCorner, key: string): HermanCorner {
  const [vertical, horizontal] = corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  switch (key) {
    case 'ArrowLeft':
      return `${vertical}-left`
    case 'ArrowRight':
      return `${vertical}-right`
    case 'ArrowUp':
      return `top-${horizontal}`
    case 'ArrowDown':
      return `bottom-${horizontal}`
    default:
      return corner
  }
}

/** Continuous editing: a pause longer than this starts the count again. */
export const EDIT_PAUSE_MS = 5 * 60_000

/** When the current stretch of editing started, after a key was pressed at `now`. */
export function editingSince(previous: { since: number; last: number } | null, now: number): { since: number; last: number } {
  if (!previous || now - previous.last > EDIT_PAUSE_MS || now < previous.last) return { since: now, last: now }
  return { since: previous.since, last: now }
}

/** Minutes of the day as the value of a time field ("21:00"), and back. Null for anything that is not a time. */
export function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function fromClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}
