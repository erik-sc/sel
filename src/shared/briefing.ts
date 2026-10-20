/**
 * The morning briefing ("Today"): the shapes shared by the main process (which reads the
 * workspace, fetches the calendars and picks the day's phrase) and the renderer (which shows
 * them). A calendar's address is a credential: it is entered once, kept encrypted by the main
 * process, and is in none of these shapes.
 */

import type { SettingsSpec } from './settings'
import type { InvokeChannels } from './ipc'
import type { CommandSpec } from './commands'

export const TRADITIONS = ['stoic', 'buddhist', 'taoist', 'hindu', 'western', 'poetry', 'mystic'] as const
export type Tradition = (typeof TRADITIONS)[number]

export const TRADITION_LABELS: Record<Tradition, string> = {
  stoic: 'Stoicism',
  buddhist: 'Buddhism',
  taoist: 'Taoism and the Chinese classics',
  hindu: 'Hindu scriptures',
  western: 'Western thinkers',
  poetry: 'Poetry',
  mystic: 'Mystics'
}

export function isTradition(value: unknown): value is Tradition {
  return typeof value === 'string' && (TRADITIONS as readonly string[]).includes(value)
}

/** The colours a calendar's dot can take: the named colour tokens (`--c-<name>`). */
export const CALENDAR_COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'brown', 'pink', 'yellow', 'gray'] as const
export type CalendarColor = (typeof CALENDAR_COLORS)[number]

export function isCalendarColor(value: unknown): value is CalendarColor {
  return typeof value === 'string' && (CALENDAR_COLORS as readonly string[]).includes(value)
}

/** Why a calendar could not be read. Never accompanied by its address. */
export type CalendarErrorCode =
  | 'offline'
  | 'not-found'
  | 'forbidden'
  | 'not-calendar'
  | 'too-large'
  | 'timeout'
  | 'blocked-address'
  | 'failed'

export const CALENDAR_ERROR_TEXT: Record<CalendarErrorCode, string> = {
  offline: 'The calendar could not be reached. You may be offline.',
  'not-found': 'There is no calendar at that address any more.',
  forbidden: 'The calendar refused the request. Its secret address may have been reset.',
  'not-calendar': 'The address did not return a calendar.',
  'too-large': 'The calendar is too large to read (over 5 MB).',
  timeout: 'The calendar took too long to answer.',
  'blocked-address': 'That address is not allowed: only public https addresses can be used.',
  failed: 'The calendar could not be read.'
}

export const BRIEFING_LIMITS = {
  calendars: 8,
  label: 60,
  url: 2048,
  name: 40,
  maxItems: { min: 3, max: 50, default: 12 },
  /** Days one request for the calendar screen may span (a month grid is six weeks at most). */
  agendaDays: 62,
  databases: 200
} as const

/** A calendar's name as it is kept: one line, no control characters, at most `label` long. */
export function cleanCalendarLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const label = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BRIEFING_LIMITS.label)
  return label || fallback
}

/** A calendar as the renderer knows it: a label and the host of its address, nothing more. */
export interface BriefingCalendar {
  id: string
  label: string
  /** The host name of the address, e.g. "calendar.google.com". */
  host: string
  color: CalendarColor
  enabled: boolean
  /** False when the last attempt to read it failed. */
  ok: boolean
  /** When its events were last read successfully (ms). */
  updatedAt?: number
  error?: CalendarErrorCode
}

export interface BriefingEvent {
  id: string
  calendarId: string
  title: string
  /** Epoch ms. An all-day event starts and ends at local midnight (`end` is the day after its last day). */
  start: number
  end: number
  allDay: boolean
  location?: string
  /** Plain text, capped. */
  description?: string
  recurring: boolean
  /** The event's UID in its calendar, the same for every occurrence of a series. */
  uid?: string
  /** Shown as free (TRANSP:TRANSPARENT): no alarm is given for it. */
  transparent?: boolean
  /** How many people other than the calendar's owner are invited, when any are. */
  attendees?: number
  /** What those people are called (the name the calendar gives, else the address), less those who declined. */
  people?: string[]
  /** The link of the call (Meet, Teams or Zoom), when it has one. https only. */
  meetingUrl?: string
}

/** A meeting is an event with someone else invited or a link to a call. */
export function isMeetingEvent(event: Pick<BriefingEvent, 'attendees' | 'meetingUrl'>): boolean {
  return (event.attendees ?? 0) >= 1 || !!event.meetingUrl
}

export interface BriefingPhrase {
  /** A bundled quote's id, or `own:<row id>` for one of the user's own. */
  id: string
  text: string
  author: string
  work?: string
  locator?: string
  translator?: string | null
  year?: number
  tradition?: Tradition
  own: boolean
  /** Own phrases: the row page to open. */
  rowId?: string
}

