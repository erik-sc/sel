/**
 * What the preload puts on `window.api`, as a renderer sees it: one method per declared invoke
 * channel and no other, the client id on every invoke, and the events and fire-and-forget sends
 * written out by hand. Electron is replaced by a recorder.
 */
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

// The preload imports shared code through the `@shared` alias, which tests do not resolve.
vi.mock('@shared/ai', () => import('../shared/ai'))
vi.mock('@shared/api', () => import('../shared/api'))
vi.mock('@shared/briefing', () => import('../shared/briefing'))
vi.mock('@shared/herman', () => import('../shared/herman'))
vi.mock('@shared/ipc', () => import('../shared/ipc'))
vi.mock('@shared/meetings', () => import('../shared/meetings'))
vi.mock('@shared/sync', () => import('../shared/sync'))
vi.mock('@shared/types', () => import('../shared/types'))
vi.mock('@shared/updates', () => import('../shared/updates'))
vi.mock('@shared/alarms', () => import('../shared/alarms'))
vi.mock('@shared/pomodoro', () => import('../shared/pomodoro'))

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
      'app.platform': 'string',
      'app.window.minimize': 'send window:minimize',
      'app.window.toggleMaximize': 'send window:toggleMaximize',
      'app.window.close': 'send window:close',
      onChange: 'on event:change',
      onCommand: 'on event:command'
    })
    expect(Object.keys(INVOKE).sort()).toEqual([...INVOKE_CHANNELS].sort())
  })
})

/** The invoke channels, as a list to review: the ones on main before #22, with `window:isMaximized` renamed. */
const INVOKE_CHANNELS = [
  'ai:agents.connect',
  'ai:agents.list',
  'ai:agents.remove',
  'ai:cancel',
  'ai:pickCli',
  'ai:run',
  'ai:status',
  'app:getSetting',
  'app:getTheme',
  'alarms:heard',
  'alarms:pending',
  'alarms:snooze',
  'alarms:test',
  'pomodoro:next',
  'pomodoro:pause',
  'pomodoro:resume',
  'pomodoro:skip',
  'pomodoro:start',
  'pomodoro:state',
  'pomodoro:stop',
  'app:newWindow',
  'app:openExternal',
  'app:setSetting',
  'app:setTheme',
  'app:window.isMaximized',
  'blocks:apply',
  'blocks:children',
  'blocks:create',
  'blocks:delete',
  'blocks:get',
  'blocks:getMany',
  'blocks:getTree',
  'blocks:move',
  'blocks:update',
  'briefing:addPhrase',
  'briefing:agenda',
  'briefing:anotherPhrase',
  'briefing:brief',
  'briefing:calendars.add',
  'briefing:calendars.list',
  'briefing:calendars.remove',
  'briefing:calendars.test',
  'briefing:calendars.update',
  'briefing:completeTask',
  'briefing:databases',
  'briefing:ensurePhrasesDatabase',
  'briefing:get',
  'briefing:undoCompleteTask',
  'databases:list',
  'databases:locations',
  'feedback:create',
  'feedback:list',
  'feedback:openFolder',
  'feedback:withdraw',
  'tasks:globalShortcut',
  'tasks:importTodoist',
  'tasks:setGlobalShortcut',
  'files:pickImage',
  'files:saveGeneratedImage',
  'files:saveImage',
  'herman:met',
  'herman:nudge.dismiss',
  'herman:nudge.next',
  'herman:reset',
  'herman:state',
  'mcp:rotateToken',
  'mcp:status',
  'meetings:audio.delete',
  'meetings:audio.info',
  'meetings:cancelTranscribe',
  'meetings:create',
  'meetings:engine.cancelDownload',
  'meetings:engine.download',
  'meetings:engine.pickModel',
  'meetings:engine.pickProgram',
  'meetings:engine.remove',
  'meetings:engine.status',
  'meetings:openFolder',
  'meetings:recording.begin',
  'meetings:recording.discard',
  'meetings:recording.pause',
  'meetings:recording.probe',
  'meetings:recording.recover',
  'meetings:recording.resume',
  'meetings:recording.stop',
  'meetings:setSpeakers',
  'meetings:status',
  'meetings:storage',
  'meetings:transcribe',
  'notebook:dismissPlans',
  'notebook:get',
  'notebook:plan',
  'notebook:review',
  'notebook:write',
  'pages:ancestors',
  'pages:deleteForever',
  'pages:duplicate',
  'pages:exportMarkdown',
  'pages:exportPdf',
  'pages:exportTex',
  'pages:importMarkdown',
  'pages:listArchived',
  'pages:listChildren',
  'pages:listFavorites',
  'pages:listRecent',
  'pages:listRoot',
  'pages:listTrash',
  'pages:restore',
  'search:query',
  'sync:disconnect',
  'sync:now',
  'sync:pause',
  'sync:pickGit',
  'sync:setEncryption',
  'sync:setup',
  'sync:status',
  'sync:unlock',
  'updates:check',
  'updates:dismiss',
  'updates:download',
  'updates:restart',
  'updates:status',
  'versions:clear',
  'versions:current',
  'versions:delete',
  'versions:get',
  'versions:list',
  'versions:rename',
  'versions:restore',
  'versions:save',
  'versions:stats'
]
