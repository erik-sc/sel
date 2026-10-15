import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, screen, session, shell, type Session } from 'electron'
import { APPEARANCE_KEY, windowBackground } from './background'
import { DEFAULT_SIZE, fitBounds, MIN_SIZE, type SavedBounds } from './bounds'
import { openDatabase, type Repository } from './db'
import { isValidId } from './db/blocks'
import { ensureTasksDatabase } from './db/tasks'
import { handleFileProtocol, registerFileScheme } from './files'
import { readTheme, registerIpc, type SyncHooks } from './ipc'
import { recordingGrants } from './meetings/grant'
import { handleDisplayMedia } from './meetings/register'
import { adoptLegacyProfile, DB_FILE } from './legacy'
import { attachShortcuts, buildMenu } from './menu'
import { DEV_URL, isAllowedRequest, isAppUrl, isDevServerUrl, RENDERER_FILE, toExternalUrl } from './security'
import { flushTrace, mark } from './trace'

const BOUNDS_KEY = 'windowBounds'
/** The only permission the renderer needs: `navigator.clipboard.writeText` (copy code / copy link). */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

let repo: Repository | null = null
let syncHooks: SyncHooks | null = null
/** How long after the first window is shown the first sync starts. */
const SYNC_START_DELAY_MS = 1500

mark('main script start')
// Privileged schemes have to be declared before the app is ready.
registerFileScheme()

function restoreBounds(): Partial<SavedBounds> {
  return fitBounds(
    repo?.getSetting(BOUNDS_KEY),
    screen.getAllDisplays().map((d) => d.workArea)
  )
}

function trackBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    timer = null
    if (!repo || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    try {
      const value: SavedBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }
      repo.setSetting(BOUNDS_KEY, value)
    } catch {
      /* losing a window position is not worth surfacing */
    }
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}

/** Renderer crash recovery: reload, then reload ignoring cache, then give up and ask. */
function recoverFromCrashes(win: BrowserWindow): void {
  let crashes = 0
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    crashes += 1
    if (crashes === 1) win.webContents.reload()
    else if (crashes === 2) win.webContents.reloadIgnoringCache()
    else {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'error',
        message: 'This window keeps crashing.',
        detail: `Reason: ${details.reason}. Your pages are saved on disk.`,
        buttons: ['Reload', 'Close window'],
        cancelId: 1
      })
      if (choice === 0) win.webContents.reloadIgnoringCache()
      else win.destroy()
    }
  })
}

function createWindow(pageId?: string): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const bounds = restoreBounds()
  const others = BrowserWindow.getAllWindows().length
  // Cascade additional windows instead of stacking them exactly on top of each other.
  const offset = others * 28

  const win = new BrowserWindow({
    width: bounds.width ?? DEFAULT_SIZE.width,
    height: bounds.height ?? DEFAULT_SIZE.height,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x + offset, y: bounds.y + offset } : {}),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'sel',
    // What the OS paints until the page has: the wallpaper base of the theme about to render.
    backgroundColor: windowBackground(repo?.getSetting(APPEARANCE_KEY), nativeTheme.shouldUseDarkColors),
    // The renderer draws its own title bar and window controls.
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer is an ordinary sandboxed web page; the preload only bridges ipc.
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
      // Windows and macOS spell-check with the OS; elsewhere Chromium would download
      // dictionaries from a remote server, which a local-first app does not do.
      spellcheck: process.platform === 'win32' || process.platform === 'darwin'
      // `v8CacheOptions` is deliberately not set: Chromium keeps no compiled-code cache for
      // scripts loaded from file://, so the option changes nothing here (checked: the profile's
      // "Code Cache/js" stays empty with 'bypassHeatCheck', across restarts).
    }
  })

  if (!isMac) win.setMenuBarVisibility(false)
  attachShortcuts(win)
  recoverFromCrashes(win)
  trackBounds(win)
  // Closing the window that records a meeting would cut the recording short: ask first.
  win.on('close', (event) => {
    const meetings = syncHooks?.meetings
    if (!meetings?.holdsRecording(win)) return
    event.preventDefault()
    meetings.askToStop(win, 'close')
  })

  // The startup trace ends with the first window: loaded and painted, in whichever order.
  let milestones = others === 0 ? 2 : 0
  const milestone = (label: string): void => {
    if (milestones === 0) return
    mark(label)
    if (--milestones === 0) flushTrace()
  }
  win.webContents.once('did-finish-load', () => milestone('did-finish-load'))
  win.once('ready-to-show', () => {
    milestone('ready-to-show')
    if (bounds.maximized && others === 0) win.maximize()
    win.show()
  })

  const page = pageId && isValidId(pageId) ? pageId : undefined
  let loading: Promise<void>
  if (DEV_URL) {
    const url = new URL(DEV_URL)
    if (page) url.searchParams.set('page', page)
    loading = win.loadURL(url.toString())
  } else {
    loading = win.loadFile(RENDERER_FILE, page ? { query: { page } } : undefined)
  }
  loading.catch((err: unknown) => {
    console.error('[main] the window failed to load', err)
    // Nothing was painted, so `ready-to-show` never fires: do not leave an invisible window behind.
    if (!win.isDestroyed() && !win.isVisible()) win.show()
    flushTrace()
  })
  return win
}

