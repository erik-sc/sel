// Signing in to Google as a desktop app (RFC 8252): the browser, a loopback address to come back
// to, and PKCE. Electron-free: the network is passed in.
import { createHash, randomBytes } from 'node:crypto'
import { GOOGLE_SCOPE } from '../../shared/google'

export type Fetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export interface Client {
  id: string
  secret: string
}

export interface Tokens {
  access: string
  /** When the access token stops working, in milliseconds. */
  expiresAt: number
  /** Given at sign-in; a refresh keeps the one there is. */
  refresh: string | null
}

/** Google no longer takes the sign-in: it was withdrawn in the account, or it ran out. */
export class SignedOutError extends Error {
  constructor() {
    super('Google no longer accepts this sign-in.')
  }
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url')

/** A secret for one sign-in and what Google is shown of it. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export const newState = (): string => base64url(randomBytes(24))

/** Where the browser is sent to sign in. */
export function authUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    // A refresh token, so that sel stays signed in; consent asked each time, so that one is always given.
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${AUTH_URL}?${query.toString()}`
}

async function token(fetch: Fetch, form: Record<string, string>, now: number): Promise<Tokens> {
  const reply = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const text = await reply.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    // Not JSON: an error page. The status says enough.
  }
  if (!reply.ok) {
    if (body['error'] === 'invalid_grant') throw new SignedOutError()
    // Google's own words for what is wrong with the client (never the secret, which it does not echo).
    const why =
      typeof body['error_description'] === 'string' ? body['error_description'] : typeof body['error'] === 'string' ? body['error'] : ''
    throw new Error(`Google refused (${reply.status})${why ? `: ${why.slice(0, 200)}` : ''}`)
  }
  const access = body['access_token']
  if (typeof access !== 'string' || !access) throw new Error('Google answered without a token.')
  const seconds = typeof body['expires_in'] === 'number' && body['expires_in'] > 0 ? body['expires_in'] : 3600
  const refresh = body['refresh_token']
  return { access, expiresAt: now + seconds * 1000, refresh: typeof refresh === 'string' && refresh ? refresh : null }
}

/** The code the browser came back with, for tokens. */
export function exchange(
  fetch: Fetch,
  client: Client,
  input: { code: string; verifier: string; redirectUri: string },
  now: number
): Promise<Tokens> {
  return token(
    fetch,
    {
      grant_type: 'authorization_code',
      client_id: client.id,
      client_secret: client.secret,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri
    },
    now
  )
}

/** A new access token from the sign-in kept. Throws `SignedOutError` when Google no longer takes it. */
export function refresh(fetch: Fetch, client: Client, refreshToken: string, now: number): Promise<Tokens> {
  return token(fetch, { grant_type: 'refresh_token', client_id: client.id, client_secret: client.secret, refresh_token: refreshToken }, now)
}

/** Tells Google the sign-in is over. Best effort: what is kept here is forgotten either way. */
export async function revoke(fetch: Fetch, refreshToken: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }).toString()
  })
}
