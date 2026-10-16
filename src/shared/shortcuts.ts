// The app's keyboard shortcuts, shared by the menu (main) and the command palette (renderer), so
// a shortcut is written down once. Pure data and string helpers: free of Electron and the DOM.
import type { MenuCommand } from './api'

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
}

/**
 * On Windows/Linux the window is frameless and the menu bar hidden, so these are matched in
 * `before-input-event` instead of relying on the native menu (which also cannot reliably
 * deliver Ctrl+Tab). On macOS the menu owns them.
 */
export const APP_SHORTCUTS: readonly AppShortcut[] = [
  { command: 'new-page', accelerator: 'CmdOrCtrl+N', key: 'n', ctrl: true },
  { command: 'new-tab', accelerator: 'CmdOrCtrl+T', key: 't', ctrl: true },
  { command: 'close-tab', accelerator: 'CmdOrCtrl+W', key: 'w', ctrl: true },
  { command: 'next-tab', accelerator: 'Control+Tab', key: 'tab', ctrl: true },
  { command: 'prev-tab', accelerator: 'Control+Shift+Tab', key: 'tab', ctrl: true, shift: true },
  { command: 'quick-find', accelerator: 'CmdOrCtrl+P', key: 'p', ctrl: true },
  { command: 'find-in-page', accelerator: 'CmdOrCtrl+F', key: 'f', ctrl: true },
  { command: 'command-palette', accelerator: 'CmdOrCtrl+K', key: 'k', ctrl: true, page: true },
  { command: 'toggle-sidebar', accelerator: 'CmdOrCtrl+\\', key: '\\', ctrl: true },
  { command: 'toggle-theme', accelerator: 'CmdOrCtrl+Shift+L', key: 'l', ctrl: true, shift: true },
  // F for focus. F11 stays the window's full screen (View menu), a separate choice.
  { command: 'toggle-focus-mode', accelerator: 'CmdOrCtrl+Shift+F', key: 'f', ctrl: true, shift: true },
  { command: 'go-back', accelerator: 'Alt+Left', mac: 'Cmd+[', key: 'arrowleft', alt: true },
  { command: 'go-forward', accelerator: 'Alt+Right', mac: 'Cmd+]', key: 'arrowright', alt: true },
  { command: 'open-settings', accelerator: 'CmdOrCtrl+,', key: ',', ctrl: true },
  { command: 'reopen-tab', accelerator: 'CmdOrCtrl+Shift+T', key: 't', ctrl: true, shift: true },
  { command: 'new-window', accelerator: 'CmdOrCtrl+Shift+N', key: 'n', ctrl: true, shift: true },
  { command: 'version-history', accelerator: 'CmdOrCtrl+Alt+Shift+H', key: 'h', ctrl: true, shift: true, alt: true },
  { command: 'toggle-assistant', accelerator: 'CmdOrCtrl+J', key: 'j', ctrl: true },
  { command: 'go-home', accelerator: 'CmdOrCtrl+Alt+H', key: 'h', ctrl: true, alt: true },
  { command: 'open-today', accelerator: 'CmdOrCtrl+Alt+T', key: 't', ctrl: true, alt: true },
  { command: 'open-calendar', accelerator: 'CmdOrCtrl+Alt+C', key: 'c', ctrl: true, alt: true },
  { command: 'open-tasks', accelerator: 'CmdOrCtrl+Alt+K', key: 'k', ctrl: true, alt: true },
  { command: 'add-task', accelerator: 'CmdOrCtrl+Alt+A', key: 'a', ctrl: true, alt: true },
  // N for notebook. Ctrl+N is a new page, Ctrl+Shift+N a new window.
  { command: 'open-notebook', accelerator: 'CmdOrCtrl+Alt+N', key: 'n', ctrl: true, alt: true },
  { command: 'new-meeting', accelerator: 'CmdOrCtrl+Alt+M', key: 'm', ctrl: true, alt: true },
  { command: 'start-pomodoro', accelerator: 'CmdOrCtrl+Alt+P', key: 'p', ctrl: true, alt: true },
  { command: 'keyboard-shortcuts', accelerator: 'CmdOrCtrl+/', key: '/', ctrl: true }
]

/** The accelerator a menu command uses on this platform (the first one, if it has several). */
export function acceleratorOf(command: MenuCommand, mac: boolean): string | undefined {
  const shortcut = APP_SHORTCUTS.find((s) => s.command === command)
  return shortcut && (mac ? (shortcut.mac ?? shortcut.accelerator) : shortcut.accelerator)
}

const MAC_MODIFIERS: Record<string, string> = { control: '⌃', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', cmd: '⌘', command: '⌘', super: '⌘', meta: '⌘' }
// The order macOS lists modifiers in.
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']
const OTHER_MODIFIERS: Record<string, string> = { control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', cmd: 'Win', command: 'Win', super: 'Win', meta: 'Win' }
const OTHER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Win']
const KEY_NAMES: Record<string, string> = { left: '←', right: '→', up: '↑', down: '↓', plus: '+', space: 'Space', escape: 'Esc', return: 'Enter', enter: 'Enter', pageup: 'Page Up', pagedown: 'Page Down' }

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
