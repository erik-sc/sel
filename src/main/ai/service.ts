import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { AI_DEFAULTS, AI_MODEL_RE, AI_TIMEOUT_LIMITS, isAiLanguage, type AiRequest, type AiStatus } from '../../shared/ai'
import { buildArgs, buildEnv, buildSpawn, type SpawnSpec } from './command'
import { classifyFailure, failure, type Failure } from './errors'
import { envValue, locateCli, type CliLocation, type LocateResult } from './locate'
import { NdjsonParser, readEvent } from './ndjson'
import { buildPrompt, type PromptContext } from './prompts'

/**
 * Runs AI requests by driving the Claude Code program installed on this computer: one child
 * process per request, the prompt on its stdin, the answer streamed back from its stdout.
 * This process makes no network request and holds no credential; the program signs in with
 * what the user stored when they ran it themselves.
 *
 * The service knows nothing about windows or ipc: a caller hands it a request and a sink.
 * (The meeting recorder will call `complete({ action: 'consolidate', … })` the same way.)
 */

export interface AiRunLimits {
  running: number
  queued: number
  outputChars: number
  stderrChars: number
  versionTimeoutMs: number
  lingerMs: number
  killGraceMs: number
}

export const AI_RUN_LIMITS: AiRunLimits = {
  /** Requests running at once; further ones wait. */
  running: 2,
  /** Requests waiting; one more is refused. */
  queued: 4,
  /** Characters of answer after which a run is stopped and marked truncated. */
  outputChars: 200_000,
  stderrChars: 16_000,
  versionTimeoutMs: 15_000,
  /** How long a child may linger after its answer was delivered before it is killed. */
  lingerMs: 3000,
  /** POSIX: time between SIGTERM and SIGKILL. */
  killGraceMs: 1500
}

export interface AiResult {
  text: string
  truncated: boolean
  durationMs: number
}

/** Where one request's outcome goes. Exactly one of `done` / `error` is called, once. */
export interface AiSink {
  delta(text: string): void
  done(result: AiResult): void
  error(failure: Failure): void
}

export interface AiServiceOptions {
  /** A dedicated, empty directory: the working directory of every child. */
  sandboxDir: string
  getSetting(key: string): unknown
  /** Loads what the ids in a request point at (the page as Markdown…). */
  loadContext(request: AiRequest): PromptContext | Promise<PromptContext>
  /** A JavaScript stand-in for the program; pass it in unpackaged builds only. */
  devScript?: string | null
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** Tests: replaces the search for the program. */
  locate?: () => LocateResult
  limits?: Partial<AiRunLimits>
  /** Tests: overrides `ai.timeoutSec`. */
  timeoutMs?: number
}

interface Job {
  id: string
  owner: number | null
  request: AiRequest
  sink: AiSink
  state: 'queued' | 'starting' | 'running' | 'settled'
  child: ChildProcess | null
  timer: NodeJS.Timeout | null
  cancelled: boolean
  timedOut: boolean
  startedAt: number
}

