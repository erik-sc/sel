// The alarms' schedule under TZ=America/Sao_Paulo (no daylight saving since 2019) and, in
// the same file, on wall-clock arithmetic around a past summer-time change there (2018).
// The zone is process-wide state, so this has a file of its own.
process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import type { AlarmTime } from '../../shared/alarms'
import { ALARM_GRACE_MS, dueAlarm, lastOccurrence, markAlarms, nextAlarmAt, nextOccurrence, readFired, waitFor } from './schedule'

const MIN = 60_000
const local = (y: number, m: number, d: number, h = 0, mi = 0): number => new Date(y, m - 1, d, h, mi).getTime()
const weekdays: AlarmTime = { id: 'work', time: '08:30', days: [1, 2, 3, 4, 5], enabled: true }
const sunday: AlarmTime = { id: 'sun', time: '10:00', days: [0], enabled: true }

describe('occurrences', () => {
  // Thursday 15 October 2026.
  it('finds the next and the last time on the right days', () => {
    expect(nextOccurrence(weekdays, local(2026, 10, 15, 7, 0))).toBe(local(2026, 10, 15, 8, 30))
    expect(nextOccurrence(weekdays, local(2026, 10, 15, 8, 30))).toBe(local(2026, 10, 16, 8, 30))
    // Friday evening: the next weekday is Monday.
    expect(nextOccurrence(weekdays, local(2026, 10, 16, 20, 0))).toBe(local(2026, 10, 19, 8, 30))
    expect(lastOccurrence(weekdays, local(2026, 10, 18, 12, 0))).toBe(local(2026, 10, 16, 8, 30))
    expect(lastOccurrence(sunday, local(2026, 10, 18, 10, 0))).toBe(local(2026, 10, 18, 10, 0))
  })

  it('never rings when off or without days', () => {
    expect(nextOccurrence({ ...weekdays, enabled: false }, local(2026, 10, 15))).toBeNull()
    expect(lastOccurrence({ ...weekdays, days: [] }, local(2026, 10, 15, 12))).toBeNull()
    expect(nextAlarmAt([], local(2026, 10, 15))).toBeNull()
    expect(nextAlarmAt([weekdays, sunday], local(2026, 10, 17, 9, 0))).toBe(local(2026, 10, 18, 10, 0))
  })

  it('keeps the wall clock across the 2018 summer-time change (midnight skipped on 4 November)', () => {
    const midnight: AlarmTime = { id: 'm', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true }
    const before = local(2018, 11, 3, 12, 0)
    const next = nextOccurrence(midnight, local(2018, 11, 3, 8, 0)) as number
    expect(new Date(next).getHours()).toBe(7)
    expect(new Date(next).getDate()).toBe(4)
    expect(next - before).toBe(18 * 60 * MIN)
  })
})

describe('what rings now', () => {
  const at = local(2026, 10, 15, 8, 30)

  it('rings once at its time and again the next day', () => {
    expect(dueAlarm([weekdays], {}, at)?.at).toBe(at)
    const fired = markAlarms([weekdays], {}, at)
    expect(dueAlarm([weekdays], fired, at + MIN)).toBeNull()
    expect(dueAlarm([weekdays], fired, local(2026, 10, 16, 8, 30))?.at).toBe(local(2026, 10, 16, 8, 30))
  })

  it('rings late within the grace period (the computer woke up), and not after it', () => {
    expect(dueAlarm([weekdays], {}, at + 20 * MIN)?.at).toBe(at)
    expect(dueAlarm([weekdays], {}, at + ALARM_GRACE_MS + MIN)).toBeNull()
  })

  it('rings once when two times fell due together', () => {
    const early: AlarmTime = { id: 'early', time: '08:20', days: [4], enabled: true }
    const due = dueAlarm([early, weekdays], {}, at + 5 * MIN)
    expect(due?.alarm.id).toBe('work')
    const fired = markAlarms([early, weekdays], {}, at + 5 * MIN)
    expect(dueAlarm([early, weekdays], fired, at + 6 * MIN)).toBeNull()
  })

  it('forgets malformed and old records', () => {
    const now = local(2026, 10, 15, 12)
    expect(readFired({ 'a:x': now - MIN, 'a:old': now - 10 * 24 * 60 * MIN, bad: 'x', __proto__: 1 }, now)).toEqual({ 'a:x': now - MIN })
    expect(readFired('nope', now)).toEqual({})
    expect(readFired(null, now)).toEqual({})
  })

  it('waits until the next moment, within what a timer keeps', () => {
    const now = local(2026, 10, 15, 8, 0)
    expect(waitFor(now + 30 * MIN, now)).toBe(30 * MIN)
    expect(waitFor(now + 30 * MIN, now, MIN)).toBe(MIN)
    expect(waitFor(null, now)).toBe(6 * 60 * MIN)
    expect(waitFor(now - MIN, now)).toBe(1000)
  })
})
