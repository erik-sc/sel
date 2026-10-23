import { basename, join } from 'node:path'
import {
  allowedToolNames,
  isMcpToolName,
  isReadTool,
  toolPrefixName,
  type ClaudeServer,
  type McpChoices,
  type McpScope
} from '../../shared/aiContext'
import { envValue } from './locate'
import { TOOL_SERVER } from './toolspecs'

/**
 * The MCP servers the user set up for Claude Code, and how a request of sel's gets exactly the
 * ones they turned on in Settings. Pure: the caller reads the files and runs the program.
 *
 * Where they come from (Claude Code 2.1.x):
 *  - its configuration file, `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`):
 *    `mcpServers` at the top (user scope) and `projects[<folder>].mcpServers` (local scope);
 *  - the claude.ai connectors of the account (Veleiro, Gmail, Notion…), which are in no file:
 *    `claude mcp list` names them, with their addresses.
 *
 * How a request gets them (checked against 2.1.296; see docs/codebase-knowledge/30-flows/herman-ask-apply.md):
 *  - the requests that may use tools run in `--restricted` mode, which reads none of the user's
 *    settings files and so loads no server of theirs: a server from the configuration file is
 *    copied into the request's own `--mcp-config` file, next to sel's;
 *  - claude.ai connectors cannot be given that way. `--strict-mcp-config` (and `--safe-mode`)
 *    turn them all off; without it they all load. So when one is on, the request drops
 *    `--strict-mcp-config` and its settings file (`--settings`) carries an `allowedMcpServers`
 *    list: sel's server and the user's by name, each connector by its exact address. Claude
 *    Code then drops every other connector ("blocked by enterprise policy" on stderr);
 *  - which tools may run is said in the same settings file: `permissions.allow` names them, and
 *    with `--permission-prompts none` every other tool call is denied; `permissions.deny` takes
 *    the tools that are not allowed out of the model's sight.
 */

/** A server as found in the configuration file, with what is needed to start it. */
export interface LocalServer extends ClaudeServer {
  scope: 'user' | 'local'
  /** The entry as written in the configuration: copied into a request's own file, never stored by sel. */
  definition: Record<string, unknown>
}

/** A claude.ai connector, as `claude mcp list` shows it. */
export interface Connector {
  /** As Claude Code names it: "claude.ai Veleiro". */
  name: string
  /** Its address without a query or fragment. */
  url: string
}

/** What sel keeps of what it found: the connectors (names and addresses) and the tools of each server. Not secret. */
export interface McpCatalog {
  connectors: Connector[]
  connectorsAt: number | null
  tools: Record<string, { names: string[]; at: number }>
}

export const EMPTY_CATALOG: McpCatalog = { connectors: [], connectorsAt: null, tools: {} }

/** Where Claude Code keeps its configuration file. */
export function claudeConfigFile(env: NodeJS.ProcessEnv, home: string): string {
  const dir = envValue(env, 'CLAUDE_CONFIG_DIR')
  return dir ? join(dir, '.claude.json') : join(home, '.claude.json')
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A name that can be a key of an MCP configuration and a part of a tool name. */
const NAME_RE = /^[^\u0000-\u001f\u007f]{1,100}$/

/** What a server is, for the eye: the host of its address or the name of its program. Never arguments, headers or tokens. */
function describe(definition: Record<string, unknown>): string {
  const url = definition['url']
  if (typeof url === 'string') {
    try {
      return new URL(url).host
    } catch {
      return ''
    }
  }
  const command = definition['command']
  return typeof command === 'string' ? basename(command.replace(/\\/g, '/')).slice(0, 80) : ''
}

function serversOf(raw: unknown, scope: 'user' | 'local', project?: string): LocalServer[] {
  if (!isObject(raw)) return []
  const out: LocalServer[] = []
  for (const [name, definition] of Object.entries(raw)) {
    if (!NAME_RE.test(name) || !isObject(definition)) continue
    // Nothing that would start but a program or an address.
    if (typeof definition['command'] !== 'string' && typeof definition['url'] !== 'string') continue
    const id = scope === 'user' ? `user:${name}` : `local:${name}@${project ?? ''}`
    out.push({ id, scope, name, detail: describe(definition), ...(project ? { project } : {}), definition })
  }
  return out
}

/** The servers of Claude Code's configuration file (already parsed): user scope first, then each project's. */
export function readLocalServers(config: unknown): LocalServer[] {
  if (!isObject(config)) return []
  const out = serversOf(config['mcpServers'], 'user')
  const projects = config['projects']
  if (isObject(projects)) {
    for (const [folder, entry] of Object.entries(projects)) {
      if (isObject(entry) && folder.length <= 260) out.push(...serversOf(entry['mcpServers'], 'local', folder))
    }
  }
  return out
}

/** The address of a connector without its query and fragment, or null when it is not an http(s) address. */
export function connectorUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return null
  }
}

