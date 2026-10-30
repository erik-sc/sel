import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { REMOTE_SCOPES, type RemoteGrant, type RemoteScope } from '../../shared/mcp'

/**
 * The OAuth 2.1 state of the remote connector (see ./server.ts): the clients that registered
 * (RFC 7591), the authorizations in flight, the one-time codes, and the grants with their
 * tokens. Electron-free; what is kept between runs goes through `load` and `save` as JSON, in a
 * file of its own next to the database (never in it: the database is synced and exported).
 *
 * No token is kept as given: only its SHA-256. A refresh token is used once; using one again
 * (a copy someone took) ends the whole grant. Codes live a minute and in memory only.
 */

export const ACCESS_TTL_MS = 60 * 60 * 1000
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CODE_TTL_MS = 60 * 1000
const PENDING_TTL_MS = 10 * 60 * 1000
const MAX_CLIENTS = 50
const MAX_PENDING = 50
const MAX_PENDING_PER_CLIENT = 5
/** A refresh retried this soon after it was used (a reply lost on the way) gets a new pair instead of ending the grant. */
const REFRESH_GRACE_MS = 60 * 1000
/** How long the user's "Connect a new app" in Settings lets new apps register. */
export const PAIRING_MS = 10 * 60 * 1000
const MAX_GRANTS = 50

