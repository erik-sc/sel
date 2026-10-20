import { app, BrowserWindow } from 'electron'
import { UPDATES_CHANNEL } from '../../shared/updates'
import type { Repository } from '../db/repository'
import type { Handlers } from '../invoke'
import { resolveDevUrl } from '../security'
import { UpdatesService } from './service'
import { defineFeature, type Registered } from '../feature'

/**
 * The `updates:*` channels and the schedule of the opt-in update check (see ./service.ts).
 * Only the timer lives here from the start; electron-updater (./driver.ts) is imported the
 * first time GitHub is actually asked.
 *
 * Updates exist only in the installed Windows app. In development, `SEL_UPDATE_FEED` can name
 * a feed on this computer (`http://127.0.0.1:<port>/` serving a `latest.yml`) to try the flow;
 * a packaged app never reads the variable, and nothing but a loopback http address is taken.
 */

export interface UpdatesHooks {
  handlers: Handlers<'updates'>
  /** `updates.check` was written: start or stop the schedule. */
  settingChanged(): void
}

export function registerUpdatesIpc({ repo, recording }: { repo: Repository; recording(): boolean }): UpdatesHooks {
  const devFeed = resolveDevUrl(process.env['SEL_UPDATE_FEED'], app.isPackaged)
  const service = new UpdatesService({
    current: app.getVersion(),
    supported: process.platform === 'win32' && (app.isPackaged || devFeed !== undefined),
    getSetting: (key) => repo.getSetting(key),
    setSetting: (key, value) => repo.setSetting(key, value),
    recording,
    now: () => Date.now(),
    loadDriver: async () => (await import('./driver')).createDriver(devFeed),
    publish: (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(UPDATES_CHANNEL, status)
      }
    },
    quit: () => app.quit(),
    timers: {
      set: (run, ms) => setTimeout(run, ms).unref(),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout)
    },
    log: (message, err) => console.error(`[updates] ${message}`, err ?? '')
  })
  // After sync's last upload and the database are done: the installer waits for this process to end.
  app.on('quit', (_event, exitCode) => service.quitting(exitCode))
  service.plan()

  return {
    handlers: {
      'updates:status': () => service.status(),
      'updates:check': () => service.check(),
      'updates:download': () => service.download(),
      'updates:restart': () => service.restart(),
      'updates:dismiss': () => service.dismiss()
    },
    settingChanged: () => service.plan()
  }
}

/** Updates, opt-in, from GitHub Releases. Off by default: until the user turns the check on or presses Check now, nothing goes on the network. */
export const updatesFeature = defineFeature({
  namespace: 'updates',
  register: (ctx): Registered<'updates'> => {
    const hooks = registerUpdatesIpc({ repo: ctx.repo, recording: () => ctx.recording() })
    return {
      handlers: hooks.handlers,
      // The update check was turned on or off: its timer follows.
      onSettingChanged: (key) => {
        if (key.startsWith('updates.')) hooks.settingChanged()
      }
    }
  }
})
