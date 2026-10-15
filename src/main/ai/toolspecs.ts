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

const VALUES = {
  type: 'object',
  description:
    'Values by property name, as read_database lists them. Title and text: a string. Number: a number. Checkbox: true or false. Select: the name of one of its options; multi-select: a list of option names. Date: "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" (a local time), or {"start", "end"} with those. URL: a string. Relation: a list of row ids. null clears a value. Computed properties cannot be set.',
  additionalProperties: true
}

const MARKDOWN = { type: 'string', description: 'Markdown: headings, paragraphs, lists, to-dos ("- [ ] "), quotes, code, tables and links.' }

/**
 * The tools that write, offered only to the apps the user connected in Settings (see
 * ../external): never to Herman, whose changes are proposals the user applies. None of them
 * deletes or overwrites anything but the values it is asked to set.
 */
export const WRITE_TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'create_page',
    description: 'Creates a new page from Markdown, at the top level of the workspace or inside another page. Returns its id.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title. Without one, a leading "# heading" of the Markdown becomes the title.' },
        markdown: MARKDOWN,
        parent: { ...ID, description: 'The page to create it in, by id. Leave it out for the top level.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'append_to_page',
    description: 'Adds Markdown to the end of an existing page. What the page already holds is left as it is.',
    inputSchema: { type: 'object', properties: { id: ID, markdown: MARKDOWN }, required: ['id', 'markdown'], additionalProperties: false }
  },
  {
    name: 'add_database_row',
    description: 'Adds a row to a database, with its values by property name. Returns the id of the new row.',
    inputSchema: { type: 'object', properties: { database: ID, values: VALUES }, required: ['database', 'values'], additionalProperties: false }
  },
  {
    name: 'update_database_row',
    description: 'Sets values of one row of a database, by property name. Properties left out keep their values.',
    inputSchema: { type: 'object', properties: { id: ID, values: VALUES }, required: ['id', 'values'], additionalProperties: false }
  }
]

/** Everything a connected app is offered: the reading tools, then the writing ones. */
export const EXTERNAL_TOOL_SPECS: readonly ToolSpec[] = [...TOOL_SPECS, ...WRITE_TOOL_SPECS]

export const WRITE_TOOL_NAMES: readonly string[] = WRITE_TOOL_SPECS.map((spec) => spec.name)

export const TOOL_NAMES: readonly string[] = TOOL_SPECS.map((spec) => spec.name)

/** The tool names as Claude Code knows them once the server is called `sel`. */
export const ALLOWED_TOOLS: readonly string[] = TOOL_NAMES.map((name) => `mcp__${TOOL_SERVER}__${name}`)

/** The tools by name, for the prompt: exactly the ones that exist. */
export const TOOL_LIST = TOOL_NAMES.join(', ')
