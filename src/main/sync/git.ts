import { spawn, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { SYNC_MESSAGES, type SyncError, type SyncErrorCode } from '../../shared/sync'

/**
 * Running git. Everything about how the program is started lives here, and three rules hold:
 *   1. No shell: the program is spawned directly with an argument array.
 *   2. Nothing a person typed is ever in option position. The only values that vary are
 *      validated before they get here (the remote address, a branch name, commit ids, the
 *      device name) and positional ones follow a `--`.
 *   3. git can never stop to ask: prompts are off in the environment and in the
 *      configuration, and every run has a timeout after which the whole process tree is killed.
 * The user's own git configuration is left alone: identity and behaviour are set per command.
 */

export class SyncFailure extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string = SYNC_MESSAGES[code],
    /** The clone itself looks broken: making a fresh one may help. */
    readonly corrupt = false
  ) {
    super(message)
  }

  toError(): SyncError {
    return { code: this.code, message: this.message }
  }
}

// ------------------------------------------------------------ finding git

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  const direct = env[name]
  if (direct !== undefined || platform !== 'win32') return direct
  const wanted = name.toLowerCase()
  for (const key of Object.keys(env)) if (key.toLowerCase() === wanted) return env[key]
  return undefined
}

const MAX_PATH_CHARS = 1024

/** An absolute path to an existing regular file named like git; null otherwise. Nothing is run. */
export function inspectGit(path: unknown, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH_CHARS || path.includes('\0') || !isAbsolute(path)) return null
  const name = basename(path).toLowerCase()
  // A real executable only: never a .cmd/.bat shim, which would need a shell.
  if (platform === 'win32' ? name !== 'git.exe' : name !== 'git') return null
  try {
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

export interface LocateGitOptions {
  /** `sync.gitPath`: the file chosen in the native dialog, tried alone. */
  explicit?: string | null
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export function gitCandidates(options: LocateGitOptions = {}): string[] {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const windows = platform === 'win32'
  const file = windows ? 'git.exe' : 'git'
  const dirs: string[] = []
  const add = (dir: string | undefined): void => {
    // A relative PATH entry would resolve against the working directory: never searched.
    if (dir && isAbsolute(dir)) dirs.push(resolve(dir))
  }
  for (const entry of (envValue(env, 'PATH', platform) ?? '').split(windows ? ';' : ':')) add(entry.trim().replace(/^"(.*)"$/, '$1'))
  if (windows) {
    for (const root of [
      envValue(env, 'ProgramFiles', platform),
      envValue(env, 'ProgramW6432', platform),
      envValue(env, 'ProgramFiles(x86)', platform)
    ]) {
      if (root) {
        add(join(root, 'Git', 'cmd'))
        add(join(root, 'Git', 'bin'))
      }
    }
    const local = envValue(env, 'LOCALAPPDATA', platform)
    if (local) add(join(local, 'Programs', 'Git', 'cmd'))
    const home = envValue(env, 'USERPROFILE', platform)
    if (home) add(join(home, 'scoop', 'shims'))
  } else {
    add('/usr/bin')
    add('/usr/local/bin')
    add('/opt/homebrew/bin')
    add('/opt/local/bin')
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of dirs) {
    const key = windows ? dir.toLowerCase() : dir
    if (seen.has(key)) continue
    seen.add(key)
    out.push(join(dir, file))
  }
  return out
}

/** The git to run: the chosen file when there is one (and only that), else the first one found. */
export function locateGit(options: LocateGitOptions = {}): string | null {
  const platform = options.platform ?? process.platform
  if (options.explicit) return inspectGit(options.explicit, platform)
  for (const candidate of gitCandidates(options)) {
    const found = inspectGit(candidate, platform)
    if (found) return found
  }
  return null
}

// ------------------------------------------------------------- environment

/** Variables git needs to start, to find the user's configuration and sign-in, and to reach the network. */
const ENV_ALLOW: ReadonlySet<string> = new Set(
  [
    'PATH',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'COMMONPROGRAMFILES',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_RUNTIME_DIR',
    'USER',
    'USERNAME',
    'LOGNAME',
    'USERDOMAIN',
    'COMPUTERNAME',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
    'TZ',
    // the keychain on Linux, the ssh agent, and the network path the user configured for their tools
    'DBUS_SESSION_BUS_ADDRESS',
    'SSH_AUTH_SOCK',
    'GIT_SSH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'GIT_SSL_CAINFO'
  ].map((name) => name.toUpperCase())
)

/** What every git child gets on top of the allow-listed variables. */
export const GIT_FIXED_ENV: Readonly<Record<string, string>> = {
  // Never wait for a person: not on the terminal, not in a credential window, not through ssh.
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  SSH_ASKPASS_REQUIRE: 'never',
  // English messages: failures are recognised by what git says.
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_EDITOR: 'true',
  GIT_PAGER: 'cat',
  NO_COLOR: '1'
}

/**
 * The child's environment: the allow-listed variables and the fixed ones. Tokens, keys and
 * every `GIT_*` variable of this process (`GIT_DIR`, `GIT_CONFIG_*`, `GIT_ASKPASS`…) stay here.
 */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && ENV_ALLOW.has(key.toUpperCase())) out[key] = value
  }
  return { ...out, ...GIT_FIXED_ENV }
}

