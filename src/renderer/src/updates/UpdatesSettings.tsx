// Settings → General → Updates. Part of the settings window's chunk.
import { useEffect, useState } from 'react'
import { UPDATES_CHECK_KEY, UPDATES_PREVIEW_KEY } from '@shared/updates'
import { Segmented } from '@/appearance/controls'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import { nextAction, statusLine } from './labels'
import { runUpdateAction, useUpdates } from './store'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

export function UpdatesGroup() {
  const status = useUpdates((state) => state.status)
  // Off until the stored value says otherwise: off is the default, and the safe way to be wrong.
  const [enabled, setEnabled] = useState(false)
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    let alive = true
    const read = (key: string, set: (value: boolean) => void): void => {
      window.api.app
        .getSetting<unknown>(key)
        .then((value) => alive && set(value === true))
        .catch((error) => console.error('could not read the update setting', error))
    }
    read(UPDATES_CHECK_KEY, setEnabled)
    read(UPDATES_PREVIEW_KEY, setPreview)
    return () => {
      alive = false
    }
  }, [])

  const save = (key: string, set: (value: boolean) => void, next: boolean): void => {
    set(next)
    window.api.app.setSetting(key, next).catch((error) => {
      set(!next)
      notifyError('The setting could not be saved.', error)
    })
  }

  const action = nextAction(status)
  const line = statusLine(status)
  const failed = status?.phase === 'error'
  const notesUrl = status?.notesUrl ?? null

  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Updates</h3>
      </div>
      <div className="ap-list">
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Check for updates</span>
            <span className="ap-row-help">
              Once a day, sel asks GitHub whether there is a new version. Nothing is downloaded until you say so.
            </span>
          </div>
          <div className="ap-row-control">
            <Segmented
              label="Check for updates"
              value={enabled ? 'on' : 'off'}
              options={ON_OFF}
              onChange={(value) => save(UPDATES_CHECK_KEY, setEnabled, value === 'on')}
            />
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Test builds on this computer</span>
            <span className="ap-row-help">
              Every push to a release being prepared makes a build, before its pull request is merged. On, this computer looks for one every
              half hour, downloads it by itself and installs it at the next restart. They are not final, and they work on your real data.
            </span>
          </div>
          <div className="ap-row-control">
            <Segmented
              label="Test builds on this computer"
              value={preview ? 'on' : 'off'}
              options={ON_OFF}
              onChange={(value) => save(UPDATES_PREVIEW_KEY, setPreview, value === 'on')}
            />
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">sel {status?.current ?? ''}</span>
            <span className={failed ? 'ap-row-help is-error' : 'ap-row-help'}>
              {line}
              {notesUrl && (status?.phase === 'available' || status?.phase === 'ready') ? (
                <>
                  {' '}
                  <a
                    href={notesUrl}
                    onClick={(event) => {
                      event.preventDefault()
                      void window.api.app.openExternal(notesUrl).catch((error) => console.error('could not open the release notes', error))
                    }}
                  >
                    Release notes
                  </a>
                </>
              ) : null}
            </span>
          </div>
          <div className="ap-row-control">
            <Button disabled={action.busy} onClick={() => runUpdateAction(action.id)}>
              {action.label}
            </Button>
          </div>
        </div>
      </div>
      <p className="ap-note">Check now asks GitHub once, whether or not the daily check is on.</p>
    </section>
  )
}
