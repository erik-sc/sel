import { randomUUID } from 'node:crypto'
import { isAiLanguage } from '../../shared/ai'
import { localDay } from '../../shared/briefing'
import {
  HERMAN_SIGNAL_LIMITS,
  hermanSetting,
  type HermanFeedback,
  type HermanLocale,
  type HermanNudge,
  type HermanNudgeKind,
  type HermanNudgeReply,
  type HermanSignals,
  type HermanState
} from '../../shared/herman'
import * as arg from '../validate'
import { compose, COUNSEL_DEFAULTS, type CounselEvent, type CounselInput, type CounselTask, type CounselThresholds } from './counsel'
import { PHRASES } from './lines'
import { decide, feedback, forDay, forget, FREQUENCIES, IDLE_MS, isQuiet, readMemory, record, RETRY_MS, type HermanMemory, type SchedulerConfig } from './scheduler'

/**
 * Herman as the app uses him: his settings, what he remembers, and the one question a window
 * asks ("do you have something to say?"). Free of Electron imports; the settings store, the
 * day's tasks and agenda, the clock and the dice are handed in by ./index.ts.
 */

/** The one setting under `herman.` that only this process writes. */
export const MEMORY_KEY = 'herman.memory'

/** The first start of a day counts as "just now" for this long. */
const LAUNCH_WINDOW_MS = 15 * 60_000
/** Completions further apart than this are not a streak. */
const STREAK_GAP_MS = 10 * 60_000

export interface HermanDay {
  tasks: { overdue: readonly CounselTask[]; today: readonly CounselTask[] }
  events: readonly CounselEvent[]
}

/**
 * Quick timings for development and automated checks of the UI: seconds instead of hours, and
 * no quiet hours. Only an unpackaged build can ask for them (see ./index.ts).
 */
export interface HermanFastMode {
  gapMs: number
  idleMs: number
  /** Time spent editing counts this many times over. */
  editingScale: number
}

export const FAST_MODE: HermanFastMode = { gapMs: 6000, idleMs: 3000, editingScale: 400 }

/**
 * `SELIDA_HERMAN_FAST=1` asks for the quick timings. Only an unpackaged build listens: a
 * shipped app keeps his restraint whatever the environment says.
 */
export function devFastMode(raw: string | undefined, isPackaged: boolean): HermanFastMode | null {
  return !isPackaged && raw === '1' ? FAST_MODE : null
}

export interface HermanDeps {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  /** Today's open tasks and agenda, from what is stored. Never fetches anything. */
  day(): HermanDay | Promise<HermanDay>
  /** Whether a page still exists (a signal names one). */
  pageExists(id: string): boolean
  /** The language of the system, as a locale tag. */
  systemLocale?: () => string
  now?: () => number
  random?: () => number
  fast?: HermanFastMode | null
  thresholds?: Partial<CounselThresholds>
}

