import { BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/api'
import type { ChangeEvent, CreateBlockInput, Op, Theme, UpdateBlockInput } from '../shared/types'
import type { Repository } from './db/repository'
import { ChangeFeed } from './changes'
import { pickImage, saveGeneratedImage, saveImage } from './files'
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

type Handler = (args: unknown[], event: IpcMainInvokeEvent) => unknown

export function registerIpc({ repo, ready, createWindow }: IpcContext): void {
  const changes = new ChangeFeed((change: ChangeEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.change, change)
    }
  })

  /**
   * Registers an invoke channel. Every call is checked for its sender and its
   * client id before the handler runs, and every failure is reduced to a safe
   * message before it crosses back into the renderer.
   */
  const handle = (channel: string, fn: Handler): void => {
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
        if (origin !== null) changes.add(origin, repo.drainChanges(), repo.drainResets())
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
  handle('blocks:get', ([a]) => repo.get(arg.id(a)))
  handle('blocks:getMany', ([a]) => repo.getMany(arg.idList(a, 'ids')))
  handle('blocks:getTree', ([a]) => repo.getTree(arg.id(a)))
  handle('blocks:children', ([a]) => repo.children(arg.id(a)))
  handle('blocks:create', ([a]) => repo.create(arg.plainObject(a, 'input') as unknown as CreateBlockInput))
  handle('blocks:update', ([a, b]) => repo.update(arg.id(a), arg.plainObject(b, 'patch') as UpdateBlockInput))
  handle('blocks:move', ([a, b, c]) => repo.move(arg.id(a), arg.nullableId(b, 'parentId'), arg.afterId(c)))
  handle('blocks:delete', ([a]) => repo.delete(arg.id(a)))
  handle('blocks:apply', ([a]) => repo.apply(arg.ops(a) as Op[]))

  // ---- pages
  handle('pages:listRoot', () => repo.listRoot())
  handle('pages:listChildren', ([a]) => repo.listChildren(arg.id(a)))
  handle('pages:listFavorites', () => repo.listFavorites())
  handle('pages:listRecent', ([a]) => repo.listRecent(arg.limit(a)))
  handle('pages:listTrash', () => repo.listTrash())
  handle('pages:restore', ([a]) => repo.restore(arg.id(a)))
  handle('pages:deleteForever', ([a]) => repo.deleteForever(arg.id(a)))
  handle('pages:ancestors', ([a]) => repo.ancestors(arg.id(a)))
  handle('pages:duplicate', ([a]) => repo.duplicate(arg.id(a)))
  // Both go through a native dialog: the renderer never names a path.
  // The markdown converter is only loaded the first time one of them is used.
  handle('pages:exportMarkdown', async ([a], event) => {
    const id = arg.id(a)
    const { exportMarkdown } = await import('./markdown')
    return exportMarkdown(repo, windowOf(event), id)
  })
  handle('pages:importMarkdown', async ([a], event) => {
    const parentId = arg.nullableId(a, 'parentId')
    const { importMarkdown } = await import('./markdown')
    return importMarkdown(repo, windowOf(event), parentId)
  })

  // ---- databases
  handle('databases:list', () => repo.listDatabases())
  handle('databases:locations', ([a]) => repo.databaseLocations(arg.id(a, 'sourceId')))

  // ---- search
  handle('search:query', ([a, b]) => repo.search(arg.text(a, 'query', arg.LIMITS.query), arg.limit(b)))

  // ---- versions (ids are checked here; the repository validates every decoded snapshot before use)
  handle('versions:list', ([a]) => repo.listVersions(arg.id(a, 'pageId')))
  handle('versions:get', ([a]) => repo.getVersion(arg.id(a, 'version id')))
  handle('versions:current', ([a]) => repo.currentVersion(arg.id(a, 'pageId')))
  handle('versions:save', ([a, b]) => repo.saveVersion(arg.id(a, 'pageId'), arg.versionLabel(b)))
  handle('versions:rename', ([a, b]) => repo.renameVersion(arg.id(a, 'version id'), arg.versionLabel(b)))
  handle('versions:delete', ([a]) => repo.deleteVersion(arg.id(a, 'version id')))
  handle('versions:restore', ([a, b]) => repo.restoreVersion(arg.id(a, 'version id'), arg.restoreMode(b)))
  handle('versions:stats', ([a]) => repo.versionStats(arg.optionalId(a, 'pageId')))
  handle('versions:clear', ([a]) => repo.clearVersions(arg.optionalId(a, 'pageId')))

  // ---- files
  handle('files:pickImage', (_args, event) => pickImage(windowOf(event)))
  handle('files:saveImage', ([a, b]) => saveImage(a, b))
  // Goes through a native save dialog: the renderer never names a path.
  handle('files:saveGeneratedImage', ([a], event) => saveGeneratedImage(windowOf(event), arg.pngBytes(a)))

  // ---- app
  handle('app:getTheme', () => readTheme(repo))
  handle('app:setTheme', ([a]) => applyTheme(repo, a))
  handle('app:getSetting', ([a]) => repo.getSetting(arg.settingKey(a)))
  handle('app:setSetting', ([a, b]) => {
    const key = arg.writableSettingKey(a)
    if (key === THEME_KEY) return applyTheme(repo, b)
    repo.setSetting(key, arg.settingValueFor(key, b))
  })
  handle('app:openExternal', async ([a]) => {
    const url = toExternalUrl(a)
    if (!url) throw new Error('Only http(s) and mailto links can be opened')
    await shell.openExternal(url)
  })
  handle('app:newWindow', ([a]) => {
    if (BrowserWindow.getAllWindows().length >= MAX_WINDOWS) throw new Error('Too many windows are open')
    createWindow(arg.optionalId(a, 'pageId'))
  })

  // ---- window controls (the renderer draws them on frameless windows)
  handle('window:isMaximized', (_args, event) => windowOf(event)?.isMaximized() ?? false)
  on(IPC.windowMinimize, (win) => win.minimize())
  on(IPC.windowToggleMaximize, (win) => {
    if (win.isFullScreen()) win.setFullScreen(false)
    else if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  on(IPC.windowClose, (win) => win.close())
}
