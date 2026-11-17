// The tasks in the user's Google Calendar (shared/google.ts): signing in, the calendar sel makes
// there, and bringing it up to date. Electron-free: the network, the browser, the storage and
// the tasks are passed in.
import { cleanGoogleClientId, cleanGoogleClientSecret, GOOGLE_CALENDAR_NAME, type GoogleStatus } from '../../shared/google'
import type { FeedTask } from '../../shared/tasks/ics'
import { eventOf, type GoogleEvent } from './events'
import { waitForCode } from './loopback'
import { authUrl, exchange, newState, pkce, refresh, revoke, SignedOutError, type Client, type Fetch } from './oauth'
import type { GoogleStore } from './store'

const API = 'https://www.googleapis.com/calendar/v3'
/** How long the browser has to come back from a sign-in. */
const SIGN_IN_MS = 5 * 60_000
/** A calendar is not sent more than this many changes at once: the rest go the next time. */
const MAX_CHANGES = 300

export interface GoogleDeps {
  fetch: Fetch
  store: GoogleStore
  /** The open tasks that have a date, as the calendar shows them. */
  tasks(): FeedTask[]
  /** Opens an address in the user's browser. */
  open(url: string): void
  now(): number
  timeZone(): string
  log(message: string, error?: unknown): void
  wait?: typeof waitForCode
}

/** What went wrong, in words for the user; never an address, a token or a secret. */
function words(error: unknown): string {
  if (error instanceof SignedOutError) return 'Google no longer accepts the sign-in. Sign in again.'
  const message = error instanceof Error ? error.message : ''
  if (/^Google refused|^The sign-in|^Google did not|^Google answered|^Google Calendar/u.test(message)) return message
  return 'Google Calendar could not be reached.'
}

export class GoogleService {
  private access: { token: string; expiresAt: number } | null = null
  private signingIn: { close(): void } | null = null
  private error: string | null = null
  private running: Promise<void> = Promise.resolve()
  /** The calendar was seen to be there since sel started. */
  private calendarSeen = false

  constructor(private readonly deps: GoogleDeps) {}

  status(): GoogleStatus {
    const { store } = this.deps
    if (!store.available())
      return { available: false, clientId: null, signedIn: false, signingIn: false, lastSync: null, events: 0, error: null }
    const state = store.read()
    return {
      available: true,
      clientId: state.clientId,
      signedIn: !!state.refreshToken,
      signingIn: !!this.signingIn,
      lastSync: state.lastSync,
      events: Object.keys(state.pushed).length,
      error: this.error
    }
  }

  private client(): Client | null {
    const { clientId, clientSecret } = this.deps.store.read()
    return clientId && clientSecret ? { id: clientId, secret: clientSecret } : null
  }

  /** Keeps the OAuth client. A different one is a different app to Google: the sign-in made with the old one goes. */
  configure(id: unknown, secret: unknown): GoogleStatus {
    const clientId = cleanGoogleClientId(id)
    const clientSecret = cleanGoogleClientSecret(secret)
    if (!clientId) throw new Error('That does not read as a client ID: it ends in .apps.googleusercontent.com.')
    if (!clientSecret) throw new Error('That does not read as a client secret.')
    const before = this.deps.store.read()
    const changed = before.clientId !== clientId
    this.deps.store.write({ clientId, clientSecret, ...(changed ? { refreshToken: null } : {}) })
    if (changed) this.access = null
    this.error = null
    return this.status()
  }

  /** Opens the browser to sign in; settles once it is back, refused, or nobody came. */
  async signIn(): Promise<GoogleStatus> {
    const client = this.client()
    if (!client) throw new Error('Give sel a client ID and secret first.')
    this.signingIn?.close()
    const state = newState()
    const { verifier, challenge } = pkce()
    const waiting = await (this.deps.wait ?? waitForCode)(state, SIGN_IN_MS)
    this.signingIn = waiting
    this.error = null
    try {
      this.deps.open(authUrl({ clientId: client.id, redirectUri: waiting.redirectUri, state, challenge }))
      const code = await waiting.code
      const tokens = await exchange(this.deps.fetch, client, { code, verifier, redirectUri: waiting.redirectUri }, this.deps.now())
      if (!tokens.refresh)
        throw new Error('Google did not sign in for good: remove sel in your Google account’s connections and sign in again.')
      this.deps.store.write({ refreshToken: tokens.refresh })
      this.access = { token: tokens.access, expiresAt: tokens.expiresAt }
    } catch (error) {
      this.deps.log('the sign-in to Google failed', error instanceof Error ? error.message : error)
      // Here it is the code from the browser that was not taken, not a sign-in that ran out.
      this.error = error instanceof SignedOutError ? 'Google did not accept the sign-in. Try again.' : words(error)
      return this.status()
    } finally {
      if (this.signingIn === waiting) this.signingIn = null
      waiting.close()
    }
    await this.sync()
    return this.status()
  }

  /** Forgets the sign-in. The calendar stays in Google as it is: sel may be signed in again. */
  async signOut(): Promise<GoogleStatus> {
    this.signingIn?.close()
    const { refreshToken } = this.deps.store.read()
    this.deps.store.write({ refreshToken: null })
    this.access = null
    this.error = null
    if (refreshToken)
      await revoke(this.deps.fetch, refreshToken).catch((error: unknown) =>
        this.deps.log('the sign-in could not be withdrawn at Google', error)
      )
    return this.status()
  }

