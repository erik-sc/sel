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

export const ALL_TYPES: readonly BlockType[] = [...TEXT_TYPES, 'code', 'equation', 'divider', 'image', 'bookmark', 'page', 'database']

export function isTextType(type: BlockType): boolean {
  return TEXT_TYPES.includes(type)
}

/** Blocks whose `props.title` is plain text edited in a textarea: code, and an equation's TeX. */
export function isPlainTextType(type: BlockType): boolean {
  return type === 'code' || type === 'equation'
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
  /**
   * `turn` converts the current block; `insert` adds a new block; `ai` starts an AI action;
   * `meeting` opens a new meeting page; `columns` makes a row of `columns` empty text blocks.
   */
  kind: 'turn' | 'insert' | 'ai' | 'meeting' | 'columns'
  /** `columns` only: how many columns the row has. Its label and hint come from editor/copy.ts. */
  columns?: number
  /** `ai` only: which action. `ask` opens the prompt bar. */
  ai?: 'continue' | 'summarize' | 'ask' | 'actions' | 'outline'
  type: BlockType
  view?: ViewType
  /** Opens the picker of source databases and inserts a linked view of the chosen one (showing it as `view`). */
  linked?: boolean
}

/** The slash menu's list, opened from the block `blockId` (one menu at a time, one block per id). */
export function slashListId(blockId: string): string {
  return `pe-slash-${blockId}`
}