/**
 * The claude.ai connectors in what `claude mcp list` printed: lines such as
 * `claude.ai Veleiro: https://app.veleiro.ai/mcp - ✔ Connected`. Everything else is left alone.
 */
export function parseMcpList(text: string): Connector[] {
  const out: Connector[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^(claude\.ai [^\u0000-\u001f]{1,100}?): (https?:\/\/\S+)(?:\s+-\s.*)?$/.exec(line.trim())
    if (!match) continue
    const url = connectorUrl(match[2])
    if (url && !out.some((entry) => entry.name === match[1])) out.push({ name: match[1], url })
  }
  return out
}

/** A connector as Settings lists it. */
export function connectorServer(connector: Connector): ClaudeServer {
  const name = connector.name
  let host = ''
  try {
    host = new URL(connector.url).host
  } catch {
    /* listed without one */
  }
  return { id: `claudeai:${name.replace(/^claude\.ai /, '')}`, scope: 'claudeai', name, detail: host }
}

/** The catalog as stored (main writes it), or an empty one. */
export function readCatalog(stored: unknown): McpCatalog {
  if (!isObject(stored)) return { ...EMPTY_CATALOG, tools: {} }
  const connectors: Connector[] = []
  if (Array.isArray(stored['connectors'])) {
    for (const entry of stored['connectors']) {
      if (!isObject(entry) || typeof entry['name'] !== 'string' || typeof entry['url'] !== 'string') continue
      const url = connectorUrl(entry['url'])
      if (url && /^claude\.ai /.test(entry['name']) && NAME_RE.test(entry['name'])) connectors.push({ name: entry['name'], url })
    }
  }
  const tools: McpCatalog['tools'] = {}
  if (isObject(stored['tools'])) {
    for (const [id, entry] of Object.entries(stored['tools'])) {
      if (!isObject(entry) || !Array.isArray(entry['names'])) continue
      tools[id] = { names: entry['names'].filter(isMcpToolName), at: typeof entry['at'] === 'number' ? entry['at'] : 0 }
    }
  }
  const at = stored['connectorsAt']
  return { connectors, connectorsAt: typeof at === 'number' ? at : null, tools }
}

/** Every server Settings lists: the connectors first, then the configuration file's, each with the tools last found. */
export function listServers(local: readonly LocalServer[], catalog: McpCatalog): ClaudeServer[] {
  const servers: ClaudeServer[] = [
    ...catalog.connectors.map(connectorServer),
    ...local.map(({ definition: _definition, ...server }) => server)
  ]
  return servers.map((server) => {
    const tools = catalog.tools[server.id]
    return tools ? { ...server, tools: tools.names, toolsAt: tools.at } : server
  })
}

