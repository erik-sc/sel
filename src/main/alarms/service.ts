import {
  ALARMS_FIRED_KEY,
  ALARMS_SNOOZED_KEY,
  readAlarmSettings,
  type AlarmSettings,
  type AnnouncedEvent,
  type Announcement
} from '../../shared/alarms'
import type { Briefing, BriefingEvent } from '../../shared/briefing'
import type { Block } from '../../shared/types'
import { composeBriefing, composeEvents, composeReminder, reminderTitle, type AlarmLocale } from './compose'
import {
  addSnoozed,
  announcedEvent,
  asksToRecord,
  dueEventAlarms,
  eventAlarmsOf,
  EVENTS_AHEAD_MS,
  EVENTS_BEHIND_MS,
  nextEventAlarmAt,
  nextSnoozedAt,
  readSnoozed,
  snoozeOf,
  takeDueSnoozed,
  type EventAlarm,
  type SnoozeSource,
  type Snoozed
} from './events'
import { dueReminders, nextReminderAt, remindersOf, type Reminder } from './reminders'
import { dueAlarm, markAlarms, nextAlarmAt, readFired, waitFor, type Fired } from './schedule'

/**
 * The clock of the alarms: one timer, set for the next moment something is due (a briefing time,
 * a task's reminder, an event a few minutes ahead, something snoozed) and looked at again
 * whenever the settings, the tasks, the calendar or the clock may have changed. Free of Electron: the settings store, the day, the windows and the AI come in through
 * `AlarmsDeps` (see ./index.ts).
 */

const MINUTE = 60_000
/** A briefing written by the AI is asked for this long before its time, so it is ready when it rings. */
export const PREPARE_MS = 3 * MINUTE
/** How long the AI may take before his own words are used instead. */
export const AI_TIMEOUT_MS = 45_000
/** While a meeting is being recorded nothing rings; it is tried again this often. */
const RECORDING_RETRY_MS = MINUTE
/** An announcement no window has taken stays offered this long (a window opened for it asks). */
const PENDING_MS = 10 * MINUTE
/** The calendar's events are asked for again this often (the calendar decides when it is read). */
const EVENTS_REFRESH_MS = MINUTE
/** How many of the latest announcements can still be snoozed. */
const SNOOZABLE = 20

export interface AlarmsDeps {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  now(): number
  id(): string
  timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
  /** The day as the Today screen has it, from what is stored. */
  briefing(): Promise<Briefing>
  /** The built-in Tasks database and its rows, when it exists. */
  tasks(): { database: Block; rows: Block[] } | null
  /**
   * The stored events of the calendars that overlap [from, to). A calendar that is due (every
   * 15 minutes, as for the briefing) is read in the background.
   */
  calendar?(from: number, to: number): Promise<BriefingEvent[]>
  locale(): AlarmLocale
  /** A meeting is being recorded. */
  recording(): boolean
  /** Hands an announcement to a window (opening one when none is open). */
  deliver(announcement: Announcement): void
  /** The briefing written by the AI in Herman's voice; rejects when it cannot be. */
  writeBriefing?(signal: AbortSignal): Promise<string>
  log(message: string, err?: unknown): void
}

export class AlarmsService {
  private timer: unknown = null
  private pending: { announcement: Announcement; until: number } | null = null
  /** The AI's briefing for the alarm due at `at`, being written or written. */
  private prepared: { at: number; text: Promise<string | null>; abort: AbortController } | null = null
  private stopped = false
  /** The calendar's events around now, as last asked for. */
  private calendar: { events: BriefingEvent[]; at: number; key: string } | null = null
  private asking = false
  /** What was said lately that can be snoozed, by announcement id. */
  private readonly said = new Map<string, SnoozeSource>()

  constructor(private readonly deps: AlarmsDeps) {}

  settings(): AlarmSettings {
    return readAlarmSettings((key) => this.deps.getSetting(key))
  }

