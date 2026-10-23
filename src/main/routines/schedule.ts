import { localDay } from '../../shared/briefing'
import type { HermanQuietHours } from '../../shared/herman'
import { ROUTINE_HOURS, ROUTINE_IDS, routineMinutes, type RoutineId, type RoutinesSettings } from '../../shared/routines'
import { isQuiet, quietEnd } from '../herman/scheduler'

/**
 * When a routine runs, and when what it prepared may be said. Pure: the clock comes in as an
 * argument and what is remembered is a plain value the caller stores (`RoutinesState`), like
 * Herman's own scheduler (../herman/scheduler.ts), whose quiet hours it shares.
 *
 * - A routine is due from its time until its window closes, once a day (the weekly one on its
 *   day only). Never in the quiet hours and never outside `ROUTINE_HOURS`.
 * - Missed ones do not pile up: when several are due at once (the app was closed through the
 *   morning), only the one that started last runs; the others count as done for the day.
 * - What a routine prepared is said only when nobody is typing, the window is in front and free,
 *   outside the quiet hours, and some time after the last thing a routine said.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** How long after its time a routine may still start (the app opened late, the computer woke up). */
export const ROUTINE_WINDOWS: Record<RoutineId, number> = {
  morning: 3 * HOUR,
  midday: 2 * HOUR,
  evening: 3 * HOUR,
  weekly: 4 * HOUR,
  stalled: 6 * HOUR
}

/** How long no key must have been pressed before a routine speaks (the same as Herman). */
export const ROUTINE_IDLE_MS = 20_000
/** The shortest time between two things routines say. */
export const DELIVERY_GAP_MS = 20 * MINUTE
/** How often the clock is looked at while a routine is on. */
export const TICK_MS = MINUTE
/** A task offered by the stalled routine is not offered again for this many days. */
export const STALLED_REST_DAYS = 14

/** What the routines remember. Only the main process writes it (`ai.routinesState`). */
export interface RoutinesState {
  /** The local day each routine last ran (or was skipped as missed). */
  ran: Partial<Record<RoutineId, string>>
  /** The day the "limit reached" line was said. */
  limitSaid: string
  /** Tasks the stalled routine offered, and when: not offered again for a while. */
  offered: { id: string; day: string }[]
  /** When a routine last said something (ms). */
  lastSaidAt: number
}

export const ROUTINES_STATE_KEY = 'ai.routinesState'

export const EMPTY_STATE: RoutinesState = { ran: {}, limitSaid: '', offered: [], lastSaidAt: 0 }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** What is stored, made safe: anything malformed is forgotten. */
export function readState(raw: unknown): RoutinesState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_STATE, ran: {}, offered: [] }
  const value = raw as Record<string, unknown>
  const ran: Partial<Record<RoutineId, string>> = {}
  if (value['ran'] !== null && typeof value['ran'] === 'object') {
    for (const id of ROUTINE_IDS) {
      const day = (value['ran'] as Record<string, unknown>)[id]
      if (typeof day === 'string' && DAY_RE.test(day)) ran[id] = day
    }
  }
  const offered = Array.isArray(value['offered'])
    ? value['offered']
        .filter(
          (item): item is { id: string; day: string } =>
            item !== null &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            item.id.length <= 64 &&
            typeof item.day === 'string' &&
            DAY_RE.test(item.day)
        )
        .slice(-30)
        .map((item) => ({ id: item.id, day: item.day }))
    : []
  const limitSaid = typeof value['limitSaid'] === 'string' && DAY_RE.test(value['limitSaid']) ? value['limitSaid'] : ''
  const lastSaidAt = typeof value['lastSaidAt'] === 'number' && Number.isFinite(value['lastSaidAt']) ? Math.max(0, value['lastSaidAt']) : 0
  return { ran, limitSaid, offered, lastSaidAt }
}

/** The moment `minutes` past local midnight of the day of `now`. Found on the wall clock, so a changed clock keeps it. */
function at(now: number, minutes: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes).getTime()
}

/** True outside the hours a routine may run or speak at all, or inside the user's quiet hours. */
export function isNight(now: number, quiet: HermanQuietHours | null): boolean {
  const date = new Date(now)
  const minute = date.getHours() * 60 + date.getMinutes()
  if (minute < ROUTINE_HOURS.from || minute >= ROUTINE_HOURS.to + 30) return true
  return isQuiet(quiet, now)
}

/** When the night (or the quiet hours) that hold at `now` end. */
export function nightEnd(now: number, quiet: HermanQuietHours | null): number {
  let end = now
  for (let step = 0; step < 3 && isNight(end, quiet); step++) {
    const date = new Date(end)
    const minute = date.getHours() * 60 + date.getMinutes()
    const morning =
      minute < ROUTINE_HOURS.from
        ? at(end, ROUTINE_HOURS.from)
        : minute >= ROUTINE_HOURS.to + 30
          ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, ROUTINE_HOURS.from).getTime()
          : end
    const quietOver = quiet && isQuiet(quiet, end) ? quietEnd(quiet, end) : end
    end = Math.max(morning, quietOver, end + MINUTE)
  }
  return end
}

