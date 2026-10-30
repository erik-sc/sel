// Settings → MCP → From anywhere: the remote connector (src/main/remote). Claude on the phone,
// claude.ai and Claude Code on other machines reach the notes through a tunnel to this computer.
import { useCallback, useEffect, useId, useState } from 'react'
import type { JSX } from 'react'
import { ALARMS_SETTING } from '@shared/alarms'
import type { RemoteConfig, RemoteStatus } from '@shared/mcp'
import { Segmented } from '@/appearance/controls'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { callTime, remoteLine, scopeWords, TOOL_LABELS } from './labels'
import { Snippet } from './Snippet'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

const REFRESH_MS = 3000

type Draft = Pick<RemoteConfig, 'publicUrl'> & { port: string }

const draftOf = (status: RemoteStatus): Draft => ({ publicUrl: status.publicUrl, port: String(status.port) })

export function RemoteSection(): JSX.Element {
  const ids = useId()
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback((): void => {
    window.api.mcp
      .remoteStatus()
      .then((next) => {
        setStatus(next)
        setDraft((current) => current ?? draftOf(next))
      })
      .catch((error) => console.error('could not read the remote status', error))
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const save = (enabled: boolean): void => {
    if (!status || !draft) return
    setBusy(true)
    window.api.mcp
      .configureRemote({
        enabled,
        publicUrl: draft.publicUrl.trim(),
        port: Number(draft.port) || status.port,
        githubClientId: status.githubClientId,
        githubLogin: status.githubLogin
      })
      .then((next) => {
        setStatus(next)
        setDraft(draftOf(next))
        if (next.error) notifyError(next.error)
        else toast(enabled ? 'Saved. The connector is on.' : 'Saved.', { kind: 'success' })
      })
      .catch((error) => notifyError('The settings could not be saved.', error))
      .finally(() => setBusy(false))
  }

  const pair = (): void => {
    window.api.mcp
      .pairRemote()
      .then((next) => {
        setStatus(next)
        toast('For the next 10 minutes, a new app can connect.', { kind: 'success' })
      })
      .catch((error) => notifyError('It could not be opened.', error))
  }

  const revoke = (id?: string): void => {
    window.api.mcp
      .revokeRemote(id)
      .then((next) => {
        setStatus(next)
        toast(id ? 'That connection was ended.' : 'Every connection was ended.', { kind: 'success' })
      })
      .catch((error) => notifyError('It could not be ended.', error))
  }

  const keepRunning = (): void => {
    window.api.app
      .setSetting(ALARMS_SETTING.tray, true)
      .then(refresh)
      .catch((error) => notifyError('The setting could not be saved.', error))
  }

  if (!status || !draft) return <section className="ap-group" />
  const line = remoteLine(status)
  const field = (key: keyof Draft, label: string, help: string, props: JSX.IntrinsicElements['input'] = {}): JSX.Element => (
    <div className="ap-row">
      <div className="ap-row-text">
        <label className="ap-row-label" htmlFor={`${ids}-${key}`}>
          {label}
        </label>
        <span className="ap-row-help">{help}</span>
      </div>
      <div className="ap-row-control">
        <input
          id={`${ids}-${key}`}
          className="ap-field is-wide"
          value={draft[key]}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
          {...props}
        />
      </div>
    </div>
  )

  return (
    <>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">From anywhere (Claude on your phone)</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Remote connector</span>
              <span className={line.error ? 'ap-row-help is-error' : 'ap-row-help'}>{line.text}</span>
            </div>
            <div className="ap-row-control">
              <Segmented
                label="Remote connector"
                value={status.enabled ? 'on' : 'off'}
                options={ON_OFF}
                onChange={(value) => save(value === 'on')}
              />
            </div>
          </div>
          {status.enabled && !status.staysRunning ? (
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-label">Keep sel running</span>
                <span className="ap-row-help is-error">
                  When the last window closes, sel quits and Claude cannot reach it. Keep it in the notification area instead.
                </span>
              </div>
              <div className="ap-row-control">
                <Button onClick={keepRunning}>Keep in the tray</Button>
              </div>
            </div>
          ) : null}
          {field(
            'publicUrl',
            'Public address',
            'For Claude on the phone: the https address your tunnel gives this computer (Tailscale Funnel or Cloudflare Tunnel). Not needed for Claude Code on this computer.',
            {
              placeholder: 'https://my-pc.tail1234.ts.net',
              maxLength: 300
            }
          )}
          {field('port', 'Local port', 'Where sel listens on this computer only. Point the tunnel here.', {
            inputMode: 'numeric',
            maxLength: 5
          })}
          {status.owner ? (
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-label">Signed in as</span>
                <span className="ap-row-help">
                  GitHub account {status.owner}: the only one let in. To change it, end every connection below.
                </span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mcp-actions">
          <Button disabled={busy} onClick={() => save(status.enabled)}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Connect</h3>
        </div>
        <div className="ap-list">
          {status.mcpUrl ? (
            <>
              <div className="ap-row">
                <div className="ap-row-text">
                  <span className="ap-row-label">Connect a new app</span>
                  <span className="ap-row-help">
                    {status.pairingUntil
                      ? `Open until ${new Date(status.pairingUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}: add the connector in Claude now.`
                      : 'New apps are refused unless you open this for 10 minutes first, so nobody else can connect one. Apps already connected are not affected.'}
                  </span>
                </div>
                <div className="ap-row-control">
                  <Button disabled={!status.running} onClick={pair}>
                    {status.pairingUntil ? 'Open' : 'Allow for 10 minutes'}
                  </Button>
                </div>
              </div>
              <div className="ap-row is-stacked">
                <div className="ap-row-text">
                  <span className="ap-row-label">Claude (phone, claude.ai, desktop)</span>
                  <span className="ap-row-help">
                    Settings → Connectors → Add custom connector, with this address. Then enter the code sel shows on GitHub and authorize.
                  </span>
                </div>
                <div className="ap-row-control">
                  <Snippet text={status.mcpUrl} label="Copy address" />
                </div>
              </div>
              <div className="ap-row is-stacked">
                <div className="ap-row-text">
                  <span className="ap-row-label">Claude Code on any machine</span>
                  <span className="ap-row-help">Run this, then /mcp in Claude Code to sign in.</span>
                </div>
                <div className="ap-row-control">
                  <Snippet text={status.claudeCode} label="Copy command" />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Signed-in apps</h3>
        </div>
        <div className="ap-list">
          {status.grants.length ? (
            status.grants.map((grant) => (
              <div className="ap-row" key={grant.id}>
                <div className="ap-row-text">
                  <span className="ap-row-label">
                    {grant.client} · {grant.redirectHost}
                  </span>
                  <span className="ap-row-help">
                    {grant.login} · {scopeWords(grant.scopes)} ·{' '}
                    {grant.lastUsedAt ? `last used ${callTime(grant.lastUsedAt)}` : 'not used yet'}
                  </span>
                </div>
                <div className="ap-row-control">
                  <Button onClick={() => revoke(grant.id)}>End</Button>
                </div>
              </div>
            ))
          ) : (
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-help">No app is signed in.</span>
              </div>
            </div>
          )}
          {status.calls.map((call, index) => (
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
          ))}
        </div>
        {status.grants.length > 1 ? (
          <div className="mcp-actions">
            <Button onClick={() => revoke()}>End every connection</Button>
          </div>
        ) : null}
      </section>
    </>
  )
}
