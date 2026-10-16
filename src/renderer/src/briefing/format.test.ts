process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import type { BriefingEvent, BriefingTask, BriefingTasks } from '../../../shared/briefing'
import { agendaByDay, calendarNotes, clock, dayStart, dayTimeline, dueLabel, eventMoments, eventTime, longDate, phraseSource, phraseText, shortClock, taskGroups, tickedKey, untilMidnight, updatedLabel } from './format'

const at = (hour: number, minute = 0, day = 13): number => new Date(2026, 9, day, hour, minute).getTime()
const event = (start: number, end: number, allDay = false): { start: number; end: number; allDay: boolean } => ({ start, end, allDay })

describe('dates and times', () => {
  it('writes the day out in the words of the locale', () => {
    expect(longDate('2026-10-13', 'en-GB')).toBe('Tuesday 13 October')
    expect(longDate('2026-10-13', 'en-US')).toBe('Tuesday, October 13')
    expect(longDate('2026-10-13', 'pt-BR')).toBe('terça-feira, 13 de outubro')
    expect(longDate('nonsense')).toBe('nonsense')
    expect(dayStart('2026-10-13')).toBe(at(0))
    expect(dayStart('2026-13-45x')).toBeNull()
  })

  it('uses the clock of the locale: 24 hours or 12', () => {
    expect(clock(at(8, 5), 'en-GB')).toBe('08:05')
    expect(clock(at(8, 5), 'pt-BR')).toBe('08:05')
    expect(clock(at(20, 5), 'en-US').replace(/\s/g, ' ')).toBe('8:05 PM')
  })

  it('words an event within its day', () => {
    const from = at(0)
    const to = at(0, 0, 14)
    expect(eventTime(event(at(9), at(9, 30)), from, to, 'en-GB')).toBe('09:00 – 09:30')
    expect(eventTime(event(at(9), at(9)), from, to, 'en-GB')).toBe('09:00')
    expect(eventTime(event(from, to, true), from, to, 'en-GB')).toBe('All day')
    expect(eventTime(event(at(22, 0, 12), at(1)), from, to, 'en-GB')).toBe('until 01:00')
    expect(eventTime(event(at(23), at(2, 0, 14)), from, to, 'en-GB')).toBe('from 23:00')
    expect(eventTime(event(at(12, 0, 12), at(12, 0, 14)), from, to, 'en-GB')).toBe('All day')
  })

  it('says how late or how soon a task is due', () => {
    expect(dueLabel('2026-10-13', '2026-10-13')).toBe('Today')
    expect(dueLabel('2026-10-12', '2026-10-13')).toBe('Yesterday')
    expect(dueLabel('2026-10-14', '2026-10-13')).toBe('Tomorrow')
    expect(dueLabel('2026-10-10', '2026-10-13')).toBe('3 days ago')
    expect(dueLabel('2026-09-01', '2026-10-13', 'en-GB')).toBe('1 Sept')
    expect(dueLabel('2025-12-31', '2026-10-13', 'en-GB')).toBe('31 Dec 2025')
    expect(dueLabel('2026-11-01', '2026-10-13', 'en-GB')).toBe('1 Nov')
    expect(dueLabel('junk', '2026-10-13')).toBe('junk')
    // Across a change of clocks a day is still a day (São Paulo, November 2018).
    expect(dueLabel('2018-11-03', '2018-11-04')).toBe('Yesterday')
    expect(dueLabel('2018-11-05', '2018-11-04')).toBe('Tomorrow')
  })

  it('says when the briefing was updated', () => {
    expect(updatedLabel(at(8, 5), at(9), 'en-GB')).toBe('Updated 08:05')
    expect(updatedLabel(at(22, 5, 12), at(9), 'en-GB')).toBe('Updated 12 Oct, 22:05')
  })

  it('counts down to the next local midnight', () => {
    expect(untilMidnight(at(23, 59))).toBe(60_000)
    expect(untilMidnight(at(0))).toBe(24 * 3_600_000)
    expect(untilMidnight(at(0, 0, 14) - 10)).toBe(1000)
    // 3 November 2018 was 23 hours long in São Paulo.
    expect(untilMidnight(new Date(2018, 10, 3, 12).getTime())).toBe(12 * 3_600_000)
    expect(untilMidnight(new Date(2018, 10, 4, 12).getTime())).toBe(12 * 3_600_000)
  })
})

