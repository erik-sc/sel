import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, rm, stat } from 'node:fs/promises'
import { availableParallelism, constants as osConstants, setPriority } from 'node:os'
import { join } from 'node:path'
import { killTree } from '../../ai/service'
import type { Segment } from '../transcript'

/**
 * Running `whisper-cli` (whisper.cpp) on one WAV file. The program is a separate process that
 * is told everything through an argument array (no shell ever parses a string), gets a
 * minimal environment, works at low priority in the folder of the recording, and is killed
 * with everything it started when it takes too long or the user cancels.
 *
 * Flags, as read in examples/cli/cli.cpp at build b5454 (v1.9.5):
 *   -m FILE   the model            -f FILE   the audio (16 kHz mono WAV)
 *   -l LANG   spoken language, `auto` to detect     -t N   threads
 *   -oj       write the result as JSON              -of BASE   …to BASE.json
 *   -pp       print "progress = NN%" lines (to stderr)
 *   -np       print nothing else
 * `--translate` is never passed: the transcript stays in the language that was spoken.
 */

export interface WhisperProgram {
  /** `exe`: the program itself. `node-script`: a JavaScript stand-in (development and tests). */
  kind: 'exe' | 'node-script'
  path: string
}

export interface WhisperArgs {
  model: string
  input: string
  /** The JSON is written to `<outputBase>.json`. */
  outputBase: string
  /** A two-letter code, or `auto`. */
  language: string
  threads: number
}

const LANGUAGE_RE = /^[a-z]{2,3}$/

export function buildWhisperArgs(options: WhisperArgs): string[] {
  const language = options.language === 'auto' || LANGUAGE_RE.test(options.language) ? options.language : 'auto'
  const threads = Math.max(1, Math.min(64, Math.floor(options.threads) || 1))
  return ['-m', options.model, '-f', options.input, '-l', language, '-t', String(threads), '-oj', '-of', options.outputBase, '-pp', '-np']
}

/**
 * Threads to give the program: the physical cores but one, eight at most. Node only knows
 * logical processors; with four or more of them half is taken for the physical count.
 */
export function whisperThreads(logical: number = availableParallelism()): number {
  const physical = logical >= 4 ? Math.floor(logical / 2) : logical
  return Math.max(1, Math.min(8, physical - 1))
}

/** How long one run may take: generous, and longer for longer audio. */
export function whisperTimeoutMs(audioSeconds: number): number {
  return 120_000 + Math.ceil(Math.max(0, audioSeconds)) * 6000
}

/** The percentage in a `-pp` line (`whisper_print_progress_callback: progress =  45%`), or null. */
export function parseProgress(line: string): number | null {
  const match = /progress\s*=\s*(\d{1,3})\s*%/.exec(line)
  if (!match) return null
  return Math.max(0, Math.min(100, Number(match[1])))
}

export interface WhisperOutput {
  /** The language the program settled on (`pt`, `en`…), when it says. */
  language: string | null
  segments: Segment[]
}

const MAX_SEGMENTS = 200_000

function stampSeconds(value: unknown): number | null {
  const match = typeof value === 'string' ? /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value) : null
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000 : null
}

/**
 * Reads the file `-oj` writes: `{ result: { language }, transcription: [{ offsets: { from, to }
 * (milliseconds), timestamps: { from, to } ("00:00:01,230"), text }] }`. Anything else throws.
 */
export function parseWhisperJson(text: string): WhisperOutput {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The transcription program wrote something that is not JSON.')
  }
  const root = data as { result?: { language?: unknown }; transcription?: unknown } | null
  if (!root || typeof root !== 'object' || !Array.isArray(root.transcription))
    throw new Error('The transcription program wrote a result sel does not understand.')
  const language = typeof root.result?.language === 'string' && LANGUAGE_RE.test(root.result.language) ? root.result.language : null
  const segments: Segment[] = []
  for (const item of root.transcription.slice(0, MAX_SEGMENTS) as {
    offsets?: { from?: unknown; to?: unknown }
    timestamps?: { from?: unknown; to?: unknown }
    text?: unknown
  }[]) {
    if (!item || typeof item !== 'object' || typeof item.text !== 'string') continue
    const from = typeof item.offsets?.from === 'number' ? item.offsets.from / 1000 : stampSeconds(item.timestamps?.from)
    const to = typeof item.offsets?.to === 'number' ? item.offsets.to / 1000 : stampSeconds(item.timestamps?.to)
    if (from === null || !Number.isFinite(from) || from < 0) continue
    segments.push({ start: from, end: to !== null && Number.isFinite(to) && to >= from ? to : from, text: item.text.slice(0, 4000) })
  }
  return { language, segments }
}

export type WhisperFailure = 'not-found' | 'timeout' | 'cancelled' | 'failed'

export class WhisperError extends Error {
  constructor(
    readonly reason: WhisperFailure,
    /** One sanitised line of what the program said. */
    readonly detail?: string
  ) {
    super(
      reason === 'not-found'
        ? 'The transcription program could not be started.'
        : reason === 'timeout'
          ? 'Transcription took too long and was stopped.'
          : reason === 'cancelled'
            ? 'Transcription was cancelled.'
            : 'The transcription program failed.'
    )
    this.name = 'WhisperError'
  }
}

