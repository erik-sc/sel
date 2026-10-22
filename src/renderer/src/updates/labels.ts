/**
 * What the update notice and the Updates settings say for a status from the main process.
 *
 * Pure: no React, no store, no `window.api`. Unit-tested.
 */
import type { UpdateStatus } from '../../../shared/updates'

export type UpdateAction = 'download' | 'restart' | 'later' | 'check'

export interface UpdateNotice {
  message: string
  /** 0 to 100 while downloading, otherwise null. */
  percent: number | null
  /** The release notes of the version on offer. */
  notesUrl: string | null
  actions: { id: UpdateAction; label: string; primary?: boolean }[]
}

const LATER = { id: 'later', label: 'Later' } as const

/** True when the download the user asked for failed: they can try it again. */
function downloadFailed(status: UpdateStatus): boolean {
  return status.phase === 'error' && status.version !== null
}

/**
 * The notice in the window, or null for none. It appears only once there is a new version, and
 * goes away when the user says Later. A check that found nothing, or failed, says nothing here.
 */
export function noticeFor(status: UpdateStatus | null): UpdateNotice | null {
  if (!status || status.dismissed || !status.version) return null
  const name = `sel ${status.version}`
  const base = { percent: null, notesUrl: status.notesUrl }
  switch (status.phase) {
    case 'available':
      return { ...base, message: `${name} is available.`, actions: [{ id: 'download', label: 'Download', primary: true }, LATER] }
    case 'downloading':
      return { ...base, message: `Downloading ${name}…`, percent: status.percent, actions: [LATER] }
    case 'ready':
      return {
        ...base,
        message: `${name} is ready. Restart to use it, or it is installed when you quit.`,
        actions: [{ id: 'restart', label: 'Restart now', primary: true }, LATER]
      }
    case 'error':
      return downloadFailed(status)
        ? {
            ...base,
            message: status.error ?? 'The download did not finish.',
            actions: [{ id: 'download', label: 'Try again', primary: true }, LATER]
          }
        : null
    default:
      return null
  }
}

/** The line under the version in Settings. */
export function statusLine(status: UpdateStatus | null): string {
  if (!status) return ''
  if (!status.supported) return 'Updates work only in the installed app.'
  const name = status.version ? `sel ${status.version}` : ''
  switch (status.phase) {
    case 'checking':
      return 'Looking for a new version…'
    case 'current':
      return 'This is the newest version.'
    case 'available':
      return `${name} is available.`
    case 'downloading':
      return `Downloading ${name}… ${status.percent}%`
    case 'ready':
      return `${name} is ready. It is installed when you quit sel.`
    case 'error':
      return status.error ?? 'Something went wrong.'
    default:
      return 'Not checked yet.'
  }
}

/** The one button in Settings: what can be done next. */
export function nextAction(status: UpdateStatus | null): { id: UpdateAction; label: string; busy: boolean } {
  if (!status) return { id: 'check', label: 'Check now', busy: true }
  switch (status.phase) {
    case 'checking':
      return { id: 'check', label: 'Checking…', busy: true }
    case 'available':
      return { id: 'download', label: 'Download', busy: false }
    case 'downloading':
      return { id: 'download', label: 'Downloading…', busy: true }
    case 'ready':
      return { id: 'restart', label: 'Restart now', busy: false }
    case 'error':
      return downloadFailed(status) ? { id: 'download', label: 'Try again', busy: false } : { id: 'check', label: 'Check now', busy: false }
    default:
      return { id: 'check', label: 'Check now', busy: !status.supported }
  }
}
