/**
 * The workspace tools as the MCP server lists them (see ./tools.ts for what they do, and
 * ../mcp.ts for the server). Plain data: the server script bundles this file and the other
 * blocks' specs (../tools/catalog.ts), and nothing else of the app.
 */
import { definePack, scoped } from '../tools/pack'

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
  staleDays: 120,
  trash: 50,
  /** Properties a new database is given, and options a select is. */
  properties: 30,
  options: 50
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
    description:
      'Full-text search over the titles and contents of the pages in the workspace. Returns matching pages with their ids, where they sit and a snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for.' },
        limit: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.search }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'outline',
    description:
      'The tree of pages and databases: the whole workspace from the top, or what is inside one page. Each entry has its id, how many rows a database has, when it was last edited, and "empty" when a page has nothing in it.',
    inputSchema: {
      type: 'object',
      properties: { root: ID, depth: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.outlineDepth } },
      additionalProperties: false
    }
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
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.recent } },
      additionalProperties: false
    }
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

const MARKDOWN = {
  type: 'string',
  description: 'Markdown: headings, paragraphs, lists, to-dos ("- [ ] "), quotes, code, tables and links.'
}

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
    inputSchema: {
      type: 'object',
      properties: { database: ID, values: VALUES },
      required: ['database', 'values'],
      additionalProperties: false
    }
  },
  {
    name: 'update_database_row',
    description: 'Sets values of one row of a database, by property name. Properties left out keep their values.',
    inputSchema: { type: 'object', properties: { id: ID, values: VALUES }, required: ['id', 'values'], additionalProperties: false }
  }
]

const PROPERTY_TYPES = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url'] as const

const PROPERTY = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: [...PROPERTY_TYPES] },
    options: {
      type: 'array',
      items: { type: 'string' },
      maxItems: TOOL_CAPS.options,
      description: 'select and multi_select: the names of its options.'
    },
    format: { type: 'string', enum: ['number', 'percent', 'currency'], description: 'number only: how it is shown.' }
  },
  required: ['name', 'type'],
  additionalProperties: false
}

/**
 * What only the apps the user connected read, beyond what Herman has (TOOL_SPECS stays his
 * list): the trash, to put something back.
 */
export const EXTRA_READ_SPECS: readonly ToolSpec[] = [
  {
    name: 'list_trash',
    description: 'The pages, databases and rows in the trash, the latest first, with their ids: what restore_page can put back.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: TOOL_CAPS.trash } },
      additionalProperties: false
    }
  }
]

/**
 * The tools that reorganise: they change or take away what is there, always in a way the user
 * can undo in sel. A page's history keeps the state before a rewrite (Version history); what is
 * deleted goes to the trash and stays there until the user empties it. Nothing is ever deleted
 * for good from here.
 */
export const EDIT_TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'update_page',
    description:
      'Changes a page: its title, its icon, or its whole text, replaced by new Markdown (the pages and databases inside it stay). The version history keeps what it said before. For a database or a row, only the title and icon.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        title: { type: 'string' },
        icon: { type: ['string', 'null'], description: 'An emoji; null removes it.' },
        markdown: { ...MARKDOWN, description: 'The new text of the page, in place of what it holds now.' }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'move_page',
    description: 'Moves a page or a database into another page, or to the top level of the workspace.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, parent: { type: ['string', 'null'], description: 'The page to move it into, by id; null for the top level.' } },
      required: ['id', 'parent'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_page',
    description:
      'Moves a page, a database or a row of a database to the trash, with what is inside it. It stays there until the user empties the trash: restore_page puts it back.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'restore_page',
    description: 'Puts back something that is in the trash (see list_trash), where it was.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'create_database',
    description:
      'Creates a database with the properties given, at the top level or inside a page. It always has a title property; the others are text, number, select, multi_select, date, checkbox or url. Returns its id: add rows with add_database_row.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        parent: { ...ID, description: 'The page to create it in, by id. Leave it out for the top level.' },
        title_property: { type: 'string', description: 'What the title property is called. Left out: "Name".' },
        properties: { type: 'array', items: PROPERTY, maxItems: TOOL_CAPS.properties }
      },
      required: ['title'],
      additionalProperties: false
    }
  },
  {
    name: 'add_database_property',
    description: 'Adds a property (a column) to a database.',
    inputSchema: {
      type: 'object',
      properties: { database: ID, ...PROPERTY.properties },
      required: ['database', 'name', 'type'],
      additionalProperties: false
    }
  },
  {
    name: 'add_select_options',
    description: 'Adds options to a select or multi_select property of a database, by name. The ones it already has are left as they are.',
    inputSchema: {
      type: 'object',
      properties: {
        database: ID,
        property: { type: 'string', description: 'The property, by name.' },
        options: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: TOOL_CAPS.options }
      },
      required: ['database', 'property', 'options'],
      additionalProperties: false
    }
  }
]

export const EDIT_TOOL_NAMES: readonly string[] = EDIT_TOOL_SPECS.map((spec) => spec.name)

/**
 * The workspace as a block's tools (../tools/pack.ts): reading under `read`, everything that
 * writes under `write`.
 */
export const WORKSPACE_PACK = definePack({
  id: 'workspace',
  title: 'Pages and databases',
  summary: 'The pages and databases of the workspace: search, read, create, rewrite, move, and the trash.',
  tools: [...scoped('read', [...TOOL_SPECS, ...EXTRA_READ_SPECS]), ...scoped('write', [...WRITE_TOOL_SPECS, ...EDIT_TOOL_SPECS])]
})

export const WRITE_TOOL_NAMES: readonly string[] = WRITE_TOOL_SPECS.map((spec) => spec.name)

export const TOOL_NAMES: readonly string[] = TOOL_SPECS.map((spec) => spec.name)

/** The tool names as Claude Code knows them once the server is called `sel`. */
export const ALLOWED_TOOLS: readonly string[] = TOOL_NAMES.map((name) => `mcp__${TOOL_SERVER}__${name}`)

/** The tools by name, for the prompt: exactly the ones that exist. */
export const TOOL_LIST = TOOL_NAMES.join(', ')
