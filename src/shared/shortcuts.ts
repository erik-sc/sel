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
