import {
  advanceTimer,
  finishTimer,
  nextPhase,
  pauseTimer,
  POMODORO_HISTORY_KEY,
  POMODORO_HISTORY_MAX,
  readPomodoroSettings,
  resumeTimer,
  skipTimer,
  startTimer,
  type PomodoroCompleted,
  type PomodoroEnded,
  type PomodoroSettings,
  type PomodoroSnapshot,
  type PomodoroTimer
} from '../../shared/pomodoro'

/**
 * The one pomodoro timer of the app: its state, the clock that ends each phase, and what happens
 * then. Kept in the main process, so a window that reloads finds it as it was and every window
 * shows the same; it lives as long as the app (closing sel ends it). Free of Electron: the
 * windows, the system notification and the clock are handed in (./register.ts), and the tests
 * hand in fakes.
 */

export interface PomodoroDeps {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  now(): number
  timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
  locale(): 'en' | 'pt-BR'
  /** A meeting is being recorded: a phase ends without a sound or a notification. */
  recording(): boolean
  /** The state changed: every window shows it. */
  publish(snapshot: PomodoroSnapshot): void
  /** A phase ended: one window rings and asks what next (and the system notifies when no window is in front). */
  ended(ended: PomodoroEnded, snapshot: PomodoroSnapshot): void
  /** A focus phase ran to its end. */
  completed(event: PomodoroCompleted): void
}

/** The longest a single timeout is set for; a longer wait (or one that fired early) is made of several. */
const MAX_TIMEOUT_MS = 60 * 60_000

export class PomodoroService {
  private timer: PomodoroTimer | null = null
  private handle: unknown = null

  constructor(private readonly deps: PomodoroDeps) {}

  settings(): PomodoroSettings {
    return readPomodoroSettings((key) => this.deps.getSetting(key))
  }

  snapshot(): PomodoroSnapshot {
    return { timer: this.timer, settings: this.settings(), locale: this.deps.locale() }
  }

  start(): PomodoroSnapshot {
    return this.set(startTimer(this.settings(), this.deps.now()))
  }

  pause(): PomodoroSnapshot {
    return this.timer ? this.set(pauseTimer(this.timer, this.deps.now())) : this.snapshot()
  }

  resume(): PomodoroSnapshot {
    return this.timer ? this.set(resumeTimer(this.timer, this.deps.now())) : this.snapshot()
  }

  skip(): PomodoroSnapshot {
    return this.timer ? this.set(skipTimer(this.timer, this.settings(), this.deps.now())) : this.snapshot()
  }

  /** Starts the phase the end of the last one asked about; does nothing while a phase still runs. */
  next(): PomodoroSnapshot {
    return this.timer?.ended ? this.set(advanceTimer(this.timer, this.settings(), this.deps.now())) : this.snapshot()
  }

  stop(): PomodoroSnapshot {
    return this.set(null)
  }

  /** The settings changed: the windows show the new ones (a running phase keeps its length). */
  settingChanged(): void {
    this.deps.publish(this.snapshot())
  }

  /** Looks at the clock now (the computer woke up, or the timer fired). */
  check(): void {
    const timer = this.timer
    if (!timer) return
    const now = this.deps.now()
    const { timer: after, completed } = finishTimer(timer, now)
    if (after === timer) return this.schedule()
    this.timer = after
    this.schedule()
    const snapshot = this.snapshot()
    this.deps.publish(snapshot)
    if (completed) {
      const event: PomodoroCompleted = { at: now, minutes: Math.round(timer.duration / 60_000) }
      this.remember(event)
      this.deps.completed(event)
    }
    this.deps.ended({ phase: after.phase, next: nextPhase(after, snapshot.settings), sound: !this.deps.recording() }, snapshot)
  }

  dispose(): void {
    this.clear()
  }

  private set(timer: PomodoroTimer | null): PomodoroSnapshot {
    this.timer = timer
    this.schedule()
    const snapshot = this.snapshot()
    this.deps.publish(snapshot)
    return snapshot
  }

  private clear(): void {
    if (this.handle !== null) this.deps.timers.clear(this.handle)
    this.handle = null
  }

  private schedule(): void {
    this.clear()
    const timer = this.timer
    if (!timer || timer.paused || timer.ended || timer.endsAt === null) return
    const wait = Math.min(MAX_TIMEOUT_MS, Math.max(0, timer.endsAt - this.deps.now()))
    this.handle = this.deps.timers.set(() => {
      this.handle = null
      this.check()
    }, wait)
  }

  /** The focus phases that ran to their end, newest last: the least the garden will need. */
  private remember(event: PomodoroCompleted): void {
    try {
      const stored = this.deps.getSetting(POMODORO_HISTORY_KEY)
      const list = Array.isArray(stored) ? stored.filter((entry): entry is PomodoroCompleted => isCompleted(entry)) : []
      list.push(event)
      this.deps.setSetting(POMODORO_HISTORY_KEY, list.slice(-POMODORO_HISTORY_MAX))
    } catch (err) {
      console.error('[pomodoro] could not remember a finished pomodoro', err)
    }
  }
}

function isCompleted(value: unknown): value is PomodoroCompleted {
  if (value === null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw['at'] === 'number' && Number.isFinite(raw['at']) && typeof raw['minutes'] === 'number' && Number.isFinite(raw['minutes'])
  )
}
