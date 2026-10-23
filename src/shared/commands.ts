/**
 * The app's commands: what the menu, the keyboard, the command palette and the shortcuts screen
 * offer, each written down once. A command is a spec (below) kept with its feature
 * (src/shared/<feature>); `COMMANDS` lists them, one line each. From it come `MenuCommand`, the
 * app shortcuts (./shortcuts.ts), the menu's items (src/main/menu.ts), the palette's entries for
 * them (src/renderer/src/commands/builtin.ts) and the shortcuts screen's
 * (src/renderer/src/shortcuts/catalog.ts). What a command does in a window is its feature's
 * `menu` handler (src/renderer/src/features.ts), and every command must have one.
 * Pure data: free of Electron and the DOM.
 */
import { AI_COMMANDS } from './ai'
import { BRIEFING_COMMANDS } from './briefing'
import { FEEDBACK_COMMANDS } from './feedback'
import { HOME_COMMANDS } from './home'
import { MEETINGS_COMMANDS } from './meetings'
import { NOTEBOOK_COMMANDS } from './notebook'
import { POMODORO_COMMANDS } from './pomodoro'
import type { AppShortcut } from './shortcuts'
import { SKY_COMMANDS } from './sky'
import { TASKS_COMMANDS } from './tasks/api'
import { WEEK_COMMANDS } from './tasks/week'
import { TEMPLATES_COMMANDS } from './templates/model'

/** The menus of the menu bar a command can sit in; `app` is macOS's application menu. */
export type MenuSubmenu = 'app' | 'file' | 'edit' | 'view' | 'help'

/** Where a command's item sits in a menu. The hundreds are groups: a separator goes between two. */
export interface MenuPlace {
  submenu: MenuSubmenu
  order: number
}

/** The groups of the shortcuts screen (see SHORTCUT_GROUPS in src/renderer/src/shortcuts/catalog.ts). */
export type ShortcutGroupId = 'general' | 'navigation' | 'pages' | 'editor' | 'blocks' | 'markdown' | 'databases' | 'herman'

export interface CommandSpec {
  /** Stable: what main sends a window, and the palette's id for it. */
  id: string
  /** Its keys. On Windows and Linux main catches them (src/main/menu.ts); on macOS the menu does. */
  shortcut?: Omit<AppShortcut, 'command'>
  /** Its item in the menu bar, in Title Case; `mac` moves it on macOS. */
  menu?: MenuPlace & { label: string; mac?: MenuPlace }
  /**
   * Its entry in the command palette, in sentence case; `order` places it among the built-in
   * commands when there is no query. Left out, the palette does not list it (or its feature
   * registers its own, with more to say).
   */
  palette?: { title: string; keywords?: readonly string[]; order: number }
  /** Its line on the shortcuts screen; `order` places it among the group's other lines. */
  catalog?: { group: ShortcutGroupId; label: string; keywords?: readonly string[]; order: number; ai?: boolean }
}

