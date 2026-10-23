/**
 * What the user tells Claude once, for every request ("Context"), and which of the MCP servers
 * they already set up for Claude Code sel may hand on to it ("Claude's tools"). Both live in
 * Settings → AI and stay on this device: nothing here is synced.
 *
 * The servers are referenced by name only. Their definitions (commands, URLs, headers, tokens)
 * stay in Claude Code's own configuration, read by the main process when a request starts; sel
 * stores which ones are on and how much each may do, never what is inside them.
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */

// ---- context --------------------------------------------------------------------

/** The text the user wrote in Settings → AI → Context. */
export const AI_CONTEXT_KEY = 'ai.context'
/** Pages whose content goes along with every request, by id. */
export const AI_CONTEXT_PAGES_KEY = 'ai.contextPages'

export const AI_CONTEXT_CAPS = {
  /** Characters of the written context. */
  text: 8000,
  /** Pages that may be pinned. */
  pages: 5,
  /** Characters of one pinned page in a prompt; a longer one keeps its start and its end. */
  pageChars: 8000,
  /** Characters of all pinned pages together in a prompt. */
  pagesTotal: 20_000
} as const

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** The pinned page ids, cleaned: known shape, no duplicates, at most the cap. */
export function contextPageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const id of value) if (typeof id === 'string' && ID_RE.test(id) && !out.includes(id)) out.push(id)
  return out.slice(0, AI_CONTEXT_CAPS.pages)
}

/** What went along with one request besides the request itself, so that the window can say so. */
export interface AiSent {
  /** The written context was included. */
  context: boolean
  /** Titles of the pinned pages that were included. */
  pages: string[]
  /** Display names of the user's own MCP servers the request could use. */
  servers: string[]
  /**
   * The context of the project or database the request's page belongs to (0.8.0 A4, see
   * ./aiScope.ts), when one went along: its name, whether its text did, and its pages that did.
   */
  scopes?: { kind: 'project' | 'database'; name: string; context: boolean; pages: string[] }[]
  /** How many of the persona's remembered facts went along (0.8.0 A3, ./aiMemory.ts). */
  memory?: number
}

// ---- Claude's MCP servers ---------------------------------------------------------

export const AI_MCP_SERVERS_KEY = 'ai.mcpServers'
/**
 * What the main process last found out about the servers (the claude.ai connectors and their
 * addresses, and the tools of each server): written by main only, read by Settings.
 */
export const AI_MCP_CATALOG_KEY = 'ai.mcpCatalog'

/**
 * How much an enabled server may do in a request of sel's:
 *  - read: only tools whose name says they read (get, list, search, read…), see `isReadTool`;
 *  - custom: exactly the tools the user ticked;
 *  - all: every tool of the server, including those that create, change or delete.
 */
export const MCP_ACCESS = ['read', 'custom', 'all'] as const
export type McpAccess = (typeof MCP_ACCESS)[number]

export interface McpChoice {
  access: McpAccess
  /** `custom` only: tool names as the server gives them (without the `mcp__server__` prefix). */
  tools?: string[]
}

/** Enabled servers by id; a server that is absent is off (every server starts off). */
export type McpChoices = Record<string, McpChoice>

/** Where a server comes from in Claude Code. */
export type McpScope = 'claudeai' | 'user' | 'local'

export interface ClaudeServer {
  /** `claudeai:<name>`, `user:<name>` or `local:<name>@<project folder>`. */
  id: string
  scope: McpScope
  /** The name Claude Code knows it by ("claude.ai Veleiro", "github"). */
  name: string
  /** What it is, for the eye: a host name or a program name. Never a token or an argument. */
  detail: string
  /** `local` only: the folder whose project it belongs to. */
  project?: string
  /** The tools found the last time sel looked, by name; absent when it never looked. */
  tools?: string[]
  /** When the tools were looked up. */
  toolsAt?: number
}

