// The iCalendar tests, as a function so that the same cases run under several process time
// zones (see the ical.*.test.ts files: the zone is process-wide state, one file each).
import { describe, expect, it } from 'vitest'
import {
  expandCalendar,
  ICAL_LIMITS,
  looksLikeCalendar,
  parseCalendar,
  parseDuration,
  parseLine,
  parseRule,
  plainDescription,
  resolveZone,
  unescapeText,
  unfold,
  zoneInstant,
  zoneWall,
  type CalendarOccurrence
} from './ical'

const DAY = 86_400_000

export function calendar(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n')
}

export function vevent(...lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')
}

const utc = (y: number, m: number, d: number, h = 0, mi = 0): number => Date.UTC(y, m - 1, d, h, mi)
const local = (y: number, m: number, d: number, h = 0, mi = 0): number => new Date(y, m - 1, d, h, mi).getTime()
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16)

function expand(text: string, from: number, to: number, options: Parameters<typeof expandCalendar>[2] = {}): CalendarOccurrence[] {
  return expandCalendar(parseCalendar(text), { from, to }, options)
}

/** Start instants (ISO, UTC, to the minute) of everything in a wide UTC window. */
function starts(text: string, from: number, to: number): string[] {
  return expand(text, from, to).map((o) => iso(o.start))
}

