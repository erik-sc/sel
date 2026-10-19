/**
 * When Herman may speak unasked: the gap between nudges, the day's limit, the quiet hours,
 * typing, and what he remembers. Pure: every moment is a number handed in.
 */
import { describe, expect, it } from 'vitest'
import { localDay } from '../../shared/briefing'
import { HERMAN_DEFAULTS, type HermanNudgeKind } from '../../shared/herman'
import {
  decide,
  EMPTY_MEMORY,
  feedback,
  forDay,
  forget,
  FREQUENCIES,
  IDLE_MS,
  isQuiet,
  MIN_WEIGHT,
  quietEnd,
  readMemory,
  RECENT_LINES,
  record,
  RETRY_MS,
  type Decision,
  type HermanMemory,
  type SchedulerConfig
} from './scheduler'

const MIN = 60_000
const HOUR = 60 * MIN
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime()
const config: SchedulerConfig = { ...FREQUENCIES.sometimes, idleMs: IDLE_MS, quietHours: HERMAN_DEFAULTS.quietHours }
const idle = IDLE_MS
const said = (memory: HermanMemory, now: number, kind: HermanNudgeKind = 'overdue', id = `n-${now}`): HermanMemory =>
  record(memory, { id, kind, variant: `${kind}:0` }, now)
const refusal = (decision: Decision): string => (decision.ok ? 'ok' : decision.reason)
const wait = (decision: Decision): number => (decision.ok ? 0 : decision.waitMs)

describe('the defaults', () => {
  it('are one nudge per ninety minutes, four a day, after twenty idle seconds, never from 21:00 to 08:00', () => {
    expect(FREQUENCIES.sometimes).toEqual({ gapMs: 90 * MIN, perDay: 4 })
    expect(FREQUENCIES.rare).toEqual({ gapMs: 180 * MIN, perDay: 2 })
    expect(FREQUENCIES.often).toEqual({ gapMs: 45 * MIN, perDay: 8 })
    expect(IDLE_MS).toBe(20_000)
    expect(HERMAN_DEFAULTS.quietHours).toEqual({ from: 21 * 60, to: 8 * 60 })
    expect(HERMAN_DEFAULTS.frequency).toBe('sometimes')
  })
})

describe('the gap and the day', () => {
  it('lets him speak when nothing stands in the way', () => {
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 10), idleMs: idle })).toEqual({ ok: true })
  })

  it('keeps ninety minutes between two nudges, and says how long is left', () => {
    const memory = said(EMPTY_MEMORY, at(14, 10))
    expect(decide(config, memory, { now: at(14, 10, 1), idleMs: idle })).toEqual({ ok: false, reason: 'too-soon', waitMs: 89 * MIN })
    expect(decide(config, memory, { now: at(14, 11, 29), idleMs: idle })).toEqual({ ok: false, reason: 'too-soon', waitMs: MIN })
    expect(decide(config, memory, { now: at(14, 11, 30), idleMs: idle })).toEqual({ ok: true })
  })

  it('stops at four in one day and starts again the next', () => {
    let memory = EMPTY_MEMORY
    const times = [at(14, 8, 30), at(14, 10, 30), at(14, 12, 30), at(14, 14, 30)]
    for (const now of times) {
      expect(refusal(decide(config, memory, { now, idleMs: idle }))).toBe('ok')
      memory = said(memory, now, 'long-session')
    }
    expect(memory).toMatchObject({ day: '2026-10-14', shown: 4 })
    const fifth = decide(config, memory, { now: at(14, 16, 30), idleMs: idle })
    expect(refusal(fifth)).toBe('day-limit')
    // Worth asking again at midnight, and then the quiet hours take over until morning.
    expect(wait(fifth)).toBe(at(15, 0) - at(14, 16, 30))
    expect(refusal(decide(config, memory, { now: at(15, 0, 1), idleMs: idle }))).toBe('quiet')
    expect(refusal(decide(config, memory, { now: at(15, 8, 0), idleMs: idle }))).toBe('ok')
    expect(forDay(memory, at(15, 8))).toMatchObject({ day: '2026-10-15', shown: 0, said: [] })
    expect(forDay(memory, at(14, 23))).toBe(memory)
  })

  it('counts by frequency: two a day when rare, eight when often', () => {
    const rare: SchedulerConfig = { ...config, ...FREQUENCIES.rare }
    let memory = said(EMPTY_MEMORY, at(14, 9))
    expect(decide(rare, memory, { now: at(14, 11, 59), idleMs: idle })).toMatchObject({ ok: false, reason: 'too-soon', waitMs: MIN })
    memory = said(memory, at(14, 12))
    expect(refusal(decide(rare, memory, { now: at(14, 16), idleMs: idle }))).toBe('day-limit')
    const often: SchedulerConfig = { ...config, ...FREQUENCIES.often }
    expect(refusal(decide(often, said(EMPTY_MEMORY, at(14, 9)), { now: at(14, 9, 45), idleMs: idle }))).toBe('ok')
    expect(refusal(decide(often, memory, { now: at(14, 16), idleMs: idle }))).toBe('ok')
  })

  it('is not opened early, nor closed for long, by a clock that was set back', () => {
    const memory = said(EMPTY_MEMORY, at(14, 15))
    // The clock now says an hour before he last spoke: one full gap from here, no more.
    expect(decide(config, memory, { now: at(14, 14), idleMs: idle })).toEqual({ ok: false, reason: 'too-soon', waitMs: 90 * MIN })
    // And a clock set a day back does not hand out yesterday's allowance twice in a row.
    expect(refusal(decide(config, memory, { now: at(13, 15), idleMs: idle }))).toBe('too-soon')
  })
})