/** The last thing the program said, without colours and without paths (which name the user's folders). */
export function sanitiseStderr(text: string): string | undefined {
  const lines = text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/(?:[A-Za-z]:)?(?:[\\/][^\\/\s'":]+){2,}/g, '…')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
    )
    .filter((line) => line && parseProgress(line) === null)
  const last = lines[lines.length - 1]
  return last ? last.slice(0, 200) : undefined
}

const ENV_KEEP: ReadonlySet<string> = new Set([
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE'
])

/** The child's environment: what a program needs to start, and a PATH of system folders only. */
export function whisperEnv(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const out: Record<string, string> = {}
  let root = 'C:\\Windows'
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !ENV_KEEP.has(key.toUpperCase())) continue
    out[key] = value
    if (key.toUpperCase() === 'SYSTEMROOT') root = value
  }
  out['PATH'] = platform === 'win32' ? `${join(root, 'System32')};${root}` : '/usr/local/bin:/usr/bin:/bin'
  return out
}

export const WHISPER_RUN_LIMITS = { stderrChars: 64_000, jsonBytes: 32 * 1024 * 1024 } as const

export interface WhisperRun {
  program: WhisperProgram
  args: WhisperArgs
  /** The folder of the recording: the child's working directory. */
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
  onProgress?(percent: number): void
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** Tests: the Electron (or Node) binary that runs a `node-script`. */
  execPath?: string
  /** Tests: told the pid once the child runs. */
  onSpawn?(child: ChildProcess): void
}

/** Runs the program on one file and returns what it transcribed. Rejects with a `WhisperError`. */
export function runWhisper(run: WhisperRun): Promise<WhisperOutput> {
  const platform = run.platform ?? process.platform
  const env = run.env ?? process.env
  const args = buildWhisperArgs(run.args)
  const script = run.program.kind === 'node-script'
  const file = script ? (run.execPath ?? process.execPath) : run.program.path
  const argv = script ? [run.program.path, ...args] : args
  const jsonFile = `${run.args.outputBase}.json`

  return new Promise<WhisperOutput>((resolve, reject) => {
    if (run.signal?.aborted) return reject(new WhisperError('cancelled'))
    let child: ChildProcess
    try {
      child = spawn(file, argv, {
        cwd: run.cwd,
        env: { ...whisperEnv(env, platform), ...(script ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        shell: false,
        windowsHide: true,
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      return reject(new WhisperError('not-found'))
    }
    let settled = false
    let stderr = ''
    let pending = ''
    let reason: WhisperFailure | null = null
    const kill = (why: WhisperFailure): void => {
      reason ??= why
      killTree(child, platform, env)
    }
    const onAbort = (): void => kill('cancelled')
    const timer = setTimeout(() => kill('timeout'), run.timeoutMs)
    run.signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    child.once('spawn', () => {
      // Transcription may take every core for minutes: it yields to whatever the user is doing.
      try {
        if (child.pid !== undefined) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        /* a priority is a courtesy */
      }
      run.onSpawn?.(child)
    })
    // The result goes to a file; whatever is printed is only drained.
    child.stdout?.resume()
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split(/\r?\n|\r/)
      pending = (lines.pop() ?? '').slice(-4096)
      for (const line of lines) {
        const percent = parseProgress(line)
        if (percent !== null) run.onProgress?.(percent)
        else if (stderr.length < WHISPER_RUN_LIMITS.stderrChars) stderr += `${line.slice(0, 2000)}\n`
      }
    })
    child.on('error', () => finish(() => reject(new WhisperError(reason ?? 'not-found'))))
    child.on('close', (code) => {
      finish(() => {
        if (reason) {
          void rm(jsonFile, { force: true }).catch(() => undefined)
          return reject(new WhisperError(reason))
        }
        if (code !== 0) return reject(new WhisperError('failed', sanitiseStderr(`${stderr}\n${pending}`)))
        stat(jsonFile)
          .then((info) => {
            if (!info.isFile()) throw new Error('It wrote no result.')
            if (info.size > WHISPER_RUN_LIMITS.jsonBytes) throw new Error('Its result is too large to read.')
            return readFile(jsonFile, 'utf8')
          })
          // The result file is gone before anybody hears of the result, whichever way it went.
          .finally(() => rm(jsonFile, { force: true }).catch(() => undefined))
          .then((text) => resolve(parseWhisperJson(text)))
          .catch((err: unknown) =>
            reject(new WhisperError('failed', err instanceof Error && !('code' in err) ? err.message.slice(0, 200) : 'It wrote no result.'))
          )
      })
    })
  })
}

/** Runs the program with one flag and returns what it printed (`--help`, `--version`). Never rejects. */
export function probeWhisper(
  program: WhisperProgram,
  flag: '--help' | '--version',
  cwd: string,
  timeoutMs = 10_000
): Promise<{ ran: boolean; code: number | null; output: string }> {
  return new Promise((resolve) => {
    const script = program.kind === 'node-script'
    let child: ChildProcess
    try {
      child = spawn(script ? process.execPath : program.path, script ? [program.path, flag] : [flag], {
        cwd,
        env: { ...whisperEnv(), ...(script ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      return resolve({ ran: false, code: null, output: '' })
    }
    let output = ''
    let done = false
    const finish = (ran: boolean, code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ran, code, output })
    }
    const timer = setTimeout(() => {
      killTree(child)
      finish(true, null)
    }, timeoutMs)
    const take = (chunk: string): void => {
      if (output.length < 32_000) output += chunk
    }
    child.stdout?.setEncoding('utf8').on('data', take)
    child.stderr?.setEncoding('utf8').on('data', take)
    child.on('error', () => finish(false, null))
    child.on('close', (code) => finish(true, code))
  })
}
