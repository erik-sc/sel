import {
  cleanVersion,
  emptyUpdateStatus,
  releaseNotesUrl,
  UPDATES_CHECK_KEY,
  UPDATES_LAST_CHECK_KEY,
  type UpdateStatus
} from '../../shared/updates'
import { nextCheck } from './schedule'

/**
 * The state of updates and what the user decided about them: when to ask GitHub (./schedule.ts),
 * what was found, the download the user agreed to, and the install on the way out. What talks to
 * GitHub is the driver (./driver.ts, electron-updater), and it is loaded only when a question is
 * actually asked: with `updates.check` off and Check now never pressed, it is never loaded, and
 * nothing goes on the network.
 *
 * Free of Electron: register.ts wires it. Unit-tested with a fake driver.
 */

/** What electron-updater does for this service. */
export interface UpdaterDriver {
  /** Asks the feed. The newer version, or null when the running one is the newest. */
  check(): Promise<{ version: string } | null>
  /** Downloads the version found by the last check and verifies it; `percent` goes from 0 to 100. */
  download(onProgress: (percent: number) => void): Promise<void>
  /** Starts the installer, which waits for sel to exit. Synchronous: it runs while quitting. */
  install(relaunch: boolean): boolean
}

export interface Timers {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface UpdatesDeps {
  /** The version running now. */
  current: string
  /** Whether this build can be updated at all (see register.ts). */
  supported: boolean
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  /** A meeting is being recorded. */
  recording(): boolean
  now(): number
  /** Loads electron-updater. Called on the first question to GitHub, never before. */
  loadDriver(): Promise<UpdaterDriver>
  /** Tells every window. */
  publish(status: UpdateStatus): void
  /** Quits the app the ordinary way (sync, recording guard, then `quitting`). */
  quit(): void
  timers: Timers
  log(message: string, err?: unknown): void
}

const CHECK_FAILED = 'sel could not reach GitHub to look for a new version.'
const DOWNLOAD_FAILED = 'The download did not finish. Try again later.'

export class UpdatesService {
  private state: UpdateStatus
  private driver: UpdaterDriver | null = null
  private loading: Promise<UpdaterDriver> | null = null
  private asking: Promise<void> | null = null
  private timer: unknown = null
  private readonly startedAt: number
  /** The user agreed to this version being installed (they asked for the download). */
  private consented = false
  /** Start the new version once installed: the user pressed Restart now. */
  private relaunch = false

  constructor(private readonly deps: UpdatesDeps) {
    this.state = emptyUpdateStatus(deps.current, deps.supported)
    this.startedAt = deps.now()
  }

  status(): UpdateStatus {
    return { ...this.state }
  }

  /** Decides, again, when to ask by itself. Call on start and whenever `updates.check` changes. */
  plan(): void {
    this.clearTimer()
    const { phase } = this.state
    const decision = nextCheck({
      enabled: this.read(UPDATES_CHECK_KEY),
      supported: this.deps.supported,
      recording: this.deps.recording(),
      pending: phase === 'downloading' || phase === 'ready',
      now: this.deps.now(),
      startedAt: this.startedAt,
      lastCheck: this.read(UPDATES_LAST_CHECK_KEY)
    })
    if (decision.kind === 'off') return
    if (decision.kind === 'wait') {
      this.timer = this.deps.timers.set(() => this.plan(), decision.ms)
      return
    }
    void this.ask().finally(() => this.plan())
  }

  /** Check now: the user asks, whatever the setting says. */
  async check(): Promise<UpdateStatus> {
    if (!this.deps.supported) throw new Error('Updates work only in the installed app.')
    await this.ask()
    return this.status()
  }

  /** The user agreed to the version found: download it in the background. Progress is published. */
  download(): void {
    const { phase, version } = this.state
    if (phase === 'downloading' || phase === 'ready') return
    if (!version || (phase !== 'available' && phase !== 'error')) throw new Error('There is no new version to download.')
    this.update({ phase: 'downloading', percent: 0, error: null, dismissed: false })
    void this.fetch()
  }

  /** Restart now: quit the ordinary way; the installer starts on the way out and opens sel again. */
  restart(): void {
    if (this.state.phase !== 'ready') throw new Error('No new version is ready to install.')
    if (this.deps.recording()) throw new Error('Stop the recording first. sel can restart once it is saved.')
    this.relaunch = true
    this.deps.quit()
  }

  dismiss(): void {
    if (!this.state.dismissed) this.update({ dismissed: true })
  }

  /** The app is quitting (Electron's `quit`, after everything else is closed). */
  quitting(exitCode: number): void {
    this.clearTimer()
    if (!this.consented || this.state.phase !== 'ready' || exitCode !== 0 || !this.driver) return
    try {
      this.driver.install(this.relaunch)
    } catch (err) {
      this.deps.log('the installer could not be started', err)
    }
  }

  dispose(): void {
    this.clearTimer()
  }

  // ---- inside

  private ask(): Promise<void> {
    const { phase } = this.state
    if (phase === 'downloading' || phase === 'ready') return Promise.resolve()
    this.asking ??= this.askOnce().finally(() => (this.asking = null))
    return this.asking
  }

  private async askOnce(): Promise<void> {
    const now = this.deps.now()
    // Written first: a check that fails still counts, so a broken network is not asked again and again.
    this.write(UPDATES_LAST_CHECK_KEY, now)
    this.update({ phase: 'checking', checkedAt: now, error: null })
    try {
      const found = await (await this.load()).check()
      const version = found ? cleanVersion(found.version) : null
      if (version) {
        const same = version === this.state.version
        this.update({ phase: 'available', version, notesUrl: releaseNotesUrl(version), dismissed: same && this.state.dismissed })
      } else {
        this.update({ phase: 'current', version: null, notesUrl: null, dismissed: false })
      }
    } catch (err) {
      this.deps.log('the check failed', err)
      this.update({ phase: 'error', version: null, notesUrl: null, error: CHECK_FAILED })
    }
  }

  private async fetch(): Promise<void> {
    try {
      const driver = await this.load()
      await driver.download((percent) => {
        const rounded = Math.max(0, Math.min(100, Math.floor(percent)))
        if (this.state.phase === 'downloading' && rounded !== this.state.percent) this.update({ percent: rounded })
      })
      this.consented = true
      // Something new: the notice comes back once, even if it was put away while downloading.
      this.update({ phase: 'ready', percent: 100, dismissed: false })
    } catch (err) {
      this.deps.log('the download failed', err)
      this.update({ phase: 'error', error: DOWNLOAD_FAILED, dismissed: false })
    }
  }

  private load(): Promise<UpdaterDriver> {
    this.loading ??= this.deps.loadDriver().then(
      (driver) => (this.driver = driver),
      (err: unknown) => {
        this.loading = null
        throw err
      }
    )
    return this.loading
  }

  private update(patch: Partial<UpdateStatus>): void {
    this.state = { ...this.state, ...patch }
    this.deps.publish(this.status())
  }

  private read(key: string): unknown {
    try {
      return this.deps.getSetting(key)
    } catch {
      return null
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.deps.setSetting(key, value)
    } catch (err) {
      this.deps.log(`could not store ${key}`, err)
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) this.deps.timers.clear(this.timer)
    this.timer = null
  }
}
