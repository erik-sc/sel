import { describe, expect, it } from 'vitest'
import { addUsage, lastSevenDays, readUsage, routineRequests, USAGE_DAYS, usageSummary, usageTotal, type UsageStore } from './aiUsage'
import {
  anyRoutineOn,
  cleanRoutinesSetting,
  cleanRoutineTime,
  readRoutines,
  ROUTINE_DEFAULTS,
  ROUTINES_COPY,
  ROUTINES_KEY,
  withRoutines
} from './routines'
import { cleanSettingValue, settingsSpecOf } from './settings'

describe('the routines setting', () => {
  it('starts with every routine off', () => {
    expect(readRoutines(null)).toEqual(ROUTINE_DEFAULTS)
    expect(anyRoutineOn(readRoutines(undefined))).toBe(false)
  })

  it('keeps times within the day, never at night', () => {
    expect(cleanRoutineTime('08:30')).toBe('08:30')
    expect(cleanRoutineTime('03:00')).toBe('06:00')
    expect(cleanRoutineTime('23:45')).toBe('21:30')
    expect(cleanRoutineTime('25:00')).toBeNull()
    expect(cleanRoutineTime('8:30')).toBeNull()
  })

  it('reads what is stored strictly: unknown routines and bad values fall back', () => {
    const read = readRoutines({
      routines: { morning: { on: true, time: '07:15' }, midday: { on: 'yes', time: 'noon' }, extra: { on: true } },
      weeklyDay: 3,
      limit: 99
    })
    expect(read.routines.morning).toEqual({ on: true, time: '07:15' })
    expect(read.routines.midday).toEqual({ on: false, time: '13:30' })
    expect('extra' in read.routines).toBe(false)
    expect(read.weeklyDay).toBe(5)
    expect(read.limit).toBe(20)
  })

  it('is a setting a window may write, checked on the way in', () => {
    expect(settingsSpecOf(ROUTINES_KEY)?.exact).toBe(true)
    const spec = settingsSpecOf(ROUTINES_KEY)?.spec
    if (!spec) throw new Error('no spec')
    expect(() => cleanSettingValue(spec, ROUTINES_KEY, 'on')).toThrow('Invalid setting value')
    expect(cleanSettingValue(spec, ROUTINES_KEY, { limit: 3 })).toMatchObject({ limit: 3 })
    expect(cleanRoutinesSetting('ai.other', {})).toBeUndefined()
    // What only main writes cannot be written by a window.
    expect(settingsSpecOf('ai.routinesState')).toBeNull()
    expect(settingsSpecOf('ai.usage')).toBeNull()
  })

  it('turns routines on for the onboarding, keeping their times', () => {
    const on = withRoutines(
      { ...ROUTINE_DEFAULTS, routines: { ...ROUTINE_DEFAULTS.routines, evening: { on: false, time: '18:00' } } },
      ['morning', 'evening'],
      true
    )
    expect(on.routines.morning.on).toBe(true)
    expect(on.routines.evening).toEqual({ on: true, time: '18:00' })
    expect(on.routines.midday.on).toBe(false)
  })

  it('names origins in both languages', () => {
    expect(ROUTINES_COPY.en.origin('you')).toBe('You')
    expect(ROUTINES_COPY.en.origin('routine:morning')).toBe('Routine: plan the day')
    expect(ROUTINES_COPY['pt-BR'].origin('memory')).toBe('Memória')
    expect(ROUTINES_COPY['pt-BR'].origin('routine:stalled')).toBe('Rotina: destravar uma tarefa parada')
  })
})

describe('the usage counts', () => {
  it('count requests by day and origin, with time and the cost when reported', () => {
    let store: UsageStore = {}
    store = addUsage(store, { day: '2026-10-22', origin: 'you', ms: 1200, costUsd: 0.02 })
    store = addUsage(store, { day: '2026-10-22', origin: 'you', ms: 800, costUsd: null })
    store = addUsage(store, { day: '2026-10-22', origin: 'routine:morning', ms: 3000, costUsd: 0.05 })
    store = addUsage(store, { day: '2026-10-22', origin: 'memory', ms: 400, costUsd: 0.001 })
    expect(store['2026-10-22']['you']).toEqual({ requests: 2, ms: 2000, costUsd: 0.02, costed: 1 })
    expect(routineRequests(store, '2026-10-22')).toBe(1)
    expect(usageTotal(store['2026-10-22'])).toMatchObject({ requests: 4, ms: 5400 })
  })

  it('keep two weeks and sum the last seven days', () => {
    let store: UsageStore = {}
    for (let day = 1; day <= 20; day++)
      store = addUsage(store, { day: `2026-10-${String(day).padStart(2, '0')}`, origin: 'you', ms: 1000, costUsd: null })
    expect(Object.keys(store)).toHaveLength(USAGE_DAYS)
    expect(Object.keys(store)[0]).toBe('2026-10-07')
    expect(lastSevenDays('2026-10-02')).toEqual([
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02'
    ])
    const summary = usageSummary(store, '2026-10-20', 6)
    expect(summary.today['you'].requests).toBe(1)
    expect(summary.week['you'].requests).toBe(7)
    expect(summary).toMatchObject({ routinesToday: 0, routineLimit: 6 })
  })

  it('read what is stored safely', () => {
    expect(readUsage('nope')).toEqual({})
    expect(readUsage({ '2026-10-22': { you: { requests: 2, ms: -5, costUsd: 'x' }, 'Bad Origin!': { requests: 1 } }, nope: {} })).toEqual({
      '2026-10-22': { you: { requests: 2, ms: 0, costUsd: 0, costed: 0 } }
    })
    // An origin that is not a short name is counted as `other`.
    expect(Object.keys(addUsage({}, { day: '2026-10-22', origin: 'Not OK', ms: 1, costUsd: null })['2026-10-22'])).toEqual(['other'])
  })
})