/** Kills a child and everything it started. Never throws. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, graceMs: number = AI_RUN_LIMITS.killGraceMs): void {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (platform === 'win32') {
    try {
      const root = envValue(env, 'SystemRoot', 'win32') ?? 'C:\\Windows'
      const killer = spawn(join(root, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false })
      killer.on('error', () => child.kill())
      killer.unref()
    } catch {
      child.kill()
    }
    return
  }
  const signal = (name: NodeJS.Signals): void => {
    try {
      // The child leads its own process group (spawned detached): the whole group goes.
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
  }, graceMs).unref()
}

export class AiService {
  private readonly limits: AiRunLimits
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly jobs = new Map<string, Job>()
  private readonly queue: Job[] = []
  /** Children that are still exiting after their job settled. */
  private readonly lingering = new Set<ChildProcess>()
  private running = 0
  private disposed = false
  private cached: { key: string; status: Promise<AiStatus>; cli: CliLocation | null } | null = null

  constructor(private readonly options: AiServiceOptions) {
    this.limits = { ...AI_RUN_LIMITS, ...options.limits }
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
  }

  // ---- settings -----------------------------------------------------------

  private setting(key: string): unknown {
    try {
      return this.options.getSetting(key)
    } catch {
      return null
    }
  }

  private enabled(): boolean {
    const value = this.setting('ai.enabled')
    return typeof value === 'boolean' ? value : AI_DEFAULTS.enabled
  }

  private explicitPath(): string | null {
    const value = this.setting('ai.cliPath')
    return typeof value === 'string' && value ? value : null
  }

  private model(): string | null {
    const value = this.setting('ai.model')
    return typeof value === 'string' && AI_MODEL_RE.test(value) ? value : null
  }

  private timeoutMs(): number {
    if (this.options.timeoutMs !== undefined) return this.options.timeoutMs
    const value = this.setting('ai.timeoutSec')
    const seconds = typeof value === 'number' && Number.isFinite(value) ? value : AI_DEFAULTS.timeoutSec
    return Math.min(AI_TIMEOUT_LIMITS.max, Math.max(AI_TIMEOUT_LIMITS.min, seconds)) * 1000
  }

  // ---- finding the program ------------------------------------------------

  private locate(): LocateResult {
    if (this.options.locate) return this.options.locate()
    return locateCli({ explicit: this.explicitPath(), devScript: this.options.devScript, env: this.env, platform: this.platform })
  }

  private spawnSpec(cli: CliLocation, args: readonly string[]): SpawnSpec {
    return buildSpawn(cli, args, this.env)
  }

  private start(spec: SpawnSpec): ChildProcess {
    return spawn(spec.file, spec.args, {
      cwd: this.options.sandboxDir,
      env: buildEnv(this.env, spec.env),
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: spec.verbatim,
      // Its own process group on POSIX, so that the whole tree can be signalled.
      detached: this.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }

  /** Runs `<program> --version` and reads the version out of what it prints. */
  private readVersion(cli: CliLocation): Promise<{ version?: string; ran: boolean }> {
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = this.start(this.spawnSpec(cli, ['--version']))
      } catch {
        resolve({ ran: false })
        return
      }
      let out = ''
      let settled = false
      const finish = (result: { version?: string; ran: boolean }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        killTree(child, this.platform, this.env, this.limits.killGraceMs)
        finish({ ran: true })
      }, this.limits.versionTimeoutMs)
      child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
        if (out.length < 4096) out += chunk
      })
      child.stderr?.resume()
      child.stdin?.on('error', () => undefined)
      child.stdin?.end()
      child.on('error', () => finish({ ran: false }))
      child.on('close', (code) => {
        const match = code === 0 ? /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(out) : null
        finish(match ? { version: match[1], ran: true } : { ran: true })
      })
    })
  }

  private async probe(): Promise<{ status: AiStatus; cli: CliLocation | null }> {
    if (!this.enabled()) return { status: { available: false, reason: 'disabled' }, cli: null }
    const found = this.locate()
    if (!found.ok) return { status: { available: false, reason: found.reason }, cli: null }
    await mkdir(this.options.sandboxDir, { recursive: true })
    const { version, ran } = await this.readVersion(found.cli)
    if (!ran) return { status: { available: false, path: found.cli.path, reason: 'not-executable' }, cli: null }
    // It ran but did not answer like Claude Code does: not something to send prompts to.
    if (!version) return { status: { available: false, path: found.cli.path, reason: 'unknown-version' }, cli: null }
    return { status: { available: true, path: found.cli.path, version }, cli: found.cli }
  }

  /** Whether requests can run, and with which program. Cached until `refresh` or a setting changes. */
  status(refresh = false): Promise<AiStatus> {
    return this.resolve(refresh).then((entry) => entry.status)
  }

  /** Forgets the cached status (a setting changed, or a run found the program gone). */
  invalidate(): void {
    this.cached = null
  }

  private resolve(refresh = false): Promise<{ status: AiStatus; cli: CliLocation | null }> {
    const key = JSON.stringify([this.enabled(), this.explicitPath(), this.options.devScript ?? null])
    if (!refresh && this.cached && this.cached.key === key) {
      const entry = this.cached
      return entry.status.then((status) => ({ status, cli: entry.cli }))
    }
    const entry: { key: string; status: Promise<AiStatus>; cli: CliLocation | null } = { key, status: Promise.resolve({ available: false }), cli: null }
    entry.status = this.probe().then(
      (result) => {
        entry.cli = result.cli
        return result.status
      },
      () => ({ available: false, reason: 'not-executable' }) as AiStatus
    )
    this.cached = entry
    return entry.status.then((status) => ({ status, cli: entry.cli }))
  }

  // ---- requests -----------------------------------------------------------

  /**
   * Accepts a (validated) request and returns its id at once. Everything that happens to it,
   * including not finding the program, arrives through `sink`, after this call has returned.
   * `owner` identifies who may cancel it (a window); null for requests the app itself makes.
   */
  run(request: AiRequest, sink: AiSink, owner: number | null = null): string {
    const job: Job = { id: randomUUID(), owner, request, sink, state: 'queued', child: null, timer: null, cancelled: false, timedOut: false, startedAt: Date.now() }
    this.jobs.set(job.id, job)
    setImmediate(() => {
      if (job.state !== 'queued') return
      if (this.disposed) return this.fail(job, failure('cancelled'))
      if (this.running < this.limits.running) void this.launch(job)
      else if (this.queue.length < this.limits.queued) this.queue.push(job)
      else this.fail(job, failure('failed', 'Too many requests are waiting. Wait for one to finish.'))
    })
    return job.id
  }

  /** The same as `run`, as a promise of the whole answer. Rejects with the `Failure`. */
  complete(request: AiRequest, onDelta?: (text: string) => void): Promise<AiResult> {
    return new Promise((resolve, reject) => {
      this.run(request, { delta: (text) => onDelta?.(text), done: resolve, error: reject })
    })
  }

  /** Stops a request. With an `owner`, only that owner's own requests. */
  cancel(id: string, owner?: number | null): boolean {
    const job = this.jobs.get(id)
    if (!job || job.state === 'settled') return false
    if (owner !== undefined && job.owner !== owner) return false
    this.stop(job)
    return true
  }

  /** Stops everything a window started (it closed, or its page was reloaded). */
  cancelOwner(owner: number): void {
    for (const job of [...this.jobs.values()]) if (job.owner === owner) this.stop(job)
  }

  /** The app is quitting: no child survives it. */
  dispose(): void {
    this.disposed = true
    for (const job of [...this.jobs.values()]) this.stop(job)
    for (const child of this.lingering) killTree(child, this.platform, this.env, this.limits.killGraceMs)
    this.lingering.clear()
  }

  /** For tests and diagnostics. */
  stats(): { running: number; queued: number; lingering: number } {
    return { running: this.running, queued: this.queue.length, lingering: this.lingering.size }
  }

  private stop(job: Job): void {
    if (job.state === 'settled') return
    job.cancelled = true
    if (job.child) killTree(job.child, this.platform, this.env, this.limits.killGraceMs)
    // A running child reports through its `close`; settling here as well frees the caller at once.
    this.fail(job, failure('cancelled'))
  }

  private settle(job: Job): boolean {
    if (job.state === 'settled') return false
    const counted = job.state === 'starting' || job.state === 'running'
    job.state = 'settled'
    if (job.timer) clearTimeout(job.timer)
    job.timer = null
    this.jobs.delete(job.id)
    const queued = this.queue.indexOf(job)
    if (queued >= 0) this.queue.splice(queued, 1)
    if (counted) this.running--
    const child = job.child
    if (child && child.exitCode === null && child.signalCode === null) {
      // The answer is in; the program gets a moment to exit by itself, then it is made to.
      this.lingering.add(child)
      const timer = setTimeout(() => killTree(child, this.platform, this.env, this.limits.killGraceMs), this.limits.lingerMs)
      timer.unref()
      child.once('close', () => {
        clearTimeout(timer)
        this.lingering.delete(child)
      })
    }
    setImmediate(() => this.pump())
    return true
  }

  private pump(): void {
    while (!this.disposed && this.running < this.limits.running && this.queue.length) {
      const next = this.queue.shift()
      if (next && next.state === 'queued') void this.launch(next)
    }
  }

  private fail(job: Job, why: Failure): void {
    if (!this.settle(job)) return
    try {
      job.sink.error(why)
    } catch (err) {
      console.error('[ai] sink failed', err)
    }
  }

  private finish(job: Job, text: string, truncated: boolean): void {
    if (!this.settle(job)) return
    try {
      job.sink.done({ text, truncated, durationMs: Date.now() - job.startedAt })
    } catch (err) {
      console.error('[ai] sink failed', err)
    }
  }

  private async launch(job: Job): Promise<void> {
    job.state = 'starting'
    this.running++
    job.startedAt = Date.now()
    let prompt: string
    let spec: SpawnSpec
    try {
      const { status, cli } = await this.resolve()
      if (job.state !== 'starting') return
      if (!status.available || !cli) {
        return this.fail(job, status.reason === 'disabled' ? failure('failed', 'AI is turned off in Settings.') : failure('not-installed'))
      }
      const context = await this.options.loadContext(job.request)
      if (job.state !== 'starting') return
      const language = this.setting('ai.language')
      prompt = buildPrompt(job.request, context, { defaultLanguage: isAiLanguage(language) ? language : 'auto' })
      spec = this.spawnSpec(cli, buildArgs({ model: this.model() }))
      await mkdir(this.options.sandboxDir, { recursive: true })
      if (job.state !== 'starting') return
    } catch (err) {
      // A domain error (the page is gone…) carries a safe message; anything else stays in the log.
      const safe = err instanceof Error && !('code' in err) && err.message ? err.message.slice(0, 160) : undefined
      if (!safe) console.error('[ai] could not prepare the request', err)
      return this.fail(job, failure('failed', safe))
    }
    this.execute(job, spec, prompt)
  }

  private execute(job: Job, spec: SpawnSpec, prompt: string): void {
    let child: ChildProcess
    try {
      child = this.start(spec)
    } catch (err) {
      this.invalidate()
      return this.fail(job, classifyFailure({ spawnErrorCode: (err as NodeJS.ErrnoException).code ?? 'ENOENT' }))
    }
    job.child = child
    job.state = 'running'

    const parser = new NdjsonParser()
    const decoder = new StringDecoder('utf8')
    const cap = this.limits.outputChars
    let text = ''
    let stderr = ''
    /** Characters streamed as deltas since the last whole message: zero means it was not streamed. */
    let streamed = 0
    let result: { text: string; isError: boolean } | null = null

    const emit = (piece: string): void => {
      if (job.state !== 'running' || !piece) return
      const room = cap - text.length
      const part = piece.length > room ? piece.slice(0, Math.max(0, room)) : piece
      if (part) {
        text += part
        try {
          job.sink.delta(part)
        } catch (err) {
          console.error('[ai] sink failed', err)
        }
      }
      if (piece.length > room) {
        // Enough: stop the program and keep what there is.
        killTree(child, this.platform, this.env, this.limits.killGraceMs)
        this.finish(job, text, true)
      }
    }

    const take = (events: Record<string, unknown>[]): void => {
      for (const event of events) {
        if (job.state !== 'running') return
        const signal = readEvent(event)
        if (!signal) continue
        if (signal.kind === 'delta') {
          streamed += signal.text.length
          emit(signal.text)
        } else if (signal.kind === 'message') {
          if (streamed === 0) emit(signal.text)
          streamed = 0
        } else {
          result = { text: signal.text, isError: signal.isError }
          // Stopped at the turn limit with the answer already written: that answer stands.
          if (signal.isError && signal.subtype === 'error_max_turns' && text.trim()) this.finish(job, text, false)
          else if (signal.isError) this.fail(job, classifyFailure({ resultText: signal.text, stderr }))
          else {
            // The result repeats the whole answer; what streamed is kept when it says nothing.
            const final = signal.text.trim() ? signal.text : text
            this.finish(job, final.length > cap ? final.slice(0, cap) : final, final.length > cap)
          }
        }
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => take(parser.push(decoder.write(chunk))))
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < this.limits.stderrChars) stderr += chunk.slice(0, this.limits.stderrChars - stderr.length)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      this.invalidate()
      this.fail(job, classifyFailure({ spawnErrorCode: err.code ?? 'ENOENT' }))
    })
    child.on('close', (code) => {
      take(parser.push(decoder.end()))
      take(parser.end())
      if (job.state !== 'running') return
      if (job.timedOut) return this.fail(job, failure('timeout'))
      if (job.cancelled) return this.fail(job, failure('cancelled'))
      if (!result && code === 0 && text.trim()) return this.finish(job, text, false)
      this.fail(job, classifyFailure({ stderr, exitCode: code }))
    })

    job.timer = setTimeout(() => {
      if (job.state !== 'running') return
      job.timedOut = true
      killTree(child, this.platform, this.env, this.limits.killGraceMs)
      this.fail(job, failure('timeout'))
    }, this.timeoutMs())

    // The prompt goes in on stdin and nowhere else. A program that exits early closes the pipe.
    const stdin = child.stdin
    if (stdin) {
      stdin.on('error', () => undefined)
      stdin.end(prompt, 'utf8')
    }
  }
}
