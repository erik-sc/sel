import { describe, expect, it } from 'vitest'
import { cleanTasksFeed, cleanTasksFeedSetting, feedPath, feedTokenOf, tasksCalendar, type FeedTask } from './ics'

const NOW = new Date(Date.UTC(2026, 10, 15, 15, 0, 0))
const task = (over: Partial<FeedTask> = {}): FeedTask => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Dentista',
  due: '2026-11-16',
  project: null,
  priority: null,
  labels: [],
  recurrence: null,
  updatedAt: Date.UTC(2026, 10, 14, 12, 0, 0),
  ...over
})
const calendar = (tasks: FeedTask[], timeZone: string | null = 'America/Sao_Paulo'): string =>
  tasksCalendar(tasks, { name: 'sel', now: NOW, timeZone: timeZone ?? undefined })
const lines = (text: string): string[] => text.replace(/\r\n /g, '').split('\r\n')

describe('the tasks as a calendar', () => {
  it('is a calendar others read: its name, its zone, how often to read it again', () => {
    const out = lines(calendar([]))
    expect(out.slice(0, 3)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sel//tasks//EN'])
    expect(out).toContain('X-WR-CALNAME:sel')
    expect(out).toContain('X-WR-TIMEZONE:America/Sao_Paulo')
    expect(out).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT15M')
    expect(out.at(-2)).toBe('END:VCALENDAR')
    expect(calendar([]).endsWith('\r\n')).toBe(true)
  })

  it('takes the whole day for a task with a day, and half an hour for one with an hour', () => {
    const day = lines(calendar([task()]))
    expect(day).toContain('UID:11111111-1111-4111-8111-111111111111@sel')
    expect(day).toContain('DTSTAMP:20261115T150000Z')
    expect(day).toContain('LAST-MODIFIED:20261114T120000Z')
    expect(day).toContain('DTSTART;VALUE=DATE:20261116')
    expect(day).toContain('DTEND;VALUE=DATE:20261117')
    expect(day).toContain('TRANSP:TRANSPARENT')
    const timed = lines(calendar([task({ due: '2026-12-31T23:45' })]))
    expect(timed).toContain('DTSTART;TZID=America/Sao_Paulo:20261231T234500')
    expect(timed).toContain('DTEND;TZID=America/Sao_Paulo:20270101T001500')
    // Without a zone the hours float: each calendar shows them in its own.
    expect(lines(calendar([task({ due: '2026-11-16T09:00' })], null))).toContain('DTSTART:20261116T090000')
  })

  it('makes a series of what repeats by its date, and only of that', () => {
    const weekly = lines(calendar([task({ recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO,TH', from: 'due' } })]))
    expect(weekly).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TH')
    const until = lines(calendar([task({ due: '2026-11-16T09:00', recurrence: { rule: 'FREQ=DAILY;UNTIL=20261130', from: 'due' } })]))
    expect(until).toContain('RRULE:FREQ=DAILY;UNTIL=20261130T235959Z')
    expect(calendar([task({ recurrence: { rule: 'FREQ=DAILY', from: 'completion' } })])).not.toContain('RRULE')
    // Whatever is not a rule is not written.
    expect(calendar([task({ recurrence: { rule: 'FREQ=DAILY\r\nATTENDEE:mailto:x@y', from: 'due' } })])).not.toContain('ATTENDEE')
    expect(calendar([task({ recurrence: { rule: 'every day', from: 'due' } })])).not.toContain('RRULE')
  })

  it('says the project, the priority and the labels, and escapes what the title holds', () => {
    const out = lines(calendar([task({ title: 'Pagar; luz, água\nhoje \\ já', project: 'Casa', priority: 'P1', labels: ['banco'] })]))
    expect(out).toContain(String.raw`SUMMARY:Pagar\; luz\, água\nhoje \\ já`)
    expect(out).toContain('DESCRIPTION:#Casa P1 @banco')
    expect(out).toContain('CATEGORIES:Casa')
    expect(lines(calendar([task({ title: ' ', priority: 'P4' })]))).toContain('SUMMARY:Untitled')
  })

  it('folds long lines at 75 octets, never inside a character', () => {
    const text = calendar([task({ title: 'ção '.repeat(60) })])
    for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(lines(text).find((line) => line.startsWith('SUMMARY:'))).toBe(`SUMMARY:${'ção '.repeat(60).trim()}`)
  })

  it('leaves out a task whose date does not read', () => {
    expect(calendar([task({ due: 'amanhã' }), task({ due: '' })])).not.toContain('VEVENT')
  })
})

describe('the calendar’s address and setting', () => {
  const token = 'Ab1_-'.repeat(8) + 'xyz'

  it('is the secret, in one path', () => {
    expect(feedTokenOf(feedPath(token))).toBe(token)
    for (const path of ['/calendar/short.ics', `/calendar/${token}`, `/calendar/${token}.ics/x`, `/calendar/../${token}.ics`, '/mcp'])
      expect(feedTokenOf(path), path).toBeNull()
  })

  it('is off without a secret that reads, whatever is stored', () => {
    expect(cleanTasksFeed({ enabled: true, token })).toEqual({ enabled: true, token })
    expect(cleanTasksFeed({ enabled: true, token: 'short' })).toEqual({ enabled: false, token: '' })
    expect(cleanTasksFeed(null)).toEqual({ enabled: false, token: '' })
    expect(cleanTasksFeed({ enabled: 'yes', token })).toEqual({ enabled: false, token })
  })

  it('takes from a window only the two fields', () => {
    expect(cleanTasksFeedSetting('tasks.feed', { enabled: true, token, more: 1 })).toEqual({ enabled: true, token })
    expect(cleanTasksFeedSetting('tasks.feed', { enabled: true, token: '' })).toEqual({ enabled: false, token: '' })
    expect(cleanTasksFeedSetting('tasks.feed', { enabled: true, token: 'a b' })).toBeUndefined()
    expect(cleanTasksFeedSetting('tasks.feed', true)).toBeUndefined()
    expect(cleanTasksFeedSetting('tasks.other', { enabled: true, token })).toBeUndefined()
  })
})
