import { randomUUID } from 'node:crypto'
import { AI_CONTEXT_KEY } from '../../shared/aiContext'
import type { AiSent } from '../../shared/aiContext'
import { AI_USAGE_KEY, readUsage, routineRequests, usageSummary, type UsageSummary } from '../../shared/aiUsage'
import { localDay } from '../../shared/briefing'
import { hermanSetting, type HermanLocale } from '../../shared/herman'
import {
  anyRoutineOn,
  isRoutineId,
  readRoutines,
  ROUTINES_KEY,
  type RoutineId,
  type RoutineOffer,
  type RoutineReply,
  type RoutineSignals,
  type RoutinesSettings
} from '../../shared/routines'
import * as arg from '../validate'
import type { CloseData, DayData, StalledData } from './data'
import { ROUTINE_WORDS } from './lines'
import { buildRoutinePrompt, type RoutinePromptOptions } from './prompts'
import {
  DELIVERY_GAP_MS,
  dueRoutine,
  fastDue,
  markRan,
  mayDeliver,
  readState,
  recentlyOffered,
  ROUTINES_STATE_KEY,
  TICK_MS,
  type RoutinesState
} from './schedule'

/**
 * The routines as the app runs them: what is on, what ran today, what waits to be said, and the
 * daily limit. Free of Electron imports; the settings, the day's data, the AI and the windows are
 * handed in by ./register.ts, and the clock too, so that the tests drive it with a fake one.
 *
 * Nothing here writes to the workspace: a routine's answer is held until a window may show it,
 * and only the user's Apply in the balloon changes anything.
 */

/** What a routine hands the AI: the prompt, built once the service knows the language, the voice and the tools. */
export type RoutineBuild = (options: Omit<RoutinePromptOptions, 'nonce'>) => string

export interface RoutineAnswer {
  text: string
  sent?: AiSent
}

export interface RoutinesDeps {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  now?: () => number
  locale(): HermanLocale
  /** The day as the routines read it (./data.ts), from what is stored. */
  read: {
    day(): Promise<DayData>
    close(): Promise<CloseData>
    /** The most stuck task, leaving out those in `skip`; null when nothing is. */
    stalled(skip: ReadonlySet<string>): Promise<StalledData | null>
  }
  /**
   * Runs one routine's prompt through the AI service, counted under `routine:<id>`; resolves with
   * the answer. `tools`: the workspace tools and the user's servers, read only.
   */
  ask(routine: RoutineId, build: RoutineBuild, options: { tools: boolean; context: string }): Promise<RoutineAnswer>
  /** Something is ready: the windows are told to ask. */
  notify(): void
  /**
   * Development and automated checks of the UI only (an unpackaged build with
   * `SEL_ROUTINES_FAST=1`, see ./register.ts): every routine that is on runs at once, at any hour,
   * and what it prepared is said without waiting for the gap. A shipped app never sets it.
   */
  fast?: boolean
}

interface Pending {
  offer: RoutineOffer
  /** Said no later than this; afterwards it is stale and dropped. */
  until: number
}

