// Date values with a time of day (`YYYY-MM-DDTHH:mm`) and the `date_is` filter, which
// reads "today" from the clock. The time zone is pinned so the clock tests are exact.
process.env.TZ = 'America/Sao_Paulo'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, PropertySchema, PropertyValue, ViewFilter } from '../../../../shared/types'
import { RELATIVE_DATES } from '../../../../shared/types'
import * as L from '../logic'

function row(id: string, values: Record<string, PropertyValue> = {}): Block {
  return { id, type: 'page', parentId: 'db', content: [], props: { title: [[id]], values }, createdAt: 0, updatedAt: 0, trashedAt: null }
}

const due: PropertySchema = { id: 'd', name: 'Due', type: 'date' }
const schema: L.Schema = { title: { id: 'title', name: 'Name', type: 'title' }, d: due }

describe('times of day', () => {
  it('reads only plain wall-clock times', () => {
    expect(L.timeOf('2026-10-15T09:30')).toBe('09:30')
    expect(L.timeOf('2026-10-15T9:05')).toBe('09:05')
    expect(L.timeOf('2026-10-15 23:59:59')).toBe('23:59')
    expect(L.timeOf('2026-10-15T09:30:00.000')).toBe('09:30')
    expect(L.timeOf('2026-10-15')).toBeNull()
    // A zone or an offset is not a local time: the value is read as its day.
    expect(L.timeOf('2026-10-15T09:30:00Z')).toBeNull()
    expect(L.timeOf('2026-10-15T09:30+02:00')).toBeNull()
    expect(L.timeOf('2026-10-15T24:00')).toBeNull()
    expect(L.timeOf('2026-10-15T12:60')).toBeNull()
    expect(L.timeOf(42)).toBeNull()
  })

  it('normalises moments and keeps days as they were', () => {
    expect(L.normalizeMoment('2026-10-15T9:05')).toBe('2026-10-15T09:05')
    expect(L.normalizeMoment('2026-10-15')).toBe('2026-10-15')
    expect(L.normalizeMoment('2026-10-15T09:30:00Z')).toBe('2026-10-15')
    expect(L.normalizeMoment('2026-02-30T10:00')).toBeNull()
    expect(L.dayKey('2026-10-15T09:30')).toBe('2026-10-15')
    expect(L.withTime('2026-10-15', '7:00')).toBe('2026-10-15T07:00')
    expect(L.withTime('2026-10-15', 'noon')).toBe('2026-10-15')
  })

  it('normalises date values with times', () => {
    expect(L.normalizeDateValue({ start: '2026-10-15T09:00' })).toEqual({ start: '2026-10-15T09:00' })
    expect(L.normalizeDateValue({ start: '2026-10-15T09:00', end: '2026-10-15T10:30' })).toEqual({
      start: '2026-10-15T09:00',
      end: '2026-10-15T10:30'
    })
    // An end that does not come after the start goes.
    expect(L.normalizeDateValue({ start: '2026-10-15T09:00', end: '2026-10-15T09:00' })).toEqual({ start: '2026-10-15T09:00' })
    expect(L.normalizeDateValue({ start: '2026-10-15T09:00', end: '2026-10-15T08:00' })).toEqual({ start: '2026-10-15T09:00' })
    // A span of whole days has no time at its end.
    expect(L.normalizeDateValue({ start: '2026-10-15', end: '2026-10-17T17:00' })).toEqual({ start: '2026-10-15', end: '2026-10-17' })
    expect(L.normalizeDateValue({ start: '2026-10-15', end: '2026-10-15T17:00' })).toEqual({ start: '2026-10-15' })
    expect(L.normalizeDateValue('2026-10-15T18:45')).toEqual({ start: '2026-10-15T18:45' })
  })

  it('moves days and keeps the time', () => {
    expect(L.addDays('2026-10-15T09:00', 1)).toBe('2026-10-16T09:00')
    expect(L.addDays('2026-10-31T23:30', 1)).toBe('2026-11-01T23:30')
    expect(L.addDays('2026-10-15', -15)).toBe('2026-09-30')
    expect(L.shiftDateValue({ start: '2026-10-15T09:00', end: '2026-10-16T10:00' }, '2026-10-20')).toEqual({
      start: '2026-10-20T09:00',
      end: '2026-10-21T10:00'
    })
    expect(L.shiftDateValue({ start: '2026-10-15', end: '2026-10-17' }, '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-03' })
  })

  it('formats the time after the day', () => {
    const opts = { locale: 'en-GB' }
    expect(L.formatDate({ start: '2026-10-15T09:00' }, opts)).toBe('15 Oct 2026, 9:00')
    expect(L.formatDate({ start: '2026-10-15T09:00', end: '2026-10-15T10:30' }, opts)).toBe('15 Oct 2026, 9:00 → 10:30')
    expect(L.formatDate({ start: '2026-10-15T09:00', end: '2026-10-16T10:30' }, opts)).toBe('15 Oct 2026, 9:00 → 16 Oct 2026, 10:30')
    expect(L.formatDate({ start: '2026-10-15' }, opts)).toBe('15 Oct 2026')
    expect(L.formatTime('14:05', { locale: 'en-US' })).toBe('2:05 PM')
  })

  it('stores times through the property sanitiser', () => {
    expect(L.sanitizeValue(due, { start: '2026-10-15T09:00' })).toEqual({ start: '2026-10-15T09:00' })
    expect(L.parseLooseDay('2026-10-15 09:00')).toBe('2026-10-15T09:00')
  })

  it('sorts by time within a day, whole days first', () => {
    const rows = [
      row('late', { d: { start: '2026-10-15T18:00' } }),
      row('next', { d: { start: '2026-10-16' } }),
      row('early', { d: { start: '2026-10-15T08:00' } }),
      row('allDay', { d: { start: '2026-10-15' } })
    ]
    const sorted = L.applySorts(rows, schema, [{ propertyId: 'd', direction: 'asc' }])
    expect(sorted.map((r) => r.id)).toEqual(['allDay', 'early', 'late', 'next'])
  })

  it('still groups and filters by day', () => {
    const rows = [row('a', { d: { start: '2026-10-15T08:00' } }), row('b', { d: { start: '2026-10-15T18:00' } })]
    expect(L.applyFilters(rows, schema, [{ propertyId: 'd', operator: 'equals', value: '2026-10-15' }]).length).toBe(2)
    expect([...L.rowsByDay(rows, due).keys()]).toEqual(['2026-10-15'])
  })
})

