import { app, BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainEvent } from 'electron'
import { INVOKE, IPC, type InvokeChannel } from '../shared/api'
import type { ChangeEvent, CreateBlockInput, Op, Theme, UpdateBlockInput } from '../shared/types'
import type { AiBridge } from './ai'
import { registerBriefingIpc } from './briefing/register'
import { registerExternalIpc, type ExternalHooks } from './external/register'
import { registerFeedbackIpc } from './feedback/register'
import { registerHermanIpc, type HermanHooks } from './herman/register'
import { registerMeetingsIpc, type MeetingsHooks } from './meetings/register'
import { registerUpdatesIpc, type UpdatesHooks } from './updates/register'
import type { Repository } from './db/repository'
import type { SyncBridge } from './sync'
import { ChangeFeed } from './changes'
import { pickImage, saveGeneratedImage, saveImage } from './files'
import type { Handler, Handlers } from './invoke'
import { isTrustedSender, toExternalUrl } from './security'
import * as arg from './validate'

export const THEME_KEY = 'theme'
const THEMES: readonly Theme[] = ['light', 'dark', 'system']
/** A runaway (or hostile) renderer must not be able to open windows without bound. */
const MAX_WINDOWS = 12

export interface IpcContext {
  repo: Repository
  /** Settles once the workspace can be read (first-run content created). Every handler waits for it. */
  ready: Promise<void>
  createWindow(pageId?: string): void
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

export function readTheme(repo: Repository): Theme {
  const stored = repo.getSetting(THEME_KEY)
  return isTheme(stored) ? stored : 'system'
}

function applyTheme(repo: Repository, theme: unknown): void {
  if (!isTheme(theme)) throw new Error('Invalid theme')
  repo.setSetting(THEME_KEY, theme)
  nativeTheme.themeSource = theme
}

/** What the app's lifecycle needs from sync (see ./sync), without loading it. */
export interface SyncHooks {
  /** Loads sync and starts its timers when this device is connected to a repository. */
  start(): void
  /** A last upload on the way out, bounded to a few seconds; null when there is nothing to wait for. */
  beforeQuit(): Promise<void> | null
  /** What the windows and the quit sequence need to know about a recording in progress. */
  meetings: MeetingsHooks
}

const SYNC_URL_KEY = 'sync.remoteUrl'
const APPEARANCE_SETTING = 'appearance'
const BRIEFING_DATABASES_SETTING = 'briefing.databases'

export function registerIpc({ repo, ready, createWindow }: IpcContext): SyncHooks {
  const changes = new ChangeFeed((change: ChangeEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.change, change)
    }
  })

  /**
   * Registers an invoke channel. Every call is checked for its sender and its
   * client id before the handler runs, and every failure is reduced to a safe
   * message before it crosses back into the renderer. Called for each channel
   * of INVOKE at the end of this function, and from nowhere else.
   */
  const handle = (channel: InvokeChannel, fn: Handler): void => {
    ipcMain.handle(channel, async (event, rawClientId: unknown, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Forbidden')
      let origin: string | null = null
      try {
        origin = arg.clientId(rawClientId)
        await ready
        return await fn(args, event)
      } catch (err) {
        if (arg.isUnexpectedError(err)) console.error(`[ipc] ${channel} failed`, err)
        throw arg.toIpcError(err)
      } finally {
        // Reads leave nothing to drain; a failed mutation was rolled back and leaves nothing either.
        if (origin !== null) {
          const ids = repo.drainChanges()
          changes.add(origin, ids, repo.drainResets())
          // Something changed on this device: sync uploads it once things have been quiet for a moment.
          if (ids.length) syncBridge?.noteLocalChange()
        }
      }
    })
  }

  /** Fire-and-forget channel (window controls): untrusted senders are ignored. */
  const on = (channel: string, fn: (win: BrowserWindow) => void): void => {
    ipcMain.on(channel, (event: IpcMainEvent) => {
      if (!isTrustedSender(event)) return
      const win = windowOf(event)
      if (win && !win.isDestroyed()) fn(win)
    })
  }

  const windowOf = (event: { sender: Electron.WebContents }): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender)

  // ---- blocks (the repository validates the fields of inputs, patches and ops)
  const blockHandlers: Handlers<'blocks'> = {
    'blocks:get': ([a]) => repo.get(arg.id(a)),
    'blocks:getMany': ([a]) => repo.getMany(arg.idList(a, 'ids')),
    'blocks:getTree': ([a]) => repo.getTree(arg.id(a)),
    'blocks:children': ([a]) => repo.children(arg.id(a)),
    'blocks:create': ([a]) => repo.create(arg.plainObject(a, 'input') as unknown as CreateBlockInput),
    'blocks:update': ([a, b]) => repo.update(arg.id(a), arg.plainObject(b, 'patch') as UpdateBlockInput),
    'blocks:move': ([a, b, c]) => repo.move(arg.id(a), arg.nullableId(b, 'parentId'), arg.afterId(c)),
    'blocks:delete': ([a]) => repo.delete(arg.id(a)),
    'blocks:apply': ([a]) => repo.apply(arg.ops(a) as Op[])
  }

  // ---- pages
  const pageHandlers: Handlers<'pages'> = {
    'pages:listRoot': () => repo.listRoot(),
    'pages:listChildren': ([a]) => repo.listChildren(arg.id(a)),
    'pages:listFavorites': () => repo.listFavorites(),
    'pages:listRecent': ([a]) => repo.listRecent(arg.limit(a)),
    'pages:listTrash': () => repo.listTrash(),
    'pages:restore': ([a]) => repo.restore(arg.id(a)),
    'pages:deleteForever': ([a]) => repo.deleteForever(arg.id(a)),
    'pages:ancestors': ([a]) => repo.ancestors(arg.id(a)),
    'pages:duplicate': ([a]) => repo.duplicate(arg.id(a)),
    // Both go through a native dialog: the renderer never names a path.
    // The markdown converter is only loaded the first time one of them is used.
    'pages:exportMarkdown': async ([a], event) => {
      const id = arg.id(a)
      const { exportMarkdown } = await import('./markdown')
      return exportMarkdown(repo, windowOf(event), id)
    },
    'pages:importMarkdown': async ([a], event) => {
      const parentId = arg.nullableId(a, 'parentId')
      const { importMarkdown } = await import('./markdown')
      return importMarkdown(repo, windowOf(event), parentId)
    }
  }

  // ---- databases
  const databaseHandlers: Handlers<'databases'> = {
    'databases:list': () => repo.listDatabases(),
    'databases:locations': ([a]) => repo.databaseLocations(arg.id(a, 'sourceId'))
  }

  // ---- search
  const searchHandlers: Handlers<'search'> = {
    'search:query': ([a, b]) => repo.search(arg.text(a, 'query', arg.LIMITS.query), arg.limit(b))
  }

  // ---- versions (ids are checked here; the repository validates every decoded snapshot before use)
  const versionHandlers: Handlers<'versions'> = {
    'versions:list': ([a]) => repo.listVersions(arg.id(a, 'pageId')),
    'versions:get': ([a]) => repo.getVersion(arg.id(a, 'version id')),
    'versions:current': ([a]) => repo.currentVersion(arg.id(a, 'pageId')),
    'versions:save': ([a, b]) => repo.saveVersion(arg.id(a, 'pageId'), arg.versionLabel(b)),
    'versions:rename': ([a, b]) => repo.renameVersion(arg.id(a, 'version id'), arg.versionLabel(b)),
    'versions:delete': ([a]) => repo.deleteVersion(arg.id(a, 'version id')),
    'versions:restore': ([a, b]) => repo.restoreVersion(arg.id(a, 'version id'), arg.restoreMode(b)),
    'versions:stats': ([a]) => repo.versionStats(arg.optionalId(a, 'pageId')),
    'versions:clear': ([a]) => repo.clearVersions(arg.optionalId(a, 'pageId'))
  }

  // ---- files
  const fileHandlers: Handlers<'files'> = {
    'files:pickImage': (_args, event) => pickImage(windowOf(event)),
    'files:saveImage': ([a, b]) => saveImage(a, b),
    // Goes through a native save dialog: the renderer never names a path.
    'files:saveGeneratedImage': ([a], event) => saveGeneratedImage(windowOf(event), arg.pngBytes(a))
  }

  // ---- app
  let updates: UpdatesHooks | null = null
  let external: ExternalHooks | null = null
  const appHandlers: Handlers<'app'> = {
    'app:getTheme': () => readTheme(repo),
    'app:setTheme': ([a]) => applyTheme(repo, a),
    'app:getSetting': ([a]) => repo.getSetting(arg.settingKey(a)),
    'app:setSetting': ([a, b]) => {
      const key = arg.writableSettingKey(a)
      if (key === THEME_KEY) return applyTheme(repo, b)
      repo.setSetting(key, arg.settingValueFor(key, b))
      // The appearance is synced: when it changed here decides which device's change stands.
      if (key === APPEARANCE_SETTING) {
        repo.setSetting('sync.appearanceAt', Date.now())
        syncBridge?.noteLocalChange()
      }
      // So are the databases Today takes its tasks from, with the calendars.
      if (key === BRIEFING_DATABASES_SETTING) {
        repo.setSetting('sync.briefingAt', Date.now())
        syncBridge?.noteLocalChange()
      }
      // Which program runs, and whether any does, is decided by these: the cached answer is stale.
      if (key.startsWith('ai.')) aiBridge?.service.invalidate()
      // The update check was turned on or off: its timer follows.
      if (key.startsWith('updates.')) updates?.settingChanged()
      // Other apps were let in or shut out: the endpoint for them opens or closes.
      if (key.startsWith('mcp.')) external?.settingChanged()
    },
    'app:openExternal': async ([a]) => {
      const url = toExternalUrl(a)
      if (!url) throw new Error('Only http(s) and mailto links can be opened')
      await shell.openExternal(url)
    },
    'app:newWindow': ([a]) => {
      if (BrowserWindow.getAllWindows().length >= MAX_WINDOWS) throw new Error('Too many windows are open')
      createWindow(arg.optionalId(a, 'pageId'))
    },
    // The other window controls are fire-and-forget (see the end of this function).
    'app:window.isMaximized': (_args, event) => windowOf(event)?.isMaximized() ?? false
  }

  // ---- ai (drives the Claude Code program installed on this computer; see ./ai)
  // Nothing of it is loaded until a window asks. A request is validated, and its prompt built,
  // in this process; its events go back to the window that made it and to no other.
  let aiBridge: AiBridge | null = null
  const ai = async (): Promise<AiBridge> => (aiBridge ??= new (await import('./ai')).AiBridge(repo, () => briefing.promptData()))
  app.on('will-quit', () => aiBridge?.dispose())
  const aiHandlers: Handlers<'ai'> = {
    'ai:status': async ([a]) => (await ai()).status(a),
    'ai:run': async ([a], event) => (await ai()).run(a, event.sender),
    'ai:cancel': async ([a], event) => (await ai()).cancel(a, event.sender),
    // Goes through a native dialog: the renderer never names a path to run.
    'ai:pickCli': async (_args, event) => (await ai()).pickCli(windowOf(event)),
    'ai:agents.list': async () => (await ai()).agents(),
    'ai:agents.connect': async ([a, b], event) => (await ai()).connectAgent(a, b, windowOf(event)),
    'ai:agents.remove': async ([a]) => (await ai()).removeAgent(a)
  }

  // ---- sync (drives the git installed on this computer; see ./sync)
  // Loaded when this device is connected to a repository, or when a window first asks. What a
  // sync changes in the database reaches the windows like any other change, from the origin
  // `sync` that no window has.
  let syncBridge: SyncBridge | null = null
  const sync = async (): Promise<SyncBridge> =>
    (syncBridge ??= new (await import('./sync')).SyncBridge(
      repo,
      () => changes.add('sync', repo.drainChanges(), repo.drainResets()),
      () => briefing.calendarSync()
    ))
  app.on('will-quit', () => syncBridge?.dispose())
  const syncHandlers: Handlers<'sync'> = {
    'sync:status': async () => (await sync()).status(),
    'sync:setup': async ([a]) => (await sync()).setup(a),
    'sync:now': async () => (await sync()).now(),
    'sync:pause': async ([a]) => (await sync()).pause(a),
    'sync:disconnect': async ([a]) => (await sync()).disconnect(a),
    'sync:unlock': async ([a]) => (await sync()).unlock(a),
    'sync:setEncryption': async ([a]) => (await sync()).setEncryption(a),
    // Goes through a native dialog: the renderer never names a path to run.
    'sync:pickGit': async (_args, event) => (await sync()).pickGit(windowOf(event))
  }

  // ---- briefing (the Today screen: calendars, open tasks, the day's phrase; see ./briefing)
  let herman: HermanHooks | null = null
  const briefing = registerBriefingIpc({
    repo,
    ai,
    onTaskCompleted: (sender) => herman?.taskCompleted(sender),
    onTaskUncompleted: () => herman?.taskUncompleted(),
    // Calendars are synced (into an encrypted repository only): a change here is one to upload.
    onCalendarsChanged: () => syncBridge?.noteLocalChange()
  })

  // ---- meetings (recording, local transcription; see ./meetings). What a transcription writes
  // reaches the windows like any other change, from the origin `meetings` that no window has.
  const meetings = registerMeetingsIpc({
    repo,
    flushChanges: () => {
      const ids = repo.drainChanges()
      changes.add('meetings', ids, repo.drainResets())
      if (ids.length) syncBridge?.noteLocalChange()
    }
  })

  // ---- herman (the assistant's face: his settings, and what he says unasked; see ./herman).
  // What he says unasked is composed in this process from the day's tasks and agenda as stored:
  // no model is called for it, and nothing is fetched.
  const hermanIpc = registerHermanIpc({
    repo,
    day: async () => {
      const { tasks, events } = await briefing.stored()
      return { tasks: { overdue: tasks.overdue, today: tasks.today }, events: events.today }
    },
    recording: () => meetings.recordingWindow() !== null
  })
  herman = hermanIpc

  // ---- feedback (bug reports and suggestions kept as files for the nightly agent; see ./feedback)
  const feedbackHandlers = registerFeedbackIpc()

  // ---- updates (opt-in, from GitHub Releases; see ./updates). Off by default: until the user
  // turns the check on or presses Check now, nothing of it goes on the network.
  const updatesIpc = registerUpdatesIpc({ repo, recording: () => meetings.recordingWindow() !== null })
  updates = updatesIpc

  // ---- mcp (other apps connected to the notes over MCP, when the user turned that on; see
  // ./external). Off by default: until then no pipe is opened. What a connected app writes
  // reaches the windows like any other change, from the origin `mcp` that no window has.
  const externalIpc = registerExternalIpc({
    repo,
    ready,
    changed: () => {
      const ids = repo.drainChanges()
      changes.add('mcp', ids, repo.drainResets())
      if (ids.length) syncBridge?.noteLocalChange()
    }
  })
  external = externalIpc

  // Every channel declared in INVOKE (src/shared/api.ts) gets its handler here, and nothing else
  // is registered: a channel without a handler, or a handler without a channel, fails typecheck.
  const handlers: Handlers = {
    ...blockHandlers,
    ...pageHandlers,
    ...databaseHandlers,
    ...searchHandlers,
    ...versionHandlers,
    ...fileHandlers,
    ...appHandlers,
    ...aiHandlers,
    ...syncHandlers,
    ...briefing.handlers,
    ...meetings.handlers,
    ...hermanIpc.handlers,
    ...feedbackHandlers,
    ...updatesIpc.handlers,
    ...externalIpc.handlers
  }
  for (const channel of Object.keys(INVOKE) as InvokeChannel[]) handle(channel, handlers[channel])

  // ---- window controls (the renderer draws them on frameless windows; `isMaximized` is with app)
  on(IPC.windowMinimize, (win) => win.minimize())
  on(IPC.windowToggleMaximize, (win) => {
    if (win.isFullScreen()) win.setFullScreen(false)
    else if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  on(IPC.windowClose, (win) => win.close())

  return {
    meetings,
    start() {
      if (typeof repo.getSetting(SYNC_URL_KEY) !== 'string') return
      sync().then(
        (bridge) => bridge.start(),
        (err: unknown) => console.error('[main] sync could not be started', err)
      )
    },
    beforeQuit() {
      return syncBridge?.wantsQuitSync ? syncBridge.beforeQuit() : null
    }
  }
}
