import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { cleanBriefingSetting } from '../../shared/briefing'
import { cleanHome } from '../../shared/home'
import { cleanSidebar } from '../../shared/sidebar'
import { plainText } from '../../shared/richtext'
import {
  checkRemoteUrl,
  cleanBranch,
  cleanDeviceName,
  isPassphrase,
  SYNC_DEFAULT_BRANCH,
  SYNC_LIMITS,
  SYNC_MESSAGES,
  type SyncActivity,
  type SyncConflictPage,
  type SyncError,
  type SyncSetup,
  type SyncStatus
} from '../../shared/sync'
import type { Block, RichText } from '../../shared/types'
import type { Repository, SyncChange } from '../db/repository'
import {
  createEncryption,
  exportKeys,
  hiddenName,
  importKeys,
  keysMatch,
  open,
  seal,
  unlockEncryption,
  WrongKeyError,
  type Keys
} from './crypto'
import {
  APP,
  cleanCalendars,
  FILE_NAME_RE,
  fingerprintPages,
  FORMAT,
  FormatError,
  imageNames,
  LEGACY,
  mergeAppearance,
  mergeHome,
  mergeSidebar,
  mergeCalendars,
  noCalendars,
  pagesOf,
  pageTree,
  parseAppearance,
  parseHome,
  parseSidebar,
  parseCalendars,
  parseMeta,
  parsePage,
  parseRoot,
  PATHS,
  README_MARK,
  README_TEXT,
  serializeAppearance,
  serializeHome,
  serializeSidebar,
  serializeCalendars,
  serializeMeta,
  serializePage,
  serializeRoot,
  sha1,
  workspaceFromPages,
  workspaceFromRows,
  type AppearanceFile,
  type HomeFile,
  type SidebarFile,
  type CalendarsFile,
  type CalendarSync,
  type EncryptionParams,
  type RepoMeta
} from './format'
import { classifyGitFailure, Git, isCommitId, isNonFastForward, locateGit, parseGitVersion, SyncFailure } from './git'
import { checkWorkspace, diffWorkspace, emptyWorkspace, mergeWorkspace, pageOf, type SyncBlock, type Workspace } from './merge'

/**
 * The sync cycle. One at a time, each step restartable:
 *
 *   look at what changed here → fetch → if the repository moved: merge it into the database
 *   (one transaction, which also records the commit that was merged) → write the files of the
 *   pages that changed → commit → push → record what was uploaded.
 *
 * `sync.lastCommit` is the commit the database last agreed with: the base of the next merge.
 * It only ever names a commit that is on the remote, so a clone that was lost or damaged can
 * be made again and the merge repeated. Nothing is forced, and nothing but sel's own clone
 * is ever reset or cleaned.
 *
 * Free of Electron: the app wires it to windows, safeStorage and timers in ./index.ts.
 */

/** Where the passphrase-derived keys are kept: one opaque string, stored by the OS keychain in the app. */
export interface SecretStore {
  load(): string | null
  /** May throw when this computer has no secure storage. */
  save(value: string | null): void
}

export type SyncStep = 'fetch' | 'apply' | 'write' | 'commit' | 'push' | 'record'

export interface SyncEngineOptions {
  repo: Repository
  /** `<userData>/sync`: the clone lives in `repo` below it. */
  dir: string
  /** `<userData>/files`: where the images of pages are stored. */
  filesDir: string
  /** The default device name. */
  hostName: string
  /** Accept a folder path as the remote (tests, unpackaged builds). */
  allowLocal: boolean
  secrets: SecretStore
  /** True when the bytes are an image the app stores (see files.ts `sniffImage`). */
  acceptImage: (bytes: Uint8Array) => boolean
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  clock?: () => number
  onStatus?: (status: SyncStatus) => void
  /** The database was changed by a sync: time to tell the windows. */
  onApplied?: () => void
  /**
   * This device's connected calendars. They go into the repository, and come out of it, only
   * when it is encrypted: their addresses are credentials. Loaded only for such a repository.
   */
  calendars?: () => CalendarSync | Promise<CalendarSync>
  /** Tests: runs before each step; throwing simulates a crash right there. */
  beforeStep?: (step: SyncStep) => void | Promise<void>
  /** Tests: every git argument array and environment. */
  onSpawn?: (args: readonly string[], env: Readonly<Record<string, string>>) => void
  retries?: number
  backoffMs?: number
  /** Tests: cheaper key derivation. */
  kdfCost?: { N: number; r: number; p: number }
}

const KEYS = {
  url: 'sync.remoteUrl',
  branch: 'sync.branch',
  device: 'sync.deviceName',
  lastCommit: 'sync.lastCommit',
  lastSyncAt: 'sync.lastSyncAt',
  paused: 'sync.paused',
  gitPath: 'sync.gitPath',
  activity: 'sync.activity',
  useAnyway: 'sync.useAnyway',
  appearanceAt: 'sync.appearanceAt',
  /** When the home was last changed: decides which device's choice stands. */
  homeAt: 'sync.homeAt',
  /** When the sidebar's layout was last changed: decides which device's layout stands. */
  sidebarAt: 'sync.sidebarAt',
  encrypted: 'sync.encrypted',
  /** `replace` until the first download: this device's pages give way to the workspace. */
  firstMode: 'sync.firstMode',
  /** When `briefing.databases` was last changed: decides which device's choice stands. */
  briefingAt: 'sync.briefingAt'
} as const
const APPEARANCE_KEY = 'appearance'
const HOME_KEY = 'home'
const SIDEBAR_KEY = 'sidebar'
const DATABASES_KEY = 'briefing.databases'
/** Entries of `sync_state` that are not pages. `~` cannot be part of a block id. */
const STATE_ROOT = '~root'
const STATE_APPEARANCE = '~appearance'
const STATE_HOME = '~home'
const STATE_SIDEBAR = '~sidebar'
const STATE_CALENDARS = '~calendars'
const STATE_META = '~meta'
const DIRTY = ''
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MID_OPERATION = [
  'MERGE_HEAD',
  'MERGE_MSG',
  'MERGE_MODE',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'rebase-merge',
  'rebase-apply',
  'AUTO_MERGE'
]
const LOCKS = ['index.lock', 'HEAD.lock', 'config.lock', 'packed-refs.lock', 'shallow.lock', 'FETCH_HEAD.lock', 'ORIG_HEAD.lock', 'gc.pid']

interface Config {
  url: string
  branch: string
  device: string
  useAnyway: boolean
}

interface Secrets {
  /** salt (base64) → keys */
  keys: Record<string, { enc: string; name: string }>
  /** The parameters a brand-new repository will be created with. */
  pending?: EncryptionParams
}

/** How logical files map to what is stored in a tree: as they are, or sealed under hidden names. */
interface Codec {
  encrypted: boolean
  pathOf(logical: string): string
  encode(logical: string, bytes: Buffer): Buffer
  /** The content, checked to be the file `logical` when the caller knows which one it expects. */
  decode(bytes: Buffer, logical?: string): { logical: string | null; bytes: Buffer }
}

const PLAIN: Codec = {
  encrypted: false,
  pathOf: (logical) => logical,
  encode: (_logical, bytes) => bytes,
  decode: (bytes) => ({ logical: null, bytes })
}

function sealed(keys: Keys): Codec {
  const hidden = (logical: string): string => {
    for (const dir of [PATHS.pages, PATHS.files]) if (logical.startsWith(dir)) return `${dir}${hiddenName(keys, logical)}.bin`
    return logical
  }
  return {
    encrypted: true,
    pathOf: hidden,
    encode: (logical, bytes) => seal(keys, logical, bytes, !logical.startsWith(PATHS.files)),
    decode: (bytes, logical) => {
      const opened = open(keys, bytes)
      if (logical !== undefined && opened.name !== logical) throw new FormatError('A file of the repository is not the one its name says')
      return { logical: opened.name, bytes: opened.bytes }
    }
  }
}

interface ParsedPage {
  pageId: string
  text: string
  blocks: SyncBlock[]
}

/** One commit of the repository, read and checked. */
interface RepoTree {
  commit: string | null
  meta: RepoMeta | null
  codec: Codec
  /** Stored path → blob id, for everything in the tree. */
  entries: Map<string, string>
  pages: Map<string, ParsedPage>
  rootText: string | null
  appearanceText: string | null
  appearance: AppearanceFile | null
  homeText: string | null
  home: HomeFile | null
  sidebarText: string | null
  sidebar: SidebarFile | null
  /** Read only from an encrypted tree: anywhere else the file is ignored. */
  calendarsText: string | null
  calendars: CalendarsFile | null
  ws: Workspace
  /** Files that are not sel's. */
  foreign: number
  /** The device that made the commit. */
  author: string
}

