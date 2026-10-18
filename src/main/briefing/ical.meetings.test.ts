process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import { isMeetingEvent } from '../../shared/briefing'
import { expandCalendar, meetingLink, parseCalendar } from './ical'

// Who is invited and where the call is: what makes an event a meeting for the alarms.

const calendar = (...events: string[][]): string => ['BEGIN:VCALENDAR', 'X-WR-CALNAME:me@example.com', ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')
const timed = (uid: string, ...lines: string[]): string[] => [`UID:${uid}`, `SUMMARY:${uid}`, 'DTSTART:20261015T130000Z', 'DTEND:20261015T133000Z', ...lines]
const window = { from: Date.UTC(2026, 9, 15), to: Date.UTC(2026, 9, 16) }

function occurrences(text: string) {
  return Object.fromEntries(expandCalendar(parseCalendar(text), window, { calendarId: 'c' }).map((o) => [o.uid, o]))
}

describe('meetings in a calendar', () => {
  it('counts the people invited besides the owner, rooms left out', () => {
    const found = occurrences(
      calendar(
        timed('alone'),
        timed('only-me', 'ORGANIZER:mailto:me@example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com'),
        timed('two', 'ORGANIZER:mailto:me@example.com', 'ATTENDEE:mailto:me@example.com', 'ATTENDEE;CN="Ana":mailto:Ana@Example.com', 'ATTENDEE:mailto:bo@example.com'),
        timed('room', 'ATTENDEE:mailto:me@example.com', 'ATTENDEE;CUTYPE=ROOM:mailto:room-4@resource.calendar.google.com')
      )
    )
    expect(found['alone'].attendees).toBeUndefined()
    expect(found['only-me'].attendees).toBeUndefined()
    expect(found['two'].attendees).toBe(2)
    expect(found['room'].attendees).toBeUndefined()
    expect(found['two'].uid).toBe('two')
    expect(isMeetingEvent(found['two'])).toBe(true)
    expect(isMeetingEvent(found['alone'])).toBe(false)
  })

  it('keeps the names of the invited: the one the calendar gives, else the address', () => {
    const found = occurrences(
      calendar(
        timed(
          'named',
          'ORGANIZER;CN=Me:mailto:me@example.com',
          'ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:me@example.com',
          'ATTENDEE;CN="Souza, Ana";PARTSTAT=ACCEPTED:mailto:ana@example.com',
          'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:Bo@Example.com',
          'ATTENDEE;CN=Bo again:mailto:bo@example.com',
          'ATTENDEE;CN=Carla;PARTSTAT=DECLINED:mailto:carla@example.com',
          'ATTENDEE;CN=Room 4;CUTYPE=ROOM:mailto:room-4@resource.calendar.google.com',
          'ATTENDEE;CN="  Dan\\nTab\t ":urn:uuid:1234'
        ),
        timed('alone')
      )
    )
    // Who declined still counts as invited (the alarms ask about it), but is not listed as coming.
    expect(found['named'].attendees).toBe(4)
    expect(found['named'].people).toEqual(['Souza, Ana', 'bo@example.com', 'Dan Tab'])
    expect(found['alone'].people).toBeUndefined()
    const many = Array.from({ length: 60 }, (_, i) => `ATTENDEE;CN=${'x'.repeat(100)}${i}:mailto:p${i}@example.com`)
    const crowd = occurrences(calendar(timed('crowd', 'ORGANIZER:mailto:me@example.com', ...many)))['crowd']
    expect(crowd.people).toHaveLength(50)
    expect(crowd.people?.every((name) => name.length <= 80)).toBe(true)
  })

  it('takes the organizer for the owner when the calendar does not say whose it is', () => {
    const text = calendar(timed('invited', 'ORGANIZER:mailto:boss@example.com', 'ATTENDEE:mailto:boss@example.com', 'ATTENDEE:mailto:someone@example.com')).replace('X-WR-CALNAME:me@example.com\r\n', '')
    expect(occurrences(text)['invited'].attendees).toBe(1)
  })

  it('finds the link of a Meet, Teams or Zoom call wherever the calendar put it', () => {
    const found = occurrences(
      calendar(
        timed('meet', 'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij', 'DESCRIPTION:Join at https://meet.google.com/zzz-zzzz-zzz'),
        timed('zoom', 'LOCATION:https://us02web.zoom.us/j/8812345678?pwd=AbC123'),
        timed('teams', 'DESCRIPTION:<p>Join: <a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d&amp;x=1">Click here</a></p>'),
        timed('url', 'URL:https://teams.live.com/meet/9381234567'),
        timed('none', 'LOCATION:Room 4', 'DESCRIPTION:See https://example.com/agenda.')
      )
    )
    expect(found['meet'].meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(found['zoom'].meetingUrl).toBe('https://us02web.zoom.us/j/8812345678?pwd=AbC123')
    expect(found['teams'].meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d&x=1')
    expect(found['url'].meetingUrl).toBe('https://teams.live.com/meet/9381234567')
    expect(found['none'].meetingUrl).toBeUndefined()
    expect(isMeetingEvent(found['zoom'])).toBe(true)
    expect(found['none'].location).toBe('Room 4')
  })

  it('reads only https links of the known calls, without the sentence around them', () => {
    expect(meetingLink('Call: https://meet.google.com/abc-defg-hij.')).toBe('https://meet.google.com/abc-defg-hij')
    expect(meetingLink('(https://zoom.us/j/123)')).toBe('https://zoom.us/j/123')
    expect(meetingLink('http://meet.google.com/abc-defg-hij')).toBeNull()
    expect(meetingLink('https://meet.google.com.evil.example/abc-defg-hij')).toBeNull()
    expect(meetingLink('https://zoom.us/pricing')).toBeNull()
    expect(meetingLink(undefined)).toBeNull()
  })

  it('marks events shown as free', () => {
    const found = occurrences(calendar(timed('busy'), timed('free', 'TRANSP:TRANSPARENT')))
    expect(found['free'].transparent).toBe(true)
    expect(found['busy'].transparent).toBeUndefined()
  })
})
