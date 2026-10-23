// The weekly review (0.8.0 E1): which week it looks back on, which it plans, and what it keeps.
//
// A week runs Monday to Sunday. The review looks back on the week that holds today, except on a
// Monday, when the week that just ended is still the one to close; it plans the week after the one
// it looks back on.
//
// What it keeps is the **week focus**: up to three tasks chosen for the week to come and an
// optional note, stored on the built-in Tasks database block as `props.week` (by the week's
// Monday; weeks that ended are dropped on the next write), beside the project
// plans of E3 (`props.projects`). So it syncs with the tasks, needs no new block, and never
// changes a task's own priority or date (those stay the user's, set by hand in the review if
// wanted). The notebook (Meditations) holds one line a day and has no page for a week, so the
// note lives here too.
//
// Pure: no Electron, React or store.
import type { CommandSpec } from '../commands'
import { isPlainObject } from '../database/values'
import { addDays, isoOf, makeDay, weekdayOf } from './dates'

/** Tasks chosen for a week, at most. */
export const WEEK_FOCUS_MAX = 3
/** The week's note, in characters. */
export const WEEK_NOTE_MAX = 2000

const DAY = /^(\d{4})-(\d{2})-(\d{2})/

function dayOf(text: string): number | null {
  const m = DAY.exec(text)
  return m ? makeDay(Number(m[1]), Number(m[2]), Number(m[3])) : null
}

/** The Monday of the week that holds `day` (`YYYY-MM-DD`, a time after it is ignored); null when it is not a day. */
export function mondayOf(day: string): string | null {
  const at = dayOf(day)
  if (at === null) return null
  return isoOf(addDays(at, -((weekdayOf(at) + 6) % 7)))
}

/** A week, Monday to Sunday, as `YYYY-MM-DD`. */
export interface WeekSpan {
  start: string
  end: string
}

export interface ReviewWeeks {
  /** The week looked back on. */
  past: WeekSpan
  /** The week planned. */
  next: WeekSpan
}

function spanFrom(monday: number): WeekSpan {
  return { start: isoOf(monday), end: isoOf(addDays(monday, 6)) }
}

/** The weeks a review held on `today` looks back on and plans (see the top of the file). */
export function reviewWeeks(today: string): ReviewWeeks {
  const at = dayOf(today) ?? dayOf(isoOf(Date.now())) ?? 0
  const offset = (weekdayOf(at) + 6) % 7
  // On a Monday (offset 0) the week that just ended is the one to close.
  const monday = addDays(at, offset === 0 ? -7 : -offset)
  return { past: spanFrom(monday), next: spanFrom(addDays(monday, 7)) }
}

/** Friday, Saturday and Sunday: when Today offers the review, quietly. */
export function isReviewTime(today: string): boolean {
  const at = dayOf(today)
  if (at === null) return false
  const weekday = weekdayOf(at)
  return weekday === 5 || weekday === 6 || weekday === 0
}

/** Whether `day` (a date or a moment) falls in `week`. */
export function inWeek(day: string | null | undefined, week: WeekSpan): boolean {
  if (!day) return false
  const date = day.slice(0, 10)
  return date >= week.start && date <= week.end
}

/** The focus of one week, as stored (normalised). */
export interface WeekFocus {
  /** The Monday of the week it is for. */
  start: string
  /** Task ids, in the order chosen; at most WEEK_FOCUS_MAX. */
  focus: string[]
  note: string
}

/** One week's focus from whatever is stored under its Monday; null when it is malformed or says nothing. */
function readOne(start: string, raw: unknown): WeekFocus | null {
  if (!isPlainObject(raw) || mondayOf(start) !== start) return null
  const ids = Array.isArray(raw.focus)
    ? raw.focus.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64)
    : []
  const focus = [...new Set(ids)].slice(0, WEEK_FOCUS_MAX)
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, WEEK_NOTE_MAX) : ''
  return focus.length || note ? { start, focus, note } : null
}

/**
 * The stored `props.week`: each week's focus by its Monday. The review held on a Friday chooses
 * the week to come while the current one still shows on Today, so two weeks live side by side.
 */
export function readWeeks(raw: unknown): WeekFocus[] {
  if (!isPlainObject(raw)) return []
  return Object.entries(raw)
    .map(([start, value]) => readOne(start, value))
    .filter((week): week is WeekFocus => week !== null)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
}

/** The focus of the week starting `start`, or null. */
export function weekFocus(raw: unknown, start: string): WeekFocus | null {
  return readWeeks(raw).find((week) => week.start === start) ?? null
}

/** The focus that holds on `today`: that of today's week. */
export function focusFor(raw: unknown, today: string): WeekFocus | null {
  const monday = mondayOf(today)
  return monday ? weekFocus(raw, monday) : null
}

/**
 * What to store as `props.week` once the week starting `start` has this focus and note: the
 * weeks that ended before `today` are dropped, and a week with nothing chosen and no note is
 * left out. Null when nothing is left.
 */
export function withWeekFocus(
  raw: unknown,
  start: string,
  focus: readonly string[],
  note: string,
  today: string
): Record<string, { focus: string[]; note: string }> | null {
  const current = mondayOf(today) ?? start
  const out: Record<string, { focus: string[]; note: string }> = {}
  for (const week of readWeeks(raw))
    if (week.start >= current && week.start !== start) out[week.start] = { focus: week.focus, note: week.note }
  const own = mondayOf(start) === start ? readOne(start, { focus: [...focus], note }) : null
  if (own) out[start] = { focus: own.focus, note: own.note }
  return Object.keys(out).length ? out : null
}

/**
 * Adds `id` to the chosen tasks, or takes it out when it is there. A fourth is refused: the
 * list comes back unchanged (the screen says why).
 */
export function toggleFocus(chosen: readonly string[], id: string, max = WEEK_FOCUS_MAX): string[] {
  if (chosen.includes(id)) return chosen.filter((each) => each !== id)
  return chosen.length >= max ? [...chosen] : [...chosen, id]
}

/** A due date moved to `monday`, keeping its time of day when it has one. */
export function movedTo(due: string | null, monday: string): string {
  const time = due && due.length > 10 ? due.slice(10) : ''
  return `${monday}${time}`
}

/** The way into the review: the palette, the View menu, and Herman's routines later (C1). */
export const WEEK_COMMANDS = [
  {
    id: 'week-review',
    menu: { submenu: 'view', label: 'Weekly Review', order: 245 },
    palette: {
      title: 'Weekly review',
      keywords: ['revisão da semana', 'revisao', 'week', 'semana', 'plan', 'planejar', 'priorities', 'prioridades'],
      order: 97
    }
  }
] as const satisfies readonly CommandSpec[]
