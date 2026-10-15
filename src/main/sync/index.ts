import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, safeStorage } from 'electron'
import { cleanBranch, isPassphrase, SYNC_CHANNEL, SYNC_LIMITS, type SyncErrorCode, type SyncSetup, type SyncStatus } from '../../shared/sync'
import type { Repository } from '../db/repository'
import { filesDir, sniffImage } from '../files'
import { SyncEngine, type SecretStore } from './engine'
import type { CalendarSync } from './format'
import { inspectGit } from './git'

/**
 * Sync as the app uses it: the engine wired to the profile directory, the OS keychain, the
 * windows and the clock. Loaded when a device is connected, or the first time a window asks
 * for anything about sync; never at start-up otherwise.
 */

/** After the last local change, before uploading: a burst of typing is one upload. */
const DEBOUNCE_MS = 8000
/** While nothing changes here: how often to look for what other devices sent. */
const IDLE_INTERVAL_MS = 5 * 60_000
/** How long the app may take to upload on its way out. Quitting never waits for the network longer. */
const QUIT_BUDGET_MS = 4000
/** Waits between automatic attempts after consecutive failures. */
const BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000]
/** Failures no retry can fix: automatic attempts stop until something changes. */
const NEEDS_A_PERSON: ReadonlySet<SyncErrorCode> = new Set(['git-not-found', 'not-sel-repo', 'passphrase-required', 'wrong-passphrase', 'unsupported-format', 'repo-not-found'])

/**
 * Whether a folder on this computer may be used as the remote: for development and automated
 * checks only. A shipped app never takes this from the environment.
 */
export function allowLocalRemotes(raw: string | undefined, isPackaged: boolean): boolean {
  return !isPackaged && raw === '1'
}

