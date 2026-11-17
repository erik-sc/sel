// Settings → Today: the tasks in the user's own Google Calendar (shared/google.ts). sel signs in
// with an OAuth client the user made, keeps a calendar of its own there, and shows how it went.
import { useEffect, useId, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { GoogleStatus } from '@shared/google'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import './google.css'

const GUIDE = 'https://github.com/erik-sc/sel/blob/main/docs/google-calendar.md'

function when(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
}

export function GoogleSettings(): JSX.Element | null {
  const id = useId()
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const read = (): void => {
      window.api.google
        .status()
        .then((next) => alive && setStatus(next))
        .catch((error) => console.error('could not read the Google status', error))
    }
    read()
    // The calendar is kept up to date in the background: what it says here follows.
    const timer = window.setInterval(read, 15_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const run = (action: () => Promise<GoogleStatus>, failed: string): void => {
    setBusy(true)
    action()
      .then(setStatus, (error: unknown) => notifyError(failed, error))
      .finally(() => setBusy(false))
  }

  if (!status) return null
  const configured = !!status.clientId
  const setup = !configured || editing

  const saveClient = (event: FormEvent): void => {
    event.preventDefault()
    run(async () => {
      const next = await window.api.google.configure(clientId, secret)
      setSecret('')
      setEditing(false)
      return next
    }, 'The client could not be saved.')
  }

  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Tasks in Google Calendar</h3>
      </div>
      <div className="ap-list">
        {!status.available ? (
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Not on this computer</span>
              <span className="ap-row-help">
                This computer has no secure storage to keep a sign-in, so sel does not sign in to Google here.
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-label">
                  {status.signedIn
                    ? 'Signed in to Google'
                    : status.signingIn
                      ? 'Waiting for the browser…'
                      : 'Put my tasks in my Google Calendar'}
                </span>
                <span className={status.error ? 'ap-row-help is-error' : 'ap-row-help'} role={status.error ? 'alert' : undefined}>
                  {status.error ??
                    (status.signedIn
                      ? `${status.events} ${status.events === 1 ? 'task' : 'tasks'} in the calendar “sel”${status.lastSync ? `, last sent ${when(status.lastSync)}` : ''}. Kept up to date while sel is open.`
                      : 'sel signs in to Google and keeps a calendar of its own there, “sel”, with an event for each open task that has a date. It shows wherever your Google Calendar does, the iPhone included. One way: what you change in Google does not come back.')}
                </span>
              </div>
              <div className="ap-row-control">
                {status.signedIn ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => run(() => window.api.google.sync(), 'The calendar could not be brought up to date.')}
                    >
                      Send now
                    </Button>
                    <Button disabled={busy} onClick={() => run(() => window.api.google.signOut(), 'Could not sign out.')}>
                      Sign out
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    disabled={busy || !configured}
                    onClick={() => run(() => window.api.google.signIn(), 'Could not sign in.')}
                  >
                    Sign in with Google
                  </Button>
                )}
              </div>
            </div>
            {setup ? (
              <form className="ap-row" onSubmit={saveClient}>
                <div className="ap-row-text">
                  <span className="ap-row-label">Your Google client</span>
                  <span className="ap-row-help">
                    Google lets an app sign in only with a client registered with it, and sel has none of its own: you make one, once, in
                    Google Cloud (about five minutes), and paste it here. It is kept encrypted on this computer.{' '}
                    <button type="button" className="gcal-link" onClick={() => void window.api.app.openExternal(GUIDE)}>
                      How to make one
                    </button>
                  </span>
                  <label className="gcal-field" htmlFor={`${id}-client`}>
                    <span>Client ID</span>
                    <input
                      id={`${id}-client`}
                      className="ui-input"
                      value={clientId}
                      placeholder="…apps.googleusercontent.com"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setClientId(event.target.value)}
                    />
                  </label>
                  <label className="gcal-field" htmlFor={`${id}-secret`}>
                    <span>Client secret</span>
                    <input
                      id={`${id}-secret`}
                      className="ui-input"
                      type="password"
                      value={secret}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setSecret(event.target.value)}
                    />
                  </label>
                </div>
                <div className="ap-row-control">
                  <Button type="submit" variant="primary" disabled={busy || !clientId.trim() || !secret.trim()}>
                    Save
                  </Button>
                  {configured && <Button onClick={() => setEditing(false)}>Cancel</Button>}
                </div>
              </form>
            ) : (
              <div className="ap-row">
                <div className="ap-row-text">
                  <span className="ap-row-label">Your Google client</span>
                  <span className="ap-row-help">{status.clientId}</span>
                </div>
                <div className="ap-row-control">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setClientId(status.clientId ?? '')
                      setEditing(true)
                    }}
                  >
                    Change
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