  /**
   * What has rung lately; null when the setting could not be read. Unreadable is not "nothing
   * rang": taking it for empty would ring every alarm and reminder of the last days again.
   */
  private fired(): Fired | null {
    try {
      return readFired(this.deps.getSetting(ALARMS_FIRED_KEY), this.deps.now())
    } catch (err) {
      this.deps.log('could not read what rang', err)
      return null
    }
  }

  private remember(fired: Fired): void {
    try {
      this.deps.setSetting(ALARMS_FIRED_KEY, fired)
    } catch (err) {
      this.deps.log('could not remember what rang', err)
    }
  }

  private reminders(settings: AlarmSettings): Reminder[] {
    if (!settings.reminders) return []
    try {
      const found = this.deps.tasks()
      return found ? remindersOf(found.database, found.rows, { atDue: true }) : []
    } catch (err) {
      this.deps.log('could not read the reminders', err)
      return []
    }
  }

  /** What was snoozed; null when the setting could not be read (and must not be overwritten). */
  private snoozed(): Snoozed[] | null {
    try {
      return readSnoozed(this.deps.getSetting(ALARMS_SNOOZED_KEY), this.deps.now())
    } catch (err) {
      this.deps.log('could not read what was snoozed', err)
      return null
    }
  }

  private keepSnoozed(list: Snoozed[]): void {
    try {
      this.deps.setSetting(ALARMS_SNOOZED_KEY, list.length ? list : null)
    } catch (err) {
      this.deps.log('could not remember what was snoozed', err)
    }
  }

  /** The events that ring, from what the calendar said last; it is asked again once that is a minute old. */
  private eventAlarms(settings: AlarmSettings, now: number): EventAlarm[] {
    if (!settings.events || !this.deps.calendar) return []
    if (!this.calendar || now - this.calendar.at >= EVENTS_REFRESH_MS || now < this.calendar.at) void this.askCalendar()
    return eventAlarmsOf(this.calendar?.events ?? [], settings.eventLead)
  }

  private async askCalendar(): Promise<void> {
    const ask = this.deps.calendar
    if (!ask || this.asking) return
    this.asking = true
    const at = this.deps.now()
    let events = this.calendar?.events ?? []
    try {
      events = await ask(at - EVENTS_BEHIND_MS, at + EVENTS_AHEAD_MS)
    } catch (err) {
      this.deps.log('could not read the calendar', err)
    }
    const key = events.map((event) => [event.id, event.end, event.attendees ?? 0, event.transparent ? 1 : 0].join('|')).join(' ')
    const changed = key !== this.calendar?.key
    this.calendar = { events, at, key }
    this.asking = false
    // What the calendar holds decides the next ring: the clock is looked at again when it changed.
    if (changed) this.plan()
  }

