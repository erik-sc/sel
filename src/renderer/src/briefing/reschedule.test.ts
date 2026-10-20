import { describe, expect, it } from 'vitest'
import { rescheduleValue, slotTime } from './reschedule'

describe('moving a task to another day', () => {
  it('keeps its time on another day of the month', () => {
    expect(rescheduleValue({ start: '2026-10-15' }, '2026-10-20')).toEqual({ start: '2026-10-20' })
    expect(rescheduleValue({ start: '2026-10-15T09:30' }, '2026-10-20')).toEqual({ start: '2026-10-20T09:30' })
    expect(rescheduleValue('2026-10-15T09:30', '2026-11-02')).toEqual({ start: '2026-11-02T09:30' })
  })

  it('takes the hour it was dropped at, or none', () => {
    expect(rescheduleValue({ start: '2026-10-15' }, '2026-10-16', '14:15')).toEqual({ start: '2026-10-16T14:15' })
    expect(rescheduleValue({ start: '2026-10-15T09:30' }, '2026-10-16', null)).toEqual({ start: '2026-10-16' })
  })

  it('moves a range whole, its end landing on the day', () => {
    expect(rescheduleValue({ start: '2026-10-12T08:00', end: '2026-10-14T18:00' }, '2026-10-21', '10:00')).toEqual({
      start: '2026-10-19T08:00',
      end: '2026-10-21T18:00'
    })
    expect(rescheduleValue({ start: '2026-12-30', end: '2026-12-31' }, '2027-01-02')).toEqual({ start: '2027-01-01', end: '2027-01-02' })
  })

  it('gives a task without a date the day', () => {
    expect(rescheduleValue(undefined, '2026-10-16')).toEqual({ start: '2026-10-16' })
    expect(rescheduleValue(null, '2026-10-16', '08:00')).toEqual({ start: '2026-10-16T08:00' })
  })

  it('leaves the value alone for a day that is not one', () => {
    expect(rescheduleValue({ start: '2026-10-15' }, '2026-02-30')).toEqual({ start: '2026-10-15' })
  })
})

describe('a point of the week hours', () => {
  it('is the quarter of an hour before it', () => {
    expect(slotTime(0, 1440)).toBe('00:00')
    expect(slotTime(600, 1440)).toBe('10:00')
    expect(slotTime(614, 1440)).toBe('10:00')
    expect(slotTime(615, 1440)).toBe('10:15')
    expect(slotTime(615, 1440, 30)).toBe('10:00')
    expect(slotTime(1440, 1440)).toBe('23:45')
    expect(slotTime(-20, 1440)).toBe('00:00')
    expect(slotTime(50, 0)).toBe('00:00')
  })
})