export interface BriefingTask {
  /** The row page (or the to-do block) this task is. */
  id: string
  kind: 'row' | 'todo'
  title: string
  /** The page to open: the row itself, or the page a to-do is on. */
  pageId: string
  /** The database's name, or the page's title for a to-do. */
  source: string
  /** `YYYY-MM-DD`. */
  due?: string
  /** The wall-clock time it is due at, `HH:mm`, when its date has one. */
  time?: string
  /** A row's date property (the one `due` is read from): what rescheduling it writes. */
  dateProperty?: string
  priority?: { name: string; color: string }
}

export interface BriefingTasks {
  overdue: BriefingTask[]
  today: BriefingTask[]
  /** Present only when the user asked for tasks without a date. */
  noDate?: BriefingTask[]
  /** How many of the tasks above are beyond the configured maximum and start out folded away. */
  more: number
}

export interface Briefing {
  /** The local day this briefing is for, `YYYY-MM-DD`. */
  date: string
  greeting: string
  phrase: BriefingPhrase | null
  /** Whether a database for the user's own phrases exists. */
  hasPhrases: boolean
  events: {
    today: BriefingEvent[]
    /** The first event of tomorrow, as a preview. */
    tomorrowFirst?: BriefingEvent
    calendars: BriefingCalendar[]
  }
  tasks: BriefingTasks
  updatedAt: number
}

/** A span of days as the calendar screen shows it: the events and the dated open tasks that fall in it. */
export interface BriefingAgenda {
  /** The first and the last day of the span, `YYYY-MM-DD`, both included. */
  from: string
  to: string
  /** The local day it is. */
  today: string
  events: BriefingEvent[]
  /** Open tasks due on one of these days, earliest first. */
  tasks: BriefingTask[]
  calendars: BriefingCalendar[]
  /** False while a calendar is still being read for days beyond what was stored; `briefing:changed` follows. */
  complete: boolean
  updatedAt: number
}

export interface CalendarInput {
  label: string
  /** The secret address. It crosses to the main process once and never comes back. */
  url: string
  color: CalendarColor
}

export interface CalendarPatch {
  label?: string
  color?: CalendarColor
  enabled?: boolean
}

export type CalendarTestResult = { ok: true; today: number; week: number } | { ok: false; error: CalendarErrorCode }

/** A database the task list can draw from, as offered in the settings. */
export interface BriefingDatabase {
  id: string
  name: string
  icon?: string
  /** Whether it has a property that says when a row is done. */
  detected: boolean
}

