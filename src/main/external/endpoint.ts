import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { rm, unlink, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXTERNAL_TOOL_SPECS } from '../ai/toolspecs'
import { ToolError } from '../ai/tools'
import { serveLines } from '../ai/toolhost'
import { DISCOVERY_FILE, EXTERNAL_MESSAGES, MAX_CALL_CHARS, type Discovery } from './protocol'

/**
 * sel's endpoint for other apps: Claude Desktop, Claude Code or any MCP client the user
 * connects in Settings → MCP. While "Connect other apps" is on, the main process listens on a
 * pipe of its own and writes a discovery file (pipe and token) into the profile folder; the MCP
 * server script (../mcp.ts), started by the client, reads that file and asks over the pipe. The
 * database is opened by this process only.
 *
 * Unlike Herman's grants (../ai/toolhost.ts), which end with a request and only read, the token
 * here lasts until the user generates a new one, and it may write (../ai/writes.ts). So calls
 * are bounded by rate and size instead of by count, and the last few are listed in Settings:
 * which tool, when, whether it worked. Never what was asked or answered.
 *
 * Protocol: the same as Herman's. One JSON object per line, {token, id, name, args} in and
 * {id, text} or {id, error} out.
 */

export interface ExternalCall {
  tool: string
  at: number
  ok: boolean
}

export interface EndpointLimits {
  /** Calls answered in any minute. */
  perMinute: number
  /** The serialized arguments of one call. */
  argsChars: number
}

export const DEFAULT_LIMITS: EndpointLimits = { perMinute: 120, argsChars: 512 * 1024 }
/** Calls kept for Settings. */
export const CALL_LOG_SIZE = 30

export interface EndpointOptions {
  /** The profile folder: the discovery file is written there, and the pipe's name derives from it. */
  userData: string
  /** The token kept from an earlier run, or null when there is none (or it cannot be read). */
  loadToken(): string | null
  /** Keeps a new token for the next run. */
  saveToken(token: string): void
  /** Runs one tool, reading or writing. Throws a ToolError, or an Error whose message may be shown. */
  run(name: string, args: unknown): string
  /** Called after every call: whatever it changed goes to the windows and to sync. */
  changed(): void
  limits?: Partial<EndpointLimits>
  platform?: NodeJS.Platform
  now?: () => number
}

const TOOL_NAMES = new Set(EXTERNAL_TOOL_SPECS.map((spec) => spec.name))

const newToken = (): string => randomBytes(24).toString('hex')

/**
 * The pipe for a profile and a token: the same across runs for as long as the token lasts, and
 * not one another program can guess and take first, since the token is in its name.
 */
