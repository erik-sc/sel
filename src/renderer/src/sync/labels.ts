// What the state of sync reads as, in plain words. Pure: shared by the indicator, the settings
// section and the notifications, and tested without a window.
import { checkRemoteUrl, REMOTE_URL_PROBLEMS, SYNC_LIMITS, type SyncActivity, type SyncStatus } from '../../../shared/sync'

export type SyncTone = 'quiet' | 'busy' | 'calm' | 'attention'

export interface SyncSummary {
  /** A few words: the tooltip of the indicator, the status line in Settings. */
  label: string
  tone: SyncTone
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "12 Oct". */
export function ago(then: number, now: number): string {
  const diff = Math.max(0, now - then)
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  }
  if (diff < 2 * DAY) return 'yesterday'
  return DAY_FORMAT.format(new Date(then))
}

/** "14:32" today, "12 Oct, 14:32" otherwise. */
export function when(then: number, now: number): string {
  const sameDay = new Date(then).toDateString() === new Date(now).toDateString()
  return sameDay ? TIME_FORMAT.format(new Date(then)) : `${DAY_FORMAT.format(new Date(then))}, ${TIME_FORMAT.format(new Date(then))}`
}

export function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

/** The state in a few words, and how loudly to show it. */
export function summarize(status: SyncStatus): SyncSummary {
  if (!status.configured) return { label: 'Sync is not set up', tone: 'quiet' }
  if (status.state === 'syncing') return { label: 'Syncing…', tone: 'busy' }
  if (status.paused) return { label: 'Sync is paused', tone: 'calm' }
  if (status.state === 'offline') return { label: 'Offline, your changes will sync when the connection is back', tone: 'calm' }
  if (status.state === 'needs-auth') return { label: 'Sync needs you to sign in to git', tone: 'attention' }
  if (status.state === 'error') return { label: 'Sync needs attention', tone: 'attention' }
  if (status.pending > 0) return { label: 'Changes waiting to sync', tone: 'quiet' }
  return { label: 'Synced', tone: 'quiet' }
}

/** The second half of the status line: when it last worked. */
export function lastSynced(status: SyncStatus, now: number): string {
  return status.lastSyncAt ? `Last synced ${ago(status.lastSyncAt, now)}` : 'Not synced yet'
}

/** One line of the activity list. */
export function describeActivity(entry: SyncActivity): string {
  const parts: string[] = []
  if (entry.sent > 0) parts.push(`Sent ${plural(entry.sent, 'page')}`)
  if (entry.received > 0) parts.push(`${parts.length ? 'received' : 'Received'} ${plural(entry.received, 'page')}${entry.from ? ` from ${entry.from}` : ''}`)
  if (entry.appearance) parts.push(parts.length ? 'appearance updated' : 'Appearance updated')
  if (entry.error) parts.push(parts.length ? 'then stopped with a problem' : 'Could not sync')
  if (!parts.length) return entry.conflicts.length ? 'Merged changes' : 'Nothing to sync'
  return parts.join(', ')
}

export function conflictCount(entry: SyncActivity): number {
  return entry.conflicts.reduce((total, page) => total + page.blocks, 0)
}

/** The words of the notification after a merge that had to choose. */
export function conflictMessage(entry: SyncActivity): string {
  const count = conflictCount(entry)
  return `${count} ${count === 1 ? 'block was' : 'blocks were'} changed on both devices; the other ${count === 1 ? 'version is' : 'versions are'} in version history`
}

/** What is wrong with the address in the field, or null when it can be used. Empty is not an error yet. */
export function urlProblem(value: string, allowLocal = false): string | null {
  const text = value.trim()
  if (!text) return null
  const checked = checkRemoteUrl(text, allowLocal)
  return checked.ok ? null : REMOTE_URL_PROBLEMS[checked.problem]
}

export function passphraseProblem(value: string, repeat: string | null): string | null {
  if (!value) return null
  if (value.length < SYNC_LIMITS.passphraseMin) return `Use at least ${SYNC_LIMITS.passphraseMin} characters.`
  if (value.length > SYNC_LIMITS.passphraseMax) return 'That is too long.'
  if (repeat !== null && repeat !== '' && repeat !== value) return 'The two passphrases are not the same.'
  return null
}
