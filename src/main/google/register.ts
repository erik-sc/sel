import { join } from 'node:path'
import { app, safeStorage, shell } from 'electron'
import { defineFeature, type Registered } from '../feature'
import { feedTasks } from '../tasks/feed'
import * as arg from '../validate'
import type { Fetch } from './oauth'
import { GoogleService } from './service'
import { GoogleStore, type Cipher } from './store'

/**
 * The `google:*` channels (shared/google.ts), and the timer that keeps the calendar up to date
 * while sel is signed in. Nothing here runs, and Google is never contacted, until the user gives
 * sel an OAuth client and signs in.
 */

/** How often the tasks are looked at. Google is asked only when something changed. */
const EVERY_MS = 60_000

const cipher: Cipher = {
  isAvailable: () => {
    try {
      // On Linux without a keyring, safeStorage falls back to a fixed key: that is not storage.
      if (!safeStorage.isEncryptionAvailable()) return false
      return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
    } catch {
      return false
    }
  },
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data)
}

export const googleFeature = defineFeature({
  namespace: 'google',
  register: (ctx): Registered<'google'> => {
    let service: GoogleService | null = null
    const get = (): GoogleService => {
      service ??= new GoogleService({
        fetch: globalThis.fetch as unknown as Fetch,
        store: new GoogleStore(join(app.getPath('userData'), 'google.bin'), cipher),
        tasks: () => feedTasks(ctx.repo),
        open: (url) =>
          void shell.openExternal(url).catch((error: unknown) => console.error('[google] the browser could not be opened', error)),
        now: Date.now,
        timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        log: (message, error) => console.error(`[google] ${message}`, error ?? '')
      })
      return service
    }
    return {
      handlers: {
        'google:status': async () => get().status(),
        'google:configure': async ([id, secret]) => get().configure(arg.text(id, 'client id', 200), arg.text(secret, 'client secret', 200)),
        'google:signIn': async () => get().signIn(),
        'google:signOut': async () => get().signOut(),
        'google:sync': async () => {
          await get().sync()
          return get().status()
        }
      },
      start: () => {
        const tick = (): void => {
          void ctx.ready.then(() => get().sync()).catch((error: unknown) => console.error('[google] sync failed', error))
        }
        const timer = setInterval(tick, EVERY_MS)
        timer.unref()
        app.on('will-quit', () => clearInterval(timer))
        tick()
      }
    }
  }
})
