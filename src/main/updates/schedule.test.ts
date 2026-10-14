import { describe, expect, it } from 'vitest'
import { lastCheckTime, nextCheck, UPDATE_TIMING, type ScheduleInput } from './schedule'

const START = 1_800_000_000_000
const { startDelayMs, intervalMs, recordingRetryMs } = UPDATE_TIMING

const input = (patch: Partial<ScheduleInput> = {}): ScheduleInput => ({
  enabled: true,
  supported: true,
  recording: false,
  pending: false,
  now: START + startDelayMs,
  startedAt: START,
  lastCheck: null,
  ...patch
})

describe('when sel asks for a new version by itself', () => {
  it('never, while the setting is off or unset (the default)', () => {
    for (const enabled of [false, null, undefined, 'true', 1, {}]) {
      expect(nextCheck(input({ enabled })), String(enabled)).toEqual({ kind: 'off' })
    }
  })

  it('never, in a build that cannot be updated', () => {
    expect(nextCheck(input({ supported: false }))).toEqual({ kind: 'off' })
  })

  it('not in the first minutes after start', () => {
    expect(nextCheck(input({ now: START }))).toEqual({ kind: 'wait', ms: startDelayMs })
    expect(nextCheck(input({ now: START + 60_000 }))).toEqual({ kind: 'wait', ms: startDelayMs - 60_000 })
    expect(nextCheck(input({ now: START + startDelayMs }))).toEqual({ kind: 'now' })
  })

  it('at most once a day, counting a check made in an earlier session', () => {
    const now = START + startDelayMs
    expect(nextCheck(input({ now, lastCheck: now - 60_000 }))).toEqual({ kind: 'wait', ms: intervalMs - 60_000 })
    expect(nextCheck(input({ now, lastCheck: now - intervalMs + 1 }))).toEqual({ kind: 'wait', ms: 1 })
    expect(nextCheck(input({ now, lastCheck: now - intervalMs }))).toEqual({ kind: 'now' })
    expect(nextCheck(input({ now, lastCheck: now - 30 * intervalMs }))).toEqual({ kind: 'now' })
  })

  it('still waits for the start delay when the last check is long past', () => {
    expect(nextCheck(input({ now: START + 1000, lastCheck: START - 10 * intervalMs }))).toEqual({ kind: 'wait', ms: startDelayMs - 1000 })
  })

  it('not while a meeting is recorded: it tries again a little later', () => {
    expect(nextCheck(input({ recording: true }))).toEqual({ kind: 'wait', ms: recordingRetryMs })
    // Before it is due, the wait is the ordinary one.
    expect(nextCheck(input({ recording: true, now: START }))).toEqual({ kind: 'wait', ms: startDelayMs })
  })

  it('not while a version is downloading or waits to be installed', () => {
    expect(nextCheck(input({ pending: true }))).toEqual({ kind: 'wait', ms: intervalMs })
  })

  it('ignores a last check it cannot trust', () => {
    const now = START + startDelayMs
    for (const lastCheck of ['yesterday', NaN, Infinity, -5, 0, now + 1, now + 365 * intervalMs]) {
      expect(nextCheck(input({ now, lastCheck })), String(lastCheck)).toEqual({ kind: 'now' })
    }
  })
})

describe('lastCheckTime', () => {
  it('keeps a past time and drops anything else', () => {
    expect(lastCheckTime(START, START)).toBe(START)
    expect(lastCheckTime(START - 1, START)).toBe(START - 1)
    expect(lastCheckTime(START + 1, START)).toBeNull()
    expect(lastCheckTime('1', START)).toBeNull()
    expect(lastCheckTime(null, START)).toBeNull()
  })
})
