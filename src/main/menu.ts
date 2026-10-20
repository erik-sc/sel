import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '../shared/api'
import { COMMANDS, type CommandSpec, type MenuCommand, type MenuPlace, type MenuSubmenu } from '../shared/commands'
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

function item(label: string, command: MenuCommand): MenuItemConstructorOptions {
  return {
    label,
    accelerator: SHORTCUTS.find((s) => s.command === command)?.accelerator,
    // Elsewhere the accelerator is display-only; attachShortcuts() does the work.
    registerAccelerator: isMac,
    click: (_item, win) => sendCommand(command, undefined, win instanceof BrowserWindow ? win : null)
  }
}

/** An item of a menu at its place: the hundreds of `order` are groups, with a separator between two. */
interface Placed {
  order: number
  item: MenuItemConstructorOptions
}

/** Where a command sits in the menu bar on this platform, if anywhere. */
function placeOf(spec: CommandSpec): MenuPlace | null {
  if (!spec.menu) return null
  return isMac && spec.menu.mac ? spec.menu.mac : spec.menu
}

/** A menu: its own items (roles) and the commands that name it, in order, separated by group. */
function submenu(id: MenuSubmenu, own: readonly Placed[]): MenuItemConstructorOptions[] {
  const placed: Placed[] = [...own]
  for (const spec of COMMANDS as readonly CommandSpec[]) {
    const place = placeOf(spec)
    if (place?.submenu === id && spec.menu) placed.push({ order: place.order, item: item(spec.menu.label, spec.id as MenuCommand) })
  }
  placed.sort((a, b) => a.order - b.order)
  const out: MenuItemConstructorOptions[] = []
  placed.forEach((entry, index) => {
    if (index > 0 && Math.floor(entry.order / 100) !== Math.floor(placed[index - 1].order / 100)) out.push({ type: 'separator' })
    out.push(entry.item)
  })
  return out
}

export function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = []
  if (isMac) {
    template.push({
      label: app.name,
      submenu: submenu('app', [
        { order: 100, item: { role: 'about' } },
        { order: 300, item: { role: 'services' } },
        { order: 400, item: { role: 'hide' } },
        { order: 410, item: { role: 'hideOthers' } },
        { order: 420, item: { role: 'unhide' } },
        { order: 500, item: { role: 'quit' } }
      ])
    })
  }
  template.push(
    {
      label: 'File',
      submenu: submenu(
        'file',
        isMac ? [{ order: 310, item: { role: 'close', accelerator: 'Cmd+Shift+W' } }] : [{ order: 500, item: { role: 'quit' } }]
      )
    },
    {
      label: 'Edit',
      submenu: submenu('edit', [
        { order: 100, item: { role: 'undo' } },
        { order: 110, item: { role: 'redo' } },
        { order: 200, item: { role: 'cut' } },
        { order: 210, item: { role: 'copy' } },
        { order: 220, item: { role: 'paste' } },
        { order: 230, item: { role: 'pasteAndMatchStyle' } },
        { order: 240, item: { role: 'delete' } },
        { order: 300, item: { role: 'selectAll' } }
      ])
    },
    {
      label: 'View',
      submenu: submenu('view', [
        { order: 600, item: { role: 'reload' } },
        { order: 610, item: { role: 'forceReload' } },
        // Developer tools (and their Ctrl+Shift+I accelerator) exist only in unpackaged builds.
        ...(app.isPackaged ? [] : [{ order: 620, item: { role: 'toggleDevTools' } } as Placed]),
        { order: 700, item: { role: 'resetZoom' } },
        { order: 710, item: { role: 'zoomIn' } },
        { order: 720, item: { role: 'zoomOut' } },
        { order: 800, item: { role: 'togglefullscreen' } }
      ])
    },
    {
      label: 'Window',
      role: 'window',
      submenu: isMac ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [{ role: 'minimize' }]
    },
    { label: 'Help', role: 'help', submenu: submenu('help', []) }
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
    if (!input.isAutoRepeat || match.repeat) {
      sendCommand(match.command, undefined, win)
    }
  })
}