export interface BriefingApi {
  /** The briefing from what is on disk, at once. `force` reads the calendars again first. */
  get(force?: boolean): Promise<Briefing>
  /** The events and dated tasks of the days `from` to `to` (`YYYY-MM-DD`, both included). `force` reads the calendars again first. */
  agenda(from: string, to: string, force?: boolean): Promise<BriefingAgenda>
  /** Picks a different phrase for today and returns it. */
  anotherPhrase(): Promise<BriefingPhrase | null>
  calendars: {
    list(): Promise<BriefingCalendar[]>
    add(input: CalendarInput): Promise<BriefingCalendar>
    update(id: string, patch: CalendarPatch): Promise<BriefingCalendar>
    remove(id: string): Promise<void>
    /** Reads the calendar now and counts its events today and in the next seven days. */
    test(id: string): Promise<CalendarTestResult>
  }
  /**
   * Marks a task done in place. The token undoes it for a few minutes. A repeating task of the
   * Tasks database stays open with its due date moved on: `next` is that date.
   */
  completeTask(rowId: string): Promise<{ token: string; next?: string }>
  undoCompleteTask(token: string): Promise<void>
  /** The database of the user's own phrases, created when there is none. */
  ensurePhrasesDatabase(): Promise<{ id: string }>
  /** Copies a bundled quote into the user's phrases. Returns the row. */
  addPhrase(quoteId: string): Promise<{ id: string }>
  /** Databases the task list can use, for the settings. */
  databases(): Promise<BriefingDatabase[]>
  /**
   * Starts the optional spoken-style paragraph about the day. Its text arrives through
   * `ai.onEvent` under the returned id; `ai.cancel` stops it. Never called automatically.
   */
  brief(): Promise<{ id: string }>
  /** `briefing:changed`: calendars were read again or their list changed. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

export const BRIEFING_CHANGED = 'briefing:changed'

// ---- settings ---------------------------------------------------------------

export type OpenOnLaunch = 'first-launch-of-day' | 'always' | 'never'
export const OPEN_ON_LAUNCH: readonly OpenOnLaunch[] = ['first-launch-of-day', 'always', 'never']

/** How often the day's phrase comes from the user's own collection. */
export type OwnPhrases = 'balanced' | 'mostly' | 'never'
export const OWN_PHRASES: readonly OwnPhrases[] = ['balanced', 'mostly', 'never']

/** The keys a renderer may write. Everything else under `briefing.` belongs to the main process. */
export const BRIEFING_KEYS = [
  'briefing.openOnLaunch',
  'briefing.name',
  'briefing.includeNoDate',
  'briefing.includeTodos',
  'briefing.maxItems',
  'briefing.databases',
  'briefing.traditions',
  'briefing.ownPhrases',
  'briefing.phrasesDatabaseId',
  'briefing.lastOpened'
] as const
export type BriefingKey = (typeof BRIEFING_KEYS)[number]

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The value a briefing setting accepts from a renderer, or undefined when it does not. */
export function cleanBriefingSetting(key: string, value: unknown): unknown {
  switch (key) {
    case 'briefing.openOnLaunch':
      return (OPEN_ON_LAUNCH as readonly unknown[]).includes(value) ? value : undefined
    case 'briefing.name': {
      if (typeof value !== 'string') return undefined
      const name = value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return name.length <= BRIEFING_LIMITS.name ? name : undefined
    }
    case 'briefing.includeNoDate':
    case 'briefing.includeTodos':
      return typeof value === 'boolean' ? value : undefined
    case 'briefing.maxItems':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
      return Math.min(BRIEFING_LIMITS.maxItems.max, Math.max(BRIEFING_LIMITS.maxItems.min, Math.round(value)))
    case 'briefing.databases':
      if (!Array.isArray(value) || value.length > BRIEFING_LIMITS.databases) return undefined
      return value.every((id) => typeof id === 'string' && ID_RE.test(id)) ? [...new Set(value as string[])] : undefined
    case 'briefing.traditions':
      if (!Array.isArray(value) || value.length > TRADITIONS.length) return undefined
      return value.every(isTradition) ? TRADITIONS.filter((name) => (value as string[]).includes(name)) : undefined
    case 'briefing.ownPhrases':
      return (OWN_PHRASES as readonly unknown[]).includes(value) ? value : undefined
    case 'briefing.phrasesDatabaseId':
      return typeof value === 'string' && ID_RE.test(value) ? value : undefined
    case 'briefing.lastOpened':
      return typeof value === 'string' && DAY_RE.test(value) ? value : undefined
    default:
      return undefined
  }
}

/** Local calendar day of a moment, `YYYY-MM-DD`. */
export function localDay(now: Date | number = new Date()): string {
  const d = typeof now === 'number' ? new Date(now) : now
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The briefing settings steer what the main process reads and shows, so each is typed. The
 * databases Today takes its tasks from sync, with the calendars.
 */
export const BRIEFING_SETTINGS: SettingsSpec = {
  keys: BRIEFING_KEYS,
  clean: cleanBriefingSetting,
  syncedAt: { 'briefing.databases': 'sync.briefingAt' }
}

/** The invoke channels of `api.briefing` (see `INVOKE` in ./api.ts): every method of BriefingApi that returns a promise, and no other. */
export const BRIEFING_INVOKE = {
  'briefing:get': true,
  'briefing:agenda': true,
  'briefing:anotherPhrase': true,
  'briefing:calendars.list': true,
  'briefing:calendars.add': true,
  'briefing:calendars.update': true,
  'briefing:calendars.remove': true,
  'briefing:calendars.test': true,
  'briefing:completeTask': true,
  'briefing:undoCompleteTask': true,
  'briefing:ensurePhrasesDatabase': true,
  'briefing:addPhrase': true,
  'briefing:databases': true,
  'briefing:brief': true
} as const satisfies Record<InvokeChannels<{ briefing: BriefingApi }>, true>

/** The ways to Today and the calendar (see ./commands.ts). */
export const BRIEFING_COMMANDS = [
  {
    id: 'open-today',
    shortcut: { accelerator: 'CmdOrCtrl+Alt+T', key: 't', ctrl: true, alt: true },
    menu: { submenu: 'view', label: 'Today', order: 210 },
    palette: { title: 'Today', keywords: ['briefing', 'agenda', 'tasks'], order: 60 },
    catalog: { group: 'navigation', label: 'Today', keywords: ['briefing', 'agenda'], order: 120 }
  },
  {
    id: 'open-calendar',
    shortcut: { accelerator: 'CmdOrCtrl+Alt+C', key: 'c', ctrl: true, alt: true },
    menu: { submenu: 'view', label: 'Calendar', order: 220 },
    palette: { title: 'Calendar', keywords: ['events', 'schedule', 'agenda'], order: 70 },
    catalog: { group: 'navigation', label: 'Calendar', keywords: ['events'], order: 130 }
  }
] as const satisfies readonly CommandSpec[]
