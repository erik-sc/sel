import { contextBridge, ipcRenderer } from 'electron'
import { AI_CHANNELS, type AiEvent } from '@shared/ai'
import { BRIEFING_CHANGED, type BriefingApi } from '@shared/briefing'
import { IPC, type Api, type MenuCommand } from '@shared/api'
import { MEETINGS_CHANNELS, type MeetingsApi } from '@shared/meetings'
import { SYNC_CHANNEL, type SyncStatus } from '@shared/sync'
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

const ns = <T extends object>(namespace: string, methods: readonly string[], separator = ':'): T =>
  Object.fromEntries(methods.map((m) => [m, call(`${namespace}${separator}${m}`)])) as T

/** Subscribes to a channel that carries one payload. Returns the unsubscribe function. */
const subscribe =
  <T>(channel: string) =>
  (listener: (payload: T) => void): (() => void) => {
    const handler = (_: unknown, payload: T): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

const meetings: MeetingsApi = {
  ...ns<Pick<MeetingsApi, 'status' | 'create' | 'transcribe' | 'cancelTranscribe' | 'setSpeakers' | 'storage' | 'openFolder'>>('meetings', [
    'status',
    'create',
    'transcribe',
    'cancelTranscribe',
    'setSpeakers',
    'storage',
    'openFolder'
  ]),
  engine: ns('meetings:engine', ['status', 'download', 'cancelDownload', 'pickProgram', 'pickModel', 'remove'], '.'),
  recording: {
    ...ns<Omit<MeetingsApi['recording'], 'frames' | 'encoded'>>('meetings:recording', ['probe', 'begin', 'pause', 'resume', 'stop', 'recover', 'discard'], '.'),
    // Fire-and-forget, binary: a hundred milliseconds of audio at a time must not wait for a reply.
    frames: (token, seq, mic, system) => ipcRenderer.send(MEETINGS_CHANNELS.frames, token, seq, mic, system),
    encoded: (token, stream, seq, bytes) => ipcRenderer.send(MEETINGS_CHANNELS.encoded, token, stream, seq, bytes)
  },
  audio: ns('meetings:audio', ['info', 'delete'], '.'),
  onStatus: subscribe(MEETINGS_CHANNELS.status),
  onProgress: subscribe(MEETINGS_CHANNELS.progress),
  onStop: subscribe(MEETINGS_CHANNELS.stop)
}

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
  ai: {
    ...ns<Omit<Api['ai'], 'onEvent'>>('ai', ['status', 'run', 'cancel', 'pickCli']),
    onEvent(listener) {
      const types = ['delta', 'done', 'error'] as const
      const handlers = types.map((type) => {
        const handler = (_: unknown, payload: object): void => listener({ type, ...payload } as AiEvent)
        ipcRenderer.on(AI_CHANNELS[type], handler)
        return handler
      })
      return () => types.forEach((type, index) => ipcRenderer.removeListener(AI_CHANNELS[type], handlers[index]))
    }
  },
  sync: {
    ...ns<Omit<Api['sync'], 'onStatus'>>('sync', ['status', 'setup', 'now', 'pause', 'disconnect', 'pickGit', 'unlock', 'setEncryption']),
    onStatus(listener) {
      const handler = (_: unknown, status: SyncStatus): void => listener(status)
      ipcRenderer.on(SYNC_CHANNEL, handler)
      return () => ipcRenderer.removeListener(SYNC_CHANNEL, handler)
    }
  },
  briefing: {
    ...ns<Omit<BriefingApi, 'calendars' | 'onChanged'>>('briefing', [
      'get',
      'anotherPhrase',
      'completeTask',
      'undoCompleteTask',
      'ensurePhrasesDatabase',
      'addPhrase',
      'databases',
      'brief'
    ]),
    calendars: ns('briefing:calendars', ['list', 'add', 'update', 'remove', 'test'], '.'),
    onChanged(listener) {
      const handler = (): void => listener()
      ipcRenderer.on(BRIEFING_CHANGED, handler)
      return () => ipcRenderer.removeListener(BRIEFING_CHANGED, handler)
    }
  },
  meetings,
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
