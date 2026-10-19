/**
 * Sync: the shapes shared by the main process (which drives git and merges) and the renderer
 * (which shows the state and asks for a setup). One person, several devices: sel keeps a
 * clone of a private repository the user owns and exchanges pages through it. sel stores no
 * token; git signs in with whatever the user set up on this computer.
 */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'needs-setup' | 'needs-auth'

export type SyncErrorCode =
  | 'git-not-found'
  | 'auth-failed'
  | 'repo-not-found'
  | 'offline'
  | 'not-sel-repo'
  | 'rejected'
  | 'conflict-retry-exhausted'
  | 'disk-full'
  | 'failed'
  /** The address is not an https or ssh git address. */
  | 'invalid-url'
  /** This device has pages and the repository already holds a workspace: `mode` is needed. */
  | 'needs-choice'
  /** The repository is encrypted and no passphrase was given on this device. */
  | 'passphrase-required'
  | 'wrong-passphrase'
  /** Written by a newer sel. */
  | 'unsupported-format'
  | 'cancelled'

export interface SyncError {
  code: SyncErrorCode
  message: string
}

/** A page that had blocks changed on both devices in one cycle. */
export interface SyncConflictPage {
  pageId: string
  title: string
  blocks: number
}

/** One cycle that did something, newest first in `SyncStatus.activity`. */
export interface SyncActivity {
  at: number
  /** Pages uploaded / pages changed on this device by what was downloaded. */
  sent: number
  received: number
  conflicts: SyncConflictPage[]
  /** The other device, when something was received. */
  from?: string
  /** The appearance settings were replaced by the synced ones. */
  appearance?: boolean
  error?: SyncErrorCode
}

export interface SyncStatus {
  configured: boolean
  state: SyncState
  remoteUrl?: string
  branch: string
  deviceName: string
  lastSyncAt?: number
  lastError?: SyncError
  /** Pages changed on this device and not uploaded yet. */
  pending: number
  encrypted: boolean
  gitVersion?: string
  paused: boolean
  activity: SyncActivity[]
  /** Development builds only: a folder on this computer is accepted as the repository. */
  localRemotes?: true
}

export type SyncMode = 'merge' | 'replace'

export interface SyncSetup {
  remoteUrl: string
  branch?: string
  deviceName?: string
  /** First sync when both this device and the repository have pages. */
  mode?: SyncMode
  passphrase?: string
  /** The repository has other files and no sel data: add sel's files next to them. */
  useAnyway?: boolean
}

export const SYNC_CHANNEL = 'sync:status'
export const SYNC_DEFAULT_BRANCH = 'main'

export const SYNC_LIMITS = {
  url: 512,
  branch: 100,
  deviceName: 48,
  passphraseMin: 8,
  passphraseMax: 256,
  activity: 10
} as const

export const SYNC_MESSAGES: Record<SyncErrorCode, string> = {
  'git-not-found': 'Git was not found on this computer. Install Git, or choose the git program.',
  'auth-failed':
    'Git is not signed in to this repository. Sign in to GitHub with git on this computer (for example with Git Credential Manager or "gh auth login"), then try again. sel stores no token.',
  'repo-not-found':
    'The repository was not found. Check the address, and that git on this computer is signed in to an account that can open it.',
  offline: 'The repository could not be reached. sel will try again when the connection is back.',
  'not-sel-repo': 'This repository has other files in it and no sel data.',
  rejected: 'The repository refused the upload. Check that this account can write to it and that the branch is not protected.',
  'conflict-retry-exhausted': 'Another device kept uploading at the same moment. sel will try again shortly.',
  'disk-full': 'There is not enough free disk space to sync.',
  failed: 'Sync could not be completed.',
  'invalid-url': 'Enter the HTTPS or SSH address of a git repository, without a user name or token in it.',
  'needs-choice': 'This device already has pages, and so does the repository. Choose what to do with the pages of this device.',
  'passphrase-required': 'This repository is encrypted. Enter its passphrase.',
  'wrong-passphrase': 'The passphrase is not the one this repository was encrypted with.',
  'unsupported-format': 'This repository was written by a newer version of sel. Update sel on this device.',
  cancelled: 'Sync was stopped.'
}

// ---- validation (shared so that the field in Settings says the same as the main process) ----

const CONTROL_OR_SPACE_RE = /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/
const SSH_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
const IPV6_HOST_RE = /^\[[0-9A-Fa-f:.]{2,45}\]$/
/** `user@host:path`, the short form git prints for ssh. The path never starts with a dash. */
const SCP_RE = /^([A-Za-z0-9_][A-Za-z0-9._-]{0,63})@([A-Za-z0-9.-]{1,253}):([A-Za-z0-9._~/+-]{1,400})$/
const REMOTE_PATH_RE = /^\/[A-Za-z0-9._~/+-]{1,400}$/

export type RemoteUrlProblem = 'empty' | 'too-long' | 'characters' | 'scheme' | 'credentials' | 'host' | 'path'

export type RemoteUrlResult = { ok: true; url: string; kind: 'https' | 'ssh' | 'local' } | { ok: false; problem: RemoteUrlProblem }

export const REMOTE_URL_PROBLEMS: Record<RemoteUrlProblem, string> = {
  empty: 'Enter the address of your repository.',
  'too-long': 'The address is too long.',
  characters: 'The address contains spaces or characters a repository address cannot have.',
  scheme: 'Use the HTTPS address (https://…) or the SSH address (git@…) of the repository.',
  credentials: 'Remove the user name, password or token from the address. Git signs in by itself.',
  host: 'The address has no valid server name.',
  path: 'The address has no repository path.'
}

