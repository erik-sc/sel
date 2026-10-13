import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BriefingCalendar, BriefingEvent, CalendarErrorCode, CalendarTestResult } from '../../shared/briefing'
import { expandCalendar, looksLikeCalendar, parseCalendar, type CalendarOccurrence } from './ical'
import { CalendarError, fetchCalendar, type FetchOptions, type FetchResult, type NetPolicy } from './net'
import type { CalendarEntry, CalendarStore } from './secrets'

/**
 * Reading the connected calendars and remembering what they said.
 *
 * A calendar is fetched at most every 15 minutes (a minute when the user asks), with the
 * validators of the previous answer so that an unchanged file is not sent again. What was read
 * is expanded for the two weeks ahead and kept in a small JSON file, so the briefing opens at
 * once and still has its agenda offline. The cache holds event titles, never an address.
 *
 * With no calendar connected nothing here touches the network at all.
 */

export const CALENDAR_TIMING = {
  /** Between two automatic reads of one calendar. */
  autoMs: 15 * 60_000,
  /** Between two reads the user asked for. */
  manualMs: 60_000,
  /** Days of events kept ahead of the day a calendar was read. */
  aheadDays: 14,
  /** With less than this many days left in the cache, the file is asked for again in full. */
  refetchDays: 3
} as const

const CACHE_VERSION = 1
const DAY_MS = 86_400_000

interface CachedEvent {
  id: string
  title: string
  allDay: boolean
  /** Timed events: epoch ms. */
  start?: number
  end?: number
  /** All-day events: civil days (`endDay` exclusive), turned into local midnights when read. */
  startDay?: string
  endDay?: string
  location?: string
  description?: string
  recurring: boolean
}

interface CachedCalendar {
  etag?: string
  lastModified?: string
  /** When the events below were read from the calendar. */
  fetchedAt?: number
  /** When the calendar was last asked, whatever it answered. */
  checkedAt?: number
  error?: CalendarErrorCode
  /** The span of time the events cover (epoch ms). */
  from?: number
  to?: number
  events: CachedEvent[]
}

interface CacheFile {
  version: number
  calendars: Record<string, CachedCalendar>
}

export interface CalendarServiceOptions {
  store: CalendarStore
  /** Where the parsed events are kept. */
  cacheFile: string
  policy?: () => NetPolicy
  now?: () => number
  /** Tests: replaces the network. */
  fetch?: (url: string, options: FetchOptions) => Promise<FetchResult>
  /** Called when something a window shows may have changed. */
  onChange?: () => void
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function localMidnight(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const d = new Date(0)
  d.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  d.setHours(0, 0, 0, 0)
  return Number.isFinite(d.getTime()) ? d.getTime() : null
}

function toCached(occurrence: CalendarOccurrence): CachedEvent {
  const event: CachedEvent = { id: occurrence.id, title: occurrence.title, allDay: occurrence.allDay, recurring: occurrence.recurring }
  if (occurrence.allDay && occurrence.startDay && occurrence.endDay) {
    event.startDay = occurrence.startDay
    event.endDay = occurrence.endDay
  } else {
    event.start = occurrence.start
    event.end = occurrence.end
  }
  if (occurrence.location) event.location = occurrence.location
  if (occurrence.description) event.description = occurrence.description
  return event
}

function fromCached(calendarId: string, cached: CachedEvent): BriefingEvent | null {
  let start: number | null | undefined = cached.start
  let end: number | null | undefined = cached.end
  if (cached.allDay && cached.startDay && cached.endDay) {
    start = localMidnight(cached.startDay)
    end = localMidnight(cached.endDay)
  }
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return null
  const event: BriefingEvent = { id: cached.id, calendarId, title: cached.title, start, end, allDay: cached.allDay, recurring: cached.recurring }
  if (cached.location) event.location = cached.location
  if (cached.description) event.description = cached.description
  return event
}

function readCachedEvent(value: unknown): CachedEvent | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw['id'] !== 'string' || typeof raw['title'] !== 'string') return null
  const event: CachedEvent = { id: raw['id'].slice(0, 500), title: raw['title'].slice(0, 400), allDay: raw['allDay'] === true, recurring: raw['recurring'] === true }
  if (typeof raw['start'] === 'number') event.start = raw['start']
  if (typeof raw['end'] === 'number') event.end = raw['end']
  if (typeof raw['startDay'] === 'string') event.startDay = raw['startDay'].slice(0, 10)
  if (typeof raw['endDay'] === 'string') event.endDay = raw['endDay'].slice(0, 10)
  if (typeof raw['location'] === 'string') event.location = raw['location'].slice(0, 400)
  if (typeof raw['description'] === 'string') event.description = raw['description'].slice(0, 600)
  return event
}