describe('typing, and being busy', () => {
  it('waits for twenty seconds without a key', () => {
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 10), idleMs: 0 })).toEqual({ ok: false, reason: 'typing', waitMs: 20_000 })
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 10), idleMs: 19_500 })).toEqual({ ok: false, reason: 'typing', waitMs: 1000 })
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 10), idleMs: 12_000 })).toEqual({ ok: false, reason: 'typing', waitMs: 8000 })
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 10), idleMs: 20_000 })).toEqual({ ok: true })
  })

  it('says nothing during a recording, a presentation or anything full screen', () => {
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 10), idleMs: 10 * MIN, busy: true })).toEqual({
      ok: false,
      reason: 'busy',
      waitMs: MIN
    })
  })

  it('says nothing when nudges are off', () => {
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 10), idleMs: idle, enabled: false })).toEqual({
      ok: false,
      reason: 'off',
      waitMs: RETRY_MS
    })
  })

  it('answers with the wait that lasts longest: the gap before the typing', () => {
    const memory = said(EMPTY_MEMORY, at(14, 10))
    expect(refusal(decide(config, memory, { now: at(14, 10, 5), idleMs: 0, busy: true }))).toBe('too-soon')
    expect(refusal(decide(config, EMPTY_MEMORY, { now: at(14, 22), idleMs: 0, busy: true }))).toBe('quiet')
  })
})

describe('the quiet hours', () => {
  const night = HERMAN_DEFAULTS.quietHours

  it('span midnight: from 21:00 to 08:00', () => {
    const quiet = (hour: number, minute = 0): boolean => isQuiet(night, at(14, hour, minute))
    expect([quiet(20, 59), quiet(21), quiet(23, 59), quiet(0), quiet(3), quiet(7, 59), quiet(8), quiet(12)]).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      false
    ])
  })

  it('can sit inside one day, or not exist', () => {
    const siesta = { from: 13 * 60, to: 15 * 60 }
    expect([12, 13, 14, 15].map((hour) => isQuiet(siesta, at(14, hour)))).toEqual([false, true, true, false])
    expect(isQuiet({ from: 600, to: 600 }, at(14, 10))).toBe(false)
    expect(isQuiet(null, at(14, 3))).toBe(false)
    expect(refusal(decide({ ...config, quietHours: null }, EMPTY_MEMORY, { now: at(14, 3), idleMs: idle }))).toBe('ok')
  })

  it('end at eight the next morning, or the same morning after midnight', () => {
    expect(quietEnd(night, at(14, 22))).toBe(at(15, 8))
    expect(quietEnd(night, at(15, 0, 30))).toBe(at(15, 8))
    expect(quietEnd(night, at(15, 7, 59))).toBe(at(15, 8))
    expect(decide(config, EMPTY_MEMORY, { now: at(14, 22), idleMs: idle })).toEqual({ ok: false, reason: 'quiet', waitMs: 10 * HOUR })
    expect(decide(config, EMPTY_MEMORY, { now: at(15, 7, 59), idleMs: idle })).toEqual({ ok: false, reason: 'quiet', waitMs: MIN })
    expect(refusal(decide(config, EMPTY_MEMORY, { now: at(15, 8), idleMs: idle }))).toBe('ok')
  })

  it('hold at the turn of a month and of a year', () => {
    const newYear = new Date(2026, 11, 31, 23, 30).getTime()
    expect(isQuiet(night, newYear)).toBe(true)
    expect(quietEnd(night, newYear)).toBe(new Date(2027, 0, 1, 8).getTime())
  })
})

