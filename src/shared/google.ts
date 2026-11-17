/**
 * The tasks in the user's own Google Calendar: sel signs in to Google and keeps a calendar of its
 * own there ("sel"), with an event for each open task that has a date. One way: what is changed
 * in Google does not come back.
 *
 * Signing in needs an OAuth client of Google's, which belongs to whoever runs the app: the user
 * makes one in Google Cloud and gives sel its id and secret (docs/google-calendar.md). The one
 * permission asked for is `calendar.app.created`: sel makes a calendar and works only in the
 * calendars it made, and sees no other.
 *
 * Pure: no Electron, Node or React.
 */
import type { InvokeChannels } from './ipc'

/** "Make secondary Google calendars, and see, create, change, and delete events on them." */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'

/** The calendar sel makes in the account. */
export const GOOGLE_CALENDAR_NAME = 'sel'

const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/u

/** A client id as Google gives it, or null. */
export function cleanGoogleClientId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id.length <= 200 && CLIENT_ID_RE.test(id) ? id : null
}

/** A client secret: one word, of a length that reads as one. Null otherwise. */
export function cleanGoogleClientSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const secret = value.trim()
  return secret.length >= 8 && secret.length <= 200 && /^[\x21-\x7e]+$/u.test(secret) ? secret : null
}

export interface GoogleStatus {
  /** False where the computer has no secure storage: nothing can be kept, so nothing is offered. */
  available: boolean
  /** The client id in use. The secret never leaves the main process. */
  clientId: string | null
  signedIn: boolean
  /** A sign-in is waiting for the browser. */
  signingIn: boolean
  /** The last time the calendar was brought up to date, in milliseconds. */
  lastSync: number | null
  /** How many tasks are in the calendar. */
  events: number
  /** What went wrong the last time, in words for the user. */
  error: string | null
}

export interface GoogleApi {
  status(): Promise<GoogleStatus>
  /** Keeps the OAuth client. Changing it signs out. */
  configure(clientId: string, clientSecret: string): Promise<GoogleStatus>
  /** Opens the browser to sign in, and settles when it is done, refused or given up on. */
  signIn(): Promise<GoogleStatus>
  /** Forgets the sign-in. The calendar stays in Google as it is. */
  signOut(): Promise<GoogleStatus>
  /** Brings the calendar up to date now. */
  sync(): Promise<GoogleStatus>
}

/** The invoke channels of `api.google` (see `INVOKE` in ./api.ts). */
export const GOOGLE_INVOKE = {
  'google:status': true,
  'google:configure': true,
  'google:signIn': true,
  'google:signOut': true,
  'google:sync': true
} as const satisfies Record<InvokeChannels<{ google: GoogleApi }>, true>