/**
 * Pins every command to the clone at `cwd`: its `.git` and nothing else, with repository
 * discovery stopped at the clone's own folder.
 */
export function pinnedRepository(cwd: string): Record<string, string> {
  const root = resolve(cwd)
  return { GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root, GIT_CEILING_DIRECTORIES: dirname(root) }
}

// ---------------------------------------------------------------- arguments

const SAFE_VALUE_RE = /^[^\0\r\n]*$/

export interface GitContext {
  /** Already cleaned (shared/sync cleanDeviceName): the name commits are signed with. */
  deviceName: string
  /** An empty directory: hooks of the clone are never run. */
  hooksDir: string
  /** Local folders as remotes: tests and unpackaged builds only. */
  allowLocal: boolean
}

/** The `-c` settings every command runs with. They apply to that one process and are stored nowhere. */
export function configArgs(context: GitContext): string[] {
  if (!SAFE_VALUE_RE.test(context.deviceName) || context.deviceName.startsWith('-') || !SAFE_VALUE_RE.test(context.hooksDir)) {
    throw new Error('Invalid git context')
  }
  const settings = [
    'core.autocrlf=false',
    'core.safecrlf=false',
    'core.longpaths=true',
    'core.quotepath=false',
    'core.fsmonitor=false',
    'core.symlinks=false',
    'core.askPass=',
    `core.hooksPath=${context.hooksDir}`,
    'gc.auto=0',
    'maintenance.auto=false',
    'credential.interactive=false',
    'commit.gpgsign=false',
    'tag.gpgsign=false',
    'push.default=nothing',
    'push.followTags=false',
    'fetch.prune=false',
    'fetch.recurseSubmodules=false',
    'submodule.recurse=false',
    'advice.detachedHead=false',
    'init.defaultBranch=main',
    // A remote can only be what was validated: no helper programs, and local folders only when a test asks.
    'protocol.ext.allow=never',
    `protocol.file.allow=${context.allowLocal ? 'user' : 'never'}`,
    `user.name=${context.deviceName}`,
    'user.email=sel@localhost'
  ]
  return settings.flatMap((setting) => ['-c', setting])
}

const SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/

export function isCommitId(value: unknown): value is string {
  return typeof value === 'string' && SHA_RE.test(value)
}

// ------------------------------------------------------------------ running

export interface GitResult {
  code: number
  stdout: Buffer
  stderr: string
}

export interface RunOptions {
  timeoutMs?: number
  /** Written to stdin, which is then closed. */
  input?: string | Buffer
  maxOutputBytes?: number
  /** Do not throw on a non-zero exit: the caller looks at the code. */
  allowFailure?: boolean
  /** A command that talks to the remote: a timeout means the network, not the clone. */
  network?: boolean
}

export const GIT_LIMITS = {
  localTimeoutMs: 60_000,
  networkTimeoutMs: 5 * 60_000,
  outputBytes: 64 * 1024 * 1024,
  stderrChars: 64_000,
  killGraceMs: 1500
} as const