describe('what he remembers', () => {
  it('records what he said: the count, the kind, the line, the moment', () => {
    const memory = said(said(EMPTY_MEMORY, at(14, 9), 'morning', 'a'), at(14, 11), 'overdue', 'b')
    expect(memory).toEqual({
      ...EMPTY_MEMORY,
      day: '2026-10-14',
      shown: 2,
      said: ['morning', 'overdue'],
      lastAt: at(14, 11),
      lastKind: 'overdue',
      lastId: 'b',
      recent: ['morning:0', 'overdue:0']
    })
    expect(said(memory, at(14, 13), 'overdue').said).toEqual(['morning', 'overdue'])
    // A new day starts the count again and keeps what he learned.
    const next = said({ ...memory, weights: { overdue: 0.5 } }, at(15, 9), 'morning', 'c')
    expect(next).toMatchObject({ day: '2026-10-15', shown: 1, said: ['morning'], weights: { overdue: 0.5 } })
    let long = EMPTY_MEMORY
    for (let index = 0; index < RECENT_LINES + 15; index++)
      long = record(long, { id: 'x', kind: 'morning', variant: `morning:${index}` }, at(14, 9))
    expect(long.recent.length).toBe(RECENT_LINES)
    expect(long.recent[RECENT_LINES - 1]).toBe(`morning:${RECENT_LINES + 14}`)
  })

  it('"Not now" starts the wait over from that moment', () => {
    const memory = said(EMPTY_MEMORY, at(14, 10), 'overdue', 'n1')
    const after = feedback(memory, 'n1', 'not-now', at(14, 10, 15))
    expect(after.lastAt).toBe(at(14, 10, 15))
    expect(after.weights).toEqual({})
    expect(refusal(decide(config, after, { now: at(14, 11, 40), idleMs: idle }))).toBe('too-soon')
    expect(refusal(decide(config, after, { now: at(14, 11, 45), idleMs: idle }))).toBe('ok')
  })

  it('"Fewer like this" halves that kind, down to a floor, and only that kind', () => {
    let memory = said(EMPTY_MEMORY, at(14, 10), 'long-session', 'n1')
    memory = feedback(memory, 'n1', 'fewer', at(14, 10, 1))
    expect(memory.weights).toEqual({ 'long-session': 0.5 })
    for (let round = 0; round < 6; round++) memory = feedback(memory, 'n1', 'fewer', at(14, 10, 2))
    expect(memory.weights).toEqual({ 'long-session': MIN_WEIGHT })
    expect(MIN_WEIGHT).toBe(0.125)
    expect(memory.lastAt).toBe(at(14, 10))
  })

  it('ignores feedback about anything but the last nudge, and a dismissal without an answer', () => {
    const memory = said(EMPTY_MEMORY, at(14, 10), 'overdue', 'n1')
    expect(feedback(memory, 'other', 'fewer', at(14, 11))).toBe(memory)
    expect(feedback(memory, 'n1', undefined, at(14, 11))).toBe(memory)
    expect(feedback(EMPTY_MEMORY, 'n1', 'fewer', at(14, 11))).toBe(EMPTY_MEMORY)
  })

  it('forgets what he learned on request, without that being a way around his restraint', () => {
    let memory = said(EMPTY_MEMORY, at(14, 10), 'overdue', 'n1')
    memory = { ...feedback(memory, 'n1', 'fewer', at(14, 10, 1)), met: true, launchDay: '2026-10-14' }
    const cleared = forget(memory)
    expect(cleared).toMatchObject({
      weights: {},
      recent: [],
      lastKind: null,
      lastId: null,
      met: true,
      launchDay: '2026-10-14',
      shown: 1,
      lastAt: at(14, 10),
      day: '2026-10-14'
    })
    expect(refusal(decide(config, cleared, { now: at(14, 10, 30), idleMs: idle }))).toBe('too-soon')
  })

  it('survives being stored and read back', () => {
    let memory = said(EMPTY_MEMORY, at(14, 10), 'overdue', 'n1')
    memory = { ...feedback(memory, 'n1', 'fewer', at(14, 10, 1)), met: true, launchDay: localDay(at(14, 10)) }
    expect(readMemory(JSON.parse(JSON.stringify(memory)))).toEqual(memory)
    expect(readMemory(JSON.parse(JSON.stringify(EMPTY_MEMORY)))).toEqual(EMPTY_MEMORY)
  })

  it('reads anything malformed as remembering nothing', () => {
    for (const raw of [null, undefined, 7, 'x', [], [1, 2]]) expect(readMemory(raw)).toEqual(EMPTY_MEMORY)
    const read = readMemory({
      day: '14/10/2026',
      shown: -3.5,
      said: ['overdue', 'overdue', 'nonsense', 4],
      lastAt: Number.NaN,
      lastKind: 'everything',
      lastId: 'x'.repeat(100),
      weights: { overdue: 0, morning: 9, nonsense: 0.5, evening: 'low', today: 0.5 },
      recent: ['a', 5, 'x'.repeat(41), 'b'],
      met: 'yes',
      launchDay: 20261014,
      extra: { __proto__: { polluted: true } }
    })
    expect(read).toEqual({
      ...EMPTY_MEMORY,
      said: ['overdue'],
      weights: { overdue: MIN_WEIGHT, morning: 1, today: 0.5 },
      recent: ['a', 'b']
    })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(readMemory({ shown: 1e308, lastAt: -5 })).toMatchObject({ shown: 1e308, lastAt: 0 })
  })
})