/** The derived keys, encrypted by the OS keychain into a file of the profile. Never the passphrase, never in the settings. */
function keychainStore(file: string): SecretStore {
  return {
    load() {
      try {
        if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
        return safeStorage.decryptString(readFileSync(file))
      } catch {
        return null
      }
    },
    save(value) {
      if (value === null) {
        rmSync(file, { force: true })
        return
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('No secure storage')
      writeFileSync(file, safeStorage.encryptString(value), { mode: 0o600 })
    }
  }
}

function plain(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sync request')
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw new Error('Invalid sync request')
  return value as Record<string, unknown>
}

const SETUP_KEYS: ReadonlySet<string> = new Set(['remoteUrl', 'branch', 'deviceName', 'mode', 'passphrase', 'useAnyway'])

/** A setup request from a renderer, reduced to the fields that exist, each of the expected type. */
export function syncSetup(value: unknown): SyncSetup {
  const raw = plain(value)
  for (const key of Object.keys(raw)) if (!SETUP_KEYS.has(key)) throw new Error('Invalid sync request')
  if (typeof raw['remoteUrl'] !== 'string' || raw['remoteUrl'].length > SYNC_LIMITS.url) throw new Error('Invalid repository address')
  const out: SyncSetup = { remoteUrl: raw['remoteUrl'] }
  if (raw['branch'] !== undefined && raw['branch'] !== null) {
    const branch = cleanBranch(raw['branch'])
    if (branch === null) throw new Error('Invalid branch name')
    out.branch = branch
  }
  if (raw['deviceName'] !== undefined && raw['deviceName'] !== null) {
    if (typeof raw['deviceName'] !== 'string' || raw['deviceName'].length > 200) throw new Error('Invalid device name')
    out.deviceName = raw['deviceName']
  }
  if (raw['mode'] !== undefined && raw['mode'] !== null) {
    if (raw['mode'] !== 'merge' && raw['mode'] !== 'replace') throw new Error('Invalid mode')
    out.mode = raw['mode']
  }
  if (raw['passphrase'] !== undefined && raw['passphrase'] !== null) {
    if (!isPassphrase(raw['passphrase'])) throw new Error(`A passphrase has between ${SYNC_LIMITS.passphraseMin} and ${SYNC_LIMITS.passphraseMax} characters`)
    out.passphrase = raw['passphrase']
  }
  if (raw['useAnyway'] !== undefined && raw['useAnyway'] !== null) {
    if (typeof raw['useAnyway'] !== 'boolean') throw new Error('Invalid sync request')
    out.useAnyway = raw['useAnyway']
  }
  return out
}

export class SyncBridge {
  readonly engine: SyncEngine
  private debounce: NodeJS.Timeout | null = null
  private interval: NodeJS.Timeout | null = null
  private failures = 0
  private notBefore = 0
  private stopped: SyncErrorCode | null = null
  private started = false

  constructor(
    private readonly repo: Repository,
    /** Tells the windows about blocks a sync changed. */
    broadcast: () => void,
    /** This device's connected calendars (the briefing's store), for an encrypted repository. */
    calendars?: () => Promise<CalendarSync>
  ) {
    const dir = join(app.getPath('userData'), 'sync')
    mkdirSync(dir, { recursive: true })
    this.engine = new SyncEngine({
      repo,
      dir,
      filesDir: filesDir(),
      hostName: hostname(),
      allowLocal: allowLocalRemotes(process.env['SEL_SYNC_ALLOW_LOCAL'], app.isPackaged),
      secrets: keychainStore(join(dir, 'keys.bin')),
      acceptImage: (bytes) => sniffImage(bytes) !== null,
      onApplied: broadcast,
      calendars,
      onStatus: (status) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(SYNC_CHANNEL, status)
        }
      }
    })
  }

  // ---- triggers

  /** Starts the timers: a sync right away (at launch), then every few minutes while the app is open. */
  start(immediately = true): void {
    if (this.started) return
    this.started = true
    this.interval = setInterval(() => this.attempt(), IDLE_INTERVAL_MS)
    this.interval.unref()
    if (immediately) this.attempt()
  }

  /** A change was made on this device: upload once things have been quiet for a moment. */
  noteLocalChange(): void {
    this.engine.noteLocalChange()
    if (!this.started) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      this.attempt()
    }, DEBOUNCE_MS)
    this.debounce.unref()
  }

  /** The appearance settings were changed here: remember when, for the merge. */
  noteAppearanceChange(): void {
    this.repo.setSetting('sync.appearanceAt', Date.now())
    this.noteLocalChange()
  }

  /** An automatic cycle, unless the last failures say to wait (or that waiting cannot help). */
  private attempt(): void {
    const status = this.engine.status()
    if (!status.configured || status.paused || this.stopped || Date.now() < this.notBefore) return
    void this.engine.auto().then((error) => this.settle(error?.code ?? null))
  }

  private settle(code: SyncErrorCode | null): void {
    if (code === null || code === 'cancelled') {
      this.failures = 0
      this.notBefore = 0
      this.stopped = null
      return
    }
    if (NEEDS_A_PERSON.has(code)) {
      this.stopped = code
      return
    }
    this.failures += 1
    this.notBefore = Date.now() + BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length) - 1]
  }

  /** Something a person did may have fixed what stopped the automatic attempts. */
  private reset(): void {
    this.failures = 0
    this.notBefore = 0
    this.stopped = null
  }

  /**
   * Called when the app is about to quit: uploads what is pending if that fits in a few
   * seconds, and gives up otherwise (it is picked up at the next launch).
   */
  async beforeQuit(): Promise<void> {
    if (this.debounce) clearTimeout(this.debounce)
    if (this.interval) clearInterval(this.interval)
    this.started = false
    if (!this.engine.hasPending || this.stopped || Date.now() < this.notBefore) return
    let timer: NodeJS.Timeout | undefined
    const budget = new Promise<void>((done) => {
      timer = setTimeout(done, QUIT_BUDGET_MS)
    })
    await Promise.race([this.engine.auto().then(() => undefined), budget])
    clearTimeout(timer)
    this.engine.cancel()
  }

  get wantsQuitSync(): boolean {
    return this.started && this.engine.hasPending && !this.stopped && Date.now() >= this.notBefore
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce)
    if (this.interval) clearInterval(this.interval)
    this.engine.dispose()
  }

  // ---- what a window can ask for

  status(): SyncStatus {
    return this.engine.status()
  }

  async setup(raw: unknown): Promise<SyncStatus> {
    const input = syncSetup(raw)
    if (input.passphrase !== undefined && !safeStorage.isEncryptionAvailable()) {
      return {
        ...this.engine.status(),
        lastError: { code: 'failed', message: 'This computer has no secure place to keep the key, so encryption cannot be used on it.' }
      }
    }
    const status = await this.engine.setup(input)
    this.reset()
    // The setup just synced: only the timers are needed.
    if (status.configured) this.start(false)
    return status
  }

  async now(): Promise<SyncStatus> {
    this.reset()
    const status = await this.engine.now()
    this.settle(status.lastError?.code ?? null)
    return status
  }

  pause(paused: unknown): SyncStatus {
    if (typeof paused !== 'boolean') throw new Error('Invalid sync request')
    const status = this.engine.pause(paused)
    if (!paused) {
      this.reset()
      this.attempt()
    }
    return status
  }

  async disconnect(raw: unknown): Promise<SyncStatus> {
    // The only kind of disconnect there is: the repository is never touched.
    if (plain(raw)['keepRemote'] !== true) throw new Error('Invalid sync request')
    if (this.debounce) clearTimeout(this.debounce)
    this.reset()
    return this.engine.disconnect()
  }

  async unlock(passphrase: unknown): Promise<SyncStatus> {
    if (!isPassphrase(passphrase)) throw new Error('Invalid passphrase')
    this.reset()
    return this.engine.unlock(passphrase)
  }

  async setEncryption(passphrase: unknown): Promise<SyncStatus> {
    if (passphrase !== null && !isPassphrase(passphrase)) throw new Error(`A passphrase has between ${SYNC_LIMITS.passphraseMin} and ${SYNC_LIMITS.passphraseMax} characters`)
    if (passphrase !== null && !safeStorage.isEncryptionAvailable()) throw new Error('This computer has no secure place to keep the key')
    this.reset()
    return this.engine.setEncryption(passphrase)
  }

  /**
   * The only way a path to git enters the settings: the user picks a file in the native
   * dialog, and it is kept only if it is a regular file named like git. Null when cancelled.
   */
  async pickGit(win: BrowserWindow | null): Promise<SyncStatus | null> {
    const windows = process.platform === 'win32'
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the git program',
      buttonLabel: 'Choose',
      properties: ['openFile'],
      filters: windows ? [{ name: 'git', extensions: ['exe'] }] : undefined
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    if (result.canceled || !file) return null
    const found = inspectGit(file)
    if (!found) return { ...this.engine.status(), lastError: { code: 'git-not-found', message: 'That file is not the git program.' } }
    this.engine.setGitPath(found)
    this.reset()
    return this.engine.status()
  }
}
