// Herman's schedule on the two nights a year the clock changes, under TZ=America/New_York.
// The zone is process-wide state, so this has a file of its own (like the iCalendar suites).
process.env.TZ = 'America/New_York'

import { describe, expect, it } from 'vitest'
import { localDay } from '../../shared/briefing'
import { decide, EMPTY_MEMORY, forDay, FREQUENCIES, IDLE_MS, isQuiet, quietEnd, record, type SchedulerConfig } from './scheduler'

const MIN = 60_000
const HOUR = 60 * MIN
const night = { from: 21 * 60, to: 8 * 60 }
const config: SchedulerConfig = { ...FREQUENCIES.sometimes, idleMs: IDLE_MS, quietHours: night }
const local = (month: number, day: number, hour: number, minute = 0): number => new Date(2026, month - 1, day, hour, minute).getTime()

describe('the quiet hours when the clock changes', () => {
  it('runs in the zone this file asks for', () => {
    expect(new Date(Date.UTC(2026, 6, 1, 12)).getHours()).toBe(8)
    expect(new Date(Date.UTC(2026, 0, 1, 12)).getHours()).toBe(7)
  })

  it('end at eight on the wall clock after the night that is an hour longer', () => {
    // Saturday 31 October, 22:00 daylight time. The clocks go back at 02:00 on Sunday.
    const now = local(10, 31, 22)
    expect(isQuiet(night, now)).toBe(true)
    expect(quietEnd(night, now)).toBe(local(11, 1, 8))
    expect(quietEnd(night, now) - now).toBe(11 * HOUR)
    expect(decide(config, EMPTY_MEMORY, { now, idleMs: IDLE_MS })).toEqual({ ok: false, reason: 'quiet', waitMs: 11 * HOUR })
    // Both passes through the hour that happens twice are night.
    const firstPass = Date.UTC(2026, 10, 1, 5, 30)
    const secondPass = Date.UTC(2026, 10, 1, 6, 30)
    expect([new Date(firstPass).getHours(), new Date(secondPass).getHours()]).toEqual([1, 1])
    expect(isQuiet(night, firstPass) && isQuiet(night, secondPass)).toBe(true)
    expect(quietEnd(night, firstPass) - firstPass).toBe(7.5 * HOUR)
    expect(quietEnd(night, secondPass) - secondPass).toBe(6.5 * HOUR)
    expect(isQuiet(night, local(11, 1, 7, 59))).toBe(true)
    expect(isQuiet(night, local(11, 1, 8))).toBe(false)
  })

  it('end at eight on the wall clock after the night that is an hour shorter', () => {
    // Saturday 7 March, 22:00 standard time. The clocks go forward at 02:00 on Sunday.
    const now = local(3, 7, 22)
    expect(quietEnd(night, now)).toBe(local(3, 8, 8))
    expect(quietEnd(night, now) - now).toBe(9 * HOUR)
    expect(isQuiet(night, local(3, 8, 3, 30))).toBe(true)
    expect(isQuiet(night, local(3, 8, 8))).toBe(false)
  })

  it('cope with quiet hours that begin in the hour that does not exist', () => {
    const odd = { from: 2 * 60 + 30, to: 3 * 60 + 30 }
    // 02:30 never happens on 8 March: the clock reads 03:00 right after 01:59.
    const justAfter = Date.UTC(2026, 2, 8, 7, 5)
    expect(new Date(justAfter).getHours()).toBe(3)
    expect(isQuiet(odd, justAfter)).toBe(true)
    expect(quietEnd(odd, justAfter)).toBe(local(3, 8, 3, 30))
    expect(isQuiet(odd, local(3, 8, 3, 30))).toBe(false)
    expect(isQuiet(odd, local(3, 8, 1, 59))).toBe(false)
  })
})

describe('the gap and the day when the clock changes', () => {
  const awake: SchedulerConfig = { ...config, quietHours: null }

  it('measures the gap in time that passed, not in what the clock shows', () => {
    // 00:45 daylight time on 1 November. Ninety minutes later the wall clock reads 01:15 again.
    const spoke = Date.UTC(2026, 10, 1, 4, 45)
    const memory = record(EMPTY_MEMORY, { id: 'a', kind: 'long-session', variant: 'long-session:0' }, spoke)
    const later = spoke + 90 * MIN
    expect([new Date(later).getHours(), new Date(later).getMinutes()]).toEqual([1, 15])
    expect(decide(awake, memory, { now: later - MIN, idleMs: IDLE_MS })).toEqual({ ok: false, reason: 'too-soon', waitMs: MIN })
    expect(decide(awake, memory, { now: later, idleMs: IDLE_MS })).toEqual({ ok: true })
  })

  it('counts a day of twenty-five hours, and one of twenty-three, as one day each', () => {
    let memory = EMPTY_MEMORY
    for (const hour of [0, 6, 12, 18]) memory = record(memory, { id: `n${hour}`, kind: 'long-session', variant: 'long-session:0' }, local(11, 1, hour, 30))
    expect(memory).toMatchObject({ day: '2026-11-01', shown: 4 })
    const late = decide(awake, memory, { now: local(11, 1, 23, 30), idleMs: IDLE_MS })
    expect(late).toEqual({ ok: false, reason: 'day-limit', waitMs: 30 * MIN })
    // At 00:30 on the long day, midnight is twenty-four and a half hours away.
    const early = local(11, 1, 0, 30)
    expect(local(11, 2, 0) - early).toBe(24.5 * HOUR)
    expect(decide(awake, { ...memory, lastAt: 0 }, { now: early, idleMs: IDLE_MS })).toEqual({ ok: false, reason: 'day-limit', waitMs: 24.5 * HOUR })
    expect(forDay(memory, local(11, 2, 0, 1))).toMatchObject({ day: '2026-11-02', shown: 0 })
    // The short day in March.
    expect(localDay(local(3, 8, 3, 0))).toBe('2026-03-08')
    expect(local(3, 9, 0) - local(3, 8, 0)).toBe(23 * HOUR)
    const march = record(EMPTY_MEMORY, { id: 'm', kind: 'morning', variant: 'morning:0' }, local(3, 8, 1, 30))
    expect(forDay(march, local(3, 8, 3, 30))).toBe(march)
    expect(forDay(march, local(3, 9, 0, 0)).shown).toBe(0)
  })
})