describe('relative spans', () => {
  // Thursday 15 October 2026.
  const today = '2026-10-15'

  it('names spans of days counted from today', () => {
    expect(L.relativeSpan('today', today)).toEqual({ from: today, to: today })
    expect(L.relativeSpan('tomorrow', today)).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(L.relativeSpan('yesterday', today)).toEqual({ from: '2026-10-14', to: '2026-10-14' })
    expect(L.relativeSpan('overdue', today)).toEqual({ to: '2026-10-14', whole: true })
    expect(L.relativeSpan('by_today', today)).toEqual({ to: today })
    expect(L.relativeSpan('next_7_days', today)).toEqual({ from: today, to: '2026-10-21' })
    expect(L.relativeSpan('past_7_days', today)).toEqual({ from: '2026-10-09', to: today })
    expect(L.relativeSpan('this_week', today)).toEqual({ from: '2026-10-11', to: '2026-10-17' })
    expect(L.relativeSpan('this_week', today, 1)).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(L.relativeSpan('next_week', today)).toEqual({ from: '2026-10-18', to: '2026-10-24' })
    expect(L.relativeSpan('this_month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(L.relativeSpan('this_month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(L.relativeSpan('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(L.relativeSpan('last_month', '2028-03-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(L.relativeSpan('last_month', '2027-01-10')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(L.relativeSpan('past_30_days', today)).toEqual({ from: '2026-09-16', to: today })
    expect(L.relativeSpan('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(L.relativeSpan('someday', today)).toBeNull()
    expect(L.relativeSpan('today', 'not a day')).toBeNull()
    for (const name of RELATIVE_DATES) expect(L.relativeSpan(name, today)).not.toBeNull()
  })
})

describe('date_is filter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 15 October 2026, 23:30 in São Paulo: still the 15th locally, already the 16th in UTC.
    vi.setSystemTime(new Date('2026-10-16T02:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const rows = [
    row('lastWeek', { d: { start: '2026-10-08' } }),
    row('yesterday', { d: { start: '2026-10-14T17:00' } }),
    row('spanning', { d: { start: '2026-10-13', end: '2026-10-16' } }),
    row('today', { d: { start: '2026-10-15T09:00' } }),
    row('tomorrow', { d: { start: '2026-10-16' } }),
    row('nextWeek', { d: { start: '2026-10-19' } }),
    row('none')
  ]
  const ids = (filter: ViewFilter): string[] => L.applyFilters(rows, schema, [filter]).map((r) => r.id)
  const within = (value: string): string[] => ids({ propertyId: 'd', operator: 'date_is', value })

  it('uses the local day for today', () => {
    expect(within('today')).toEqual(['spanning', 'today'])
    expect(within('tomorrow')).toEqual(['spanning', 'tomorrow'])
  })

  it('tells overdue from still running', () => {
    expect(within('overdue')).toEqual(['lastWeek', 'yesterday'])
    expect(within('by_today')).toEqual(['lastWeek', 'yesterday', 'spanning', 'today'])
  })

  it('covers weeks and the next days', () => {
    expect(within('next_7_days')).toEqual(['spanning', 'today', 'tomorrow', 'nextWeek'])
    expect(within('this_week')).toEqual(['yesterday', 'spanning', 'today', 'tomorrow'])
    expect(within('next_week')).toEqual(['nextWeek'])
  })

  it('filters nothing out while the span is not chosen', () => {
    expect(within('someday').length).toBe(rows.length)
    expect(ids({ propertyId: 'd', operator: 'date_is' }).length).toBe(rows.length)
  })

  it('is offered for dates and keeps its span through normalisation', () => {
    expect(L.operatorsOf(due)).toContain('date_is')
    expect(L.operatorsOf({ id: 'c', name: 'Created', type: 'created_time' })).toContain('date_is')
    expect(L.operatorsOf({ id: 't', name: 'Text', type: 'text' })).not.toContain('date_is')
    expect(L.ruleValueOf(due, 'next_week', schema, 'date_is')).toBe('next_week')
    expect(L.ruleValueOf(due, '2026-10-15', schema, 'date_is')).toBeUndefined()
    expect(L.operatorLabel('date_is', 'date')).toBe('is within')
  })

  it('gives a new row the first day of the span from today on', () => {
    const defaults = (value: string): unknown =>
      L.defaultsFromFilters(schema, [{ propertyId: 'd', operator: 'date_is', value }]).values['d']
    expect(defaults('this_week')).toEqual({ start: '2026-10-15' })
    expect(defaults('tomorrow')).toEqual({ start: '2026-10-16' })
    expect(defaults('next_week')).toEqual({ start: '2026-10-18' })
    expect(defaults('overdue')).toBeUndefined()
    expect(defaults('yesterday')).toBeUndefined()
  })
})