const ERROR_CODES: ReadonlySet<string> = new Set(['offline', 'not-found', 'forbidden', 'not-calendar', 'too-large', 'timeout', 'blocked-address', 'failed'])

export class CalendarService {
  private cache: CacheFile | null = null
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly now: () => number

  constructor(private readonly options: CalendarServiceOptions) {
    this.now = options.now ?? Date.now
  }

  // ---- cache ----------------------------------------------------------------

  private load(): CacheFile {
    if (this.cache) return this.cache
    const cache: CacheFile = { version: CACHE_VERSION, calendars: {} }
    try {
      const parsed = JSON.parse(readFileSync(this.options.cacheFile, 'utf8')) as { version?: unknown; calendars?: unknown }
      if (parsed && parsed.version === CACHE_VERSION && parsed.calendars && typeof parsed.calendars === 'object') {
        for (const [id, value] of Object.entries(parsed.calendars as Record<string, unknown>)) {
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !value || typeof value !== 'object') continue
          const raw = value as Record<string, unknown>
          const entry: CachedCalendar = { events: [] }
          if (typeof raw['etag'] === 'string') entry.etag = raw['etag'].slice(0, 512)
          if (typeof raw['lastModified'] === 'string') entry.lastModified = raw['lastModified'].slice(0, 64)
          if (typeof raw['fetchedAt'] === 'number') entry.fetchedAt = raw['fetchedAt']
          if (typeof raw['checkedAt'] === 'number') entry.checkedAt = raw['checkedAt']
          if (typeof raw['error'] === 'string' && ERROR_CODES.has(raw['error'])) entry.error = raw['error'] as CalendarErrorCode
          if (typeof raw['from'] === 'number') entry.from = raw['from']
          if (typeof raw['to'] === 'number') entry.to = raw['to']
          if (Array.isArray(raw['events'])) {
            for (const item of (raw['events'] as unknown[]).slice(0, 5000)) {
              const event = readCachedEvent(item)
              if (event) entry.events.push(event)
            }
          }
          cache.calendars[id] = entry
        }
      }
    } catch {
      /* no cache yet, or one that cannot be read: it is rebuilt */
    }
    this.cache = cache
    return cache
  }

  private save(): void {
    if (!this.cache) return
    const temp = `${this.options.cacheFile}.tmp`
    try {
      mkdirSync(dirname(this.options.cacheFile), { recursive: true })
      writeFileSync(temp, JSON.stringify(this.cache), { mode: 0o600 })
      renameSync(temp, this.options.cacheFile)
    } catch {
      // The cache is a convenience: without it the next start reads the calendars again.
      try {
        rmSync(temp, { force: true })
      } catch {
        /* nothing left to clean */
      }
    }
  }

  /** Forgets what was read from a calendar (it was removed). */
  forget(id: string): void {
    const cache = this.load()
    if (!(id in cache.calendars)) return
    delete cache.calendars[id]
    if (Object.keys(cache.calendars).length === 0) {
      this.cache = { version: CACHE_VERSION, calendars: {} }
      try {
        rmSync(this.options.cacheFile, { force: true })
      } catch {
        /* an empty cache file is harmless */
      }
    } else this.save()
  }

  // ---- reading --------------------------------------------------------------

  /** The calendars as a window may see them: label, host and how the last read went. */
  status(): BriefingCalendar[] {
    const cache = this.load()
    return this.options.store.list().map((entry) => this.statusOf(entry, cache.calendars[entry.id]))
  }

  private statusOf(entry: CalendarEntry, cached: CachedCalendar | undefined): BriefingCalendar {
    const status: BriefingCalendar = { ...entry, ok: !cached?.error }
    if (cached?.fetchedAt) status.updatedAt = cached.fetchedAt
    if (cached?.error) status.error = cached.error
    return status
  }

  /** The cached events of the enabled calendars that overlap [from, to), all-day first, then by start. */
  events(from: number, to: number): BriefingEvent[] {
    const cache = this.load()
    const out: BriefingEvent[] = []
    for (const entry of this.options.store.list()) {
      if (!entry.enabled) continue
      for (const cached of cache.calendars[entry.id]?.events ?? []) {
        const event = fromCached(entry.id, cached)
        if (!event) continue
        const inside = event.end > event.start ? event.start < to && event.end > from : event.start >= from && event.start < to
        if (inside) out.push(event)
      }
    }
    out.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start || a.end - b.end || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)))
    return out
  }

  /** True when a calendar is due for a read. */
  private due(cached: CachedCalendar | undefined, manual: boolean): boolean {
    if (!cached?.checkedAt) return true
    const age = this.now() - cached.checkedAt
    // A clock that went backwards must not silence the calendar for good.
    return age < 0 || age >= (manual ? CALENDAR_TIMING.manualMs : CALENDAR_TIMING.autoMs)
  }

  /** Whether any enabled calendar would be read by `refresh`. */
  stale(manual = false): boolean {
    const cache = this.load()
    return this.options.store.list().some((entry) => entry.enabled && this.due(cache.calendars[entry.id], manual))
  }

  /**
   * Reads the enabled calendars that are due. Resolves when they have all answered (or
   * failed); never rejects. Makes no request when no calendar is connected.
   */
  async refresh(manual = false): Promise<void> {
    const cache = this.load()
    const due = this.options.store.list().filter((entry) => entry.enabled && this.due(cache.calendars[entry.id], manual))
    if (!due.length) return
    await Promise.all(due.map((entry) => this.read(entry.id, false)))
  }

  /** Reads one calendar now, whatever its age, and counts what it holds for today and the week. */
  async test(id: string): Promise<CalendarTestResult> {
    if (!this.options.store.get(id)) throw new Error('That calendar is no longer connected.')
    await this.read(id, true)
    const cached = this.load().calendars[id]
    if (!cached || cached.error) return { ok: false, error: cached?.error ?? 'failed' }
    const today = startOfLocalDay(this.now())
    const count = (to: number): number =>
      cached.events.filter((item) => {
        const event = fromCached(id, item)
        return !!event && (event.end > event.start ? event.start < to && event.end > today : event.start >= today && event.start < to)
      }).length
    return { ok: true, today: count(startOfLocalDay(today + 26 * 3_600_000)), week: count(startOfLocalDay(today + 7 * DAY_MS + 2 * 3_600_000)) }
  }

  private read(id: string, full: boolean): Promise<void> {
    const running = this.inflight.get(id)
    if (running) return running
    const task = this.readNow(id, full)
      .catch(() => undefined)
      .finally(() => {
        this.inflight.delete(id)
        this.save()
        try {
          this.options.onChange?.()
        } catch {
          /* a listener's failure is not the calendar's */
        }
      })
    this.inflight.set(id, task)
    return task
  }

  private async readNow(id: string, full: boolean): Promise<void> {
    const url = this.options.store.urlOf(id)
    if (!url) return
    const cache = this.load()
    const previous = cache.calendars[id] ?? { events: [] }
    const now = this.now()
    const from = startOfLocalDay(now) - DAY_MS
    const to = from + (CALENDAR_TIMING.aheadDays + 2) * DAY_MS
    // The cached events cover a fixed span; once it runs short, an unchanged file is of no use
    // and the calendar is asked for in full.
    const covered = previous.fetchedAt !== undefined && previous.to !== undefined && previous.to - now >= CALENDAR_TIMING.refetchDays * DAY_MS && !previous.error
    const conditional = !full && covered
    const next: CachedCalendar = { ...previous, checkedAt: now }
    try {
      // Outlook builds a published calendar on request and can take ten seconds or more before
      // the first byte; this runs in the background, so being patient costs nothing.
      const fetchOptions: FetchOptions = { policy: this.options.policy?.() ?? {}, timeoutMs: 60_000 }
      if (conditional && previous.etag) fetchOptions.etag = previous.etag
      if (conditional && previous.lastModified) fetchOptions.lastModified = previous.lastModified
      const result = await (this.options.fetch ?? fetchCalendar)(url, fetchOptions)
      if (result.status === 'ok') {
        // Parsed as a calendar and nothing else; a web page or an error document is refused here.
        if (!looksLikeCalendar(result.text)) throw new CalendarError('not-calendar')
        const occurrences = expandCalendar(parseCalendar(result.text), { from, to }, { calendarId: id })
        next.events = occurrences.map(toCached)
        next.from = from
        next.to = to
        next.fetchedAt = now
        if (result.etag) next.etag = result.etag
        else delete next.etag
        if (result.lastModified) next.lastModified = result.lastModified
        else delete next.lastModified
      } else {
        // Unchanged: what is cached is still what the calendar says.
        next.fetchedAt = now
      }
      delete next.error
    } catch (err) {
      next.error = err instanceof CalendarError ? err.reason : 'failed'
      // Only the reason is logged: the address is a credential and stays out of the log.
      console.warn(`[briefing] a calendar could not be read (${next.error})`)
    }
    // The calendar may have been removed while it was being read.
    if (this.options.store.get(id)) cache.calendars[id] = next
  }
}
