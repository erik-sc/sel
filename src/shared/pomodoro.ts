/**
 * The pomodoro timer: a phase of focus, then a short pause, again, and a long pause after every
 * few focus phases. The main process keeps the one timer (src/main/pomodoro), so it outlives a
 * reload and every window shows the same; a window shows it in the corner of the content
 * (renderer/src/pomodoro) and asks before the next phase starts: a phase never begins by itself.
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */

import type { SettingsSpec } from './settings'
import type { InvokeChannels } from './ipc'
import type { CommandSpec } from './commands'

export type PomodoroPhase = 'focus' | 'short' | 'long'

export interface PomodoroSettings {
  /** Minutes of a focus phase. */
  focus: number
  /** Minutes of a short pause. */
  short: number
  /** Minutes of a long pause. */
  long: number
  /** A long pause instead of a short one after this many focus phases. */
  longEvery: number
  /** The window that starts a pomodoro enters focus mode. */
  focusMode: boolean
}

export const POMODORO_DEFAULTS: PomodoroSettings = { focus: 25, short: 5, long: 15, longEvery: 4, focusMode: false }

/** The bounds of each number a renderer may store. */
export const POMODORO_LIMITS = {
  focus: { min: 1, max: 180 },
  short: { min: 1, max: 60 },
  long: { min: 1, max: 120 },
  longEvery: { min: 2, max: 12 }
} as const

/**
 * The running timer. While it runs `endsAt` says when the phase is over; while paused `left` says
 * how much of it is left. Once over (`ended`) it waits for the user to start the next phase.
 */
export interface PomodoroTimer {
  phase: PomodoroPhase
  /** The whole length of this phase (ms), for the progress shown. */
  duration: number
  /** When the phase ends (ms since the epoch), while it runs; null while paused or over. */
  endsAt: number | null
  /** What is left of the phase (ms) while paused; 0 once over. */
  left: number
  paused: boolean
  /** The phase is over and the next one waits to be started. */
  ended: boolean
  /** Focus phases behind in this run (finished or skipped): where it is in the set of `longEvery`. */
  cycle: number
}

/** What a window shows: the timer (null when no pomodoro is on), the settings, the language. */
export interface PomodoroSnapshot {
  timer: PomodoroTimer | null
  settings: PomodoroSettings
  locale: 'en' | 'pt-BR'
}

/** A phase came to its end. Sent to the one window that rings. */
export interface PomodoroEnded {
  phase: PomodoroPhase
  /** What the window asks to start next. */
  next: PomodoroPhase
  /** False while a meeting is recorded: the window stays silent. */
  sound: boolean
}

/**
 * `pomodoro:completed`: a focus phase ran to its end (not one skipped or stopped). The garden
 * (docs/plans/release-0.6.0.md, section 6) grows from these.
 */
export interface PomodoroCompleted {
  /** When it ended (ms since the epoch). */
  at: number
  /** How long it was, in minutes. */
  minutes: number
}

export interface PomodoroApi {
  state(): Promise<PomodoroSnapshot>
  /** Starts a new pomodoro at its first focus phase, whatever was running. */
  start(): Promise<PomodoroSnapshot>
  pause(): Promise<PomodoroSnapshot>
  resume(): Promise<PomodoroSnapshot>
  /** Leaves the current phase and starts the next one now. */
  skip(): Promise<PomodoroSnapshot>
  /** The phase is over: starts the next one (the answer to "A 5 min pause?"). */
  next(): Promise<PomodoroSnapshot>
  /** Ends the pomodoro: the widget goes away. */
  stop(): Promise<PomodoroSnapshot>
  /** `pomodoro:changed`, to every window. Returns an unsubscribe function. */
  onChanged(listener: (snapshot: PomodoroSnapshot) => void): () => void
  /** `pomodoro:ended`, to the window that rings. Returns an unsubscribe function. */
  onEnded(listener: (ended: PomodoroEnded) => void): () => void
  /** `pomodoro:completed`, to every window. Returns an unsubscribe function. */
  onCompleted(listener: (completed: PomodoroCompleted) => void): () => void
}

export const POMODORO_CHANNELS = {
  changed: 'pomodoro:changed',
  ended: 'pomodoro:ended',
  completed: 'pomodoro:completed'
} as const

// ---- settings -----------------------------------------------------------------

export const POMODORO_SETTING: Record<keyof PomodoroSettings, string> = {
  focus: 'pomodoro.focus',
  short: 'pomodoro.short',
  long: 'pomodoro.long',
  longEvery: 'pomodoro.longEvery',
  focusMode: 'pomodoro.focusMode'
}

/** The keys a renderer may write. None is synced: the timer belongs to this device. */
export const POMODORO_KEYS = Object.values(POMODORO_SETTING)

/** Focus phases that ran to their end, kept by the main process (never written by a renderer). */
export const POMODORO_HISTORY_KEY = 'pomodoro.completed'
/** How many of them are kept, newest last. */
export const POMODORO_HISTORY_MAX = 2000

/** The value a pomodoro setting accepts from a renderer, or undefined when it does not. */
export function cleanPomodoroSetting(key: string, value: unknown): unknown {
  if (key === POMODORO_SETTING.focusMode) return typeof value === 'boolean' ? value : undefined
  const name = (Object.keys(POMODORO_LIMITS) as (keyof typeof POMODORO_LIMITS)[]).find((entry) => POMODORO_SETTING[entry] === key)
  if (!name) return undefined
  const { min, max } = POMODORO_LIMITS[name]
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined
}

