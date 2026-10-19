import { describe, expect, it } from 'vitest'
import {
  advanceTimer,
  cleanPomodoroSetting,
  finishTimer,
  formatClock,
  nextPhase,
  pauseTimer,
  POMODORO_DEFAULTS,
  POMODORO_SETTING,
  readPomodoroSettings,
  remaining,
  resumeTimer,
  skipTimer,
  startTimer,
  type PomodoroSettings,
  type PomodoroTimer
} from './pomodoro'

const MIN = 60_000
const T0 = 1_000_000

/** Runs the phase to its end and answers yes to the question: the next phase, started at its end. */
function runOut(timer: PomodoroTimer, settings: PomodoroSettings): { timer: PomodoroTimer; completed: boolean; at: number } {
  const at = timer.endsAt!
  const { timer: ended, completed } = finishTimer(timer, at)
  return { timer: advanceTimer(ended, settings, at), completed, at }
}

describe('the pomodoro timer', () => {
  it('starts with 25 minutes of focus by default', () => {
    const timer = startTimer(POMODORO_DEFAULTS, T0)
    expect(timer).toEqual({
      phase: 'focus',
      duration: 25 * MIN,
      endsAt: T0 + 25 * MIN,
      left: 25 * MIN,
      paused: false,
      ended: false,
      cycle: 0
    })
    expect(remaining(timer, T0 + 10 * MIN)).toBe(15 * MIN)
  })

  it('goes focus, short break, … and takes the long break after every fourth focus phase', () => {
    let timer = startTimer(POMODORO_DEFAULTS, T0)
    const phases: string[] = [timer.phase]
    let completed = 0
    for (let i = 0; i < 9; i++) {
      const step = runOut(timer, POMODORO_DEFAULTS)
      if (step.completed) completed++
      timer = step.timer
      phases.push(timer.phase)
    }
    expect(phases).toEqual(['focus', 'short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus', 'short'])
    expect(completed).toBe(5)
    expect(timer.cycle).toBe(5)
  })

  it('gives each phase its own length from the settings', () => {
    const settings = { ...POMODORO_DEFAULTS, focus: 50, short: 10, long: 30, longEvery: 2 }
    let timer = startTimer(settings, T0)
    expect(timer.duration).toBe(50 * MIN)
    timer = runOut(timer, settings).timer
    expect([timer.phase, timer.duration]).toEqual(['short', 10 * MIN])
    timer = runOut(runOut(timer, settings).timer, settings).timer
    expect([timer.phase, timer.duration]).toEqual(['long', 30 * MIN])
  })

  it('does not end before its time, and waits at its end for the next phase to be asked for', () => {
    const timer = startTimer(POMODORO_DEFAULTS, T0)
    expect(finishTimer(timer, T0 + 25 * MIN - 1)).toEqual({ timer, completed: false })
    const { timer: ended, completed } = finishTimer(timer, T0 + 25 * MIN + 5000)
    expect(completed).toBe(true)
    expect(ended).toMatchObject({ phase: 'focus', ended: true, endsAt: null, left: 0, cycle: 1 })
    expect(remaining(ended, T0 + 40 * MIN)).toBe(0)
    // It stays over, however long nobody answers.
    expect(finishTimer(ended, T0 + 90 * MIN)).toEqual({ timer: ended, completed: false })
    expect(nextPhase(ended, POMODORO_DEFAULTS)).toBe('short')
  })

  it('counts only focus phases as completed', () => {
    const brk = runOut(startTimer(POMODORO_DEFAULTS, T0), POMODORO_DEFAULTS).timer
    expect(brk.phase).toBe('short')
    const end = finishTimer(brk, brk.endsAt!)
    expect(end.completed).toBe(false)
    expect(end.timer.cycle).toBe(1)
    expect(nextPhase(end.timer, POMODORO_DEFAULTS)).toBe('focus')
  })

  it('keeps what was left across a pause, however long the pause', () => {
    const timer = startTimer(POMODORO_DEFAULTS, T0)
    const paused = pauseTimer(timer, T0 + 10 * MIN)
    expect(paused).toMatchObject({ paused: true, endsAt: null, left: 15 * MIN })
    expect(remaining(paused, T0 + 60 * MIN)).toBe(15 * MIN)
    // A paused phase never ends.
    expect(finishTimer(paused, T0 + 999 * MIN).timer).toBe(paused)
    const resumed = resumeTimer(paused, T0 + 60 * MIN)
    expect(resumed).toMatchObject({ paused: false, endsAt: T0 + 75 * MIN })
    expect(remaining(resumed, T0 + 70 * MIN)).toBe(5 * MIN)
    // Pausing twice, or resuming what runs, changes nothing.
    expect(pauseTimer(paused, T0 + 70 * MIN)).toBe(paused)
    expect(resumeTimer(resumed, T0 + 70 * MIN)).toBe(resumed)
  })

  it('skips to the next phase at once, without counting a skipped focus phase as completed', () => {
    const timer = startTimer(POMODORO_DEFAULTS, T0)
    const skipped = skipTimer(timer, POMODORO_DEFAULTS, T0 + 3 * MIN)
    expect(skipped).toMatchObject({ phase: 'short', endsAt: T0 + 8 * MIN, ended: false, paused: false, cycle: 1 })
    const back = skipTimer(skipped, POMODORO_DEFAULTS, T0 + 4 * MIN)
    expect(back).toMatchObject({ phase: 'focus', endsAt: T0 + 29 * MIN, cycle: 1 })
  })

  it('skips into the long break at the end of a set, and skips a paused phase too', () => {
    let timer = startTimer({ ...POMODORO_DEFAULTS, longEvery: 2 }, T0)
    const settings = { ...POMODORO_DEFAULTS, longEvery: 2 }
    timer = skipTimer(timer, settings, T0) // focus 1 → short
    timer = skipTimer(timer, settings, T0) // short → focus 2
    timer = pauseTimer(timer, T0 + MIN)
    timer = skipTimer(timer, settings, T0 + 2 * MIN) // focus 2 → long
    expect(timer).toMatchObject({ phase: 'long', paused: false, cycle: 2, endsAt: T0 + 17 * MIN })
  })

  it('skips the phase the question asks about ("Skip the break")', () => {
    const ended = finishTimer(startTimer(POMODORO_DEFAULTS, T0), T0 + 25 * MIN).timer
    expect(nextPhase(ended, POMODORO_DEFAULTS)).toBe('short')
    const focus = skipTimer(ended, POMODORO_DEFAULTS, T0 + 26 * MIN)
    expect(focus).toMatchObject({ phase: 'focus', cycle: 1, ended: false, endsAt: T0 + 51 * MIN })
  })

  it('shows the time as a clock that never reads 00:00 before the end', () => {
    expect(formatClock(25 * MIN)).toBe('25:00')
    expect(formatClock(25 * MIN - 1)).toBe('25:00')
    expect(formatClock(61_000)).toBe('01:01')
    expect(formatClock(1)).toBe('00:01')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(90 * MIN)).toBe('1:30:00')
  })
})

