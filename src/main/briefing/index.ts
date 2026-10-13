import { join } from 'node:path'
import { app, BrowserWindow, safeStorage } from 'electron'
import { BRIEFING_CHANGED } from '../../shared/briefing'
import type { Repository } from '../db/repository'
import { CalendarService } from './calendars'
import { devLoopback, type NetPolicy } from './net'
import { CalendarStore, type Cipher } from './secrets'
import { BriefingService } from './service'

/**
 * The briefing wired to the app: the profile directory, the key store of the operating system
 * and the windows. Loaded the first time a window asks for anything of it (see ./register.ts),
 * not at start-up; nothing here runs, and no request is made, until then.
 *
 * Files, all under `<userData>/briefing/`:
 *   calendars.bin        the connected calendars and their secret addresses, encrypted with
 *                        `safeStorage`. A credential store: never synced, exported or logged
 *                        (see ./secrets.ts).
 *   calendar-cache.json  the events last read, so the agenda shows at once and offline.
 */

/** The key store, refused where it would only pretend to encrypt (Linux without a keyring). */
const cipher: Cipher = {
  isAvailable() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false
      return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
    } catch {
      return false
    }
  },
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data)
}

export class BriefingBridge {
  readonly service: BriefingService

  constructor(repo: Repository) {
    const dir = join(app.getPath('userData'), 'briefing')
    // A local stub calendar for development and automated checks. Only an unpackaged build
    // reads the variable: a shipped app never takes a network exception from the environment.
    const loopback = devLoopback(process.env['SELIDA_BRIEFING_LOOPBACK'], app.isPackaged)
    const policy = (): NetPolicy => ({ allowLoopbackHttp: loopback })
    const store = new CalendarStore(join(dir, 'calendars.bin'), cipher, policy)
    const calendars = new CalendarService({ store, cacheFile: join(dir, 'calendar-cache.json'), policy, onChange: () => this.changed() })
    this.service = new BriefingService({ repo, store, calendars })
  }

  /** Tells every window that what the Today screen shows may have changed. Carries no data. */
  changed(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(BRIEFING_CHANGED)
    }
  }
}