describe('calendars that could not be read', () => {
  it('says it once per reason, with when the agenda was last read', () => {
    const notes = calendarNotes(
      [
        { label: 'Work', error: 'offline', updatedAt: at(8, 5) },
        { label: 'Home', error: 'offline', updatedAt: at(7, 50) },
        { label: 'Club', error: 'forbidden' }
      ],
      at(9),
      'en-GB'
    )
    expect(notes).toEqual([
      'Work, Home: The calendar could not be reached. You may be offline. Last updated 07:50.',
      'Club: The calendar refused the request. Its secret address may have been reset.'
    ])
    expect(calendarNotes([], at(9))).toEqual([])
    expect(calendarNotes([{ label: 'X' }], at(9))).toEqual(['X: The calendar could not be read.'])
  })
})

describe('what is now and what is next', () => {
  const day = [event(at(0), at(0, 0, 14), true), event(at(9), at(9, 30)), event(at(11), at(12)), event(at(15), at(15))]

  it('marks the event going on', () => {
    expect(eventMoments(day, at(11, 30))).toEqual(['day', 'past', 'now', 'later'])
    expect(eventMoments(day, at(9))).toEqual(['day', 'now', 'later', 'later'])
  })

  it('marks the next one only when nothing is going on', () => {
    expect(eventMoments(day, at(8))).toEqual(['day', 'next', 'later', 'later'])
    expect(eventMoments(day, at(10))).toEqual(['day', 'past', 'next', 'later'])
    expect(eventMoments(day, at(12))).toEqual(['day', 'past', 'past', 'next'])
    expect(eventMoments(day, at(15))).toEqual(['day', 'past', 'past', 'now'])
    expect(eventMoments(day, at(16))).toEqual(['day', 'past', 'past', 'past'])
    expect(eventMoments([], at(8))).toEqual([])
  })

  it('finds the next one whatever the order', () => {
    expect(eventMoments([event(at(15), at(16)), event(at(11), at(12))], at(8))).toEqual(['later', 'next'])
  })
})

describe('the source of a phrase', () => {
  it('names the author, the work and the place', () => {
    expect(phraseSource({ author: 'Marcus Aurelius', work: 'Meditations', locator: 'Book IV, 3', translator: 'George Long' })).toEqual({ author: 'Marcus Aurelius', work: 'Meditations, Book IV, 3', translator: 'translated by George Long' })
    expect(phraseSource({ author: 'Epictetus', work: 'Enchiridion', locator: 'Enchiridion, 5', translator: null }).work).toBe('Enchiridion, 5')
    expect(phraseSource({ author: 'Rabindranath Tagore', work: 'Gitanjali', locator: 'Gitanjali, 48', translator: 'Rabindranath Tagore' })).toEqual({ author: 'Rabindranath Tagore', work: 'Gitanjali, 48', translator: '' })
    expect(phraseSource({ author: 'Me' })).toEqual({ author: 'Me', work: '', translator: '' })
    expect(phraseSource({ author: '', work: 'Siddhartha' })).toEqual({ author: '', work: 'Siddhartha', translator: '' })
  })

  it('copies as the passage and one line of source', () => {
    expect(phraseText({ text: 'Look within.', author: 'Marcus Aurelius', work: 'Meditations', locator: 'Book VII, 59', translator: 'George Long' })).toBe('Look within.\n— Marcus Aurelius, Meditations, Book VII, 59')
    expect(phraseText({ text: 'Just this.', author: '' })).toBe('Just this.')
  })
})

