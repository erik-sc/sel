// The light at the foot of the sidebar: whether the MCP server is on, at a glance (./light.ts).
// A click opens Settings → MCP, where it is turned on and what is in the way is fixed.
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { McpStatus, RemoteStatus } from '@shared/mcp'
import { setSettingsOpen, useUi } from '@/store/ui'
import { mcpLight, type McpLightState } from './light'
import './light.css'

/** Often enough to notice a server that fell, seldom enough to cost nothing. */
const REFRESH_MS = 20_000

export type McpLightCopy = Record<McpLightState, string> & { open: string }

export function McpLight({ copy }: { copy: McpLightCopy }): JSX.Element | null {
  const [remote, setRemote] = useState<RemoteStatus | null>(null)
  const [local, setLocal] = useState<McpStatus | null>(null)
  const [read, setRead] = useState(false)
  const refresh = useCallback((): void => {
    Promise.all([window.api.mcp.remoteStatus(), window.api.mcp.status()])
      .then(([nextRemote, nextLocal]) => {
        setRemote(nextRemote)
        setLocal(nextLocal)
        setRead(true)
      })
      .catch((error) => console.error('could not read the MCP status', error))
  }, [])
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    // Coming back to the window is when one looks.
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])
  // Changing the switch in Settings shows here as the dialog closes.
  const settingsOpen = useUi((state) => state.settingsOpen)
  useEffect(() => {
    if (!settingsOpen) refresh()
  }, [settingsOpen, refresh])

  if (!read) return null
  const light = mcpLight(remote, local)
  return (
    <button
      type="button"
      className={`mcp-light is-${light.state}`}
      title={light.detail ? `${light.detail}\n${copy.open}` : copy.open}
      onClick={() => {
        useUi.setState({ settingsSection: 'mcp' })
        setSettingsOpen(true)
      }}
    >
      <span className="mcp-light-dot" aria-hidden="true" />
      <span className="mcp-light-text" role="status">
        {copy[light.state]}
      </span>
    </button>
  )
}
