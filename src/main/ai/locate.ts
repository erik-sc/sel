import { accessSync, constants, statSync } from 'node:fs'
import { extname, isAbsolute, join, resolve } from 'node:path'

/**
 * Finding the Claude Code program on this computer. Nothing here runs anything: it only looks
 * at the file system. Kept free of Electron imports so it can be unit-tested with temp dirs.
 */

/** How a found program has to be started (see command.ts). */
export type CliKind =
  /** A native executable (or, on POSIX, any file with the execute bit: a script with a shebang). */
  | 'exe'
  /** A Windows batch shim (`claude.cmd`, as `npm install -g` writes it): needs cmd.exe. */
  | 'cmd'
  /** A PowerShell shim: needs powershell.exe. */
  | 'ps1'
  /** A JavaScript file run with this app's own Node: development and tests only. */
  | 'node-script'

export interface CliLocation {
  path: string
  kind: CliKind
}

export type LocateFailure = 'not-found' | 'not-executable'

export type LocateResult = { ok: true; cli: CliLocation } | { ok: false; reason: LocateFailure }

export interface LocateOptions {
  /** `ai.cliPath`: the file the user chose, tried before anything else. */
  explicit?: string | null
  /** A JavaScript stand-in for the program; only ever passed by an unpackaged build (see service.ts). */
  devScript?: string | null
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  /** The program's file name without extension, when it is not `claude` (see agents.ts). A constant, never user text. */
  name?: string
}

const NAME = 'claude'
/** Tried in this order in every directory on Windows: the native binary first, shims after. */
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat', '.ps1'] as const
/**
 * Characters cmd.exe gives a meaning to even inside double quotes (`%`, and `!` / `^` in some
 * modes), plus the quote itself and the ones that end a command. A shim whose path contains any
 * of them is not run: there is no quoting of it that is safe in every cmd.exe configuration.
 */
const CMD_UNSAFE_RE = /["%^!&|<>\r\n\0]/
const MAX_PATH_CHARS = 1024

/** Case-insensitive lookup: Windows spells it `Path`, `PATH` or `path`. */
export function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const direct = env[name]
  if (direct !== undefined || platform !== 'win32') return direct
  const wanted = name.toLowerCase()
  for (const key of Object.keys(env)) if (key.toLowerCase() === wanted) return env[key]
  return undefined
}

function kindOf(path: string, platform: NodeJS.Platform): CliKind | null {
  if (platform !== 'win32') return 'exe'
  const ext = extname(path).toLowerCase()
  if (ext === '.exe') return 'exe'
  if (ext === '.cmd' || ext === '.bat') return 'cmd'
  if (ext === '.ps1') return 'ps1'
  return null
}

/**
 * Checks one candidate: an absolute path to an existing regular file (a symlink is followed,
 * a directory or device is refused) that this platform can start.
 */
export function inspectCli(path: string, platform: NodeJS.Platform = process.platform): LocateResult {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH_CHARS || path.includes('\0') || !isAbsolute(path)) {
    return { ok: false, reason: 'not-found' }
  }
  let isFile = false
  try {
    isFile = statSync(path).isFile()
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  if (!isFile) return { ok: false, reason: 'not-executable' }
  const kind = kindOf(path, platform)
  if (!kind) return { ok: false, reason: 'not-executable' }
  if (kind === 'cmd' && CMD_UNSAFE_RE.test(path)) return { ok: false, reason: 'not-executable' }
  if (platform !== 'win32') {
    try {
      accessSync(path, constants.X_OK)
    } catch {
      return { ok: false, reason: 'not-executable' }
    }
  }
  return { ok: true, cli: { path, kind } }
}

/** A JavaScript stand-in: an existing regular `.js` / `.mjs` / `.cjs` file. */
export function inspectDevScript(path: string): LocateResult {
  if (!path || !isAbsolute(path) || !/\.(m|c)?js$/i.test(path)) return { ok: false, reason: 'not-executable' }
  try {
    if (!statSync(path).isFile()) return { ok: false, reason: 'not-executable' }
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  return { ok: true, cli: { path, kind: 'node-script' } }
}

/** The directories searched, in order: PATH first, then the places the installers use. */
export function candidateDirs(options: LocateOptions = {}): string[] {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const home = options.home ?? envValue(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform) ?? ''
  const dirs: string[] = []
  const add = (dir: string | undefined): void => {
    // A relative PATH entry (".", "bin") would resolve against the working directory: never searched.
    if (dir && isAbsolute(dir)) dirs.push(resolve(dir))
  }
  for (const entry of (envValue(env, 'PATH', platform) ?? '').split(platform === 'win32' ? ';' : ':')) {
    add(entry.trim().replace(/^"(.*)"$/, '$1'))
  }
  if (home) {
    add(join(home, '.local', 'bin'))
    add(join(home, '.claude', 'local'))
    add(join(home, '.claude', 'bin'))
  }
  if (platform === 'win32') {
    const appData = envValue(env, 'APPDATA', platform)
    if (appData) add(join(appData, 'npm'))
    add(envValue(env, 'NVM_SYMLINK', platform))
    add(envValue(env, 'NVM_HOME', platform))
    const localAppData = envValue(env, 'LOCALAPPDATA', platform)
    if (localAppData) {
      add(join(localAppData, 'Programs', 'claude'))
      add(join(localAppData, 'pnpm'))
    }
    add(envValue(env, 'PNPM_HOME', platform))
  } else {
    add('/usr/local/bin')
    add('/opt/homebrew/bin')
    add('/usr/bin')
    add(envValue(env, 'NVM_BIN', platform))
    add(envValue(env, 'PNPM_HOME', platform))
    if (home) {
      add(join(home, '.npm-global', 'bin'))
      add(join(home, '.bun', 'bin'))
      add(join(home, '.volta', 'bin'))
    }
  }
  const seen = new Set<string>()
  return dirs.filter((dir) => {
    const key = platform === 'win32' ? dir.toLowerCase() : dir
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Finds the program: the chosen file when there is one (and only that: a broken choice is
 * reported, not silently replaced by something else on PATH), otherwise the first usable
 * candidate in `candidateDirs`.
 */
export function locateCli(options: LocateOptions = {}): LocateResult {
  const platform = options.platform ?? process.platform
  if (options.devScript) return inspectDevScript(options.devScript)
  if (options.explicit) {
    const found = inspectCli(options.explicit, platform)
    return found.ok ? found : { ok: false, reason: found.reason === 'not-found' ? 'not-found' : 'not-executable' }
  }
  let blocked = false
  const base = options.name ?? NAME
  const names = platform === 'win32' ? WINDOWS_EXTENSIONS.map((ext) => base + ext) : [base]
  for (const dir of candidateDirs(options)) {
    for (const name of names) {
      const found = inspectCli(join(dir, name), platform)
      if (found.ok) return found
      if (found.reason === 'not-executable') blocked = true
    }
  }
  return { ok: false, reason: blocked ? 'not-executable' : 'not-found' }
}
