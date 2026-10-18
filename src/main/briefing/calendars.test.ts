process.env.TZ = 'America/Sao_Paulo'

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALENDAR_TIMING, CalendarService } from './calendars'
import { CalendarError, type FetchOptions, type FetchResult } from './net'
import { calendarKey } from '../sync/format'
import { CalendarStore, NO_KEY_STORE, type Cipher } from './secrets'

const SECRET = 'https://calendar.google.com/calendar/ical/me%40example.com/private-SECRETTOKEN123/basic.ics'

/** A stand-in for the key store: reversible, and nothing like the plain text. */
const cipher: Cipher = {
  isAvailable: () => true,
  encrypt: (text) => Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString('utf8')
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sel-briefing-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const file = (): string => join(dir, 'briefing', 'calendars.bin')
const everything = (): string =>
  existsSync(join(dir, 'briefing'))
    ? readdirSync(join(dir, 'briefing'))
        .map((name) => readFileSync(join(dir, 'briefing', name)).toString('latin1'))
        .join('\n')
    : ''

describe('the calendar store', () => {
  it('keeps the address encrypted on disk and out of everything it hands back', () => {
    const store = new CalendarStore(file(), cipher)
    const added = store.add({ label: '  Work  ', url: SECRET, color: 'green' })
    expect(added).toEqual({ id: added.id, label: 'Work', host: 'calendar.google.com', color: 'green', enabled: true })
    expect(JSON.stringify([added, store.list(), store.get(added.id)])).not.toContain('SECRETTOKEN')
    expect(JSON.stringify(store.list())).not.toContain('private-')
    expect(Object.keys(store.list()[0]).sort()).toEqual(['color', 'enabled', 'host', 'id', 'label'])
    // On disk: not readable without the key store.
    expect(everything()).not.toContain('SECRETTOKEN')
    expect(everything()).not.toContain('calendar.google.com')
    // In this process: the fetcher can have it.
    expect(store.urlOf(added.id)).toBe(SECRET)
  })

  it('reads the file back in a new session', () => {
    const first = new CalendarStore(file(), cipher)
    const added = first.add({ label: 'Home', url: 'webcal://p01-caldav.icloud.com/published/2/abc', color: 'orange' })
    const second = new CalendarStore(file(), cipher)
    expect(second.list()).toEqual([{ id: added.id, label: 'Home', host: 'p01-caldav.icloud.com', color: 'orange', enabled: true }])
    expect(second.urlOf(added.id)).toBe('https://p01-caldav.icloud.com/published/2/abc')
  })

  it('refuses addresses the network policy would refuse, without echoing them', () => {
    const store = new CalendarStore(file(), cipher)
    for (const url of ['http://example.com/x.ics', 'https://localhost/private-SECRETTOKEN', 'https://192.168.0.2/private-SECRETTOKEN', 'file:///c:/x', '', null]) {
      let message = ''
      try {
        store.add({ label: 'x', url, color: 'blue' })
      } catch (err) {
        expect(err).toBeInstanceOf(CalendarError)
        message = (err as Error).message
      }
      expect(message).toBe('calendar: blocked-address')
    }
    expect(store.list()).toEqual([])
    expect(existsSync(file())).toBe(false)
  })

  it('does not store anything without a key store', () => {
    const store = new CalendarStore(file(), { ...cipher, isAvailable: () => false })
    expect(() => store.add({ label: 'x', url: SECRET, color: 'blue' })).toThrow(NO_KEY_STORE)
    expect(existsSync(file())).toBe(false)
  })

  it('updates, disables and removes; a removed address is not kept', () => {
    const store = new CalendarStore(file(), cipher)
    const a = store.add({ label: 'A', url: SECRET, color: 'blue' })
    const b = store.add({ label: '', url: 'https://outlook.office365.com/owa/calendar/x/y/calendar.ics', color: 'not a colour' })
    expect(b.label).toBe('outlook.office365.com')
    expect(b.color).toBe('blue')
    expect(() => store.add({ label: 'again', url: SECRET, color: 'blue' })).toThrow('already connected')
    expect(store.update(a.id, { label: 'Renamed', color: 'red', enabled: false })).toMatchObject({ label: 'Renamed', color: 'red', enabled: false })
    expect(() => store.update(a.id, { color: 'chartreuse' })).toThrow('Invalid colour')
    expect(() => store.update('missing', { label: 'x' })).toThrow('no longer connected')
    // A patch cannot reach the address.
    store.update(a.id, { url: 'https://evil.example.com/' } as never)
    expect(store.urlOf(a.id)).toBe(SECRET)
    store.remove(a.id)
    expect(store.list().map((entry) => entry.id)).toEqual([b.id])
    store.remove(b.id)
    expect(store.list()).toEqual([])
    // What stays is that two calendars were removed (for sync), named by a hash of the address.
    const kept = cipher.decrypt(readFileSync(file()))
    expect(kept).not.toContain('SECRETTOKEN')
    expect(kept).not.toContain('outlook.office365.com')
    expect(new CalendarStore(file(), cipher).exportForSync()?.removed).toHaveLength(2)
    store.remove('missing')
  })

  it('leaves no file when the last calendar goes on a computer without a key store', () => {
    let available = true
    const store = new CalendarStore(file(), { ...cipher, isAvailable: () => available })
    const a = store.add({ label: 'A', url: SECRET, color: 'blue' })
    available = false
    store.remove(a.id)
    expect(existsSync(file())).toBe(false)
  })

  it('hands its calendars to sync, and takes merged ones back keeping the ids it has', () => {
    let now = 1000
    const store = new CalendarStore(file(), cipher, () => ({}), () => now)
    const a = store.add({ label: 'A', url: SECRET, color: 'blue' })
    now = 2000
    const b = store.add({ label: 'B', url: 'https://example.com/b.ics', color: 'green' })
    now = 3000
    store.update(b.id, { label: 'Bee' })
    expect(store.exportForSync()).toEqual({
      calendars: [
        { url: SECRET, label: 'A', color: 'blue', enabled: true, updatedAt: 1000 },
        { url: 'https://example.com/b.ics', label: 'Bee', color: 'green', enabled: true, updatedAt: 3000 }
      ],
      removed: []
    })
    // Another device renamed A, removed B and added C.
    const gone = store.importFromSync({
      calendars: [
        { url: SECRET, label: 'Work', color: 'red', enabled: false, updatedAt: 4000 },
        { url: 'https://example.com/c.ics', label: 'C', color: 'pink', enabled: true, updatedAt: 4000 },
        // Checked again on the way in.
        { url: 'http://example.com/plain.ics', label: 'no', color: 'blue', enabled: true, updatedAt: 4000 }
      ],
      removed: [{ key: calendarKey('https://example.com/b.ics'), deletedAt: 4000 }]
    })
    expect(gone).toEqual([b.id])
    const list = store.list()
    expect(list.map((entry) => entry.label)).toEqual(['Work', 'C'])
    expect(list[0]).toEqual({ id: a.id, label: 'Work', host: 'calendar.google.com', color: 'red', enabled: false })
    expect(store.urlOf(list[1].id)).toBe('https://example.com/c.ics')
    // The same again changes nothing.
    expect(store.importFromSync(store.exportForSync()!)).toEqual([])
    expect(store.list()).toEqual(list)
    // Adding a removed address again takes its removal back.
    now = 5000
    store.add({ label: 'B again', url: 'https://example.com/b.ics', color: 'blue' })
    expect(store.exportForSync()?.removed).toEqual([])
  })

  it('stays out of sync without a key store', () => {
    const store = new CalendarStore(file(), { ...cipher, isAvailable: () => false })
    expect(store.exportForSync()).toBeNull()
    expect(store.importFromSync({ calendars: [{ url: SECRET, label: 'x', color: 'blue', enabled: true, updatedAt: 1 }], removed: [] })).toBeNull()
    expect(existsSync(file())).toBe(false)
  })

  it('caps the number of calendars', () => {
    const store = new CalendarStore(file(), cipher)
    for (let i = 0; i < 8; i++) store.add({ label: `c${i}`, url: `https://example.com/${i}.ics`, color: 'blue' })
    expect(() => store.add({ label: 'one more', url: 'https://example.com/9.ics', color: 'blue' })).toThrow('At most 8')
  })

  it('treats a damaged or foreign file as no calendars, and re-checks what it holds', () => {
    writeFileSync(join(dir, 'calendars.bin'), 'garbage that does not decrypt to JSON')
    expect(new CalendarStore(join(dir, 'calendars.bin'), cipher).list()).toEqual([])
    const planted = cipher.encrypt(
      JSON.stringify({
        version: 1,
        calendars: [
          { id: 'ok', label: 'ok', url: 'https://example.com/a.ics', color: 'blue', enabled: true },
          { id: 'local', label: 'local', url: 'http://127.0.0.1:9/a.ics', color: 'blue', enabled: true },
          { id: 'bad id!', label: 'x', url: 'https://example.com/b.ics' },
          { id: 'nourl', label: 'x' },
          'nonsense'
        ]
      })
    )
    writeFileSync(join(dir, 'planted.bin'), planted)
    expect(new CalendarStore(join(dir, 'planted.bin'), cipher).list().map((entry) => entry.id)).toEqual(['ok'])
  })
})

const ICS = (title: string, day = '20261013'): string =>
  ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', `SUMMARY:${title}`, `DTSTART:${day}T120000Z`, `DTEND:${day}T130000Z`, 'END:VEVENT', 'BEGIN:VEVENT', 'UID:b', 'SUMMARY:All day', `DTSTART;VALUE=DATE:${day}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

describe('the calendar service', () => {
  const NOW = new Date(2026, 9, 13, 8, 5).getTime()
  const day = (offset: number): number => new Date(2026, 9, 13 + offset).getTime()

  function setup(respond: (url: string, options: FetchOptions, call: number) => Promise<FetchResult> | FetchResult) {
    let now = NOW
    let calls = 0
    let changes = 0
    const seen: { url: string; options: FetchOptions }[] = []
    const store = new CalendarStore(file(), cipher)
    const make = (): CalendarService =>
      new CalendarService({
        store,
        cacheFile: join(dir, 'briefing', 'calendar-cache.json'),
        now: () => now,
        onChange: () => changes++,
        fetch: async (url, options) => {
          seen.push({ url, options })
          return respond(url, options, calls++)
        }
      })
    return { store, make, seen, calls: () => calls, changes: () => changes, advance: (ms: number) => (now += ms) }
  }

  it('makes no request at all when no calendar is connected', async () => {
    const t = setup(() => {
      throw new Error('the network was touched')
    })
    const service = t.make()
    expect(service.stale()).toBe(false)
    await service.refresh(true)
    expect(service.events(day(0), day(1))).toEqual([])
    expect(service.status()).toEqual([])
    expect(t.calls()).toBe(0)
    expect(existsSync(join(dir, 'briefing'))).toBe(false)
  })

  it('reads a calendar, caches it and serves the cache to the next session', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = setup(() => ({ status: 'ok', text: ICS('Standup'), etag: '"v1"' }))
    const added = t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    await service.refresh()
    const events = service.events(day(0), day(1))
    expect(events.map((event) => [event.title, event.allDay, event.calendarId])).toEqual([
      ['All day', true, added.id],
      ['Standup', false, added.id]
    ])
    expect(events[0].start).toBe(day(0))
    expect(events[0].end).toBe(day(1))
    expect(service.status()).toEqual([{ ...added, ok: true, updatedAt: NOW }])
    expect(t.changes()).toBe(1)
    // Nothing a window may receive, and nothing on disk, holds the address.
    expect(JSON.stringify([service.status(), events])).not.toContain('SECRETTOKEN')
    expect(everything()).not.toContain('SECRETTOKEN')
    expect(readFileSync(join(dir, 'briefing', 'calendar-cache.json'), 'utf8')).toContain('Standup')

    // A new session, offline: the agenda is there at once.
    const offline = setup(() => {
      throw new CalendarError('offline')
    })
    const again = new CalendarService({ store: new CalendarStore(file(), cipher), cacheFile: join(dir, 'briefing', 'calendar-cache.json'), now: () => NOW + 60_000, fetch: () => Promise.reject(new CalendarError('offline')) })
    expect(again.events(day(0), day(1)).map((event) => event.title)).toEqual(['All day', 'Standup'])
    expect(offline.calls()).toBe(0)
  })

  it('asks at most every 15 minutes on its own, and every minute when the user asks', async () => {
    const t = setup(() => ({ status: 'ok', text: ICS('x') }))
    t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    await service.refresh()
    await service.refresh()
    expect(t.calls()).toBe(1)
    t.advance(CALENDAR_TIMING.autoMs - 1000)
    expect(service.stale()).toBe(false)
    await service.refresh()
    expect(t.calls()).toBe(1)
    // The user's own refresh is allowed sooner, but not at once.
    await service.refresh(true)
    expect(t.calls()).toBe(2)
    await service.refresh(true)
    expect(t.calls()).toBe(2)
    t.advance(CALENDAR_TIMING.autoMs)
    expect(service.stale()).toBe(true)
    await service.refresh()
    expect(t.calls()).toBe(3)
  })

  it('does not read one calendar twice at the same time', async () => {
    let release: (result: FetchResult) => void = () => undefined
    const t = setup(() => new Promise<FetchResult>((resolve) => (release = resolve)))
    t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    const both = Promise.all([service.refresh(), service.refresh(true)])
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(t.calls()).toBe(1)
    release({ status: 'ok', text: ICS('x') })
    await both
  })

  it('sends the validators of the last answer and keeps the events when nothing changed', async () => {
    const t = setup((_url, _options, call) => (call === 0 ? { status: 'ok', text: ICS('Standup'), etag: '"v1"', lastModified: 'Tue, 13 Oct 2026 08:00:00 GMT' } : { status: 'not-modified' }))
    t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    await service.refresh()
    expect(t.seen[0].options.etag).toBeUndefined()
    t.advance(CALENDAR_TIMING.autoMs)
    await service.refresh()
    expect(t.seen[1].options).toMatchObject({ etag: '"v1"', lastModified: 'Tue, 13 Oct 2026 08:00:00 GMT' })
    expect(service.events(day(0), day(1)).map((event) => event.title)).toEqual(['All day', 'Standup'])
    expect(service.status()[0]).toMatchObject({ ok: true, updatedAt: NOW + CALENDAR_TIMING.autoMs })
  })

  it('asks for the whole file again once the cached days run short', async () => {
    const t = setup(() => ({ status: 'ok', text: ICS('Standup'), etag: '"v1"' }))
    t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    await service.refresh()
    t.advance((CALENDAR_TIMING.aheadDays - 1) * 86_400_000)
    await service.refresh()
    expect(t.seen[1].options.etag).toBeUndefined()
  })

  it('keeps the last good events when a read fails, and says why without the address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = setup((_url, _options, call) => {
      if (call === 0) return { status: 'ok', text: ICS('Standup') }
      throw new CalendarError('offline')
    })
    const added = t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    await service.refresh()
    t.advance(CALENDAR_TIMING.autoMs)
    await service.refresh()
    expect(service.status()).toEqual([{ ...added, ok: false, error: 'offline', updatedAt: NOW }])
    expect(service.events(day(0), day(1)).map((event) => event.title)).toEqual(['All day', 'Standup'])
    expect(warn.mock.calls.flat().join(' ')).not.toContain('SECRETTOKEN')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('google')
    expect(warn.mock.calls.flat().join(' ')).toContain('offline')
  })

  it('refuses what is not a calendar, and maps unknown failures to "failed"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = setup((_url, _options, call) => {
      if (call === 0) return { status: 'ok', text: '<!doctype html><html><body><script>alert(1)</script>Sign in</body></html>' }
      throw new Error(`boom at ${SECRET}`)
    })
    const added = t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    expect(await service.test(added.id)).toEqual({ ok: false, error: 'not-calendar' })
    expect(service.events(day(0), day(1))).toEqual([])
    expect(await service.test(added.id)).toEqual({ ok: false, error: 'failed' })
    expect(JSON.stringify(service.status())).not.toContain('SECRETTOKEN')
  })

  it('tests a calendar: counts today and the week, whatever its age', async () => {
    const week = ['BEGIN:VCALENDAR']
    for (const [uid, date] of [['a', '20261013'], ['b', '20261013'], ['c', '20261016'], ['d', '20261019'], ['e', '20261020'], ['f', '20261012']]) {
      week.push('BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${uid}`, `DTSTART;VALUE=DATE:${date}`, 'END:VEVENT')
    }
    week.push('END:VCALENDAR')
    const t = setup(() => ({ status: 'ok', text: week.join('\r\n') }))
    const added = t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
    const service = t.make()
    expect(await service.test(added.id)).toEqual({ ok: true, today: 2, week: 4 })
    expect(await service.test(added.id)).toEqual({ ok: true, today: 2, week: 4 })
    expect(t.calls()).toBe(2)
    await expect(service.test('missing')).rejects.toThrow('no longer connected')
  })

  it('leaves disabled calendars alone and forgets removed ones', async () => {
    const t = setup(() => ({ status: 'ok', text: ICS('Standup') }))
    const a = t.store.add({ label: 'A', url: SECRET, color: 'blue' })
    const b = t.store.add({ label: 'B', url: 'https://example.com/b.ics', color: 'red' })
    t.store.update(b.id, { enabled: false })
    const service = t.make()
    await service.refresh()
    expect(t.seen.map((call) => call.url)).toEqual([SECRET])
    t.store.update(a.id, { enabled: false })
    expect(service.events(day(0), day(1))).toEqual([])
    expect(service.stale()).toBe(false)
    t.store.remove(a.id)
    service.forget(a.id)
    t.store.remove(b.id)
    expect(existsSync(join(dir, 'briefing', 'calendar-cache.json'))).toBe(false)
  })

  describe('days beyond the cached fortnight', () => {
    const WEEKLY = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:w', 'SUMMARY:Weekly', 'DTSTART:20261013T120000Z', 'DTEND:20261013T130000Z', 'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const december = new Date(2026, 11, 1).getTime()
    const january = new Date(2027, 0, 1).getTime()

    it('are answered from the calendar as it was last parsed, which is read once', async () => {
      const t = setup(() => ({ status: 'ok', text: WEEKLY, etag: '"v1"' }))
      t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
      const service = t.make()
      // Nothing read yet: nothing to show, and it says so.
      expect(service.span(december, january)).toEqual({ events: [], complete: false })
      await service.cover(december, january)
      expect(t.calls()).toBe(1)
      const month = service.span(december, january)
      expect(month.complete).toBe(true)
      expect(month.events.map((event) => new Date(event.start).getDate())).toEqual([1, 8, 15, 22, 29])
      // Any other month comes from the same copy; days the cache holds come from the cache.
      expect(service.span(new Date(2027, 2, 1).getTime(), new Date(2027, 3, 1).getTime())).toMatchObject({ complete: true, events: { length: 5 } })
      expect(service.span(day(0), day(1)).events.map((event) => event.title)).toEqual(['Weekly'])
      await service.cover(december, january)
      expect(t.calls()).toBe(1)
      expect(everything()).not.toContain('SECRETTOKEN')

      // A new session holds the fortnight only. It asks for the whole file, once, however often it is asked.
      const again = t.make()
      expect(again.span(december, january)).toEqual({ events: [], complete: false })
      await Promise.all([again.cover(december, january), again.cover(december, january)])
      await again.cover(december, january)
      expect(t.calls()).toBe(2)
      expect(t.seen[1].options.etag).toBeUndefined()
      expect(again.span(december, january).events).toHaveLength(5)
    })

    it('ask a calendar that cannot be read once a minute at most', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const t = setup(() => {
        throw new CalendarError('offline')
      })
      const added = t.store.add({ label: 'Work', url: SECRET, color: 'blue' })
      const service = t.make()
      await service.cover(december, january)
      await service.cover(december, january)
      expect(t.calls()).toBe(1)
      expect(service.span(december, january)).toEqual({ events: [], complete: false })
      expect(service.status()[0]).toMatchObject({ ok: false, error: 'offline' })
      t.advance(CALENDAR_TIMING.manualMs)
      await service.cover(december, january)
      expect(t.calls()).toBe(2)
      // A removed calendar is forgotten here too.
      t.store.remove(added.id)
      service.forget(added.id)
      expect(service.span(december, january)).toEqual({ events: [], complete: true })
    })
  })

  it('keeps what the alarms need, and reads in full a calendar cached before it did', async () => {
    const meeting = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:standup@x', 'SUMMARY:Standup', 'DTSTART:20261013T120000Z', 'DTEND:20261013T130000Z', 'ATTENDEE:mailto:a@x.com', 'ATTENDEE:mailto:b@x.com', 'ORGANIZER:mailto:a@x.com', 'LOCATION:https://meet.google.com/abc-defg-hij', 'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const t = setup(() => ({ status: 'ok', text: meeting, etag: '"v2"' }))
    const added = t.store.add({ label: 'A', url: SECRET, color: 'blue' })
    writeFileSync(
      join(dir, 'briefing', 'calendar-cache.json'),
      // Version 2 kept the count of the invited but not their names: it is read again in full too.
      JSON.stringify({ version: 2, calendars: { [added.id]: { etag: '"v1"', fetchedAt: NOW, checkedAt: NOW, from: day(-1), to: day(15), events: [{ id: 'old', title: 'Standup', start: day(0) + 1000, end: day(0) + 2000, attendees: 1 }] } } })
    )
    const service = t.make()
    // The old cache still answers at once, and is due for a read that asks for the whole file.
    expect(service.events(day(0), day(1)).map((event) => event.id)).toEqual(['old'])
    expect(service.stale()).toBe(true)
    await service.refresh()
    expect(t.seen[0].options.etag).toBeUndefined()
    const [event] = service.events(day(0), day(1))
    expect(event).toMatchObject({ uid: 'standup@x', attendees: 1, people: ['b@x.com'], meetingUrl: 'https://meet.google.com/abc-defg-hij', transparent: true })
    // And so does the next session, from the file.
    expect(t.make().events(day(0), day(1))[0]).toMatchObject({ uid: 'standup@x', attendees: 1, people: ['b@x.com'], meetingUrl: 'https://meet.google.com/abc-defg-hij', transparent: true })
    expect(JSON.parse(readFileSync(join(dir, 'briefing', 'calendar-cache.json'), 'utf8')).version).toBe(3)
  })

  it('reads a damaged cache as empty', () => {
    const t = setup(() => ({ status: 'ok', text: ICS('x') }))
    const added = t.store.add({ label: 'A', url: SECRET, color: 'blue' })
    writeFileSync(join(dir, 'briefing', 'calendar-cache.json'), JSON.stringify({ version: 1, calendars: { [added.id]: { events: [null, 7, { id: 'x' }, { id: 'ok', title: 't', start: day(0) + 1000, end: day(0) + 2000 }, { id: 'half', title: 'allday', allDay: true, startDay: 'nonsense', endDay: '2026-10-14' }], error: 'made-up', fetchedAt: 'yesterday' }, '../evil': {} } }))
    const service = t.make()
    expect(service.events(day(0), day(1)).map((event) => event.id)).toEqual(['ok'])
    expect(service.status()[0]).toEqual({ ...added, ok: true })
    writeFileSync(join(dir, 'briefing', 'calendar-cache.json'), '{not json')
    expect(t.make().events(day(0), day(1))).toEqual([])
  })
})
