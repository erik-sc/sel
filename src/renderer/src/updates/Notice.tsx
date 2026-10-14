// The update notice: a small card in the corner of the content when a new version exists.
// It offers, never acts: nothing is downloaded or installed until the user presses a button.
import type { CSSProperties } from 'react'
import { noticeFor } from './labels'
import { runUpdateAction, useUpdates } from './store'
import './updates.css'

export function UpdateNotice() {
  const notice = noticeFor(useUpdates((state) => state.status))
  if (!notice) return null
  const notesUrl = notice.notesUrl
  return (
    <div className="updates-notice glass-thick" role="status" aria-label="Update">
      <div className="updates-notice-body">
        <span className="updates-notice-message">{notice.message}</span>
        {notesUrl && (
          <button type="button" className="updates-notice-link" onClick={() => void window.api.app.openExternal(notesUrl).catch((error) => console.error('could not open the release notes', error))}>
            Release notes
          </button>
        )}
        {notice.percent !== null && (
          <div className="updates-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={notice.percent}>
            <div className="updates-progress-fill" style={{ '--updates-progress': notice.percent / 100 } as CSSProperties} />
          </div>
        )}
      </div>
      <div className="updates-notice-actions">
        {notice.actions.map((action) => (
          <button
            type="button"
            key={action.id}
            className={action.primary ? 'updates-notice-action is-primary' : 'updates-notice-action'}
            onClick={() => runUpdateAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