interface Outcome {
  sent: number
  received: number
  conflicts: SyncConflictPage[]
  from?: string
  appearance: boolean
}

function emptyTree(): RepoTree {
  return {
    commit: null,
    meta: null,
    codec: PLAIN,
    entries: new Map(),
    pages: new Map(),
    rootText: null,
    appearanceText: null,
    appearance: null,
    homeText: null,
    home: null,
    sidebarText: null,
    sidebar: null,
    calendarsText: null,
    calendars: null,
    ws: emptyWorkspace(),
    foreign: 0,
    author: 'another device'
  }
}

function isOurPath(path: string): boolean {
  return (
    path === PATHS.meta ||
    path === LEGACY.meta ||
    path === PATHS.readme ||
    path === PATHS.readmeAlt ||
    path === LEGACY.readmeAlt ||
    path === PATHS.workspace ||
    path === PATHS.appearance ||
    path === PATHS.home ||
    path === PATHS.sidebar ||
    path === PATHS.calendars ||
    path.startsWith(PATHS.pages) ||
    path.startsWith(PATHS.files)
  )
}

function toFailure(err: unknown): SyncFailure {
  if (err instanceof SyncFailure) return err
  if (err instanceof FormatError)
    return err.newer
      ? new SyncFailure('unsupported-format')
      : new SyncFailure('failed', 'The repository holds data sel cannot read. Nothing was changed on this device.')
  if (err instanceof WrongKeyError) return new SyncFailure('wrong-passphrase')
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT') return new SyncFailure('disk-full')
  return new SyncFailure('failed')
}

export class SyncEngine {
  private readonly repo: Repository
  private readonly repoDir: string
  private readonly hooksDir: string
  private readonly clock: () => number
  private readonly retries: number
  private readonly backoffMs: number
  private chain: Promise<unknown> = Promise.resolve()
  private queued: Promise<SyncStatus> | null = null
  private running = false
  private lastError: SyncError | undefined
  private pending = 0
  private gitVersion: string | undefined
  private git: Git | null = null
  private cancelled = false
  private disposed = false
  /** Parsed page files by blob id: a tree that shares blobs with the previous one is not read twice. */
  private blobs = new Map<string, ParsedPage>()

  constructor(private readonly options: SyncEngineOptions) {
    this.repo = options.repo
    this.repoDir = join(options.dir, 'repo')
    this.hooksDir = join(options.dir, 'no-hooks')
    this.clock = options.clock ?? Date.now
    this.retries = options.retries ?? 4
    this.backoffMs = options.backoffMs ?? 400
  }

  // ---------------------------------------------------------------- settings

  private setting<T>(key: string): T | null {
    try {
      return this.repo.getSetting<T>(key)
    } catch {
      return null
    }
  }

  private config(): Config | null {
    const url = this.setting<unknown>(KEYS.url)
    if (typeof url !== 'string') return null
    const checked = checkRemoteUrl(url, this.options.allowLocal)
    if (!checked.ok) return null
    return {
      url: checked.url,
      branch: cleanBranch(this.setting(KEYS.branch)) ?? SYNC_DEFAULT_BRANCH,
      device: this.deviceName(),
      useAnyway: this.setting(KEYS.useAnyway) === true
    }
  }

  private deviceName(): string {
    return cleanDeviceName(this.setting(KEYS.device), cleanDeviceName(this.options.hostName))
  }

  private lastCommit(): string | null {
    const value = this.setting<unknown>(KEYS.lastCommit)
    return isCommitId(value) ? value : null
  }

  private activity(): SyncActivity[] {
    const value = this.setting<unknown>(KEYS.activity)
    return Array.isArray(value)
      ? (value.filter(
          (item) => item !== null && typeof item === 'object' && typeof (item as SyncActivity).at === 'number'
        ) as SyncActivity[])
      : []
  }

