// Settings → MCP: other apps connected to the notes. A chunk of its own, loaded when the section opens.
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { MCP_ENABLED_KEY, type McpStatus } from '@shared/mcp'
import { Segmented } from '@/appearance/controls'
import { Button, IconButton } from '@/ui/Button'
import { Check, Copy } from '@/ui/icons'
import { notifyError, toast } from '@/ui/toast'
import { callTime, stateLine, TOOL_LABELS } from './labels'
import './mcp.css'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

/** How often the section asks again while it is open: the list of calls moves while apps work. */
const REFRESH_MS = 2000

function Snippet({ text, label, block = false }: { text: string; label: string; block?: boolean }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className={block ? 'mcp-snippet is-block' : 'mcp-snippet'}>
      {block ? <pre>{text}</pre> : <code>{text}</code>}
      <IconButton
        label={copied ? 'Copied' : label}
        size="small"
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            },
            (error: unknown) => notifyError('Could not copy.', error)
          )
        }}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </div>
  )
}

export function McpSection(): JSX.Element {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback((): void => {
    window.api.mcp
      .status()
      .then(setStatus)
      .catch((error) => console.error('could not read the MCP status', error))
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const setEnabled = (next: boolean): void => {
    setStatus((current) => (current ? { ...current, enabled: next } : current))
    window.api.app
      .setSetting(MCP_ENABLED_KEY, next)
      .then(() => window.setTimeout(refresh, 300))
      .catch((error) => {
        refresh()
        notifyError('The setting could not be saved.', error)
      })
  }

  const rotate = (): void => {
    setBusy(true)
    window.api.mcp
      .rotateToken()
      .then((next) => {
        setStatus(next)
        toast('New token made. The old one no longer works.', { kind: 'success' })
      })
      .catch((error) => notifyError('A new token could not be made.', error))
      .finally(() => setBusy(false))
  }

  const enabled = status?.enabled ?? false
  const line = stateLine(status)

  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Connect other apps</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Connect other apps (MCP)</span>
              <span className="ap-row-help">
                Lets Claude Desktop, Claude Code and other MCP apps on this computer search and read your notes, create pages, add to pages, and add or
                change database rows. They can never delete anything. sel must be open.
              </span>
            </div>
            <div className="ap-row-control">
              <Segmented label="Connect other apps" value={enabled ? 'on' : 'off'} options={ON_OFF} onChange={(value) => setEnabled(value === 'on')} />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Token</span>
              <span className={line.error ? 'ap-row-help is-error' : 'ap-row-help'}>{line.text}</span>
            </div>
            <div className="ap-row-control">
              <Button disabled={busy || !status} onClick={rotate}>
                {busy ? 'Making…' : 'Generate new token'}
              </Button>
            </div>
          </div>
        </div>
        <p className="ap-note">
          Apps set up as below read the token from sel’s folder by themselves, so they keep working after a new one. A new token shuts out every copy of the old one.
          {status && !status.persistent ? ' This computer cannot keep the token sealed, so sel makes a new one each time it starts.' : ''}
        </p>
      </section>

      {status ? (
        <section className="ap-group">
          <div className="ap-group-head">
            <h3 className="ap-group-title">Set up</h3>
          </div>
          <div className="ap-list">
            <div className="ap-row is-stacked">
              <div className="ap-row-text">
                <span className="ap-row-label">Claude Code</span>
                <span className="ap-row-help">Run this once in a terminal.</span>
              </div>
              <div className="ap-row-control">
                <Snippet text={status.claudeCode} label="Copy command" />
              </div>
            </div>
            <div className="ap-row is-stacked">
              <div className="ap-row-text">
                <span className="ap-row-label">Claude Desktop</span>
                <span className="ap-row-help">Add this to claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config), then restart Claude Desktop.</span>
              </div>
              <div className="ap-row-control">
                <Snippet text={status.claudeDesktop} label="Copy configuration" block />
              </div>
            </div>
          </div>
          <p className="ap-note">Both start sel’s own program as Node, with the paths of this installation: nothing else is installed, and nothing goes on the network.</p>
        </section>
      ) : null}

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Recent calls</h3>
        </div>
        <div className="ap-list">
          {status?.calls.length ? (
            status.calls.map((call, index) => (
              <div className="ap-row mcp-call" key={`${call.at}-${index}`}>
                <div className="ap-row-text">
                  <span className="ap-row-label">{TOOL_LABELS[call.tool] ?? call.tool}</span>
                </div>
                <div className="ap-row-control">
                  <span className={call.ok ? 'mcp-call-time' : 'mcp-call-time is-error'}>
                    {call.ok ? '' : 'Failed · '}
                    {callTime(call.at)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-help">No app has asked anything since sel started.</span>
              </div>
            </div>
          )}
        </div>
        <p className="ap-note">Only which tool and when. What the apps ask and what they get is not kept.</p>
      </section>
    </div>
  )
}
