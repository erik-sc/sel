/**
 * The workspace tools as the MCP server lists them (see ./tools.ts for what they do, and
 * ../mcp.ts for the server). Plain data with no imports: the server script bundles this file
 * and nothing else of the app.
 */

/** The name the server is given in the program's configuration: its tools are mcp__sel__<name>. */
export const TOOL_SERVER = 'sel'

export const TOOL_CAPS = {
  title: 100,
  search: 25,
  outlineLines: 400,
  outlineDepth: 4,
  page: 24_000,
  rows: 100,
  cell: 160,
  recent: 40,
  /** Pages the audit walks before it stops. */
  auditPages: 4000,
  auditList: 25,
  /** A page untouched for this many days counts as stale. */
  staleDays: 120
} as const

export interface ToolSpec {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false }
}

const ID = { type: 'string', description: 'An id, as shown in square brackets after a title.' }

/** The tools, in the order they are listed. */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'search',
    description: 'Full-text search over the titles and contents of the pages in the workspace. Returns matching pages with their ids, where they sit and a snippet.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for.' }, limit: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.search } }, required: ['query'], additionalProperties: false }
  },
  {
    name: 'outline',
    description: 'The tree of pages and databases: the whole workspace from the top, or what is inside one page. Each entry has its id, how many rows a database has, when it was last edited, and "empty" when a page has nothing in it.',
    inputSchema: { type: 'object', properties: { root: ID, depth: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.outlineDepth } }, additionalProperties: false }
  },
  {
    name: 'read_page',
    description: 'One page as Markdown, with where it sits and the pages inside it. For a database, its properties and its first rows.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'read_database',
    description: 'The properties of a database (with the options of select properties) and its rows, each with its id and its values.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.rows } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'recent',
    description: 'The pages and databases edited most recently.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.recent } }, additionalProperties: false }
  },
  {
    name: 'audit',
    description:
      'A health check of the whole workspace for putting it in order: pages with the same title, empty pages, untitled pages, pages untouched for months, crowded places with many pages side by side, and databases without rows.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
]

export const TOOL_NAMES: readonly string[] = TOOL_SPECS.map((spec) => spec.name)

/** The tool names as Claude Code knows them once the server is called `sel`. */
export const ALLOWED_TOOLS: readonly string[] = TOOL_NAMES.map((name) => `mcp__${TOOL_SERVER}__${name}`)

/** The tools by name, for the prompt: exactly the ones that exist. */
export const TOOL_LIST = TOOL_NAMES.join(', ')
