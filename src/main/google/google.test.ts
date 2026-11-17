import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanGoogleClientId, cleanGoogleClientSecret, GOOGLE_SCOPE } from '../../shared/google'
import type { FeedTask } from '../../shared/tasks/ics'
import { eventId, eventOf } from './events'
import { waitForCode } from './loopback'
import { authUrl, pkce, type Fetch } from './oauth'
import { GoogleService } from './service'
import { GoogleStore, type Cipher } from './store'

const CLIENT_ID = '1234567890-abcdefghij0123456789.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-abcdefghijklmnop'
const ZONE = 'America/Sao_Paulo'

const task = (over: Partial<FeedTask> = {}): FeedTask => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Dentista',
  due: '2026-11-18',
  project: null,
  priority: null,
  labels: [],
  recurrence: null,
  updatedAt: 0,
  ...over
})

/** A cipher that is not one: enough to see that the file is not the plain text. */
const cipher = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (text) => Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a) as Buffer,
  decrypt: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString('utf8')
})

describe('what Google is given', () => {
  it('takes a client id and a secret that read as such, and nothing else', () => {
    expect(cleanGoogleClientId(` ${CLIENT_ID} `)).toBe(CLIENT_ID)
    for (const bad of ['', 'abc', 'x.apps.googleusercontent.com', `${CLIENT_ID}/evil`, 7]) expect(cleanGoogleClientId(bad)).toBeNull()
    expect(cleanGoogleClientSecret(CLIENT_SECRET)).toBe(CLIENT_SECRET)
    for (const bad of ['short', 'has space in it', 'x'.repeat(201), null]) expect(cleanGoogleClientSecret(bad)).toBeNull()
  })

  it('asks for the one permission, with PKCE, at Google’s own address', () => {
    const { verifier, challenge } = pkce()
    expect(verifier).not.toBe(challenge)
    const url = new URL(authUrl({ clientId: CLIENT_ID, redirectUri: 'http://127.0.0.1:5555', state: 'st', challenge }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:5555',
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      state: 'st',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent'
    })
    expect(GOOGLE_SCOPE).toBe('https://www.googleapis.com/auth/calendar.app.created')
  })

  it('makes an event of a task: its id, the whole day or half an hour, a series for what repeats by its date', () => {
    expect(eventId('11111111-1111-4111-8111-111111111111')).toBe('11111111111141118111111111111111')
    expect(eventId('not-an-id')).toBeNull()
    const day = eventOf(task({ project: 'Casa', priority: 'P1', labels: ['banco'] }), ZONE)
    expect(day?.body).toEqual({
      summary: 'Dentista',
      description: '#Casa P1 @banco',
      start: { date: '2026-11-18' },
      end: { date: '2026-11-19' },
      recurrence: [],
      transparency: 'transparent',
      status: 'confirmed'
    })
    const timed = eventOf(task({ due: '2026-12-31T23:45', recurrence: { rule: 'FREQ=WEEKLY;BYDAY=TH', from: 'due' } }), ZONE)
    expect(timed?.body).toMatchObject({
      start: { dateTime: '2026-12-31T23:45:00', timeZone: ZONE },
      end: { dateTime: '2027-01-01T00:15:00', timeZone: ZONE },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH']
    })
    expect(eventOf(task({ recurrence: { rule: 'FREQ=DAILY', from: 'completion' } }), ZONE)?.body['recurrence']).toEqual([])
    expect(eventOf(task({ due: 'amanhã' }), ZONE)).toBeNull()
    // The same task says the same thing; a change in it is a change in its mark.
    expect(eventOf(task(), ZONE)?.mark).toBe(eventOf(task(), ZONE)?.mark)
    expect(eventOf(task({ title: 'Dentista 2' }), ZONE)?.mark).not.toBe(eventOf(task(), ZONE)?.mark)
  })
})

