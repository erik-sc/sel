// Every keyboard shortcut the app has, as the shortcuts screen (Ctrl+/) lists them. Pure: data and
// a filter, free of React, the DOM and the store.
//
// App shortcuts are their commands' lines (`catalog` in src/shared/commands.ts) and take the keys
// from APP_SHORTCUTS, so the menu, the palette and this list cannot disagree. The keys pages, tables and Herman handle themselves are
// written here; catalog.test.ts checks the editor's against editor/keyboard.ts and editor/markdown.ts.
import { COMMANDS, type CommandSpec, type MenuCommand } from '../../../shared/commands'
import { acceleratorOf, formatAccelerator } from '../../../shared/shortcuts'
import { fold, foldQuery } from '../shell/findInPage'

export interface ShortcutEntry {
  /** Unique across the list. */
  id: string
  /** What the keys do, in sentence case. */
  label: string
  /** An app shortcut: its keys are the menu command's (see APP_SHORTCUTS). */
  command?: MenuCommand
  /** Electron-style accelerators ('CmdOrCtrl+B'); several are alternatives. */
  keys?: readonly string[]
  /** Text typed to trigger it (Markdown), shown as written; a trailing space is shown as Space. */
  typed?: string
  /** Other words it is found by. */
  keywords?: readonly string[]
  /** Only there while AI is on. */
  ai?: boolean
  /** Not on macOS (main delivers it only on Windows and Linux). */
  notMac?: boolean
  /** Its place in a group that also lists commands (their `catalog.order`); ten apart. */
  order?: number
}

export interface ShortcutGroup {
  id: string
  title: string
  entries: readonly ShortcutEntry[]
}

/**
 * The lines written here: keys that pages, tables and Herman handle themselves. In a group that
 * also lists commands (their `catalog` in src/shared/commands.ts), each has an `order` to sit among them.
 */
