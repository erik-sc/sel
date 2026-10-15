import { describe, expect, it } from 'vitest'
import {
  cleanLine,
  dayOfEntryId,
  entryId,
  isDay,
  NOTEBOOK_ID,
  nextDay,
  onThisDay,
  previousDay,
  readEntry,
  type NotebookEntry
} from './notebook'

const entry = (day: string, text = `line of ${day}`): NotebookEntry => ({ day, text, updatedAt: 0 })

describe('days', () => {
  it('are real calendar days written YYYY-MM-DD', () => {
    expect(isDay('2026-10-15')).toBe(true)
    expect(isDay('2024-02-29')).toBe(true)
    expect(isDay('2026-02-29')).toBe(false)
    expect(isDay('2026-13-01')).toBe(false)
    expect(isDay('2026-10-15T10:00')).toBe(false)
    expect(isDay(20261015)).toBe(false)
  })

  it('step across months, years and leap days without a time zone', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(nextDay('2024-02-28')).toBe('2024-02-29')
    expect(nextDay('2026-02-28')).toBe('2026-03-01')
    expect(previousDay('2027-01-01')).toBe('2026-12-31')
    expect(previousDay('2024-03-01')).toBe('2024-02-29')
  })

  it('have fixed block ids under the notebook, the same on every device', () => {
    expect(entryId('2026-10-15')).toBe(`${NOTEBOOK_ID}-2026-10-15`)
    expect(dayOfEntryId(entryId('2026-10-15'))).toBe('2026-10-15')
    expect(dayOfEntryId(NOTEBOOK_ID)).toBeNull()
    expect(dayOfEntryId(`${NOTEBOOK_ID}-2026-02-30`)).toBeNull()
    expect(dayOfEntryId('2026-10-15')).toBeNull()
    expect(dayOfEntryId(42)).toBeNull()
  })
})

describe('a line', () => {
  it('is one short paragraph with its spaces tidied', () => {
    expect(cleanLine('  a   quiet\tday  ')).toBe('a quiet day')
    expect(cleanLine('first\r\n\r\n\r\nsecond')).toBe('first\nsecond')
    expect(cleanLine('bell\u0007 rang')).toBe('bell rang')
    expect(cleanLine('x'.repeat(2000))).toHaveLength(600)
    expect(cleanLine(null)).toBe('')
  })

  it('is read back from a day block as plain text', () => {
    const block = { id: entryId('2026-10-15'), props: { title: [['walked ', [['b']]], ['home']] }, updatedAt: 5 }
    expect(readEntry(block as never)).toEqual({ day: '2026-10-15', text: 'walked home', updatedAt: 5 })
    expect(readEntry({ id: 'other', props: {}, updatedAt: 0 })).toBeNull()
  })
})

describe('on this day', () => {
  const entries = [entry('2026-10-15'), entry('2025-10-15'), entry('2023-10-15'), entry('2025-10-14'), entry('2024-10-15', ''), entry('2027-10-15')]

  it('finds the same date in earlier years, the most recent first', () => {
    const found = onThisDay(entries, '2026-10-15')
    expect(found.map((f) => [f.entry.day, f.years])).toEqual([
      ['2025-10-15', 1],
      ['2023-10-15', 3]
    ])
  })

  it('finds nothing on a date never written before', () => {
    expect(onThisDay(entries, '2026-10-16')).toEqual([])
    expect(onThisDay(entries, 'not a day')).toEqual([])
  })

  it('lets the 29th of February answer on the 28th of a year without one', () => {
    const leap = [entry('2024-02-29'), entry('2024-02-28'), entry('2025-02-28')]
    expect(onThisDay(leap, '2026-02-28').map((f) => f.entry.day)).toEqual(['2025-02-28', '2024-02-29', '2024-02-28'])
    // A leap year has its own 29th: the 28th answers only for itself.
    expect(onThisDay(leap, '2028-02-28').map((f) => f.entry.day)).toEqual(['2025-02-28', '2024-02-28'])
    expect(onThisDay(leap, '2028-02-29').map((f) => f.entry.day)).toEqual(['2024-02-29'])
  })
})