describe('where the browser comes back to', () => {
  it('takes the answer to this sign-in, on this computer only, and no other', async () => {
    const waiting = await waitForCode('the-state', 5000)
    expect(waiting.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    expect((await fetch(`${waiting.redirectUri}/?state=another&code=stolen`)).status).toBe(400)
    expect((await fetch(`${waiting.redirectUri}/elsewhere?state=the-state&code=x`)).status).toBe(404)
    const reply = await fetch(`${waiting.redirectUri}/?state=the-state&code=the-code`)
    expect(await reply.text()).toContain('Signed in')
    expect(await waiting.code).toBe('the-code')
    // One answer: it is closed after it.
    await expect(fetch(`${waiting.redirectUri}/?state=the-state&code=again`)).rejects.toThrow()
  })

  it('says so when the sign-in was refused, and when nobody came', async () => {
    const refused = await waitForCode('s', 5000)
    await fetch(`${refused.redirectUri}/?state=s&error=access_denied`)
    await expect(refused.code).rejects.toThrow('refused')
    const nobody = await waitForCode('s', 20)
    await expect(nobody.code).rejects.toThrow('given up')
  })
})

describe('the tasks in Google Calendar', () => {
  let dir: string
  let tasks: FeedTask[]
  let now: number
  let opened: string[]
  let requests: { method: string; path: string; body: Record<string, unknown> | null; auth: string | undefined }[]
  /** Google, as far as sel talks to it. */
  let google: {
    calendars: Map<string, Map<string, Record<string, unknown>>>
    refreshOk: boolean
    tokens: number
    revoked: string[]
    fail: number | null
  }
  let logs: string[]

  const fakeFetch: Fetch = async (url, init = {}) => {
    const reply = (status: number, body: unknown = {}): { ok: boolean; status: number; text(): Promise<string> } => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (status === 204 ? '' : JSON.stringify(body))
    })
    const target = new URL(url)
    const form = init.body && init.headers?.['Content-Type']?.includes('urlencoded') ? new URLSearchParams(init.body) : null
    if (target.href === 'https://oauth2.googleapis.com/token' && form) {
      requests.push({ method: 'POST', path: `token:${form.get('grant_type')}`, body: Object.fromEntries(form), auth: undefined })
      if (form.get('client_secret') !== CLIENT_SECRET)
        return reply(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' })
      if (form.get('grant_type') === 'refresh_token' && (!google.refreshOk || form.get('refresh_token') !== 'refresh-1'))
        return reply(400, { error: 'invalid_grant' })
      if (form.get('grant_type') === 'authorization_code' && form.get('code') !== 'good-code') return reply(400, { error: 'invalid_grant' })
      google.tokens += 1
      return reply(200, {
        access_token: `access-${google.tokens}`,
        expires_in: 3600,
        ...(form.get('grant_type') === 'authorization_code' ? { refresh_token: 'refresh-1' } : {})
      })
    }
    if (target.href === 'https://oauth2.googleapis.com/revoke' && form) {
      google.revoked.push(form.get('token') ?? '')
      return reply(200)
    }
    const path = target.href.replace('https://www.googleapis.com/calendar/v3', '')
    const method = init.method ?? 'GET'
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null
    requests.push({ method, path, body, auth: init.headers?.['Authorization'] })
    if (init.headers?.['Authorization'] !== `Bearer access-${google.tokens}`) return reply(401)
    if (google.fail !== null) return reply(google.fail)
    if (method === 'POST' && path === '/calendars') {
      const id = `cal-${google.calendars.size + 1}@group.calendar.google.com`
      google.calendars.set(id, new Map())
      return reply(200, { id })
    }
    const match = /^\/calendars\/([^/]+)(?:\/events(?:\/([a-v0-9]+))?)?$/u.exec(path)
    const calendar = match ? google.calendars.get(decodeURIComponent(match[1])) : undefined
    if (!match || !calendar) return reply(404)
    const [, , id] = match
    if (!path.includes('/events')) return reply(200, { id: decodeURIComponent(match[1]) })
    if (method === 'POST') {
      const made = String(body?.['id'])
      if (calendar.has(made)) return reply(409)
      calendar.set(made, body as Record<string, unknown>)
      return reply(200, body)
    }
    if (!id || !calendar.has(id)) return reply(404)
    if (method === 'PUT') {
      calendar.set(id, { ...body, id })
      return reply(200, body)
    }
    if (method === 'DELETE') {
      calendar.delete(id)
      return reply(204)
    }
    return reply(405)
  }

  const make = (available = true): { service: GoogleService; store: GoogleStore } => {
    const store = new GoogleStore(join(dir, 'google.bin'), cipher(available))
    const service = new GoogleService({
      fetch: fakeFetch,
      store,
      tasks: () => tasks,
      open: (url) => void opened.push(url),
      now: () => now,
      timeZone: () => ZONE,
      log: (message, error) => void logs.push(`${message} ${String(error ?? '')}`),
      // The browser, signing in at once: it comes back with the code and the state it was sent with.
      wait: async (state, timeoutMs) => {
        const waiting = await waitForCode(state, timeoutMs)
        queueMicrotask(() => void fetch(`${waiting.redirectUri}/?state=${state}&code=${browser.code}`).catch(() => undefined))
        return waiting
      }
    })
    return { service, store }
  }
  const browser = { code: 'good-code' }
  const events = (): Map<string, Record<string, unknown>> => [...google.calendars.values()].at(-1) ?? new Map()
  const calendarCalls = (): string[] =>
    requests
      .filter((each) => !each.path.startsWith('token:'))
      .map((each) => `${each.method} ${each.path.replace(/cal-\d+%40group\.calendar\.google\.com/u, 'CAL')}`)

  async function signedIn(): Promise<{ service: GoogleService; store: GoogleStore }> {
    const made = make()
    made.service.configure(CLIENT_ID, CLIENT_SECRET)
    await made.service.signIn()
    return made
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sel-google-'))
    tasks = [task()]
    now = Date.UTC(2026, 10, 17, 12)
    opened = []
    requests = []
    logs = []
    browser.code = 'good-code'
    google = { calendars: new Map(), refreshOk: true, tokens: 0, revoked: [], fail: null }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('does nothing, and asks Google nothing, until there is a client and a sign-in', async () => {
    const { service } = make()
    expect(service.status()).toEqual({
      available: true,
      clientId: null,
      signedIn: false,
      signingIn: false,
      lastSync: null,
      events: 0,
      error: null
    })
    await service.sync()
    await expect(service.signIn()).rejects.toThrow('client ID')
    expect(() => service.configure('nope', CLIENT_SECRET)).toThrow('client ID')
    expect(() => service.configure(CLIENT_ID, 'x')).toThrow('client secret')
    expect(requests).toEqual([])
    // Where nothing can be kept safely, nothing is offered.
    expect(make(false).service.status().available).toBe(false)
  })

  it('signs in through the browser, makes its calendar and puts the tasks in it', async () => {
    const { service } = await signedIn()
    expect(opened).toHaveLength(1)
    expect(new URL(opened[0]).searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    const exchange = requests.find((each) => each.path === 'token:authorization_code')?.body
    expect(exchange).toMatchObject({ client_id: CLIENT_ID, code: 'good-code' })
    expect(String(exchange?.['code_verifier']).length).toBeGreaterThan(40)
    expect(service.status()).toMatchObject({ signedIn: true, signingIn: false, events: 1, lastSync: now, error: null })
    expect(calendarCalls()).toEqual([
      'POST /calendars',
      'PUT /calendars/CAL/events/11111111111141118111111111111111',
      'POST /calendars/CAL/events'
    ])
    expect(requests.find((each) => each.path === '/calendars')?.body).toMatchObject({ summary: 'sel', timeZone: ZONE })
    expect([...events().values()]).toMatchObject([
      { id: '11111111111141118111111111111111', summary: 'Dentista', start: { date: '2026-11-18' } }
    ])
  })

  it('keeps the client secret and the sign-in out of what a window gets, and out of plain sight on disk', async () => {
    const { service } = await signedIn()
    expect(JSON.stringify(service.status())).not.toMatch(/GOCSPX|refresh-1|access-/u)
    const file = readFileSync(join(dir, 'google.bin'))
    expect(file.toString('utf8')).not.toMatch(/GOCSPX|refresh-1/u)
    expect(logs.join('\n')).not.toMatch(/GOCSPX|refresh-1|access-/u)
  })

  it('sends only what changed: a task changed, one done, one new; and nothing when nothing did', async () => {
    const { service } = await signedIn()
    requests = []
    await service.sync()
    // Nothing changed: Google is not asked anything.
    expect(requests).toEqual([])
    const other = task({ id: '22222222-2222-4222-8222-222222222222', title: 'Mercado', due: '2026-11-19T18:00' })
    tasks = [task({ title: 'Dentista 15h' }), other]
    await service.sync()
    expect(calendarCalls()).toEqual([
      'PUT /calendars/CAL/events/11111111111141118111111111111111',
      'PUT /calendars/CAL/events/22222222222242228222222222222222',
      'POST /calendars/CAL/events'
    ])
    expect([...events().values()].map((event) => event['summary']).sort()).toEqual(['Dentista 15h', 'Mercado'])
    // Done, deleted or with no date any more: it is no longer among the tasks, and leaves the calendar.
    requests = []
    tasks = [other]
    await service.sync()
    expect(calendarCalls()).toEqual(['DELETE /calendars/CAL/events/11111111111141118111111111111111'])
    expect([...events().keys()]).toEqual(['22222222222242228222222222222222'])
    expect(service.status().events).toBe(1)
  })

  it('stays signed in between runs, with a new token when the old one ran out', async () => {
    await signedIn()
    const again = make()
    tasks = [task({ title: 'Outra' })]
    requests = []
    await again.service.sync()
    expect(requests[0].path).toBe('token:refresh_token')
    // The calendar is looked at once, then the one event is changed where it is.
    expect(calendarCalls()).toEqual(['GET /calendars/CAL', 'PUT /calendars/CAL/events/11111111111141118111111111111111'])
    now += 2 * 60 * 60_000
    tasks = [task({ title: 'Mais uma' })]
    requests = []
    await again.service.sync()
    expect(requests.map((each) => each.path)[0]).toBe('token:refresh_token')
    expect(events().get('11111111111141118111111111111111')?.['summary']).toBe('Mais uma')
  })

  it('makes its calendar again when it was deleted in Google, with everything in it', async () => {
    const { service } = await signedIn()
    google.calendars.clear()
    tasks = [task({ title: 'Dentista 15h' })]
    await service.sync()
    // The event had nowhere to go: said, and made good the next time.
    expect(service.status().error).toBe('Google Calendar answered 404.')
    await service.sync()
    expect(service.status()).toMatchObject({ error: null, events: 1 })
    expect([...events().values()].map((event) => event['summary'])).toEqual(['Dentista 15h'])
  })

  it('signs itself out when Google no longer takes the sign-in, and says so', async () => {
    await signedIn()
    const again = make()
    google.refreshOk = false
    tasks = [task({ title: 'Outra' })]
    await again.service.sync()
    expect(again.service.status()).toMatchObject({ signedIn: false, error: 'Google no longer accepts the sign-in. Sign in again.' })
  })

  it('says what Google said when the client is wrong or the sign-in was not finished, and keeps what it had', async () => {
    const { service } = make()
    service.configure(CLIENT_ID, CLIENT_SECRET)
    browser.code = 'bad-code'
    expect(await service.signIn()).toMatchObject({ signedIn: false, error: 'Google did not accept the sign-in. Try again.' })
    browser.code = 'good-code'
    const { service: ok } = await signedIn()
    google.fail = 503
    tasks = [task({ title: 'Outra' })]
    await ok.sync()
    expect(ok.status()).toMatchObject({ signedIn: true, error: 'Google Calendar answered 503.', events: 1 })
    google.fail = null
    await ok.sync()
    expect(ok.status().error).toBeNull()
    expect(events().get('11111111111141118111111111111111')?.['summary']).toBe('Outra')
  })

  it('forgets the sign-in on sign-out, tells Google, and leaves the calendar as it is', async () => {
    const { service } = await signedIn()
    expect(await service.signOut()).toMatchObject({ signedIn: false, clientId: CLIENT_ID })
    expect(google.revoked).toEqual(['refresh-1'])
    expect(events().size).toBe(1)
    requests = []
    tasks = []
    await service.sync()
    expect(requests).toEqual([])
    // Another client is another app to Google: the sign-in made with the first does not carry over.
    const second = await signedIn()
    expect(second.service.configure('999-zzz.apps.googleusercontent.com'.replace('zzz', 'abc'), CLIENT_SECRET).signedIn).toBe(false)
  })
})
