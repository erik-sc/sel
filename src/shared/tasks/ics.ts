// The open tasks that have a date, as an iCalendar text (RFC 5545) another calendar subscribes
// to by address: Google Calendar, the iPhone. One way only: nothing comes back from it. Pure.
import type { PropertyValue } from '../types'

/** The setting: whether the calendar is published, and the secret its address ends with. */
export const TASKS_FEED_KEY = 'tasks.feed'

export interface TasksFeed {
  enabled: boolean
  /** The secret part of the address: whoever has it reads the calendar. A new one closes the old address. */
  token: string
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/

/** The setting as stored, or off with no address for anything else. */
export function cleanTasksFeed(value: unknown): TasksFeed {
  const raw = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const token = typeof raw['token'] === 'string' && TOKEN_RE.test(raw['token']) ? raw['token'] : ''
  return { enabled: raw['enabled'] === true && token !== '', token }
}

/** What a window may store: the two fields, or undefined for anything that is not them. */
export function cleanTasksFeedSetting(key: string, value: unknown): unknown {
  if (key !== TASKS_FEED_KEY || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, PropertyValue>
  if (typeof raw['enabled'] !== 'boolean' || typeof raw['token'] !== 'string') return undefined
  if (raw['token'] !== '' && !TOKEN_RE.test(raw['token'])) return undefined
  return { enabled: raw['enabled'] && raw['token'] !== '', token: raw['token'] }
}

/** The path of the calendar on the address sel is reached at. */
export const feedPath = (token: string): string => `/calendar/${token}.ics`

/** The secret in a path asked for, or null when the path is not the calendar's. */
export function feedTokenOf(path: string): string | null {
  const match = /^\/calendar\/([A-Za-z0-9_-]{32,64})\.ics$/u.exec(path)
  return match ? match[1] : null
}

export interface FeedTask {
  id: string
  title: string
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, wall clock. */
  due: string
  project: string | null
  priority: string | null
  labels: readonly string[]
  /** How it repeats, as stored: an RRULE's value, counted from the due date or from the completion. */
  recurrence: { rule: string; from: 'due' | 'completion' } | null
  /** When the task last changed, in milliseconds. */
  updatedAt: number
}

export interface FeedOptions {
  name: string
  now: Date
  /** The IANA time zone the hours are in. Without one they float: each calendar shows them in its own. */
  timeZone?: string
}

/** How long a task with an hour takes on the calendar: it has a moment, not a length. */
const MINUTES = 30

const pad = (n: number): string => String(n).padStart(2, '0')

/** Text as iCalendar takes it. */
const text = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/[;,]/g, (c) => `\\${c}`)
    // Control characters have no place in a calendar's text.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')

/** A line folded at 75 octets, as the format asks, never in the middle of a character. */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length
    if (size + bytes > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  out.push(current)
  return out.join('\r\n ')
}

const utcStamp = (date: Date): string =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`

const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/u
/** An RRULE's value and nothing else: what is written into the calendar is never free text. */
const RULE_RE = /^[A-Z]+=[A-Z0-9,+-]+(?:;[A-Z]+=[A-Z0-9,+-]+)*$/u

/** The rule as a calendar reads it beside a start with an hour: an UNTIL that is a day becomes the end of that day. */
function ruleFor(rule: string, timed: boolean): string | null {
  const clean = rule.trim().toUpperCase()
  if (!RULE_RE.test(clean) || !clean.includes('FREQ=')) return null
  return timed ? clean.replace(/UNTIL=(\d{8})(?=;|$)/u, 'UNTIL=$1T235959Z') : clean
}

function eventOf(task: FeedTask, options: FeedOptions): string[] | null {
  const match = DUE_RE.exec(task.due)
  if (!match) return null
  const [, y, m, d, hh, mm] = match
  const day = `${y}${m}${d}`
  const lines = ['BEGIN:VEVENT', `UID:${task.id}@sel`, `DTSTAMP:${utcStamp(options.now)}`]
  if (Number.isFinite(task.updatedAt)) lines.push(`LAST-MODIFIED:${utcStamp(new Date(task.updatedAt))}`)
  const timed = hh !== undefined
  if (timed) {
    const zone = options.timeZone ? `;TZID=${options.timeZone}` : ''
    const end = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm) + MINUTES))
    const endStamp = `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}T${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}00`
    lines.push(`DTSTART${zone}:${day}T${hh}${mm}00`, `DTEND${zone}:${endStamp}`)
  } else {
    const next = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1))
    lines.push(
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`
    )
  }
  // Only what repeats by its date is a series on a calendar: "after it is done" has no next date yet.
  const rule = task.recurrence?.from === 'due' ? ruleFor(task.recurrence.rule, timed) : null
  if (rule) lines.push(`RRULE:${rule}`)
  lines.push(`SUMMARY:${text(task.title.trim() || 'Untitled')}`)
  const notes = [
    task.project ? `#${task.project}` : '',
    task.priority && task.priority !== 'P4' ? task.priority : '',
    ...task.labels.map((label) => `@${label}`)
  ]
    .filter(Boolean)
    .join(' ')
  if (notes) lines.push(`DESCRIPTION:${text(notes)}`)
  if (task.project) lines.push(`CATEGORIES:${text(task.project)}`)
  // A task does not take the hour: the day stays free for whoever looks at the calendar.
  lines.push('TRANSP:TRANSPARENT', 'END:VEVENT')
  return lines
}

/** The calendar of the tasks given: those with a date that reads, in the order given. */
export function tasksCalendar(tasks: readonly FeedTask[], options: FeedOptions): string {
  const zone = options.timeZone && /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/u.test(options.timeZone) ? options.timeZone : undefined
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sel//tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(options.name)}`,
    ...(zone ? [`X-WR-TIMEZONE:${zone}`] : []),
    // How often a calendar is asked to read it again; each decides for itself.
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M'
  ]
  for (const task of tasks) {
    const event = eventOf(task, { ...options, timeZone: zone })
    if (event) lines.push(...event)
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