describe('folding the task list', () => {
  const task = (id: string): BriefingTask => ({ id, kind: 'row', title: id, pageId: id, source: 'Tasks' })
  const tasks: BriefingTasks = { overdue: [task('o1'), task('o2')], today: [task('t1'), task('t2'), task('t3')], noDate: [task('n1')], more: 2 }
  const ids = (expanded: boolean, done: string[] = []): string[][] => taskGroups(tasks, expanded, new Set(done.map((id) => tickedKey(task(id))))).groups.map((group) => group.tasks.map((item) => item.id))

  it('shows the first tasks across the groups and counts the rest', () => {
    const folded = taskGroups(tasks, false)
    expect(folded.groups.map((group) => [group.key, group.label, group.tasks.length])).toEqual([['overdue', 'Overdue', 2], ['today', 'Today', 2]])
    expect(folded.hidden).toBe(2)
    expect(taskGroups(tasks, true).hidden).toBe(0)
    expect(ids(true)).toEqual([['o1', 'o2'], ['t1', 't2', 't3'], ['n1']])
  })

  it('lets a ticked task go at once, and the next one move up', () => {
    expect(ids(false, ['o1'])).toEqual([['o2'], ['t1', 't2', 't3']])
    expect(taskGroups(tasks, false, new Set([tickedKey(task('o1'))])).hidden).toBe(1)
    expect(ids(true, ['o1', 'o2', 'n1'])).toEqual([['t1', 't2', 't3']])
  })

  it('shows a repeating task again on its next date', () => {
    const daily: BriefingTask = { ...task('r'), due: '2026-10-15' }
    const done = new Set([tickedKey(daily)])
    expect(taskGroups({ overdue: [], today: [daily], more: 0 }, false, done).groups).toEqual([])
    const moved = { ...daily, due: '2026-10-16' }
    expect(taskGroups({ overdue: [], today: [moved], more: 0 }, false, done).groups).toEqual([{ key: 'today', label: 'Today', tasks: [moved] }])
  })

  it('handles a briefing without the optional group, and an empty one', () => {
    expect(taskGroups({ overdue: [], today: [task('a')], more: 0 }, false)).toEqual({ groups: [{ key: 'today', label: 'Today', tasks: [task('a')] }], hidden: 0 })
    expect(taskGroups({ overdue: [], today: [], more: 0 }, false)).toEqual({ groups: [], hidden: 0 })
    expect(taskGroups({ overdue: [], today: [task('a')], more: 99 }, false)).toEqual({ groups: [], hidden: 1 })
  })
})

describe('the days of the calendar', () => {
  it('writes the hour as shortly as the locale allows', () => {
    expect(shortClock(at(9), 'en-US')).toBe('9am')
    expect(shortClock(at(18, 30), 'en-US')).toBe('6:30pm')
    expect(shortClock(at(0), 'en-US')).toBe('12am')
    expect(shortClock(at(9), 'pt-BR')).toBe('09:00')
    expect(shortClock(at(18, 30), 'de-DE')).toBe('18:30')
  })

  it('puts an event on every day it overlaps, and a task on the day it is due', () => {
    const occurrence = (id: string, start: number, end: number, allDay = false): BriefingEvent => ({ id, calendarId: 'c', title: id, start, end, allDay, recurring: false })
    const due = (id: string, day?: string): BriefingTask => ({ id, kind: 'row', title: id, pageId: id, source: 'Tasks', ...(day ? { due: day } : {}) })
    const byDay = agendaByDay(
      ['2026-10-13', '2026-10-14', '2026-10-15', 'not a day'],
      [occurrence('conference', at(0), at(0, 0, 15), true), occurrence('overnight', at(23), at(1, 0, 14)), occurrence('moment', at(0, 0, 14), at(0, 0, 14))],
      [due('a', '2026-10-14'), due('b', '2026-10-20'), due('c')]
    )
    const ids = (day: string): string[][] => [byDay.get(day)!.events.map((item) => item.id), byDay.get(day)!.tasks.map((item) => item.id)]
    expect([...byDay.keys()]).toEqual(['2026-10-13', '2026-10-14', '2026-10-15'])
    expect(ids('2026-10-13')).toEqual([['conference', 'overnight'], []])
    expect(ids('2026-10-14')).toEqual([['conference', 'overnight', 'moment'], ['a']])
    expect(ids('2026-10-15')).toEqual([[], []])
  })

  it('places the events of a day on its hours, side by side where they overlap', () => {
    const from = at(0)
    const to = at(0, 0, 14)
    const placed = dayTimeline(
      [
        { id: 'conference', ...event(from, to, true) },
        { id: 'standup', ...event(at(9), at(9, 15)) },
        { id: 'review', ...event(at(10), at(12)) },
        { id: 'call', ...event(at(11), at(11, 30)) },
        { id: 'lunch', ...event(at(11, 30), at(13)) },
        { id: 'overnight', ...event(at(22, 0, 12), at(1)) },
        { id: 'late', ...event(at(23, 50), at(2, 0, 14)) },
        { id: 'away', ...event(at(12, 0, 12), at(12, 0, 14)) }
      ],
      from,
      to
    )
    expect(placed.map(({ event: { id }, start, end, lane, lanes }) => [id, start, end, lane, lanes])).toEqual([
      ['overnight', 0, 60, 0, 1],
      // A quarter of an hour is drawn as half an hour, so that it can be read.
      ['standup', 540, 570, 0, 1],
      ['review', 600, 720, 0, 2],
      ['call', 660, 690, 1, 2],
      // Free again once the call is over.
      ['lunch', 690, 780, 1, 2],
      ['late', 1410, 1440, 0, 1]
    ])
  })
})
