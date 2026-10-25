// The app's keyboard shortcuts, shared by the menu (main) and the command palette (renderer), so
// a shortcut is written down once: in its command's spec (./commands.ts). Pure data and string
// helpers: free of Electron and the DOM.
import { COMMANDS, type CommandSpec, type MenuCommand } from './commands'

export interface AppShortcut {
  command: MenuCommand
  /** Electron accelerator, shown in the menu (and registered by it on macOS). */
  accelerator: string
  /** The accelerator on macOS, when it differs. */
  mac?: string
  /** `KeyboardEvent.key`, lower-cased. */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /**
   * The page handles this key itself, because the editor may claim it first (Ctrl+K adds a link
   * to selected text): on Windows/Linux main leaves it alone instead of catching it.
   */
  page?: boolean
  /** Held down, it runs again with every repeat (the next and previous tab); others run once. */
  repeat?: boolean
}

/** The shortcuts of these commands, in their order. */
export function shortcutsOf(commands: readonly CommandSpec[]): AppShortcut[] {
  return commands.flatMap((spec) => (spec.shortcut ? [{ command: spec.id as MenuCommand, ...spec.shortcut }] : []))
}

/**
 * On Windows/Linux the window is frameless and the menu bar hidden, so these are matched in
 * `before-input-event` instead of relying on the native menu (which also cannot reliably
 * deliver Ctrl+Tab). On macOS the menu owns them.
 */
export const APP_SHORTCUTS: readonly AppShortcut[] = shortcutsOf(COMMANDS)

/** The accelerator a menu command uses on this platform (the first one, if it has several). */
export function acceleratorOf(command: MenuCommand, mac: boolean): string | undefined {
  const shortcut = APP_SHORTCUTS.find((s) => s.command === command)
  return shortcut && (mac ? (shortcut.mac ?? shortcut.accelerator) : shortcut.accelerator)
}

const MAC_MODIFIERS: Record<string, string> = {
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  cmd: '⌘',
  command: '⌘',
  super: '⌘',
  meta: '⌘'
}
// The order macOS lists modifiers in.
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']
const OTHER_MODIFIERS: Record<string, string> = {
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  cmd: 'Win',
  command: 'Win',
  super: 'Win',
  meta: 'Win'
}
const OTHER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Win']
const KEY_NAMES: Record<string, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  plus: '+',
  space: 'Space',
  escape: 'Esc',
  return: 'Enter',
  enter: 'Enter',
  pageup: 'Page Up',
  pagedown: 'Page Down'
}

/**
 * An Electron accelerator as people read it: `CmdOrCtrl+Shift+L` is `Ctrl+Shift+L` on Windows
 * and Linux and `⇧⌘L` on macOS.
 */
export function formatAccelerator(accelerator: string, mac: boolean): string {
  // `CmdOrCtrl++` is the plus key.
  const plus = accelerator.endsWith('++')
  const parts = (plus ? accelerator.slice(0, -2) : accelerator).split('+')
  const rawKey = plus ? '+' : (parts.pop() ?? '')
  const modifiers = new Set<string>()
  for (const part of parts) {
    const name = part.toLowerCase()
    if (name === 'cmdorctrl' || name === 'commandorcontrol') modifiers.add(mac ? '⌘' : 'Ctrl')
    else {
      const symbol = (mac ? MAC_MODIFIERS : OTHER_MODIFIERS)[name]
      if (symbol) modifiers.add(symbol)
    }
  }
  const key = KEY_NAMES[rawKey.toLowerCase()] ?? (rawKey.length === 1 ? rawKey.toUpperCase() : rawKey)
  const ordered = (mac ? MAC_ORDER : OTHER_ORDER).filter((m) => modifiers.has(m))
  return mac ? ordered.join('') + key : [...ordered, key].join('+')
}

/**
 * A key a page handles itself (a list, a popover, the editor), written like an app shortcut. On
 * Windows and Linux main sees every key first: one that matched an app shortcut would never reach
 * the page, so shortcuts.test.ts checks that none does.
 */
export interface PageKey {
  accelerator: string
  /** `KeyboardEvent.key`, lower-cased. */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /** Where it works. */
  where: string
}

