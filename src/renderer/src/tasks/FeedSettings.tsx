// Settings → Today: the tasks as a calendar other calendars subscribe to (shared/tasks/ics.ts).
// sel gives it at the address the remote connector is reached at, so that is what has to be on.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { RemoteStatus } from '@shared/mcp'
import { cleanTasksFeed, feedPath, TASKS_FEED_KEY, type TasksFeed } from '@shared/tasks/ics'
import { Segmented } from '@/appearance/controls'
import { Snippet } from '@/external/Snippet'
import { useUi } from '@/store/ui'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

/** A secret for the address: 32 bytes, as text an address takes. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export function FeedSettings(): JSX.Element {
  const [feed, setFeed] = useState<TasksFeed>({ enabled: false, token: '' })
  const [remote, setRemote] = useState<RemoteStatus | null>(null)

  useEffect(() => {
    let alive = true
    window.api.app
      .getSetting<unknown>(TASKS_FEED_KEY)
      .then((value) => alive && setFeed(cleanTasksFeed(value)))
      .catch((error) => console.error('could not read the calendar setting', error))
    window.api.mcp
      .remoteStatus()
      .then((status) => alive && setRemote(status))
      .catch((error) => console.error('could not read the MCP status', error))
    return () => {
      alive = false
    }
  }, [])

  const save = (next: TasksFeed): void => {
    const before = feed
    setFeed(next)
    window.api.app.setSetting(TASKS_FEED_KEY, next).catch((error) => {
      setFeed(before)
      notifyError('The setting could not be saved.', error)
    })
  }

  // Reached from outside: the connector is on and has an address others can open.
  const base = remote?.enabled && remote.running && remote.publicUrl ? remote.publicUrl.replace(/\/+$/u, '') : null
  const address = feed.enabled && base ? `${base}${feedPath(feed.token)}` : null

  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Tasks in other calendars</h3>
      </div>
      <div className="ap-list">
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Publish my tasks as a calendar</span>
            <span className="ap-row-help">
              The open tasks that have a date, for Google Calendar and the iPhone to subscribe to. One way: what you change there does not
              come back. What is private from the AI stays out.
            </span>
          </div>
          <div className="ap-row-control">
            <Segmented
              label="Publish my tasks as a calendar"
              value={feed.enabled ? 'on' : 'off'}
              options={ON_OFF}
              // The first time it is turned on it gets its address; turned off and on again, it keeps it.
              onChange={(value) => save({ enabled: value === 'on', token: feed.token || newToken() })}
            />
          </div>
        </div>
        {feed.enabled && address && (
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Its address</span>
              <span className="ap-row-help">Whoever has it reads your tasks: give it to your calendars only.</span>
              <Snippet text={address} label="Copy address" />
            </div>
            <div className="ap-row-control">
              <Button
                onClick={() => {
                  save({ enabled: true, token: newToken() })
                  toast('The calendar has a new address. The old one no longer answers: subscribe again with the new one.')
                }}
              >
                New address
              </Button>
            </div>
          </div>
        )}
        {feed.enabled && !address && (
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">It has no address yet</span>
              <span className="ap-row-help is-error">
                A calendar reads it from outside this computer, at the address Claude reaches sel by. Turn on “Claude on your phone” in
                Settings → MCP.
              </span>
            </div>
            <div className="ap-row-control">
              <Button onClick={() => useUi.setState({ settingsSection: 'mcp' })}>Open MCP</Button>
            </div>
          </div>
        )}
      </div>
      {feed.enabled && address && (
        <p className="ap-note">
          Google Calendar, on the web: Other calendars → + → From URL; it reads the address again a few times a day, so a change can take
          hours to show. iPhone: Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add Subscribed Calendar; it reads it
          as often as you choose there. Both only reach it while this computer is on with sel open.
        </p>
      )}
    </section>
  )
}