/** The shell's own commands: tabs, finding, the panels, the theme, settings. */
export const CORE_COMMANDS = [
  {
    id: 'new-page',
    shortcut: { accelerator: 'CmdOrCtrl+N', key: 'n', ctrl: true },
    menu: { submenu: 'file', label: 'New Page', order: 100 },
    palette: { title: 'New page', keywords: ['create', 'add', 'note'], order: 10 },
    catalog: { group: 'pages', label: 'New page', keywords: ['create'], order: 10 }
  },
  {
    id: 'new-tab',
    shortcut: { accelerator: 'CmdOrCtrl+T', key: 't', ctrl: true },
    menu: { submenu: 'file', label: 'New Tab', order: 120 },
    palette: { title: 'New tab', order: 150 },
    catalog: { group: 'navigation', label: 'New tab', order: 30 }
  },
  {
    id: 'close-tab',
    shortcut: { accelerator: 'CmdOrCtrl+W', key: 'w', ctrl: true },
    menu: { submenu: 'file', label: 'Close Tab', order: 300 },
    palette: { title: 'Close tab', order: 160 },
    catalog: { group: 'navigation', label: 'Close the tab', order: 40 }
  },
  {
    id: 'next-tab',
    // Held down, it keeps going: the one shortcut besides prev-tab that repeats.
    shortcut: { accelerator: 'Control+Tab', key: 'tab', ctrl: true, repeat: true },
    menu: { submenu: 'view', label: 'Next Tab', order: 500 },
    palette: { title: 'Next tab', order: 180 },
    catalog: { group: 'navigation', label: 'Next tab', order: 60 }
  },
  {
    id: 'prev-tab',
    shortcut: { accelerator: 'Control+Shift+Tab', key: 'tab', ctrl: true, shift: true, repeat: true },
    menu: { submenu: 'view', label: 'Previous Tab', order: 510 },
    palette: { title: 'Previous tab', order: 190 },
    catalog: { group: 'navigation', label: 'Previous tab', order: 70 }
  },
  {
    id: 'quick-find',
    shortcut: { accelerator: 'CmdOrCtrl+P', key: 'p', ctrl: true },
    menu: { submenu: 'file', label: 'Quick Find…', order: 200 },
    palette: { title: 'Find a page…', keywords: ['search', 'open', 'go to', 'jump'], order: 30 },
    catalog: { group: 'general', label: 'Find a page', keywords: ['search'], order: 30 }
  },
  {
    id: 'find-in-page',
    shortcut: { accelerator: 'CmdOrCtrl+F', key: 'f', ctrl: true },
    menu: { submenu: 'edit', label: 'Find in Page…', order: 400 },
    palette: { title: 'Find in this page…', keywords: ['search', 'word', 'text'], order: 40 },
    catalog: { group: 'general', label: 'Find in this page', keywords: ['search', 'word'], order: 40 }
  },
  {
    id: 'command-palette',
    // The editor may take Ctrl+K first (a link on selected text): the page decides.
    shortcut: { accelerator: 'CmdOrCtrl+K', key: 'k', ctrl: true, page: true },
    menu: { submenu: 'view', label: 'Command Palette…', order: 100 },
    catalog: { group: 'general', label: 'Run a command', keywords: ['palette'], order: 10 }
  },
  {
    id: 'toggle-sidebar',
    shortcut: { accelerator: 'CmdOrCtrl+\\', key: '\\', ctrl: true },
    menu: { submenu: 'view', label: 'Toggle Sidebar', order: 300 },
    palette: { title: 'Show or hide the sidebar', keywords: ['collapse', 'expand', 'panel'], order: 230 },
    catalog: { group: 'general', label: 'Show or hide the sidebar', order: 90 }
  },
  {
    id: 'toggle-theme',
    shortcut: { accelerator: 'CmdOrCtrl+Shift+L', key: 'l', ctrl: true, shift: true },
    menu: { submenu: 'view', label: 'Toggle Light/Dark Theme', order: 320 },
    palette: { title: 'Switch between light and dark', keywords: ['theme', 'dark mode', 'night'], order: 310 },
    catalog: { group: 'general', label: 'Light or dark theme', keywords: ['dark mode'], order: 80 }
  },
  {
    id: 'toggle-focus-mode',
    // F for focus. F11 stays the window's full screen (View menu), a separate choice.
    shortcut: { accelerator: 'CmdOrCtrl+Shift+F', key: 'f', ctrl: true, shift: true },
    menu: { submenu: 'view', label: 'Toggle Focus Mode', order: 330 },
    palette: { title: 'Focus mode: only the page', keywords: ['zen', 'distraction free', 'writing', 'hide'], order: 270 },
    catalog: { group: 'general', label: 'Focus mode: only the page', keywords: ['zen', 'distraction', 'writing', 'hide'], order: 100 }
  },
  {
    id: 'go-back',
    shortcut: { accelerator: 'Alt+Left', mac: 'Cmd+[', key: 'arrowleft', alt: true },
    menu: { submenu: 'view', label: 'Back', order: 400 },
    palette: { title: 'Back', keywords: ['history', 'navigate'], order: 200 },
    catalog: { group: 'navigation', label: 'Back', keywords: ['history'], order: 10 }
  },
  {
    id: 'go-forward',
    shortcut: { accelerator: 'Alt+Right', mac: 'Cmd+]', key: 'arrowright', alt: true },
    menu: { submenu: 'view', label: 'Forward', order: 410 },
    palette: { title: 'Forward', keywords: ['history', 'navigate'], order: 210 },
    catalog: { group: 'navigation', label: 'Forward', keywords: ['history'], order: 20 }
  },
  {
    id: 'open-settings',
    shortcut: { accelerator: 'CmdOrCtrl+,', key: ',', ctrl: true },
    // On macOS, Settings is in the application menu.
    menu: { submenu: 'file', label: 'Settings…', order: 400, mac: { submenu: 'app', order: 200 } },
    palette: { title: 'Settings', keywords: ['preferences', 'options'], order: 480 },
    catalog: { group: 'general', label: 'Settings', keywords: ['preferences'], order: 70 }
  },
  {
    id: 'reopen-tab',
    shortcut: { accelerator: 'CmdOrCtrl+Shift+T', key: 't', ctrl: true, shift: true },
    palette: { title: 'Reopen closed tab', keywords: ['undo close', 'restore'], order: 170 },
    catalog: { group: 'navigation', label: 'Reopen a closed tab', keywords: ['restore'], order: 50 }
  },
  {
    id: 'new-window',
    shortcut: { accelerator: 'CmdOrCtrl+Shift+N', key: 'n', ctrl: true, shift: true },
    palette: { title: 'New window', order: 220 },
    catalog: { group: 'general', label: 'New window', order: 120 }
  },
  {
    id: 'version-history',
    shortcut: { accelerator: 'CmdOrCtrl+Alt+Shift+H', key: 'h', ctrl: true, shift: true, alt: true },
    menu: { submenu: 'file', label: 'Version History…', order: 210 },
    catalog: { group: 'pages', label: 'Version history of this page', keywords: ['restore', 'versions'], order: 40 }
  },
  {
    id: 'keyboard-shortcuts',
    shortcut: { accelerator: 'CmdOrCtrl+/', key: '/', ctrl: true },
    menu: { submenu: 'help', label: 'Keyboard Shortcuts', order: 100 },
    palette: { title: 'Keyboard shortcuts', keywords: ['keys', 'hotkeys', 'keybindings', 'help'], order: 900 },
    catalog: { group: 'general', label: 'Keyboard shortcuts', keywords: ['keys', 'help'], order: 20 }
  },
  // Sent with an argument, by main and by links: no menu item, palette entry or keys of their own.
  /** Opens a page: arg, its id. */
  { id: 'open-page' },
  /** arg: 1-based tab position; 9 means the last tab. Main sends it for Ctrl+1…9. */
  { id: 'select-tab' }
] as const satisfies readonly CommandSpec[]

/** Every command. A feature adds its specs here, one line. */
export const COMMANDS = [
  ...CORE_COMMANDS,
  ...TEMPLATES_COMMANDS,
  ...HOME_COMMANDS,
  ...BRIEFING_COMMANDS,
  ...TASKS_COMMANDS,
  ...WEEK_COMMANDS,
  ...NOTEBOOK_COMMANDS,
  ...SKY_COMMANDS,
  ...POMODORO_COMMANDS,
  ...MEETINGS_COMMANDS,
  ...AI_COMMANDS,
  ...FEEDBACK_COMMANDS
] as const satisfies readonly CommandSpec[]

/** A command a window runs when main sends it (the menu, a shortcut) or the palette picks it. */
export type MenuCommand = (typeof COMMANDS)[number]['id']

/** The spec of a command, by its id. */
export function commandSpec(id: string, commands: readonly CommandSpec[] = COMMANDS): CommandSpec | undefined {
  return commands.find((command) => command.id === id)
}
