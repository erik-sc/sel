import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOOL_SERVER } from './toolspecs'
import { callTool, ToolError, toolActivity, type ToolSource } from './tools'

/**
 * The main process's side of the workspace tools. One private pipe (a named pipe on Windows, a
 * socket in the temporary folder elsewhere) for as long as the app runs. Each request that may
 * use tools is given a grant: a random token and an MCP configuration file naming this app's
 * own server script (../mcp.ts), which the Claude Code program starts and which asks over the
 * pipe. A call is answered only with a token that is still granted; the grant ends with the
 * request. The tools read; nothing that arrives here can change anything.
 *
 * Protocol: one JSON object per line. The script sends {token, id, name, args}; this side
 * answers {id, text} or {id, error}.
 */

/**
 * Where the bundled server script of the workspace tools is: next to the main bundle, which is
 * the folder of the code that asks or, when that code was split into a chunk of its own, the
 * folder above.
 */
export function toolScript(dir: string, exists: (path: string) => boolean = existsSync): string {
  const candidates = [join(dir, 'mcp.js'), join(dir, '..', 'mcp.js')]
  return candidates.find((path) => exists(path)) ?? candidates[0]
}

export interface ToolHostOptions {
  source(): ToolSource
  /** Where the configuration files are written: the empty sandbox the program runs in. */
  dir: string
  /** The program that runs the server script as Node: this app's own executable. */
  execPath: string
  /** The bundled server script. */
  script: string
  platform?: NodeJS.Platform
}

export interface ToolGrant {
  /** The `--mcp-config` file for this request. */
  configPath: string
  /** Ends the grant: the token stops working and the file is removed. */
  release(): void
}

/** What the window may be told while tools are used: which one, about what. */
export type ToolListener = (activity: string) => void

const MAX_LINE = 64 * 1024
/** Calls answered for one grant before it is refused more: a loop of the model costs nothing here. */
const MAX_CALLS = 60

interface Grant {
  calls: number
  listener?: ToolListener
}

export class ToolHost {
  private server: Server | null = null
  private listening: Promise<string> | null = null
  private readonly grants = new Map<string, Grant>()
  private readonly sockets = new Set<Socket>()

  constructor(private readonly options: ToolHostOptions) {}

  private address(): string {
    const name = `sel-tools-${randomBytes(8).toString('hex')}`
    return (this.options.platform ?? process.platform) === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`)
  }

  /** Starts the pipe the first time it is needed; the same one serves every request after. */
  private listen(): Promise<string> {
    this.listening ??= new Promise<string>((resolve, reject) => {
      const address = this.address()
      const server = createServer((socket) => this.serve(socket))
      server.once('error', (err) => {
        this.listening = null
        reject(err)
      })
      server.listen(address, () => {
        this.server = server
        resolve(address)
      })
    })
    return this.listening
  }

  private serve(socket: Socket): void {
    this.sockets.add(socket)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_LINE && !buffer.includes('\n')) {
        socket.destroy()
        return
      }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (line.trim()) socket.write(`${JSON.stringify(this.answer(line))}\n`)
      }
    })
    socket.on('error', () => undefined)
    socket.on('close', () => this.sockets.delete(socket))
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
    const grant = typeof message['token'] === 'string' ? this.grants.get(message['token']) : undefined
    if (!grant) return { id, error: 'This request is over.' }
    if (++grant.calls > MAX_CALLS) return { id, error: 'Enough looking: answer with what you have.' }
    const name = typeof message['name'] === 'string' ? message['name'] : ''
    try {
      const source = this.options.source()
      try {
        grant.listener?.(toolActivity(source, name, message['args']))
      } catch {
        /* the window is gone: the answer still goes to the program */
      }
      return { id, text: callTool(source, name, message['args']) }
    } catch (err) {
      if (err instanceof ToolError) return { id, error: err.message }
      console.error('[ai] a workspace tool failed', err)
      return { id, error: 'That could not be read.' }
    }
  }

  /** A grant for one request. Rejects when the pipe cannot be opened: the request then runs without tools. */
  async grant(listener?: ToolListener): Promise<ToolGrant> {
    const address = await this.listen()
    const token = randomBytes(24).toString('hex')
    const configPath = join(this.options.dir, `tools-${randomBytes(8).toString('hex')}.json`)
    const config = {
      mcpServers: {
        [TOOL_SERVER]: {
          type: 'stdio',
          command: this.options.execPath,
          args: [this.options.script],
          env: { ELECTRON_RUN_AS_NODE: '1', SEL_TOOLS_PIPE: address, SEL_TOOLS_TOKEN: token }
        }
      }
    }
    await writeFile(configPath, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 })
    this.grants.set(token, listener ? { calls: 0, listener } : { calls: 0 })
    let released = false
    return {
      configPath,
      release: () => {
        if (released) return
        released = true
        this.grants.delete(token)
        void rm(configPath, { force: true }).catch(() => undefined)
      }
    }
  }

  dispose(): void {
    this.grants.clear()
    for (const socket of this.sockets) socket.destroy()
    this.server?.close()
    this.server = null
    this.listening = null
  }
}