function validHost(host: string): boolean {
  return (HOST_RE.test(host) && host.length <= 253) || IPV6_HOST_RE.test(host)
}

/**
 * Checks the address of a remote. Accepted: `https://host/path`, `ssh://[user@]host[:port]/path`
 * and `user@host:path`. Refused: every other transport (`http:`, `git:`, `file:`, `ext::…`,
 * anything `name::address`), credentials inside the address, a server or path that starts with
 * a dash (git or ssh would read it as an option), and whitespace or control characters anywhere.
 * `allowLocal` (tests and unpackaged builds only) also accepts an absolute folder path.
 */
export function checkRemoteUrl(value: unknown, allowLocal = false): RemoteUrlResult {
  if (typeof value !== 'string' || value === '') return { ok: false, problem: 'empty' }
  if (value.length > SYNC_LIMITS.url) return { ok: false, problem: 'too-long' }
  if (CONTROL_OR_SPACE_RE.test(value) && !(allowLocal && isLocalPath(value))) return { ok: false, problem: 'characters' }
  if (value.startsWith('-')) return { ok: false, problem: 'scheme' }

  if (allowLocal && isLocalPath(value)) {
    if (/[\u0000-\u001f\u007f]/.test(value) || value.includes('::')) return { ok: false, problem: 'characters' }
    return { ok: true, url: value, kind: 'local' }
  }
  // `transport::address` runs a remote helper (`ext::sh -c …`): never.
  if (value.includes('::')) return { ok: false, problem: 'scheme' }
  if (value.includes('\\')) return { ok: false, problem: 'characters' }

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value)
  if (scheme) {
    const name = scheme[1].toLowerCase()
    if (name !== 'https' && name !== 'ssh') return { ok: false, problem: 'scheme' }
    // Read from the text itself, piece by piece: a URL parser would quietly repair an address
    // (`https:///x`, `/a/../b`, `a@b@host`) into something other than what git is given.
    const rest = value.slice(scheme[0].length)
    const slash = rest.search(/[/?#]/)
    const authority = slash < 0 ? rest : rest.slice(0, slash)
    const path = slash < 0 ? '' : rest.slice(slash)
    const at = authority.lastIndexOf('@')
    const user = at < 0 ? null : authority.slice(0, at)
    const hostPort = at < 0 ? authority : authority.slice(at + 1)
    if (user !== null && (name === 'https' || !SSH_USER_RE.test(user))) return { ok: false, problem: 'credentials' }
    const port = /^(.*):(\d{1,5})$/.exec(hostPort)
    const host = port ? port[1] : hostPort
    if (!host || !validHost(host) || (port !== null && Number(port[2]) > 65535)) return { ok: false, problem: 'host' }
    if (path.includes('?') || path.includes('#')) return { ok: false, problem: 'path' }
    if (!REMOTE_PATH_RE.test(path) || path.includes('/-') || path.includes('..') || path.includes('//') || path === '/')
      return { ok: false, problem: 'path' }
    // And the parser has to agree about what it is.
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return { ok: false, problem: 'host' }
    }
    if (
      parsed.protocol !== `${name}:` ||
      parsed.password ||
      parsed.hostname.toLowerCase() !== host.toLowerCase() ||
      parsed.pathname !== path
    )
      return { ok: false, problem: 'host' }
    return { ok: true, url: value, kind: name }
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:(?!\/)/.test(value) && !value.includes('@')) return { ok: false, problem: 'scheme' }

  const scp = SCP_RE.exec(value)
  if (!scp) return { ok: false, problem: value.includes('@') ? 'host' : 'scheme' }
  const [, , host, path] = scp
  if (!validHost(host)) return { ok: false, problem: 'host' }
  if (path.startsWith('-') || path.includes('/-') || path.includes('..')) return { ok: false, problem: 'path' }
  return { ok: true, url: value, kind: 'ssh' }
}

function isLocalPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || (value.startsWith('/') && !value.startsWith('//'))
}

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/

/** A branch name git accepts and that can never be read as an option or a revision expression. */
export function cleanBranch(value: unknown): string | null {
  if (typeof value !== 'string' || !BRANCH_RE.test(value)) return null
  if (
    value.includes('..') ||
    value.includes('//') ||
    value.includes('/.') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock')
  )
    return null
  return value
}

/**
 * The name this device signs its uploads with: letters, digits, spaces and a little
 * punctuation, never starting with a dash. It ends up in a commit, so it is kept dull.
 */
export function cleanDeviceName(value: unknown, fallback = 'This device'): string {
  const text = typeof value === 'string' ? value.normalize('NFKC') : ''
  const clean = text
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ._'()-]/gu, '')
    .replace(/ +/g, ' ')
    .replace(/^[-. ]+/, '')
    .trim()
    .slice(0, SYNC_LIMITS.deviceName)
    .trim()
  return clean || fallback
}

export function isPassphrase(value: unknown): value is string {
  return typeof value === 'string' && value.length >= SYNC_LIMITS.passphraseMin && value.length <= SYNC_LIMITS.passphraseMax
}

export function emptySyncStatus(): SyncStatus {
  return {
    configured: false,
    state: 'needs-setup',
    branch: SYNC_DEFAULT_BRANCH,
    deviceName: '',
    pending: 0,
    encrypted: false,
    paused: false,
    activity: []
  }
}
