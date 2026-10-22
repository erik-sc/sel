import { describe, expect, it } from 'vitest'
import { parseDate, quickDate, stepTime } from './dates'

/** Thursday 15 October 2026, 10:00 local time. */
const NOW = (): Date => new Date(2026, 9, 15, 10, 0)

describe('a date field', () => {
  const cases: [string, string | null, boolean?][] = [
    // the examples of the spec
    ['sex 15h', '2026-10-16T15:00'],
    ['amanhã', '2026-10-16'],
    ['daqui 3 dias', '2026-10-18'],
    ['daqui a 3 dias', '2026-10-18'],
    ['dia 5', '2026-11-05'],
    ['next monday', '2026-10-19'],
    ['next friday', '2026-10-23'],
    // short weekdays count here, unlike in the quick add
    ['ter', '2026-10-20'],
    ['sun', '2026-10-18'],
    ['qui 9h30', '2026-10-15T09:30'],
    // a number after a day is its hour; alone it is not a time
    ['amanhã 9', '2026-10-16T09:00'],
    ['sex 15', '2026-10-16T15:00'],
    ['15', null],
    // the rest of what the quick add knows
    ['hoje', '2026-10-15'],
    ['tomorrow 2:30pm', '2026-10-16T14:30'],
    ['14:00', '2026-10-15T14:00'],
    ['fim de semana', '2026-10-17'],
    ['próxima semana', '2026-10-19'],
    ['20/10', '2026-10-20'],
    ['10/20', '2026-10-20', false],
    ['2 de novembro', '2026-11-02'],
    ['Oct 20 9am', '2026-10-20T09:00'],
    ['2026-12-01', '2026-12-01'],
    ['in two weeks', '2026-10-29'],
    ['', null],
    ['qualquer coisa', null]
  ]
  for (const [text, expected, dayFirst] of cases) {
    it(JSON.stringify(text), () => {
      expect(parseDate(text, { now: NOW(), dayFirst: dayFirst ?? true }).date).toBe(expected)
    })
  }

  it('says what it did not understand', () => {
    expect(parseDate('amanhã de tarde talvez', { now: NOW() })).toEqual({ date: '2026-10-16T15:00', rest: 'talvez' })
    expect(parseDate('sex 15h', { now: NOW() }).rest).toBe('')
  })
})

describe('the quick choices of a date picker', () => {
  it('reads today, tomorrow, the weekend and next week', () => {
    expect(quickDate('today', NOW())).toBe('2026-10-15')
    expect(quickDate('tomorrow', NOW())).toBe('2026-10-16')
    expect(quickDate('weekend', NOW())).toBe('2026-10-17')
    expect(quickDate('nextWeek', NOW())).toBe('2026-10-19')
  })

  it('is this weekend on a weekend, and next week from a Sunday is tomorrow', () => {
    const saturday = new Date(2026, 9, 17, 8)
    const sunday = new Date(2026, 9, 18, 8)
    expect(quickDate('weekend', saturday)).toBe('2026-10-17')
    expect(quickDate('weekend', sunday)).toBe('2026-10-18')
    expect(quickDate('nextWeek', sunday)).toBe('2026-10-19')
    expect(quickDate('tomorrow', new Date(2026, 11, 31, 23, 59))).toBe('2027-01-01')
  })
})

describe('a time in steps of 15 minutes', () => {
  it('moves to the next quarter, and around midnight', () => {
    expect(stepTime('09:00', 1)).toBe('09:15')
    expect(stepTime('09:10', 1)).toBe('09:15')
    expect(stepTime('09:10', -1)).toBe('09:00')
    expect(stepTime('09:15', -1)).toBe('09:00')
    expect(stepTime('23:50', 1)).toBe('00:00')
    expect(stepTime('00:00', -1)).toBe('23:45')
    expect(stepTime('00:00', 95)).toBe('23:45')
  })
})
