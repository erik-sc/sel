import { SNOOZE_MS, type AnnouncedEvent, type AskRecord } from '../../shared/alarms'
import { isMeetingEvent, type BriefingEvent } from '../../shared/briefing'
import type { Reminder } from './reminders'
import { REMINDER_GRACE_MS, type Fired } from './schedule'

/**
 * The calendar as a source of alarms: each timed event is announced a few minutes before it
 * starts, and what the user put off ("Snooze") comes back ten minutes later. All-day events and
 * those shown as free (TRANSP:TRANSPARENT) never ring; cancelled ones and those the owner
 * declined never reach here (the calendar reader leaves them out).
 *
 * Pure: it is handed the events and the clock. Unit-tested.
 */

const MINUTE = 60_000

/** The span of the calendar looked at around now: what may still ring, and what comes soon. */
export const EVENTS_BEHIND_MS = 30 * MINUTE
export const EVENTS_AHEAD_MS = 6 * 60 * MINUTE

export interface EventAlarm {
  /** What it is remembered as having rung by (short: the record caps its keys). */
  key: string
  /** When it rings: the start, less the lead. */
  at: number
  event: BriefingEvent
  meeting: boolean
}

/** A short, stable key for a text of any length (two 32-bit FNV-1a hashes). */
function digest(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x5bd1e995)
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

export const eventKey = (eventId: string): string => `e:${digest(eventId)}`

/** The events that ring, each `leadMinutes` before it starts, earliest first. */
export function eventAlarmsOf(events: readonly BriefingEvent[], leadMinutes: number): EventAlarm[] {
  const seen = new Set<string>()
  const out: EventAlarm[] = []
  for (const event of events) {
    if (event.allDay || event.transparent || !Number.isFinite(event.start) || seen.has(event.id)) continue
    seen.add(event.id)
    out.push({ key: eventKey(event.id), at: event.start - leadMinutes * MINUTE, event, meeting: isMeetingEvent(event) })
  }
  return out.sort((a, b) => a.at - b.at || a.event.start - b.event.start)
}

/** Still worth announcing: within the grace period after its time, and before the event is over. */
function current(at: number, start: number, end: number, now: number): boolean {
  return at <= now && now - at <= REMINDER_GRACE_MS && now < Math.max(end, start + REMINDER_GRACE_MS)
}

/** The event alarms due now that have not rung. */
export function dueEventAlarms(alarms: readonly EventAlarm[], fired: Fired, now: number): EventAlarm[] {
  return alarms.filter((alarm) => fired[alarm.key] === undefined && current(alarm.at, alarm.event.start, alarm.event.end, now))
}

/** The first event alarm after `now`, or null. */
export function nextEventAlarmAt(alarms: readonly EventAlarm[], now: number): number | null {
  for (const alarm of alarms) if (alarm.at > now) return alarm.at
  return null
}

/** Whether an event asks to be recorded, by the setting. */
export function asksToRecord(setting: AskRecord, meeting: boolean): boolean {
  return setting === 'all' || (setting === 'meetings' && meeting)
}

/** The event as an announcement carries it. */
export function announcedEvent(event: BriefingEvent, meeting: boolean, ask: boolean): AnnouncedEvent {
  const out: AnnouncedEvent = { id: event.id, title: event.title, start: event.start, end: event.end, meeting, ask }
  if (event.uid) out.uid = event.uid
  if (event.location) out.location = event.location
  if (event.description) out.description = event.description
  if (event.meetingUrl) out.meetingUrl = event.meetingUrl
  return out
}

// ---- snoozing -------------------------------------------------------------------

/** What was put off: enough to say it again. */
export type SnoozeSource = { kind: 'reminder'; reminders: Reminder[] } | { kind: 'event'; events: AnnouncedEvent[] }
export type Snoozed = SnoozeSource & { at: number }

const MAX_SNOOZED = 20

/** The snoozed entry for something said now, due ten minutes from `now`. */
export function snoozeOf(source: SnoozeSource, now: number): Snoozed {
  return { ...source, at: now + SNOOZE_MS }
}

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function readReminder(value: unknown): Reminder | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const key = text(raw['key'], 120)
  const rowId = text(raw['rowId'], 64)
  const title = text(raw['title'], 2000)
  if (key === null || rowId === null || title === null || !finite(raw['at'])) return null
  const due = raw['due'] === null ? null : text(raw['due'], 40)
  return { key, rowId, title, at: raw['at'], due, atDue: raw['atDue'] === true }
}

function readEvent(value: unknown): AnnouncedEvent | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = text(raw['id'], 500)
  const title = text(raw['title'], 400)
  if (id === null || title === null || !finite(raw['start']) || !finite(raw['end'])) return null
  const out: AnnouncedEvent = {
    id,
    title,
    start: raw['start'],
    end: raw['end'],
    meeting: raw['meeting'] === true,
    ask: raw['ask'] === true
  }
  const uid = text(raw['uid'], 400)
  const location = text(raw['location'], 400)
  const description = text(raw['description'], 600)
  const meetingUrl = text(raw['meetingUrl'], 1000)
  if (uid) out.uid = uid
  if (location) out.location = location
  if (description) out.description = description
  if (meetingUrl?.startsWith('https://')) out.meetingUrl = meetingUrl
  return out
}

/** The stored list, made safe: anything malformed goes, and so does what is long past. */
export function readSnoozed(raw: unknown, now: number): Snoozed[] {
  if (!Array.isArray(raw)) return []
  const out: Snoozed[] = []
  for (const item of raw.slice(0, MAX_SNOOZED)) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const at = entry['at']
    if (!finite(at) || now - at > REMINDER_GRACE_MS || at - now > 2 * SNOOZE_MS) continue
    if (entry['kind'] === 'reminder' && Array.isArray(entry['reminders'])) {
      const reminders = entry['reminders'].slice(0, 50).map(readReminder)
      if (reminders.length && reminders.every((r) => r !== null)) out.push({ at, kind: 'reminder', reminders: reminders as Reminder[] })
    } else if (entry['kind'] === 'event' && Array.isArray(entry['events'])) {
      const events = entry['events'].slice(0, 20).map(readEvent)
      if (events.length && events.every((e) => e !== null)) out.push({ at, kind: 'event', events: events as AnnouncedEvent[] })
    }
  }
  return out
}

/** The list with one more entry; the oldest go past the cap. */
export function addSnoozed(list: readonly Snoozed[], entry: Snoozed): Snoozed[] {
  return [...list, entry].slice(-MAX_SNOOZED)
}

/** Splits the list into what is due now and what still waits. An event that is over is dropped. */
export function takeDueSnoozed(list: readonly Snoozed[], now: number): { due: Snoozed[]; waiting: Snoozed[] } {
  const due: Snoozed[] = []
  const waiting: Snoozed[] = []
  for (const entry of list) {
    if (entry.at > now) waiting.push(entry)
    else if (entry.kind === 'reminder' || entry.events.some((event) => now < Math.max(event.end, event.start + REMINDER_GRACE_MS)))
      due.push(entry)
  }
  return { due, waiting }
}

/** The first snoozed entry after `now`, or null. */
export function nextSnoozedAt(list: readonly Snoozed[], now: number): number | null {
  let next: number | null = null
  for (const entry of list) if (entry.at > now && (next === null || entry.at < next)) next = entry.at
  return next
}