  /** Looks at the clock: rings what is due, and sets the timer for what comes next. */
  plan(): void {
    if (this.stopped) return
    if (this.timer !== null) this.deps.timers.clear(this.timer)
    this.timer = null
    const now = this.deps.now()
    const settings = this.settings()
    const stored = this.fired()
    let fired = stored ?? {}
    let wait: number | null = null

    const reminders = this.reminders(settings)
    const events = this.eventAlarms(settings, now)
    const storedSnoozed = this.snoozed()
    const snoozed = storedSnoozed ?? []
    const due = dueAlarm(settings.times, fired, now)
    const ringing =
      due !== null ||
      dueReminders(reminders, fired, now).length > 0 ||
      dueEventAlarms(events, fired, now).length > 0 ||
      takeDueSnoozed(snoozed, now).due.length > 0
    if (stored === null || storedSnoozed === null) {
      // Nothing rings while what already rang cannot be read; the clock looks again in a minute.
      wait = MINUTE
    } else if (ringing && this.deps.recording()) {
      wait = RECORDING_RETRY_MS
    } else {
      if (due) {
        fired = markAlarms(settings.times, fired, now)
        this.remember(fired)
        void this.giveBriefing(settings, due.at)
      }
      const reminding = dueReminders(reminders, fired, now)
      if (reminding.length) {
        for (const r of reminding) fired[r.key] = r.at
        this.remember(fired)
        this.giveReminders(settings, reminding)
      }
      const starting = dueEventAlarms(events, fired, now)
      if (starting.length) {
        for (const e of starting) fired[e.key] = e.at
        this.remember(fired)
        // A meeting goes first: it is the one that may be recorded.
        const ordered = [...starting].sort((a, b) => Number(b.meeting) - Number(a.meeting) || a.event.start - b.event.start)
        const announced = ordered.map((e) => announcedEvent(e.event, e.meeting, asksToRecord(settings.askRecord, e.meeting)))
        this.giveEvents(settings, announced, starting[0].at)
      }
      const { due: back, waiting } = takeDueSnoozed(snoozed, now)
      if (back.length || waiting.length !== snoozed.length) this.keepSnoozed(waiting)
      for (const entry of back) {
        if (entry.kind === 'reminder') this.giveReminders(settings, entry.reminders, entry.at)
        else
          this.giveEvents(
            settings,
            entry.events.map((event) => ({ ...event, ask: asksToRecord(settings.askRecord, event.meeting) })),
            entry.at
          )
      }
    }

    const nextAlarm = nextAlarmAt(settings.times, now)
    let next = nextAlarm
    for (const candidate of [nextReminderAt(reminders, now), nextEventAlarmAt(events, now), nextSnoozedAt(snoozed, now)]) {
      if (candidate !== null && (next === null || candidate < next)) next = candidate
    }
    if (settings.ai && nextAlarm !== null && this.deps.writeBriefing) {
      const prepareAt = nextAlarm - PREPARE_MS
      if (prepareAt <= now) this.prepare(nextAlarm)
      else if (next === null || prepareAt < next) next = prepareAt
    }
    // Tasks and calendars change without telling the clock (edits, sync, a calendar read): with
    // reminders or events on it looks again every minute.
    const watching = settings.reminders || (settings.events && !!this.deps.calendar)
    const ms = wait ?? waitFor(next, now, watching ? MINUTE : undefined)
    this.timer = this.deps.timers.set(() => this.plan(), ms)
  }

  /** Starts the AI's briefing for the alarm due at `at`, once. */
  private prepare(at: number): void {
    if (this.prepared?.at === at) return
    this.prepared?.abort.abort()
    const abort = new AbortController()
    this.prepared = { at, abort, text: this.write(abort) }
  }

  private async write(abort: AbortController): Promise<string | null> {
    const writer = this.deps.writeBriefing
    if (!writer) return null
    const timeout = this.deps.timers.set(() => abort.abort(), AI_TIMEOUT_MS)
    try {
      const text = (await writer(abort.signal)).replace(/\s+/g, ' ').trim()
      return text.length > 0 && text.length <= 4000 ? text : null
    } catch (err) {
      if (!abort.signal.aborted) this.deps.log('the AI could not write the briefing', err)
      return null
    } finally {
      this.deps.timers.clear(timeout)
    }
  }

  /** The briefing in his own words, or the AI's when that is on and ready. */
  private async compose(settings: AlarmSettings, at: number | null): Promise<{ text: string; speech: string; ai: boolean }> {
    const locale = this.deps.locale()
    let own: { text: string; speech: string }
    try {
      const day = await this.deps.briefing()
      const name = this.deps.getSetting('briefing.name')
      own = composeBriefing({
        now: this.deps.now(),
        locale,
        name: typeof name === 'string' ? name : '',
        events: day.events.today,
        tasks: { overdue: day.tasks.overdue, today: day.tasks.today }
      })
    } catch (err) {
      this.deps.log('could not read the day', err)
      own = composeBriefing({ now: this.deps.now(), locale, name: '', events: [], tasks: { overdue: [], today: [] } })
    }
    if (!settings.ai || !this.deps.writeBriefing) return { ...own, ai: false }
    if (at === null || this.prepared?.at !== at) this.prepare(at ?? this.deps.now())
    const prepared = this.prepared
    const text = prepared ? await prepared.text : null
    if (this.prepared === prepared) this.prepared = null
    return text ? { text, speech: text, ai: true } : { ...own, ai: false }
  }

