import { randomBytes } from 'node:crypto'
import { MEETING_LIMITS } from '../../shared/meetings'

/**
 * Who may open the microphone and the computer's audio, and when. Free of Electron imports
 * (unit-tested); main/index.ts asks it from the session's permission handlers.
 *
 * Every permission of the renderer is denied by default. A window gets an exception only
 * after it asked the main process to begin a recording through a validated ipc call: that
 * issues a grant for that window, good for a few seconds, for audio only. Opening the
 * microphone or the loopback uses the grant up; while the recording runs the window may keep
 * the streams it has, and the moment it stops the grant is revoked and everything is denied
 * again. Camera video is never granted, to anybody.
 */

export interface Grant {
  token: string
  /** The `webContents.id` of the window that asked. */
  owner: number
  /** Until when the microphone and the loopback may be opened. */
  expiresAt: number
  mic: boolean
  system: boolean
  /** A probe only lists microphones: it ends by itself and is never a recording. */
  probe: boolean
  micOpened: boolean
  systemOpened: boolean
}

export interface RequestDetails {
  permission: string
  /** The window's `webContents.id`. */
  owner: number
  /** `details.isMainFrame`, and both the frame and the window showing the app itself. */
  trusted: boolean
  /** `details.mediaTypes` of a `media` request. */
  mediaTypes?: readonly string[]
}

export class GrantStore {
  private readonly grants = new Map<number, Grant>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs: number = MEETING_LIMITS.grantMs
  ) {}

  /** A new grant for `owner`, replacing any it had. */
  issue(owner: number, sources: { mic: boolean; system: boolean }, probe = false): Grant {
    const grant: Grant = {
      token: randomBytes(24).toString('base64url'),
      owner,
      expiresAt: this.now() + this.windowMs,
      mic: sources.mic,
      system: sources.system && !probe,
      probe,
      micOpened: false,
      systemOpened: false
    }
    this.grants.set(owner, grant)
    return grant
  }

  /** The recording stopped (or the window went away): nothing is allowed any more. */
  revoke(owner: number): void {
    this.grants.delete(owner)
  }

  revokeAll(): void {
    this.grants.clear()
  }

  get(owner: number): Grant | null {
    const grant = this.grants.get(owner)
    if (!grant) return null
    // A probe is over when its window is; a recording's grant lives until it is revoked.
    if (grant.probe && this.now() > grant.expiresAt) {
      this.grants.delete(owner)
      return null
    }
    return grant
  }

  private open(owner: number): Grant | null {
    const grant = this.get(owner)
    return grant && this.now() <= grant.expiresAt ? grant : null
  }

  /**
   * A permission *request* (something is about to be opened). True only for audio, from the
   * app's own top frame, inside the window of a grant, once per source. Camera video never.
   */
  allowRequest(details: RequestDetails): boolean {
    if (!details.trusted) return false
    const grant = this.open(details.owner)
    if (!grant) return false
    if (details.permission === 'media') {
      const types = details.mediaTypes ?? []
      // `getDisplayMedia` arrives as a media request that names no type (seen in Electron 44). It
      // only opens the way to the display-media handler, where `takeSystem` decides, once, what is
      // handed out: the loopback audio and nothing a page chose.
      if (types.length === 0) return grant.system && !grant.systemOpened
      // Exactly audio: a request that also names video is refused whole.
      if (types.length !== 1 || types[0] !== 'audio') return false
      if (!grant.mic || grant.micOpened) return false
      grant.micOpened = true
      return true
    }
    if (details.permission === 'display-capture') return grant.system && !grant.systemOpened
    return false
  }

  /** The loopback is about to be handed out (the display-media handler). Once per grant. */
  takeSystem(owner: number, trusted: boolean): boolean {
    const grant = trusted ? this.open(owner) : null
    if (!grant || !grant.system || grant.systemOpened) return false
    grant.systemOpened = true
    return true
  }

  /**
   * A permission *check* (Chromium asks before and while it uses a device, and to decide
   * whether device names are shown). True for audio while that window holds a grant.
   */
  allowCheck(details: { permission: string; owner: number | null; trusted: boolean; mediaType?: string }): boolean {
    if (!details.trusted || details.owner === null) return false
    if (details.permission !== 'media' || details.mediaType === 'video') return false
    return this.get(details.owner) !== null
  }
}

/** The one store of the app. */
export const recordingGrants = new GrantStore()