function openExternal(url: string): void {
  const target = toExternalUrl(url)
  if (target) shell.openExternal(target).catch((err: unknown) => console.error('[main] openExternal failed', err))
}

/** Per-webContents rules: no popups, no navigation away from the app, no webviews. */
function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    // No popups: web links go to the user's browser, everything else is dropped.
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url)
      return { action: 'deny' }
    })
    const guard = (event: Electron.Event, url: string): void => {
      if (isAppUrl(url)) return
      event.preventDefault()
      openExternal(url)
    }
    contents.on('will-navigate', guard)
    contents.on('will-redirect', guard)
    // Sub-frames (the CSP allows none) may not navigate anywhere at all.
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
  // Invalid certificates are never accepted (remote images are the only https traffic).
  app.on('certificate-error', (event, _contents, _url, _error, _certificate, callback) => {
    event.preventDefault()
    callback(false)
  })
}

/** Session-wide rules: permissions and the network policy. Must run after `app` is ready. */
function hardenSession(ses: Session): void {
  // No camera, geolocation, notifications, etc. — and only for the app's own top frame.
  // The one exception is made for recording a meeting, and it is narrow: audio only (never
  // camera video; `getDisplayMedia` arrives as a `media` request that names no type and is
  // answered by the display-media handler with loopback audio), only for the window that just asked the main process to begin a recording
  // through a validated ipc call, only for a few seconds after that, and gone the moment the
  // recording stops. The rules are in ./meetings/grant.ts.
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = details.isMainFrame && isAppUrl(details.requestingUrl) && isAppUrl(contents.getURL())
    if (permission === 'media' || permission === 'display-capture') {
      const mediaTypes = (details as { mediaTypes?: readonly string[] }).mediaTypes
      return callback(recordingGrants.allowRequest({ permission, owner: contents.id, trusted, mediaTypes }))
    }
    callback(trusted && ALLOWED_PERMISSIONS.has(permission))
  })
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (details.isMainFrame === false) return false
    const trusted = isAppUrl(details.requestingUrl ?? requestingOrigin)
    if (permission === 'media') return recordingGrants.allowCheck({ permission, owner: contents?.id ?? null, trusted, mediaType: details.mediaType })
    return ALLOWED_PERMISSIONS.has(permission) && trusted
  })
  ses.setDevicePermissionHandler(() => false)
  handleDisplayMedia(ses)

  // Network policy on top of the page's CSP (see isAllowedRequest).
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, details.resourceType) })
  })
  // Remote images are fetched anonymously: no cookies, no referrer, nothing stored.
  const isRemote = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !isDevServerUrl(parsed)
    } catch {
      return false
    }
  }
  const without = <T>(headers: Record<string, T>, names: string[]): Record<string, T> =>
    Object.fromEntries(Object.entries(headers).filter(([name]) => !names.includes(name.toLowerCase())))
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!isRemote(details.url)) return callback({})
    callback({ requestHeaders: without(details.requestHeaders, ['cookie', 'referer', 'origin']) })
  })
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!isRemote(details.url) || !details.responseHeaders) return callback({})
    callback({ responseHeaders: without(details.responseHeaders, ['set-cookie']) })
  })
}

