import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { REMOTE_SCOPES, type McpCall, type RemoteConfig, type RemoteGrant, type RemoteScope } from '../../shared/mcp'
import type { ToolSpec } from '../ai/toolspecs'
import { ToolError } from '../ai/tools'
import { type AuthStore, cleanScopes, OAuthError, type Pending, redirectMatches } from './auth'
import { type DeviceCode, type DevicePoll, type Fetch, pollDeviceFlow, SEL_GITHUB_CLIENT_ID, startDeviceFlow } from './github'

/**
 * The remote connector's server: OAuth 2.1 (as Claude's custom connectors expect it) and MCP
 * over Streamable HTTP, on 127.0.0.1 only. A tunnel the user runs gives it a public https
 * address; the Claude servers call that address, never this computer directly.
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]  where to authorize (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server      the endpoints below (RFC 8414)
 *   POST /register                                    dynamic client registration (RFC 7591)
 *   GET  /authorize                                   → GitHub's sign-in
 *   GET  /oauth/callback                              ← GitHub; the consent screen
 *   POST /oauth/consent                               approve or deny → back to Claude with a code
 *   POST /token                                       code (PKCE S256) or refresh token → tokens
 *   POST /revoke                                      ends the grant of a token (RFC 7009)
 *   POST /mcp                                         JSON-RPC: initialize, tools/list, tools/call
 *
 * Only the GitHub login named in Settings gets past the callback; everyone else sees a refusal.
 * Answers to /mcp are plain JSON (no SSE stream): every tool answers at once.
 */

export interface RemoteServerOptions {
  /** The settings now: read on every request, so a change applies without a restart. */
  config(): RemoteConfig
  auth: AuthStore
  /** The tools a grant with these scopes is offered. */
  tools(scopes: readonly RemoteScope[]): readonly ToolSpec[]
  /** Runs a tool already checked against the grant's scopes. Throws a ToolError, or an Error whose message may be shown. */
  run(name: string, args: unknown): string
  /** After every tool call: what it changed goes to the windows and to sync. */
  changed(): void
  fetch: Fetch
  now?: () => number
  /** Calls answered in any minute; the OAuth endpoints get a quarter of it. */
  perMinute?: number
}

