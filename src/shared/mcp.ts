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
}

/** Whether other apps may connect decides whether sel opens an endpoint for them: a boolean. */
export const MCP_SETTINGS: SettingsSpec = { keys: MCP_KEYS, clean: cleanMcpSetting }

/** The invoke channels of `api.mcp` (see `INVOKE` in ./api.ts): every method of McpApi that returns a promise, and no other. */
export const MCP_INVOKE = {
  'mcp:status': true,
  'mcp:rotateToken': true
} as const satisfies Record<InvokeChannels<{ mcp: McpApi }>, true>
