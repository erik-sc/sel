import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { NsisUpdater, type Logger, type ProgressInfo } from 'electron-updater'
import type { UpdaterDriver } from './service'

/**
 * electron-updater, for the NSIS installer sel ships as. Loaded by register.ts on the first
 * question to GitHub and never before.
 *
 * - The feed is the one electron-builder writes into the app (`resources/app-update.yml`, from
 *   `publish` in electron-builder.yml): the project's GitHub Releases, read over https in the
 *   main process, in a session of its own that no window shares.
 * - Nothing happens by itself: no download until the user asks for one, no install on quit
 *   unless they did (the service decides; electron-updater's own on-quit install is off).
 * - The app is not code-signed, so there is no publisher to verify; what is verified is the
 *   SHA-512 of the download against the one in the release's `latest.yml`.
 */

const logger: Logger = {
  info: (message?: unknown) => console.info('[updates]', message),
  warn: (message?: unknown) => console.warn('[updates]', message),
  error: (message?: unknown) => console.error('[updates]', message)
}

/**
 * electron-updater's codes for "GitHub answered: there is no release here to update to" (none at
 * all, or the latest has no `latest.yml`: a 404). A failure to reach GitHub has other codes.
 */
const NOTHING_TO_UPDATE_TO: ReadonlySet<string> = new Set(['ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'])

/**
 * `devFeed`: development only, a feed on this computer (`SEL_UPDATE_FEED`, see register.ts).
 * It is written as the dev update config, which electron-updater reads instead of the packaged one.
 */
export function createDriver(devFeed?: string): UpdaterDriver {
  const updater = new NsisUpdater()
  updater.logger = logger
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.disableWebInstaller = true
  if (devFeed) {
    const config = join(app.getPath('userData'), 'dev-app-update.yml')
    writeFileSync(config, `provider: generic\nurl: ${JSON.stringify(devFeed)}\nupdaterCacheDirName: sel-updater-dev\n`)
    updater.updateConfigPath = config
    updater.forceDevUpdateConfig = true
  }

  return {
    async check() {
      try {
        const result = await updater.checkForUpdates()
        return result?.isUpdateAvailable ? { version: result.updateInfo.version } : null
      } catch (err) {
        // GitHub answered, but its latest release is not one to update to (published before
        // updates existed, or without its `latest.yml`): as far as updates go, there is nothing newer.
        const code = (err as { code?: unknown } | null)?.code
        if (typeof code === 'string' && NOTHING_TO_UPDATE_TO.has(code)) {
          logger.warn(`no usable release: ${code}`)
          return null
        }
        throw err
      }
    },
    async download(onProgress) {
      const listener = (progress: ProgressInfo): void => onProgress(progress.percent)
      updater.on('download-progress', listener)
      try {
        await updater.downloadUpdate()
      } finally {
        updater.off('download-progress', listener)
      }
    },
    // Silent: the installer shows no wizard; `relaunch` starts the new version when it is done.
    install: (relaunch) => updater.install(true, relaunch)
  }
}