/** The keys of the lists and menus (see "Teclado e leitor de tela" in docs/codebase-knowledge/50-conventions.md). */
export const PAGE_KEYS: readonly PageKey[] = [
  { where: 'any item with a menu', accelerator: 'Shift+F10', key: 'f10', shift: true },
  { where: 'any item with a menu', accelerator: 'ContextMenu', key: 'contextmenu' },
  { where: 'board and calendar', accelerator: 'Control+Alt+Left', key: 'arrowleft', ctrl: true, alt: true },
  { where: 'board and calendar', accelerator: 'Control+Alt+Right', key: 'arrowright', ctrl: true, alt: true },
  { where: 'board and calendar', accelerator: 'Control+Alt+Up', key: 'arrowup', ctrl: true, alt: true },
  { where: 'board and calendar', accelerator: 'Control+Alt+Down', key: 'arrowdown', ctrl: true, alt: true },
  { where: 'sidebar', accelerator: 'Alt+Shift+Up', key: 'arrowup', alt: true, shift: true },
  { where: 'sidebar', accelerator: 'Alt+Shift+Down', key: 'arrowdown', alt: true, shift: true },
  { where: 'sidebar', accelerator: 'Alt+Shift+Right', key: 'arrowright', alt: true, shift: true },
  { where: 'sidebar', accelerator: 'Alt+Shift+Left', key: 'arrowleft', alt: true, shift: true },
  { where: 'tab strip', accelerator: 'Control+Shift+PageUp', key: 'pageup', ctrl: true, shift: true },
  { where: 'tab strip', accelerator: 'Control+Shift+PageDown', key: 'pagedown', ctrl: true, shift: true },
  { where: 'selected text', accelerator: 'Alt+F10', key: 'f10', alt: true },
  // A focused task row (src/renderer/src/tasks/model.ts, rowKeyAction) and the refine mode's card
  // (tasks/refineWalk.ts, refineKeyAction): letters, digits and signs, unmodified.
  { where: 'task rows and the refine card', accelerator: 'Enter', key: 'enter' },
  { where: 'task rows and the refine card', accelerator: 'Control+Enter', key: 'enter', ctrl: true },
  // F2 on a table's column header opens its menu, name focused: rename (database/views/TableView.tsx).
  { where: 'task rows, the refine card and table headers', accelerator: 'F2', key: 'f2' },
  { where: 'task rows and the refine card', accelerator: 'D', key: 'd' },
  { where: 'task rows and the refine card', accelerator: 'R', key: 'r' },
  { where: 'task rows and the refine card', accelerator: 'L', key: 'l' },
  { where: 'task rows and the refine card', accelerator: '1', key: '1' },
  { where: 'task rows and the refine card', accelerator: '2', key: '2' },
  { where: 'task rows and the refine card', accelerator: '3', key: '3' },
  { where: 'task rows and the refine card', accelerator: '4', key: '4' },
  { where: 'task rows and the refine card', accelerator: '#', key: '#' },
  { where: 'task rows and the refine card', accelerator: '@', key: '@' },
  { where: 'task rows and the refine card', accelerator: 'Space', key: ' ' },
  { where: 'task rows and the refine card', accelerator: 'Delete', key: 'delete' },
  { where: 'task rows and the refine card', accelerator: 'Control+]', key: ']', ctrl: true },
  { where: 'task rows and the refine card', accelerator: 'Control+[', key: '[', ctrl: true },
  { where: 'refine card', accelerator: 'S', key: 's' },
  { where: 'refine card', accelerator: 'Left', key: 'arrowleft' },
  { where: 'refine card', accelerator: 'Right', key: 'arrowright' }
]

/**
 * The zoom keys, menu accelerators (main's menu, src/main/zoom.ts). The first of each is shown;
 * the others are there for keyboards and layouts that do not make the first.
 */
export const ZOOM_KEYS: Readonly<Record<'in' | 'out' | 'reset', readonly PageKey[]>> = {
  in: [
    { where: 'window', accelerator: 'CmdOrCtrl+Plus', key: '+', ctrl: true, shift: true },
    { where: 'window', accelerator: 'CmdOrCtrl+=', key: '=', ctrl: true },
    { where: 'window', accelerator: 'CmdOrCtrl+numadd', key: '+', ctrl: true }
  ],
  out: [
    { where: 'window', accelerator: 'CmdOrCtrl+-', key: '-', ctrl: true },
    { where: 'window', accelerator: 'CmdOrCtrl+numsub', key: '-', ctrl: true }
  ],
  reset: [
    { where: 'window', accelerator: 'CmdOrCtrl+0', key: '0', ctrl: true },
    { where: 'window', accelerator: 'CmdOrCtrl+num0', key: '0', ctrl: true }
  ]
}
