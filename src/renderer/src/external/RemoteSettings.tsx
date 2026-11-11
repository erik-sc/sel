// Settings → MCP: the remote connector (src/main/remote). The page opens with the one thing
// most people want, "Claude on your phone": one switch that starts the server and opens the
// tunnel by itself, the address to give Claude, and who is connected. Everything about how it is
// done (the address typed by hand, the port, Claude Code on other machines, the calls) is under
// Advanced.
import { useCallback, useEffect, useId, useState } from 'react'
import type { JSX } from 'react'
import { ALARMS_SETTING } from '@shared/alarms'
import type { RemoteConfig, RemoteStatus, TunnelStatus } from '@shared/mcp'
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

export interface Remote {
  status: RemoteStatus | null
  set(status: RemoteStatus): void
  refresh(): void
}

/** The remote connector's status, read now and again while the page is open. */
export function useRemote(): Remote {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const refresh = useCallback((): void => {
    window.api.mcp
      .remoteStatus()
      .then(setStatus)
      .catch((error) => console.error('could not read the remote status', error))
  }, [])
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])
  return { status, set: setStatus, refresh }
}

const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download'

/** Where "Claude on your phone" stands, in one line, and the one thing to do about it. */
export function phoneLine(status: RemoteStatus): { text: string; error: boolean; action: 'install' | 'approve' | 'retry' | null } {
  if (!status.enabled) return { text: 'Off: Claude cannot reach sel from outside this computer.', error: false, action: null }
  if (status.error) return { text: status.error, error: true, action: 'retry' }
  const tunnel: TunnelStatus = status.tunnelStatus
  switch (tunnel.state) {
    case 'on':
      return { text: 'On. It starts with sel, by itself.', error: false, action: null }
    case 'no-tailscale':
      return {
        text: 'One thing is missing: Tailscale, the free program sel uses to be reached from outside. Install it, sign in, and try again.',
        error: true,
        action: 'install'
      }
    case 'signed-out':
      return {
        text: 'Tailscale is installed but not signed in. Open it from the notification area, sign in, and try again.',
        error: true,
        action: 'retry'
      }
    case 'needs-approval':
      return {
        text: 'Tailscale asks you to allow public access for this computer, once. Allow it there, then try again.',
        error: true,
        action: 'approve'
      }
    case 'failed':
      return { text: 'The way in from outside could not be opened.', error: true, action: 'retry' }
    default:
      // On with an address typed by hand (Advanced), or still starting.
      if (!status.running) return { text: 'Starting…', error: false, action: null }
      return status.publicUrl
        ? { text: 'On, at the address set under Advanced.', error: false, action: null }
        : { text: 'On, on this computer only. For the phone, turn it off and on again here.', error: false, action: 'retry' }
  }
}