/** Where a Claude app is sent back to: claude.ai's callback, or a loopback port (Claude Code). */
const HOSTED_CALLBACKS = new Set(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'])

export function isLoopback(url: URL): boolean {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
}

/** A redirect a client may register: Claude's own callbacks, or a loopback address. Nothing else gets a code. */
export function allowedRedirect(uri: string): boolean {
  if (HOSTED_CALLBACKS.has(uri)) return true
  try {
    const url = new URL(uri)
    return isLoopback(url) && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}

/** The redirect asked for matches one registered: exactly, or for a loopback one, on any port (RFC 8252 §7.3). */
export function redirectMatches(registered: readonly string[], asked: string): boolean {
  if (registered.includes(asked)) return true
  let url: URL
  try {
    url = new URL(asked)
  } catch {
    return false
  }
  if (!isLoopback(url)) return false
  return registered.some((each) => {
    try {
      const known = new URL(each)
      return isLoopback(known) && known.hostname === url.hostname && known.pathname === url.pathname && known.search === url.search
    } catch {
      return false
    }
  })
}

export const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex')
const secret = (prefix: string): string => `${prefix}_${randomBytes(32).toString('base64url')}`

function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The S256 challenge of a verifier (RFC 7636). */
export const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

export function cleanScopes(text: string | null | undefined): RemoteScope[] {
  const asked = new Set((text ?? '').split(/\s+/u))
  return REMOTE_SCOPES.filter((scope) => asked.has(scope))
}

export interface Client {
  id: string
  name: string
  redirectUris: string[]
  createdAt: number
}

/** An authorization in flight: from /authorize, through the login on GitHub, to the consent screen. */
export interface Pending {
  id: string
  /** Also in a cookie of the browser that started it: the callback and the consent must come from that browser. */
  nonce: string
  clientId: string
  redirectUri: string
  state: string | null
  challenge: string
  scopes: RemoteScope[]
  createdAt: number
  /** The GitHub login, once GitHub said who signed in (and it is the one let in). */
  login: string | null
  /** The GitHub device code being entered, and when GitHub may be asked again. */
  device?: import('./github').DeviceCode | null
  nextPollAt?: number
}

interface Code {
  hash: string
  grantId: string
  clientId: string
  redirectUri: string
  challenge: string
  expiresAt: number
}

interface StoredGrant extends RemoteGrant {
  clientId: string
  accessHash: string | null
  accessExpiresAt: number
  refreshHash: string | null
  refreshExpiresAt: number
  /** Refresh tokens already used: shown again, they end the grant. */
  spent: string[]
  /** The refresh token used last, and when: a retry within the grace gets a new pair. */
  previousRefresh?: { hash: string; spentAt: number } | null
  /** The access token before the latest refresh, still valid until it expires (calls in flight). */
  previousAccess?: { hash: string; expiresAt: number } | null
}

/** The GitHub account let in, pinned by its numeric id at the first sign-in: a login can be renamed and taken. */
interface Owner {
  login: string
  id: number
}

interface Stored {
  version: 1
  clients: Client[]
  grants: StoredGrant[]
  owner?: Owner | null
}

export interface Tokens {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

/** An OAuth error as /token answers it. */
export class OAuthError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'unsupported_grant_type'
      | 'invalid_scope'
      | 'invalid_client_metadata'
      | 'access_denied'
      | 'invalid_redirect_uri',
    message: string
  ) {
    super(message)
  }
}

export interface AuthStoreOptions {
  load(): string | null
  save(text: string): void
  now?: () => number
}

export class AuthStore {
  private clients: Client[] = []
  private grants: StoredGrant[] = []
  private pending: Pending[] = []
  private codes: Code[] = []
  private owner: Owner | null = null
  private pairing = 0
  private readonly now: () => number

  constructor(private readonly options: AuthStoreOptions) {
    this.now = options.now ?? Date.now
    let text: string | null = null
    try {
      text = options.load()
    } catch {
      text = null
    }
    if (!text) return
    try {
      const stored = JSON.parse(text) as Partial<Stored>
      if (stored.version !== 1) return
      this.clients = Array.isArray(stored.clients) ? stored.clients.filter((c) => typeof c?.id === 'string') : []
      this.grants = Array.isArray(stored.grants) ? stored.grants.filter((g) => typeof g?.id === 'string') : []
      const owner = stored.owner
      this.owner = owner && typeof owner.login === 'string' && typeof owner.id === 'number' ? owner : null
    } catch {
      /* unreadable: start over; every app signs in again */
    }
  }

  private persist(): void {
    const stored: Stored = { version: 1, clients: this.clients, grants: this.grants, owner: this.owner }
    this.options.save(JSON.stringify(stored))
  }

  // ---- clients ----

  /**
   * Lets new apps register for a while (Settings → MCP → Connect a new app). Registration is
   * closed otherwise: a stranger who knows the address cannot make an app of their own and send
   * the owner a real consent screen for it.
   */
  openPairing(ms: number = PAIRING_MS): void {
    this.pairing = this.now() + ms
  }

  closePairing(): void {
    this.pairing = 0
  }

  /** Until when new apps may register, or null when they may not. */
  get pairingUntil(): number | null {
    return this.pairing > this.now() ? this.pairing : null
  }

  /**
   * Whether the GitHub account that signed in is the one let in. The first account to sign in
   * while pairing is open becomes the owner, pinned by its numeric id (a login can be renamed and
   * taken); after that, only the owner. `allowed`, when Settings names a login, must match too.
   */
  isOwner(login: string, id: number, allowed = ''): boolean {
    if (allowed && login.toLowerCase() !== allowed.toLowerCase()) return false
    if (this.owner) return this.owner.id === id
    if (!this.pairingUntil) return false
    this.owner = { login, id }
    this.persist()
    return true
  }

  /** The GitHub account let in, once one signed in. */
  get ownerLogin(): string | null {
    return this.owner?.login ?? null
  }

  /** Dynamic client registration: a public client (PKCE, no secret) with Claude's redirects only, while pairing is open. */
  register(metadata: unknown): Client {
    if (!this.pairingUntil)
      throw new OAuthError(
        'access_denied',
        'sel is not accepting new apps. In sel, open Settings → MCP and choose "Connect a new app", then try again.'
      )
    const record =
      metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {}
    const uris = record['redirect_uris']
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((uri) => typeof uri === 'string'))
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must list where to send the user back.')
    if (!uris.every((uri) => allowedRedirect(uri as string)))
      throw new OAuthError('invalid_redirect_uri', 'sel only sends codes back to Claude (claude.ai) or to this computer (localhost).')
    // Whatever method is asked for, a public client is registered (RFC 7591 §3.2.1: the response says so).
    const rawName = typeof record['client_name'] === 'string' ? record['client_name'] : ''
    const name =
      rawName
        .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
        .trim()
        .slice(0, 80) || 'An MCP app'
    const client: Client = { id: randomUUID(), name, redirectUris: [...new Set(uris as string[])], createdAt: this.now() }
    this.clients.push(client)
    // The oldest client no grant uses goes first.
    while (this.clients.length > MAX_CLIENTS) {
      const used = new Set(this.grants.map((grant) => grant.clientId))
      const index = this.clients.findIndex((each) => !used.has(each.id))
      this.clients.splice(index >= 0 ? index : 0, 1)
    }
    this.persist()
    return client
  }

  client(id: string | null | undefined): Client | null {
    return (id && this.clients.find((client) => client.id === id)) || null
  }

  // ---- authorizations in flight ----

  begin(input: Omit<Pending, 'id' | 'nonce' | 'createdAt' | 'login'>): Pending {
    this.sweep()
    const pending: Pending = {
      ...input,
      id: randomBytes(18).toString('base64url'),
      nonce: randomBytes(18).toString('base64url'),
      createdAt: this.now(),
      login: null
    }
    // One app cannot crowd out the others' sign-ins: a few each, the oldest dropped first.
    const own = this.pending.filter((each) => each.clientId === input.clientId)
    if (own.length >= MAX_PENDING_PER_CLIENT) this.end(own[0].id)
    this.pending.push(pending)
    if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING)
    return pending
  }

  /** The authorization `id`, when the browser carries its nonce. */
  flow(id: string | null | undefined, nonce: string | null | undefined): Pending | null {
    this.sweep()
    const pending = id ? this.pending.find((each) => each.id === id) : undefined
    if (!pending || !nonce || !same(pending.nonce, nonce)) return null
    return pending
  }

  /** Ends an authorization in flight (denied, or a code was given). */
  end(id: string): void {
    this.pending = this.pending.filter((each) => each.id !== id)
  }

  private sweep(): void {
    const now = this.now()
    this.pending = this.pending.filter((each) => now - each.createdAt < PENDING_TTL_MS)
    this.codes = this.codes.filter((code) => code.expiresAt > now)
  }

  /** The user approved: a grant with the scopes chosen, and a one-time code to send back with. */
  approve(pending: Pending, scopes: RemoteScope[]): string {
    const client = this.client(pending.clientId)
    if (!client || !pending.login) throw new OAuthError('invalid_request', 'That authorization is no longer open.')
    let redirectHost = ''
    try {
      redirectHost = new URL(pending.redirectUri).host
    } catch {
      /* checked at /authorize */
    }
    const grant: StoredGrant = {
      id: randomUUID(),
      client: client.name,
      clientId: client.id,
      redirectHost,
      login: pending.login,
      scopes,
      createdAt: this.now(),
      lastUsedAt: null,
      accessHash: null,
      accessExpiresAt: 0,
      refreshHash: null,
      refreshExpiresAt: 0,
      spent: []
    }
    const code = secret('sel_code')
    this.codes.push({
      hash: hashOf(code),
      grantId: grant.id,
      clientId: client.id,
      redirectUri: pending.redirectUri,
      challenge: pending.challenge,
      expiresAt: this.now() + CODE_TTL_MS
    })
    this.grants.push(grant)
    // A grant whose code was never exchanged has no tokens; it goes once there are too many.
    while (this.grants.length > MAX_GRANTS) {
      const unused = this.grants.findIndex((each) => !each.refreshHash && each.id !== grant.id)
      this.grants.splice(unused >= 0 ? unused : 0, 1)
    }
    this.end(pending.id)
    this.persist()
    return code
  }

  // ---- tokens ----

  private issue(grant: StoredGrant): Tokens {
    const access = secret('sel_at')
    const refresh = secret('sel_rt')
    const now = this.now()
    if (grant.refreshHash) {
      grant.spent = [...grant.spent, grant.refreshHash].slice(-20)
      grant.previousRefresh = { hash: grant.refreshHash, spentAt: now }
    }
    grant.previousAccess = grant.accessHash ? { hash: grant.accessHash, expiresAt: grant.accessExpiresAt } : null
    grant.accessHash = hashOf(access)
    grant.accessExpiresAt = now + ACCESS_TTL_MS
    grant.refreshHash = hashOf(refresh)
    grant.refreshExpiresAt = now + REFRESH_TTL_MS
    grant.lastUsedAt = now
    this.persist()
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: refresh,
      scope: grant.scopes.join(' ')
    }
  }

  /** grant_type=authorization_code, with the PKCE verifier. */
  exchange(input: { code: string; clientId: string; redirectUri: string; verifier: string }): Tokens {
    this.sweep()
    const hash = hashOf(input.code)
    const index = this.codes.findIndex((code) => same(code.hash, hash))
    if (index < 0) throw new OAuthError('invalid_grant', 'That code is not valid (or was used already).')
    const [code] = this.codes.splice(index, 1)
    if (code.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'That code was given to another client.')
    if (code.redirectUri !== input.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri differs from the one authorized.')
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(input.verifier) || !same(challengeOf(input.verifier), code.challenge))
      throw new OAuthError('invalid_grant', 'The PKCE code_verifier does not match.')
    const grant = this.grants.find((each) => each.id === code.grantId)
    if (!grant) throw new OAuthError('invalid_grant', 'That authorization was revoked.')
    return this.issue(grant)
  }

  /** grant_type=refresh_token: a new pair; the old refresh token is spent. */
  refresh(input: { token: string; clientId: string }): Tokens {
    const hash = hashOf(input.token)
    const now = this.now()
    const retried = this.grants.find(
      (each) => each.previousRefresh && same(each.previousRefresh.hash, hash) && now - each.previousRefresh.spentAt < REFRESH_GRACE_MS
    )
    if (retried) {
      if (retried.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'That refresh token was given to another client.')
      return this.issue(retried)
    }
    const stolen = this.grants.find((each) => each.spent.includes(hash))
    if (stolen) {
      // A spent token came back: someone has a copy. Nobody keeps this grant.
      this.revoke(stolen.id)
      throw new OAuthError('invalid_grant', 'That refresh token was used already; the authorization was ended.')
    }
    const grant = this.grants.find((each) => each.refreshHash !== null && same(each.refreshHash, hash))
    if (!grant || grant.refreshExpiresAt <= this.now()) throw new OAuthError('invalid_grant', 'That refresh token is not valid.')
    if (grant.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'That refresh token was given to another client.')
    return this.issue(grant)
  }

  /** The grant an access token belongs to, while it is valid. */
  authenticate(token: string): RemoteGrant | null {
    if (!token.startsWith('sel_at_')) return null
    const hash = hashOf(token)
    const now = this.now()
    const grant = this.grants.find(
      (each) =>
        (each.accessHash !== null && same(each.accessHash, hash) && each.accessExpiresAt > now) ||
        (!!each.previousAccess && same(each.previousAccess.hash, hash) && each.previousAccess.expiresAt > now)
    )
    if (!grant) return null
    // Written down at most once a minute: every call would otherwise rewrite the file.
    if (!grant.lastUsedAt || now - grant.lastUsedAt > 60_000) {
      grant.lastUsedAt = now
      this.persist()
    }
    return this.view(grant)
  }

  /** Ends a grant, or every grant: their tokens stop working at once. */
  revoke(id?: string): void {
    this.grants = id ? this.grants.filter((each) => each.id !== id) : []
    // Ending everything also forgets the owner: the next sign-in (while pairing) picks one again.
    if (!id) this.owner = null
    this.persist()
  }

  /** Revokes the grant a token (access or refresh) belongs to (RFC 7009); unknown tokens are ignored. */
  revokeToken(token: string): void {
    const hash = hashOf(token)
    const grant = this.grants.find((each) => each.accessHash === hash || each.refreshHash === hash || each.previousAccess?.hash === hash)
    if (grant) this.revoke(grant.id)
  }

  private view(grant: StoredGrant): RemoteGrant {
    const { id, client, redirectHost, login, scopes, createdAt, lastUsedAt } = grant
    return { id, client, redirectHost, login, scopes: [...scopes], createdAt, lastUsedAt }
  }

  /** The grants that hold tokens, the most recently used first. */
  list(): RemoteGrant[] {
    return this.grants
      .filter((grant) => grant.refreshHash !== null && grant.refreshExpiresAt > this.now())
      .map((grant) => this.view(grant))
      .sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt))
  }
}
