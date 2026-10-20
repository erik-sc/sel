import { app, BrowserWindow } from 'electron'
import { defineFeature, type Registered } from '../feature'
import type { SyncBridge } from './index'

/**
 * The `sync:*` channels: they drive the git installed on this computer (see ./index.ts). Loaded
 * when this device is connected to a repository, or when a window first asks. What a sync changes
 * in the database reaches the windows like any other change, from the origin `sync` that no window has.
 */

const SYNC_URL_KEY = 'sync.remoteUrl'

export interface SyncRegistered extends Registered<'sync'> {
  /** Something changed on this device: uploaded once things have been quiet for a moment. Nothing when sync is not loaded. */
  noteLocalChange(): void
  /** A last upload on the way out, bounded to a few seconds; null when there is nothing to wait for. */
  beforeQuit(): Promise<void> | null
}

export const syncFeature = defineFeature({
  namespace: 'sync',
  register(ctx): SyncRegistered {
    let bridge: SyncBridge | null = null
    const sync = async (): Promise<SyncBridge> =>
      (bridge ??= new (await import('./index')).SyncBridge(
        ctx.repo,
        // What a sync wrote came from the remote: it is not a change to upload again.
        () => ctx.changes('sync', { local: false }),
        () => ctx.feature('briefing').calendarSync()
      ))
    const windowOf = (event: { sender: Electron.WebContents }): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender)
    app.on('will-quit', () => bridge?.dispose())
    return {
      noteLocalChange: () => bridge?.noteLocalChange(),
      beforeQuit: () => (bridge?.wantsQuitSync ? bridge.beforeQuit() : null),
      // Like the daily backup, sync waits until the first window is on screen.
      start() {
        if (typeof ctx.repo.getSetting(SYNC_URL_KEY) !== 'string') return
        sync().then(
          (loaded) => loaded.start(),
          (err: unknown) => console.error('[main] sync could not be started', err)
        )
      },
      handlers: {
        'sync:status': async () => (await sync()).status(),
        'sync:setup': async ([a]) => (await sync()).setup(a),
        'sync:now': async () => (await sync()).now(),
        'sync:pause': async ([a]) => (await sync()).pause(a),
        'sync:disconnect': async ([a]) => (await sync()).disconnect(a),
        'sync:unlock': async ([a]) => (await sync()).unlock(a),
        'sync:setEncryption': async ([a]) => (await sync()).setEncryption(a),
        // Goes through a native dialog: the renderer never names a path to run.
        'sync:pickGit': async (_args, event) => (await sync()).pickGit(windowOf(event))
      }
    }
  }
})
