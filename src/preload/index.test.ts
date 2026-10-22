/**
 * What the preload puts on `window.api`, as a renderer sees it: one method per declared invoke
 * channel and no other, the client id on every invoke, and the events and fire-and-forget sends
 * written out by hand. Electron is replaced by a recorder.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  api: null as unknown,
  invoked: [] as { channel: string; args: unknown[] }[],
  sent: [] as string[],
  listened: [] as string[]
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_key: string, api: unknown) => (electron.api = api) },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      electron.invoked.push({ channel, args })
      return Promise.resolve(null)
    },
    send: (channel: string) => electron.sent.push(channel),
    on: (channel: string) => electron.listened.push(channel),
    removeListener: () => undefined
  }
}))

import { INVOKE } from '../shared/api'

/** Every member of the api by its dotted path, with what calling it did. */
function members(): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (node: object, path: string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      const at = [...path, key].join('.')
      if (typeof value === 'function') {
        electron.invoked.length = electron.sent.length = electron.listened.length = 0
        const result: unknown = key.startsWith('on') ? value(() => undefined) : value('x')
        if (electron.invoked.length) found.set(at, `invoke ${electron.invoked[0].channel}`)
        else if (electron.sent.length) found.set(at, `send ${electron.sent[0]}`)
        else if (electron.listened.length && typeof result === 'function') found.set(at, `on ${[...electron.listened].sort().join(' ')}`)
        else found.set(at, 'function that does nothing')
      } else if (value !== null && typeof value === 'object') walk(value, [...path, key])
      else found.set(at, typeof value)
    }
  }
  walk(electron.api as object, [])
  return found
}

beforeAll(async () => {
  await import('./index')
})

describe('the preload', () => {
  it('exposes one method per declared invoke channel, at the place the channel names', () => {
    const invokes = [...members()].filter(([, what]) => what.startsWith('invoke '))
    const expected = Object.keys(INVOKE).map((channel) => {
      const [namespace, rest] = channel.split(':')
      return [`${namespace}.${rest}`, `invoke ${channel}`]
    })
    expect(invokes.sort()).toEqual(expected.sort())
  })

  it('carries the client id first on every invoke, then the arguments as they were given', async () => {
    const api = electron.api as { clientId: string; blocks: { move(...args: unknown[]): Promise<unknown> } }
    electron.invoked.length = 0
    await api.blocks.move('a', null, 'b')
    expect(electron.invoked).toEqual([{ channel: 'blocks:move', args: [api.clientId, 'a', null, 'b'] }])
    expect(api.clientId).toMatch(/^[0-9a-f-]{32,36}$/)
  })

  it('exposes these channels and nothing more', () => {
    // A change here changes what a renderer can reach: review it as such.
    expect(Object.fromEntries([...members()].filter(([, what]) => !what.startsWith('invoke ')))).toEqual({
      clientId: 'string',
      'ai.onEvent': 'on ai:council ai:delta ai:done ai:error',
      'sync.onStatus': 'on sync:status',
      'briefing.onChanged': 'on briefing:changed',
      'meetings.recording.frames': 'send meetings:recording.frames',
      'meetings.recording.encoded': 'send meetings:recording.encoded',
      'meetings.onStatus': 'on meetings:status',
      'meetings.onProgress': 'on meetings:progress',
      'meetings.onStop': 'on meetings:stop',
      'herman.onNudge': 'on herman:nudge',
      'updates.onStatus': 'on updates:status',
      'alarms.onAnnounce': 'on alarms:announce',
      'pomodoro.onChanged': 'on pomodoro:changed',
      'pomodoro.onEnded': 'on pomodoro:ended',
      'pomodoro.onCompleted': 'on pomodoro:completed',
      'sky.onChanged': 'on sky:changed',
      'app.platform': 'string',
      'app.log': 'send log:error',
      'app.window.minimize': 'send window:minimize',
      'app.window.toggleMaximize': 'send window:toggleMaximize',
      'app.window.close': 'send window:close',
      onChange: 'on event:change',
      onCommand: 'on event:command',
      onNotice: 'on event:notice'
    })
  })

  it('exposes only the invoke channels reviewed for each namespace', async () => {
    // One list per namespace in ./reviewed, written out by hand: a channel added to INVOKE
    // reaches a renderer only once it is written there too.
    const reviewed = new Map<string, readonly string[]>()
    const dir = fileURLToPath(new URL('./reviewed/', import.meta.url))
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const module = (await import(pathToFileURL(join(dir, file)).href)) as { REVIEWED: readonly string[] }
      reviewed.set(file.slice(0, -3), module.REVIEWED)
    }
    const declared = new Map<string, string[]>()
    for (const channel of Object.keys(INVOKE)) {
      const namespace = channel.slice(0, channel.indexOf(':'))
      declared.set(namespace, [...(declared.get(namespace) ?? []), channel])
    }
    expect([...reviewed.keys()].sort()).toEqual([...declared.keys()].sort())
    for (const [namespace, channels] of declared) expect([...(reviewed.get(namespace) ?? [])].sort(), namespace).toEqual(channels.sort())
  })
})
