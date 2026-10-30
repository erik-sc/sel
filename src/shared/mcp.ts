/**
 * Connecting other apps to sel over MCP (Claude Desktop, Claude Code, any MCP client). Off by
 * default. When the user turns it on, the main process opens an endpoint of its own on this
 * computer and writes, in the profile folder, where it is and the token it takes; the client
 * starts sel's MCP server script (out/main/mcp.js) with sel's own executable, and the script
 * asks the running app. Connected apps can read and write pages and database rows, never
 * delete. Nothing goes on the network. See src/main/external.
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */

import type { SettingsSpec } from './settings'
import type { InvokeChannels } from './ipc'

/** Whether other apps may connect. Off unless the user turns it on. */
export const MCP_ENABLED_KEY = 'mcp.enabled'

/** The keys a renderer may write. */
export const MCP_KEYS = [MCP_ENABLED_KEY] as const

/** The value an MCP setting accepts from a renderer, or undefined when it does not. */
export function cleanMcpSetting(key: string, value: unknown): unknown {
  return key === MCP_ENABLED_KEY && typeof value === 'boolean' ? value : undefined
}

/** One call a connected app made: which tool, when, whether it worked. Never what it asked or got. */
export interface McpCall {
  tool: string
  at: number
  ok: boolean
}

export interface McpStatus {
  enabled: boolean
  /** The endpoint is listening. */
  running: boolean
  /** Why it is not, when it should be. */
  error: string | null
  /** False when this computer cannot keep the token safely: a new one is made each time sel starts. */
  persistent: boolean
  /** The `claude mcp add` command for this install. */
  claudeCode: string
  /** The `mcpServers` entry for Claude Desktop's configuration file, as JSON. */
  claudeDesktop: string
  /** The latest calls, the newest first. */
  calls: McpCall[]
}

export interface McpApi {
  status(): Promise<McpStatus>
  /** Makes a new token: the old one stops working. Connected apps pick the new one up by themselves. */
  rotateToken(): Promise<McpStatus>
  /** The remote connector: its settings, whether it listens, who is let in. */
  remoteStatus(): Promise<RemoteStatus>
  /** Stores the remote settings (and a new client secret when given), then opens or closes the server. */
  configureRemote(input: RemoteConfigInput): Promise<RemoteStatus>
  /** Ends one authorization (or all, with no id): its tokens stop working at once. */
  revokeRemote(id?: string): Promise<RemoteStatus>
  /** Lets a new app register for ten minutes: the window in which you add the connector in Claude. */
  pairRemote(): Promise<RemoteStatus>
}

/** Whether other apps may connect decides whether sel opens an endpoint for them: a boolean. */
export const MCP_SETTINGS: SettingsSpec = { keys: MCP_KEYS, clean: cleanMcpSetting }

/** The invoke channels of `api.mcp` (see `INVOKE` in ./api.ts): every method of McpApi that returns a promise, and no other. */
export const MCP_INVOKE = {
  'mcp:status': true,
  'mcp:rotateToken': true,
  'mcp:remoteStatus': true,
  'mcp:configureRemote': true,
  'mcp:revokeRemote': true,
  'mcp:pairRemote': true
} as const satisfies Record<InvokeChannels<{ mcp: McpApi }>, true>

// ---- from anywhere: the remote connector -----------------------------------------

/**
 * The remote connector (src/main/remote): the same tools over Streamable HTTP, for Claude on the
 * phone, claude.ai and Claude Code on other machines. Off by default. sel listens on this
 * computer only (127.0.0.1); a tunnel the user runs (Tailscale Funnel, Cloudflare Tunnel) gives it
 * the public https address the Claude servers call. sel is its own OAuth authorization server
 * and lets in one person: the GitHub account named here, after a login on GitHub and a consent
 * screen. The GitHub client secret never travels in settings: it is sealed in a file of its own.
 */

/** What the user set, stored as one value under `mcp.remote` (written by `mcp:configureRemote` only). */
export interface RemoteConfig {
  enabled: boolean
  /** The https address the tunnel gives, without a path: `https://pc.tail1234.ts.net`. Empty until set. */
  publicUrl: string
  /** The local port the tunnel forwards to. */
  port: number
  /** The OAuth App the user made on GitHub (Settings → Developer settings → OAuth Apps). */
  githubClientId: string
  /** The one GitHub login let in. */
  githubLogin: string
}

export const REMOTE_CONFIG_KEY = 'mcp.remote'
export const DEFAULT_REMOTE_PORT = 47615

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  enabled: false,
  publicUrl: '',
  port: DEFAULT_REMOTE_PORT,
  githubClientId: '',
  githubLogin: ''
}

/** What the remote connector may be granted, as the consent screen lists them. */
export const REMOTE_SCOPES = ['read', 'tasks', 'write'] as const
export type RemoteScope = (typeof REMOTE_SCOPES)[number]

/** A clean public address: https, a host, no credentials, query or fragment; the trailing slash dropped. Null otherwise. */
export function cleanPublicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return ''
  if (text.length > 300) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  // An origin only: sel answers at the root (/mcp, /.well-known/…), so a path would break discovery.
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '/') return null
  return url.origin
}

/** The stored config, with the default for anything malformed. */
export function cleanRemoteConfig(value: unknown): RemoteConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_REMOTE_CONFIG }
  const record = value as Record<string, unknown>
  const port = record['port']
  const text = (key: string, re: RegExp): string => {
    const raw = record[key]
    return typeof raw === 'string' && re.test(raw.trim()) ? raw.trim() : ''
  }
  return {
    enabled: record['enabled'] === true,
    publicUrl: cleanPublicUrl(record['publicUrl']) ?? '',
    port: typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_REMOTE_PORT,
    githubClientId: text('githubClientId', /^[A-Za-z0-9._-]{1,100}$/u),
    // GitHub logins: letters, digits and single hyphens, at most 39.
    githubLogin: text('githubLogin', /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u)
  }
}

/** One authorization the user gave: a Claude app, signed in as `login`, until revoked. */
export interface RemoteGrant {
  id: string
  /** The name the app registered with ("Claude"), and where it is sent back to. */
  client: string
  redirectHost: string
  login: string
  scopes: RemoteScope[]
  createdAt: number
  lastUsedAt: number | null
}

export interface RemoteStatus extends RemoteConfig {
  /** The server is listening on 127.0.0.1:port. */
  running: boolean
  error: string | null
  /** A client secret is kept (sealed); the secret itself never leaves the main process. */
  hasSecret: boolean
  /** The address to give Claude: `<publicUrl>/mcp`. Empty until the public address is set. */
  mcpUrl: string
  /** The callback to give GitHub's OAuth App. */
  githubCallback: string
  /** `claude mcp add --transport http …` for Claude Code on any machine. */
  claudeCode: string
  grants: RemoteGrant[]
  calls: McpCall[]
  /** Until when new apps may register (after "Connect a new app"), or null: registration is closed. */
  pairingUntil: number | null
  /** sel stays running in the notification area when its windows close (alarms.tray): the server needs it. */
  staysRunning: boolean
}

/** What `mcp:configureRemote` takes: the config, and a new client secret when one is typed (empty keeps the old). */
export interface RemoteConfigInput extends RemoteConfig {
  githubSecret?: string
}
