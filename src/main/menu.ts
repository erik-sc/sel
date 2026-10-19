import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '../shared/api'
import { APP_SHORTCUTS } from '../shared/shortcuts'

const isMac = process.platform === 'darwin'

/** The app shortcuts (see APP_SHORTCUTS) with this platform's accelerators. */
const SHORTCUTS = APP_SHORTCUTS.map((s) => ({ ...s, accelerator: isMac ? (s.mac ?? s.accelerator) : s.accelerator }))

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
        item('New Page from Template…', 'new-from-template'),
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
        item('Command Palette…', 'command-palette'),
        { type: 'separator' },
        item('Home', 'go-home'),
        item('Today', 'open-today'),
        item('Calendar', 'open-calendar'),
        item('Tasks', 'open-tasks'),
        item('Add a Task…', 'add-task'),
        item('Meditations', 'open-notebook'),
        item('Sky', 'open-sky'),
        item('Close the Day', 'close-day'),
        item('Start a Pomodoro', 'start-pomodoro'),
        { type: 'separator' },
        item('Toggle Sidebar', 'toggle-sidebar'),
        item('Toggle Assistant', 'toggle-assistant'),
        item('Toggle Light/Dark Theme', 'toggle-theme'),
        item('Toggle Focus Mode', 'toggle-focus-mode'),
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
      submenu: isMac ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [{ role: 'minimize' }]
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [item('Keyboard Shortcuts', 'keyboard-shortcuts'), item('Report a Bug or Suggest a Feature…', 'send-feedback')]
    }
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Windows/Linux: deliver the app shortcuts for this window (see APP_SHORTCUTS). */
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
    // A `page` shortcut is left to the page, which may give the key to the editor instead.
    const match = SHORTCUTS.find(
      (s) => !s.page && s.key === key && !!s.ctrl === input.control && !!s.shift === input.shift && !!s.alt === input.alt
    )
    if (!match) return
    event.preventDefault()
    // Holding the keys down must not open a tab per repeat.
    if (!input.isAutoRepeat || match.command === 'next-tab' || match.command === 'prev-tab') {
      sendCommand(match.command, undefined, win)
    }
  })
}