/** Kills a child and everything it started (git runs helpers: remote-https, ssh, the credential manager). Never throws. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): void {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (platform === 'win32') {
    try {
      const root = envValue(env, 'SystemRoot', 'win32') ?? 'C:\\Windows'
      const killer = spawn(join(root, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false
      })
      killer.on('error', () => child.kill())
      killer.unref()
    } catch {
      child.kill()
    }
    return
  }
  const signal = (name: NodeJS.Signals): void => {
    try {
      process.kill(-pid, name)
    } catch {
      try {
        child.kill(name)
      } catch {
        /* already gone */
      }
    }
  }
  signal('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signal('SIGKILL')
  }, GIT_LIMITS.killGraceMs).unref()
}

export interface GitOptions extends GitContext {
  gitPath: string
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** Tests: sees every argument array that is run. */
  onSpawn?: (args: readonly string[], env: Readonly<Record<string, string>>) => void
}

export class Git {
  private readonly env: Record<string, string>
  private readonly config: string[]
  private readonly platform: NodeJS.Platform
  private readonly children = new Set<ChildProcess>()
  private cancelled = false

  constructor(private readonly options: GitOptions) {
    // git is told which repository to work on and never looks for one itself: were the clone
    // damaged, it would otherwise walk up the folders and act on whatever repository holds them.
    this.env = { ...gitEnv(options.env ?? process.env), ...pinnedRepository(options.cwd) }
    this.config = configArgs(options)
    this.platform = options.platform ?? process.platform
  }

  /** Stops whatever is running; every later run fails with `cancelled` until `resume`. */
  cancel(): void {
    this.cancelled = true
    for (const child of this.children) killTree(child, this.platform, this.options.env ?? process.env)
  }

  resume(): void {
    this.cancelled = false
  }

  get isCancelled(): boolean {
    return this.cancelled
  }

  /**
   * Runs `git <args>` in the clone. Resolves with what it printed; rejects with a `SyncFailure`
   * that says what went wrong in terms a person can act on, never with git's own output.
   */
  run(args: readonly string[], options: RunOptions = {}): Promise<GitResult> {
    return new Promise((resolvePromise, reject) => {
      if (this.cancelled) return reject(new SyncFailure('cancelled'))
      for (const arg of args) {
        if (typeof arg !== 'string' || arg.includes('\0')) return reject(new SyncFailure('failed'))
      }
      const argv = [...this.config, ...args]
      this.options.onSpawn?.(argv, this.env)
      const maxOutput = options.maxOutputBytes ?? GIT_LIMITS.outputBytes
      const timeoutMs = options.timeoutMs ?? (options.network ? GIT_LIMITS.networkTimeoutMs : GIT_LIMITS.localTimeoutMs)
      let child: ChildProcess
      try {
        child = spawn(this.options.gitPath, argv, {
          cwd: this.options.cwd,
          env: this.env,
          shell: false,
          windowsHide: true,
          // Its own process group on POSIX, so that the whole tree can be signalled.
          detached: this.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (err) {
        return reject(spawnFailure(err))
      }
      this.children.add(child)
      const chunks: Buffer[] = []
      let size = 0
      let stderr = ''
      let settled = false
      let timedOut = false
      let overflow = false
      const timer = setTimeout(() => {
        timedOut = true
        killTree(child, this.platform, this.options.env ?? process.env)
      }, timeoutMs)
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.children.delete(child)
        fn()
      }
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxOutput) {
          overflow = true
          killTree(child, this.platform, this.options.env ?? process.env)
          return
        }
        chunks.push(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < GIT_LIMITS.stderrChars) stderr += chunk.toString('utf8')
      })
      child.stdin?.on('error', () => undefined)
      child.on('error', (err) => finish(() => reject(spawnFailure(err))))
      child.on('close', (code) => {
        finish(() => {
          if (this.cancelled) return reject(new SyncFailure('cancelled'))
          if (timedOut)
            return reject(options.network ? new SyncFailure('offline') : new SyncFailure('failed', 'Git took too long and was stopped.'))
          if (overflow) return reject(new SyncFailure('failed', 'The repository is too large to read.'))
          const result: GitResult = { code: code ?? 1, stdout: Buffer.concat(chunks), stderr }
          if (result.code !== 0 && !options.allowFailure) return reject(classifyGitFailure(stderr, result.code))
          resolvePromise(result)
        })
      })
      if (options.input !== undefined) child.stdin?.end(options.input)
      else child.stdin?.end()
    })
  }

  async text(args: readonly string[], options: RunOptions = {}): Promise<string> {
    return (await this.run(args, options)).stdout.toString('utf8').trim()
  }
}