export function defineIcalSuite(zone: string): void {
  describe(`iCalendar under TZ=${zone}`, () => {
    it('really runs in that zone', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
    })

    describe('lines', () => {
      it('unfolds continuation lines, whatever the line ending', () => {
        expect(unfold('A:1\r\n 2\r\n\t3\r\nB:x\nC:y\rD:z\r\n\r\n')).toEqual(['A:123', 'B:x', 'C:y', 'D:z'])
        expect(unfold('')).toEqual([])
        expect(unfold(' leading continuation')).toEqual([' leading continuation'])
      })

      it('cuts a line that never ends', () => {
        const lines = unfold(`SUMMARY:${'x'.repeat(ICAL_LIMITS.line * 2)}\r\n${' y'.repeat(10)}`)
        expect(lines).toHaveLength(1)
        expect(lines[0].length).toBeLessThanOrEqual(ICAL_LIMITS.line)
      })

      it('reads names, parameters and values', () => {
        expect(parseLine('SUMMARY:Lunch: at noon; maybe')).toEqual({ name: 'SUMMARY', params: {}, value: 'Lunch: at noon; maybe' })
        const line = parseLine('attendee;CN="Doe, Jane: PhD;x";PARTSTAT=DECLINED;ROLE=REQ-PARTICIPANT:mailto:jane@example.com')
        expect(line?.name).toBe('ATTENDEE')
        expect(line?.params['CN']).toBe('Doe, Jane: PhD;x')
        expect(line?.params['PARTSTAT']).toBe('DECLINED')
        expect(line?.value).toBe('mailto:jane@example.com')
        expect(parseLine('DTSTART;TZID=America/New_York:20261013T090000')?.params['TZID']).toBe('America/New_York')
      })

      it('rejects what is not a content line', () => {
        for (const bad of ['', 'NOCOLON', ':value', 'NAME;PARAM:value', 'NAME;P="unclosed:value', 'NA ME:value']) {
          expect(parseLine(bad), bad).toBeNull()
        }
      })

      it('cannot be made to set object internals through parameter names', () => {
        const line = parseLine('X;__PROTO__=polluted;CONSTRUCTOR=x:v')
        expect(line).not.toBeNull()
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        expect(Object.getPrototypeOf(line!.params)).toBeNull()
      })

      it('unescapes text', () => {
        expect(unescapeText('a\\, b\\; c\\\\ d\\ne\\Nf')).toBe('a, b; c\\ d\ne\nf')
        expect(unescapeText('plain')).toBe('plain')
      })

      it('turns a description into capped plain text', () => {
        expect(plainDescription('<p>Hello <b>there</b></p><script>alert(1)</script>&amp; &lt;you&gt;')).toBe('Hello there\nalert(1)& <you>')
        expect(plainDescription('line one\\nline two')).toBe('line one\nline two')
        const long = plainDescription('x'.repeat(5000))
        expect(long.length).toBe(ICAL_LIMITS.description)
        expect(long.endsWith('…')).toBe(true)
      })

      it('reads durations', () => {
        expect(parseDuration('PT1H30M')).toBe(90 * 60_000)
        expect(parseDuration('P1D')).toBe(DAY)
        expect(parseDuration('P2W')).toBe(14 * DAY)
        expect(parseDuration('P1DT12H')).toBe(1.5 * DAY)
        expect(parseDuration('-PT15M')).toBe(0)
        for (const bad of ['', 'P', 'PT', '1H', 'P1H', 'PT1D', 'garbage']) expect(parseDuration(bad), bad).toBeNull()
      })

      it('tells a calendar from something else', () => {
        expect(looksLikeCalendar('BEGIN:VCALENDAR\r\nVERSION:2.0')).toBe(true)
        expect(looksLikeCalendar('﻿\r\nbegin:vcalendar\n')).toBe(true)
        expect(looksLikeCalendar('<!doctype html><html>BEGIN:VCALENDAR')).toBe(false)
        expect(looksLikeCalendar('BEGIN:VCALENDARX')).toBe(false)
        expect(looksLikeCalendar('')).toBe(false)
      })
    })

    describe('time zones', () => {
      it('resolves IANA names, Windows names and prefixed ids', () => {
        expect(resolveZone('America/Sao_Paulo')).toBe('America/Sao_Paulo')
        expect(resolveZone('E. South America Standard Time')).toBe('America/Sao_Paulo')
        expect(resolveZone('"W. Europe Standard Time"')).toBe('Europe/Berlin')
        expect(resolveZone('/mozilla.org/20050126_1/Europe/Berlin')).toBe('Europe/Berlin')
        expect(resolveZone('/freeassociation.sourceforge.net/Tzfile/America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires')
        expect(resolveZone('UTC')).toBe('UTC')
        expect(resolveZone('Nowhere/Special')).toBeNull()
        expect(resolveZone('')).toBeNull()
        expect(resolveZone('x'.repeat(500))).toBeNull()
      })

      it('converts between wall clock and instant', () => {
        expect(zoneInstant(utc(2026, 7, 1, 9), 'America/New_York')).toBe(utc(2026, 7, 1, 13))
        expect(zoneInstant(utc(2026, 1, 1, 9), 'America/New_York')).toBe(utc(2026, 1, 1, 14))
        expect(zoneWall(utc(2026, 7, 1, 13), 'America/New_York')).toBe(utc(2026, 7, 1, 9))
        expect(zoneInstant(utc(2026, 7, 1, 9), 'Asia/Kolkata')).toBe(utc(2026, 7, 1, 3, 30))
        expect(zoneInstant(utc(2026, 7, 1, 9), 'UTC')).toBe(utc(2026, 7, 1, 9))
      })

      it('reads a time that does not exist with the offset before the gap', () => {
        // New York, 8 March 2026: 02:00 becomes 03:00. 02:30 is 03:30 EDT.
        expect(zoneInstant(utc(2026, 3, 8, 2, 30), 'America/New_York')).toBe(utc(2026, 3, 8, 7, 30))
        // Berlin, 29 March 2026: 02:00 becomes 03:00.
        expect(zoneInstant(utc(2026, 3, 29, 2, 30), 'Europe/Berlin')).toBe(utc(2026, 3, 29, 1, 30))
        // São Paulo, 4 November 2018: midnight becomes 01:00.
        expect(zoneInstant(utc(2018, 11, 4, 0, 30), 'America/Sao_Paulo')).toBe(utc(2018, 11, 4, 3, 30))
      })

      it('reads a time that happens twice as its first occurrence', () => {
        // New York, 1 November 2026: 02:00 EDT becomes 01:00 EST.
        expect(zoneInstant(utc(2026, 11, 1, 1, 30), 'America/New_York')).toBe(utc(2026, 11, 1, 5, 30))
        // Berlin, 25 October 2026: 03:00 CEST becomes 02:00 CET.
        expect(zoneInstant(utc(2026, 10, 25, 2, 30), 'Europe/Berlin')).toBe(utc(2026, 10, 25, 0, 30))
      })
    })

    describe('single events', () => {
      const from = utc(2026, 10, 1)
      const to = utc(2026, 11, 1)

      it('reads UTC, zoned, Windows-zoned and floating times', () => {
        const text = calendar(
          vevent('UID:a', 'SUMMARY:utc', 'DTSTART:20261013T120000Z', 'DTEND:20261013T130000Z'),
          vevent('UID:b', 'SUMMARY:new york', 'DTSTART;TZID=America/New_York:20261013T090000', 'DTEND;TZID=America/New_York:20261013T093000'),
          vevent('UID:c', 'SUMMARY:windows', 'DTSTART;TZID=E. South America Standard Time:20261013T090000', 'DURATION:PT45M'),
          vevent('UID:d', 'SUMMARY:floating', 'DTSTART:20261013T180000', 'DTEND:20261013T190000')
        )
        const found = Object.fromEntries(expand(text, from, to).map((o) => [o.title, o]))
        expect(found['utc'].start).toBe(utc(2026, 10, 13, 12))
        expect(found['utc'].end).toBe(utc(2026, 10, 13, 13))
        expect(found['new york'].start).toBe(utc(2026, 10, 13, 13))
        expect(found['new york'].end).toBe(utc(2026, 10, 13, 13, 30))
        expect(found['windows'].start).toBe(utc(2026, 10, 13, 12))
        expect(found['windows'].end).toBe(utc(2026, 10, 13, 12, 45))
        expect(found['floating'].start).toBe(local(2026, 10, 13, 18))
        expect(found['floating'].end).toBe(local(2026, 10, 13, 19))
        expect(Object.values(found).every((o) => !o.allDay && !o.recurring)).toBe(true)
      })

      it('falls back to the local zone for an unknown TZID, and says so', () => {
        const parsed = parseCalendar(calendar(vevent('UID:a', 'SUMMARY:x', 'DTSTART;TZID=Mars/Olympus:20261013T090000')))
        expect(parsed.notes).toContain('unknown-timezone')
        expect(expandCalendar(parsed, { from, to })[0].start).toBe(local(2026, 10, 13, 9))
      })

      it('handles an end in another zone, a missing end and an end before the start', () => {
        const text = calendar(
          vevent('UID:flight', 'SUMMARY:flight', 'DTSTART;TZID=America/Sao_Paulo:20261013T220000', 'DTEND;TZID=Europe/Lisbon:20261014T110000'),
          vevent('UID:moment', 'SUMMARY:moment', 'DTSTART:20261013T120000Z'),
          vevent('UID:backwards', 'SUMMARY:backwards', 'DTSTART:20261013T120000Z', 'DTEND:20261013T110000Z')
        )
        const found = Object.fromEntries(expand(text, from, to).map((o) => [o.title, o]))
        expect(found['flight'].start).toBe(utc(2026, 10, 14, 1))
        expect(found['flight'].end).toBe(utc(2026, 10, 14, 10))
        expect(found['moment'].end).toBe(found['moment'].start)
        expect(found['backwards'].end).toBe(found['backwards'].start)
      })

      it('reads all-day events as local days', () => {
        const text = calendar(
          vevent('UID:one', 'SUMMARY:one day', 'DTSTART;VALUE=DATE:20261013', 'DTEND;VALUE=DATE:20261014'),
          vevent('UID:bare', 'SUMMARY:no end', 'DTSTART;VALUE=DATE:20261013'),
          vevent('UID:trip', 'SUMMARY:trip', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261015'),
          vevent('UID:dur', 'SUMMARY:two days', 'DTSTART;VALUE=DATE:20261013', 'DURATION:P2D'),
          vevent('UID:next', 'SUMMARY:tomorrow', 'DTSTART;VALUE=DATE:20261014'),
          vevent('UID:prev', 'SUMMARY:yesterday', 'DTSTART;VALUE=DATE:20261012')
        )
        // The window is the local day 13 October: what is on the 12th or the 14th alone stays out.
        const today = expand(text, local(2026, 10, 13), local(2026, 10, 14))
        expect(today.map((o) => o.title).sort()).toEqual(['no end', 'one day', 'trip', 'two days'])
        const one = today.find((o) => o.title === 'one day')!
        expect(one.allDay).toBe(true)
        expect(one.start).toBe(local(2026, 10, 13))
        expect(one.end).toBe(local(2026, 10, 14))
        expect(one.startDay).toBe('2026-10-13')
        expect(one.endDay).toBe('2026-10-14')
        const trip = today.find((o) => o.title === 'trip')!
        expect([trip.startDay, trip.endDay]).toEqual(['2026-10-12', '2026-10-15'])
        expect(today.find((o) => o.title === 'two days')!.endDay).toBe('2026-10-15')
      })

      it('puts all-day events first, then orders by start', () => {
        const text = calendar(
          vevent('UID:late', 'SUMMARY:late', 'DTSTART:20261013T200000Z'),
          vevent('UID:early', 'SUMMARY:early', 'DTSTART:20261013T100000Z'),
          vevent('UID:day', 'SUMMARY:day', 'DTSTART;VALUE=DATE:20261013')
        )
        expect(expand(text, utc(2026, 10, 12), utc(2026, 10, 15)).map((o) => o.title)).toEqual(['day', 'early', 'late'])
      })

      it('hides cancelled events and those the owner declined', () => {
        const text = [
          'BEGIN:VCALENDAR',
          'X-WR-CALNAME:me@example.com',
          vevent('UID:gone', 'SUMMARY:cancelled', 'STATUS:CANCELLED', 'DTSTART:20261013T100000Z'),
          vevent('UID:no', 'SUMMARY:declined', 'DTSTART:20261013T110000Z', 'ATTENDEE;PARTSTAT=DECLINED;CN=Me:mailto:ME@example.com'),
          vevent('UID:other', 'SUMMARY:someone else declined', 'DTSTART:20261013T120000Z', 'ATTENDEE;PARTSTAT=DECLINED:mailto:you@example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com'),
          vevent('UID:free', 'SUMMARY:free time', 'TRANSP:TRANSPARENT', 'DTSTART:20261013T130000Z'),
          'END:VCALENDAR'
        ].join('\r\n')
        expect(expand(text, from, to).map((o) => o.title)).toEqual(['someone else declined', 'free time'])
        expect(expand(text, from, to, { includeTransparent: false }).map((o) => o.title)).toEqual(['someone else declined'])
        // Without a way to know who the owner is, nothing is taken for declined.
        const anonymous = text.replace('X-WR-CALNAME:me@example.com', 'X-WR-CALNAME:Work')
        expect(expand(anonymous, from, to).map((o) => o.title)).toContain('declined')
        expect(expandCalendar(parseCalendar(anonymous, { selfEmails: ['me@example.com'] }), { from, to }).map((o) => o.title)).not.toContain('declined')
      })

      it('keeps text plain and capped', () => {
        const text = calendar(
          vevent(
            'UID:t',
            `SUMMARY:${'T'.repeat(1000)}`,
            'LOCATION:Room 4\\, second floor\\nBuilding B',
            'DESCRIPTION:<a href="https://example.com">Join</a>\\n\\nAgenda:\\n- one',
            'DTSTART:20261013T100000Z',
            'BEGIN:VALARM',
            'DESCRIPTION:this is the alarm, not the event',
            'SUMMARY:alarm',
            'END:VALARM'
          )
        )
        const [event] = expand(text, from, to)
        expect(event.title.length).toBe(ICAL_LIMITS.title)
        expect(event.location).toBe('Room 4, second floor Building B')
        expect(event.description).toBe('Join\n\nAgenda:\n- one')
      })
    })

    describe('recurrence rules', () => {
      it('DAILY with INTERVAL and COUNT', () => {
        const text = calendar(vevent('UID:d', 'DTSTART:20261010T090000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5'))
        expect(starts(text, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-10-10T09:00', '2026-10-12T09:00', '2026-10-14T09:00', '2026-10-16T09:00', '2026-10-18T09:00'])
        // The count is of the series, not of the window.
        expect(starts(text, utc(2026, 10, 15), utc(2027, 1, 1))).toEqual(['2026-10-16T09:00', '2026-10-18T09:00'])
        expect(expand(text, utc(2026, 1, 1), utc(2027, 1, 1)).every((o) => o.recurring)).toBe(true)
      })

      it('DAILY with UNTIL, inclusive, in UTC and as a date', () => {
        const inUtc = calendar(vevent('UID:d', 'DTSTART:20261010T090000Z', 'RRULE:FREQ=DAILY;UNTIL=20261012T090000Z'))
        expect(starts(inUtc, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-10-10T09:00', '2026-10-11T09:00', '2026-10-12T09:00'])
        const asDate = calendar(vevent('UID:d', 'DTSTART;VALUE=DATE:20261010', 'RRULE:FREQ=DAILY;UNTIL=20261012'))
        expect(expand(asDate, local(2026, 10, 1), local(2026, 11, 1)).map((o) => o.startDay)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12'])
      })

      it('DAILY filtered by BYDAY and BYMONTH', () => {
        const text = calendar(vevent('UID:d', 'DTSTART:20261012T090000Z', 'RRULE:FREQ=DAILY;BYDAY=MO,WE;BYMONTH=10'))
        expect(starts(text, utc(2026, 10, 12), utc(2026, 12, 1))).toEqual([
          '2026-10-12T09:00',
          '2026-10-14T09:00',
          '2026-10-19T09:00',
          '2026-10-21T09:00',
          '2026-10-26T09:00',
          '2026-10-28T09:00'
        ])
      })

      it('WEEKLY on the start weekday, and on several days', () => {
        const plain = calendar(vevent('UID:w', 'DTSTART:20261013T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'))
        expect(starts(plain, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-10-13T09:00', '2026-10-20T09:00', '2026-10-27T09:00'])
        const several = calendar(vevent('UID:w', 'DTSTART:20261012T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261023T235959Z'))
        expect(starts(several, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual([
          '2026-10-12T09:00',
          '2026-10-14T09:00',
          '2026-10-16T09:00',
          '2026-10-19T09:00',
          '2026-10-21T09:00',
          '2026-10-23T09:00'
        ])
      })

      it('WEEKLY with INTERVAL depends on WKST (the RFC 5545 example)', () => {
        const monday = calendar(vevent('UID:w', 'DTSTART:19970805T090000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO'))
        expect(starts(monday, utc(1997, 1, 1), utc(1998, 1, 1))).toEqual(['1997-08-05T09:00', '1997-08-10T09:00', '1997-08-19T09:00', '1997-08-24T09:00'])
        const sunday = calendar(vevent('UID:w', 'DTSTART:19970805T090000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU'))
        expect(starts(sunday, utc(1997, 1, 1), utc(1998, 1, 1))).toEqual(['1997-08-05T09:00', '1997-08-17T09:00', '1997-08-19T09:00', '1997-08-31T09:00'])
      })

      it('MONTHLY on the day of the month, skipping months without it', () => {
        const text = calendar(vevent('UID:m', 'DTSTART:20260131T090000Z', 'RRULE:FREQ=MONTHLY;COUNT=4'))
        expect(starts(text, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-01-31T09:00', '2026-03-31T09:00', '2026-05-31T09:00', '2026-07-31T09:00'])
      })

      it('MONTHLY with ordinal weekdays: 2TU and -1FR', () => {
        const second = calendar(vevent('UID:m', 'DTSTART:20261013T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3'))
        expect(starts(second, utc(2026, 1, 1), utc(2027, 6, 1))).toEqual(['2026-10-13T09:00', '2026-11-10T09:00', '2026-12-08T09:00'])
        const last = calendar(vevent('UID:m', 'DTSTART:20261030T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'))
        expect(starts(last, utc(2026, 1, 1), utc(2027, 6, 1))).toEqual(['2026-10-30T09:00', '2026-11-27T09:00', '2026-12-25T09:00'])
      })

      it('MONTHLY with BYMONTHDAY, also counted from the end', () => {
        const lastDay = calendar(vevent('UID:m', 'DTSTART:20260131T090000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4'))
        expect(starts(lastDay, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-01-31T09:00', '2026-02-28T09:00', '2026-03-31T09:00', '2026-04-30T09:00'])
        const two = calendar(vevent('UID:m', 'DTSTART:20261001T090000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=4'))
        expect(starts(two, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-10-01T09:00', '2026-10-15T09:00', '2026-11-01T09:00', '2026-11-15T09:00'])
        // Friday the 13th: both BYDAY and BYMONTHDAY have to hold.
        const friday13 = calendar(vevent('UID:m', 'DTSTART:20260213T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;COUNT=3'))
        expect(starts(friday13, utc(2026, 1, 1), utc(2028, 1, 1))).toEqual(['2026-02-13T09:00', '2026-03-13T09:00', '2026-11-13T09:00'])
      })

      it('MONTHLY with BYSETPOS (the RFC 5545 examples)', () => {
        const third = calendar(vevent('UID:m', 'DTSTART:19970904T090000Z', 'RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=TU,WE,TH;BYSETPOS=3'))
        expect(starts(third, utc(1997, 1, 1), utc(1998, 1, 1))).toEqual(['1997-09-04T09:00', '1997-10-07T09:00', '1997-11-06T09:00'])
        const lastWeekday = calendar(vevent('UID:m', 'DTSTART:20261030T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3'))
        expect(starts(lastWeekday, utc(2026, 1, 1), utc(2027, 6, 1))).toEqual(['2026-10-30T09:00', '2026-11-30T09:00', '2026-12-31T09:00'])
      })

      it('YEARLY on the date, including 29 February', () => {
        const birthday = calendar(vevent('UID:y', 'SUMMARY:birthday', 'DTSTART;VALUE=DATE:19900713', 'RRULE:FREQ=YEARLY'))
        const found = expand(birthday, local(2026, 7, 13), local(2026, 7, 14))
        expect(found.map((o) => o.startDay)).toEqual(['2026-07-13'])
        expect(found[0].start).toBe(local(2026, 7, 13))
        const leap = calendar(vevent('UID:y', 'DTSTART:20240229T090000Z', 'RRULE:FREQ=YEARLY;COUNT=3'))
        expect(starts(leap, utc(2024, 1, 1), utc(2040, 1, 1))).toEqual(['2024-02-29T09:00', '2028-02-29T09:00', '2032-02-29T09:00'])
      })

      it('YEARLY with BYMONTH, BYDAY ordinals and BYMONTHDAY', () => {
        const thanksgiving = calendar(vevent('UID:y', 'DTSTART:20251127T170000Z', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH'))
        expect(starts(thanksgiving, utc(2026, 1, 1), utc(2028, 1, 1))).toEqual(['2026-11-26T17:00', '2027-11-25T17:00'])
        const twice = calendar(vevent('UID:y', 'DTSTART:20260110T090000Z', 'RRULE:FREQ=YEARLY;BYMONTH=1,7;COUNT=4'))
        expect(starts(twice, utc(2026, 1, 1), utc(2030, 1, 1))).toEqual(['2026-01-10T09:00', '2026-07-10T09:00', '2027-01-10T09:00', '2027-07-10T09:00'])
        // The 20th Monday of the year (RFC 5545).
        const twentieth = calendar(vevent('UID:y', 'DTSTART:19970519T090000Z', 'RRULE:FREQ=YEARLY;COUNT=3;BYDAY=20MO'))
        expect(starts(twentieth, utc(1997, 1, 1), utc(2001, 1, 1))).toEqual(['1997-05-19T09:00', '1998-05-18T09:00', '1999-05-17T09:00'])
        // US presidential election day (RFC 5545).
        const election = calendar(vevent('UID:y', 'DTSTART:19961105T090000Z', 'RRULE:FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8;COUNT=3'))
        expect(starts(election, utc(1996, 1, 1), utc(2010, 1, 1))).toEqual(['1996-11-05T09:00', '2000-11-07T09:00', '2004-11-02T09:00'])
        const everyFirst = calendar(vevent('UID:y', 'DTSTART:20260101T090000Z', 'RRULE:FREQ=YEARLY;BYMONTHDAY=1;COUNT=3'))
        expect(starts(everyFirst, utc(2026, 1, 1), utc(2028, 1, 1))).toEqual(['2026-01-01T09:00', '2026-02-01T09:00', '2026-03-01T09:00'])
      })

      it('reads rules leniently and refuses what it cannot expand', () => {
        expect(parseRule('FREQ=WEEKLY;BYDAY=MO,xx,2TU,99WE;INTERVAL=0;WKST=SU').rule).toMatchObject({
          freq: 'WEEKLY',
          interval: 1,
          weekStart: 0,
          byDay: [
            { ordinal: 0, weekday: 1 },
            { ordinal: 2, weekday: 2 }
          ]
        })
        expect(parseRule('BYDAY=MO').rule).toBeNull()
        expect(parseRule('FREQ=FORTNIGHTLY').rule).toBeNull()
        expect(parseRule('FREQ=SECONDLY')).toEqual({ rule: null, unsupported: true })
        expect(parseRule('FREQ=YEARLY;BYWEEKNO=20').unsupported).toBe(true)
        expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=0,32,-32,5;BYMONTH=0,13,2;BYSETPOS=0,-1').rule).toMatchObject({ byMonthDay: [5], byMonth: [2], bySetPos: [-1] })
      })

      it('keeps only the first occurrence of a rule it does not support', () => {
        const parsed = parseCalendar(calendar(vevent('UID:s', 'DTSTART:20261013T090000Z', 'RRULE:FREQ=SECONDLY'), vevent('UID:w', 'DTSTART:20261013T100000Z', 'RRULE:FREQ=YEARLY;BYWEEKNO=42')))
        expect(parsed.notes).toContain('unsupported-rule')
        expect(expandCalendar(parsed, { from: utc(2026, 1, 1), to: utc(2030, 1, 1) }).map((o) => iso(o.start))).toEqual(['2026-10-13T09:00', '2026-10-13T10:00'])
      })
    })

    describe('daylight saving', () => {
      it('a weekly 09:00 meeting stays at 09:00 in its own zone across a change of clocks', () => {
        const newYork = calendar(vevent('UID:ny', 'DTSTART;TZID=America/New_York:20260302T090000', 'DTEND;TZID=America/New_York:20260302T100000', 'RRULE:FREQ=WEEKLY;COUNT=3'))
        const found = expand(newYork, utc(2026, 1, 1), utc(2027, 1, 1))
        // EST (UTC-5) on 2 March; EDT (UTC-4) from 8 March.
        expect(found.map((o) => iso(o.start))).toEqual(['2026-03-02T14:00', '2026-03-09T13:00', '2026-03-16T13:00'])
        expect(found.map((o) => iso(o.end))).toEqual(['2026-03-02T15:00', '2026-03-09T14:00', '2026-03-16T14:00'])

        const berlin = calendar(vevent('UID:be', 'DTSTART;TZID=Europe/Berlin:20261019T090000', 'RRULE:FREQ=WEEKLY;COUNT=2'))
        expect(starts(berlin, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-10-19T07:00', '2026-10-26T08:00'])

        // Brazil still had summer time in 2018: UTC-3 in October, UTC-2 from 4 November.
        const saoPaulo = calendar(vevent('UID:sp', 'DTSTART;TZID=America/Sao_Paulo:20181029T090000', 'RRULE:FREQ=WEEKLY;COUNT=2'))
        expect(starts(saoPaulo, utc(2018, 1, 1), utc(2019, 1, 1))).toEqual(['2018-10-29T12:00', '2018-11-05T11:00'])
        // And none since 2019.
        const now = calendar(vevent('UID:sp', 'DTSTART;TZID=America/Sao_Paulo:20261029T090000', 'RRULE:FREQ=WEEKLY;COUNT=2'))
        expect(starts(now, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-10-29T12:00', '2026-11-05T12:00'])
      })

      it('an occurrence in the gap moves forward; one in the repeated hour is the first', () => {
        const gap = calendar(vevent('UID:g', 'DTSTART;TZID=America/New_York:20260307T023000', 'RRULE:FREQ=DAILY;COUNT=3'))
        expect(starts(gap, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-03-07T07:30', '2026-03-08T07:30', '2026-03-09T06:30'])
        const twice = calendar(vevent('UID:t', 'DTSTART;TZID=America/New_York:20261031T013000', 'RRULE:FREQ=DAILY;COUNT=3'))
        expect(starts(twice, utc(2026, 1, 1), utc(2027, 1, 1))).toEqual(['2026-10-31T05:30', '2026-11-01T05:30', '2026-11-02T06:30'])
      })

      it('floating and all-day series follow the local clock all year', () => {
        const text = calendar(
          vevent('UID:f', 'SUMMARY:float', 'DTSTART:20260105T090000', 'DTEND:20260105T093000', 'RRULE:FREQ=WEEKLY'),
          vevent('UID:a', 'SUMMARY:day', 'DTSTART;VALUE=DATE:20260105', 'RRULE:FREQ=WEEKLY')
        )
        const found = expand(text, local(2026, 1, 1), local(2027, 1, 1))
        const floating = found.filter((o) => o.title === 'float')
        expect(floating).toHaveLength(52)
        for (const o of floating) {
          const start = new Date(o.start)
          expect([start.getDay(), start.getHours(), start.getMinutes()]).toEqual([1, 9, 0])
          expect(o.end - o.start).toBe(30 * 60_000)
        }
        const days = found.filter((o) => o.title === 'day')
        expect(days).toHaveLength(52)
        for (const o of days) {
          expect(new Date(o.start).getDay()).toBe(1)
          expect(o.start).toBe(local(Number(o.startDay!.slice(0, 4)), Number(o.startDay!.slice(5, 7)), Number(o.startDay!.slice(8, 10))))
          // A local day is 23, 24 or 25 hours long.
          expect((o.end - o.start) / 3_600_000).toBeGreaterThanOrEqual(23)
          expect((o.end - o.start) / 3_600_000).toBeLessThanOrEqual(25)
        }
      })

      it('an all-day event belongs to its local day even when midnight does not exist there', () => {
        // In São Paulo 4 November 2018 began at 01:00.
        const text = calendar(vevent('UID:a', 'SUMMARY:day', 'DTSTART;VALUE=DATE:20181104', 'DTEND;VALUE=DATE:20181105'))
        expect(expand(text, local(2018, 11, 4), local(2018, 11, 5))).toHaveLength(1)
        expect(expand(text, local(2018, 11, 3), local(2018, 11, 4))).toHaveLength(0)
        expect(expand(text, local(2018, 11, 5), local(2018, 11, 6))).toHaveLength(0)
      })
    })

    describe('exceptions and overrides', () => {
      const series = ['UID:s', 'SUMMARY:standup', 'DTSTART;TZID=America/Sao_Paulo:20261012T090000', 'DTEND;TZID=America/Sao_Paulo:20261012T091500', 'RRULE:FREQ=DAILY;COUNT=5']
      const all = [utc(2026, 10, 1), utc(2026, 11, 1)] as const

      it('EXDATE removes occurrences: zoned, UTC and by date', () => {
        const text = calendar(vevent(...series, 'EXDATE;TZID=America/Sao_Paulo:20261013T090000', 'EXDATE:20261014T120000Z', 'EXDATE;VALUE=DATE:20261015'))
        expect(starts(text, ...all)).toEqual(['2026-10-12T12:00', '2026-10-16T12:00'])
      })

      it('EXDATE takes several values, and one that matches nothing changes nothing', () => {
        const text = calendar(vevent(...series, 'EXDATE;TZID=America/Sao_Paulo:20261013T090000,20261014T090000,20261014T100000'))
        expect(starts(text, ...all)).toEqual(['2026-10-12T12:00', '2026-10-15T12:00', '2026-10-16T12:00'])
      })

      it('RDATE adds occurrences, with or without a rule', () => {
        const withRule = calendar(vevent(...series, 'RDATE;TZID=America/Sao_Paulo:20261020T150000'))
        expect(starts(withRule, ...all)).toHaveLength(6)
        expect(starts(withRule, ...all).at(-1)).toBe('2026-10-20T18:00')
        const alone = calendar(vevent('UID:r', 'DTSTART:20261012T090000Z', 'DURATION:PT1H', 'RDATE:20261019T090000Z,20261026T100000Z/PT1H'))
        const found = expand(alone, ...all)
        expect(found.map((o) => iso(o.start))).toEqual(['2026-10-12T09:00', '2026-10-19T09:00', '2026-10-26T10:00'])
        expect(found.every((o) => o.recurring && o.end - o.start === 3_600_000)).toBe(true)
      })

      it('an override replaces its occurrence', () => {
        const text = calendar(
          vevent(...series),
          vevent('UID:s', 'SUMMARY:standup (moved)', 'RECURRENCE-ID;TZID=America/Sao_Paulo:20261013T090000', 'DTSTART;TZID=America/Sao_Paulo:20261013T140000', 'DTEND;TZID=America/Sao_Paulo:20261013T141500')
        )
        const found = expand(text, ...all)
        expect(found.map((o) => [o.title, iso(o.start)])).toEqual([
          ['standup', '2026-10-12T12:00'],
          ['standup (moved)', '2026-10-13T17:00'],
          ['standup', '2026-10-14T12:00'],
          ['standup', '2026-10-15T12:00'],
          ['standup', '2026-10-16T12:00']
        ])
        expect(found.every((o) => o.recurring)).toBe(true)
      })

      it('an override in UTC matches the occurrence it names', () => {
        const text = calendar(vevent(...series), vevent('UID:s', 'SUMMARY:other', 'RECURRENCE-ID:20261013T120000Z', 'DTSTART:20261013T180000Z'))
        expect(expand(text, ...all).filter((o) => iso(o.start).startsWith('2026-10-13')).map((o) => o.title)).toEqual(['other'])
      })

      it('a cancelled override removes its occurrence', () => {
        const text = calendar(vevent(...series), vevent('UID:s', 'STATUS:CANCELLED', 'RECURRENCE-ID;TZID=America/Sao_Paulo:20261013T090000', 'DTSTART;TZID=America/Sao_Paulo:20261013T090000'))
        expect(starts(text, ...all)).toEqual(['2026-10-12T12:00', '2026-10-14T12:00', '2026-10-15T12:00', '2026-10-16T12:00'])
      })

      it('an override moved to another day leaves the window it left and enters the one it reached', () => {
        const text = calendar(
          vevent(...series),
          vevent('UID:s', 'SUMMARY:moved', 'RECURRENCE-ID;TZID=America/Sao_Paulo:20261013T090000', 'DTSTART;TZID=America/Sao_Paulo:20261020T090000')
        )
        expect(expand(text, utc(2026, 10, 13, 3), utc(2026, 10, 14, 3))).toHaveLength(0)
        expect(expand(text, utc(2026, 10, 20, 3), utc(2026, 10, 21, 3)).map((o) => o.title)).toEqual(['moved'])
      })

      it('an override without its series is shown on its own', () => {
        const text = calendar(vevent('UID:lonely', 'SUMMARY:one of many', 'RECURRENCE-ID:20261013T120000Z', 'DTSTART:20261013T130000Z'))
        expect(expand(text, ...all).map((o) => o.title)).toEqual(['one of many'])
      })
    })

    describe('windows', () => {
      it('an event that crosses midnight is in both days', () => {
        const text = calendar(vevent('UID:n', 'SUMMARY:night', 'DTSTART:20261013T230000', 'DTEND:20261014T010000', 'RRULE:FREQ=DAILY;COUNT=2'))
        expect(expand(text, local(2026, 10, 13), local(2026, 10, 14))).toHaveLength(1)
        // The 14th has the end of the first and the start of the second.
        expect(expand(text, local(2026, 10, 14), local(2026, 10, 15))).toHaveLength(2)
        expect(expand(text, local(2026, 10, 15), local(2026, 10, 16))).toHaveLength(1)
        expect(expand(text, local(2026, 10, 16), local(2026, 10, 17))).toHaveLength(0)
      })

      it('an event that ends exactly when the window starts is not in it', () => {
        const text = calendar(vevent('UID:e', 'DTSTART:20261013T100000Z', 'DTEND:20261013T110000Z'))
        expect(expand(text, utc(2026, 10, 13, 11), utc(2026, 10, 13, 12))).toHaveLength(0)
        expect(expand(text, utc(2026, 10, 13, 9), utc(2026, 10, 13, 10))).toHaveLength(0)
        expect(expand(text, utc(2026, 10, 13, 10, 59), utc(2026, 10, 13, 12))).toHaveLength(1)
      })

      it('a long multi-day series reaches into the window from before it', () => {
        const text = calendar(vevent('UID:c', 'SUMMARY:camp', 'DTSTART;VALUE=DATE:20260105', 'DTEND;VALUE=DATE:20260112', 'RRULE:FREQ=MONTHLY'))
        const found = expand(text, local(2026, 10, 10), local(2026, 10, 11))
        expect(found.map((o) => [o.startDay, o.endDay])).toEqual([['2026-10-05', '2026-10-12']])
      })

      it('only expands inside the window, however old the series', () => {
        const text = calendar(
          vevent('UID:old', 'SUMMARY:old', 'DTSTART:19000101T090000Z', 'RRULE:FREQ=DAILY'),
          vevent('UID:older', 'SUMMARY:older', 'DTSTART;VALUE=DATE:16010101', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=2TU')
        )
        const started = performance.now()
        const found = expand(text, utc(2026, 10, 13), utc(2026, 10, 14))
        expect(performance.now() - started).toBeLessThan(500)
        expect(found.map((o) => o.title).sort()).toEqual(['old', 'older'])
      })

      it('answers nothing for a window that is not one', () => {
        const text = calendar(vevent('UID:e', 'DTSTART:20261013T100000Z'))
        expect(expand(text, utc(2026, 10, 14), utc(2026, 10, 13))).toEqual([])
        expect(expand(text, NaN, utc(2026, 10, 13))).toEqual([])
        expect(expand(text, 0, Infinity)).toEqual([])
      })
    })

    describe('hostile and broken input', () => {
      it('skips malformed components and keeps the rest', () => {
        const text = [
          'BEGIN:VCALENDAR',
          vevent('UID:nostart', 'SUMMARY:no start'),
          vevent('UID:baddate', 'SUMMARY:bad date', 'DTSTART:20261340T250000Z'),
          vevent('UID:feb30', 'SUMMARY:feb 30', 'DTSTART;VALUE=DATE:20260230'),
          vevent('UID:badrule', 'SUMMARY:bad rule', 'DTSTART:20261013T090000Z', 'RRULE:garbage;;;==;FREQ'),
          'BEGIN:VEVENT',
          'UID:unclosed',
          'SUMMARY:never closed',
          'DTSTART:20261013T080000Z',
          vevent('UID:ok', 'SUMMARY:fine', 'DTSTART:20261013T100000Z'),
          'END:VTODO',
          'garbage line without a colon',
          vevent('UID:ok2', 'SUMMARY:also fine', 'DTSTART:20261013T110000Z'),
          'END:VCALENDAR'
        ].join('\n')
        expect(expand(text, utc(2026, 10, 13), utc(2026, 10, 14)).map((o) => o.title)).toEqual(['bad rule', 'fine', 'also fine'])
      })

      it('survives things that are not calendars', () => {
        for (const text of ['', 'hello', '<html><body>404</body></html>', '\u0000\u0001\u0002', 'BEGIN:VEVENT', 'END:VEVENT', 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nBEGIN:VEVENT\nBEGIN:VEVENT', ':::;;;===', '\r\r\r\n\n\n   ']) {
          expect(() => parseCalendar(text)).not.toThrow()
          expect(parseCalendar(text).events).toEqual([])
        }
        expect(parseCalendar(undefined as unknown as string).events).toEqual([])
        expect(expandCalendar(null as unknown as ReturnType<typeof parseCalendar>, { from: 0, to: 1 })).toEqual([])
      })

      it('is not hung by rules built to run forever', () => {
        const rules = [
          'FREQ=DAILY;COUNT=999999',
          'FREQ=DAILY;INTERVAL=1;UNTIL=99991231T235959Z',
          'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
          'FREQ=MONTHLY;BYDAY=5MO;BYSETPOS=-366',
          'FREQ=YEARLY;BYDAY=53SU',
          'FREQ=WEEKLY;INTERVAL=9999;BYDAY=MO,TU,WE,TH,FR,SA,SU',
          `FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: 500 }, (_, i) => (i % 31) + 1).join(',')}`,
          `FREQ=DAILY;BYDAY=${'MO,'.repeat(5000)}TU`
        ]
        const events = rules.flatMap((rule, index) => [
          vevent(`UID:h${index}`, 'DTSTART:16010101T000000Z', `RRULE:${rule}`),
          vevent(`UID:z${index}`, 'DTSTART;TZID=America/Sao_Paulo:19000101T000000', 'DURATION:P3660D', `RRULE:${rule}`, `EXDATE:${'20261013T030000Z,'.repeat(3000)}20261013T030000Z`)
        ])
        const started = performance.now()
        const found = expand(calendar(...events), utc(2026, 10, 13), utc(2026, 10, 14))
        expect(performance.now() - started).toBeLessThan(5000)
        expect(found.length).toBeLessThanOrEqual(ICAL_LIMITS.occurrences)
      })

      it('caps the number of events and of occurrences', () => {
        const many = calendar(...Array.from({ length: ICAL_LIMITS.events + 50 }, (_, index) => vevent(`UID:e${index}`, 'DTSTART:20261013T100000Z')))
        const parsed = parseCalendar(many)
        expect(parsed.events).toHaveLength(ICAL_LIMITS.events)
        expect(parsed.notes).toContain('truncated')
        expect(expandCalendar(parsed, { from: utc(2026, 10, 13), to: utc(2026, 10, 14) })).toHaveLength(ICAL_LIMITS.occurrences)
      })

      it('never throws on garbage (fuzz)', () => {
        // A small deterministic generator: the same inputs on every run.
        let seed = 0x2f6e2b1
        const random = (): number => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          return seed / 0x1_0000_0000
        }
        const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]
        const pieces = [
          'BEGIN:VCALENDAR', 'END:VCALENDAR', 'BEGIN:VEVENT', 'END:VEVENT', 'BEGIN:VALARM', 'END:VALARM', 'BEGIN:VTIMEZONE', 'END:VTIMEZONE',
          'DTSTART', 'DTEND', 'RRULE', 'EXDATE', 'RDATE', 'RECURRENCE-ID', 'DURATION', 'SUMMARY', 'UID', 'STATUS', 'ATTENDEE', 'X-WR-CALNAME',
          ';TZID=', ';VALUE=DATE', ';PARTSTAT=DECLINED', 'America/Sao_Paulo', 'Europe/Berlin', 'Nowhere/Land', '"', ':', ';', ',', '=', '\\', '\r\n', '\n', '\r\n ', '\t',
          '20261013', 'T090000', 'Z', '99999999T999999', '00000000', '-', '+', 'P', 'PT', '1H', '9999D', 'FREQ=', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'SECONDLY',
          'INTERVAL=', 'COUNT=', 'UNTIL=', 'BYDAY=', 'BYMONTHDAY=', 'BYMONTH=', 'BYSETPOS=', 'WKST=', 'MO', '-1FR', '53SU', '0', '1', '-1', '31', '-366', '999999999999', 'CANCELLED',
          'mailto:', 'a@b.c', '\u0000', '￿', '💥', '<b>', '&amp;', 'ǅ'
        ]
        const base = calendar(
          vevent('UID:a', 'SUMMARY:x', 'DTSTART;TZID=America/Sao_Paulo:20261012T090000', 'DTEND;TZID=America/Sao_Paulo:20261012T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=20', 'EXDATE;TZID=America/Sao_Paulo:20261014T090000'),
          vevent('UID:b', 'SUMMARY:y', 'DTSTART;VALUE=DATE:20261013', 'RRULE:FREQ=MONTHLY;BYDAY=2TU'),
          vevent('UID:a', 'RECURRENCE-ID;TZID=America/Sao_Paulo:20261019T090000', 'DTSTART;TZID=America/Sao_Paulo:20261019T110000')
        )
        const started = performance.now()
        for (let round = 0; round < 400; round++) {
          let text: string
          if (round % 2 === 0) {
            // Pure noise built from the vocabulary of the format.
            text = Array.from({ length: 1 + Math.floor(random() * 120) }, () => pick(pieces)).join('')
          } else {
            // A valid file with random damage: cuts, insertions, swapped characters.
            const chars = [...base]
            for (let edit = 0; edit < 1 + Math.floor(random() * 12); edit++) {
              const at = Math.floor(random() * chars.length)
              const kind = random()
              if (kind < 0.34) chars.splice(at, Math.floor(random() * 30))
              else if (kind < 0.67) chars.splice(at, 0, pick(pieces))
              else chars[at] = pick(pieces)
            }
            text = chars.join('')
          }
          let found: CalendarOccurrence[] = []
          expect(() => {
            found = expandCalendar(parseCalendar(text), { from: utc(2026, 10, 1), to: utc(2026, 11, 1) }, { calendarId: 'c' })
          }, JSON.stringify(text)).not.toThrow()
          for (const o of found) {
            expect(Number.isFinite(o.start) && Number.isFinite(o.end) && o.end >= o.start, JSON.stringify(text)).toBe(true)
            expect(typeof o.title).toBe('string')
          }
        }
        expect(performance.now() - started).toBeLessThan(20_000)
      })
    })
  })
}
