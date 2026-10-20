import { BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainEvent } from 'electron'
import { INVOKE, IPC, type InvokeChannel } from '../shared/api'
import { syncedAtOf } from '../shared/settings'
import type { ChangeEvent, CreateBlockInput, Op, Theme, UpdateBlockInput } from '../shared/types'
import type { AlarmsHooks } from './alarms/register'
import type { Repository } from './db/repository'
import type { MeetingsHooks } from './meetings/register'
import { completionChanges, completionsBefore } from './tasks/completions'
import { ChangeFeed } from './changes'
import type { FeatureContext, Registered } from './feature'
import { FEATURES, type FeatureName, type RegisteredOf } from './features'
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
  /** Starts what waits for the first window: the daily backup, and sync's timers when this device is connected to a repository. */
  start(): void
  /** A last upload on the way out, bounded to a few seconds; null when there is nothing to wait for. */
  beforeQuit(): Promise<void> | null
  /** What the windows and the quit sequence need to know about a recording in progress. */
  meetings: MeetingsHooks
  /** Whether sel waits in the notification area, rather than quitting, when its windows close (alarms). */
  alarms: Pick<AlarmsHooks, 'keepRunning' | 'startHidden'>
}

/** The shell's own namespaces, answered here; every other one belongs to a feature in ./features.ts. */
type CoreNamespace = 'blocks' | 'pages' | 'databases' | 'search' | 'versions' | 'files' | 'app'
type InvokeNamespace = InvokeChannel extends `${infer N}:${string}` ? N : never
/** Typecheck fails here when a namespace of INVOKE is answered neither here nor by a feature. */
const EVERY_NAMESPACE_ANSWERED: [Exclude<InvokeNamespace, CoreNamespace | FeatureName>] extends [never]
  ? true
  : { unanswered: Exclude<InvokeNamespace, CoreNamespace | FeatureName> } = true

export function registerIpc({ repo, ready, createWindow }: IpcContext): SyncHooks {
  const changes = new ChangeFeed((change: ChangeEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.change, change)
    }
  })

  // ---- the features (./features.ts), each registered with the same context, in the order listed
  const registered = new Map<string, Omit<Registered<string>, 'handlers'> & { handlers: Partial<Handlers> }>()
  const ctx: FeatureContext = {
    repo,
    ready,
    createWindow,
    changes(origin, options) {
      const ids = repo.drainChanges()
      changes.add(origin, ids, repo.drainResets())
      if (ids.length && options?.local !== false) ctx.noteLocalChange()
    },
    noteLocalChange: () => ctx.feature('sync').noteLocalChange(),
    recording: () => ctx.feature('meetings').recordingWindow() !== null,
    feature<N extends FeatureName>(namespace: N): RegisteredOf<N> {
      const found = registered.get(namespace)
      if (!found) throw new Error(`The feature ${namespace} is not registered yet`)
      return found as unknown as RegisteredOf<N>
    }
  }
  for (const feature of FEATURES) registered.set(feature.namespace, feature.register(ctx))

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
          if (ids.length) ctx.noteLocalChange()
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

  const windowOf = (event: { sender: Electron.WebContents }): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender)

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
    'blocks:apply': ([a], event) => {
      const ops = arg.ops(a) as Op[]
      // Done ticked in a view of the Tasks database (or taken back there) reaches Herman as from the Tasks screen.
      const before = completionsBefore(ops, (id) => repo.get(id))
      const blocks = repo.apply(ops)
      if (before.size) {
        const { completed, uncompleted } = completionChanges(before, (id) => repo.get(id))
        const herman = ctx.feature('herman')
        for (let i = 0; i < completed; i++) herman.taskCompleted(event.sender)
        for (let i = 0; i < uncompleted; i++) herman.taskUncompleted()
      }
      return blocks
    }
  }

  // ---- pages
  const pageHandlers: Handlers<'pages'> = {
    'pages:listRoot': () => repo.listRoot(),
    'pages:listChildren': ([a]) => repo.listChildren(arg.id(a)),
    'pages:listFavorites': () => repo.listFavorites(),
    'pages:listRecent': ([a]) => repo.listRecent(arg.limit(a)),
    'pages:listTrash': () => repo.listTrash(),
    'pages:listArchived': () => repo.listArchived(),
    'pages:restore': ([a]) => repo.restore(arg.id(a)),
    'pages:deleteForever': ([a]) => repo.deleteForever(arg.id(a)),
    'pages:ancestors': ([a]) => repo.ancestors(arg.id(a)),
    'pages:backlinks': ([a]) => repo.backlinks(arg.id(a)),
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
    },
    'pages:exportTex': async ([a], event) => {
      const id = arg.id(a)
      const { exportTex } = await import('./latex')
      return exportTex(repo, windowOf(event), id)
    },
    'pages:exportPdf': async ([a, b], event) => {
      const id = arg.id(a)
      const { exportPdf, pdfPageSize } = await import('./latex')
      return exportPdf(repo, windowOf(event), event.sender, id, pdfPageSize(b))
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
  const appHandlers: Handlers<'app'> = {
    'app:getTheme': () => readTheme(repo),
    'app:setTheme': ([a]) => applyTheme(repo, a),
    'app:getSetting': ([a]) => repo.getSetting(arg.settingKey(a)),
    'app:setSetting': ([a, b]) => {
      const key = arg.writableSettingKey(a)
      if (key === THEME_KEY) return applyTheme(repo, b)
      repo.setSetting(key, arg.settingValueFor(key, b))
      // A synced setting (the appearance, the home, the sidebar's layout, Today's databases): when it
      // changed here decides which device's change stands.
      const syncedAt = syncedAtOf(key)
      if (syncedAt) {
        repo.setSetting(syncedAt, Date.now())
        ctx.noteLocalChange()
      }
      // A cached answer goes stale, a timer or an endpoint follows: each feature looks at the key.
      for (const feature of registered.values()) feature.onSettingChanged?.(key)
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

  // Every channel declared in INVOKE (src/shared/api.ts) gets its handler here, and nothing else
  // is registered: each feature answers every channel of its namespace (`Handlers<N>`), and
  // EVERY_NAMESPACE_ANSWERED fails typecheck for a namespace nobody answers.
  const handlers: Partial<Handlers> = {
    ...blockHandlers,
    ...pageHandlers,
    ...databaseHandlers,
    ...searchHandlers,
    ...versionHandlers,
    ...fileHandlers,
    ...appHandlers
  }
  for (const feature of registered.values()) Object.assign(handlers, feature.handlers)
  for (const channel of Object.keys(INVOKE) as InvokeChannel[]) {
    const fn = handlers[channel]
    if (!fn) throw new Error(`No handler for ${channel}`)
    handle(channel, fn)
  }

  // ---- window controls (the renderer draws them on frameless windows; `isMaximized` is with app)
  on(IPC.windowMinimize, (win) => win.minimize())
  on(IPC.windowToggleMaximize, (win) => {
    if (win.isFullScreen()) win.setFullScreen(false)
    else if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  on(IPC.windowClose, (win) => win.close())

  return {
    meetings: ctx.feature('meetings'),
    alarms: ctx.feature('alarms'),
    start() {
      for (const feature of registered.values()) feature.start?.()
    },
    beforeQuit: () => ctx.feature('sync').beforeQuit()
  }
}

void EVERY_NAMESPACE_ANSWERED
