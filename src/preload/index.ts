import { contextBridge, ipcRenderer } from 'electron'
import { AI_CHANNELS, type AiEvent } from '@shared/ai'
import { BRIEFING_CHANGED } from '@shared/briefing'
import { INVOKE, IPC, type Api, type MenuCommand } from '@shared/api'
import { HERMAN_NUDGE_CHANNEL } from '@shared/herman'
import { buildInvokers, type Invokers } from '@shared/ipc'
import { MEETINGS_CHANNELS } from '@shared/meetings'
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

// One method per channel declared in INVOKE (`blocks:get` becomes `invoke.blocks.get`) and no
// other: nothing here invokes a channel named at run time.
const invoke = buildInvokers(Object.keys(INVOKE), call) as Invokers<Api>

/** Subscribes to a channel that carries one payload. Returns the unsubscribe function. */
const subscribe =
  <T>(channel: string) =>
  (listener: (payload: T) => void): (() => void) => {
    const handler = (_: unknown, payload: T): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

// The invoke calls come from `invoke`; written out below is everything else: events,
// fire-and-forget sends and plain values.
const api: Api = {
  ...invoke,
  clientId,
  ai: {
    ...invoke.ai,
    onEvent(listener) {
      const types = ['delta', 'done', 'error', 'council'] as const
      const handlers = types.map((type) => {
        const handler = (_: unknown, payload: object): void => listener({ type, ...payload } as AiEvent)
        ipcRenderer.on(AI_CHANNELS[type], handler)
        return handler
      })
      return () => types.forEach((type, index) => ipcRenderer.removeListener(AI_CHANNELS[type], handlers[index]))
    }
  },
  sync: {
    ...invoke.sync,
    onStatus(listener) {
      const handler = (_: unknown, status: SyncStatus): void => listener(status)
      ipcRenderer.on(SYNC_CHANNEL, handler)
      return () => ipcRenderer.removeListener(SYNC_CHANNEL, handler)
    }
  },
  briefing: {
    ...invoke.briefing,
    onChanged(listener) {
      const handler = (): void => listener()
      ipcRenderer.on(BRIEFING_CHANGED, handler)
      return () => ipcRenderer.removeListener(BRIEFING_CHANGED, handler)
    }
  },
  meetings: {
    ...invoke.meetings,
    recording: {
      ...invoke.meetings.recording,
      // Fire-and-forget, binary: a hundred milliseconds of audio at a time must not wait for a reply.
      frames: (token, seq, mic, system) => ipcRenderer.send(MEETINGS_CHANNELS.frames, token, seq, mic, system),
      encoded: (token, stream, seq, bytes) => ipcRenderer.send(MEETINGS_CHANNELS.encoded, token, stream, seq, bytes)
    },
    onStatus: subscribe(MEETINGS_CHANNELS.status),
    onProgress: subscribe(MEETINGS_CHANNELS.progress),
    onStop: subscribe(MEETINGS_CHANNELS.stop)
  },
  herman: {
    ...invoke.herman,
    onNudge: subscribe(HERMAN_NUDGE_CHANNEL)
  },
  app: {
    ...invoke.app,
    platform: process.platform,
    window: {
      ...invoke.app.window,
      minimize: () => ipcRenderer.send(IPC.windowMinimize),
      toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
      close: () => ipcRenderer.send(IPC.windowClose)
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