  private secrets(): Secrets {
    try {
      const raw = this.options.secrets.load()
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof (parsed as Secrets).keys === 'object' &&
        (parsed as Secrets).keys !== null
      )
        return parsed as Secrets
    } catch {
      /* unreadable: as if there were none */
    }
    return { keys: {} }
  }

  private keysFor(params: EncryptionParams): Keys | null {
    const stored = this.secrets().keys
    return Object.hasOwn(stored, params.salt) ? importKeys(stored[params.salt]) : null
  }

  private rememberKeys(params: EncryptionParams, keys: Keys, pending: boolean): void {
    const secrets = this.secrets()
    // The few most recent ones: an older commit may still have to be read with the previous key.
    const kept = Object.entries(secrets.keys)
      .filter(([salt]) => salt !== params.salt)
      .slice(-3)
    const next: Secrets = { keys: Object.fromEntries([...kept, [params.salt, exportKeys(keys)]]) }
    if (pending) next.pending = params
    this.options.secrets.save(JSON.stringify(next))
  }

  // ------------------------------------------------------------------ status

  status(): SyncStatus {
    const config = this.config()
    const lastSyncAt = this.setting<unknown>(KEYS.lastSyncAt)
    const status: SyncStatus = {
      configured: config !== null,
      state: 'idle',
      branch: config?.branch ?? SYNC_DEFAULT_BRANCH,
      deviceName: this.deviceName(),
      pending: this.pending,
      encrypted: config !== null && this.setting(KEYS.encrypted) === true,
      paused: this.setting(KEYS.paused) === true,
      activity: config ? this.activity() : []
    }
    if (config) status.remoteUrl = config.url
    if (this.options.allowLocal) status.localRemotes = true
    if (typeof lastSyncAt === 'number') status.lastSyncAt = lastSyncAt
    if (this.gitVersion) status.gitVersion = this.gitVersion
    if (this.lastError) status.lastError = this.lastError
    if (this.running) status.state = 'syncing'
    else if (!config) status.state = 'needs-setup'
    else if (this.lastError?.code === 'auth-failed') status.state = 'needs-auth'
    else if (this.lastError?.code === 'offline') status.state = 'offline'
    else if (this.lastError) status.state = 'error'
    return status
  }

  private emit(): void {
    if (this.disposed) return
    try {
      this.options.onStatus?.(this.status())
    } catch (err) {
      console.error('[sync] status listener failed', err)
    }
  }

  /** Something changed on this device (the app calls this after every mutation). */
  noteLocalChange(): void {
    if (this.pending === 0 && this.config()) {
      this.pending = 1
      this.emit()
    }
  }

  // ------------------------------------------------------------ serialising

  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Runs a cycle (after the one in progress, if any). Calls made while one is waiting share it. */
  now(): Promise<SyncStatus> {
    if (this.queued) return this.queued
    const run = this.exclusive(async () => {
      this.queued = null
      await this.runCycle()
      return this.status()
    })
    this.queued = run
    return run
  }

  /** Stops the cycle in progress as soon as git can be stopped. The database is never left half-written. */
  cancel(): void {
    if (!this.running) return
    this.cancelled = true
    this.git?.cancel()
  }

  dispose(): void {
    this.cancel()
    this.disposed = true
  }

  pause(paused: boolean): SyncStatus {
    this.repo.setSetting(KEYS.paused, paused ? true : null)
    if (paused) this.cancel()
    this.emit()
    return this.status()
  }

  /** The git chosen in the native dialog (null: look for it again). */
  setGitPath(path: string | null): void {
    this.repo.setSetting(KEYS.gitPath, path)
    this.gitVersion = undefined
    if (this.lastError?.code === 'git-not-found') this.lastError = undefined
    this.emit()
  }

  private checkCancelled(): void {
    if (this.cancelled || this.disposed) throw new SyncFailure('cancelled')
  }

  private async step(step: SyncStep): Promise<void> {
    this.checkCancelled()
    await this.options.beforeStep?.(step)
  }

  // --------------------------------------------------------------------- git

  private async openGit(device: string): Promise<Git> {
    const explicit = this.setting<unknown>(KEYS.gitPath)
    const gitPath = locateGit({
      explicit: typeof explicit === 'string' ? explicit : null,
      env: this.options.env,
      platform: this.options.platform
    })
    if (!gitPath) throw new SyncFailure('git-not-found')
    await mkdir(this.hooksDir, { recursive: true })
    await mkdir(this.repoDir, { recursive: true })
    const git = new Git({
      gitPath,
      cwd: this.repoDir,
      deviceName: device,
      hooksDir: this.hooksDir,
      allowLocal: this.options.allowLocal,
      env: this.options.env,
      platform: this.options.platform,
      onSpawn: this.options.onSpawn
    })
    this.git = git
    if (!this.gitVersion) {
      const version = parseGitVersion((await git.run(['--version'], { timeoutMs: 15_000 })).stdout.toString('utf8'))
      if (!version) throw new SyncFailure('git-not-found')
      this.gitVersion = version
    }
    return git
  }

  /** Removes the clone. Only ever the folder this engine made, inside its own directory. */
  private async removeClone(): Promise<void> {
    const base = resolve(this.options.dir)
    const target = resolve(this.repoDir)
    if (target !== join(base, 'repo') || !target.startsWith(base + sep))
      throw new Error('Refusing to remove a folder that is not the clone')
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    this.blobs.clear()
  }

  /** Leftovers of a git that was killed: lock files, and the markers of an operation in progress. */
  private clearLeftovers(): void {
    const gitDir = join(this.repoDir, '.git')
    if (!existsSync(gitDir)) return
    for (const name of [...LOCKS, ...MID_OPERATION]) rmSync(join(gitDir, name), { recursive: true, force: true })
    const sweep = (dir: string, depth: number): void => {
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        const full = join(dir, name)
        if (name.endsWith('.lock')) rmSync(full, { force: true })
        else if (depth < 6 && !name.includes('.')) sweep(full, depth + 1)
      }
    }
    sweep(join(gitDir, 'refs'), 0)
  }

  /** A clone that exists, points at the configured remote and has nothing left over from a crash. */
  private async ensureClone(git: Git, config: Config): Promise<void> {
    const gitDir = join(this.repoDir, '.git')
    if (existsSync(gitDir)) {
      this.clearLeftovers()
      // The usual case costs no process: a clone whose own files name the configured remote.
      if (this.remoteInConfig() === config.url && existsSync(join(gitDir, 'HEAD')) && existsSync(join(gitDir, 'objects'))) return
      const probe = await git.run(['rev-parse', '--git-dir'], { allowFailure: true })
      const url = probe.code === 0 ? await git.run(['config', '--get', 'remote.origin.url'], { allowFailure: true }) : null
      if (probe.code === 0 && url && url.code === 0 && url.stdout.toString('utf8').trim() === config.url) return
      if (probe.code === 0 && url) {
        // The same clone, another address (or none): point it at the right one.
        await git.run(['remote', 'remove', 'origin'], { allowFailure: true })
        const added = await git.run(['remote', 'add', '--', 'origin', config.url], { allowFailure: true })
        if (added.code === 0) return
      }
      await this.removeClone()
    }
    await mkdir(this.repoDir, { recursive: true })
    await git.run(['init', '-q'])
    await git.run(['remote', 'add', '--', 'origin', config.url])
  }

  /** The address of `origin` as the clone's config file has it; null when it cannot be told. */
  private remoteInConfig(): string | null {
    try {
      const text = readFileSync(join(this.repoDir, '.git', 'config'), 'utf8')
      const section = /\[remote "origin"\]([^[]*)/.exec(text)
      const url = section ? /^\s*url\s*=\s*(.*?)\s*$/m.exec(section[1]) : null
      if (!url) return null
      // git writes a backslash as two, and quotes values with special characters.
      return url[1].replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1')
    } catch {
      return null
    }
  }

  /** The commit a ref of the clone points at, read from its file; null when it has to be asked from git. */
  private refInFiles(ref: string): string | null {
    try {
      const sha = readFileSync(join(this.repoDir, '.git', ...ref.split('/')), 'utf8').trim()
      return isCommitId(sha) ? sha : null
    } catch {
      return null
    }
  }

  /** Downloads the branch. Returns its head, or null when the remote has no such branch (an empty repository). */
  private async fetch(git: Git, branch: string): Promise<string | null> {
    const ref = `refs/remotes/origin/${branch}`
    const result = await git.run(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${branch}:${ref}`], {
      allowFailure: true,
      network: true
    })
    if (result.code !== 0) {
      if (!/couldn'?t find remote ref|no such ref was fetched/i.test(result.stderr)) {
        throw classifyGitFailure(result.stderr, result.code)
      }
      await git.run(['update-ref', '-d', ref], { allowFailure: true })
      return null
    }
    const known = this.refInFiles(ref)
    if (known) return known
    const head = await git.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true })
    const sha = head.stdout.toString('utf8').trim()
    return head.code === 0 && isCommitId(sha) ? sha : null
  }

  /** The contents of blobs, in one git process. */
  private async readBlobs(git: Git, shas: readonly string[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>()
    const wanted = [...new Set(shas)]
    if (!wanted.length) return out
    const { stdout } = await git.run(['cat-file', '--batch'], {
      input: `${wanted.join('\n')}\n`,
      maxOutputBytes: 1024 * 1024 * 1024,
      timeoutMs: 5 * 60_000
    })
    let at = 0
    while (at < stdout.length) {
      const eol = stdout.indexOf(0x0a, at)
      if (eol < 0) break
      const [sha, type, size] = stdout.subarray(at, eol).toString('latin1').split(' ')
      at = eol + 1
      if (type === 'missing' || size === undefined) continue
      const length = Number(size)
      if (!Number.isInteger(length) || length < 0 || at + length > stdout.length)
        throw new SyncFailure('failed', SYNC_MESSAGES.failed, true)
      if (type === 'blob' || type === 'commit') out.set(sha, stdout.subarray(at, at + length))
      at += length + 1
    }
    return out
  }

  /**
   * Reads one commit: what it is, and every page in it. Null when the clone has no such commit;
   * throws when reading it needs a key this device does not have.
   */
  private async readTree(git: Git, commit: string): Promise<RepoTree | null> {
    const listing = await git.run(['ls-tree', '-r', '-z', '--full-tree', commit, '--'], { allowFailure: true })
    if (listing.code !== 0) {
      if (/not a valid object name|not a tree object|bad object|unknown revision|bad revision/i.test(listing.stderr)) return null
      throw classifyGitFailure(listing.stderr, listing.code)
    }
    const tree = emptyTree()
    tree.commit = commit
    for (const line of listing.stdout.toString('utf8').split('\0')) {
      const tab = line.indexOf('\t')
      if (tab < 0) continue
      const [, type, sha] = line.slice(0, tab).split(' ')
      const path = line.slice(tab + 1)
      if (type === 'blob') tree.entries.set(path, sha)
    }
    for (const path of tree.entries.keys()) if (!isOurPath(path)) tree.foreign++
    const metaSha = tree.entries.get(PATHS.meta) ?? tree.entries.get(LEGACY.meta)
    const pageShas: string[] = []
    if (metaSha) for (const [path, sha] of tree.entries) if (path.startsWith(PATHS.pages)) pageShas.push(sha)
    const rootSha = metaSha ? tree.entries.get(PATHS.workspace) : undefined
    const appearanceSha = metaSha ? tree.entries.get(PATHS.appearance) : undefined
    const homeSha = metaSha ? tree.entries.get(PATHS.home) : undefined
    const sidebarSha = metaSha ? tree.entries.get(PATHS.sidebar) : undefined
    const calendarsSha = metaSha ? tree.entries.get(PATHS.calendars) : undefined
    const missing = pageShas.filter((sha) => !this.blobs.has(sha))
    // Everything in one go: the commit itself (who made it), the meta file, and the files not seen before.
    const settingShas = [rootSha, appearanceSha, homeSha, sidebarSha, calendarsSha].filter((sha): sha is string => sha !== undefined)
    const blobs = await this.readBlobs(git, [commit, ...(metaSha ? [metaSha] : []), ...missing, ...settingShas])
    const author = /^author (.*?) <[^>]*> \d+ [+-]\d{4}$/m.exec((blobs.get(commit) ?? Buffer.alloc(0)).toString('utf8').split('\n\n', 1)[0])
    tree.author = cleanDeviceName(author?.[1], 'another device')
    if (!metaSha) return tree
    tree.meta = parseMeta((blobs.get(metaSha) ?? Buffer.alloc(0)).toString('utf8'))
    if (tree.meta.encryption) {
      const keys = this.keysFor(tree.meta.encryption)
      if (!keys) throw new SyncFailure('passphrase-required')
      if (!keysMatch(keys, tree.meta.encryption)) throw new SyncFailure('wrong-passphrase')
      tree.codec = sealed(keys)
    }
    const next = new Map<string, ParsedPage>()
    for (const sha of pageShas) {
      let page = this.blobs.get(sha)
      if (!page) {
        const raw = blobs.get(sha)
        if (!raw) throw new SyncFailure('failed', SYNC_MESSAGES.failed, true)
        const decoded = tree.codec.decode(raw)
        const text = decoded.bytes.toString('utf8')
        const parsed = parsePage(text)
        if (decoded.logical !== null && decoded.logical !== `${PATHS.pages}${parsed.pageId}.json`)
          throw new FormatError('A page file is not the one its name says')
        page = { pageId: parsed.pageId, text, blocks: parsed.blocks }
      }
      next.set(sha, page)
      if (!tree.pages.has(page.pageId)) tree.pages.set(page.pageId, page)
    }
    // Only the last trees read stay in memory.
    for (const [sha, page] of this.blobs) if (!next.has(sha) && next.size < 50_000) next.set(sha, page)
    this.blobs = next
    const text = (sha: string | undefined, logical: string): string | null => {
      const raw = sha ? blobs.get(sha) : undefined
      return raw ? tree.codec.decode(raw, tree.codec.encrypted ? logical : undefined).bytes.toString('utf8') : null
    }
    tree.rootText = text(rootSha, PATHS.workspace)
    tree.appearanceText = text(appearanceSha, PATHS.appearance)
    tree.appearance = tree.appearanceText === null ? null : parseAppearance(tree.appearanceText)
    tree.homeText = text(homeSha, PATHS.home)
    tree.home = tree.homeText === null ? null : parseHome(tree.homeText)
    tree.sidebarText = text(sidebarSha, PATHS.sidebar)
    tree.sidebar = tree.sidebarText === null ? null : parseSidebar(tree.sidebarText)
    // Calendars are taken only from where sel puts them: sealed with the workspace's key.
    if (tree.codec.encrypted) {
      tree.calendarsText = text(calendarsSha, PATHS.calendars)
      tree.calendars = tree.calendarsText === null ? null : parseCalendars(tree.calendarsText)
    }
    tree.ws = workspaceFromPages(
      [...tree.pages.values()].map((page) => page.blocks),
      tree.rootText === null ? null : parseRoot(tree.rootText)
    )
    return tree
  }

  /** Makes the working tree and the branch exactly `commit` (or empty, before the first commit). */
  private async prepareTree(git: Git, branch: string, commit: string | null): Promise<void> {
    this.clearLeftovers()
    if (commit) {
      await git.run(['checkout', '-q', '-f', '-B', branch, commit, '--'])
      await git.run(['clean', '-q', '-f', '-d', '-x'])
      return
    }
    await git.run(['update-ref', '-d', `refs/heads/${branch}`], { allowFailure: true })
    await git.run(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
    await rm(join(this.repoDir, '.git', 'index'), { force: true })
    for (const name of await readdir(this.repoDir)) {
      if (name !== '.git') await rm(join(this.repoDir, name), { recursive: true, force: true })
    }
  }

  private async headCommit(git: Git, branch: string): Promise<string> {
    const sha = this.refInFiles(`refs/heads/${branch}`) ?? (await git.text(['rev-parse', '--verify', 'HEAD^{commit}']))
    if (!isCommitId(sha)) throw new SyncFailure('failed', SYNC_MESSAGES.failed, true)
    return sha
  }

  private async writeTreeFile(path: string, bytes: Buffer | string): Promise<void> {
    const full = resolve(this.repoDir, path)
    if (!full.startsWith(resolve(this.repoDir) + sep) || full.startsWith(join(resolve(this.repoDir), '.git') + sep))
      throw new Error('Path outside the clone')
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, bytes)
  }

  // ---------------------------------------------------------------- download

  private appearanceNow(): AppearanceFile {
    const at = this.setting<unknown>(KEYS.appearanceAt)
    return { updatedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0, value: this.setting(APPEARANCE_KEY) }
  }

  private homeNow(): HomeFile {
    const at = this.setting<unknown>(KEYS.homeAt)
    return { updatedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0, value: cleanHome(this.setting(HOME_KEY)) ?? null }
  }

  private sidebarNow(): SidebarFile {
    const at = this.setting<unknown>(KEYS.sidebarAt)
    return { updatedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0, value: cleanSidebar(this.setting(SIDEBAR_KEY)) ?? null }
  }

  /** The calendars of this device, or null when there are none to carry (no hook, or it failed to load). */
  private async calendarHook(): Promise<CalendarSync | null> {
    if (!this.options.calendars) return null
    try {
      return await this.options.calendars()
    } catch (err) {
      console.error('[sync] the calendars could not be loaded', err)
      return null
    }
  }

  /**
   * True when the calendars of an encrypted repository were left out of the last merge (this
   * device could not read its own then) and now can be: the commit already merged is merged again.
   */
  private async calendarsBehind(): Promise<boolean> {
    if (this.setting(KEYS.encrypted) !== true || this.repo.syncStates().has(STATE_CALENDARS)) return false
    const hook = await this.calendarHook()
    return hook !== null && hook.export() !== null
  }

  /** This device's calendars and task databases as the repository would hold them; null when they cannot be read here. */
  private calendarsNow(hook: CalendarSync): CalendarsFile | null {
    const mine = hook.export()
    if (!mine) return null
    const at = this.setting<unknown>(KEYS.briefingAt)
    const value = cleanBriefingSetting(DATABASES_KEY, this.setting(DATABASES_KEY))
    return {
      ...cleanCalendars(mine.calendars, mine.removed),
      databases: {
        updatedAt: typeof at === 'number' && Number.isFinite(at) && at > 0 ? Math.floor(at) : 0,
        value: Array.isArray(value) ? (value as string[]) : null
      }
    }
  }

  /** Copies the images the downloaded pages show, and this device does not have, out of the repository. */
  private async importImages(git: Git, tree: RepoTree): Promise<void> {
    const names = new Set<string>()
    for (const page of tree.pages.values()) imageNames(page.text, names)
    if (tree.appearanceText) imageNames(tree.appearanceText, names)
    const wanted = new Map<string, string>()
    for (const name of names) {
      if (!FILE_NAME_RE.test(name) || existsSync(join(this.options.filesDir, name))) continue
      const sha = tree.entries.get(tree.codec.pathOf(`${PATHS.files}${name}`))
      if (sha) wanted.set(name, sha)
    }
    if (!wanted.size) return
    const blobs = await this.readBlobs(git, [...wanted.values()])
    await mkdir(this.options.filesDir, { recursive: true })
    for (const [name, sha] of wanted) {
      const raw = blobs.get(sha)
      if (!raw) continue
      let bytes: Buffer
      try {
        bytes = tree.codec.decode(raw, tree.codec.encrypted ? `${PATHS.files}${name}` : undefined).bytes
      } catch {
        continue
      }
      // Only what the app would have stored itself: an image, within the size cap.
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !this.options.acceptImage(bytes)) continue
      await writeFile(join(this.options.filesDir, name), bytes, { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'EEXIST') throw err
      })
    }
  }

  /**
   * Merges the commit `remoteHead` into the database. Everything that needs git happens
   * first; from reading the local state to writing the result nothing is awaited, so no edit
   * made meanwhile can fall between the two.
   */
  private async download(git: Git, config: Config, base: string | null, remoteHead: string): Promise<Outcome> {
    const outcome: Outcome = { sent: 0, received: 0, conflicts: [], appearance: false }
    const remote = await this.readTree(git, remoteHead)
    if (!remote) throw new SyncFailure('failed', SYNC_MESSAGES.failed, true)
    if (!remote.meta) {
      if (remote.foreign > 0 && !config.useAnyway) throw new SyncFailure('not-sel-repo')
      // Nothing of sel's is there (yet): this device's pages go on top of what is.
      this.repo.applySync(
        {
          put: [],
          remove: [],
          snapshots: [],
          foreign: [],
          resetPages: [],
          settings: { [KEYS.lastCommit]: remoteHead, [KEYS.encrypted]: null }
        },
        () => new Map()
      )
      return outcome
    }
    // A base that is not in the clone, or that this device can no longer read, is treated as
    // none: the merge is then a union, and nothing is deleted on its account.
    const baseTree =
      (base
        ? await this.readTree(git, base).catch((err: unknown) => {
            if (err instanceof SyncFailure && (err.code === 'passphrase-required' || err.code === 'wrong-passphrase')) return null
            throw err
          })
        : null) ?? emptyTree()
    const from = remote.author
    await this.importImages(git, remote)
    const hook = remote.codec.encrypted ? await this.calendarHook() : null
    await this.step('apply')

    // ---- no awaits from here to the end of the transaction
    let baseWs = baseTree.ws
    const replacing = base === null && this.setting(KEYS.firstMode) === 'replace'
    if (replacing) this.setAsideLocalPages(remote.ws)
    const local = workspaceFromRows(this.repo.syncRows(), this.repo.rootOrder())
    if (replacing) {
      // "Replace": whatever both have counts as unchanged here, so the workspace's version of it is taken.
      const shared = new Map<string, SyncBlock>()
      for (const [id, block] of local.blocks) if (remote.ws.blocks.has(id)) shared.set(id, block)
      baseWs = { blocks: shared, root: local.root.filter((id) => shared.has(id)), rootAt: local.rootAt ?? 0 }
    }
    const merged = mergeWorkspace(baseWs, local, remote.ws)
    if (checkWorkspace(merged.result).length)
      throw new SyncFailure('failed', 'The merge did not produce a consistent workspace. Nothing was changed on this device.')
    const result = merged.result
    const diff = diffWorkspace(local, result)

    const localAppearance = this.appearanceNow()
    const appearance = mergeAppearance(baseTree.appearance, localAppearance, remote.appearance)
    const settings: Record<string, unknown> = {
      [KEYS.lastCommit]: remoteHead,
      [KEYS.encrypted]: remote.codec.encrypted ? true : null,
      [KEYS.firstMode]: null
    }
    if (appearance !== localAppearance && sha1(serializeAppearance(appearance)) !== sha1(serializeAppearance(localAppearance))) {
      settings[APPEARANCE_KEY] = appearance.value
      settings[KEYS.appearanceAt] = appearance.updatedAt
      outcome.appearance = true
    }
    const localHome = this.homeNow()
    const home = mergeHome(baseTree.home, localHome, remote.home)
    if (home !== localHome && serializeHome(home) !== serializeHome(localHome)) {
      settings[HOME_KEY] = home.value
      settings[KEYS.homeAt] = home.updatedAt
    }
    const localSidebar = this.sidebarNow()
    const sidebar = mergeSidebar(baseTree.sidebar, localSidebar, remote.sidebar)
    if (sidebar !== localSidebar && serializeSidebar(sidebar) !== serializeSidebar(localSidebar)) {
      settings[SIDEBAR_KEY] = sidebar.value
      settings[KEYS.sidebarAt] = sidebar.updatedAt
    }

    // Calendars: only out of an encrypted tree, and only on a device that can read its own.
    const localCalendars = hook ? this.calendarsNow(hook) : null
    const calendars = localCalendars ? mergeCalendars(baseTree.calendars, localCalendars, remote.calendars) : null
    const calendarsText = calendars ? serializeCalendars(calendars) : null
    let calendarsChanged = false
    let databasesChanged = false
    if (calendars && localCalendars) {
      calendarsChanged = serializeCalendars({ ...calendars, databases: localCalendars.databases }) !== serializeCalendars(localCalendars)
      databasesChanged = calendars.databases !== localCalendars.databases
      if (databasesChanged) {
        settings[DATABASES_KEY] = calendars.databases.value
        settings[KEYS.briefingAt] = calendars.databases.updatedAt
      }
    }

    // Pages whose content changes here, and the pages that hold a block both devices changed.
    const touched = new Set<string>()
    for (const block of diff.put) {
      const page = pageOf(result, block.id)
      if (page) touched.add(page)
      const before = local.blocks.has(block.id) ? pageOf(local, block.id) : null
      if (before && result.blocks.has(before)) touched.add(before)
    }
    for (const id of diff.remove) {
      const page = pageOf(local, id)
      if (page && result.blocks.has(page)) touched.add(page)
    }
    const lost = new Map<string, number>()
    const theirs = new Map<string, number>()
    const perPage = new Map<string, number>()
    for (const conflict of merged.conflicts) {
      const shown = pageOf(result, conflict.blockId)
      if (shown) perPage.set(shown, (perPage.get(shown) ?? 0) + 1)
      if (conflict.winner === 'remote' && conflict.localPage) lost.set(conflict.localPage, (lost.get(conflict.localPage) ?? 0) + 1)
      if (conflict.winner === 'local' && conflict.remotePage) theirs.set(conflict.remotePage, (theirs.get(conflict.remotePage) ?? 0) + 1)
    }
    const change: SyncChange = {
      put: diff.put as Block[],
      remove: diff.remove,
      snapshots: [...lost.keys()].map((pageId) => ({ pageId, label: `Before sync from ${from}` })),
      foreign: [...theirs.keys()]
        .filter((pageId) => result.blocks.has(pageId))
        .map((pageId) => ({ pageId, label: `From ${from}, not kept by sync`, tree: pageTree(remote.ws, pageId) as Block[] })),
      resetPages: [...touched],
      settings
    }
    if (diff.rootChanged) change.root = { order: result.root, at: result.rootAt ?? 0 }

    const resultPages = pagesOf(result)
    const rootText = serializeRoot(result)
    const appearanceText = serializeAppearance(appearance)
    const homeText = serializeHome(home)
    const sidebarText = serializeSidebar(sidebar)
    // Before the database: should this fail, nothing was applied and the next sync merges again.
    if (calendars && calendarsChanged) hook?.import(calendars)
    this.repo.applySync(change, () => {
      // What the repository already has of the merged state does not need to be uploaded again.
      const prints = fingerprintPages(this.repo.syncRows())
      const states = new Map<string, string>()
      for (const [pageId, blocks] of resultPages) {
        const same = remote.pages.get(pageId)?.text === serializePage(pageId, blocks)
        states.set(pageId, same ? (prints.get(pageId) ?? DIRTY) : DIRTY)
      }
      // Still in the repository, gone here: the upload removes their files.
      for (const pageId of remote.pages.keys()) if (!states.has(pageId)) states.set(pageId, DIRTY)
      states.set(STATE_ROOT, remote.rootText === rootText ? sha1(rootText) : DIRTY)
      states.set(
        STATE_APPEARANCE,
        remote.appearanceText === appearanceText || (remote.appearanceText === null && appearance.value == null)
          ? sha1(appearanceText)
          : DIRTY
      )
      states.set(STATE_HOME, remote.homeText === homeText || (remote.homeText === null && home.value === null) ? sha1(homeText) : DIRTY)
      states.set(
        STATE_SIDEBAR,
        remote.sidebarText === sidebarText || (remote.sidebarText === null && sidebar.value === null) ? sha1(sidebarText) : DIRTY
      )
      if (calendars && calendarsText !== null) {
        states.set(
          STATE_CALENDARS,
          remote.calendarsText === calendarsText || (remote.calendarsText === null && noCalendars(calendars)) ? sha1(calendarsText) : DIRTY
        )
      }
      // A repository still under the app's earlier name counts as not written yet: the upload renames it.
      if (!remote.entries.has(LEGACY.meta)) states.set(STATE_META, remoteHead)
      return states
    })
    this.options.onApplied?.()
    if (databasesChanged && !calendarsChanged) hook?.changed()

    outcome.received = touched.size
    outcome.from = from
    for (const [pageId, blocks] of perPage) {
      const title = plainText(result.blocks.get(pageId)?.props['title'] as RichText | undefined).slice(0, 120) || 'Untitled'
      outcome.conflicts.push({ pageId, title, blocks })
    }
    return outcome
  }

  // ------------------------------------------------------------------ upload

  /**
   * Writes what changed here on top of `base`, commits and pushes. Returns how many pages
   * went up, or `rejected` when the remote moved in the meantime (the caller starts over).
   */
  private async upload(
    git: Git,
    config: Config,
    base: string | null,
    remoteHead: string | null
  ): Promise<{ sent: number; rejected: boolean }> {
    // The calendars are looked at only when the repository is (or is about to be) encrypted.
    const hook = this.setting(KEYS.encrypted) === true || this.secrets().pending ? await this.calendarHook() : null
    // ---- one consistent look at the database, nothing awaited
    const rows = this.repo.syncRows()
    const prints = fingerprintPages(rows)
    const states = this.repo.syncStates()
    const ws = workspaceFromRows(rows, this.repo.rootOrder())
    const pages = pagesOf(ws)
    const rootText = serializeRoot(ws)
    const appearance = this.appearanceNow()
    const appearanceText = serializeAppearance(appearance)
    const home = this.homeNow()
    const homeText = serializeHome(home)
    const sidebar = this.sidebarNow()
    const sidebarText = serializeSidebar(sidebar)
    const changed = new Map<string, string>()
    const removed: string[] = []
    for (const [pageId, print] of prints) {
      if (states.get(pageId) === print) continue
      const blocks = pages.get(pageId)
      if (blocks) changed.set(pageId, serializePage(pageId, blocks))
      else if (states.has(pageId)) removed.push(pageId)
    }
    for (const pageId of states.keys()) if (!pageId.startsWith('~') && !prints.has(pageId)) removed.push(pageId)
    const rootDirty = states.get(STATE_ROOT) !== sha1(rootText)
    const appearanceDirty =
      states.get(STATE_APPEARANCE) !== sha1(appearanceText) && (appearance.value != null || states.has(STATE_APPEARANCE))
    // A home that was set and then cleared is written too, so that the other devices clear theirs.
    const homeDirty = states.get(STATE_HOME) !== sha1(homeText) && (home.value !== null || states.has(STATE_HOME))
    // So is a layout put back to the default.
    const sidebarDirty = states.get(STATE_SIDEBAR) !== sha1(sidebarText) && (sidebar.value !== null || states.has(STATE_SIDEBAR))
    const calendars = hook ? this.calendarsNow(hook) : null
    let calendarsText = calendars ? serializeCalendars(calendars) : null
    const calendarsDirty =
      calendars !== null &&
      calendarsText !== null &&
      states.get(STATE_CALENDARS) !== sha1(calendarsText) &&
      (!noCalendars(calendars) || states.has(STATE_CALENDARS))
    const first = !states.has(STATE_META)
    this.pending = changed.size + removed.length
    const recorded = (): Map<string, string> => {
      const next = new Map<string, string>(prints)
      // A page that could not be written (nothing reaches it) is not looked at again until it changes.
      next.set(STATE_ROOT, sha1(rootText))
      next.set(STATE_APPEARANCE, sha1(appearanceText))
      next.set(STATE_HOME, sha1(homeText))
      next.set(STATE_SIDEBAR, sha1(sidebarText))
      if (calendarsText !== null) next.set(STATE_CALENDARS, sha1(calendarsText))
      next.set(STATE_META, 'written')
      return next
    }
    if (
      !changed.size &&
      !removed.length &&
      !rootDirty &&
      !appearanceDirty &&
      !homeDirty &&
      !sidebarDirty &&
      !calendarsDirty &&
      !first &&
      (remoteHead !== null || base === null)
    )
      return { sent: 0, rejected: false }

    await this.step('write')
    await this.prepareTree(git, config.branch, base)

    // ---- what this tree is: an existing workspace (encrypted or not), or a new one
    let meta: RepoMeta | null = null
    const metaFile = join(this.repoDir, PATHS.meta)
    const legacyFile = join(this.repoDir, LEGACY.meta)
    if (existsSync(metaFile)) meta = parseMeta(await readFile(metaFile, 'utf8'))
    else if (existsSync(legacyFile)) {
      // The same workspace, written under the app's earlier name: its own files take today's.
      meta = parseMeta(await readFile(legacyFile, 'utf8'))
      await rm(legacyFile, { force: true })
      await this.writeTreeFile(PATHS.meta, serializeMeta(meta))
      for (const [was, now] of [
        [PATHS.readme, PATHS.readme],
        [LEGACY.readmeAlt, PATHS.readmeAlt]
      ]) {
        const file = join(this.repoDir, was)
        if (!existsSync(file) || !(await readFile(file, 'utf8')).includes(LEGACY.readmeMark)) continue
        await rm(file, { force: true })
        await this.writeTreeFile(now, README_TEXT)
      }
    }
    let codec = PLAIN
    if (!meta) {
      const pending = this.secrets().pending
      meta = { app: APP, format: FORMAT, workspaceId: randomUUID(), createdBy: config.device }
      if (pending) meta.encryption = pending
      await this.writeTreeFile(PATHS.meta, serializeMeta(meta))
      // A repository that has a README of its own keeps it.
      const readme = join(this.repoDir, PATHS.readme)
      const taken = existsSync(readme) && !(await readFile(readme, 'utf8')).includes(README_MARK)
      await this.writeTreeFile(taken ? PATHS.readmeAlt : PATHS.readme, README_TEXT)
    }
    if (meta.encryption) {
      const keys = this.keysFor(meta.encryption)
      if (!keys) throw new SyncFailure('passphrase-required')
      if (!keysMatch(keys, meta.encryption)) throw new SyncFailure('wrong-passphrase')
      codec = sealed(keys)
    }

    const exists = (logical: string): boolean => existsSync(join(this.repoDir, codec.pathOf(logical)))
    for (const [pageId, text] of changed) {
      const logical = `${PATHS.pages}${pageId}.json`
      await this.writeTreeFile(codec.pathOf(logical), codec.encode(logical, Buffer.from(text, 'utf8')))
    }
    for (const pageId of removed) await rm(join(this.repoDir, codec.pathOf(`${PATHS.pages}${pageId}.json`)), { force: true })
    if (rootDirty || !exists(PATHS.workspace))
      await this.writeTreeFile(PATHS.workspace, codec.encode(PATHS.workspace, Buffer.from(rootText, 'utf8')))
    if (appearance.value != null && (appearanceDirty || !exists(PATHS.appearance))) {
      await this.writeTreeFile(PATHS.appearance, codec.encode(PATHS.appearance, Buffer.from(appearanceText, 'utf8')))
    }
    if (homeDirty || (home.value !== null && !exists(PATHS.home))) {
      await this.writeTreeFile(PATHS.home, codec.encode(PATHS.home, Buffer.from(homeText, 'utf8')))
    }
    if (sidebarDirty || (sidebar.value !== null && !exists(PATHS.sidebar))) {
      await this.writeTreeFile(PATHS.sidebar, codec.encode(PATHS.sidebar, Buffer.from(sidebarText, 'utf8')))
    }
    if (!codec.encrypted) {
      // Addresses of calendars are credentials: never in a repository that is not encrypted.
      calendarsText = null
      await rm(join(this.repoDir, PATHS.calendars), { force: true })
    } else if (calendars && calendarsText !== null && (calendarsDirty || (!noCalendars(calendars) && !exists(PATHS.calendars)))) {
      await this.writeTreeFile(PATHS.calendars, codec.encode(PATHS.calendars, Buffer.from(calendarsText, 'utf8')))
    }
    // Images the changed pages show, when the repository does not have them yet.
    const names = imageNames(appearanceText)
    for (const text of changed.values()) imageNames(text, names)
    for (const name of names) {
      const logical = `${PATHS.files}${name}`
      if (exists(logical)) continue
      const source = join(this.options.filesDir, name)
      const info = await lstat(source).catch(() => null)
      if (!info || !info.isFile() || info.size === 0 || info.size > MAX_IMAGE_BYTES) continue
      await this.writeTreeFile(codec.pathOf(logical), codec.encode(logical, await readFile(source)))
    }

    await this.step('commit')
    await git.run(['add', '-A', '--', '.'])
    let head = base
    const summary = `sel-sync: pages=${changed.size} removed=${removed.length} format=${FORMAT}`
    const commit = await git.run(['commit', '-q', '--no-verify', '-F', '-'], {
      input: `Sync from ${config.device}\n\n${summary}\n`,
      allowFailure: true
    })
    if (commit.code === 0) head = await this.headCommit(git, config.branch)
    // The files came out exactly as they already were: there is nothing to commit, and that is fine.
    else if (!/nothing to commit|nothing added to commit|no changes added/i.test(`${commit.stdout.toString('utf8')}\n${commit.stderr}`))
      throw classifyGitFailure(commit.stderr, commit.code)
    if (head !== null && head !== remoteHead) {
      await this.step('push')
      const ref = `refs/heads/${config.branch}`
      const push = await git.run(['push', '--porcelain', 'origin', `${ref}:${ref}`], { allowFailure: true, network: true })
      if (push.code !== 0) {
        const said = `${push.stdout.toString('utf8')}\n${push.stderr}`
        if (isNonFastForward(said)) return { sent: 0, rejected: true }
        throw classifyGitFailure(said, push.code)
      }
    }
    await this.step('record')
    const settings: Record<string, unknown> = { [KEYS.lastSyncAt]: this.clock(), [KEYS.encrypted]: codec.encrypted ? true : null }
    if (head !== null) settings[KEYS.lastCommit] = head
    this.repo.setSyncStates(recorded(), settings)
    if (this.secrets().pending) {
      const secrets = this.secrets()
      this.options.secrets.save(JSON.stringify({ keys: secrets.keys }))
    }
    return { sent: changed.size + removed.length, rejected: false }
  }

  // ------------------------------------------------------------------- cycle

  private async cycle(config: Config): Promise<Outcome> {
    const git = await this.openGit(config.device)
    await this.ensureClone(git, config)
    const total: Outcome = { sent: 0, received: 0, conflicts: [], appearance: false }
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.step('fetch')
      const remoteHead = await this.fetch(git, config.branch)
      let base = this.lastCommit()
      if (remoteHead && (remoteHead !== base || (await this.calendarsBehind()))) {
        const got = await this.download(git, config, base, remoteHead)
        total.received += got.received
        total.conflicts.push(...got.conflicts)
        total.appearance ||= got.appearance
        if (got.from) total.from = got.from
        base = remoteHead
      }
      const up = await this.upload(git, config, base, remoteHead)
      if (!up.rejected) {
        total.sent += up.sent
        this.pending = 0
        return total
      }
      // Another device pushed between the fetch and the push: once more from the top, a little later each time.
      if (attempt < this.retries) await new Promise((done) => setTimeout(done, this.backoffMs * 2 ** attempt))
    }
    throw new SyncFailure('conflict-retry-exhausted')
  }

  /** One cycle with its bookkeeping: state, errors, the activity list. Never throws. */
  private async runCycle(config: Config | null = this.config(), manual = true): Promise<SyncError | null> {
    if (!config || this.disposed) return null
    if (!manual && this.setting(KEYS.paused) === true) return null
    this.running = true
    this.cancelled = false
    this.emit()
    let failure: SyncFailure | null = null
    let outcome: Outcome | null = null
    try {
      try {
        outcome = await this.cycle(config)
      } catch (err) {
        const first = toFailure(err)
        if (!first.corrupt) throw first
        // The clone is damaged: everything in it is also on the remote. Make it again, merge again.
        console.error('[sync] the clone is unusable, making a fresh one')
        await this.removeClone()
        outcome = await this.cycle(config)
      }
    } catch (err) {
      failure = toFailure(err)
      if (!(err instanceof SyncFailure) && !(err instanceof FormatError) && !(err instanceof WrongKeyError))
        console.error('[sync] cycle failed', err)
    } finally {
      this.git?.resume()
      this.running = false
      this.cancelled = false
    }
    const previous = this.lastError?.code
    if (failure) {
      if (failure.code !== 'cancelled') this.lastError = failure.toError()
    } else this.lastError = undefined
    try {
      const entry: SyncActivity = {
        at: this.clock(),
        sent: outcome?.sent ?? 0,
        received: outcome?.received ?? 0,
        conflicts: outcome?.conflicts ?? []
      }
      if (outcome?.from && outcome.received) entry.from = outcome.from
      if (outcome?.appearance) entry.appearance = true
      if (failure && failure.code !== 'cancelled') entry.error = failure.code
      // Only what did something is worth a line; a failure is listed once, not on every retry.
      const worth =
        entry.sent > 0 ||
        entry.received > 0 ||
        entry.conflicts.length > 0 ||
        entry.appearance === true ||
        (entry.error !== undefined && entry.error !== previous)
      if (worth) this.repo.setSetting(KEYS.activity, [entry, ...this.activity()].slice(0, SYNC_LIMITS.activity))
      if (!failure) this.repo.setSetting(KEYS.lastSyncAt, this.clock())
    } catch (err) {
      console.error('[sync] could not record the activity', err)
    }
    this.emit()
    return failure ? failure.toError() : null
  }

  // ------------------------------------------------------------------- setup

  private fail(code: SyncError['code'], message?: string): SyncStatus {
    return { ...this.status(), lastError: { code, message: message ?? SYNC_MESSAGES[code] } }
  }

  /**
   * Connects this device to a repository and runs the first sync. Everything is checked
   * before anything is stored: the address, that git can reach it, what is in it, the
   * passphrase. Resolves with the status; when a decision is needed (`needs-choice`,
   * `not-sel-repo`, `passphrase-required`…) the status says so in `lastError` and nothing
   * was set up.
   */
  setup(input: SyncSetup): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const url = checkRemoteUrl(input.remoteUrl, this.options.allowLocal)
      if (!url.ok) return this.fail('invalid-url')
      if (input.branch !== undefined && cleanBranch(input.branch) === null) return this.fail('failed', 'That is not a valid branch name.')
      if (input.passphrase !== undefined && !isPassphrase(input.passphrase))
        return this.fail('failed', `A passphrase has between ${SYNC_LIMITS.passphraseMin} and ${SYNC_LIMITS.passphraseMax} characters.`)
      const current = this.config()
      if (current && current.url !== url.url)
        return this.fail('failed', 'This device already syncs with another repository. Disconnect it first.')
      const device = cleanDeviceName(input.deviceName, this.deviceName())
      // A device that is already connected stays on its branch: the commit it last merged is on that one.
      const config: Config = {
        url: url.url,
        branch: current?.branch ?? cleanBranch(input.branch) ?? SYNC_DEFAULT_BRANCH,
        device,
        useAnyway: input.useAnyway === true || current?.useAnyway === true
      }

      this.running = true
      this.cancelled = false
      this.emit()
      let existing = false
      try {
        const git = await this.openGit(device)
        if (!current) await this.removeClone()
        await this.ensureClone(git, config)
        if (input.branch === undefined && !current) config.branch = (await this.defaultBranch(git)) ?? config.branch
        const head = await this.fetch(git, config.branch)
        let meta: RepoMeta | null = null
        let foreign = 0
        if (head) {
          const listing = await git.run(['ls-tree', '-r', '-z', '--name-only', '--full-tree', head, '--'])
          const paths = listing.stdout.toString('utf8').split('\0').filter(Boolean)
          foreign = paths.filter((path) => !isOurPath(path)).length
          const metaPath = [PATHS.meta, LEGACY.meta].find((path) => paths.includes(path))
          if (metaPath) {
            const blob = await git.run(['cat-file', 'blob', `${head}:${metaPath}`])
            meta = parseMeta(blob.stdout.toString('utf8'))
            existing = paths.some((path) => path.startsWith(PATHS.pages))
          }
        }
        if (!meta && foreign > 0 && !config.useAnyway) throw new SyncFailure('not-sel-repo')
        if (meta?.encryption) {
          let keys = this.keysFor(meta.encryption)
          if (input.passphrase !== undefined) keys = await unlockEncryption(input.passphrase, meta.encryption)
          else if (!keys) throw new SyncFailure('passphrase-required')
          if (!keys || !keysMatch(keys, meta.encryption)) throw new SyncFailure('wrong-passphrase')
          this.rememberKeys(meta.encryption, keys, false)
        } else if (input.passphrase !== undefined) {
          if (meta) {
            throw new SyncFailure(
              'failed',
              'This repository already holds a workspace that is not encrypted. Start without a passphrase; encryption can be turned on afterwards in the Sync settings.'
            )
          }
          const made = await createEncryption(input.passphrase, this.options.kdfCost)
          this.rememberKeys(made.params, made.keys, true)
        }
        const hasPages = this.repo.rootOrder().order.length > 0
        if (existing && hasPages && !current && input.mode !== 'merge' && input.mode !== 'replace') throw new SyncFailure('needs-choice')
      } catch (err) {
        const failure = toFailure(err)
        if (!(err instanceof SyncFailure)) console.error('[sync] setup failed', err)
        this.running = false
        if (!current) {
          await this.removeClone().catch(() => undefined)
          // A key is only kept once the question that follows was answered: `needs-choice` comes after the passphrase was accepted.
          if (failure.code !== 'needs-choice') {
            try {
              this.options.secrets.save(null)
            } catch {
              /* nothing was stored */
            }
          }
        }
        this.emit()
        return this.fail(failure.code, failure.message)
      } finally {
        this.git?.resume()
      }

      // ---- from here on this device is connected
      if (!current) {
        this.repo.transaction(() => {
          this.repo.clearSyncStates()
          this.repo.setSetting(KEYS.url, config.url)
          this.repo.setSetting(KEYS.lastCommit, null)
          this.repo.setSetting(KEYS.lastSyncAt, null)
          this.repo.setSetting(KEYS.activity, null)
          this.repo.setSetting(KEYS.paused, null)
        })
      }
      if (!current) this.repo.setSetting(KEYS.firstMode, existing && input.mode === 'replace' ? 'replace' : null)
      this.repo.setSetting(KEYS.branch, config.branch)
      this.repo.setSetting(KEYS.device, config.device)
      this.repo.setSetting(KEYS.useAnyway, config.useAnyway ? true : null)
      this.lastError = undefined
      this.running = false
      await this.runCycle(config)
      return this.status()
    })
  }

  private async defaultBranch(git: Git): Promise<string | null> {
    const listed = await git.run(['ls-remote', '--symref', 'origin', 'HEAD'], { network: true })
    const match = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(listed.stdout.toString('utf8'))
    return match ? cleanBranch(match[1]) : null
  }

  /**
   * "Replace this device's pages": each top-level page gets a saved version, and those the
   * workspace does not have go to the trash. Nothing is deleted.
   */
  private setAsideLocalPages(workspace: Workspace): void {
    for (const id of this.repo.rootOrder().order) {
      try {
        this.repo.saveVersion(id, 'Before replacing with the synced workspace')
        if (!workspace.blocks.has(id)) this.repo.delete(id)
      } catch (err) {
        console.error('[sync] could not set a page aside', err)
      }
    }
  }

  /** Enters the passphrase of a repository that is (or became) encrypted, then syncs. */
  unlock(passphrase: string): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const config = this.config()
      if (!config) return this.status()
      if (!isPassphrase(passphrase)) return this.fail('wrong-passphrase')
      this.running = true
      this.emit()
      try {
        const git = await this.openGit(config.device)
        await this.ensureClone(git, config)
        const head = await this.fetch(git, config.branch)
        if (!head) throw new SyncFailure('failed', 'The repository is empty.')
        let blob = await git.run(['cat-file', 'blob', `${head}:${PATHS.meta}`], { allowFailure: true })
        if (blob.code !== 0) blob = await git.run(['cat-file', 'blob', `${head}:${LEGACY.meta}`], { allowFailure: true })
        const meta = blob.code === 0 ? parseMeta(blob.stdout.toString('utf8')) : null
        if (meta?.encryption) {
          const keys = await unlockEncryption(passphrase, meta.encryption)
          if (!keys) throw new SyncFailure('wrong-passphrase')
          this.rememberKeys(meta.encryption, keys, false)
        }
      } catch (err) {
        const failure = toFailure(err)
        this.running = false
        this.lastError = failure.toError()
        this.emit()
        return this.status()
      } finally {
        this.git?.resume()
      }
      this.running = false
      await this.runCycle(config)
      return this.status()
    })
  }

  /**
   * Turns encryption on (a passphrase), changes the passphrase, or turns it off (null): a
   * re-upload of everything in the other form. The other devices are asked for the new
   * passphrase the next time they sync.
   */
  setEncryption(passphrase: string | null): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const config = this.config()
      if (!config) return this.status()
      if (passphrase !== null && !isPassphrase(passphrase))
        return this.fail('failed', `A passphrase has between ${SYNC_LIMITS.passphraseMin} and ${SYNC_LIMITS.passphraseMax} characters.`)
      // Up to date first: the re-upload must not undo what another device sent.
      const before = await this.runCycle(config)
      if (before) return this.status()
      this.running = true
      this.emit()
      try {
        const git = await this.openGit(config.device)
        const base = this.lastCommit()
        if (!base) throw new SyncFailure('failed')
        const old = await this.readTree(git, base)
        if (!old?.meta) throw new SyncFailure('failed')
        let params: EncryptionParams | undefined
        let codec = PLAIN
        if (passphrase !== null) {
          const made = await createEncryption(passphrase, this.options.kdfCost)
          params = made.params
          this.rememberKeys(made.params, made.keys, false)
          codec = sealed(made.keys)
        }
        // Images are carried over from the old form; everything else is written from the database.
        const images = new Map<string, Buffer>()
        const imageShas = [...old.entries].filter(([path]) => path.startsWith(PATHS.files))
        const blobs = await this.readBlobs(
          git,
          imageShas.map(([, sha]) => sha)
        )
        for (const [path, sha] of imageShas) {
          const raw = blobs.get(sha)
          if (!raw) continue
          const decoded = old.codec.decode(raw)
          const logical = decoded.logical ?? path
          if (logical.startsWith(PATHS.files) && FILE_NAME_RE.test(logical.slice(PATHS.files.length))) images.set(logical, decoded.bytes)
        }
        // Calendars go only into an encrypted repository: turning encryption off removes them.
        const hook = passphrase !== null ? await this.calendarHook() : null
        await this.step('write')
        // ---- one consistent look at the database
        const rows = this.repo.syncRows()
        const prints = fingerprintPages(rows)
        const ws = workspaceFromRows(rows, this.repo.rootOrder())
        const pages = pagesOf(ws)
        const rootText = serializeRoot(ws)
        const appearance = this.appearanceNow()
        const appearanceText = serializeAppearance(appearance)
        const home = this.homeNow()
        const homeText = serializeHome(home)
        const sidebar = this.sidebarNow()
        const sidebarText = serializeSidebar(sidebar)
        const calendars = hook ? this.calendarsNow(hook) : null
        const calendarsText = calendars && !noCalendars(calendars) ? serializeCalendars(calendars) : null

        await this.prepareTree(git, config.branch, base)
        for (const path of old.entries.keys()) {
          if (
            path.startsWith(PATHS.pages) ||
            path.startsWith(PATHS.files) ||
            path === PATHS.workspace ||
            path === PATHS.appearance ||
            path === PATHS.home ||
            path === PATHS.sidebar ||
            path === PATHS.calendars ||
            path === LEGACY.meta
          ) {
            await rm(join(this.repoDir, path), { force: true })
          }
        }
        const meta: RepoMeta = {
          app: APP,
          format: FORMAT,
          workspaceId: old.meta.workspaceId ?? randomUUID(),
          createdBy: old.meta.createdBy ?? config.device
        }
        if (params) meta.encryption = params
        await this.writeTreeFile(PATHS.meta, serializeMeta(meta))
        for (const [pageId, blocks] of pages) {
          const logical = `${PATHS.pages}${pageId}.json`
          await this.writeTreeFile(codec.pathOf(logical), codec.encode(logical, Buffer.from(serializePage(pageId, blocks), 'utf8')))
        }
        await this.writeTreeFile(PATHS.workspace, codec.encode(PATHS.workspace, Buffer.from(rootText, 'utf8')))
        if (appearance.value != null)
          await this.writeTreeFile(PATHS.appearance, codec.encode(PATHS.appearance, Buffer.from(appearanceText, 'utf8')))
        if (home.value !== null || old.homeText !== null)
          await this.writeTreeFile(PATHS.home, codec.encode(PATHS.home, Buffer.from(homeText, 'utf8')))
        if (sidebar.value !== null || old.sidebarText !== null)
          await this.writeTreeFile(PATHS.sidebar, codec.encode(PATHS.sidebar, Buffer.from(sidebarText, 'utf8')))
        // A new passphrase keeps the calendars: this device's, or (when it cannot read its own) those that were there.
        const carried = codec.encrypted ? (calendars ? calendarsText : old.calendarsText) : null
        if (carried !== null) await this.writeTreeFile(PATHS.calendars, codec.encode(PATHS.calendars, Buffer.from(carried, 'utf8')))
        for (const [logical, bytes] of images) await this.writeTreeFile(codec.pathOf(logical), codec.encode(logical, bytes))

        await this.step('commit')
        await git.run(['add', '-A', '--', '.'])
        const what = passphrase === null ? 'Remove encryption' : old.codec.encrypted ? 'Change passphrase' : 'Turn on encryption'
        await git.run(['commit', '-q', '--no-verify', '--allow-empty', '-F', '-'], {
          input: `${what} from ${config.device}\n\nsel-sync: reupload format=${FORMAT}\n`
        })
        const head = await this.headCommit(git, config.branch)
        await this.step('push')
        const ref = `refs/heads/${config.branch}`
        const push = await git.run(['push', '--porcelain', 'origin', `${ref}:${ref}`], { allowFailure: true, network: true })
        if (push.code !== 0) {
          const said = `${push.stdout.toString('utf8')}\n${push.stderr}`
          if (isNonFastForward(said))
            throw new SyncFailure('conflict-retry-exhausted', 'Another device synced at the same moment. Nothing was changed; try again.')
          throw classifyGitFailure(said, push.code)
        }
        const states = new Map<string, string>(prints)
        states.set(STATE_ROOT, sha1(rootText))
        states.set(STATE_APPEARANCE, sha1(appearanceText))
        states.set(STATE_HOME, sha1(homeText))
        states.set(STATE_SIDEBAR, sha1(sidebarText))
        if (codec.encrypted && calendars) states.set(STATE_CALENDARS, sha1(serializeCalendars(calendars)))
        states.set(STATE_META, 'written')
        this.repo.setSyncStates(states, {
          [KEYS.lastCommit]: head,
          [KEYS.lastSyncAt]: this.clock(),
          [KEYS.encrypted]: params ? true : null
        })
        this.lastError = undefined
      } catch (err) {
        const failure = toFailure(err)
        if (!(err instanceof SyncFailure)) console.error('[sync] changing the encryption failed', err)
        if (failure.code !== 'cancelled') this.lastError = failure.toError()
      } finally {
        this.git?.resume()
        this.running = false
        this.emit()
      }
      return this.status()
    })
  }

  /** Stops syncing on this device and removes its clone. The repository itself is not touched. */
  disconnect(): Promise<SyncStatus> {
    this.cancel()
    return this.exclusive(async () => {
      this.repo.transaction(() => {
        this.repo.clearSyncStates()
        for (const key of [
          KEYS.url,
          KEYS.branch,
          KEYS.lastCommit,
          KEYS.lastSyncAt,
          KEYS.paused,
          KEYS.activity,
          KEYS.useAnyway,
          KEYS.encrypted,
          KEYS.firstMode
        ])
          this.repo.setSetting(key, null)
      })
      this.lastError = undefined
      this.pending = 0
      try {
        this.options.secrets.save(null)
      } catch {
        /* nothing was stored */
      }
      await this.removeClone().catch((err: unknown) => console.error('[sync] could not remove the clone', err))
      this.emit()
      return this.status()
    })
  }

  /** Whether a cycle is worth starting before the app quits. */
  get hasPending(): boolean {
    return this.config() !== null && this.pending > 0 && this.setting(KEYS.paused) !== true
  }

  /** For automatic triggers: a cycle unless paused. Resolves with the error, if any. */
  auto(): Promise<SyncError | null> {
    if (this.queued) return this.queued.then((status) => status.lastError ?? null)
    return this.exclusive(() => this.runCycle(this.config(), false))
  }
}
