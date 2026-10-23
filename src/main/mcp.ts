/**
 * sel's workspace tools as an MCP server. The program that starts it talks to it on stdin and
 * stdout, one JSON-RPC message per line. It holds nothing and reads nothing of the workspace
 * itself, and never opens sel's database: it lists the tools and passes each call over a pipe
 * to the running app, which answers it.
 *
 * It runs in one of two ways:
 * - For Herman (see ai/toolhost.ts): the Claude Code program sel starts for one request starts
 *   it with `SEL_TOOLS_PIPE` and `SEL_TOOLS_TOKEN`, the grant of that request. Reading only.
 * - For other apps (see external/): an MCP client the user set up from Settings → MCP starts it
 *   with no such variables. It then reads the discovery file sel writes in its profile folder
 *   while "Connect other apps" is on (`--discovery <path>` names it), and asks the endpoint named
 *   there. Reading and writing; never deleting. When sel is closed, or the setting is off, every
 *   call answers with what to do about it.
 *
 * Either way the program runs it with this app's own executable as Node. It is bundled on its
 * own (out/main/mcp.js) and imports nothing of the app but the list of tools and the protocol.
 */
import { readFileSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { defaultDiscoveryPath, EXTERNAL_MESSAGES, MAX_CALL_CHARS, parseDiscovery } from './external/protocol'
import { EXTERNAL_TOOL_SPECS, TOOL_SERVER, TOOL_SPECS } from './ai/toolspecs'

const GRANT_PIPE = process.env['SEL_TOOLS_PIPE'] ?? ''
const GRANT_TOKEN = process.env['SEL_TOOLS_TOKEN'] ?? ''
/** Started by sel for one of Herman's requests, rather than by another app. */
const GRANTED = GRANT_PIPE !== '' && GRANT_TOKEN !== ''
const CALL_TIMEOUT_MS = 30_000

function argument(name: string): string | null {
  const at = process.argv.indexOf(name)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : null
}

const DISCOVERY = argument('--discovery') ?? process.env['SEL_MCP_DISCOVERY'] ?? defaultDiscoveryPath()
const NOT_ANSWERING = GRANTED ? 'The app is not answering.' : EXTERNAL_MESSAGES.closed

type Json = Record<string, unknown>
type Reply = { text?: string; error?: string }

const send = (message: Json): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

// ---- where the app is ----------------------------------------------------------

/** The pipe and the token to ask with: the grant, or what the discovery file says now. */
function locate(): { pipe: string; token: string } | { error: string } {
  if (GRANTED) return { pipe: GRANT_PIPE, token: GRANT_TOKEN }
  let text: string
  try {
    text = readFileSync(DISCOVERY, 'utf8')
  } catch {
    return { error: EXTERNAL_MESSAGES.off }
  }
  return parseDiscovery(text) ?? { error: EXTERNAL_MESSAGES.off }
}

// ---- the pipe to the app -------------------------------------------------------

let pipe: { socket: Socket; address: string } | null = null
let nextCall = 0
const pending = new Map<number, { socket: Socket; done: (reply: Reply) => void }>()

function drop(): void {
  pipe?.socket.destroy()
  pipe = null
}

function connect(address: string): Socket {
  if (pipe && !pipe.socket.destroyed && pipe.address === address) return pipe.socket
  drop()
  const socket = createConnection(address)
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
        const call = typeof reply.id === 'number' ? pending.get(reply.id) : undefined
        if (call) {
          pending.delete(reply.id as number)
          call.done(reply)
        }
      } catch {
        /* not a reply: ignored */
      }
    }
  })
  const fail = (): void => {
    for (const [id, call] of pending) {
      if (call.socket !== socket) continue
      pending.delete(id)
      call.done({ error: NOT_ANSWERING })
    }
    if (pipe?.socket === socket) pipe = null
  }
  socket.on('error', fail)
  socket.on('close', fail)
  pipe = { socket, address }
  return socket
}

function ask(address: string, token: string, name: string, args: unknown): Promise<Reply> {
  return new Promise((resolve) => {
    const id = ++nextCall
    const line = `${JSON.stringify({ token, id, name, args: args ?? {} })}\n`
    if (line.length > MAX_CALL_CHARS) return resolve({ error: EXTERNAL_MESSAGES.tooLarge })
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ error: 'The app took too long to answer.' })
    }, CALL_TIMEOUT_MS)
    const done = (reply: Reply): void => {
      clearTimeout(timer)
      resolve(reply)
    }
    try {
      const socket = connect(address)
      pending.set(id, { socket, done })
      socket.write(line)
    } catch {
      pending.delete(id)
      clearTimeout(timer)
      resolve({ error: NOT_ANSWERING })
    }
  })
}

async function call(name: string, args: unknown): Promise<Reply> {
  const target = locate()
  if ('error' in target) return target
  const reply = await ask(target.pipe, target.token, name, args)
  // A new token was generated while this server ran: the discovery file says which, and where.
  if (!GRANTED && reply.error === EXTERNAL_MESSAGES.refused) {
    const again = locate()
    if ('error' in again) return again
    if (again.token !== target.token) {
      drop()
      return ask(again.pipe, again.token, name, args)
    }
  }
  return reply
}

// ---- MCP -----------------------------------------------------------------------

const INSTRUCTIONS = GRANTED
  ? "Read-only access to the user's sel workspace: their pages and databases. What the user keeps private from the AI is left out."
  : "The user's notes in sel, a notes app on this computer: search and read their pages and databases, create pages, add to the end of a page, and add or update rows of a database. Nothing can be deleted, and what the user keeps private from the AI can be neither read nor changed. Ids are shown in square brackets after titles; read_database lists the property names and options that rows take. sel must be open for any of it."

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
          instructions: INSTRUCTIONS
        }
      })
    case 'tools/list':
      return send({ id, result: { tools: GRANTED ? TOOL_SPECS : EXTERNAL_TOOL_SPECS } })
    case 'tools/call': {
      const reply = await call(typeof params['name'] === 'string' ? params['name'] : '', params['arguments'])
      return send({
        id,
        result: { content: [{ type: 'text', text: reply.error ?? reply.text ?? '' }], isError: reply.error !== undefined }
      })
    }
    case 'ping':
      return send({ id, result: {} })
    default:
      return send({ id, error: { code: -32601, message: 'Method not found' } })
  }
}

// Half a grant is a mistake of whoever started this, not another app asking.
if ((GRANT_PIPE === '') !== (GRANT_TOKEN === '')) {
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
  pipe?.socket.end()
  process.exit(0)
})
