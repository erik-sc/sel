import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api, type MenuCommand } from '@shared/api'
import type { ChangeEvent } from '@shared/types'

// This script runs sandboxed: it may use `electron`'s renderer modules and web
// globals only. Do not import Node built-ins or npm packages here.

function randomId(): string {
  // randomUUID needs a secure context; getRandomValues is available everywhere.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

const clientId = randomId()

// Every invoke carries the clientId so the main process can tag ChangeEvent.origin.
const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, clientId, ...args)

const ns = <T extends object>(namespace: string, methods: readonly string[]): T =>
  Object.fromEntries(methods.map((m) => [m, call(`${namespace}:${m}`)])) as T

const api: Api = {
  clientId,
  blocks: ns('blocks', ['get', 'getMany', 'getTree', 'children', 'create', 'update', 'move', 'delete', 'apply']),
  pages: ns('pages', [
    'listRoot',
    'listChildren',
    'listFavorites',
    'listRecent',
    'listTrash',
    'restore',
    'deleteForever',
    'ancestors',
    'duplicate',
    'exportMarkdown',
    'importMarkdown'
  ]),
  databases: ns('databases', ['list', 'locations']),
  search: ns('search', ['query']),
  versions: ns('versions', ['list', 'get', 'current', 'save', 'rename', 'delete', 'restore', 'stats', 'clear']),
  files: ns('files', ['pickImage', 'saveImage', 'saveGeneratedImage']),
  app: {
    ...ns<Omit<Api['app'], 'platform' | 'window'>>('app', [
      'getTheme',
      'setTheme',
      'getSetting',
      'setSetting',
      'openExternal',
      'newWindow'
    ]),
    platform: process.platform,
    window: {
      minimize: () => ipcRenderer.send(IPC.windowMinimize),
      toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
      close: () => ipcRenderer.send(IPC.windowClose),
      isMaximized: () => ipcRenderer.invoke('window:isMaximized', clientId)
    }
  },
  onChange(listener) {
    const handler = (_: unknown, event: ChangeEvent): void => listener(event)
    ipcRenderer.on(IPC.change, handler)
    return () => ipcRenderer.removeListener(IPC.change, handler)
  },
  onCommand(listener) {
    const handler = (_: unknown, command: MenuCommand, arg?: unknown): void => listener(command, arg)
    ipcRenderer.on(IPC.command, handler)
    return () => ipcRenderer.removeListener(IPC.command, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