function bounded(value: unknown, max: number, what: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${what}`)
  return Math.min(max, value)
}

const SIGNAL_KEYS: ReadonlySet<string> = new Set(['idleMs', 'busy', 'pageId', 'editingMs', 'untouchedDays'])

/** Exactly a `HermanSignals`: known keys only, every field typed and bounded. */
export function hermanSignals(value: unknown): HermanSignals {
  const raw = arg.plainObject(value, 'signals')
  for (const key of Object.keys(raw)) if (!SIGNAL_KEYS.has(key)) throw new Error('Invalid signals')
  const idleMs = bounded(raw['idleMs'], HERMAN_SIGNAL_LIMITS.idleMs, 'signals')
  if (idleMs === undefined) throw new Error('Invalid signals')
  const signals: HermanSignals = { idleMs }
  if (raw['busy'] !== undefined && raw['busy'] !== null) {
    if (typeof raw['busy'] !== 'boolean') throw new Error('Invalid signals')
    signals.busy = raw['busy']
  }
  const pageId = arg.optionalId(raw['pageId'], 'pageId')
  if (pageId) signals.pageId = pageId
  const editingMs = bounded(raw['editingMs'], HERMAN_SIGNAL_LIMITS.editingMs, 'signals')
  if (editingMs !== undefined) signals.editingMs = editingMs
  const untouchedDays = bounded(raw['untouchedDays'], HERMAN_SIGNAL_LIMITS.untouchedDays, 'signals')
  if (untouchedDays !== undefined) signals.untouchedDays = Math.floor(untouchedDays)
  return signals
}

export function hermanFeedback(value: unknown): HermanFeedback | undefined {
  if (value === undefined || value === null) return undefined
  if (value !== 'not-now' && value !== 'fewer') throw new Error('Invalid feedback')
  return value
}

export function nudgeId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64 || !/^[A-Za-z0-9-]+$/.test(value)) throw new Error('Invalid nudge id')
  return value
}

/** His lines exist in two languages: the one set for AI answers when it is one of them, else the system's. */
export function hermanLocale(aiLanguage: unknown, systemLocale: string | undefined): HermanLocale {
  if (isAiLanguage(aiLanguage)) return aiLanguage === 'pt-BR' ? 'pt-BR' : 'en'
  return typeof systemLocale === 'string' && /^pt\b/i.test(systemLocale) ? 'pt-BR' : 'en'
}

export class HermanService {
  private readonly now: () => number
  private readonly random: () => number
  /** Whether this run of the app is the first of its local day; decided once, at construction. */
  private readonly firstLaunchDay: string | null
  private readonly startedAt: number
  /** When tasks were completed lately, oldest first. */
  private completions: number[] = []

  constructor(private readonly deps: HermanDeps) {
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.startedAt = this.now()
    const today = localDay(this.startedAt)
    const memory = this.memory()
    this.firstLaunchDay = memory.launchDay === today ? null : today
    if (memory.launchDay !== today) this.remember({ ...memory, launchDay: today })
  }

  // ---- settings and memory ----------------------------------------------------

  private setting(key: string): unknown {
    try {
      return this.deps.getSetting(key)
    } catch {
      return null
    }
  }

  private memory(): HermanMemory {
    return readMemory(this.setting(MEMORY_KEY))
  }

  private remember(memory: HermanMemory): void {
    try {
      this.deps.setSetting(MEMORY_KEY, memory)
    } catch (err) {
      // He will have forgotten; nothing else depends on it.
      console.error('[herman] could not remember', err)
    }
  }

  private locale(): HermanLocale {
    return hermanLocale(this.setting('ai.language'), this.deps.systemLocale?.())
  }

  private config(): SchedulerConfig {
    const frequency = FREQUENCIES[hermanSetting('frequency', this.setting('herman.frequency'))]
    const quietHours = hermanSetting('quietHours', this.setting('herman.quietHours'))
    const { fast } = this.deps
    if (fast) return { gapMs: fast.gapMs, perDay: Number.MAX_SAFE_INTEGER, idleMs: fast.idleMs, quietHours: null }
    return { ...frequency, idleMs: IDLE_MS, quietHours }
  }

  private nudgesOn(): boolean {
    return hermanSetting('enabled', this.setting('herman.enabled')) && hermanSetting('nudges', this.setting('herman.nudges'))
  }

  // ---- what a window asks -------------------------------------------------------

  state(): HermanState {
    const locale = this.locale()
    const phrases = PHRASES[locale]
    const memory = this.memory()
    const quietHours = hermanSetting('quietHours', this.setting('herman.quietHours'))
    return {
      enabled: hermanSetting('enabled', this.setting('herman.enabled')),
      voice: hermanSetting('voice', this.setting('herman.voice')),
      nudges: hermanSetting('nudges', this.setting('herman.nudges')),
      frequency: hermanSetting('frequency', this.setting('herman.frequency')),
      quietHours,
      size: hermanSetting('size', this.setting('herman.size')),
      corner: hermanSetting('corner', this.setting('herman.corner')),
      locale,
      greeting: memory.met ? null : phrases.greeting,
      quiet: !this.deps.fast && isQuiet(quietHours, this.now()),
      lines: { aiOff: phrases.aiOff, notNow: phrases.notNow, fewer: phrases.fewer }
    }
  }

  /** He has introduced himself. */
  met(): void {
    const memory = this.memory()
    // The introduction counts as having spoken: the first nudge keeps its distance from it.
    if (!memory.met) this.remember({ ...memory, met: true, lastAt: Math.max(memory.lastAt, this.now()) })
  }

  reset(): void {
    this.remember(forget(this.memory()))
    this.completions = []
  }

  /**
   * "Do you have something to say?" Most of the time: no, and when to ask again. `busy` is what
   * this process knows by itself (a recording, a window that is full screen or not in front).
   */
  async next(rawSignals: unknown, busy = false): Promise<HermanNudgeReply> {
    const signals = hermanSignals(rawSignals)
    return this.offer({ idleMs: signals.idleMs, busy: busy || signals.busy === true }, signals)
  }

  /**
   * A task was marked done. Three in a row are worth a word, said at once to the window that
   * ticked them: the user is clicking, not typing, so the idle rule does not apply. Every other
   * rule does.
   */
  async completed(busy = false): Promise<HermanNudge | null> {
    const now = this.now()
    const last = this.completions[this.completions.length - 1]
    if (last !== undefined && now - last > STREAK_GAP_MS) this.completions = []
    this.completions.push(now)
    const limit = this.deps.thresholds?.streak ?? COUNSEL_DEFAULTS.streak
    if (this.completions.length !== limit) return null
    const reply = await this.offer({ idleMs: Number.MAX_SAFE_INTEGER, busy }, null, ['streak'])
    return reply.nudge
  }

  /** A completion was taken back. */
  uncompleted(): void {
    this.completions.pop()
  }

  private async offer(moment: { idleMs: number; busy: boolean }, signals: HermanSignals | null, only?: HermanNudgeKind[]): Promise<HermanNudgeReply> {
    const now = this.now()
    const config = this.config()
    const stored = this.memory()
    const decision = decide(config, stored, { now, idleMs: moment.idleMs, busy: moment.busy, enabled: this.nudgesOn() })
    if (!decision.ok) return { nudge: null, waitMs: decision.waitMs }
    // Before he has introduced himself there is nothing for him to add.
    if (!stored.met) return { nudge: null, waitMs: RETRY_MS }
    const memory = forDay(stored, now)

    let day: HermanDay = { tasks: { overdue: [], today: [] }, events: [] }
    try {
      day = await this.deps.day()
    } catch (err) {
      // Without the tasks and the agenda he can still notice a long sitting or the hour.
      console.error('[herman] could not read the day', err)
    }
    const { fast } = this.deps
    const input: CounselInput = {
      now,
      locale: this.locale(),
      tasks: day.tasks,
      events: day.events,
      firstLaunch: this.firstLaunchDay === localDay(now) && now - this.startedAt < LAUNCH_WINDOW_MS,
      // A streak is of the moment: completions of a while ago no longer count.
      streak: now - (this.completions[this.completions.length - 1] ?? 0) <= STREAK_GAP_MS ? this.completions.length : 0,
      lastKind: memory.lastKind,
      saidToday: memory.said,
      weights: memory.weights,
      recent: memory.recent,
      random: this.random,
      ...(this.deps.thresholds ? { thresholds: this.deps.thresholds } : {}),
      ...(only ? { only } : {})
    }
    if (signals?.editingMs !== undefined) input.editingMs = signals.editingMs * (fast?.editingScale ?? 1)
    if (signals?.pageId && signals.untouchedDays !== undefined && this.deps.pageExists(signals.pageId)) input.reopened = { pageId: signals.pageId, days: signals.untouchedDays }
    const counsel = compose(input)
    if (!counsel) return { nudge: null, waitMs: fast ? fast.idleMs : RETRY_MS }

    const nudge: HermanNudge = { id: randomUUID(), kind: counsel.kind, text: counsel.text, ...(counsel.action ? { action: counsel.action } : {}) }
    this.remember(record(memory, { id: nudge.id, kind: nudge.kind, variant: counsel.variant }, now))
    return { nudge, waitMs: config.gapMs }
  }

  /** A nudge was put away, with or without an answer. */
  dismiss(rawId: unknown, rawFeedback: unknown): void {
    const id = nudgeId(rawId)
    const answer = hermanFeedback(rawFeedback)
    const memory = this.memory()
    const next = feedback(memory, id, answer, this.now())
    if (next !== memory) this.remember(next)
  }
}
