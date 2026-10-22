import { describe, expect, it } from 'vitest'
import { defaultForm, firstOccurrence, formOf, presetOf, presetRule, ruleOf } from './repeat'
import { reminderAt, reminderShortcutOf } from './remind'

describe('recurrence presets', () => {
  it('anchors on the due date', () => {
    // Tuesday 20 October 2026
    expect(presetRule('daily', '2026-10-20')).toBe('FREQ=DAILY')
    expect(presetRule('weekdays', '2026-10-20')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(presetRule('weekly', '2026-10-20')).toBe('FREQ=WEEKLY;BYDAY=TU')
    expect(presetRule('monthly', '2026-10-20')).toBe('FREQ=MONTHLY;BYMONTHDAY=20')
    expect(presetRule('yearly', '2026-10-20T09:00')).toBe('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=20')
  })

  it('knows a preset when it sees one, however it was written', () => {
    expect(presetOf('FREQ=WEEKLY;BYDAY=TU', '2026-10-20')).toBe('weekly')
    expect(presetOf('RRULE:FREQ=WEEKLY;BYDAY=FR,TH,WE,TU,MO', '2026-10-20')).toBe('weekdays')
    expect(presetOf('FREQ=WEEKLY;BYDAY=MO', '2026-10-20')).toBeNull()
    expect(presetOf('FREQ=DAILY;INTERVAL=2', '2026-10-20')).toBeNull()
    expect(presetOf('FREQ=DAILY;COUNT=3', '2026-10-20')).toBeNull()
  })
})

describe('the Custom form', () => {
  it('writes a rule and reads it back', () => {
    const forms = [
      { ...defaultForm(), freq: 'DAILY' as const, interval: 3 },
      { ...defaultForm(), freq: 'WEEKLY' as const, interval: 2, weekdays: [1, 3, 5] },
      { ...defaultForm(), freq: 'MONTHLY' as const, monthDay: -1, end: { kind: 'count' as const, count: 6 } },
      { ...defaultForm(), freq: 'YEARLY' as const, month: 2, monthDay: 29, end: { kind: 'until' as const, date: '2030-12-31' } }
    ]
    for (const form of forms) expect(formOf(ruleOf(form))).toEqual(form)
    expect(ruleOf(forms[1])).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR')
    expect(ruleOf(forms[3])).toBe('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;UNTIL=20301231')
  })

  it('keeps numbers in bounds and weekdays in week order', () => {
    expect(ruleOf({ ...defaultForm(), freq: 'DAILY', interval: 0 })).toBe('FREQ=DAILY')
    expect(ruleOf({ ...defaultForm(), freq: 'DAILY', interval: 5000 })).toBe('FREQ=DAILY;INTERVAL=999')
    expect(ruleOf({ ...defaultForm(), weekdays: [0, 6, 1, 1] })).toBe('FREQ=WEEKLY;BYDAY=MO,SA,SU')
    expect(ruleOf({ ...defaultForm(), end: { kind: 'count', count: -4 } })).toBe('FREQ=WEEKLY;COUNT=1')
    expect(ruleOf({ ...defaultForm(), end: { kind: 'until', date: 'soon' } })).toBe('FREQ=WEEKLY')
  })

  it('leaves alone a rule it cannot show', () => {
    expect(formOf('FREQ=MONTHLY;BYDAY=1MO')).toBeNull()
    expect(formOf('FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1')).toBeNull()
    expect(formOf('FREQ=YEARLY;BYMONTH=1,7')).toBeNull()
    expect(formOf('FREQ=HOURLY')).toBeNull()
    expect(formOf('')).toBeNull()
  })
})

describe('the first day of a repeat', () => {
  it('is the anchor when it falls on it, else the next one', () => {
    expect(firstOccurrence('FREQ=DAILY', '2026-10-15')).toBe('2026-10-15')
    expect(firstOccurrence('FREQ=WEEKLY;BYDAY=MO,WE', '2026-10-15')).toBe('2026-10-19')
    expect(firstOccurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-17')).toBe('2026-10-19')
    expect(firstOccurrence('FREQ=MONTHLY;BYMONTHDAY=31', '2026-11-02')).toBe('2026-12-31')
    expect(firstOccurrence('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '2026-10-15')).toBe('2028-02-29')
    expect(firstOccurrence('FREQ=DAILY;UNTIL=20261001', '2026-10-15')).toBeNull()
    expect(firstOccurrence('nonsense', '2026-10-15')).toBeNull()
  })
})

describe('relative reminders', () => {
  it('works out the moment from a due date with a time', () => {
    const due = '2026-10-16T15:00'
    expect(reminderAt(due, 'atTime')).toBe('2026-10-16T15:00')
    expect(reminderAt(due, 'minutes15')).toBe('2026-10-16T14:45')
    expect(reminderAt(due, 'hour1')).toBe('2026-10-16T14:00')
    expect(reminderAt(due, 'dayBefore')).toBe('2026-10-15T09:00')
  })

  it('crosses midnight, months and years', () => {
    expect(reminderAt('2027-01-01T00:10', 'minutes15')).toBe('2026-12-31T23:55')
    expect(reminderAt('2026-03-01T00:30', 'hour1')).toBe('2026-02-28T23:30')
    expect(reminderAt('2026-03-01', 'dayBefore')).toBe('2026-02-28T09:00')
  })

  it('gives a day without a time its morning, and nothing minutes before it', () => {
    expect(reminderAt('2026-10-16', 'atTime')).toBe('2026-10-16T09:00')
    expect(reminderAt('2026-10-16', 'minutes15')).toBeNull()
    expect(reminderAt('2026-10-16', 'hour1')).toBeNull()
    expect(reminderAt(null, 'atTime')).toBeNull()
    expect(reminderAt('2026-02-30', 'atTime')).toBeNull()
  })

  it('knows which shortcut a stored reminder is', () => {
    expect(reminderShortcutOf('2026-10-16T15:00', '2026-10-16T14:45')).toBe('minutes15')
    expect(reminderShortcutOf('2026-10-16T15:00', '2026-10-16T14:40')).toBeNull()
    expect(reminderShortcutOf('2026-10-16', null)).toBeNull()
  })
})