function endOfDay(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

export class RoutinesService {
  private readonly now: () => number
  private pending: Pending[] = []
  /** The routine running now, if any: one at a time. */
  private running: RoutineId | null = null

  constructor(private readonly deps: RoutinesDeps) {
    this.now = deps.now ?? Date.now
  }

  // ---- settings and memory -----------------------------------------------------

  private setting(key: string): unknown {
    try {
      return this.deps.getSetting(key)
    } catch {
      return null
    }
  }

  settings(): RoutinesSettings {
    return readRoutines(this.setting(ROUTINES_KEY))
  }

  state(): RoutinesState {
    return readState(this.setting(ROUTINES_STATE_KEY))
  }

  private remember(state: RoutinesState): void {
    try {
      this.deps.setSetting(ROUTINES_STATE_KEY, state)
    } catch (err) {
      console.error('[routines] could not remember', err)
    }
  }

  private quiet() {
    return hermanSetting('quietHours', this.setting('herman.quietHours'))
  }

  private aiOn(): boolean {
    return this.setting('ai.enabled') !== false
  }

  /** Requests the routines made today, and whether they may make another. */
  private limitReached(now: number): boolean {
    return routineRequests(readUsage(this.setting(AI_USAGE_KEY)), localDay(now)) >= this.settings().limit
  }

  usage(): UsageSummary {
    return usageSummary(readUsage(this.setting(AI_USAGE_KEY)), localDay(this.now()), this.settings().limit)
  }

  /** True while a routine is on: the clock is worth looking at. */
  active(): boolean {
    return anyRoutineOn(this.settings())
  }

  // ---- the clock ----------------------------------------------------------------------

  /**
   * Looks at the clock: runs the routine that is due, if any, and says when to look again.
   * Missed routines are let go (see ./schedule.ts `dueRoutine`).
   */
  async tick(): Promise<number> {
    if (this.running) return TICK_MS
    const settings = this.settings()
    if (!anyRoutineOn(settings) || !this.aiOn()) return 30 * TICK_MS
    const now = this.now()
    const decision = this.deps.fast ? fastDue(settings, this.state(), now) : dueRoutine(settings, this.state(), now, this.quiet())
    if (!decision.run) return decision.waitMs
    this.remember(markRan(this.state(), [decision.run, ...decision.skip], now))
    const offer = await this.perform(decision.run, false)
    if (offer) this.hold(offer, now)
    return TICK_MS
  }

  /** Something to say later, in place of what the same routine prepared before. */
  private hold(offer: RoutineOffer, now: number): void {
    this.pending = [...this.pending.filter((entry) => entry.offer.routine !== offer.routine), { offer, until: endOfDay(now) }]
    this.deps.notify()
  }

  /** A routine turned off: what it prepared is not said any more. */
  settingsChanged(): void {
    const settings = this.settings()
    this.pending = this.pending.filter((entry) => entry.offer.routine === 'limit' || settings.routines[entry.offer.routine].on)
  }

  // ---- a routine ----------------------------------------------------------------------

  /**
   * Runs one routine and returns what the persona would say for it, or null when there is nothing
   * (AI off, nothing stuck, the AI failed). `manual`: the user asked for it now ("Run routine
   * now"): the daily limit does not stop it, and a failure is thrown for the window to show.
   */
  async perform(id: RoutineId, manual: boolean): Promise<RoutineOffer | null> {
    const locale = this.deps.locale()
    const words = ROUTINE_WORDS[locale]
    const now = this.now()
    if (id === 'weekly') {
      const w = words.weekly
      return { id: randomUUID(), routine: 'weekly', kind: 'review', line: w.line, label: w.label }
    }
    if (!this.aiOn()) {
      if (manual) throw new Error('AI is turned off in Settings.')
      return null
    }
    if (this.running) {
      if (manual) return { id: randomUUID(), routine: id, kind: 'note', line: words.busy }
      return null
    }
    if (!manual && this.limitReached(now)) {
      const state = this.state()
      const today = localDay(now)
      if (state.limitSaid === today) return null
      this.remember({ ...state, limitSaid: today })
      return { id: randomUUID(), routine: 'limit', kind: 'note', line: words.limit }
    }
    this.running = id
    try {
      let build: RoutineBuild
      let w = words.morning
      if (id === 'stalled') {
        const state = this.state()
        const found = await this.deps.read.stalled(recentlyOffered(state, localDay(now)))
        if (!found) return manual ? { id: randomUUID(), routine: id, kind: 'note', line: words.nothingStalled } : null
        // Offered once: not again for a while, whatever the user does with it.
        this.remember({ ...this.state(), offered: [...state.offered, { id: found.task.id, day: localDay(now) }].slice(-30) })
        w = words.stalled(found.task.title)
        build = (options) => buildRoutinePrompt('stalled', found, options)
      } else if (id === 'morning') {
        const data = await this.deps.read.day()
        w = words.morning
        build = (options) => buildRoutinePrompt('morning', data, options)
      } else {
        const data = await this.deps.read.close()
        w = words[id]
        build = (options) => buildRoutinePrompt(id, data, options)
      }
      const context = this.setting(AI_CONTEXT_KEY)
      const answer = await this.deps.ask(id, build, {
        // The morning plan may look further: the workspace, and the user's own servers (read only).
        tools: id === 'morning',
        context: typeof context === 'string' ? context : ''
      })
      if (!answer.text.trim()) return null
      return {
        id: randomUUID(),
        routine: id,
        kind: 'balloon',
        line: w.line,
        label: w.label,
        delivery: {
          title: w.title,
          request: w.request,
          answer: answer.text,
          source: `routine:${id}`,
          today: true,
          ...(answer.sent ? { sent: answer.sent } : {})
        }
      }
    } catch (err) {
      if (manual) throw err
      console.error(`[routines] the ${id} routine failed`, err)
      return null
    } finally {
      this.running = null
    }
  }

  /** "Run routine now": the routine runs at once, whatever its time; what it prepared opens right away. */
  async runNow(rawId: unknown): Promise<RoutineOffer | null> {
    if (!isRoutineId(rawId)) throw new Error('Unknown routine')
    return this.perform(rawId, true)
  }

  // ---- what a window asks ---------------------------------------------------------------

  /** "Is anything ready, and may it be said now?" `busy` is what this process knows by itself. */
  next(rawSignals: unknown, busy = false): RoutineReply {
    const raw = arg.plainObject(rawSignals, 'signals')
    const idleMs = raw['idleMs']
    if (typeof idleMs !== 'number' || !Number.isFinite(idleMs) || idleMs < 0) throw new Error('Invalid signals')
    if (raw['busy'] !== undefined && typeof raw['busy'] !== 'boolean') throw new Error('Invalid signals')
    const signals: RoutineSignals = { idleMs, busy: raw['busy'] === true }
    const now = this.now()
    this.pending = this.pending.filter((entry) => entry.until > now)
    const state = this.state()
    const decision = mayDeliver(
      state,
      { now, idleMs: signals.idleMs, busy: busy || signals.busy === true, pending: this.pending.length > 0 },
      this.quiet(),
      this.deps.fast === true
    )
    if (!decision.ok) return { offer: null, waitMs: decision.waitMs }
    const [first, ...rest] = this.pending
    this.pending = rest
    this.remember({ ...state, lastSaidAt: now })
    return { offer: first.offer, waitMs: rest.length ? DELIVERY_GAP_MS : 10 * 60_000 }
  }

  /** For tests and diagnostics. */
  waiting(): RoutineOffer[] {
    return this.pending.map((entry) => entry.offer)
  }
}
