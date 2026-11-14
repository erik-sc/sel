import { describe, expect, it } from 'vitest'
import { clockPlus, dayAfter, googleEventUrl, newEventProblem } from './eventLink'

const params = (url: string | null): URLSearchParams => new URL(url as string).searchParams

describe('a new event for Google Calendar', () => {
  it('opens Google’s own page with the event filled in', () => {
    const url = googleEventUrl({
      title: ' Dentista & café ',
      day: '2026-11-12',
      start: '14:30',
      end: '15:15',
      location: 'Rua A, 10',
      timeZone: 'America/Sao_Paulo'
    })
    expect(url?.startsWith('https://calendar.google.com/calendar/render?')).toBe(true)
    const query = params(url)
    expect(query.get('action')).toBe('TEMPLATE')
    expect(query.get('text')).toBe('Dentista & café')
    expect(query.get('dates')).toBe('20261112T143000/20261112T151500')
    expect(query.get('ctz')).toBe('America/Sao_Paulo')
    expect(query.get('location')).toBe('Rua A, 10')
    expect(query.has('details')).toBe(false)
  })

  it('lasts an hour when it does not say, and ends the day after when it ends before it starts', () => {
    expect(params(googleEventUrl({ title: 'x', day: '2026-11-12', start: '09:00', end: null })).get('dates')).toBe(
      '20261112T090000/20261112T100000'
    )
    expect(params(googleEventUrl({ title: 'x', day: '2026-12-31', start: '22:00', end: '01:00' })).get('dates')).toBe(
      '20261231T220000/20270101T010000'
    )
  })

  it('takes the whole day without an hour', () => {
    const query = params(googleEventUrl({ title: 'Feriado', day: '2026-02-28', start: null, end: null, timeZone: 'America/Sao_Paulo' }))
    expect(query.get('dates')).toBe('20260228/20260301')
    expect(query.has('ctz')).toBe(false)
  })

  it('is not made without a title, a day or hours that read', () => {
    expect(newEventProblem({ title: ' ', day: '2026-11-12', start: null, end: null })).toBe('title')
    expect(newEventProblem({ title: 'x', day: '12/11/2026', start: null, end: null })).toBe('day')
    expect(newEventProblem({ title: 'x', day: '2026-11-12', start: '25:00', end: null })).toBe('time')
    expect(newEventProblem({ title: 'x', day: '2026-11-12', start: '10:00', end: 'later' })).toBe('time')
    expect(googleEventUrl({ title: '', day: '2026-11-12', start: null, end: null })).toBeNull()
  })

  it('moves a day and an hour', () => {
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
    expect(clockPlus('09:15', 60)).toBe('10:15')
    expect(clockPlus('23:30', 60)).toBe('23:59')
  })
})
