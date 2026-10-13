// The state of sync as this window knows it. Small and always loaded: the indicator in the
// sidebar reads it. The settings section (./SyncSettings.tsx) is loaded on demand.
import { create } from 'zustand'
// Relative imports: this module is unit-tested outside the bundler.
import { emptySyncStatus, type SyncActivity, type SyncStatus } from '../../../shared/sync'
import { setHistoryPage, setSettingsOpen, useUi } from '../store/ui'
import { toast } from '../ui/toast'
import { conflictMessage } from './labels'

interface SyncState {
  status: SyncStatus
  /** False until the first answer from the main process. */
  loaded: boolean
}

export const useSync = create<SyncState>(() => ({ status: emptySyncStatus(), loaded: false }))

/** The appearance engine listens on this channel for overrides changed in another window. */
const APPEARANCE_CHANNEL = 'appearance'
const APPEARANCE_KEY = 'appearance'

/** The newest activity entry this window has already told the user about. */
let seenActivity = 0
/** The problem already announced: one notification per problem, then only the quiet indicator. */
let announced: string | null = null

/** Opens Settings on the Sync section. */
export function openSyncSettings(): void {
  useUi.setState({ settingsSection: 'sync' })
  setSettingsOpen(true)
}

/**
 * The synced appearance replaced the local one in the settings: hands it to the appearance
 * engine of every window the way another window's edit reaches it (it sanitises what it gets).
 */
async function adoptAppearance(): Promise<void> {
  if (typeof BroadcastChannel === 'undefined') return
  const data = await window.api.app.getSetting<unknown>(APPEARANCE_KEY)
  if (data === null || typeof data !== 'object') return
  const channel = new BroadcastChannel(APPEARANCE_CHANNEL)
  channel.postMessage({ type: 'appearance', version: 1, data })
  channel.close()
}

function announce(status: SyncStatus, entry: SyncActivity | undefined): void {
  if (entry && entry.at > seenActivity) {
    if (entry.conflicts.length) {
      const pageId = entry.conflicts[0].pageId
      toast(conflictMessage(entry), { duration: 12_000, action: { label: 'Review', run: () => setHistoryPage(pageId) } })
    }
    if (entry.appearance) void adoptAppearance().catch((error) => console.error('could not apply the synced appearance', error))
  }
  const problem = status.state === 'syncing' ? announced : (status.lastError?.code ?? null)
  if (problem && problem !== announced && status.lastError) {
    const calm = status.state === 'offline'
    toast(calm ? 'sel is offline. Your changes will sync when the connection is back.' : status.lastError.message, {
      kind: calm ? 'info' : 'error',
      duration: calm ? 6000 : 12_000,
      action: calm ? undefined : { label: 'Open Sync settings', run: openSyncSettings }
    })
  }
  if (status.state !== 'syncing') announced = problem
}

/** Takes a status from the main process (an event, or the answer to a call). */
export function acceptStatus(status: SyncStatus, quiet = false): void {
  const entry = status.activity[0]
  if (!quiet) announce(status, entry)
  if (entry && entry.at > seenActivity) seenActivity = entry.at
  if (quiet && status.state !== 'syncing') announced = status.lastError?.code ?? null
  useSync.setState({ status, loaded: true })
}

let started = false

/**
 * Subscribes to the state of sync. Nothing of sync is loaded in the main process for it unless
 * this device is connected to a repository.
 */
export async function initSync(): Promise<void> {
  if (started || typeof window === 'undefined' || !window.api?.sync) return
  started = true
  window.api.sync.onStatus((status) => acceptStatus(status))
  try {
    const url = await window.api.app.getSetting<unknown>('sync.remoteUrl')
    if (typeof url !== 'string') {
      useSync.setState({ loaded: true })
      return
    }
    // What happened while this window was closed is history, not news.
    acceptStatus(await window.api.sync.status(), true)
  } catch (error) {
    console.error('could not load the state of sync', error)
    useSync.setState({ loaded: true })
  }
}

/** For tests. */
export function resetSyncStore(): void {
  seenActivity = 0
  announced = null
  started = false
  useSync.setState({ status: emptySyncStatus(), loaded: false })
}
