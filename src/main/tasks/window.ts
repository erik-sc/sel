import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import { join } from 'node:path'
import { APPEARANCE_KEY, windowBackground } from '../background'
import type { Repository } from '../db/repository'
import { DEV_URL, RENDERER_FILE } from '../security'

/**
 * The small always-on-top window of the system-wide quick add: the renderer with `?quickadd=1`,
 * which shows the quick-add input alone (renderer/src/tasks/QuickAddWindow.tsx). One at a time;
 * the shortcut pressed again brings it back to the front.
 */

const SIZE = { width: 620, height: 260 }

let current: BrowserWindow | null = null

export function openQuickAddWindow(repo: Repository): void {
  if (current && !current.isDestroyed()) {
    current.show()
    current.focus()
    return
  }
  // On the screen the pointer is on, a third of the way down: where the eyes already are.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    x: Math.round(display.x + (display.width - SIZE.width) / 2),
    y: Math.round(display.y + display.height / 3 - SIZE.height / 2),
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Add a task',
    backgroundColor: windowBackground(repo.getSetting(APPEARANCE_KEY), nativeTheme.shouldUseDarkColors),
    autoHideMenuBar: true,
    // The same sandboxed renderer as the app's windows (see createWindow in ../index.ts).
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged,
      spellcheck: process.platform === 'win32' || process.platform === 'darwin'
    }
  })
  current = win
  win.setMenuBarVisibility(false)
  win.on('closed', () => {
    if (current === win) current = null
  })
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  const loading = DEV_URL
    ? win.loadURL(Object.assign(new URL(DEV_URL), { search: '?quickadd=1' }).toString())
    : win.loadFile(RENDERER_FILE, { query: { quickadd: '1' } })
  loading.catch((err: unknown) => {
    console.error('[main] the quick-add window failed to load', err)
    if (!win.isDestroyed()) win.close()
  })
}
