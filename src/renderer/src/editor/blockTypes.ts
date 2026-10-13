// Catalogue of block types: labels, slash-menu entries, defaults. Pure.
import type { BlockProps, BlockType, ViewType } from '@shared/types'

/** Blocks whose `props.title` is rich text edited in a contenteditable. */
export const TEXT_TYPES: readonly BlockType[] = [
  'text',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list',
  'numbered_list',
  'to_do',
  'toggle',
  'quote',
  'callout'
]

export const ALL_TYPES: readonly BlockType[] = [...TEXT_TYPES, 'code', 'divider', 'image', 'bookmark', 'page', 'database']

export function isTextType(type: BlockType): boolean {
  return TEXT_TYPES.includes(type)
}

/** Types that Enter continues on the next line. */
export function continuesOnEnter(type: BlockType): boolean {
  return type === 'bulleted_list' || type === 'numbered_list' || type === 'to_do' || type === 'toggle'
}

export const PLACEHOLDERS: Partial<Record<BlockType, string>> = {
  text: "Type '/' for commands",
  heading_1: 'Heading 1',
  heading_2: 'Heading 2',
  heading_3: 'Heading 3',
  bulleted_list: 'List',
  numbered_list: 'List',
  to_do: 'To-do',
  toggle: 'Toggle',
  quote: 'Quote',
  callout: 'Callout'
}

export const DEFAULT_CALLOUT_ICON = '\u{1F4A1}'

export interface SlashItem {
  id: string
  label: string
  hint: string
  glyph: string
  keywords: string
  /** `turn` converts the current block; `insert` adds a new block. */
  kind: 'turn' | 'insert'
  type: BlockType
  view?: ViewType
  /** Opens the picker of source databases and inserts a linked view of the chosen one (showing it as `view`). */
  linked?: boolean
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: 'Text', hint: 'Plain paragraph', glyph: 'Aa', keywords: 'text paragraph plain', kind: 'turn', type: 'text' },
  { id: 'h1', label: 'Heading 1', hint: 'Large section heading', glyph: 'H1', keywords: 'heading1 h1 title #', kind: 'turn', type: 'heading_1' },
  { id: 'h2', label: 'Heading 2', hint: 'Medium section heading', glyph: 'H2', keywords: 'heading2 h2 subtitle ##', kind: 'turn', type: 'heading_2' },
  { id: 'h3', label: 'Heading 3', hint: 'Small section heading', glyph: 'H3', keywords: 'heading3 h3 ###', kind: 'turn', type: 'heading_3' },
  { id: 'bullet', label: 'Bulleted list', hint: 'Simple bulleted list', glyph: '•', keywords: 'bulleted list unordered ul', kind: 'turn', type: 'bulleted_list' },
  { id: 'number', label: 'Numbered list', hint: 'List with numbering', glyph: '1.', keywords: 'numbered list ordered ol', kind: 'turn', type: 'numbered_list' },
  { id: 'todo', label: 'To-do list', hint: 'Track tasks with checkboxes', glyph: '☑', keywords: 'todo to-do task checkbox check', kind: 'turn', type: 'to_do' },
  { id: 'toggle', label: 'Toggle', hint: 'Collapsible content', glyph: '▸', keywords: 'toggle collapse details', kind: 'turn', type: 'toggle' },
  { id: 'quote', label: 'Quote', hint: 'Capture a quote', glyph: '”', keywords: 'quote blockquote citation', kind: 'turn', type: 'quote' },
  { id: 'callout', label: 'Callout', hint: 'Make text stand out', glyph: '!', keywords: 'callout note info tip', kind: 'turn', type: 'callout' },
  { id: 'code', label: 'Code', hint: 'Code snippet', glyph: '</>', keywords: 'code snippet pre', kind: 'turn', type: 'code' },
  { id: 'divider', label: 'Divider', hint: 'Visually divide blocks', glyph: '—', keywords: 'divider line hr separator ---', kind: 'insert', type: 'divider' },
  { id: 'image', label: 'Image', hint: 'Upload an image', glyph: '▣', keywords: 'image picture photo img', kind: 'insert', type: 'image' },
  { id: 'bookmark', label: 'Bookmark', hint: 'Save a link as a card', glyph: '↗', keywords: 'bookmark link url web', kind: 'insert', type: 'bookmark' },
  { id: 'page', label: 'Page', hint: 'Embed a sub-page', glyph: '□', keywords: 'page subpage document', kind: 'insert', type: 'page' },
  { id: 'db-table', label: 'Database – table', hint: 'Inline table database', glyph: '▦', keywords: 'database table grid', kind: 'insert', type: 'database', view: 'table' },
  { id: 'db-board', label: 'Database – board', hint: 'Inline kanban board', glyph: '▥', keywords: 'database board kanban', kind: 'insert', type: 'database', view: 'board' },
  { id: 'db-list', label: 'Database – list', hint: 'Inline list database', glyph: '☰', keywords: 'database list', kind: 'insert', type: 'database', view: 'list' },
  { id: 'db-linked', label: 'Linked database view', hint: 'Show an existing database here', glyph: '↗', keywords: 'linked source view database', kind: 'insert', type: 'database', linked: true },
  { id: 'chart', label: 'Chart', hint: 'Chart the rows of an existing database', glyph: '◔', keywords: 'chart graph plot bar line pie', kind: 'insert', type: 'database', linked: true, view: 'chart' }
]