export interface ClaudeServerList {
  servers: ClaudeServer[]
  /** When the claude.ai connectors were last looked up (null: never). */
  connectorsAt: number | null
  /** Claude Code's configuration could not be read (the reason, short). */
  error?: string
}

export const MCP_CAPS = { servers: 32, tools: 300, toolName: 128, id: 400 } as const

const SERVER_ID_RE = /^(claudeai|user|local):[^\u0000-\u001f\u007f]+$/
const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/

export function isMcpServerId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MCP_CAPS.id && SERVER_ID_RE.test(value)
}

export function isMcpToolName(value: unknown): value is string {
  return typeof value === 'string' && TOOL_NAME_RE.test(value)
}

/** The choices as stored, or undefined when the value is not a valid set of choices. */
export function cleanMcpChoices(value: unknown): McpChoices | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MCP_CAPS.servers) return undefined
  const out: McpChoices = {}
  for (const [id, raw] of entries) {
    if (!isMcpServerId(id) || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const choice = raw as Record<string, unknown>
    const access = choice['access']
    if (typeof access !== 'string' || !(MCP_ACCESS as readonly string[]).includes(access)) return undefined
    if (access === 'custom') {
      const tools = choice['tools']
      if (!Array.isArray(tools) || tools.length > MCP_CAPS.tools || !tools.every(isMcpToolName)) return undefined
      out[id] = { access, tools: [...new Set(tools as string[])] }
    } else {
      out[id] = { access: access as McpAccess }
    }
  }
  return out
}

/** The stored choices, or none when nothing valid is stored. */
export function mcpChoices(stored: unknown): McpChoices {
  return cleanMcpChoices(stored) ?? {}
}

/** How Claude Code turns a server name into the middle of its tool names: `mcp__<this>__tool`. */
export function toolPrefixName(serverName: string): string {
  return serverName.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** Words a tool name starts with when all it does is look something up. */
const READ_WORDS: ReadonlySet<string> = new Set([
  'get',
  'list',
  'search',
  'read',
  'fetch',
  'find',
  'query',
  'view',
  'show',
  'describe',
  'lookup',
  'count',
  'download',
  'export',
  'check',
  'retrieve',
  'browse',
  'inspect',
  'whoami'
])

/** Words that, anywhere in a name, mean it changes something: such a tool is never a read. */
const WRITE_WORDS: ReadonlySet<string> = new Set([
  'create',
  'update',
  'delete',
  'remove',
  'add',
  'set',
  'move',
  'archive',
  'unarchive',
  'send',
  'post',
  'write',
  'edit',
  'upload',
  'share',
  'trash',
  'cancel',
  'start',
  'stop',
  'complete',
  'assign',
  'transition',
  'spawn',
  'restore',
  'duplicate',
  'copy',
  'convert',
  'log',
  'clear',
  'skip',
  'rejoin',
  'propose',
  'reply',
  'invite',
  'approve',
  'merge',
  'close',
  'reopen',
  'publish',
  'run',
  'execute',
  'trigger',
  'insert',
  'modify',
  'rename',
  'mark',
  'save'
])

/**
 * Whether a tool's name says that it only reads: its first word is a reading verb (after a
 * leading product name such as "notion-"), and no word of it is a writing one. A guess from the
 * name, made to fail closed: a tool it cannot place is not a read.
 */
export function isReadTool(name: string): boolean {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (!words.length || words.some((word) => WRITE_WORDS.has(word))) return false
  return READ_WORDS.has(words[0]) || (words.length > 1 && READ_WORDS.has(words[1]))
}

/** The tools a choice allows, of those found for the server. */
export function allowedToolNames(choice: McpChoice, found: readonly string[]): string[] {
  if (choice.access === 'all') return [...found]
  if (choice.access === 'custom') return (choice.tools ?? []).filter((tool) => found.length === 0 || found.includes(tool))
  return found.filter(isReadTool)
}
