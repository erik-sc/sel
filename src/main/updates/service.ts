import {
  cleanVersion,
  emptyUpdateStatus,
  releaseNotesUrl,
  UPDATES_CHECK_KEY,
  UPDATES_LAST_CHECK_KEY,
  UPDATES_PREVIEW_KEY,
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

/** `stable`: the published releases. `preview`: the test build of the release being prepared. */
export type Feed = 'stable' | 'preview'

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
  /**
   * Loads electron-updater for a feed: the releases, or the test builds. Called on the first
   * question to that feed, never before.
   */
  loadDriver(feed: Feed): Promise<UpdaterDriver>
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
  /** The driver of the feed the version on offer came from: the one that downloads and installs it. */
  private driver: UpdaterDriver | null = null
  private readonly loading = new Map<Feed, Promise<UpdaterDriver>>()
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
      preview: this.read(UPDATES_PREVIEW_KEY),
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
      const found = await this.newest()
      const version = found ? cleanVersion(found.version) : null
      if (version && found) {
        const same = version === this.state.version
        this.driver = found.driver
        this.update({ phase: 'available', version, notesUrl: releaseNotesUrl(version), dismissed: same && this.state.dismissed })
        // A test build is what this computer was asked to keep installed: it is downloaded
        // without asking, and installed at the next restart.
        if (found.feed === 'preview') this.download()
      } else {
        this.update({ phase: 'current', version: null, notesUrl: null, dismissed: false })
      }
    } catch (err) {
      this.deps.log('the check failed', err)
      this.update({ phase: 'error', version: null, notesUrl: null, error: CHECK_FAILED })
    }
  }

  /**
   * The newest version there is for this computer: a test build when it takes them and there is
   * one newer than what runs, otherwise a release. A release is always newer than its own test
   * builds, so the computer comes back to the releases by itself once one is published.
   */
  private async newest(): Promise<{ version: string; feed: Feed; driver: UpdaterDriver } | null> {
    if (this.read(UPDATES_PREVIEW_KEY) === true) {
      try {
        const driver = await this.load('preview')
        const found = await driver.check()
        if (found) return { version: found.version, feed: 'preview', driver }
      } catch (err) {
        // The releases are still asked: a test build that cannot be read is not a reason to miss one.
        this.deps.log('the check for a test build failed', err)
      }
    }
    const driver = await this.load('stable')
    const found = await driver.check()
    return found ? { version: found.version, feed: 'stable', driver } : null
  }

  private async fetch(): Promise<void> {
    try {
      const driver = this.driver ?? (await this.load('stable'))
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

  private load(feed: Feed): Promise<UpdaterDriver> {
    let loading = this.loading.get(feed)
    if (!loading) {
      loading = this.deps.loadDriver(feed).catch((err: unknown) => {
        this.loading.delete(feed)
        throw err
      })
      this.loading.set(feed, loading)
    }
    return loading
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
