// Whether Claude can reach sel right now, in one word: the light at the foot of the sidebar.
// Read from the two statuses the MCP page of Settings shows. Pure: no React, no DOM.
import type { McpStatus, RemoteStatus } from '../../../shared/mcp'
import { phoneLine } from './phone'

/**
 * on: Claude reaches sel from anywhere. local: only apps on this computer do. starting: asked
 * for, not there yet. problem: asked for, and something is in the way. off: nothing is open.
 */
export type McpLightState = 'on' | 'local' | 'starting' | 'problem' | 'off'

export interface McpLight {
  state: McpLightState
  /** What is in the way, or where sel is reached: for the tooltip. */
  detail: string
}

export function mcpLight(remote: RemoteStatus | null, local: McpStatus | null): McpLight {
  const here = !!local?.enabled && local.running
  if (remote?.enabled) {
    const line = phoneLine(remote)
    if (line.error) return { state: 'problem', detail: line.text }
    if (!remote.running) return { state: 'starting', detail: line.text }
    if (remote.publicUrl) return { state: 'on', detail: remote.mcpUrl }
    // Listening, with no address from outside: Claude Code on this computer can use it.
    return { state: 'local', detail: remote.mcpUrl }
  }
  if (local?.enabled && local.error) return { state: 'problem', detail: local.error }
  if (here) return { state: 'local', detail: '' }
  return { state: 'off', detail: '' }
}
