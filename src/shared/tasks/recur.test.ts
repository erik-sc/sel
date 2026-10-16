import { describe, expect, it } from 'vitest'
import { TASK_PROPS } from './index'
import { parseTask } from './parse'
import { completeTaskOps, completeTaskValues, nextOccurrence, readRecurrence } from './recur'

// 2026-10-15 is a Thursday.
describe('the next occurrence', () => {
  const cases: [string, string, 'due' | 'completion', string | null, string, string | null][] = [
    ['daily, done on the day', 'FREQ=DAILY', 'due', '2026-10-15', '2026-10-15T10:00', '2026-10-16'],
    ['daily keeps the time of day', 'FREQ=DAILY', 'due', '2026-10-15T08:30', '2026-10-15T09:00', '2026-10-16T08:30'],
    ['daily, overdue: tomorrow, not the day after the missed one', 'FREQ=DAILY', 'due', '2026-10-10', '2026-10-15T10:00', '2026-10-16'],
    ['daily, done early: the day after the due date', 'FREQ=DAILY', 'due', '2026-10-18', '2026-10-15T10:00', '2026-10-19'],
    ['every 3 days', 'FREQ=DAILY;INTERVAL=3', 'due', '2026-10-15', '2026-10-15T10:00', '2026-10-18'],
    ['every 3 days, overdue, stays on the series', 'FREQ=DAILY;INTERVAL=3', 'due', '2026-10-09', '2026-10-15T10:00', '2026-10-18'],
    ['weekly on the due weekday', 'FREQ=WEEKLY', 'due', '2026-10-15', '2026-10-15T10:00', '2026-10-22'],
    ['monday and wednesday', 'FREQ=WEEKLY;BYDAY=MO,WE', 'due', '2026-10-19', '2026-10-19T10:00', '2026-10-21'],
    ['monday and wednesday, wednesday to monday', 'FREQ=WEEKLY;BYDAY=MO,WE', 'due', '2026-10-21', '2026-10-21T10:00', '2026-10-26'],
    ['weekdays, friday to monday', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'due', '2026-10-16', '2026-10-16T18:00', '2026-10-19'],
    ['every 2 weeks', 'FREQ=WEEKLY;INTERVAL=2', 'due', '2026-10-15', '2026-10-15T10:00', '2026-10-29'],
    ['every other friday', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', 'due', '2026-10-16', '2026-10-16T10:00', '2026-10-30'],
    ['every other day, overdue, stays on the series', 'FREQ=DAILY;INTERVAL=2', 'due', '2026-10-12', '2026-10-15T10:00', '2026-10-16'],
    ['monthly on the 5th', 'FREQ=MONTHLY;BYMONTHDAY=5', 'due', '2026-11-05', '2026-11-05T10:00', '2026-12-05'],
    ['monthly on the 31st skips short months', 'FREQ=MONTHLY;BYMONTHDAY=31', 'due', '2026-10-31', '2026-10-31T10:00', '2026-12-31'],
    ['monthly on the due date', 'FREQ=MONTHLY', 'due', '2026-01-15', '2026-01-15T10:00', '2026-02-15'],
    ['monthly from the 31st skips months without one', 'FREQ=MONTHLY', 'due', '2026-01-31', '2026-01-31T10:00', '2026-03-31'],
    ['yearly', 'FREQ=YEARLY', 'due', '2026-10-20', '2026-10-15T10:00', '2027-10-20'],
    ['yearly on the 29th of February', 'FREQ=YEARLY', 'due', '2028-02-29', '2028-02-29T10:00', '2032-02-29'],
    ['the last friday of the month', 'FREQ=MONTHLY;BYDAY=-1FR', 'due', '2026-10-30', '2026-10-30T10:00', '2026-11-27'],
    ['from completion: counts from the day it was done', 'FREQ=WEEKLY;INTERVAL=3', 'completion', '2026-10-01', '2026-10-15T10:00', '2026-11-05'],
    ['from completion keeps the due time', 'FREQ=DAILY', 'completion', '2026-10-01T07:00', '2026-10-15T22:00', '2026-10-16T07:00'],
    ['without a due date, from the completion', 'FREQ=DAILY', 'due', null, '2026-10-15T10:00', '2026-10-16'],
    ['UNTIL ends it', 'FREQ=DAILY;UNTIL=20261015', 'due', '2026-10-15', '2026-10-15T10:00', null],
    ['UNTIL not reached', 'FREQ=DAILY;UNTIL=20261031T000000Z', 'due', '2026-10-15', '2026-10-15T10:00', '2026-10-16'],
    ['COUNT is not honoured', 'FREQ=DAILY;COUNT=1', 'due', '2026-10-15', '2026-10-15T10:00', '2026-10-16'],
    ['an unreadable rule', 'FREQ=FORTNIGHTLY', 'due', '2026-10-15', '2026-10-15T10:00', null],
    ['a damaged due date counts from the completion', 'FREQ=DAILY', 'due', '2026-02-31', '2026-10-15T10:00', '2026-10-16']
  ]
  for (const [name, rule, from, due, completedAt, expected] of cases) {
    it(name, () => {
      expect(nextOccurrence(rule, from, due, completedAt)).toBe(expected)
    })
  }
})

describe('reading the stored recurrence', () => {
  it('the JSON the quick add writes, or a bare rule', () => {
    expect(readRecurrence(JSON.stringify({ rule: 'FREQ=DAILY', from: 'completion', text: 'todo! dia' }))).toEqual({ rule: 'FREQ=DAILY', from: 'completion', text: 'todo! dia' })
    expect(readRecurrence('RRULE:FREQ=WEEKLY;BYDAY=MO')).toEqual({ rule: 'FREQ=WEEKLY;BYDAY=MO', from: 'due', text: 'FREQ=WEEKLY;BYDAY=MO' })
    for (const bad of [null, '', 'toda segunda', '{not json', JSON.stringify({ rule: 'nope' }), JSON.stringify(['FREQ=DAILY']), 7]) expect(readRecurrence(bad)).toBeNull()
  })
})

describe('completing a task', () => {
  const NOW = new Date(2026, 9, 15, 18, 40)

  it('without a repeat: done, and dated', () => {
    const result = completeTaskValues({ [TASK_PROPS.due]: { start: '2026-10-15' } }, NOW)
    expect(result).toEqual({
      values: { [TASK_PROPS.due]: { start: '2026-10-15' }, [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-15T18:40' } },
      previous: { [TASK_PROPS.done]: undefined, [TASK_PROPS.completedAt]: undefined }
    })
  })

  it('with a repeat: open, moved on with its reminder, and dated', () => {
    const recurrence = JSON.stringify({ rule: 'FREQ=WEEKLY;BYDAY=MO,TH', from: 'due', text: 'toda seg e qui' })
    const values = { [TASK_PROPS.due]: { start: '2026-10-15T09:00' }, [TASK_PROPS.remind]: { start: '2026-10-14T20:00' }, [TASK_PROPS.recurrence]: recurrence }
    const result = completeTaskValues(values, NOW)
    expect(result?.next).toBe('2026-10-19T09:00')
    expect(result?.values).toEqual({
      [TASK_PROPS.due]: { start: '2026-10-19T09:00' },
      [TASK_PROPS.remind]: { start: '2026-10-18T20:00' },
      [TASK_PROPS.recurrence]: recurrence,
      [TASK_PROPS.completedAt]: { start: '2026-10-15T18:40' }
    })
    expect(result?.previous).toEqual({ [TASK_PROPS.due]: values[TASK_PROPS.due], [TASK_PROPS.remind]: values[TASK_PROPS.remind], [TASK_PROPS.completedAt]: undefined })
  })

  it('with a repeat that has ended: done', () => {
    const values = { [TASK_PROPS.due]: { start: '2026-10-15' }, [TASK_PROPS.recurrence]: JSON.stringify({ rule: 'FREQ=DAILY;UNTIL=20261015', from: 'due', text: '' }) }
    expect(completeTaskValues(values, NOW)?.values[TASK_PROPS.done]).toBe(true)
  })

  it('that is already done: nothing to do', () => {
    expect(completeTaskValues({ [TASK_PROPS.done]: true }, NOW)).toBeNull()
    expect(completeTaskOps({ id: 'r', props: { values: { [TASK_PROPS.done]: true } } }, NOW)).toEqual([])
  })

  it('as one update op', () => {
    expect(completeTaskOps({ id: 'r', props: {} }, NOW)).toEqual([
      { op: 'update', id: 'r', patch: { props: { values: { [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-15T18:40' } } } } }
    ])
  })

  it('from what the quick add wrote: "todo! mês" counts from the completion', () => {
    const parsed = parseTask('Cortar cabelo todo! mês', { now: new Date(2026, 8, 1, 9, 0) })
    const values = { [TASK_PROPS.due]: { start: parsed.due as string }, [TASK_PROPS.recurrence]: JSON.stringify(parsed.recurrence) }
    expect(completeTaskValues(values, NOW)?.next).toBe('2026-11-15')
  })
})