/** The settings as stored, each one its default when nothing valid is stored. */
export function readPomodoroSettings(get: (key: string) => unknown): PomodoroSettings {
  const out: PomodoroSettings = { ...POMODORO_DEFAULTS }
  for (const name of Object.keys(POMODORO_SETTING) as (keyof PomodoroSettings)[]) {
    let stored: unknown
    try {
      stored = get(POMODORO_SETTING[name])
    } catch {
      stored = undefined
    }
    const clean = stored === null || stored === undefined ? undefined : cleanPomodoroSetting(POMODORO_SETTING[name], stored)
    if (clean !== undefined) (out as unknown as Record<string, unknown>)[name] = clean
  }
  return out
}

// ---- the timer ------------------------------------------------------------------

const MINUTE = 60_000

export function phaseMinutes(phase: PomodoroPhase, settings: PomodoroSettings): number {
  return phase === 'focus' ? settings.focus : phase === 'short' ? settings.short : settings.long
}

function begin(phase: PomodoroPhase, cycle: number, settings: PomodoroSettings, now: number): PomodoroTimer {
  const duration = phaseMinutes(phase, settings) * MINUTE
  return { phase, duration, endsAt: now + duration, left: duration, paused: false, ended: false, cycle }
}

/** A new pomodoro: its first focus phase, running. */
export function startTimer(settings: PomodoroSettings, now: number): PomodoroTimer {
  return begin('focus', 0, settings, now)
}

/** What is left of the phase at `now` (ms, never below 0). */
export function remaining(timer: PomodoroTimer, now: number): number {
  if (timer.ended) return 0
  if (timer.paused || timer.endsAt === null) return Math.max(0, timer.left)
  return Math.max(0, timer.endsAt - now)
}

/**
 * The phase that follows this one. After a focus phase that is the last of a set of `longEvery`,
 * the long pause; after any other, the short one; after a pause, focus. A focus phase counts
 * toward the set once it is behind (`cycle` already includes it when `ended`).
 */
export function nextPhase(timer: PomodoroTimer, settings: PomodoroSettings): PomodoroPhase {
  if (timer.phase !== 'focus') return 'focus'
  const behind = timer.ended ? timer.cycle : timer.cycle + 1
  return behind > 0 && behind % settings.longEvery === 0 ? 'long' : 'short'
}

export function pauseTimer(timer: PomodoroTimer, now: number): PomodoroTimer {
  if (timer.paused || timer.ended) return timer
  return { ...timer, paused: true, endsAt: null, left: remaining(timer, now) }
}

export function resumeTimer(timer: PomodoroTimer, now: number): PomodoroTimer {
  if (!timer.paused || timer.ended) return timer
  return { ...timer, paused: false, endsAt: now + timer.left }
}

/**
 * The phase ran out: it waits for the user. A focus phase is counted (`completed`); the caller
 * tells the garden. Nothing changes before `endsAt`, or while paused.
 */
export function finishTimer(timer: PomodoroTimer, now: number): { timer: PomodoroTimer; completed: boolean } {
  if (timer.ended || timer.paused || timer.endsAt === null || timer.endsAt > now) return { timer, completed: false }
  const focus = timer.phase === 'focus'
  return { timer: { ...timer, endsAt: null, left: 0, ended: true, cycle: focus ? timer.cycle + 1 : timer.cycle }, completed: focus }
}

/** The answer to the question at the end of a phase: the next phase starts now. */
export function advanceTimer(timer: PomodoroTimer, settings: PomodoroSettings, now: number): PomodoroTimer {
  return begin(nextPhase(timer, settings), timer.cycle, settings, now)
}

/**
 * Leaves the phase before its end and starts the next one now. A skipped focus phase still moves
 * the set along (the pause that follows is the one its place calls for) but is not completed.
 * At the question at the end of a phase, it skips the phase asked about ("Skip the break").
 */
export function skipTimer(timer: PomodoroTimer, settings: PomodoroSettings, now: number): PomodoroTimer {
  if (timer.ended) return skipTimer(advanceTimer(timer, settings, now), settings, now)
  const next = nextPhase(timer, settings)
  return begin(next, timer.phase === 'focus' ? timer.cycle + 1 : timer.cycle, settings, now)
}

/** `mm:ss`, or `h:mm:ss` from an hour up, rounding up so that a phase never shows 00:00 before its end. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const two = (n: number): string => String(n).padStart(2, '0')
  const rest = `${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`
  return total >= 3600 ? `${Math.floor(total / 3600)}:${rest}` : rest
}

/** The pomodoro's lengths (whole minutes in a range) and whether starting one enters focus mode. */
export const POMODORO_SETTINGS: SettingsSpec = { keys: POMODORO_KEYS, clean: cleanPomodoroSetting }

/** The invoke channels of `api.pomodoro` (see `INVOKE` in ./api.ts): every method of PomodoroApi that returns a promise, and no other. */
export const POMODORO_INVOKE = {
  'pomodoro:state': true,
  'pomodoro:start': true,
  'pomodoro:pause': true,
  'pomodoro:resume': true,
  'pomodoro:skip': true,
  'pomodoro:next': true,
  'pomodoro:stop': true
} as const satisfies Record<InvokeChannels<{ pomodoro: PomodoroApi }>, true>

/**
 * Starting a pomodoro, or with one on showing its controls (see ./commands.ts). Its palette
 * entries are the pomodoro's own (renderer/src/pomodoro/gate.ts): they follow the timer.
 */
export const POMODORO_COMMANDS = [
  {
    id: 'start-pomodoro',
    shortcut: { accelerator: 'CmdOrCtrl+Alt+P', key: 'p', ctrl: true, alt: true },
    menu: { submenu: 'view', label: 'Start a Pomodoro', order: 280 },
    catalog: { group: 'navigation', label: 'Start a pomodoro, or show its controls', keywords: ['timer', 'focus', 'break'], order: 210 }
  }
] as const satisfies readonly CommandSpec[]