const MAX_BODY = 1024 * 1024
const CALL_LOG_SIZE = 30
/** One cookie per sign-in in flight (`sel_flow_<id>`), so two at once do not undo each other. */
const COOKIE = 'sel_flow_'
/** The MCP versions sel answers in, the newest first. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INSTRUCTIONS =
  "The user's sel workspace, on their own computer: their tasks (list, add with quick-add words, complete, reschedule) and, depending on what they granted, their pages and databases (search, read, create pages, append, add or update rows). Nothing can be deleted, and what the user keeps private from the AI can be neither read nor changed. Ids are shown in square brackets after titles."

type Json = Record<string, unknown>

const escape = (text: string): string =>
  text.replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const SCOPE_TEXT: Record<RemoteScope, string> = {
  read: 'Search and read your pages, databases and tasks',
  tasks: 'Add tasks, complete them and change their dates',
  write: 'Create pages, add to pages, add and change database rows'
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · sel</title><style>
:root{color-scheme:light dark;--bg:#fbfaf8;--fg:#1f1d1a;--muted:#6b665e;--line:#e4e0d8;--accent:#2f6f5e}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#ece8e1;--muted:#a39d93;--line:#34312c;--accent:#7cc4ad}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:440px;margin:0 auto;padding:40px 16px}h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:0 0 16px}
label{display:flex;gap:10px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}label:last-of-type{border-bottom:1px solid var(--line)}
.row{display:flex;gap:12px;margin-top:24px}button{flex:1;font:inherit;padding:12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--fg)}
a.go{flex:1;display:block;text-align:center;text-decoration:none;padding:12px;border-radius:10px;background:var(--accent);color:var(--bg);font-weight:600}.code{font:600 32px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:4px;color:var(--fg);text-align:center;user-select:all;margin:24px 0}.small{font-size:14px}
button.go{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:600}code{font-size:14px}
</style></head><body><main>${body}</main></body></html>`
}

function devicePage(flow: string, device: DeviceCode): string {
  return page(
    'Sign in with GitHub',
    `<h1>Sign in with GitHub</h1>
<p>Open GitHub, enter this code and choose Authorize. This page goes on by itself once you have.</p>
<p class="code">${escape(device.userCode)}</p>
<div class="row"><a class="go" href="${escape(device.verificationUri)}" target="_blank" rel="noopener noreferrer">Open GitHub</a></div>
<p class="small">GitHub only tells sel who you are; sel gets no access to your GitHub account. Waiting… <a href="/oauth/device?flow=${escape(encodeURIComponent(flow))}">Check now</a></p>`
  )
}

function consentPage(input: {
  flow: string
  client: string
  redirectHost: string
  login: string
  scopes: RemoteScope[]
  registered: number
}): string {
  const boxes = REMOTE_SCOPES.map(
    (scope) =>
      `<label><input type="checkbox" name="scope" value="${scope}"${input.scopes.includes(scope) ? ' checked' : ''}><span>${escape(SCOPE_TEXT[scope])}</span></label>`
  ).join('')
  return page(
    'Allow access',
    `<h1>Let ${escape(input.client)} use sel?</h1>
<p>Signed in on GitHub as <b>${escape(input.login)}</b>. It will be sent back to <code>${escape(input.redirectHost)}</code>. This app was connected to sel on ${escape(new Date(input.registered).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}: if you did not just add it, choose Deny. Nothing can be deleted, and what you keep private from the AI stays out. You can end this any time in sel → Settings → MCP.</p>
<form method="post" action="/oauth/consent"><input type="hidden" name="flow" value="${escape(input.flow)}">${boxes}
<div class="row"><button type="submit" name="decision" value="deny">Deny</button><button class="go" type="submit" name="decision" value="allow">Allow</button></div></form>`
  )
}

const errorPage = (title: string, text: string): string => page(title, `<h1>${escape(title)}</h1><p>${escape(text)}</p>`)

function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return null
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    // Past the limit the rest is read and dropped, so the 413 still reaches the client.
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY) chunks.push(chunk)
    })
    req.on('end', () => (size > MAX_BODY ? reject(new HttpError(413, 'Too large.')) : resolve(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', reject)
  })
}

/** A form or JSON body as fields (repeated form fields as lists). */
function fieldsOf(req: IncomingMessage, body: string): Record<string, string | string[]> {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (type === 'application/json') {
    try {
      const value: unknown = JSON.parse(body)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
      const out: Record<string, string | string[]> = {}
      for (const [key, each] of Object.entries(value)) if (typeof each === 'string') out[key] = each
      return out
    } catch {
      return {}
    }
  }
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of new URLSearchParams(body)) {
    const before = out[key]
    out[key] = before === undefined ? value : Array.isArray(before) ? [...before, value] : [before, value]
  }
  return out
}

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''))
const many = (value: string | string[] | undefined): string[] => (Array.isArray(value) ? value : value ? [value] : [])

/** A message a client may read: a tool's refusal or the repository's; anything from the OS or SQLite (they carry a `code`) is not. */
function readable(err: unknown): string | null {
  if (err instanceof ToolError) return err.message
  if (err instanceof Error && !('code' in err) && err.message) return err.message.slice(0, 300)
  return null
}

export class RemoteServer {
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()
  private log: McpCall[] = []
  private recent: number[] = []
  private recentAuth: number[] = []
  private recentToken: number[] = []
  private readonly now: () => number
  private readonly perMinute: number
  error: string | null = null
  port: number | null = null

  constructor(private readonly options: RemoteServerOptions) {
    this.now = options.now ?? Date.now
    this.perMinute = options.perMinute ?? 120
  }

  get running(): boolean {
    return this.server !== null
  }