const OWN_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'general',
    title: 'General',
    entries: [
      { id: 'find-next', order: 50, label: 'Next match, in the find bar', keys: ['Enter', 'F3'], keywords: ['search'] },
      { id: 'find-previous', order: 60, label: 'Previous match, in the find bar', keys: ['Shift+Enter', 'Shift+F3'], keywords: ['search'] },
      { id: 'focus-leave', order: 110, label: 'Leave focus mode, when nothing else takes the key', keys: ['Escape'], keywords: ['zen'] },
      {
        id: 'item-menu',
        order: 130,
        label: 'Open the menu of the focused page, tab, card or row',
        keys: ['Shift+F10'],
        keywords: ['menu key', 'context', 'right click']
      },
      { id: 'zoom-in', order: 140, label: 'Zoom in', keys: ['CmdOrCtrl+Plus', 'CmdOrCtrl+='], keywords: ['bigger', 'larger'] },
      { id: 'zoom-out', order: 150, label: 'Zoom out', keys: ['CmdOrCtrl+-'], keywords: ['smaller'] },
      { id: 'zoom-reset', order: 160, label: 'Actual size', keys: ['CmdOrCtrl+0'], keywords: ['zoom', 'reset'] }
    ]
  },
  {
    id: 'navigation',
    title: 'Navigation',
    entries: [
      {
        id: 'tab-move',
        order: 75,
        label: 'Move the tab left or right, in the tab strip',
        keys: ['Control+Shift+PageUp', 'Control+Shift+PageDown'],
        keywords: ['reorder']
      },
      { id: 'tab-position', order: 80, label: 'Go to tab 1 to 8', keys: ['CmdOrCtrl+1…8'], notMac: true },
      { id: 'tab-last', order: 90, label: 'Go to the last tab', keys: ['CmdOrCtrl+9'], notMac: true },
      { id: 'open-in-tab', order: 100, label: 'Open a page in a new tab, from the sidebar', keys: ['CmdOrCtrl+Click', 'CmdOrCtrl+Enter'] },
      { id: 'add-task-here', order: 160, label: 'Add a task, on the Tasks screen', keys: ['Q'], keywords: ['quick add'] },
      { id: 'calendar-day', order: 190, label: 'A day earlier or later, in the calendar', keys: ['Left', 'Right'] },
      { id: 'calendar-week', order: 200, label: 'A week earlier or later, in the calendar', keys: ['Up', 'Down'] }
    ]
  },
  {
    id: 'pages',
    title: 'Pages',
    entries: [
      { id: 'undo', order: 20, label: 'Undo', keys: ['CmdOrCtrl+Z'] },
      { id: 'redo', order: 30, label: 'Redo', keys: ['CmdOrCtrl+Shift+Z', 'CmdOrCtrl+Y'] },
      { id: 'rename-page', order: 50, label: 'Rename a page, in the sidebar', keys: ['F2'] },
      {
        id: 'move-page',
        order: 52,
        label: 'Move a page up or down, in the sidebar',
        keys: ['Alt+Shift+Up', 'Alt+Shift+Down'],
        keywords: ['reorder']
      },
      {
        id: 'nest-page',
        order: 54,
        label: 'Put a page inside the one above, or take it out of its parent',
        keys: ['Alt+Shift+Right', 'Alt+Shift+Left'],
        keywords: ['indent', 'parent', 'move']
      }
    ]
  },
  {
    id: 'editor',
    title: 'Editor',
    entries: [
      { id: 'insert-block', label: 'Insert a block', typed: '/', keywords: ['slash', 'menu', 'turn into'] },
      { id: 'new-block', label: 'New block', keys: ['Enter'] },
      { id: 'line-break', label: 'Line break in the block', keys: ['Shift+Enter'], keywords: ['new line'] },
      { id: 'bold', label: 'Bold', keys: ['CmdOrCtrl+B'] },
      { id: 'italic', label: 'Italic', keys: ['CmdOrCtrl+I'] },
      { id: 'underline', label: 'Underline', keys: ['CmdOrCtrl+U'] },
      { id: 'strikethrough', label: 'Strikethrough', keys: ['CmdOrCtrl+Shift+S'] },
      { id: 'inline-code', label: 'Inline code', keys: ['CmdOrCtrl+E'] },
      { id: 'link', label: 'Link the selected text', keys: ['CmdOrCtrl+K'] },
      { id: 'indent', label: 'Indent', keys: ['Tab'], keywords: ['nest'] },
      { id: 'outdent', label: 'Outdent', keys: ['Shift+Tab'], keywords: ['unnest'] },
      { id: 'move-block', label: 'Move the block up or down', keys: ['CmdOrCtrl+Shift+Up', 'CmdOrCtrl+Shift+Down'] },
      { id: 'duplicate-block', label: 'Duplicate the block', keys: ['CmdOrCtrl+D'], keywords: ['copy'] },
      { id: 'select-block', label: 'Select the block', keys: ['Escape'] },
      { id: 'select-all', label: 'Select every block (press twice)', keys: ['CmdOrCtrl+A'] },
      { id: 'ai-write', label: 'Write with AI, on an empty line', keys: ['Space'], ai: true, keywords: ['herman'] },
      { id: 'leave-code', label: 'Leave a code block', keys: ['CmdOrCtrl+Enter', 'Shift+Enter'] },
      { id: 'toolbar', label: 'Go to the formatting toolbar, with text selected', keys: ['Alt+F10'], keywords: ['format', 'ai'] }
    ]
  },
  {
    id: 'blocks',
    title: 'Selected blocks',
    entries: [
      { id: 'blocks-move-selection', label: 'Select the block above or below', keys: ['Up', 'Down'] },
      { id: 'blocks-extend', label: 'Select more blocks', keys: ['Shift+Up', 'Shift+Down'] },
      { id: 'blocks-edit', label: 'Edit the block', keys: ['Enter'] },
      { id: 'blocks-delete', label: 'Delete the blocks', keys: ['Backspace', 'Delete'], keywords: ['remove'] },
      { id: 'blocks-indent', label: 'Indent or outdent', keys: ['Tab', 'Shift+Tab'] },
      { id: 'blocks-move', label: 'Move the blocks up or down', keys: ['CmdOrCtrl+Shift+Up', 'CmdOrCtrl+Shift+Down'] },
      { id: 'blocks-duplicate', label: 'Duplicate the blocks', keys: ['CmdOrCtrl+D'], keywords: ['copy'] },
      { id: 'blocks-clear', label: 'Back to typing', keys: ['Escape'], keywords: ['deselect'] },
      { id: 'blocks-menu', label: 'Open the menu of the selected blocks', keys: ['Shift+F10'], keywords: ['menu key', 'options'] }
    ]
  },
  {
    id: 'markdown',
    title: 'Markdown',
    entries: [
      { id: 'md-heading-1', label: 'Heading 1', typed: '# ' },
      { id: 'md-heading-2', label: 'Heading 2', typed: '## ' },
      { id: 'md-heading-3', label: 'Heading 3', typed: '### ' },
      { id: 'md-bulleted', label: 'Bulleted list', typed: '- ' },
      { id: 'md-numbered', label: 'Numbered list', typed: '1. ' },
      { id: 'md-todo', label: 'To-do', typed: '[] ', keywords: ['checkbox', 'task'] },
      { id: 'md-quote', label: 'Quote', typed: '> ' },
      { id: 'md-toggle', label: 'Toggle', typed: '>> ', keywords: ['collapse'] },
      { id: 'md-code', label: 'Code block', typed: '```' },
      { id: 'md-divider', label: 'Divider', typed: '---', keywords: ['line', 'rule'] },
      { id: 'md-bold', label: 'Bold', typed: '**bold**' },
      { id: 'md-italic', label: 'Italic', typed: '*italic*' },
      { id: 'md-code-inline', label: 'Inline code', typed: '`code`' },
      { id: 'md-strike', label: 'Strikethrough', typed: '~~strike~~' }
    ]
  },
  {
    id: 'databases',
    title: 'Databases',
    entries: [
      { id: 'db-move', label: 'Move between cells', keys: ['Up', 'Down', 'Left', 'Right'], keywords: ['table'] },
      { id: 'db-next-cell', label: 'Next or previous cell', keys: ['Tab', 'Shift+Tab'] },
      { id: 'db-edge', label: 'First or last row', keys: ['CmdOrCtrl+Up', 'CmdOrCtrl+Down'] },
      { id: 'db-row-edge', label: 'First or last cell in the row', keys: ['Home', 'End'] },
      { id: 'db-page', label: 'A screen up or down', keys: ['PageUp', 'PageDown'] },
      { id: 'db-edit', label: 'Edit the cell', keys: ['Enter', 'F2'] },
      {
        id: 'db-header',
        label: 'From the first row up to the column headers; Left, Right, Home and End move along them',
        keys: ['Up'],
        keywords: ['column', 'property']
      },
      {
        id: 'db-header-menu',
        label: "Open a column header's menu: rename, insert left or right",
        keys: ['Enter', 'Space', 'F2', 'Shift+F10'],
        keywords: ['column', 'property', 'rename']
      },
      { id: 'db-open', label: 'Open the row as a page', keys: ['CmdOrCtrl+Enter'] },
      { id: 'db-check', label: 'Tick or untick a checkbox', keys: ['Space'] },
      { id: 'db-clear', label: 'Clear the cell', keys: ['Delete', 'Backspace'] },
      { id: 'db-deselect', label: 'Clear the selection', keys: ['Escape'] },
      {
        id: 'db-card-move',
        label: 'Move a card to the group beside, on a board',
        keys: ['Control+Alt+Left', 'Control+Alt+Right'],
        keywords: ['kanban']
      },
      { id: 'db-card-order', label: 'Move a card up or down its group, on a board', keys: ['Control+Alt+Up', 'Control+Alt+Down'] },
      { id: 'db-event-day', label: 'Move an event a day earlier or later, in a calendar', keys: ['Control+Alt+Left', 'Control+Alt+Right'] },
      { id: 'db-event-week', label: 'Move an event a week earlier or later, in a calendar', keys: ['Control+Alt+Up', 'Control+Alt+Down'] }
    ]
  },
  {
    id: 'tasks',
    title: 'Tasks',
    entries: [
      { id: 'task-move-focus', label: 'Previous or next task, in a list of tasks', keys: ['Up', 'Down'], keywords: ['todo'] },
      { id: 'task-panel', label: 'Open the task panel, on a focused task', keys: ['Enter'], keywords: ['details', 'todo'] },
      { id: 'task-page-tab', label: "Open the task's page in a new tab", keys: ['CmdOrCtrl+Enter', 'CmdOrCtrl+Click'] },
      {
        id: 'task-rename',
        label: 'Rename the task; dates, p1–p4, #project and @label in the name are read',
        keys: ['F2'],
        keywords: ['title', 'edit']
      },
      { id: 'task-date', label: 'Change the date of the task', keys: ['D'], keywords: ['due', 'schedule'] },
      { id: 'task-repeat', label: 'Change how the task repeats', keys: ['R'], keywords: ['recurrence', 'recurring'] },
      { id: 'task-priority', label: 'Priority 1 to 4; the same again takes it away', keys: ['1…4'], keywords: ['p1', 'urgent'] },
      { id: 'task-project', label: 'Change the project of the task', keys: ['#'] },
      { id: 'task-labels', label: 'Change the labels of the task', keys: ['@'], keywords: ['tags'] },
      { id: 'task-remind', label: 'Remind about the task', keys: ['L'], keywords: ['reminder', 'alarm'] },
      { id: 'task-complete', label: 'Complete the task', keys: ['Space'], keywords: ['done', 'check'] },
      { id: 'task-delete', label: 'Delete the task (Undo on the message)', keys: ['Delete'], keywords: ['remove', 'trash'] },
      {
        id: 'task-nest',
        label: 'Make the task a subtask of the one above, or take it out',
        keys: ['CmdOrCtrl+]', 'CmdOrCtrl+['],
        keywords: ['indent', 'outdent', 'subtask']
      },
      {
        id: 'refine-next',
        label: 'Refine mode: the next task, or skip this one for now',
        keys: ['Enter', 'S'],
        keywords: ['refinar', 'inbox', 'triage']
      },
      { id: 'refine-back', label: 'Refine mode: the task before, or the one after', keys: ['Left', 'Right'], keywords: ['refinar'] },
      {
        id: 'refine-fields',
        label: 'Refine mode: name, date, repeat, priority, project, labels; Delete deletes, Escape leaves',
        keys: ['F2', 'D', 'R', '1…4', '#', '@'],
        keywords: ['refinar', 'triage']
      }
    ]
  },
  {
    id: 'herman',
    title: 'Herman',
    entries: [
      { id: 'herman-send', order: 20, label: 'Send the message', keys: ['Enter'], ai: true },
      { id: 'herman-line', order: 30, label: 'New line in the message', keys: ['Shift+Enter'], ai: true },
      { id: 'herman-stop', order: 40, label: 'Stop the answer, or close the conversation', keys: ['Escape'], ai: true },
      {
        id: 'herman-corner',
        order: 50,
        label: 'Move Herman to another corner, when he has the focus',
        keys: ['Up', 'Down', 'Left', 'Right'],
        ai: true
      }
    ]
  }
]