export function pipeName(userData: string, token: string, platform: NodeJS.Platform = process.platform): string {
  const hash = createHash('sha256').update(`${userData}\n${token}`).digest('hex').slice(0, 24)
  return platform === 'win32' ? `\\\\.\\pipe\\sel-mcp-${hash}` : join(tmpdir(), `sel-mcp-${hash}.sock`)
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** A message a client may read: a tool's refusal or the repository's; anything from the OS or SQLite (they carry a `code`) is not. */
function readable(err: unknown): string | null {
  if (err instanceof ToolError) return err.message
  if (err instanceof Error && !('code' in err) && err.message) return err.message.slice(0, 300)
  return null
}

export class ExternalEndpoint {
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()
  private token: string | null = null
  private address: string | null = null
  private recent: number[] = []
  private log: ExternalCall[] = []
  private readonly limits: EndpointLimits
  private readonly now: () => number
  /** Why the endpoint could not start, for Settings. */
  error: string | null = null

  constructor(private readonly options: EndpointOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    this.now = options.now ?? Date.now
  }

  get discoveryPath(): string {
    return join(this.options.userData, DISCOVERY_FILE)
  }

  get running(): boolean {
    return this.server !== null
  }

  /** The latest calls, the newest first. */
  get calls(): ExternalCall[] {
    return [...this.log].reverse()
  }

  /** The current token: the stored one, or a new one kept for next time. */
  private currentToken(): string {
    if (this.token) return this.token
    let token: string | null = null
    try {
      token = this.options.loadToken()
    } catch {
      token = null
    }
    if (!token || !/^[0-9a-f]{48}$/.test(token)) {
      token = newToken()
      this.options.saveToken(token)
    }
    this.token = token
    return token
  }

  /** Listens, and writes the discovery file. Does nothing when already listening. */
  async start(): Promise<void> {
    if (this.server) return
    this.error = null
    const token = this.currentToken()
    const address = pipeName(this.options.userData, token, this.options.platform)
    // A socket file left by a run that did not end cleanly; a named pipe goes with its process.
    if ((this.options.platform ?? process.platform) !== 'win32') await unlink(address).catch(() => undefined)
    try {
      this.server = await new Promise<Server>((resolve, reject) => {
        const server = createServer((socket) => this.serve(socket))
        server.once('error', reject)
        server.listen(address, () => {
          server.off('error', reject)
          server.on('error', (err) => console.error('[mcp] the endpoint failed', err))
          resolve(server)
        })
      })
    } catch (err) {
      this.error = 'The connection for other apps could not be opened.'
      console.error('[mcp] could not listen', err)
      throw err
    }
    this.address = address
    await this.writeDiscovery()
  }

  /** Stops listening. With `forget`, the discovery file goes too: the setting was turned off. */
  async stop(forget: boolean): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = null
    this.address = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (forget) {
      this.error = null
      await rm(this.discoveryPath, { force: true })
    }
  }

  /**
   * A new token: the old one stops working at once, and connections made with it are closed.
   * While listening, the endpoint moves to the pipe of the new token and the discovery file
   * says so; the clients' script reads it again and carries on.
   */
  async rotate(): Promise<void> {
    const token = newToken()
    this.options.saveToken(token)
    this.token = token
    if (this.server) {
      await this.stop(false)
      await this.start()
    }
  }

  private async writeDiscovery(): Promise<void> {
    if (!this.address || !this.token) return
    const discovery: Discovery = { version: 1, pipe: this.address, token: this.token }
    // Replaced, not rewritten in place: a file kept from before keeps its old mode otherwise.
    await rm(this.discoveryPath, { force: true })
    await writeFile(this.discoveryPath, JSON.stringify(discovery), { encoding: 'utf8', mode: 0o600 })
  }

  private serve(socket: Socket): void {
    this.sockets.add(socket)
    serveLines(socket, MAX_CALL_CHARS, (line) => this.answer(line))
    socket.on('close', () => this.sockets.delete(socket))
  }

  private record(tool: string, ok: boolean): void {
    this.log.push({ tool: TOOL_NAMES.has(tool) ? tool : 'unknown', at: this.now(), ok })
    if (this.log.length > CALL_LOG_SIZE) this.log.splice(0, this.log.length - CALL_LOG_SIZE)
  }

  /** One call, answered. Never throws. */
  answer(line: string): { id: unknown; text?: string; error?: string } {
    let message: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { id: null, error: 'Not understood.' }
      message = parsed as Record<string, unknown>
    } catch {
      return { id: null, error: 'Not understood.' }
    }
    const id = typeof message['id'] === 'number' || typeof message['id'] === 'string' ? message['id'] : null
    const token = this.server ? this.token : null
    if (!token || typeof message['token'] !== 'string' || !sameToken(message['token'], token)) return { id, error: EXTERNAL_MESSAGES.refused }
    const name = typeof message['name'] === 'string' ? message['name'] : ''

    const now = this.now()
    this.recent = this.recent.filter((at) => now - at < 60_000)
    if (this.recent.length >= this.limits.perMinute) {
      this.record(name, false)
      return { id, error: `Too many calls: sel answers at most ${this.limits.perMinute} a minute. Wait a moment and try again.` }
    }
    this.recent.push(now)

    const args = message['args'] ?? {}
    if (JSON.stringify(args).length > this.limits.argsChars) {
      this.record(name, false)
      return { id, error: `That call is too large for sel (at most ${Math.floor(this.limits.argsChars / 1024)} KB of arguments).` }
    }
    try {
      const text = this.options.run(name, args)
      this.record(name, true)
      return { id, text }
    } catch (err) {
      this.record(name, false)
      const shown = readable(err)
      if (shown === null) console.error('[mcp] a tool failed', err)
      return { id, error: shown ?? 'That could not be done.' }
    } finally {
      try {
        this.options.changed()
      } catch (err) {
        console.error('[mcp] the windows could not be told about a change', err)
      }
    }
  }
}
