import { describe, expect, it } from 'vitest'
import {
  POMODORO_HISTORY_KEY,
  POMODORO_SETTING,
  type PomodoroCompleted,
  type PomodoroEnded,
  type PomodoroSnapshot
} from '../../shared/pomodoro'
import { PomodoroService } from './service'

const MIN = 60_000

/** A service on a clock the test moves by hand. */
function setup(settings: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(settings))
  let now = 1_000_000
  let pending: { run: () => void; at: number } | null = null
  let recording = false
  const published: PomodoroSnapshot[] = []
  const ended: PomodoroEnded[] = []
  const completed: PomodoroCompleted[] = []
  const service = new PomodoroService({
    getSetting: (key) => store.get(key) ?? null,
    setSetting: (key, value) => void store.set(key, value),
    now: () => now,
    timers: {
      set: (run, ms) => (pending = { run, at: now + ms }),
      clear: (handle) => {
        if (pending === handle) pending = null
      }
    },
    locale: () => 'pt-BR',
    recording: () => recording,
    publish: (snapshot) => published.push(snapshot),
    ended: (event) => ended.push(event),
    completed: (event) => completed.push(event)
  })
  /** Moves the clock on, firing the timer when its time comes. */
  const advance = (ms: number): void => {
    const until = now + ms
    while (pending && pending.at <= until) {
      const { run, at } = pending
      pending = null
      now = at
      run()
    }
    now = until
  }
  return {
    service,
    store,
    published,
    ended,
    completed,
    advance,
    record: (on: boolean) => (recording = on),
    /** Moves the clock on without the timer firing (the computer slept). */
    jump: (ms: number) => (now += ms),
    pending: () => pending
  }
}

describe('the pomodoro service', () => {
  it('starts, tells every window, and ends the focus phase on time with a sound and the question', () => {
    const t = setup()
    const started = t.service.start()
    expect(started.timer).toMatchObject({ phase: 'focus', duration: 25 * MIN })
    expect(started.locale).toBe('pt-BR')
    expect(t.published).toHaveLength(1)
    t.advance(25 * MIN - 1)
    expect(t.ended).toEqual([])
    t.advance(1)
    expect(t.ended).toEqual([{ phase: 'focus', next: 'short', sound: true }])
    expect(t.service.snapshot().timer).toMatchObject({ ended: true, cycle: 1 })
    expect(t.published.at(-1)?.timer?.ended).toBe(true)
  })

  it('emits pomodoro:completed for a focus phase run to its end, and keeps it', () => {
    const t = setup()
    t.service.start()
    t.advance(25 * MIN)
    expect(t.completed).toHaveLength(1)
    expect(t.completed[0].minutes).toBe(25)
    expect(t.store.get(POMODORO_HISTORY_KEY)).toEqual(t.completed)
    // A break run to its end is not one.
    t.service.next()
    t.advance(5 * MIN)
    expect(t.ended.map((e) => e.phase)).toEqual(['focus', 'short'])
    expect(t.completed).toHaveLength(1)
  })

  it('does not start the next phase by itself', () => {
    const t = setup()
    t.service.start()
    t.advance(25 * MIN)
    t.advance(60 * MIN)
    expect(t.service.snapshot().timer).toMatchObject({ phase: 'focus', ended: true })
    expect(t.pending()).toBeNull()
    expect(t.service.next().timer).toMatchObject({ phase: 'short', ended: false })
  })

  it('keeps the time left across a pause and ends on time after the resume', () => {
    const t = setup()
    t.service.start()
    t.advance(10 * MIN)
    expect(t.service.pause().timer).toMatchObject({ paused: true, left: 15 * MIN })
    t.advance(120 * MIN)
    expect(t.ended).toEqual([])
    t.service.resume()
    t.advance(15 * MIN - 1)
    expect(t.ended).toEqual([])
    t.advance(1)
    expect(t.ended).toHaveLength(1)
  })

  it('skips without counting the skipped focus phase', () => {
    const t = setup()
    t.service.start()
    t.advance(MIN)
    expect(t.service.skip().timer).toMatchObject({ phase: 'short', cycle: 1 })
    t.advance(5 * MIN)
    expect(t.completed).toEqual([])
    expect(t.ended).toEqual([{ phase: 'short', next: 'focus', sound: true }])
  })

  it('takes the lengths from the settings, and a running phase keeps its own when they change', () => {
    const t = setup({ [POMODORO_SETTING.focus]: 50, [POMODORO_SETTING.longEvery]: 2 })
    t.service.start()
    t.store.set(POMODORO_SETTING.focus, 20)
    t.service.settingChanged()
    expect(t.published.at(-1)?.settings.focus).toBe(20)
    t.advance(20 * MIN)
    expect(t.ended).toEqual([])
    t.advance(30 * MIN)
    expect(t.ended).toHaveLength(1)
  })

  it('stays silent while a meeting is recorded, and the question still waits', () => {
    const t = setup()
    t.service.start()
    t.record(true)
    t.advance(25 * MIN)
    expect(t.ended).toEqual([{ phase: 'focus', next: 'short', sound: false }])
    expect(t.service.snapshot().timer?.ended).toBe(true)
  })

  it('stops: nothing left to show and no timer set', () => {
    const t = setup()
    t.service.start()
    expect(t.service.stop().timer).toBeNull()
    expect(t.pending()).toBeNull()
    t.advance(60 * MIN)
    expect(t.ended).toEqual([])
    // With nothing on, the controls do nothing.
    expect(t.service.pause().timer).toBeNull()
    expect(t.service.next().timer).toBeNull()
  })

  it('ends a phase the computer slept through as soon as it looks again', () => {
    const t = setup()
    t.service.start()
    t.service.check()
    expect(t.ended).toEqual([])
    t.jump(40 * MIN)
    t.service.check()
    expect(t.ended).toEqual([{ phase: 'focus', next: 'short', sound: true }])
    expect(t.completed).toHaveLength(1)
  })
})
