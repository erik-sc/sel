/**
 * Who signed in, asked of GitHub with the device flow (as `gh auth login` does): the login half of
 * the remote connector's authorization (./server.ts). sel's own OAuth App, so the user creates
 * nothing on GitHub: sel asks GitHub for a short code, the user enters it on github.com/login/device
 * and clicks Authorize, and sel, polling, learns whose account it was. No callback address (every
 * install has its own tunnel) and no client secret (nothing to keep inside the app). sel asks for
 * no GitHub scope: only who the account is, and it forgets GitHub's token at once.
 */

export type Fetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/**
 * The client id of sel's OAuth App on GitHub, with "Enable Device Flow" on. Public by design: the
 * device flow takes no secret. Settings may name another app's (`mcp.remote.githubClientId`).
 */
export const SEL_GITHUB_CLIENT_ID = ''

const DEVICE_CODE = 'https://github.com/login/device/code'
const TOKEN = 'https://github.com/login/oauth/access_token'
const USER = 'https://api.github.com/user'
const TIMEOUT_MS = 8000
const HEADERS = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'sel' }

export interface DeviceCode {
  /** Kept by sel, never shown. */
  deviceCode: string
  /** What the user types on GitHub, such as `ABCD-1234`. */
  userCode: string
  verificationUri: string
  expiresAt: number
  /** Seconds between polls, as GitHub asks. */
  interval: number
}

const field = (value: Record<string, unknown> | null, key: string): string | null =>
  value && typeof value[key] === 'string' ? (value[key] as string) : null

/** Asks GitHub for a device code. Throws with a message the page may show. */
export async function startDeviceFlow(clientId: string, fetch: Fetch, now: number): Promise<DeviceCode> {
  const reply = await fetch(DEVICE_CODE, {
    method: 'POST',
    headers: HEADERS,
    body: new URLSearchParams({ client_id: clientId, scope: '' }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const body = (await reply.json().catch(() => null)) as Record<string, unknown> | null
  const deviceCode = field(body, 'device_code')
  const userCode = field(body, 'user_code')
  const uri = field(body, 'verification_uri')
  if (!reply.ok || !deviceCode || !userCode || !uri) {
    const reason = field(body, 'error') ?? `HTTP ${reply.status}`
    throw new Error(
      reason === 'device_flow_disabled'
        ? 'Device Flow is off for the GitHub app sel uses. Turn on "Enable Device Flow" in its settings on GitHub.'
        : `GitHub did not start the sign-in (${reason}).`
    )
  }
  const expires = typeof body?.['expires_in'] === 'number' ? body['expires_in'] : 900
  const interval = typeof body?.['interval'] === 'number' ? body['interval'] : 5
  return { deviceCode, userCode, verificationUri: uri, expiresAt: now + expires * 1000, interval }
}

export type DevicePoll =
  | { status: 'pending'; interval?: number }
  | { status: 'done'; login: string; id: number }
  | { status: 'failed'; message: string }

/** Asks GitHub once whether the user entered the code; when they did, whose account it was. */
export async function pollDeviceFlow(clientId: string, deviceCode: string, fetch: Fetch): Promise<DevicePoll> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const reply = await fetch(TOKEN, {
    method: 'POST',
    headers: HEADERS,
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    }).toString(),
    signal
  })
  const body = (await reply.json().catch(() => null)) as Record<string, unknown> | null
  const access = field(body, 'access_token')
  if (!access) {
    const error = field(body, 'error')
    if (error === 'authorization_pending') return { status: 'pending' }
    if (error === 'slow_down') return { status: 'pending', interval: typeof body?.['interval'] === 'number' ? body['interval'] : 10 }
    if (error === 'access_denied') return { status: 'failed', message: 'The sign-in was cancelled on GitHub.' }
    if (error === 'expired_token') return { status: 'failed', message: 'The code expired. Start again from Claude.' }
    return { status: 'failed', message: `GitHub did not accept the sign-in (${error ?? `HTTP ${reply.status}`}).` }
  }
  const userReply = await fetch(USER, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${access}`, 'User-Agent': 'sel' },
    signal
  })
  const user = (await userReply.json().catch(() => null)) as Record<string, unknown> | null
  const login = field(user, 'login')
  const id = user && typeof user['id'] === 'number' ? user['id'] : null
  if (!userReply.ok || !login || id === null) return { status: 'failed', message: 'GitHub did not say who signed in.' }
  return { status: 'done', login, id }
}
