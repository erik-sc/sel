/**
 * Updates from the project's GitHub Releases, opt-in. Off by default: until the user turns
 * `updates.check` on, sel never asks GitHub anything by itself; Check now is the user asking.
 * A new version is downloaded only when the user says so, and installed when sel quits or
 * restarts at their request. The main process does all of it (src/main/updates); a window
 * only reads the status and passes on what the user chose.
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */

import type { SettingsSpec } from './settings'

/** Where releases are published, and where a version's notes are read. */
export const RELEASES_URL = 'https://github.com/erik-sc/sel/releases'

/**
 * `idle`: nothing asked yet. `checking`: asking GitHub. `current`: this is the newest version.
 * `available`: a newer one exists (`version`). `downloading`: the user said yes (`percent`).
 * `ready`: downloaded; it is installed when sel quits. `error`: the last step failed (`error`).
 */
export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  /** The version running now. */
  current: string
  /** False in a development build without a test feed: there is nothing to update. */
  supported: boolean
  phase: UpdatePhase
  /** The newer version, once one is known. */
  version: string | null
  /** Its release notes on GitHub (built from the version, never taken from the feed). */
  notesUrl: string | null
  /** 0 to 100 while downloading. */
  percent: number
  /** When GitHub was last asked (ms since the epoch), by the schedule or by Check now. */
  checkedAt: number | null
  /** A short, user-safe reason when `phase` is `error`. */
  error: string | null
  /** The user put the notice away ("Later"); Settings still shows the state. */
  dismissed: boolean
}

export interface UpdatesApi {
  status(): Promise<UpdateStatus>
  /** Asks GitHub now, whatever `updates.check` says: the user pressed Check now. */
  check(): Promise<UpdateStatus>
  /** The user agreed: download the version found. It is installed when sel quits or restarts. */
  download(): Promise<void>
  /** Quits, installs the downloaded version and starts it. Refused while a meeting is recorded. */
  restart(): Promise<void>
  /** "Later": hides the notice in every window until something new happens. */
  dismiss(): Promise<void>
  /** `updates:status`: the status changed. Returns an unsubscribe function. */
  onStatus(listener: (status: UpdateStatus) => void): () => void
}

export const UPDATES_CHANNEL = 'updates:status'

// ---- settings -----------------------------------------------------------------

/** Whether sel looks for a new version by itself, once a day. Off unless the user turns it on. */
export const UPDATES_CHECK_KEY = 'updates.check'
/** When GitHub was last asked. Written by the main process only. */
export const UPDATES_LAST_CHECK_KEY = 'updates.lastCheck'

/** The keys a renderer may write. `updates.lastCheck` belongs to the main process. */
export const UPDATES_KEYS = [UPDATES_CHECK_KEY] as const

/** The value an updates setting accepts from a renderer, or undefined when it does not. */
export function cleanUpdatesSetting(key: string, value: unknown): unknown {
  return key === UPDATES_CHECK_KEY && typeof value === 'boolean' ? value : undefined
}

// ---- versions -----------------------------------------------------------------

const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/

/** A version as releases name it (`0.3.0`, `1.0.0-beta.1`), or null for anything else. */
export function cleanVersion(value: unknown): string | null {
  return typeof value === 'string' && VERSION_RE.test(value) ? value : null
}

/** The release page of a version; releases are tagged `v<version>`. */
export function releaseNotesUrl(version: string): string | null {
  const clean = cleanVersion(version)
  return clean ? `${RELEASES_URL}/tag/v${clean}` : null
}

export function emptyUpdateStatus(current: string, supported: boolean): UpdateStatus {
  return {
    current,
    supported,
    phase: 'idle',
    version: null,
    notesUrl: null,
    percent: 0,
    checkedAt: null,
    error: null,
    dismissed: false
  }
}

/** Whether sel looks for updates by itself decides whether it goes on the network: a boolean. */
export const UPDATES_SETTINGS: SettingsSpec = { keys: UPDATES_KEYS, clean: cleanUpdatesSetting }