/** The menu's `index`th option (as filterSlashItems lists them). */
export function slashOptionId(blockId: string, index: number): string {
  return `pe-slash-${blockId}-${index}`
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: 'Text', hint: 'Plain paragraph', glyph: 'Aa', keywords: 'text paragraph plain', kind: 'turn', type: 'text' },
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Large section heading',
    glyph: 'H1',
    keywords: 'heading1 h1 title #',
    kind: 'turn',
    type: 'heading_1'
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Medium section heading',
    glyph: 'H2',
    keywords: 'heading2 h2 subtitle ##',
    kind: 'turn',
    type: 'heading_2'
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Small section heading',
    glyph: 'H3',
    keywords: 'heading3 h3 ###',
    kind: 'turn',
    type: 'heading_3'
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    hint: 'Simple bulleted list',
    glyph: '•',
    keywords: 'bulleted list unordered ul',
    kind: 'turn',
    type: 'bulleted_list'
  },
  {
    id: 'number',
    label: 'Numbered list',
    hint: 'List with numbering',
    glyph: '1.',
    keywords: 'numbered list ordered ol',
    kind: 'turn',
    type: 'numbered_list'
  },
  {
    id: 'todo',
    label: 'To-do list',
    hint: 'Track tasks with checkboxes',
    glyph: '☑',
    keywords: 'todo to-do task checkbox check',
    kind: 'turn',
    type: 'to_do'
  },
  {
    id: 'toggle',
    label: 'Toggle',
    hint: 'Collapsible content',
    glyph: '▸',
    keywords: 'toggle collapse details',
    kind: 'turn',
    type: 'toggle'
  },
  { id: 'quote', label: 'Quote', hint: 'Capture a quote', glyph: '”', keywords: 'quote blockquote citation', kind: 'turn', type: 'quote' },
  {
    id: 'callout',
    label: 'Callout',
    hint: 'Make text stand out',
    glyph: '!',
    keywords: 'callout note info tip',
    kind: 'turn',
    type: 'callout'
  },
  { id: 'code', label: 'Code', hint: 'Code snippet', glyph: '</>', keywords: 'code snippet pre', kind: 'turn', type: 'code' },
  {
    id: 'equation',
    label: 'Equation',
    hint: 'Display math in LaTeX',
    glyph: '√x',
    keywords: 'equation equação equacao math matemática matematica formula fórmula latex tex katex $$',
    kind: 'turn',
    type: 'equation'
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'Visually divide blocks',
    glyph: '—',
    keywords: 'divider line hr separator ---',
    kind: 'insert',
    type: 'divider'
  },
  {
    id: 'columns-2',
    label: '2 columns',
    hint: 'Two blocks side by side',
    glyph: 'II',
    keywords: 'columns layout side',
    kind: 'columns',
    type: 'text',
    columns: 2
  },
  {
    id: 'columns-3',
    label: '3 columns',
    hint: 'Three blocks side by side',
    glyph: 'III',
    keywords: 'columns layout side',
    kind: 'columns',
    type: 'text',
    columns: 3
  },
  { id: 'image', label: 'Image', hint: 'Upload an image', glyph: '▣', keywords: 'image picture photo img', kind: 'insert', type: 'image' },
  {
    id: 'bookmark',
    label: 'Bookmark',
    hint: 'Save a link as a card',
    glyph: '↗',
    keywords: 'bookmark link url web',
    kind: 'insert',
    type: 'bookmark'
  },
  { id: 'page', label: 'Page', hint: 'Embed a sub-page', glyph: '□', keywords: 'page subpage document', kind: 'insert', type: 'page' },
  {
    id: 'meeting',
    label: 'Meeting notes',
    hint: 'Record a meeting and take notes',
    glyph: '●',
    keywords: 'meeting notes record recording transcript call',
    kind: 'meeting',
    type: 'page'
  },
  {
    id: 'db-table',
    label: 'Database – table',
    hint: 'Inline table database',
    glyph: '▦',
    keywords: 'database table grid',
    kind: 'insert',
    type: 'database',
    view: 'table'
  },
  {
    id: 'db-board',
    label: 'Database – board',
    hint: 'Inline kanban board',
    glyph: '▥',
    keywords: 'database board kanban',
    kind: 'insert',
    type: 'database',
    view: 'board'
  },
  {
    id: 'db-list',
    label: 'Database – list',
    hint: 'Inline list database',
    glyph: '☰',
    keywords: 'database list',
    kind: 'insert',
    type: 'database',
    view: 'list'
  },
  {
    id: 'db-linked',
    label: 'Linked database view',
    hint: 'Show an existing database here',
    glyph: '↗',
    keywords: 'linked source view database',
    kind: 'insert',
    type: 'database',
    linked: true
  },
  {
    id: 'chart',
    label: 'Chart',
    hint: 'Chart the rows of an existing database',
    glyph: '◔',
    keywords: 'chart graph plot bar line pie',
    kind: 'insert',
    type: 'database',
    linked: true,
    view: 'chart'
  },
  {
    id: 'calc',
    label: 'Calculations',
    hint: 'Figures computed from an existing database',
    glyph: 'Σ',
    keywords: 'calculations calc formula sum total average figures',
    kind: 'insert',
    type: 'database',
    linked: true,
    view: 'calc'
  }
]

/** The "AI" group of the slash menu; offered only while AI is turned on (see ai/gate.ts). */
export const AI_SLASH_ITEMS: SlashItem[] = [
  {
    id: 'ai-continue',
    label: 'Continue writing',
    hint: 'Carry on from here in the same voice',
    glyph: '✦',
    keywords: 'ai continue writing write more',
    kind: 'ai',
    ai: 'continue',
    type: 'text'
  },
  {
    id: 'ai-summarize',
    label: 'Summarize page',
    hint: 'Key points and action items',
    glyph: '✦',
    keywords: 'ai summarize summary tldr',
    kind: 'ai',
    ai: 'summarize',
    type: 'text'
  },
  {
    id: 'ai-ask',
    label: 'Ask AI…',
    hint: 'Describe what to write',
    glyph: '✦',
    keywords: 'ai ask write draft generate prompt',
    kind: 'ai',
    ai: 'ask',
    type: 'text'
  },
  {
    id: 'ai-actions',
    label: 'Action items',
    hint: 'Extract tasks as a to-do list',
    glyph: '✦',
    keywords: 'ai action items tasks todo',
    kind: 'ai',
    ai: 'actions',
    type: 'text'
  },
  {
    id: 'ai-outline',
    label: 'Outline',
    hint: 'Turn the notes into a structured outline',
    glyph: '✦',
    keywords: 'ai outline structure',
    kind: 'ai',
    ai: 'outline',
    type: 'text'
  }
]