/** `groups` with the commands' lines put in, each where its `order` says. */
export function withCommands(groups: readonly ShortcutGroup[], commands: readonly CommandSpec[]): ShortcutGroup[] {
  return groups.map((group) => {
    const own = commands.flatMap((spec): ShortcutEntry[] => {
      if (spec.catalog?.group !== group.id) return []
      const { label, keywords, order, ai } = spec.catalog
      return [{ id: spec.id, label, command: spec.id as MenuCommand, keywords, order, ...(ai ? { ai } : {}) }]
    })
    if (!own.length) return group
    return { ...group, entries: [...group.entries, ...own].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }
  })
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = withCommands(OWN_GROUPS, COMMANDS)

export interface ShownEntry {
  id: string
  label: string
  /** In the platform's notation; alternatives. */
  keys: string[]
  /** Text to type, without its trailing space. */
  typed?: string
  /** The typed text ends with a space. */
  thenSpace?: boolean
}

export interface ShownGroup {
  id: string
  title: string
  entries: ShownEntry[]
}

export interface ShowOptions {
  mac: boolean
  /** Whether AI is on: entries marked `ai` are left out otherwise. */
  ai: boolean
  /** Filter: every word must be in the label, the group title, the keys or the keywords; case and accents are ignored. */
  query?: string
}

function show(entry: ShortcutEntry, mac: boolean): ShownEntry {
  const accelerators = [...(entry.command ? [acceleratorOf(entry.command, mac)] : []), ...(entry.keys ?? [])]
  const keys = accelerators.filter((a): a is string => !!a).map((a) => formatAccelerator(a, mac))
  const typed = entry.typed
  if (typed === undefined) return { id: entry.id, label: entry.label, keys }
  const thenSpace = typed.endsWith(' ')
  return { id: entry.id, label: entry.label, keys, typed: thenSpace ? typed.trimEnd() : typed, thenSpace }
}

/** The groups and entries to list on this platform, filtered by `query`. Groups left empty are dropped. */
export function shownShortcuts({ mac, ai, query = '' }: ShowOptions): ShownGroup[] {
  const words = foldQuery(query).split(' ').filter(Boolean)
  const out: ShownGroup[] = []
  for (const group of SHORTCUT_GROUPS) {
    const entries: ShownEntry[] = []
    for (const entry of group.entries) {
      if ((entry.ai && !ai) || (entry.notMac && mac)) continue
      const shown = show(entry, mac)
      if (words.length) {
        const hay = fold([group.title, entry.label, ...shown.keys, entry.typed ?? '', ...(entry.keywords ?? [])].join(' ')).text
        if (!words.every((word) => hay.includes(word))) continue
      }
      entries.push(shown)
    }
    if (entries.length) out.push({ id: group.id, title: group.title, entries })
  }
  return out
}
