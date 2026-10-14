/**
 * sel's workspace tools as an MCP server: the one server the Claude Code program is given when
 * Herman or his council may look things up (see ai/toolhost.ts). The program starts it with
 * this app's own executable running as Node, and talks to it on stdin and stdout, one JSON-RPC
 * message per line. It holds nothing and reads nothing itself: it lists the tools and passes
 * each call over the app's private pipe, with the token of the request it was started for.
 *
 * It is bundled on its own (out/main/mcp.js) and imports nothing of the app but the list of
 * tools.
 */
import { createConnection, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { TOOL_SERVER, TOOL_SPECS } from './ai/toolspecs'

const PIPE = process.env['SEL_TOOLS_PIPE'] ?? ''
const TOKEN = process.env['SEL_TOOLS_TOKEN'] ?? ''
const CALL_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

const send = (message: Json): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

// ---- the pipe to the app -------------------------------------------------------

let pipe: Socket | null = null
let nextCall = 0
const pending = new Map<number, (reply: { text?: string; error?: string }) => void>()

function connect(): Socket {
  if (pipe && !pipe.destroyed) return pipe
  const socket = createConnection(PIPE)
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      try {
        const reply = JSON.parse(line) as { id?: number; text?: string; error?: string }
        const done = typeof reply.id === 'number' ? pending.get(reply.id) : undefined
        if (done) {
          pending.delete(reply.id as number)
          done(reply)
        }
      } catch {
        /* not a reply: ignored */
      }
    }
  })
  const fail = (): void => {
    for (const done of pending.values()) done({ error: 'The app is not answering.' })
    pending.clear()
    pipe = null
  }
  socket.on('error', fail)
  socket.on('close', fail)
  pipe = socket
  return socket
}

function call(name: string, args: unknown): Promise<{ text?: string; error?: string }> {
  return new Promise((resolve) => {
    const id = ++nextCall
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ error: 'The app took too long to answer.' })
    }, CALL_TIMEOUT_MS)
    pending.set(id, (reply) => {
      clearTimeout(timer)
      resolve(reply)
    })
    try {
      connect().write(`${JSON.stringify({ token: TOKEN, id, name, args: args ?? {} })}\n`)
    } catch {
      pending.delete(id)
      clearTimeout(timer)
      resolve({ error: 'The app is not answering.' })
    }
  })
}

// ---- MCP -----------------------------------------------------------------------

async function handle(message: Json): Promise<void> {
  const id = message['id']
  const method = message['method']
  const params = (message['params'] ?? {}) as Json
  if (id === undefined || id === null) return // a notification: nothing to answer
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: TOOL_SERVER, version: '1' },
          instructions: "Read-only access to the user's sel workspace: their pages and databases."
        }
      })
    case 'tools/list':
      return send({ id, result: { tools: TOOL_SPECS } })
    case 'tools/call': {
      const reply = await call(typeof params['name'] === 'string' ? params['name'] : '', params['arguments'])
      return send({ id, result: { content: [{ type: 'text', text: reply.error ?? reply.text ?? '' }], isError: reply.error !== undefined } })
    }
    case 'ping':
      return send({ id, result: {} })
    default:
      return send({ id, error: { code: -32601, message: 'Method not found' } })
  }
}

if (!PIPE || !TOKEN) {
  process.stderr.write('sel tools: started without a pipe\n')
  process.exit(1)
}

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  if (!line.trim()) return
  let message: Json
  try {
    message = JSON.parse(line) as Json
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } })
  }
  void handle(message).catch(() => send({ id: message['id'] ?? null, error: { code: -32603, message: 'Internal error' } }))
})
input.on('close', () => {
  pipe?.end()
  process.exit(0)
})