function spawnFailure(err: unknown): SyncFailure {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return new SyncFailure('git-not-found')
  if (code === 'ENOSPC') return new SyncFailure('disk-full')
  return new SyncFailure('failed')
}

// ------------------------------------------------------------------- errors

const AUTH_RE =
  /authentication failed|could not read username|could not read password|terminal prompts disabled|permission denied \(publickey|permission denied, please try again|host key verification failed|invalid username or (?:password|token)|logon failed|http basic: access denied|the requested url returned error: 40[13]|\b401\b|unauthorized|access denied|bad credentials|support for password authentication was removed|no anonymous write access|interactive(?:ty)? (?:is|was) disabled|cannot prompt because user interactivity has been disabled|credential/i
const NOT_FOUND_RE =
  /repository not found|repository '.*' not found|does not appear to be a git repository|not found: did you run git update-server-info|the requested url returned error: 404|no such repository|project you were looking for could not be found/i
const OFFLINE_RE =
  /could not resolve host|could not resolve hostname|failed to connect|couldn'?t connect to server|connection timed out|connection refused|connection reset|network is unreachable|no route to host|operation timed out|timed out|ssl connect error|schannel|unable to access|early eof|the remote end hung up unexpectedly|rpc failed|temporary failure in name resolution|name or service not known|proxy/i
const DISK_RE = /no space left on device|disk quota exceeded|not enough space|insufficient disk space|enospc/i
const NON_FAST_FORWARD_RE = /\[rejected\]|non-fast-forward|fetch first|tip of your current branch is behind|stale info/i
const REMOTE_REJECTED_RE =
  /\[remote rejected\]|protected branch|pre-receive hook declined|push declined|gh00\d|denied to|permission to .* denied|you are not allowed to push|read-only/i
const CORRUPT_RE =
  /not a git repository|index file corrupt|bad index file|bad object|object file .* is empty|loose object .* is corrupt|unable to read tree|bad tree object|packfile .* (?:is corrupt|cannot be accessed)|invalid sha1 pointer|did not send all necessary objects|unable to read sha1 file|fatal: bad revision|unable to resolve reference|reference broken|cannot lock ref|corrupt|unknown index entry format|bad signature|unable to create .*\.lock/i

/**
 * What a failed git run means. git's own words are only matched for a cause; none of them
 * (addresses, paths, anything a server sent) is passed on.
 */
export function classifyGitFailure(stderr: string, exitCode: number | null): SyncFailure {
  const said = stderr.slice(0, GIT_LIMITS.stderrChars)
  if (DISK_RE.test(said)) return new SyncFailure('disk-full')
  if (REMOTE_REJECTED_RE.test(said)) return new SyncFailure('rejected')
  if (NON_FAST_FORWARD_RE.test(said)) return new SyncFailure('rejected', 'Another device uploaded first.')
  if (NOT_FOUND_RE.test(said)) return new SyncFailure('repo-not-found')
  if (AUTH_RE.test(said)) return new SyncFailure('auth-failed')
  if (OFFLINE_RE.test(said)) return new SyncFailure('offline')
  if (CORRUPT_RE.test(said)) return new SyncFailure('failed', SYNC_MESSAGES.failed, true)
  // 9009 / 127: the program itself could not be started.
  if (exitCode === 9009 || exitCode === 127) return new SyncFailure('git-not-found')
  return new SyncFailure('failed')
}

/** True for a push that was refused only because the remote has commits this clone does not. */
export function isNonFastForward(output: string): boolean {
  return NON_FAST_FORWARD_RE.test(output) && !REMOTE_REJECTED_RE.test(output)
}

/** `git version 2.47.1.windows.1` → `2.47.1`. */
export function parseGitVersion(text: string): string | null {
  const match = /^git version (\d+\.\d+(?:\.\d+)?)/m.exec(text)
  return match ? match[1] : null
}
