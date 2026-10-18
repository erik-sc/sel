/**
 * What the MCP server script (../mcp.ts) and the app's endpoint for other apps (./endpoint.ts)
 * agree on: the discovery file, the limits of one call and what a client is told when it cannot
 * be served. The script bundles this file, so it imports nothing but Node.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Written in the profile folder while "Connect other apps" is on: where the endpoint listens, and its token. */
export const DISCOVERY_FILE = 'mcp.json'

export interface Discovery {
  version: 1
  /** The named pipe (a socket elsewhere) the endpoint listens on. */
  pipe: string
  token: string
}

/** One request line, at most. Larger calls are refused by the script before they are sent. */
export const MAX_CALL_CHARS = 1024 * 1024

export const EXTERNAL_MESSAGES = {
  /** No discovery file: the setting is off, or sel never ran with it on. */
  off: 'sel is not set up for other apps. Open sel and turn on Settings → MCP → Connect other apps.',
  /** The discovery file is there but nothing answers on the pipe. */
  closed: 'sel is not open. Open sel to use your notes here (Settings → MCP → Connect other apps must stay on).',
  refused: 'sel refused this connection: its token is not the current one. Turn Connect other apps off and on again in Settings → MCP.',
  tooLarge: `That call is too large for sel (at most ${MAX_CALL_CHARS / 1024} KB).`
} as const

/** The discovery file's contents, or null when they are not what sel writes. */
export function parseDiscovery(text: string): Discovery | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object') return null
  const { version, pipe, token } = value as Record<string, unknown>
  if (version !== 1 || typeof pipe !== 'string' || !pipe || typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token)) return null
  return { version, pipe, token }
}

/**
 * Where the discovery file of an installed sel is when the command line does not say: its
 * profile folder, as Electron names it for the app "sel".
 */
export function defaultDiscoveryPath(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (platform === 'win32') return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'sel', DISCOVERY_FILE)
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'sel', DISCOVERY_FILE)
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'sel', DISCOVERY_FILE)
}