  /** Brings the calendar up to date. One at a time: a second call waits for the first and then looks again. */
  sync(): Promise<void> {
    const next = this.running.then(() => this.syncOnce())
    this.running = next.catch(() => undefined)
    return next
  }

  private async token(): Promise<string> {
    const now = this.deps.now()
    if (this.access && this.access.expiresAt - now > 60_000) return this.access.token
    const client = this.client()
    const { refreshToken } = this.deps.store.read()
    if (!client || !refreshToken) throw new SignedOutError()
    const tokens = await refresh(this.deps.fetch, client, refreshToken, now)
    this.access = { token: tokens.access, expiresAt: tokens.expiresAt }
    return tokens.access
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const send = async (): Promise<{ status: number; text: string }> => {
      const reply = await this.deps.fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      return { status: reply.status, text: await reply.text() }
    }
    let reply = await send()
    if (reply.status === 401) {
      // The token ran out early: one new one, one more try.
      this.access = null
      reply = await send()
    }
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(reply.text) as Record<string, unknown>
    } catch {
      // No body (a delete), or not JSON.
    }
    return { status: reply.status, json }
  }

  /** The calendar sel made, made now when there is none (or it was deleted in Google). */
  private async calendar(): Promise<string> {
    const { store } = this.deps
    const known = store.read().calendarId
    if (known) {
      if (this.calendarSeen) return known
      const reply = await this.call('GET', `/calendars/${encodeURIComponent(known)}`)
      if (reply.status === 200) {
        this.calendarSeen = true
        return known
      }
      if (reply.status !== 404 && reply.status !== 410) throw new Error(`Google Calendar answered ${reply.status}.`)
    }
    const made = await this.call('POST', '/calendars', {
      summary: GOOGLE_CALENDAR_NAME,
      description: 'Your tasks from sel. sel keeps this calendar: what you change here does not go back to it.',
      timeZone: this.deps.timeZone()
    })
    const id = made.json['id']
    if (made.status !== 200 || typeof id !== 'string') throw new Error(`Google Calendar answered ${made.status}.`)
    // A new calendar is empty: whatever was in the one before is not in it.
    store.write({ calendarId: id, pushed: {} })
    this.calendarSeen = true
    return id
  }

  private async put(calendar: string, event: GoogleEvent): Promise<void> {
    const at = `/calendars/${encodeURIComponent(calendar)}/events`
    let reply = await this.call('PUT', `${at}/${event.id}`, event.body)
    if (reply.status === 404) {
      reply = await this.call('POST', at, { ...event.body, id: event.id })
      // Made meanwhile by another computer of the user's: it is there, so it is changed.
      if (reply.status === 409) reply = await this.call('PUT', `${at}/${event.id}`, event.body)
    }
    if (reply.status === 404) {
      // Not the event: the calendar. It is made again the next time.
      this.calendarSeen = false
      this.deps.store.write({ calendarId: null, pushed: {} })
      throw new Error('Google Calendar answered 404.')
    }
    if (reply.status !== 200) throw new Error(`Google Calendar answered ${reply.status}.`)
  }

  private async syncOnce(): Promise<void> {
    const { store } = this.deps
    if (!store.available() || !store.read().refreshToken) return
    try {
      const zone = this.deps.timeZone()
      const wanted = new Map<string, GoogleEvent>()
      for (const task of this.deps.tasks()) {
        const event = eventOf(task, zone)
        if (event) wanted.set(event.id, event)
      }
      const pushed = { ...store.read().pushed }
      const changed = [...wanted.values()].filter((event) => pushed[event.id] !== event.mark)
      const gone = Object.keys(pushed).filter((id) => !wanted.has(id))
      // Nothing to say: Google is not asked anything.
      if (!changed.length && !gone.length) {
        this.error = null
        return
      }
      const calendar = await this.calendar()
      // The calendar may have been made again just now: what was thought to be in it is not.
      const now = { ...store.read().pushed }
      let left = MAX_CHANGES
      try {
        for (const event of [...wanted.values()].filter((each) => now[each.id] !== each.mark)) {
          if (left-- <= 0) break
          await this.put(calendar, event)
          now[event.id] = event.mark
        }
        for (const id of Object.keys(now).filter((each) => !wanted.has(each))) {
          if (left-- <= 0) break
          const reply = await this.call('DELETE', `/calendars/${encodeURIComponent(calendar)}/events/${id}`)
          if (reply.status !== 204 && reply.status !== 200 && reply.status !== 404 && reply.status !== 410)
            throw new Error(`Google Calendar answered ${reply.status}.`)
          delete now[id]
        }
      } finally {
        // What did go through is kept, so that it is not sent again.
        if (store.read().calendarId === calendar) store.write({ pushed: now, lastSync: this.deps.now() })
      }
      this.error = null
    } catch (error) {
      if (error instanceof SignedOutError) {
        store.write({ refreshToken: null })
        this.access = null
      }
      this.deps.log('the calendar could not be brought up to date', error instanceof Error ? error.message : error)
      this.error = words(error)
    }
  }
}
