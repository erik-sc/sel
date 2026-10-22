import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The local log: what went wrong in the main process, kept in `<userData>/logs` so that someone
 * can look at it (Settings → Data → Open logs folder) or attach its last lines to a bug report.
 * Nothing here leaves the machine.
 *
 * Written by the global error handlers and by every `console.error` of the main process. Only
 * the shape of a failure goes in: the message a developer wrote, error names, messages and
 * stacks, ids and numbers. Objects are never serialised (a block, a page, a settings value
 * could carry the user's text), other strings are left out, and URLs are replaced (a calendar
 * feed's URL is a secret).
 *
 * Writes are synchronous: the line about an uncaught exception must be on disk before anything else.
 */

/** The folder in `<userData>`. */
export const LOGS_DIR = 'logs'
export const LOG_FILE = 'sel.log'
export const LOG_MAX_BYTES = 1024 * 1024
/** The current file and the ones before it. */
export const LOG_FILES = 3
/** One line, stack included, at most. */
const LINE_MAX = 4000
const MESSAGE_MAX = 500

const URL_RE = /\b(?:https?|webcals?|wss?|ftp|file):\/\/[^\s'"<>)]+/gi
const HAS_URL_RE = /\b(?:https?|webcals?|wss?|ftp|file):\/\//i
/** The folders of a path in a stack frame (`C:\…\out\main\`, `file:///…/`), up to the file name. */
const FOLDERS_RE = /(?<=[\s(])(?:file:\/\/\/?)?(?:[A-Za-z]:)?[\\/](?:[^\s():\\/]+[\\/])+/g
/** A word that names a thing rather than says something: an id, a key, a code, a file name. */
const TOKEN_RE = /^[\w.:/\\@-]{1,80}$/

function scrub(text: string, max: number): string {
  const clean = text.replace(URL_RE, '<url>').replace(/\s*\n\s*/g, ' | ')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function describeError(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  const head = `${error.name}${typeof code === 'string' ? ` ${code}` : ''}: ${scrub(error.message, MESSAGE_MAX)}`
  // The stack's first line repeats the message; the frames are file names and line numbers.
  const frames = (error.stack ?? '')
    .split('\n')
    .slice(1)
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith('at '))
    // A file name is enough to find the line; the folders above it name the user's account.
    .map((frame) => frame.replace(FOLDERS_RE, ''))
    .slice(0, 12)
  const cause = error.cause instanceof Error ? ` (cause: ${describeError(error.cause)})` : ''
  return [head + cause, ...frames].join(' | ')
}

function describe(value: unknown, first: boolean): string {
  if (value instanceof Error) return describeError(value)
  if (typeof value === 'string') {
    // The first string is the developer's message; later ones are kept only when they look like an id.
    if (first) return scrub(value, MESSAGE_MAX)
    return TOKEN_RE.test(value) && !HAS_URL_RE.test(value) ? value : '<text>'
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (value === null || value === undefined) return String(value)
  return Array.isArray(value) ? '<array>' : '<object>'
}

/** One log line from what was passed to `console.error`: never the user's content. */
export function logLine(level: string, args: readonly unknown[], at: Date): string {
  const parts = args.map((arg, index) => describe(arg, index === 0))
  const line = `${at.toISOString()} ${level} ${parts.join(' ')}`
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line
}

export interface LogOptions {
  maxBytes?: number
  files?: number
  now?: () => Date
}

export class Log {
  private size: number | null = null
  private readonly maxBytes: number
  private readonly files: number
  private readonly now: () => Date

  constructor(
    readonly dir: string,
    options: LogOptions = {}
  ) {
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES
    this.files = Math.max(1, options.files ?? LOG_FILES)
    this.now = options.now ?? (() => new Date())
  }

  /** `sel.log`, `sel.1.log`, `sel.2.log`…: newest first. */
  file(index = 0): string {
    return join(this.dir, index === 0 ? LOG_FILE : LOG_FILE.replace(/\.log$/, `.${index}.log`))
  }

  write(level: 'error' | 'warn' | 'info', ...args: unknown[]): void {
    try {
      const line = `${logLine(level, args, this.now())}\n`
      const bytes = Buffer.byteLength(line)
      if (this.size === null) {
        mkdirSync(this.dir, { recursive: true })
        this.size = sizeOf(this.file())
      }
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate()
      appendFileSync(this.file(), line, 'utf8')
      this.size += bytes
    } catch {
      // The log must never be the reason something else fails (a full disk, a locked file).
    }
  }

  private rotate(): void {
    rmSync(this.file(this.files - 1), { force: true })
    for (let index = this.files - 2; index >= 0; index--) {
      try {
        renameSync(this.file(index), this.file(index + 1))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
    this.size = 0
  }

  /** The last `count` lines, oldest first, across the current file and the one before it. */
  tail(count: number): string[] {
    const lines: string[] = []
    for (let index = 0; index < this.files && lines.length < count; index++) {
      let text: string
      try {
        text = readFileSync(this.file(index), 'utf8')
      } catch {
        break
      }
      const own = text.split('\n').filter(Boolean)
      lines.unshift(...own.slice(-(count - lines.length)))
    }
    return lines
  }
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

let current: Log | null = null
let restoreConsole: (() => void) | null = null

/**
 * Starts the log in `dir`: from here on `console.error` of the main process also goes to the
 * file (it still prints, for whoever runs sel from a terminal). Once per process.
 */
export function startLog(dir: string, options?: LogOptions): Log {
  if (current) return current
  const log = new Log(dir, options)
  current = log
  const original = console.error
  console.error = (...args: unknown[]): void => {
    original.apply(console, args)
    log.write('error', ...args)
  }
  restoreConsole = () => {
    console.error = original
  }
  return log
}

/** The running log, or null before `startLog` (tests, the first lines of startup). */
export function activeLog(): Log | null {
  return current
}

/** Rebuilds what a window sent with `app.log` (strings only, capped) and writes it. */
export function logRendererFailure(entry: unknown): void {
  if (!current || entry === null || typeof entry !== 'object') return
  const { message, error } = entry as { message?: unknown; error?: unknown }
  const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
  const args: unknown[] = [`[renderer] ${text(message, MESSAGE_MAX)}`]
  if (error !== null && typeof error === 'object') {
    const { name, message: detail, stack } = error as { name?: unknown; message?: unknown; stack?: unknown }
    const failure = new Error(text(detail, MESSAGE_MAX))
    failure.name = text(name, 80) || 'Error'
    failure.stack = text(stack, LINE_MAX)
    args.push(failure)
  }
  current.write('error', ...args)
}

/** Writes a line that is not an error (a notice the user was shown), without printing it. */
export function logInfo(...args: unknown[]): void {
  current?.write('info', ...args)
}

/** For a test that started a log: puts the console back. */
export function stopLogForTests(): void {
  restoreConsole?.()
  restoreConsole = null
  current = null
}
