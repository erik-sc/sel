import type { AlarmTime } from '../../shared/alarms'

/**
 * When an alarm rings. Times are local wall-clock times, found on the calendar of the moment
 * they fall on, so that a briefing set for 08:30 rings at 08:30 on both sides of a change of
 * the clocks. A time the clocks skip (02:30 on a spring-forward night) rings when the clock
 * gets past it. What has rung is a plain value the caller stores.
 *
 * Pure: no Electron, no clock of its own. Unit-tested, also across time zones.
 */

const MINUTE = 60_000

/** A briefing missed by less than this (the computer was asleep, sel was starting) still rings. */
export const ALARM_GRACE_MS = 30 * MINUTE
/** A reminder is still worth giving this late. */
export const REMINDER_GRACE_MS = 15 * MINUTE
/** What has rung is forgotten after this long. */
const FORGET_MS = 3 * 24 * 60 * MINUTE

/** When each alarm or reminder last rang: key -> the moment it was due (ms). */
export type Fired = Record<string, number>

/** The stored record, made safe: anything malformed is forgotten. */
export function readFired(raw: unknown, now: number): Fired {
  const out: Fired = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length > 120 || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (typeof value === 'number' && Number.isFinite(value) && now - value < FORGET_MS && value <= now + FORGET_MS) out[key] = value
  }
  return out
}

/** The moment `time` (`HH:mm`) falls on the local day `offset` days from that of `now`. */
function at(now: number, offset: number, time: string): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, Number(time.slice(0, 2)), Number(time.slice(3, 5))).getTime()
}

function rings(alarm: AlarmTime): boolean {
  return alarm.enabled && alarm.days.length > 0
}

/** The day of the week a moment `offset` days from `now` falls on (0 = Sunday). */
function weekday(now: number, offset: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getDay()
}

/** The latest time the alarm was due at or before `now`; null when it never rings. */
export function lastOccurrence(alarm: AlarmTime, now: number): number | null {
  if (!rings(alarm)) return null
  for (let offset = 0; offset >= -7; offset--) {
    if (!alarm.days.includes(weekday(now, offset))) continue
    const moment = at(now, offset, alarm.time)
    if (moment <= now) return moment
  }
  return null
}

/** The first time the alarm is due after `now`; null when it never rings. */
export function nextOccurrence(alarm: AlarmTime, now: number): number | null {
  if (!rings(alarm)) return null
  for (let offset = 0; offset <= 8; offset++) {
    if (!alarm.days.includes(weekday(now, offset))) continue
    const moment = at(now, offset, alarm.time)
    if (moment > now) return moment
  }
  return null
}

export const alarmKey = (alarm: AlarmTime): string => `a:${alarm.id}`

/**
 * The alarm that should ring now: due within the grace period and not rung for that occasion.
 * Several due at once (the computer woke up late) ring once, as the latest of them.
 */
export function dueAlarm(times: readonly AlarmTime[], fired: Fired, now: number, graceMs = ALARM_GRACE_MS): { alarm: AlarmTime; at: number } | null {
  let best: { alarm: AlarmTime; at: number } | null = null
  for (const alarm of times) {
    const moment = lastOccurrence(alarm, now)
    if (moment === null || now - moment > graceMs) continue
    if ((fired[alarmKey(alarm)] ?? 0) >= moment) continue
    if (!best || moment > best.at) best = { alarm, at: moment }
  }
  return best
}

/** The record after the alarms due at `moment` rang: every one due then counts as rung. */
export function markAlarms(times: readonly AlarmTime[], fired: Fired, now: number, graceMs = ALARM_GRACE_MS): Fired {
  const out = { ...fired }
  for (const alarm of times) {
    const moment = lastOccurrence(alarm, now)
    if (moment !== null && now - moment <= graceMs) out[alarmKey(alarm)] = Math.max(out[alarmKey(alarm)] ?? 0, moment)
  }
  return out
}

/** The first moment after `now` at which any alarm is due; null when none rings. */
export function nextAlarmAt(times: readonly AlarmTime[], now: number): number | null {
  let next: number | null = null
  for (const alarm of times) {
    const moment = nextOccurrence(alarm, now)
    if (moment !== null && (next === null || moment < next)) next = moment
  }
  return next
}

/** How long to wait until `next`, within bounds a timer can keep (and so the plan is looked at again now and then). */
export function waitFor(next: number | null, now: number, maxMs = 6 * 60 * MINUTE): number {
  if (next === null) return maxMs
  return Math.max(1000, Math.min(maxMs, next - now))
}
