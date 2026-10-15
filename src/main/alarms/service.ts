import { ALARMS_FIRED_KEY, readAlarmSettings, type AlarmSettings, type Announcement } from '../../shared/alarms'
import type { Briefing } from '../../shared/briefing'
import type { Block } from '../../shared/types'
import { composeBriefing, composeReminder, type AlarmLocale } from './compose'
import { dueReminders, nextReminderAt, remindersOf, type Reminder } from './reminders'
import { dueAlarm, markAlarms, nextAlarmAt, readFired, waitFor, type Fired } from './schedule'

/**
 * The clock of the alarms: one timer, set for the next moment something is due (a briefing time,
 * a task's reminder) and looked at again whenever the settings, the tasks or the clock may have
 * changed. Free of Electron: the settings store, the day, the windows and the AI come in through
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

  constructor(private readonly deps: AlarmsDeps) {}

  settings(): AlarmSettings {
    return readAlarmSettings((key) => this.deps.getSetting(key))
  }

  private fired(): Fired {
    try {
      return readFired(this.deps.getSetting(ALARMS_FIRED_KEY), this.deps.now())
    } catch {
      return {}
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

  /** Looks at the clock: rings what is due, and sets the timer for what comes next. */
  plan(): void {
    if (this.stopped) return
    if (this.timer !== null) this.deps.timers.clear(this.timer)
    this.timer = null
    const now = this.deps.now()
    const settings = this.settings()
    let fired = this.fired()
    let wait: number | null = null

    const reminders = this.reminders(settings)
    const due = dueAlarm(settings.times, fired, now)
    const ringing = due !== null || dueReminders(reminders, fired, now).length > 0
    if (ringing && this.deps.recording()) {
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
    }

    const nextAlarm = nextAlarmAt(settings.times, now)
    let next = nextAlarm
    const nextReminder = nextReminderAt(reminders, now)
    if (nextReminder !== null && (next === null || nextReminder < next)) next = nextReminder
    if (settings.ai && nextAlarm !== null && this.deps.writeBriefing) {
      const prepareAt = nextAlarm - PREPARE_MS
      if (prepareAt <= now) this.prepare(nextAlarm)
      else if (next === null || prepareAt < next) next = prepareAt
    }
    // Tasks change without telling the clock (edits, sync): with reminders on it looks again every minute.
    const ms = wait ?? waitFor(next, now, settings.reminders ? MINUTE : undefined)
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

  private giveReminders(settings: AlarmSettings, reminders: readonly Reminder[]): void {
    const locale = this.deps.locale()
    const said = reminders.map((r) => composeReminder(r, locale))
    const first = reminders[0]
    this.announce({
      id: this.deps.id(),
      kind: 'reminder',
      text: said.map((s) => s.text).join(' '),
      speech: said.map((s) => s.speech).join(' '),
      locale,
      sound: settings.sound,
      voice: settings.voice,
      voiceName: settings.voiceName,
      // One reminder opens its task; several open none (the bubble lists them).
      ...(reminders.length === 1 ? { pageId: first.rowId } : {}),
      at: first.at
    })
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

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.deps.timers.clear(this.timer)
    this.timer = null
    this.prepared?.abort.abort()
    this.prepared = null
  }
}
