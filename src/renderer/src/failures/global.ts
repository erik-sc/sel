// What a window does about failures nobody caught, and the notices the main process sends.
// Started once per window by main.tsx.
import type { AppNotice } from '@shared/api'
import { setSettingsOpen, useUi } from '@/store/ui'
import { createThrottle } from '@/ui/throttle'
import { notifyError, toast } from '@/ui/toast'
import { failureCopy } from './notify'

/** Browser noise that is not a failure of the app. */
const BENIGN = [/ResizeObserver loop/i]

/** A thrown error in a handler that runs on every frame would otherwise toast without end. */
const uncaughtNotice = createThrottle(10_000)

export function watchFailures(): void {
  // A rejection nobody handled is most often a write that did not reach the database.
  window.addEventListener('unhandledrejection', (event) => {
    notifyError(failureCopy().unhandled, event.reason)
  })
  // `error` events of failed images and scripts do not bubble to the window: only thrown errors arrive here.
  window.addEventListener('error', (event) => {
    if (BENIGN.some((pattern) => pattern.test(event.message ?? ''))) return
    const error: unknown = event.error ?? event.message
    if (uncaughtNotice(Date.now())) notifyError(failureCopy().uncaught, error)
    else window.api.app.log(failureCopy().uncaught, error)
  })
}

function show(notice: AppNotice): void {
  const copy = failureCopy()
  if (notice === 'database-damaged') {
    // Calm, and there until dismissed: the way back is a backup, one click away.
    toast(copy.notice[notice], { kind: 'info', duration: 0, action: { label: copy.openBackups, run: openDataSettings } })
    return
  }
  // "Save and restart" stays until it is dismissed.
  toast(copy.notice[notice], { kind: 'error', duration: notice === 'crashed' ? 0 : undefined })
}

/** Settings → General, where the backups and the guided restore are. */
function openDataSettings(): void {
  useUi.setState({ settingsSection: 'general' })
  setSettingsOpen(true)
}

/** What the main process has to say: what it said before this window was ready, then as it comes. */
export function listenForNotices(): void {
  window.api.onNotice(show)
  window.api.app.notices().then(
    (notices) => notices.forEach(show),
    (error: unknown) => console.error('could not read the notices', error)
  )
}
