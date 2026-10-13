/**
 * The renderer side of sync: the words for each state, and the store that turns status events
 * into at most one notification per problem and one per merge that had to choose.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySyncStatus, type SyncActivity, type SyncStatus } from '../../../shared/sync'
import { ago, conflictMessage, describeActivity, lastSynced, passphraseProblem, summarize, urlProblem, when } from './labels'

function status(patch: Partial<SyncStatus> = {}): SyncStatus {
  return { ...emptySyncStatus(), configured: true, state: 'idle', remoteUrl: 'https://github.com/me/notes.git', deviceName: 'Laptop', ...patch }
}

function activity(patch: Partial<SyncActivity> = {}): SyncActivity {
  return { at: 1000, sent: 0, received: 0, conflicts: [], ...patch }
}

describe('labels', () => {
  const NOW = new Date(2026, 9, 13, 15, 0, 0).getTime()

  it('says how long ago in plain words', () => {
    expect(ago(NOW - 5_000, NOW)).toBe('just now')
    expect(ago(NOW - 60_000, NOW)).toBe('1 minute ago')
    expect(ago(NOW - 59 * 60_000, NOW)).toBe('59 minutes ago')
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe('3 hours ago')
    expect(ago(NOW - 30 * 3_600_000, NOW)).toBe('yesterday')
    expect(ago(NOW - 5 * 86_400_000, NOW)).toBe('8 Oct')
    expect(ago(NOW + 5000, NOW)).toBe('just now')
    expect(when(NOW - 3_600_000, NOW)).toBe('14:00')
    expect(when(NOW - 26 * 3_600_000, NOW)).toBe('12 Oct, 13:00')
    expect(lastSynced(status({ lastSyncAt: NOW - 120_000 }), NOW)).toBe('Last synced 2 minutes ago')
    expect(lastSynced(status(), NOW)).toBe('Not synced yet')
  })

  it('summarises every state, quietly when all is well', () => {
    expect(summarize(emptySyncStatus())).toEqual({ label: 'Sync is not set up', tone: 'quiet' })
    expect(summarize(status())).toEqual({ label: 'Synced', tone: 'quiet' })
    expect(summarize(status({ pending: 2 }))).toEqual({ label: 'Changes waiting to sync', tone: 'quiet' })
    expect(summarize(status({ state: 'syncing' })).tone).toBe('busy')
    expect(summarize(status({ paused: true }))).toEqual({ label: 'Sync is paused', tone: 'calm' })
    expect(summarize(status({ state: 'offline', lastError: { code: 'offline', message: 'x' } })).tone).toBe('calm')
    expect(summarize(status({ state: 'needs-auth', lastError: { code: 'auth-failed', message: 'x' } }))).toEqual({ label: 'Sync needs you to sign in to git', tone: 'attention' })
    expect(summarize(status({ state: 'error', lastError: { code: 'failed', message: 'x' } })).tone).toBe('attention')
    // Sentence case, no shouting.
    for (const s of [status(), status({ paused: true }), status({ state: 'error' }), status({ state: 'offline' }), status({ state: 'needs-auth' })]) {
      expect(summarize(s).label).toMatch(/^[A-Z][^A-Z!]*$/)
    }
  })

  it('describes a line of activity and a merge that had to choose', () => {
    expect(describeActivity(activity({ sent: 1 }))).toBe('Sent 1 page')
    expect(describeActivity(activity({ sent: 3, received: 2, from: 'Desk' }))).toBe('Sent 3 pages, received 2 pages from Desk')
    expect(describeActivity(activity({ received: 1, from: 'Desk' }))).toBe('Received 1 page from Desk')
    expect(describeActivity(activity({ appearance: true }))).toBe('Appearance updated')
    expect(describeActivity(activity({ error: 'offline' }))).toBe('Could not sync')
    expect(describeActivity(activity({ sent: 1, error: 'rejected' }))).toBe('Sent 1 page, then stopped with a problem')
    expect(describeActivity(activity())).toBe('Nothing to sync')
    const two = activity({ conflicts: [{ pageId: 'p', title: 'Plan', blocks: 1 }, { pageId: 'q', title: 'Notes', blocks: 1 }] })
    expect(conflictMessage(two)).toBe('2 blocks were changed on both devices; the other versions are in version history')
    expect(conflictMessage(activity({ conflicts: [{ pageId: 'p', title: 'Plan', blocks: 1 }] }))).toBe('1 block was changed on both devices; the other version is in version history')
  })

  it('checks the address and the passphrase as they are typed', () => {
    expect(urlProblem('')).toBeNull()
    expect(urlProblem('  https://github.com/me/notes.git  ')).toBeNull()
    expect(urlProblem('git@github.com:me/notes.git')).toBeNull()
    expect(urlProblem('https://me:token@github.com/me/notes.git')).toContain('Remove the user name')
    expect(urlProblem('http://github.com/me/notes.git')).toContain('HTTPS address')
    expect(urlProblem('C:\\notes')).not.toBeNull()
    expect(passphraseProblem('', '')).toBeNull()
    expect(passphraseProblem('short', '')).toBe('Use at least 8 characters.')
    expect(passphraseProblem('long enough', '')).toBeNull()
    expect(passphraseProblem('long enough', 'long enoug')).toBe('The two passphrases are not the same.')
    expect(passphraseProblem('long enough', 'long enough')).toBeNull()
    expect(passphraseProblem('long enough', null)).toBeNull()
  })
})

describe('store', () => {
  type Store = typeof import('./store')
  type Toasts = typeof import('../ui/toast')
  type Ui = typeof import('../store/ui')
  let store: Store
  let toasts: Toasts
  let ui: Ui
  let emit: (next: SyncStatus) => void = () => undefined
  const api = {
    app: { getSetting: vi.fn<(key: string) => Promise<unknown>>(async () => null), setSetting: vi.fn(async () => undefined) },
    sync: {
      status: vi.fn<() => Promise<SyncStatus>>(async () => status()),
      onStatus: (listener: (next: SyncStatus) => void) => {
        emit = listener
        return () => undefined
      }
    }
  }
  const messages = (): string[] => toasts.useToasts.getState().toasts.map((item) => item.message)

  beforeAll(async () => {
    ;(globalThis as { window?: unknown }).window = { api }
    store = await import('./store')
    toasts = await import('../ui/toast')
    ui = await import('../store/ui')
  })

  beforeEach(() => {
    store.resetSyncStore()
    for (const item of toasts.useToasts.getState().toasts) toasts.dismissToast(item.id)
    ui.useUi.setState({ settingsOpen: false, settingsSection: null, historyPageId: null })
    api.app.getSetting.mockReset().mockResolvedValue(null)
    api.sync.status.mockReset().mockResolvedValue(status())
  })

  it('asks the main process nothing about sync on a device that does not sync', async () => {
    await store.initSync()
    expect(api.sync.status).not.toHaveBeenCalled()
    expect(store.useSync.getState()).toMatchObject({ loaded: true, status: { configured: false } })
  })

  it('loads the state on a device that syncs, without announcing old news', async () => {
    api.app.getSetting.mockResolvedValue('https://github.com/me/notes.git')
    const old = activity({ at: 500, conflicts: [{ pageId: 'p', title: 'Plan', blocks: 2 }] })
    api.sync.status.mockResolvedValue(status({ state: 'error', lastError: { code: 'rejected', message: 'Refused.' }, activity: [old] }))
    await store.initSync()
    expect(store.useSync.getState().status.state).toBe('error')
    expect(messages()).toEqual([])
    // The same problem and the same activity again: still nothing.
    emit(status({ state: 'syncing', lastError: { code: 'rejected', message: 'Refused.' }, activity: [old] }))
    emit(status({ state: 'error', lastError: { code: 'rejected', message: 'Refused.' }, activity: [old] }))
    expect(messages()).toEqual([])
  })

  it('announces a problem once, then stays quiet until it is over', async () => {
    await store.initSync()
    const offline = status({ state: 'offline', lastError: { code: 'offline', message: 'The repository could not be reached.' } })
    emit(status({ state: 'syncing' }))
    emit(offline)
    expect(messages()).toEqual(['sel is offline. Your changes will sync when the connection is back.'])
    for (const item of toasts.useToasts.getState().toasts) toasts.dismissToast(item.id)
    for (let i = 0; i < 5; i++) {
      emit({ ...offline, state: 'syncing' })
      emit(offline)
    }
    expect(messages()).toEqual([])
    // Back, then gone again: that is news.
    emit(status({ state: 'syncing' }))
    emit(status())
    emit(offline)
    expect(messages()).toHaveLength(1)
  })

  it('offers the way to the Sync settings for a problem that needs a person', async () => {
    await store.initSync()
    emit(status({ state: 'needs-auth', lastError: { code: 'auth-failed', message: 'Git is not signed in to this repository.' } }))
    const [item] = toasts.useToasts.getState().toasts
    expect(item).toMatchObject({ kind: 'error', message: 'Git is not signed in to this repository.' })
    expect(item.action?.label).toBe('Open Sync settings')
    item.action?.run()
    expect(ui.useUi.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'sync' })
  })

  it('tells about blocks changed on both devices once, with a way to review them', async () => {
    await store.initSync()
    const entry = activity({ at: 2000, received: 1, from: 'Desk', conflicts: [{ pageId: 'page-1', title: 'Plan', blocks: 2 }] })
    emit(status({ activity: [entry] }))
    expect(messages()).toEqual(['2 blocks were changed on both devices; the other versions are in version history'])
    const [item] = toasts.useToasts.getState().toasts
    expect(item.action?.label).toBe('Review')
    item.action?.run()
    expect(ui.useUi.getState().historyPageId).toBe('page-1')
    for (const shown of toasts.useToasts.getState().toasts) toasts.dismissToast(shown.id)
    // The same entry arriving again (every status carries the list) is not announced again.
    emit(status({ activity: [entry] }))
    emit(status({ activity: [activity({ at: 3000, sent: 1 }), entry] }))
    expect(messages()).toEqual([])
  })

  it('hands a synced appearance to the appearance engine of every window', async () => {
    const posted: unknown[] = []
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = class {
      constructor(readonly name: string) {}
      postMessage(message: unknown): void {
        posted.push({ channel: this.name, message })
      }
      close(): void {}
    }
    await store.initSync()
    const data = { version: 1, light: { '--accent': '#ff0000' }, dark: {}, shared: {}, customCss: '', presetId: null }
    api.app.getSetting.mockResolvedValue(data)
    emit(status({ activity: [activity({ at: 4000, received: 0, appearance: true })] }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(posted).toEqual([{ channel: 'appearance', message: { type: 'appearance', version: 1, data } }])
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel
  })
})