/** The essential: one switch, the address for Claude, and who is connected. */
export function PhoneSection({ remote }: { remote: Remote }): JSX.Element {
  const { status } = remote
  const [busy, setBusy] = useState(false)

  const turn = (on: boolean): void => {
    setBusy(true)
    // The server lives in sel: sel has to stay running, and start with the computer.
    const stay = on
      ? Promise.all([window.api.app.setSetting(ALARMS_SETTING.tray, true), window.api.app.setSetting(ALARMS_SETTING.openAtLogin, true)])
      : Promise.resolve([])
    stay
      .then(() => window.api.mcp.phone(on))
      .then((next) => {
        remote.set(next)
        if (on && next.tunnelStatus.state === 'on') toast('On. Now add sel to Claude, below.', { kind: 'success' })
      })
      .catch((error) => notifyError('It could not be changed.', error))
      .finally(() => setBusy(false))
  }

  const pair = (): void => {
    window.api.mcp
      .pairRemote()
      .then((next) => {
        remote.set(next)
        toast('For the next 10 minutes, a new app can connect.', { kind: 'success' })
      })
      .catch((error) => notifyError('It could not be opened.', error))
  }

  const revoke = (id: string): void => {
    window.api.mcp
      .revokeRemote(id)
      .then((next) => {
        remote.set(next)
        toast('That connection was ended.', { kind: 'success' })
      })
      .catch((error) => notifyError('It could not be ended.', error))
  }

  if (!status) return <section className="ap-group" />
  const line = phoneLine(status)
  const reachable = status.enabled && status.running && !!status.publicUrl && !line.error
  const open = (url: string): void =>
    void window.api.app.openExternal(url).catch((error) => notifyError('The page could not be opened.', error))

  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Claude on your phone</h3>
      </div>
      <div className="ap-list">
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Use sel from Claude, anywhere</span>
            <span className={line.error ? 'ap-row-help is-error' : 'ap-row-help'} role="status">
              {busy ? 'One moment…' : line.text}
            </span>
          </div>
          <div className="ap-row-control">
            {line.action === 'install' ? <Button onClick={() => open(TAILSCALE_DOWNLOAD)}>Get Tailscale</Button> : null}
            {line.action === 'approve' && status.tunnelStatus.approveUrl ? (
              <Button onClick={() => open(status.tunnelStatus.approveUrl as string)}>Allow in Tailscale</Button>
            ) : null}
            {line.action ? (
              <Button disabled={busy} onClick={() => turn(true)}>
                Try again
              </Button>
            ) : null}
            <Segmented
              label="Use sel from Claude, anywhere"
              value={status.enabled ? 'on' : 'off'}
              options={ON_OFF}
              onChange={(value) => turn(value === 'on')}
            />
          </div>
        </div>
        {reachable ? (
          <>
            <div className="ap-row is-stacked">
              <div className="ap-row-text">
                <span className="ap-row-label">Add sel to Claude</span>
                <span className="ap-row-help">
                  In Claude: Settings → Connectors → Add custom connector, with this address. Claude then shows a code: enter it on GitHub
                  to sign in.
                </span>
              </div>
              <div className="ap-row-control">
                <Snippet text={status.mcpUrl} label="Copy address" />
              </div>
            </div>
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-label">Let a new app in</span>
                <span className="ap-row-help">
                  {status.pairingUntil
                    ? `Open until ${new Date(status.pairingUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}: add sel to Claude now.`
                    : 'Closed, so nobody else can connect. Open it for 10 minutes before you add sel to Claude.'}
                </span>
              </div>
              <div className="ap-row-control">
                <Button onClick={pair}>{status.pairingUntil ? 'Open' : 'Allow for 10 minutes'}</Button>
              </div>
            </div>
          </>
        ) : null}
        {status.grants.map((grant) => (
          <div className="ap-row" key={grant.id}>
            <div className="ap-row-text">
              <span className="ap-row-label">
                {grant.client} · {grant.redirectHost}
              </span>
              <span className="ap-row-help">
                {grant.login} · {scopeWords(grant.scopes)} · {grant.lastUsedAt ? `last used ${callTime(grant.lastUsedAt)}` : 'not used yet'}
              </span>
            </div>
            <div className="ap-row-control">
              <Button onClick={() => revoke(grant.id)}>End</Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Under Advanced: the address typed by hand, the port, Claude Code elsewhere, and the latest calls. */
export function RemoteAdvanced({ remote }: { remote: Remote }): JSX.Element {
  const ids = useId()
  const { status } = remote
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (status) setDraft((current) => current ?? draftOf(status))
  }, [status])

  const save = (): void => {
    if (!status || !draft) return
    setBusy(true)
    const publicUrl = draft.publicUrl.trim()
    window.api.mcp
      .configureRemote({
        enabled: status.enabled,
        publicUrl,
        port: Number(draft.port) || status.port,
        githubClientId: status.githubClientId,
        githubLogin: status.githubLogin,
        // An address typed here is a tunnel of the user's own: sel stops keeping one.
        tunnel: publicUrl !== status.publicUrl ? 'manual' : status.tunnel
      })
      .then((next) => {
        remote.set(next)
        setDraft(draftOf(next))
        if (next.error) notifyError(next.error)
        else toast('Saved.', { kind: 'success' })
      })
      .catch((error) => notifyError('The settings could not be saved.', error))
      .finally(() => setBusy(false))
  }

  const revokeAll = (): void => {
    window.api.mcp
      .revokeRemote()
      .then((next) => {
        remote.set(next)
        toast('Every connection was ended.', { kind: 'success' })
      })
      .catch((error) => notifyError('It could not be ended.', error))
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
          <h3 className="ap-group-title">Remote connector</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">State</span>
              <span className={line.error ? 'ap-row-help is-error' : 'ap-row-help'}>{line.text}</span>
            </div>
          </div>
          {field(
            'publicUrl',
            'Public address',
            status.tunnel === 'tailscale'
              ? 'Kept by sel, from Tailscale. Type another only to use a tunnel of your own (Cloudflare Tunnel, for one): sel then stops keeping its own.'
              : 'The https address your own tunnel gives this computer.',
            { placeholder: 'https://my-pc.tail1234.ts.net', maxLength: 300 }
          )}
          {field('port', 'Local port', 'Where sel listens, on this computer only.', { inputMode: 'numeric', maxLength: 5 })}
          {status.owner ? (
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-label">Signed in as</span>
                <span className="ap-row-help">GitHub account {status.owner}: the only one let in. To change it, end every connection.</span>
              </div>
              <div className="ap-row-control">
                <Button disabled={!status.grants.length} onClick={revokeAll}>
                  End every connection
                </Button>
              </div>
            </div>
          ) : null}
          <div className="ap-row is-stacked">
            <div className="ap-row-text">
              <span className="ap-row-label">Claude Code on any machine</span>
              <span className="ap-row-help">Run this, then /mcp in Claude Code to sign in.</span>
            </div>
            <div className="ap-row-control">
              <Snippet text={status.claudeCode} label="Copy command" />
            </div>
          </div>
        </div>
        <div className="mcp-actions">
          <Button disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </section>

      {status.calls.length ? (
        <section className="ap-group">
          <div className="ap-group-head">
            <h3 className="ap-group-title">Recent calls from outside</h3>
          </div>
          <div className="ap-list">
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
        </section>
      ) : null}
    </>
  )
}
