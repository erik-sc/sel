import { join } from 'node:path'
import { AI_MODEL_RE } from '../../shared/ai'
import { envValue, type CliLocation } from './locate'
import { ALLOWED_TOOLS } from './toolspecs'

/**
 * How the Claude Code program is started for one request. Pure: it returns what to spawn and
 * never spawns. Two rules hold for everything built here:
 *   1. Nothing the user wrote (prompt, page content, instruction) is ever an argument. The
 *      prompt goes to the program on stdin. The only values that vary are the program's own
 *      path (validated in locate.ts) and the model name (a strict pattern).
 *   2. No shell parses a string we assembled from data. A `.cmd` shim does need cmd.exe; it is
 *      given one fixed command line whose only variable parts are those two validated values.
 */

/**
 * The system prompt replaces Claude Code's own (which is about editing code). It travels as an
 * argument, so it is a constant made of letters, spaces, commas and full stops only: safe to
 * put between double quotes on a cmd.exe command line.
 */
export const SYSTEM_PROMPT =
  'You are the writing assistant inside sel, a notes app. You only write text. Follow the task in the user message exactly and reply with the requested text only.'

/** Flags every request carries. All but `--max-turns` are listed by `claude --help` (2.1.296); see the notes. */
export const BASE_ARGS: readonly string[] = [
  // Non-interactive: print the answer and exit.
  '--print',
  // One JSON object per line, as the answer is produced...
  '--output-format',
  'stream-json',
  // ...including the partial text chunks.
  '--include-partial-messages',
  // stream-json output in print mode requires verbose.
  '--verbose',
  '--input-format',
  'text',
  // No tools at all: the model can read and change nothing on this computer.
  '--tools',
  '',
  // No MCP servers: only those given with --mcp-config would load, and none is given.
  '--strict-mcp-config',
  // No CLAUDE.md, skills, plugins, hooks, MCP servers or custom commands; sign-in is unaffected.
  '--safe-mode',
  // Only the user's own settings file (the sign-in lives there); no project or local settings.
  '--setting-sources',
  'user',
  '--disable-slash-commands',
  // Nothing is written to the program's session history.
  '--no-session-persistence',
  // Anything that would ask for permission is denied instead.
  '--permission-prompts',
  'none',
  // One answer and no agentic loop. Not listed by `--help`, but an option of print mode in 2.1.x.
  '--max-turns',
  '1',
  '--system-prompt',
  SYSTEM_PROMPT
]

/** The system prompt when the workspace tools are given: the same rules, and leave to read. Same character set. */
export const SYSTEM_PROMPT_TOOLS =
  'You are the writing assistant inside sel, a notes app. You may read the workspace of the user with the sel tools, and you change nothing. Follow the task in the user message exactly and reply with the requested text only.'

/**
 * The system prompt when the user also turned on servers of their own (Settings → AI → Claude's
 * tools): sel's workspace is still only read; what the other tools may do is what the user allowed
 * them. Same character set.
 */
export const SYSTEM_PROMPT_EXTERNAL =
  'You are the writing assistant inside sel, a notes app. You may read the workspace of the user with the sel tools, and you change nothing in it. You may also use the other tools the user turned on for sel, only as the user request asks. Follow the task in the user message exactly and reply with the requested text only.'

export interface CommandOptions {
  /** `ai.model`; ignored unless it matches AI_MODEL_RE. */
  model?: string | null
  /**
   * The workspace tools (see toolhost.ts): the MCP configuration file written for this request,
   * and how many turns the model may take to look things up before it answers.
   */
  tools?: { configPath: string; maxTurns: number; external?: ExternalArgs | null } | null
}

/** The user's own servers in a request (see ./claudeMcp.ts): its settings file, and whether claude.ai connectors are in. */
export interface ExternalArgs {
  /** The `--settings` file written for this request: which servers may load and which tools may run. */
  settingsPath: string
  /** A claude.ai connector is on: `--strict-mcp-config` would turn every connector off, so it goes. */
  connectors: boolean
}

