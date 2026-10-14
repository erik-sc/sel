import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '../shared/api'

const isMac = process.platform === 'darwin'

interface Shortcut {
  command: MenuCommand
  /** Electron accelerator, shown in the menu (and registered by it on macOS). */
  accelerator: string
  /** `KeyboardEvent.key`, lower-cased. */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

/**
 * On Windows/Linux the window is frameless and the menu bar hidden, so these
 * are matched in `before-input-event` instead of relying on the native menu
 * (which also cannot reliably deliver Ctrl+Tab). On macOS the menu owns them.
 */
const SHORTCUTS: Shortcut[] = [
  { command: 'new-page', accelerator: 'CmdOrCtrl+N', key: 'n', ctrl: true },
  { command: 'new-tab', accelerator: 'CmdOrCtrl+T', key: 't', ctrl: true },
  { command: 'close-tab', accelerator: 'CmdOrCtrl+W', key: 'w', ctrl: true },
  { command: 'next-tab', accelerator: 'Control+Tab', key: 'tab', ctrl: true },
  { command: 'prev-tab', accelerator: 'Control+Shift+Tab', key: 'tab', ctrl: true, shift: true },
  { command: 'quick-find', accelerator: 'CmdOrCtrl+P', key: 'p', ctrl: true },
  { command: 'find-in-page', accelerator: 'CmdOrCtrl+F', key: 'f', ctrl: true },
  { command: 'toggle-sidebar', accelerator: 'CmdOrCtrl+\\', key: '\\', ctrl: true },
  { command: 'toggle-theme', accelerator: 'CmdOrCtrl+Shift+L', key: 'l', ctrl: true, shift: true },
  { command: 'go-back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', key: 'arrowleft', alt: true },
  { command: 'go-forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', key: 'arrowright', alt: true },
  { command: 'open-settings', accelerator: 'CmdOrCtrl+,', key: ',', ctrl: true },
  { command: 'reopen-tab', accelerator: 'CmdOrCtrl+Shift+T', key: 't', ctrl: true, shift: true },
  { command: 'new-window', accelerator: 'CmdOrCtrl+Shift+N', key: 'n', ctrl: true, shift: true },
  { command: 'version-history', accelerator: 'CmdOrCtrl+Alt+Shift+H', key: 'h', ctrl: true, shift: true, alt: true },
  { command: 'toggle-assistant', accelerator: 'CmdOrCtrl+J', key: 'j', ctrl: true },
  { command: 'open-today', accelerator: 'CmdOrCtrl+Alt+T', key: 't', ctrl: true, alt: true },
  { command: 'open-calendar', accelerator: 'CmdOrCtrl+Alt+C', key: 'c', ctrl: true, alt: true },
  { command: 'new-meeting', accelerator: 'CmdOrCtrl+Alt+M', key: 'm', ctrl: true, alt: true }
]

export function sendCommand(command: MenuCommand, arg?: unknown, target?: BrowserWindow | null): void {
  const win = target ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (arg === undefined) win.webContents.send(IPC.command, command)
  else win.webContents.send(IPC.command, command, arg)
}

function item(label: string, command: MenuCommand, index = 0): MenuItemConstructorOptions {
  const shortcuts = SHORTCUTS.filter((s) => s.command === command)
  const shortcut = shortcuts[index]
  return {
    label,
    accelerator: shortcut?.accelerator,
    // Elsewhere the accelerator is display-only; attachShortcuts() does the work.
    registerAccelerator: isMac,
    click: (_item, win) => sendCommand(command, undefined, win instanceof BrowserWindow ? win : null)
  }
}

export function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = []
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        item('Settings…', 'open-settings'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }
  template.push(
    {
      label: 'File',
      submenu: [
        item('New Page', 'new-page'),
        item('New Tab', 'new-tab'),
        item('New Meeting', 'new-meeting'),
        { type: 'separator' },
        item('Quick Find…', 'quick-find'),
        item('Version History…', 'version-history'),
        // Second binding for the same command; hidden so the menu lists it once.
        { ...item('Quick Find…', 'quick-find', 1), visible: false, acceleratorWorksWhenHidden: true },
        { type: 'separator' },
        item('Close Tab', 'close-tab'),
        ...(isMac
          ? [{ role: 'close', accelerator: 'Cmd+Shift+W' } as MenuItemConstructorOptions]
          : [
              { type: 'separator' } as MenuItemConstructorOptions,
              item('Settings…', 'open-settings'),
              { type: 'separator' } as MenuItemConstructorOptions,
              { role: 'quit' } as MenuItemConstructorOptions
            ])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find in Page…', 'find-in-page')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Today', 'open-today'),
        item('Calendar', 'open-calendar'),
        { type: 'separator' },
        item('Toggle Sidebar', 'toggle-sidebar'),
        item('Toggle Assistant', 'toggle-assistant'),
        item('Toggle Light/Dark Theme', 'toggle-theme'),
        { type: 'separator' },
        item('Back', 'go-back'),
        item('Forward', 'go-forward'),
        { type: 'separator' },
        item('Next Tab', 'next-tab'),
        item('Previous Tab', 'prev-tab'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        // Developer tools (and their Ctrl+Shift+I accelerator) exist only in unpackaged builds.
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      role: 'window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }]
    }
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Windows/Linux: deliver the app shortcuts for this window (see SHORTCUTS). */
export function attachShortcuts(win: BrowserWindow): void {
  if (isMac) return
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.meta) return
    const key = input.key.toLowerCase()
    // Ctrl+1..8 select a tab by position, Ctrl+9 the last one.
    if (input.control && !input.shift && !input.alt && /^[1-9]$/.test(key)) {
      event.preventDefault()
      sendCommand('select-tab', Number(key), win)
      return
    }
    const match = SHORTCUTS.find(
      (s) => s.key === key && !!s.ctrl === input.control && !!s.shift === input.shift && !!s.alt === input.alt
    )
    if (!match) return
    event.preventDefault()
    // Holding the keys down must not open a tab per repeat.
    if (!input.isAutoRepeat || match.command === 'next-tab' || match.command === 'prev-tab') {
      sendCommand(match.command, undefined, win)
    }
  })
}