  get calls(): McpCall[] {
    return [...this.log].reverse()
  }

  /** The address the Claude servers know sel by: the public one, else this computer's (for a local test). */
  base(): string {
    const config = this.options.config()
    return config.publicUrl || `http://127.0.0.1:${this.port ?? config.port}`
  }

  async start(port: number): Promise<void> {
    if (this.server) return
    this.error = null
    try {
      this.server = await new Promise<Server>((resolve, reject) => {
        const server = createServer((req, res) => void this.handle(req, res))
        server.on('connection', (socket) => {
          this.sockets.add(socket)
          socket.on('close', () => this.sockets.delete(socket))
        })
        server.requestTimeout = 15_000
        server.headersTimeout = 10_000
        server.once('error', reject)
        // This computer only: the tunnel connects from here.
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject)
          server.on('error', (err) => console.error('[remote] the server failed', err))
          resolve(server)
        })
      })
      const address = this.server.address()
      this.port = typeof address === 'object' && address ? address.port : port
    } catch (err) {
      this.error =
        (err as { code?: string }).code === 'EADDRINUSE'
          ? `Port ${port} is taken by another program. Choose another one.`
          : 'The server could not be started.'
      throw err
    }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = null
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  // ---- plumbing ----

  private send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...headers
    })
    res.end(body)
  }

  private json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
    this.send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json', ...headers })
  }

  private html(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    this.send(res, status, body, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      'X-Frame-Options': 'DENY',
      ...headers
    })
  }

  private redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
    this.send(res, 302, '', { Location: location, ...headers })
  }

  /**
   * Calls in the last minute, per bucket: tools, /token (refreshes must get through) and the rest
   * of the sign-in. Behind a tunnel every caller looks like 127.0.0.1, so the buckets are global.
   */
  private limited(bucket: 'mcp' | 'token' | 'auth'): boolean {
    const now = this.now()
    const lists = { mcp: this.recent, token: this.recentToken, auth: this.recentAuth }
    const list = lists[bucket].filter((at) => now - at < 60_000)
    const max =
      bucket === 'mcp'
        ? this.perMinute
        : bucket === 'token'
          ? Math.max(20, Math.floor(this.perMinute / 2))
          : Math.max(10, Math.floor(this.perMinute / 4))
    if (bucket === 'mcp') this.recent = list
    else if (bucket === 'token') this.recentToken = list
    else this.recentAuth = list
    if (list.length >= max) return true
    list.push(now)
    return false
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const method = req.method ?? 'GET'
      const path = url.pathname
      if (path === '/mcp') return await this.mcp(req, res, method)
      if (method === 'GET' && (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp'))
        return this.json(res, 200, this.resourceMetadata())
      if (method === 'GET' && path === '/.well-known/oauth-authorization-server') return this.json(res, 200, this.serverMetadata())
      if (method === 'GET' && path === '/')
        return this.html(res, 200, errorPage('sel', 'This is the sel connector. Add its /mcp address to Claude.'))
      const route = `${method} ${path}`
      const routes = ['POST /register', 'GET /authorize', 'GET /oauth/device', 'POST /oauth/consent', 'POST /token', 'POST /revoke']
      if (!routes.includes(route)) return this.json(res, 404, { error: 'not_found' })
      // The waiting page reloads itself: it counts with /token, not with the rest of the sign-in.
      if (this.limited(route === 'POST /token' || route === 'GET /oauth/device' ? 'token' : 'auth'))
        return this.json(res, 429, { error: 'slow_down', error_description: 'Too many requests.' })
      if (method === 'POST' && path === '/register') return await this.register(req, res)
      if (method === 'GET' && path === '/authorize') return await this.authorize(url, res)
      if (method === 'GET' && path === '/oauth/device') return await this.device(url, req, res)
      if (method === 'POST' && path === '/oauth/consent') return await this.consent(req, res)
      if (method === 'POST' && path === '/token') return await this.token(req, res)
      return await this.revoke(req, res)
    } catch (err) {
      if (err instanceof HttpError) return this.json(res, err.status, { error: err.message })
      console.error('[remote] a request failed', err)
      if (!res.headersSent) this.json(res, 500, { error: 'server_error' })
    }
  }

  // ---- discovery ----

  private resourceMetadata(): Json {
    const base = this.base()
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: [...REMOTE_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'sel'
    }
  }

  private serverMetadata(): Json {
    const base = this.base()
    return {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      revocation_endpoint: `${base}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...REMOTE_SCOPES, 'offline_access'],
      authorization_response_iss_parameter_supported: true
    }
  }

  // ---- OAuth ----

  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let metadata: unknown
    try {
      metadata = JSON.parse(await readBody(req))
    } catch {
      return this.json(res, 400, { error: 'invalid_client_metadata', error_description: 'The body must be JSON.' })
    }
    try {
      const client = this.options.auth.register(metadata)
      this.json(res, 201, {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_id_issued_at: Math.floor(client.createdAt / 1000)
      })
    } catch (err) {
      if (err instanceof OAuthError)
        return this.json(res, err.code === 'access_denied' ? 403 : 400, { error: err.code, error_description: err.message })
      throw err
    }
  }

  private clientId(): string {
    return this.options.config().githubClientId || SEL_GITHUB_CLIENT_ID
  }

  private async authorize(url: URL, res: ServerResponse): Promise<void> {
    const q = url.searchParams
    const auth = this.options.auth
    const client = auth.client(q.get('client_id'))
    const redirectUri = q.get('redirect_uri') ?? ''
    // Without a known client and one of its redirects, nothing may be sent anywhere: say it here.
    if (!client)
      return this.html(
        res,
        400,
        errorPage('Unknown app', 'This app is not registered with sel. Remove the connector in Claude and add it again.')
      )
    if (!redirectMatches(client.redirectUris, redirectUri))
      return this.html(res, 400, errorPage('Wrong return address', 'The app asked to be sent back somewhere it did not register.'))
    const back = (error: string, description: string): void => {
      const target = new URL(redirectUri)
      target.searchParams.set('error', error)
      target.searchParams.set('error_description', description)
      const state = q.get('state')
      if (state) target.searchParams.set('state', state)
      target.searchParams.set('iss', this.base())
      this.redirect(res, target.toString())
    }
    if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code.')
    const challenge = q.get('code_challenge') ?? ''
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/u.test(challenge))
      return back('invalid_request', 'PKCE with S256 is required.')
    const resource = q.get('resource')
    if (resource && resource.replace(/\/+$/u, '') !== `${this.base()}/mcp`)
      return back('invalid_target', 'That resource is not this server.')
    const clientId = this.clientId()
    if (!clientId) return this.html(res, 503, errorPage('sel is not set up yet', 'This build of sel has no GitHub app to sign in with.'))
    const asked = cleanScopes(q.get('scope'))
    let device: DeviceCode
    try {
      device = await startDeviceFlow(clientId, this.options.fetch, this.now())
    } catch (err) {
      return this.html(res, 502, errorPage('GitHub sign-in failed', err instanceof Error ? err.message : 'Try again.'))
    }
    const pending = auth.begin({
      clientId: client.id,
      redirectUri,
      state: q.get('state'),
      challenge,
      // Nothing asked: reading and tasks, which is what the phone is for. Writing pages is opt-in.
      scopes: asked.length ? asked : ['read', 'tasks']
    })
    pending.device = device
    pending.nextPollAt = this.now() + device.interval * 1000
    const secure = this.base().startsWith('https:') ? '; Secure' : ''
    this.redirect(res, `${this.base()}/oauth/device?flow=${encodeURIComponent(pending.id)}`, {
      'Set-Cookie': `${COOKIE}${pending.id}=${pending.nonce}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`
    })
  }

  /** Back to the app with an error, ending the sign-in. */
  private refuse(res: ServerResponse, pending: Pending, error: string): void {
    this.options.auth.end(pending.id)
    const target = new URL(pending.redirectUri)
    target.searchParams.set('error', error)
    if (pending.state) target.searchParams.set('state', pending.state)
    target.searchParams.set('iss', this.base())
    this.redirect(res, target.toString(), { 'Set-Cookie': `${COOKIE}${pending.id}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` })
  }

  private showConsent(res: ServerResponse, pending: Pending): void {
    const client = this.options.auth.client(pending.clientId)
    this.html(
      res,
      200,
      consentPage({
        flow: pending.id,
        client: client?.name ?? 'An app',
        redirectHost: new URL(pending.redirectUri).host,
        login: pending.login ?? '',
        scopes: pending.scopes,
        registered: client?.createdAt ?? this.now()
      })
    )
  }

  /**
   * The page that shows the GitHub code and waits: it reloads itself every few seconds, and each
   * load asks GitHub at most as often as GitHub allows. Once the code is entered, the consent screen.
   */
  private async device(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = this.options.auth
    const flow = url.searchParams.get('flow') ?? ''
    const pending = auth.flow(flow, cookieOf(req, `${COOKIE}${flow}`))
    if (!pending || !pending.device) return this.html(res, 400, errorPage('This sign-in expired', 'Start again from Claude.'))
    if (pending.login) return this.showConsent(res, pending)
    const device = pending.device
    if (this.now() >= device.expiresAt) return this.refuse(res, pending, 'access_denied')
    if (this.now() >= (pending.nextPollAt ?? 0)) {
      let poll: DevicePoll
      try {
        poll = await pollDeviceFlow(this.clientId(), device.deviceCode, this.options.fetch)
      } catch {
        poll = { status: 'pending' }
      }
      if (poll.status === 'pending' && poll.interval) device.interval = poll.interval
      pending.nextPollAt = this.now() + device.interval * 1000
      if (poll.status === 'failed') {
        auth.end(pending.id)
        return this.html(res, 400, errorPage('GitHub sign-in failed', poll.message))
      }
      if (poll.status === 'done') {
        if (!auth.isOwner(poll.login, poll.id, this.options.config().githubLogin)) {
          auth.end(pending.id)
          return this.html(
            res,
            403,
            errorPage(
              'Not allowed',
              `The GitHub account ${poll.login} is not the one this sel lets in. To let a new account in, end every connection in sel → Settings → MCP and connect again.`
            )
          )
        }
        pending.login = poll.login
        return this.showConsent(res, pending)
      }
    }
    this.html(res, 200, devicePage(pending.id, device), { Refresh: String(Math.max(3, device.interval)) })
  }

  private async consent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = this.options.auth
    const fields = fieldsOf(req, await readBody(req))
    const flow = one(fields['flow'])
    const pending = auth.flow(flow, cookieOf(req, `${COOKIE}${flow}`))
    if (!pending || !pending.login) return this.html(res, 400, errorPage('This sign-in expired', 'Start again from Claude.'))
    const clear = { 'Set-Cookie': `${COOKIE}${pending.id}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }
    const target = new URL(pending.redirectUri)
    if (pending.state) target.searchParams.set('state', pending.state)
    target.searchParams.set('iss', this.base())
    const scopes = cleanScopes(many(fields['scope']).join(' '))
    if (one(fields['decision']) !== 'allow' || !scopes.length) {
      auth.end(pending.id)
      target.searchParams.set('error', 'access_denied')
      return this.redirect(res, target.toString(), clear)
    }
    target.searchParams.set('code', auth.approve(pending, scopes))
    this.redirect(res, target.toString(), clear)
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const fields = fieldsOf(req, await readBody(req))
    const auth = this.options.auth
    const clientId = one(fields['client_id'])
    try {
      if (!auth.client(clientId)) {
        return this.json(res, 401, { error: 'invalid_client', error_description: 'Unknown client.' })
      }
      const grantType = one(fields['grant_type'])
      if (grantType === 'authorization_code') {
        const tokens = auth.exchange({
          code: one(fields['code']),
          clientId,
          redirectUri: one(fields['redirect_uri']),
          verifier: one(fields['code_verifier'])
        })
        return this.json(res, 200, tokens, { Pragma: 'no-cache' })
      }
      if (grantType === 'refresh_token')
        return this.json(res, 200, auth.refresh({ token: one(fields['refresh_token']), clientId }), { Pragma: 'no-cache' })
      this.json(res, 400, { error: 'unsupported_grant_type' })
    } catch (err) {
      if (err instanceof OAuthError) return this.json(res, 400, { error: err.code, error_description: err.message })
      throw err
    }
  }

  private async revoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const fields = fieldsOf(req, await readBody(req))
    const token = one(fields['token'])
    if (token) this.options.auth.revokeToken(token)
    this.send(res, 200, '')
  }

  // ---- MCP ----

  private unauthorized(res: ServerResponse, invalid: boolean): void {
    const metadata = `${this.base()}/.well-known/oauth-protected-resource/mcp`
    const error = invalid ? ', error="invalid_token"' : ''
    this.json(
      res,
      401,
      { error: invalid ? 'invalid_token' : 'unauthorized' },
      { 'WWW-Authenticate': `Bearer resource_metadata="${metadata}"${error}` }
    )
  }

  private async mcp(req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
    if (method !== 'POST') return this.send(res, 405, '', { Allow: 'POST' })
    const header = req.headers.authorization ?? ''
    const token = /^Bearer\s+(\S+)$/iu.exec(header)?.[1]
    if (!token) return this.unauthorized(res, false)
    const grant = this.options.auth.authenticate(token)
    if (!grant) return this.unauthorized(res, true)
    if (this.limited('mcp'))
      return this.json(res, 429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many calls. Wait a moment.' } })
    let message: unknown
    try {
      message = JSON.parse(await readBody(req))
    } catch {
      return this.json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message))
      return this.json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } })
    const record = message as Json
    // A notification or a response from the client: accepted, nothing to answer.
    if (record['id'] === undefined || record['id'] === null) return this.send(res, 202, '')
    const reply = this.rpc(record, grant)
    this.json(res, 200, { jsonrpc: '2.0', id: record['id'], ...reply })
  }

  private rpc(message: Json, grant: RemoteGrant): Json {
    const params = (message['params'] ?? {}) as Json
    switch (message['method']) {
      case 'initialize':
        return {
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(params['protocolVersion'] as string)
              ? params['protocolVersion']
              : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'sel', version: '1' },
            instructions: SERVER_INSTRUCTIONS
          }
        }
      case 'ping':
        return { result: {} }
      case 'tools/list':
        return { result: { tools: this.options.tools(grant.scopes) } }
      case 'tools/call': {
        const name = typeof params['name'] === 'string' ? params['name'] : ''
        const offered = this.options.tools(grant.scopes).some((tool) => tool.name === name)
        let text: string
        let ok = false
        if (!offered)
          text = `The tool ${name || '(none)'} is not available to this connection. Its access can be changed by connecting again.`
        else {
          try {
            text = this.options.run(name, params['arguments'] ?? {})
            ok = true
          } catch (err) {
            const shown = readable(err)
            if (shown === null) console.error('[remote] a tool failed', err)
            text = shown ?? 'That could not be done.'
          } finally {
            try {
              this.options.changed()
            } catch (err) {
              console.error('[remote] the windows could not be told about a change', err)
            }
          }
        }
        this.log.push({ tool: name.slice(0, 40) || 'unknown', at: this.now(), ok })
        if (this.log.length > CALL_LOG_SIZE) this.log.splice(0, this.log.length - CALL_LOG_SIZE)
        return { result: { content: [{ type: 'text', text }], isError: !ok } }
      }
      default:
        return { error: { code: -32601, message: 'Method not found' } }
    }
  }
}