describe('pomodoro settings', () => {
  it('accept whole minutes within bounds, and a boolean for focus mode', () => {
    expect(cleanPomodoroSetting(POMODORO_SETTING.focus, 50)).toBe(50)
    expect(cleanPomodoroSetting(POMODORO_SETTING.focus, 0)).toBeUndefined()
    expect(cleanPomodoroSetting(POMODORO_SETTING.focus, 181)).toBeUndefined()
    expect(cleanPomodoroSetting(POMODORO_SETTING.short, 2.5)).toBeUndefined()
    expect(cleanPomodoroSetting(POMODORO_SETTING.long, '15')).toBeUndefined()
    expect(cleanPomodoroSetting(POMODORO_SETTING.longEvery, 1)).toBeUndefined()
    expect(cleanPomodoroSetting(POMODORO_SETTING.longEvery, 4)).toBe(4)
    expect(cleanPomodoroSetting(POMODORO_SETTING.focusMode, true)).toBe(true)
    expect(cleanPomodoroSetting(POMODORO_SETTING.focusMode, 1)).toBeUndefined()
    expect(cleanPomodoroSetting('pomodoro.completed', [])).toBeUndefined()
  })

  it('fall back to 25 / 5 / 15, a long break every 4, focus mode off', () => {
    expect(readPomodoroSettings(() => null)).toEqual({ focus: 25, short: 5, long: 15, longEvery: 4, focusMode: false })
    const stored: Record<string, unknown> = { 'pomodoro.focus': 40, 'pomodoro.short': 'x', 'pomodoro.focusMode': true }
    expect(readPomodoroSettings((key) => stored[key])).toEqual({ focus: 40, short: 5, long: 15, longEvery: 4, focusMode: true })
  })
})