/** Entries offered by "Turn into". */
export const TURN_INTO: SlashItem[] = SLASH_ITEMS.filter((i) => i.kind === 'turn')

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  const starts: SlashItem[] = []
  const contains: SlashItem[] = []
  for (const item of SLASH_ITEMS) {
    const label = item.label.toLowerCase()
    if (label.startsWith(q) || item.keywords.split(' ').some((k) => k.startsWith(q))) starts.push(item)
    else if (label.includes(q) || item.keywords.includes(q)) contains.push(item)
  }
  return [...starts, ...contains]
}

export const CODE_LANGUAGES = [
  'plain text',
  'bash',
  'c',
  'c++',
  'c#',
  'css',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'sql',
  'swift',
  'typescript',
  'yaml'
]

/** Default schema for a database created from the slash menu. */
export function defaultDatabaseProps(view: ViewType, newId: () => string): BlockProps {
  const statusId = newId()
  const label = view === 'board' ? 'Board' : view === 'list' ? 'List' : 'Table'
  return {
    title: [],
    schema: {
      title: { id: 'title', name: 'Name', type: 'title' },
      [statusId]: {
        id: statusId,
        name: 'Status',
        type: 'select',
        options: [
          { id: newId(), name: 'Not started', color: 'gray' },
          { id: newId(), name: 'In progress', color: 'blue' },
          { id: newId(), name: 'Done', color: 'green' }
        ]
      }
    },
    views: [
      {
        id: newId(),
        name: label,
        type: view,
        visibleProperties: ['title', statusId],
        filters: [],
        sorts: [],
        ...(view === 'board' ? { groupBy: statusId } : {})
      }
    ]
  }
}

/** Cover presets, built only from design tokens. */
export const COVER_PRESETS: string[] = [
  'var(--c-gray-bg)',
  'var(--c-brown-bg)',
  'var(--c-orange-bg)',
  'var(--c-yellow-bg)',
  'var(--c-green-bg)',
  'var(--c-blue-bg)',
  'var(--c-purple-bg)',
  'var(--c-pink-bg)',
  'var(--c-red-bg)',
  'linear-gradient(135deg, var(--c-blue-bg), var(--c-purple-bg))',
  'linear-gradient(135deg, var(--c-yellow-bg), var(--c-orange-bg))',
  'linear-gradient(135deg, var(--c-green-bg), var(--c-blue-bg))',
  'linear-gradient(135deg, var(--c-pink-bg), var(--c-yellow-bg))',
  'linear-gradient(135deg, var(--c-blue), var(--c-purple))',
  'linear-gradient(135deg, var(--c-orange), var(--c-pink))',
  'linear-gradient(135deg, var(--c-green), var(--c-blue))'
]

/** True when a stored cover value is a token-based colour/gradient rather than an image url. */
export function isCssCover(cover: string): boolean {
  return /^(var\(--c-[a-z-]+\)|linear-gradient\((\d+deg, )?var\(--c-[a-z-]+\)(, var\(--c-[a-z-]+\))+\))$/.test(cover)
}