/** The span a routine may start in on the day of `now`, or null when it has none that day. */
export function windowOf(id: RoutineId, settings: RoutinesSettings, now: number): { start: number; end: number } | null {
  if (id === 'weekly' && new Date(now).getDay() !== settings.weeklyDay) return null
  const minutes = routineMinutes(settings.routines[id].time)
  if (minutes === null) return null
  const start = at(now, minutes)
  // A window never runs into the night.
  const end = Math.min(start + ROUTINE_WINDOWS[id], at(now, ROUTINE_HOURS.to + 30))
  return end > start ? { start, end } : null
}

export interface DueDecision {
  /** The routine to run now, if any. */
  run: RoutineId | null
  /** Routines missed today: marked as done without running. */
  skip: RoutineId[]
  /** When it is worth looking again. */
  waitMs: number
}

/**
 * Which routine to run at `now`. Only routines that are on, in their window, and have not run
 * today. When several are due, the one whose time is the latest wins and the others are skipped.
 */
export function dueRoutine(settings: RoutinesSettings, state: RoutinesState, now: number, quiet: HermanQuietHours | null): DueDecision {
  const today = localDay(now)
  if (isNight(now, quiet)) return { run: null, skip: [], waitMs: Math.max(MINUTE, nightEnd(now, quiet) - now) }
  const due: { id: RoutineId; start: number }[] = []
  let next = Number.POSITIVE_INFINITY
  for (const id of ROUTINE_IDS) {
    if (!settings.routines[id].on || state.ran[id] === today) continue
    const span = windowOf(id, settings, now)
    if (!span) continue
    if (now >= span.start && now < span.end) due.push({ id, start: span.start })
    else if (span.start > now) next = Math.min(next, span.start)
  }
  if (!due.length) {
    const wait = Number.isFinite(next) ? next - now : TICK_MS * 30
    return { run: null, skip: [], waitMs: Math.max(MINUTE / 2, Math.min(wait, TICK_MS * 30)) }
  }
  due.sort((a, b) => b.start - a.start)
  return { run: due[0].id, skip: due.slice(1).map((entry) => entry.id), waitMs: TICK_MS }
}

/**
 * For development and automated checks of the UI only (`SEL_ROUTINES_FAST=1` in an unpackaged
 * build): every routine that is on is due at once, whatever the hour, once a day.
 */
export function fastDue(settings: RoutinesSettings, state: RoutinesState, now: number): DueDecision {
  const today = localDay(now)
  const id = ROUTINE_IDS.find((each) => settings.routines[each].on && state.ran[each] !== today) ?? null
  return { run: id, skip: [], waitMs: 5000 }
}

/** The state after `run` ran (and `skip` were let go) on the day of `now`. */
export function markRan(state: RoutinesState, ids: readonly RoutineId[], now: number): RoutinesState {
  const today = localDay(now)
  const ran = { ...state.ran }
  for (const id of ids) ran[id] = today
  return { ...state, ran }
}

export type DeliveryRefusal = 'nothing' | 'night' | 'busy' | 'typing' | 'too-soon'

export type DeliveryDecision = { ok: true } | { ok: false; reason: DeliveryRefusal; waitMs: number }

/**
 * Whether something prepared may be said at `now`. A thing the user asked for themselves
 * ("Run routine now") does not go through here: it opens at once.
 */
export function mayDeliver(
  state: RoutinesState,
  moment: { now: number; idleMs: number; busy: boolean; pending: boolean },
  quiet: HermanQuietHours | null,
  fast = false
): DeliveryDecision {
  const { now } = moment
  if (!moment.pending) return { ok: false, reason: 'nothing', waitMs: fast ? 5000 : 10 * MINUTE }
  if (!fast && isNight(now, quiet)) return { ok: false, reason: 'night', waitMs: Math.max(MINUTE, nightEnd(now, quiet) - now) }
  const since = now - state.lastSaidAt
  // A clock set back does not open the gate early, nor keep it shut for more than one gap.
  if (!fast && state.lastSaidAt > 0 && since < DELIVERY_GAP_MS)
    return { ok: false, reason: 'too-soon', waitMs: since < 0 ? DELIVERY_GAP_MS : DELIVERY_GAP_MS - since }
  if (moment.busy) return { ok: false, reason: 'busy', waitMs: MINUTE }
  if (moment.idleMs < ROUTINE_IDLE_MS) return { ok: false, reason: 'typing', waitMs: Math.max(1000, ROUTINE_IDLE_MS - moment.idleMs) }
  return { ok: true }
}

/** The tasks offered within the last `STALLED_REST_DAYS` days, as of `today`. */
export function recentlyOffered(state: RoutinesState, today: string): Set<string> {
  const [year, month, date] = today.split('-').map(Number)
  const cutoff = new Date(Date.UTC(year, month - 1, date - STALLED_REST_DAYS)).toISOString().slice(0, 10)
  return new Set(state.offered.filter((entry) => entry.day > cutoff).map((entry) => entry.id))
}
