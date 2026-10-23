import { describe, expect, it } from 'vitest'
import { focusFor, inWeek, isReviewTime, mondayOf, movedTo, readWeeks, reviewWeeks, toggleFocus, weekFocus, withWeekFocus } from './week'

describe('the weeks of a review', () => {
  it('starts a week on Monday', () => {
    expect(mondayOf('2026-10-22')).toBe('2026-10-19') // a Thursday
    expect(mondayOf('2026-10-25T21:00')).toBe('2026-10-19') // Sunday evening
    expect(mondayOf('2026-10-19')).toBe('2026-10-19')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28') // across the year
    expect(mondayOf('nope')).toBeNull()
  })

  it('looks back on the week that holds today, and plans the next', () => {
    expect(reviewWeeks('2026-10-23')).toEqual({
      past: { start: '2026-10-19', end: '2026-10-25' },
      next: { start: '2026-10-26', end: '2026-11-01' }
    })
    expect(reviewWeeks('2026-10-25').past.start).toBe('2026-10-19')
  })

  it('on a Monday, still closes the week that just ended', () => {
    expect(reviewWeeks('2026-10-26')).toEqual({
      past: { start: '2026-10-19', end: '2026-10-25' },
      next: { start: '2026-10-26', end: '2026-11-01' }
    })
  })

  it('is offered from Friday to Sunday', () => {
    expect(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'].map(isReviewTime)).toEqual([
      false,
      true,
      true,
      true,
      false
    ])
  })

  it('tells a day or a moment in a week', () => {
    const week = { start: '2026-10-19', end: '2026-10-25' }
    expect(inWeek('2026-10-19', week)).toBe(true)
    expect(inWeek('2026-10-25T23:59', week)).toBe(true)
    expect(inWeek('2026-10-26', week)).toBe(false)
    expect(inWeek(null, week)).toBe(false)
  })

  it('moves a date to a Monday, keeping its time', () => {
    expect(movedTo('2026-10-21', '2026-10-26')).toBe('2026-10-26')
    expect(movedTo('2026-10-21T15:30', '2026-10-26')).toBe('2026-10-26T15:30')
    expect(movedTo(null, '2026-10-26')).toBe('2026-10-26')
  })
})

describe('the week focus', () => {
  it('chooses three at most, and takes one out when chosen again', () => {
    expect(toggleFocus([], 'a')).toEqual(['a'])
    expect(toggleFocus(['a', 'b', 'c'], 'd')).toEqual(['a', 'b', 'c'])
    expect(toggleFocus(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('keeps the current week and the next side by side, and drops weeks that ended', () => {
    const stored = { '2026-10-12': { focus: ['old'], note: '' }, '2026-10-19': { focus: ['now'], note: 'calm' } }
    const next = withWeekFocus(stored, '2026-10-26', ['a', 'b', 'a', 'c', 'd'], '  plan  ', '2026-10-23')
    expect(next).toEqual({ '2026-10-19': { focus: ['now'], note: 'calm' }, '2026-10-26': { focus: ['a', 'b', 'c'], note: 'plan' } })
    expect(focusFor(next, '2026-10-23')?.focus).toEqual(['now'])
    expect(focusFor(next, '2026-10-28')?.focus).toEqual(['a', 'b', 'c'])
    expect(weekFocus(next, '2026-10-26')?.note).toBe('plan')
  })

  it('leaves out a week with nothing chosen and no note', () => {
    expect(withWeekFocus({ '2026-10-26': { focus: ['a'], note: '' } }, '2026-10-26', [], ' ', '2026-10-23')).toBeNull()
  })

  it('reads anything malformed as nothing', () => {
    expect(readWeeks(null)).toEqual([])
    expect(readWeeks({ '2026-10-21': { focus: ['a'] }, '2026-10-26': 'x', nope: { focus: ['a'] } })).toEqual([])
    expect(readWeeks({ '2026-10-26': { focus: ['a', 3, '', 'a'], note: 7 } })).toEqual([{ start: '2026-10-26', focus: ['a'], note: '' }])
  })
})