  private async giveBriefing(settings: AlarmSettings, at: number | null): Promise<void> {
    try {
      const { text, speech, ai } = await this.compose(settings, at)
      this.announce({
        id: this.deps.id(),
        kind: 'briefing',
        text,
        speech,
        locale: this.deps.locale(),
        sound: settings.sound,
        voice: settings.voice,
        voiceName: settings.voiceName,
        ...(ai ? { ai: true } : {}),
        at: at ?? this.deps.now()
      })
    } catch (err) {
      this.deps.log('could not give the briefing', err)
    }
  }

  private giveReminders(settings: AlarmSettings, reminders: readonly Reminder[], at?: number): void {
    const locale = this.deps.locale()
    const said = reminders.map((r) => composeReminder(r, locale))
    const first = reminders[0]
    const id = this.deps.id()
    this.keepSaid(id, { kind: 'reminder', reminders: [...reminders] })
    this.announce({
      id,
      kind: 'reminder',
      title: reminderTitle(locale),
      text: said.map((s) => s.text).join(' '),
      speech: said.map((s) => s.speech).join(' '),
      locale,
      sound: settings.sound,
      voice: settings.voice,
      voiceName: settings.voiceName,
      // One reminder opens its task; several open none (the bubble lists them).
      ...(reminders.length === 1 ? { pageId: first.rowId } : {}),
      snooze: true,
      at: at ?? first.at
    })
  }

  /** Events about to start: the first is the one announced (and, when it asks, offered to record). */
  private giveEvents(settings: AlarmSettings, events: AnnouncedEvent[], at: number): void {
    if (!events.length) return
    const locale = this.deps.locale()
    const { title, text, speech } = composeEvents(events, this.deps.now(), locale)
    const id = this.deps.id()
    this.keepSaid(id, { kind: 'event', events })
    this.announce({
      id,
      kind: 'event',
      title,
      text,
      speech,
      locale,
      sound: settings.sound,
      voice: settings.voice,
      voiceName: settings.voiceName,
      event: events[0],
      snooze: true,
      at
    })
  }

  private keepSaid(id: string, source: SnoozeSource): void {
    this.said.set(id, source)
    for (const old of this.said.keys()) {
      if (this.said.size <= SNOOZABLE) break
      this.said.delete(old)
    }
  }

  private announce(announcement: Announcement): void {
    this.pending = { announcement, until: this.deps.now() + PENDING_MS }
    this.deps.deliver(announcement)
  }

  /** "Try it": the briefing as it would be now, whatever the times say. Nothing is remembered as rung. */
  async test(): Promise<void> {
    await this.giveBriefing(this.settings(), null)
  }

  /** The announcement a window has not taken yet. */
  pendingAnnouncement(): Announcement | null {
    if (!this.pending || this.pending.until < this.deps.now()) {
      this.pending = null
      return null
    }
    return this.pending.announcement
  }

  heard(id: unknown): void {
    if (typeof id === 'string' && this.pending?.announcement.id === id) this.pending = null
  }

  /** "Snooze": what was said under `id` is said again in ten minutes (a reminder or an event). */
  snooze(id: unknown): void {
    if (typeof id !== 'string') return
    const source = this.said.get(id)
    if (!source) return
    this.said.delete(id)
    if (this.pending?.announcement.id === id) this.pending = null
    this.keepSnoozed(addSnoozed(this.snoozed() ?? [], snoozeOf(source, this.deps.now())))
    this.plan()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.deps.timers.clear(this.timer)
    this.timer = null
    this.prepared?.abort.abort()
    this.prepared = null
  }
}