/** The tools in the `system/init` event of a run, by server: `mcp__<server>__<tool>` → tool. */
export function toolsOfServer(initTools: unknown, serverName: string): string[] {
  if (!Array.isArray(initTools)) return []
  const prefix = `mcp__${toolPrefixName(serverName)}__`
  return initTools
    .filter((tool): tool is string => typeof tool === 'string' && tool.startsWith(prefix))
    .map((tool) => tool.slice(prefix.length))
    .filter(isMcpToolName)
}

// ---- one request ------------------------------------------------------------

/** What one request needs to reach the user's servers that are on. */
export interface ExternalPlan {
  /** Servers of the configuration file, by name, for the request's `--mcp-config` file next to sel's. */
  servers: Record<string, Record<string, unknown>>
  /** The request's `--settings` file. */
  settings: {
    /** Present when a connector is on: then `--strict-mcp-config` must go, and only these load. */
    allowedMcpServers?: ({ serverName: string } | { serverUrl: string })[]
    permissions: { allow: string[]; deny: string[] }
  }
  /** Whether claude.ai connectors must be let in (`--strict-mcp-config` would turn them off). */
  connectors: boolean
  /** Display names of the servers, as the window and the prompt are told. */
  names: string[]
  /** True when some server may change things (a tool that is not a read is allowed). */
  writes: boolean
}

export interface PlanInput {
  choices: McpChoices
  local: readonly LocalServer[]
  catalog: McpCatalog
}

/** A display name: the connector without "claude.ai ", plain characters only. */
export function displayName(server: { name: string; scope: McpScope }): string {
  const name = server.scope === 'claudeai' ? server.name.replace(/^claude\.ai /, '') : server.name
  return (
    name
      .replace(/[^\p{L}\p{N} ._-]/gu, ' ')
      .trim()
      .slice(0, 60) || 'server'
  )
}

/**
 * The plan for the servers that are on, or null when none is (or none can be reached): then the
 * request runs exactly as it did before, with sel's tools only.
 */
export function planExternal({ choices, local, catalog }: PlanInput): ExternalPlan | null {
  const servers: ExternalPlan['servers'] = {}
  const allowed: { serverName: string }[] = [{ serverName: TOOL_SERVER }]
  const urls: { serverUrl: string }[] = []
  const allow: string[] = []
  const deny: string[] = []
  const names: string[] = []
  const prefixes = new Set<string>([toolPrefixName(TOOL_SERVER)])
  let writes = false
  for (const [id, choice] of Object.entries(choices)) {
    const connector = id.startsWith('claudeai:') ? catalog.connectors.find((entry) => connectorServer(entry).id === id) : undefined
    const server = connector ? { name: connector.name, scope: 'claudeai' as const } : local.find((entry) => entry.id === id)
    if (!server) continue
    const prefixName = toolPrefixName(server.name)
    // Two servers whose tools would carry the same names (or sel's): only the first is used.
    if (prefixes.has(prefixName)) continue
    const prefix = `mcp__${prefixName}`
    const found = catalog.tools[id]?.names ?? []
    if (choice.access === 'all') {
      allow.push(prefix)
      writes = true
    } else {
      const tools = allowedToolNames(choice, found)
      // Nothing it may do: it is not offered at all.
      if (!tools.length) continue
      for (const tool of tools) allow.push(`${prefix}__${tool}`)
      for (const tool of found) if (!tools.includes(tool)) deny.push(`${prefix}__${tool}`)
      if (choice.access === 'custom') writes ||= tools.some((tool) => !found.includes(tool) || !isReadTool(tool))
    }
    prefixes.add(prefixName)
    names.push(displayName(server))
    if (connector) urls.push({ serverUrl: connector.url })
    else if ('definition' in server) {
      servers[server.name] = server.definition
      allowed.push({ serverName: server.name })
    }
  }
  if (!names.length) return null
  return {
    servers,
    settings: {
      ...(urls.length ? { allowedMcpServers: [...allowed, ...urls] } : {}),
      permissions: { allow, deny }
    },
    connectors: urls.length > 0,
    names,
    writes
  }
}