/** A path that can travel as one argument on any of the command lines built here. */
const SAFE_PATH_RE = /^[^"%^!&|<>\r\n]+$/

export function buildArgs(options: CommandOptions = {}): string[] {
  const tools = options.tools && SAFE_PATH_RE.test(options.tools.configPath) ? options.tools : null
  // The user's servers only travel with a settings path that is just as safe; otherwise they stay out.
  const external = tools?.external && SAFE_PATH_RE.test(tools.external.settingsPath) ? tools.external : null
  const args = tools ? toolArgs(tools.configPath, tools.maxTurns, external) : [...BASE_ARGS]
  if (typeof options.model === 'string' && AI_MODEL_RE.test(options.model)) args.push('--model', options.model)
  return args
}

/**
 * The flags for a request that may read the workspace. The same as BASE_ARGS but for three
 * things: `--safe-mode` would not load the one MCP server either, so `--restricted` stands in
 * for it (none of the user's settings files, hence none of their hooks, CLAUDE.md or MCP
 * servers; no tool that runs code); that one server is given with `--mcp-config` and its tools
 * are the only ones allowed (`--tools ""` still removes every built-in one); and the model gets
 * a few turns to look things up.
 *
 * With `external` (servers the user turned on, see ./claudeMcp.ts) the request also gets its
 * `--settings` file, which says which servers may load and which of their tools may run; when a
 * claude.ai connector is among them, `--strict-mcp-config` goes, since it would turn every
 * connector off, and that file's allow-list keeps out every server it does not name.
 */
export function toolArgs(configPath: string, maxTurns: number, external: ExternalArgs | null = null): string[] {
  const args: string[] = []
  for (let index = 0; index < BASE_ARGS.length; index++) {
    const arg = BASE_ARGS[index]
    if (arg === '--safe-mode') continue
    if (arg === '--strict-mcp-config' && external?.connectors) continue
    if (arg === '--setting-sources') {
      index++
      continue
    }
    if (arg === '--max-turns') {
      args.push(arg, String(Math.max(2, Math.min(24, Math.floor(maxTurns)))))
      index++
      continue
    }
    if (arg === '--system-prompt') {
      args.push(arg, external ? SYSTEM_PROMPT_EXTERNAL : SYSTEM_PROMPT_TOOLS)
      index++
      continue
    }
    args.push(arg)
  }
  args.push('--restricted', '--mcp-config', configPath, '--allowedTools', ALLOWED_TOOLS.join(','))
  if (external) args.push('--settings', external.settingsPath)
  return args
}

export interface SpawnSpec {
  file: string
  args: string[]
  /** True when `args` is already a finished command line that Node must not re-quote. */
  verbatim: boolean
  /** Extra environment for the child (on top of the minimal one). */
  env: Record<string, string>
}

function systemDir(env: NodeJS.ProcessEnv): string {
  const root = envValue(env, 'SystemRoot', 'win32') ?? envValue(env, 'windir', 'win32') ?? 'C:\\Windows'
  return join(root, 'System32')
}

/** One argument on a cmd.exe command line: bare when it is a plain word, otherwise double-quoted. */
function cmdQuote(arg: string): string {
  if (/["%^!&|<>\r\n]/.test(arg)) throw new Error('Unsupported character in a command argument')
  return /^[A-Za-z0-9._:\\/=-]+$/.test(arg) ? arg : `"${arg}"`
}

/**
 * What to spawn for `cli` with `args` (from `buildArgs`): always `shell: false`.
 *  - exe: the program itself with the argument array.
 *  - cmd: `cmd.exe /d /s /c "<quoted path> <quoted fixed args>"`, passed verbatim.
 *  - ps1: `powershell.exe -NoProfile -NonInteractive -File <path> <args>`.
 *  - node-script (dev/tests): this app's own executable as Node, with the script first.
 */
export function buildSpawn(
  cli: CliLocation,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath
): SpawnSpec {
  switch (cli.kind) {
    case 'exe':
      return { file: cli.path, args: [...args], verbatim: false, env: {} }
    case 'cmd': {
      const line = [cmdQuote(cli.path), ...args.map(cmdQuote)].join(' ')
      // /d: no AutoRun commands. /s: strip exactly the outer pair of quotes and run the rest as is.
      return { file: join(systemDir(env), 'cmd.exe'), args: ['/d', '/s', '/c', `"${line}"`], verbatim: true, env: {} }
    }
    case 'ps1':
      return {
        file: join(systemDir(env), 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        args: ['-NoProfile', '-NonInteractive', '-File', cli.path, ...args],
        verbatim: false,
        env: {}
      }
    case 'node-script':
      return { file: execPath, args: [cli.path, ...args], verbatim: false, env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
}

/** Variables the program needs to start and to find the user's sign-in. Everything else stays here. */
const ENV_ALLOW: ReadonlySet<string> = new Set(
  [
    // locating things
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
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'XDG_STATE_HOME',
    'XDG_RUNTIME_DIR',
    // identity and locale
    'USER',
    'USERNAME',
    'LOGNAME',
    'USERDOMAIN',
    'COMPUTERNAME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
    // the keychain on Linux, and the network path the user already configured for their tools
    'DBUS_SESSION_BUS_ADDRESS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
    // where the program keeps its own configuration, when the user moved it
    'CLAUDE_CONFIG_DIR'
  ].map((name) => name.toUpperCase())
)

/**
 * The child's environment: the allow-listed variables only. API keys, tokens and anything else
 * in this process's environment are not passed on; the program signs in with what it stored
 * itself when the user ran it.
 */
export function buildEnv(env: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && ENV_ALLOW.has(key.toUpperCase())) out[key] = value
  }
  // Plain output, and no self-update in the middle of a request.
  out['NO_COLOR'] = '1'
  out['DISABLE_AUTOUPDATER'] = '1'
  return { ...out, ...extra }
}