function focusExisting(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    if (repo) createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function closeDatabase(): void {
  try {
    // Pages edited since their last version get one of their latest state: it is recoverable too.
    repo?.flushVersions()
  } catch (err) {
    console.error('[main] could not store the latest versions', err)
  }
  try {
    repo?.close()
  } catch {
    /* already closed */
  }
  repo = null
}

/** How long after start-up the history housekeeping begins, and how many pages one slice visits. */
const HISTORY_IDLE_MS = 15_000
const HISTORY_SLICE_PAGES = 25
const HISTORY_SLICE_GAP_MS = 250

/**
 * Thins old versions and enforces the size budget once the app has settled, a few pages at
 * a time so that no slice is long enough to be felt.
 */
function scheduleHistoryMaintenance(store: Repository): void {
  const slice = (): void => {
    if (repo !== store) return
    try {
      if (!store.maintainVersions(HISTORY_SLICE_PAGES)) setTimeout(slice, HISTORY_SLICE_GAP_MS).unref()
    } catch (err) {
      console.error('[main] history housekeeping failed', err)
    }
  }
  setTimeout(slice, HISTORY_IDLE_MS).unref()
}

/**
 * Opens the database. Runs as soon as this instance owns the profile, before
 * Electron is ready: nothing here needs a window, and the first window needs
 * the stored bounds, theme and background colour before it can be created.
 */
function openStore(): Repository | null {
  try {
    const opened = openDatabase(join(app.getPath('userData'), DB_FILE))
    mark('db open')
    return opened
  } catch (err) {
    console.error('[main] could not open the database', err)
    dialog.showErrorBox('sel could not open its database', err instanceof Error ? err.message : String(err))
    app.exit(1)
    return null
  }
}

/**
 * First run only: the welcome content. Kept off the path to the first window
 * (the module is not even loaded on later runs); ipc handlers wait for it, so
 * the renderer can never observe the workspace half-seeded or still empty.
 * Then, on every run, the built-in Tasks database (one read when it is there).
 */
async function seedWorkspace(store: Repository): Promise<void> {
  if (store.isEmpty()) {
    try {
      const { seedIfEmpty } = await import('./db/seed')
      seedIfEmpty(store)
      mark('workspace seeded')
    } catch (err) {
      console.error('[main] could not create the welcome page', err)
    }
  }
  try {
    ensureTasksDatabase(store)
  } catch (err) {
    console.error('[main] could not create the Tasks database', err)
  }
}

function start(store: Repository): void {
  // A bug must not take the app down with a raw stack-trace dialog; log it and keep the data safe.
  process.on('unhandledRejection', (reason) => console.error('[main] unhandled rejection', reason))
  process.on('uncaughtException', (err) => console.error('[main] uncaught exception', err))

  // The second instance's command line and working directory are deliberately ignored:
  // nothing a launcher (or a crafted link) passes is interpreted as a path, url or flag.
  app.on('second-instance', focusExisting)
  hardenWebContents()

  app
    .whenReady()
    .then(() => {
      mark('app ready')
      if (process.platform === 'win32') app.setAppUserModelId('app.sel')
      hardenSession(session.defaultSession)
      nativeTheme.themeSource = readTheme(store)
      handleFileProtocol()
      const hooks = registerIpc({ repo: store, ready: seedWorkspace(store), createWindow: (pageId) => void createWindow(pageId) })
      syncHooks = hooks
      if (hooks.alarms.startHidden(process.argv)) {
        // Started by the system at login to wait in the notification area: no window until asked.
        setTimeout(() => hooks.start(), SYNC_START_DELAY_MS).unref()
      } else {
        const first = createWindow()
        // Sync never competes with the first paint: it starts once the window is on screen.
        first.once('show', () => setTimeout(() => hooks.start(), SYNC_START_DELAY_MS).unref())
      }
      mark('window created')
      scheduleHistoryMaintenance(store)
      hooks.meetings.prune()
      // On macOS the menu is the menu bar and owns the app shortcuts. Elsewhere it is never
      // shown (frameless window) and only carries role accelerators (reload, zoom, full
      // screen), so it is built once the window is already loading.
      if (process.platform === 'darwin') buildMenu()
      else setImmediate(buildMenu)

      app.on('activate', () => {
        if (repo && BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((err: unknown) => {
      console.error('[main] startup failed', err)
      closeDatabase()
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    // With the notification-area icon on, sel keeps running so that its alarms still ring.
    if (process.platform !== 'darwin' && !syncHooks?.alarms.keepRunning()) app.quit()
  })

  // What is still to upload goes out on the way out, when that takes a few seconds at most.
  // The database stays open until `will-quit`, which only comes after this.
  let leaving = false
  app.on('before-quit', (event) => {
    if (leaving) return
    // A recording in progress is not ended by quitting without a word.
    const recording = syncHooks?.meetings.recordingWindow()
    if (recording) {
      event.preventDefault()
      syncHooks?.meetings.askToStop(recording, 'quit')
      return
    }
    const upload = syncHooks?.beforeQuit()
    if (!upload) return
    leaving = true
    event.preventDefault()
    void upload.catch((err: unknown) => console.error('[main] the last sync failed', err)).finally(() => app.quit())
  })

  app.on('will-quit', closeDatabase)
}

/**
 * Notes made under the app's earlier name become this app's. Before the instance lock, which
 * is the first thing to create the data folder.
 */
function adoptEarlierNotes(): boolean {
  try {
    adoptLegacyProfile(app.getPath('userData'))
    return true
  } catch (err) {
    console.error('[main] could not bring over the notes of the earlier app', err)
    dialog.showErrorBox(
      'sel could not bring over your notes',
      'Your notes were made when this app was called Selida, and they could not be moved. Close Selida if it is open, then start sel again. Nothing was lost.'
    )
    app.exit(1)
    return false
  }
}

if (!adoptEarlierNotes()) {
  /* leaving */
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  repo = openStore()
  if (repo) start(repo)
}
