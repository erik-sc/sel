/**
 * Who signed in, asked of GitHub: the login half of the remote connector's authorization
 * (./server.ts). The user's own OAuth App; sel sends the browser to GitHub, gets a code back on
 * its callback, trades it for a GitHub token, asks GitHub whose it is, and forgets the token.
 * sel asks for no GitHub scope: only who the account is, never anything in it.
 */

export type Fetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export interface GitHubApp {
  clientId: string
  clientSecret: string
}

const AUTHORIZE = 'https://github.com/login/oauth/authorize'
const TOKEN = 'https://github.com/login/oauth/access_token'
const USER = 'https://api.github.com/user'
const TIMEOUT_MS = 8000

/** Where the browser goes to sign in on GitHub. `allow_signup=false`: there is nothing to sign up for. */
export function githubAuthorizeUrl(app: Pick<GitHubApp, 'clientId'>, callback: string, state: string): string {
  const url = new URL(AUTHORIZE)
  url.searchParams.set('client_id', app.clientId)
  url.searchParams.set('redirect_uri', callback)
  url.searchParams.set('state', state)
  url.searchParams.set('allow_signup', 'false')
  return url.toString()
}

/** The GitHub login the code belongs to. Throws with a message the page may show. */
export async function githubLogin(app: GitHubApp, callback: string, code: string, fetch: Fetch): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const tokenReply = await fetch(TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'sel' },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: callback }).toString(),
    signal
  })
  const token = (await tokenReply.json().catch(() => null)) as Record<string, unknown> | null
  const access = token && typeof token['access_token'] === 'string' ? token['access_token'] : null
  if (!tokenReply.ok || !access) {
    const reason = token && typeof token['error'] === 'string' ? token['error'] : `HTTP ${tokenReply.status}`
    throw new Error(`GitHub did not accept the sign-in (${reason}). Check the client id and secret in sel's Settings → MCP.`)
  }
  const userReply = await fetch(USER, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${access}`, 'User-Agent': 'sel' },
    signal
  })
  const user = (await userReply.json().catch(() => null)) as Record<string, unknown> | null
  const login = user && typeof user['login'] === 'string' ? user['login'] : null
  if (!userReply.ok || !login) throw new Error('GitHub did not say who signed in.')
  return login
}
