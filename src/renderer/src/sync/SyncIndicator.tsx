// The small sync indicator in the sidebar footer. Absent until this device syncs; then quiet
// when all is well, turning while a sync runs, and calm but clear when something needs a look.
// A click opens Settings on the Sync section.
import type { JSX } from 'react'
import { preloadSettings } from '@/shell/SettingsModal'
import { IconButton } from '@/ui/Button'
import { SyncAlert, SyncBusy, SyncDone, SyncOff, SyncPending } from './icons'
import { ago, summarize } from './labels'
import { openSyncSettings, useSync } from './store'
import './sync.css'

export function SyncIndicator(): JSX.Element | null {
  const status = useSync((state) => state.status)
  if (!status.configured) return null
  const summary = summarize(status)
  const label =
    summary.tone === 'quiet' && status.lastSyncAt && status.pending === 0 ? `${summary.label} ${ago(status.lastSyncAt, Date.now())}` : summary.label
  const icon =
    status.state === 'syncing' ? (
      <SyncBusy />
    ) : status.paused || status.state === 'offline' ? (
      <SyncOff />
    ) : summary.tone === 'attention' ? (
      <SyncAlert />
    ) : status.pending > 0 ? (
      <SyncPending />
    ) : (
      <SyncDone />
    )
  return (
    <IconButton label={label} className={`sync-indicator is-${summary.tone}`} onPointerEnter={preloadSettings} onFocus={preloadSettings} onClick={openSyncSettings}>
      {icon}
    </IconButton>
  )
}
