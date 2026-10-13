// Date handling under a negative-UTC-offset timezone with historical DST transitions
// at local midnight (America/Sao_Paulo). Runs in its own file because the timezone is
// process-wide state.
process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import type { Block } from '../../../../shared/types'
import * as L from '../logic'

function row(id: string, values: Record<string, unknown>, extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: [[id]], values: values as Block['props']['values'] },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    ...extra
  }
}

const dateProp = { id: 'd', name: 'Due', type: 'date' as const }

describe('timezone guard', () => {
  it('really runs in America/Sao_Paulo (UTC-3, DST history available)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Sao_Paulo')
    expect(new Date(2024, 5, 15).getTimezoneOffset()).toBe(180)
    // Summer time 2018/19 (UTC-2): proves the tz database has the transitions tested below.
    expect(new Date(2018, 11, 15).getTimezoneOffset()).toBe(120)
    // The classic failure this suite guards against: an ISO day parsed as UTC is the previous local day.
    expect(new Date('2024-03-10').getDate()).toBe(9)
  })
})

describe('day strings never shift', () => {
  const days = ['2024-01-01', '2024-03-10', '2024-02-29', '2024-12-31', '2018-11-04', '2019-02-17', '1999-12-31', '0099-01-01']

  it.each(days)('%s round-trips through every helper', (day) => {
    expect(L.dayKey(day)).toBe(day)
    expect(L.dayKey({ start: day })).toBe(day)
    expect(L.dayKey(`${day}T00:00:00Z`)).toBe(day)
    expect(L.dayKey(`${day}T23:59:59-03:00`)).toBe(day)
    expect(L.normalizeDateValue({ start: day })).toEqual({ start: day })
    expect(L.toISODate(L.parseISODate(day)!)).toBe(day)
    expect(L.addDays(L.addDays(day, 1), -1)).toBe(day)
    expect(L.addDays(day, 0)).toBe(day)
    expect(L.diffDays(day, L.addDays(day, 40))).toBe(40)
    const month = L.monthOf(day)
    expect(L.calendarMatrix(month.year, month.month).flat().filter((d) => d.inMonth && d.date === day)).toHaveLength(1)
  })

  it('formats the stored day, not the day before', () => {
    expect(L.formatDay('2024-03-10', { locale: 'en-US' })).toBe('Mar 10, 2024')
    expect(L.formatDay('2024-01-01', { locale: 'en-US' })).toBe('Jan 1, 2024')
    expect(L.formatDay('2018-11-04', { locale: 'pt-BR' })).toContain('4')
    expect(L.formatDate({ start: '2024-12-31', end: '2025-01-01' }, { locale: 'en-US' })).toBe('Dec 31, 2024 → Jan 1, 2025')
    expect(L.formatValue({ start: '2024-03-01' }, dateProp, { locale: 'en-US' })).toBe('Mar 1, 2024')
    expect(L.monthLabel(2024, 0, 'en-US')).toBe('January 2024')
    expect(L.weekdayLabels('en-US')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  it('crosses the DST transitions that removed / repeated local midnight', () => {
    // 2018-11-04 00:00 did not exist in Sao Paulo; 2019-02-17 had two 23:00-00:00 hours.
    expect(L.addDays('2018-11-03', 1)).toBe('2018-11-04')
    expect(L.addDays('2018-11-04', 1)).toBe('2018-11-05')
    expect(L.addDays('2018-11-05', -1)).toBe('2018-11-04')
    expect(L.addDays('2019-02-16', 1)).toBe('2019-02-17')
    expect(L.addDays('2019-02-17', 1)).toBe('2019-02-18')
    expect(L.diffDays('2018-11-01', '2018-11-30')).toBe(29)
    expect(L.diffDays('2019-02-01', '2019-02-28')).toBe(27)
    expect(L.toISODate(L.parseISODate('2018-11-04')!)).toBe('2018-11-04')
  })

  it.each([
    [2018, 10, 30],
    [2019, 1, 28],
    [2024, 1, 29],
    [2024, 2, 31],
    [2026, 9, 31]
  ])('calendarMatrix(%i, %i) is %i consecutive distinct days in full weeks', (year, month, count) => {
    const weeks = L.calendarMatrix(year, month)
    const flat = weeks.flat()
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(flat.filter((d) => d.inMonth)).toHaveLength(count)
    expect(new Set(flat.map((d) => d.date)).size).toBe(flat.length)
    for (let i = 1; i < flat.length; i++) expect(L.diffDays(flat[i - 1].date, flat[i].date)).toBe(1)
    const first = flat.find((d) => d.inMonth)!
    expect(first.date).toBe(`${year}-${String(month + 1).padStart(2, '0')}-01`)
    // The grid starts on the weekday the 1st really falls on (Sunday first).
    expect(flat.indexOf(first)).toBe(new Date(Date.UTC(year, month, 1)).getUTCDay())
  })

  it('month navigation wraps years and never produces an invalid month', () => {
    expect(L.shiftMonth({ year: 2024, month: 0 }, -1)).toEqual({ year: 2023, month: 11 })
    expect(L.shiftMonth({ year: 2024, month: 11 }, 1)).toEqual({ year: 2025, month: 0 })
    expect(L.shiftMonth({ year: 2024, month: 5 }, 30)).toEqual({ year: 2026, month: 11 })
    expect(L.shiftMonth({ year: 1, month: 0 }, -5)).toEqual({ year: 1, month: 0 })
    expect(L.shiftMonth({ year: 9999, month: 11 }, 5)).toEqual({ year: 9999, month: 11 })
    expect(L.monthOf('2024-03-10')).toEqual({ year: 2024, month: 2 })
    expect(L.monthOf('garbage', new Date(2020, 6, 4))).toEqual({ year: 2020, month: 6 })
  })

  it('moving a calendar item keeps the stored day strings and the duration', () => {
    expect(L.shiftDateValue({ start: '2018-11-02', end: '2018-11-05' }, '2018-11-03')).toEqual({
      start: '2018-11-03',
      end: '2018-11-06'
    })
    expect(L.shiftDateValue({ start: '2024-02-28', end: '2024-03-01' }, '2024-12-30')).toEqual({
      start: '2024-12-30',
      end: '2025-01-01'
    })
  })

  it('places rows on the days they store and filters by those days', () => {
    const rows = [
      row('a', { d: { start: '2024-03-10' } }),
      row('b', { d: { start: '2018-11-03', end: '2018-11-05' } }),
      row('c', { d: '2024-03-10T01:30:00Z' })
    ]
    const byDay = L.rowsByDay(rows, dateProp)
    expect(byDay.get('2024-03-10')?.map((r) => r.id)).toEqual(['a', 'c'])
    expect(byDay.get('2024-03-09')).toBeUndefined()
    expect(['2018-11-03', '2018-11-04', '2018-11-05'].map((d) => byDay.get(d)?.[0].id)).toEqual(['b', 'b', 'b'])
    const schema = { d: dateProp }
    const on = (value: string): string[] =>
      L.applyFilters(rows, schema, [{ propertyId: 'd', operator: 'equals', value }]).map((r) => r.id)
    expect(on('2024-03-10')).toEqual(['a', 'c'])
    expect(on('2024-03-09')).toEqual([])
    expect(on('2018-11-04')).toEqual(['b'])
    expect(L.defaultsFromFilters(schema, [{ propertyId: 'd', operator: 'equals', value: '2024-03-10' }]).values).toEqual({
      d: { start: '2024-03-10' }
    })
  })

  it('timestamps map to the local day they fall on', () => {
    // 2024-03-10T02:00Z is still March 9th, 23:00 in Sao Paulo.
    const late = Date.UTC(2024, 2, 10, 2, 0)
    expect(L.dayKey(late)).toBe('2024-03-09')
    expect(L.dayKey(Date.UTC(2024, 2, 10, 3, 0))).toBe('2024-03-10')
    expect(L.todayISO(new Date(late))).toBe('2024-03-09')
    const created = { id: 'c', name: 'Created', type: 'created_time' as const }
    const r = row('x', {}, { createdAt: late })
    expect(L.groupRows([r], created)[1].key).toBe('2024-03-09')
    expect(L.matchesFilter(r, created, { propertyId: 'c', operator: 'equals', value: '2024-03-09' })).toBe(true)
  })
})

describe('invalid dates never become Invalid Date', () => {
  const bad = ['', ' ', 'soon', '2024-13-01', '2024-00-10', '2024-02-30', '2023-02-29', '2024-1', '2024-01-155', '0000-01-01', '99999-01-01']

  it.each(bad)('%j is rejected everywhere', (text) => {
    expect(L.parseISODate(text)).toBeNull()
    expect(L.dayKey(text)).toBeNull()
    expect(L.normalizeDateValue({ start: text })).toBeNull()
    expect(L.formatDay(text)).toBe('')
    expect(L.addDays(text, 1)).toBe(text)
    expect(L.diffDays(text, '2024-01-01')).toBe(0)
    expect(L.getCellValue(row('r', { d: { start: text } }), dateProp)).toBeNull()
  })

  it('tolerates non-string and non-finite input', () => {
    for (const v of [NaN, Infinity, -Infinity, 8.64e15 + 1, {}, [], true, { start: 5 }, { start: null }]) {
      expect(L.dayKey(v)).toBeNull()
    }
    expect(L.toISODate(new Date(NaN))).toBe('')
    expect(L.formatTimestamp(NaN)).toBe('')
    expect(L.formatTimestamp(8.64e15 + 1)).toBe('')
    expect(L.addDays('2024-01-01', NaN)).toBe('2024-01-01')
    expect(L.addDays('9999-12-31', 1)).toBe('9999-12-31')
  })

  it('drops an end that is invalid or not after the start', () => {
    expect(L.normalizeDateValue({ start: '2024-03-10', end: '2024-03-09' })).toEqual({ start: '2024-03-10' })
    expect(L.normalizeDateValue({ start: '2024-03-10', end: '2024-03-10' })).toEqual({ start: '2024-03-10' })
    expect(L.normalizeDateValue({ start: '2024-03-10', end: 'x' })).toEqual({ start: '2024-03-10' })
    expect(L.normalizeDateValue({ start: '2024-3-1', end: '2024-03-12T10:00' })).toEqual({ start: '2024-03-01', end: '2024-03-12' })
  })

  it('caps absurd ranges instead of looping', () => {
    const map = L.rowsByDay([row('r', { d: { start: '0001-01-01', end: '9999-12-31' } })], dateProp)
    expect(map.size).toBe(L.MAX_RANGE_DAYS)
  })

  it('converts free text to a date only when it clearly is one', () => {
    expect(L.parseLooseDay('2026-04-01')).toBe('2026-04-01')
    expect(L.parseLooseDay('April 1, 2026')).toBe('2026-04-01')
    expect(L.parseLooseDay('5')).toBeNull()
    expect(L.parseLooseDay('soon')).toBeNull()
    expect(L.parseLooseDay('2026-02-30')).toBeNull()
    // Numeric dates follow the locale's order instead of always being read as month/day.
    expect(L.parseLooseDay('25/12/2026', 'pt-BR')).toBe('2026-12-25')
    expect(L.parseLooseDay('03/04/2026', 'pt-BR')).toBe('2026-04-03')
    expect(L.parseLooseDay('03/04/2026', 'en-US')).toBe('2026-03-04')
    expect(L.parseLooseDay('25/12/2026', 'en-US')).toBeNull()
  })
})
