// Every keyboard shortcut the app has, as the shortcuts screen (Ctrl+/) lists them. Pure: data and
// a filter, free of React, the DOM and the store.
//
// App shortcuts name their menu command and take the keys from APP_SHORTCUTS, so the menu, the
// palette and this list cannot disagree. The keys pages, tables and Herman handle themselves are
// written here; catalog.test.ts checks the editor's against editor/keyboard.ts and editor/markdown.ts.
import type { MenuCommand } from '../../../shared/api'
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
}

export interface ShortcutGroup {
  id: string
  title: string
  entries: readonly ShortcutEntry[]
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'general',
    title: 'General',
    entries: [
      { id: 'command-palette', label: 'Run a command', command: 'command-palette', keywords: ['palette'] },
      { id: 'keyboard-shortcuts', label: 'Keyboard shortcuts', command: 'keyboard-shortcuts', keywords: ['keys', 'help'] },
      { id: 'quick-find', label: 'Find a page', command: 'quick-find', keywords: ['search'] },
      { id: 'find-in-page', label: 'Find in this page', command: 'find-in-page', keywords: ['search', 'word'] },
      { id: 'find-next', label: 'Next match, in the find bar', keys: ['Enter', 'F3'], keywords: ['search'] },
      { id: 'find-previous', label: 'Previous match, in the find bar', keys: ['Shift+Enter', 'Shift+F3'], keywords: ['search'] },
      { id: 'open-settings', label: 'Settings', command: 'open-settings', keywords: ['preferences'] },
      { id: 'toggle-theme', label: 'Light or dark theme', command: 'toggle-theme', keywords: ['dark mode'] },
      { id: 'toggle-sidebar', label: 'Show or hide the sidebar', command: 'toggle-sidebar' },
      { id: 'toggle-focus-mode', label: 'Focus mode: only the page', command: 'toggle-focus-mode', keywords: ['zen', 'distraction', 'writing', 'hide'] },
      { id: 'focus-leave', label: 'Leave focus mode, when nothing else takes the key', keys: ['Escape'], keywords: ['zen'] },
      { id: 'new-window', label: 'New window', command: 'new-window' }
    ]
  },
  {
    id: 'navigation',
    title: 'Navigation',
    entries: [
      { id: 'go-back', label: 'Back', command: 'go-back', keywords: ['history'] },
      { id: 'go-forward', label: 'Forward', command: 'go-forward', keywords: ['history'] },
      { id: 'new-tab', label: 'New tab', command: 'new-tab' },
      { id: 'close-tab', label: 'Close the tab', command: 'close-tab' },
      { id: 'reopen-tab', label: 'Reopen a closed tab', command: 'reopen-tab', keywords: ['restore'] },
      { id: 'next-tab', label: 'Next tab', command: 'next-tab' },
      { id: 'prev-tab', label: 'Previous tab', command: 'prev-tab' },
      { id: 'tab-position', label: 'Go to tab 1 to 8', keys: ['CmdOrCtrl+1…8'], notMac: true },
      { id: 'tab-last', label: 'Go to the last tab', keys: ['CmdOrCtrl+9'], notMac: true },
      { id: 'open-in-tab', label: 'Open a page in a new tab, from the sidebar', keys: ['CmdOrCtrl+Click', 'CmdOrCtrl+Enter'] },
      { id: 'open-today', label: 'Today', command: 'open-today', keywords: ['briefing', 'agenda'] },
      { id: 'open-calendar', label: 'Calendar', command: 'open-calendar', keywords: ['events'] },
      { id: 'calendar-day', label: 'A day earlier or later, in the calendar', keys: ['Left', 'Right'] },
      { id: 'calendar-week', label: 'A week earlier or later, in the calendar', keys: ['Up', 'Down'] }
    ]
  },
  {
    id: 'pages',
    title: 'Pages',
    entries: [
      { id: 'new-page', label: 'New page', command: 'new-page', keywords: ['create'] },
      { id: 'undo', label: 'Undo', keys: ['CmdOrCtrl+Z'] },
      { id: 'redo', label: 'Redo', keys: ['CmdOrCtrl+Shift+Z', 'CmdOrCtrl+Y'] },
      { id: 'version-history', label: 'Version history of this page', command: 'version-history', keywords: ['restore', 'versions'] },
      { id: 'rename-page', label: 'Rename a page, in the sidebar', keys: ['F2'] },
      { id: 'new-meeting', label: 'New meeting', command: 'new-meeting', keywords: ['record', 'transcribe'] }
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
      { id: 'leave-code', label: 'Leave a code block', keys: ['CmdOrCtrl+Enter', 'Shift+Enter'] }
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
      { id: 'blocks-clear', label: 'Back to typing', keys: ['Escape'], keywords: ['deselect'] }
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
      { id: 'db-open', label: 'Open the row as a page', keys: ['CmdOrCtrl+Enter'] },
      { id: 'db-check', label: 'Tick or untick a checkbox', keys: ['Space'] },
      { id: 'db-clear', label: 'Clear the cell', keys: ['Delete', 'Backspace'] },
      { id: 'db-deselect', label: 'Clear the selection', keys: ['Escape'] }
    ]
  },
  {
    id: 'herman',
    title: 'Herman',
    entries: [
      { id: 'toggle-assistant', label: 'Talk to Herman, the assistant', command: 'toggle-assistant', ai: true, keywords: ['ai', 'ask'] },
      { id: 'herman-send', label: 'Send the message', keys: ['Enter'], ai: true },
      { id: 'herman-line', label: 'New line in the message', keys: ['Shift+Enter'], ai: true },
      { id: 'herman-stop', label: 'Stop the answer, or close the conversation', keys: ['Escape'], ai: true },
      { id: 'herman-corner', label: 'Move Herman to another corner, when he has the focus', keys: ['Up', 'Down', 'Left', 'Right'], ai: true }
    ]
  }
]

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