/** Entries offered by "Turn into". */
export const TURN_INTO: SlashItem[] = SLASH_ITEMS.filter((i) => i.kind === 'turn')

/**
 * Portuguese words that find each slash item, kept apart from the catalogue so that an
 * entry added there needs no line here. Labels stay as they are; only the search widens.
 */
export const SLASH_KEYWORDS_PT: Readonly<Record<string, string>> = {
  text: 'texto parágrafo simples',
  h1: 'título cabeçalho título1 seção',
  h2: 'título2 subtítulo cabeçalho',
  h3: 'título3 cabeçalho',
  bullet: 'lista marcadores tópicos',
  number: 'lista numerada ordenada números',
  todo: 'tarefa tarefas lista de tarefas caixa marcar afazer',
  toggle: 'alternância recolher expandir sanfona detalhes',
  quote: 'citação aspas',
  callout: 'destaque aviso nota dica observação',
  code: 'código trecho programa',
  divider: 'divisor linha separador',
  'columns-2': '2 colunas lado a lado',
  'columns-3': '3 colunas lado a lado',
  image: 'imagem foto figura',
  bookmark: 'favorito marcador link endereço site',
  page: 'página subpágina documento',
  meeting: 'reunião notas gravar gravação transcrição chamada',
  'db-table': 'banco de dados tabela planilha',
  'db-board': 'banco de dados quadro kanban',
  'db-list': 'banco de dados lista',
  'db-linked': 'banco de dados vinculado vinculada visão fonte',
  chart: 'gráfico barras linhas pizza',
  calc: 'cálculos cálculo fórmula soma total média números',
  'ai-continue': 'ia continuar escrevendo escrever mais',
  'ai-summarize': 'ia resumir resumo',
  'ai-ask': 'ia perguntar pedir escrever rascunho gerar',
  'ai-actions': 'ia itens de ação pendências',
  'ai-outline': 'ia estrutura esboço roteiro'
}

/** Lower case without accents: `Citação` and `citacao` are the same query. */
export function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * The items for a query, in English or Portuguese, accents and case aside: those whose
 * label starts with it, then the column items when a word of their label does ("col": "2 columns",
 * before Toggle's "collapse"), then those with a search word that does, then those that merely
 * contain it. Only the column items get that second rank, so no other query changes its order.
 * `columns` false leaves out "2 columns" and "3 columns" (the block is nested or in a row already).
 */
export function filterSlashItems(query: string, ai = false, columns = true): SlashItem[] {
  const blocks = columns ? SLASH_ITEMS : SLASH_ITEMS.filter((item) => item.kind !== 'columns')
  const all = ai ? [...AI_SLASH_ITEMS, ...blocks] : blocks
  const q = foldSearch(query.trim())
  if (!q) return all
  const label: SlashItem[] = []
  const labelWord: SlashItem[] = []
  const word: SlashItem[] = []
  const contains: SlashItem[] = []
  for (const item of all) {
    const name = foldSearch(item.label)
    const keywords = foldSearch(`${item.keywords} ${SLASH_KEYWORDS_PT[item.id] ?? ''}`)
    if (name.startsWith(q)) label.push(item)
    else if (item.kind === 'columns' && name.split(' ').some((w) => w.startsWith(q))) labelWord.push(item)
    else if (keywords.split(' ').some((k) => k.startsWith(q))) word.push(item)
    else if (name.includes(q) || keywords.includes(q)) contains.push(item)
  }
  return [...label, ...labelWord, ...word, ...contains]
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
