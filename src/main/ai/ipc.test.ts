/**
 * The AI ipc channels as a renderer reaches them: sender and argument checks, events going to
 * the requesting window only, and the program path that never comes from a renderer.
 * Electron is replaced by a recorder; the program by the stand-in script.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  userData: '',
  packaged: false,
  dialog: { canceled: true, filePaths: [] as string[] }
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.packaged
    },
    getPath: () => electron.userData,
    getVersion: () => '0.0.0',
    on: (name: string, fn: () => void) => {
      if (name === 'will-quit') electron.quit.push(fn)
    }
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => electron.handlers.set(channel, fn),
    on: () => undefined
  },
  dialog: { showOpenDialog: async () => electron.dialog },
  nativeTheme: {},
  shell: {},
  protocol: {}
}))

import type { AiDelta, AiDone, AiError } from '../../shared/ai'
import { openTestRepository } from '../db/testing'
import { registerIpc } from '../ipc'
import { RENDERER_FILE } from '../security'
import { devCliOverride } from './index'

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))
const APP_URL = pathToFileURL(RENDERER_FILE).toString()
const CLIENT = 'client-1'

interface Sent {
  channel: string
  payload: AiDelta | AiDone | AiError
}

function sender(id: number, url = APP_URL): { event: unknown; sent: Sent[]; destroy(): void } {
  const sent: Sent[] = []
  const listeners = new Map<string, () => void>()
  const frame = { url }
  const contents = {
    id,
    mainFrame: frame,
    isDestroyed: () => false,
    send: (channel: string, payload: Sent['payload']) => sent.push({ channel, payload }),
    once: (name: string, fn: () => void) => listeners.set(name, fn),
    on: (name: string, fn: () => void) => listeners.set(name, fn)
  }
  return { event: { sender: contents, senderFrame: frame }, sent, destroy: () => listeners.get('destroyed')?.() }
}

const invoke = (channel: string, event: unknown, ...args: unknown[]): Promise<unknown> => {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler(event, CLIENT, ...args)
}

async function until(check: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end && !check()) await new Promise((resolve) => setTimeout(resolve, 20))
  return check()
}

const repo = openTestRepository()
let pageId = ''
let blockId = ''

beforeAll(() => {
  electron.userData = mkdtempSync(join(tmpdir(), 'sel-ai-ipc-'))
  process.env['SEL_AI_CLI'] = FAKE
  registerIpc({ repo, ready: Promise.resolve(), createWindow: () => undefined })
  pageId = repo.create({ type: 'page', parentId: null, props: { title: [['Release plan']] } }).id
  blockId = repo.create({ type: 'text', parentId: pageId, props: { title: [['We ship teh editor in May.']] } }).id
})

afterAll(() => {
  for (const fn of electron.quit) fn()
  delete process.env['SEL_AI_CLI']
  repo.close()
  rmSync(electron.userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
})

describe('ai ipc', () => {
  it('refuses every channel to a sender that is not the app itself', async () => {
    const remote = sender(9, 'https://evil.test/index.html')
    const frame = sender(10)
    // A sub-frame of the app's own window: the frame that sent the message is not the main frame.
    const sub = { sender: (frame.event as { sender: object }).sender, senderFrame: { url: APP_URL } }
    for (const event of [remote.event, sub]) {
      for (const [channel, args] of [
        ['ai:status', []],
        ['ai:run', [{ action: 'summarize', pageId }]],
        ['ai:cancel', ['x']],
        ['ai:pickCli', []],
        ['ai:servers', []],
        ['ai:scanServers', []],
        ['ai:serverTools', ['user:x']]
      ] as const) {
        await expect(invoke(channel, event, ...args)).rejects.toThrow('Forbidden')
      }
    }
    expect(remote.sent).toEqual([])
    await expect(electron.handlers.get('ai:status')!(sender(1).event, 'bad client id!')).rejects.toThrow('Invalid client id')
  })

  it('rejects malformed requests before anything runs', async () => {
    const win = sender(1)
    await expect(invoke('ai:run', win.event, { action: 'exec', pageId })).rejects.toThrow('Unknown AI action')
    await expect(invoke('ai:run', win.event, { action: 'custom', pageId, instruction: 'x'.repeat(4001) })).rejects.toThrow(
      'Invalid instruction'
    )
    await expect(invoke('ai:run', win.event, { action: 'summarize', pageId: 'not an id' })).rejects.toThrow('Invalid pageId')
    await expect(invoke('ai:run', win.event, { action: 'improve', pageId, blockIds: ['../x'] })).rejects.toThrow('Invalid blockIds')
    await expect(invoke('ai:run', win.event, { action: 'summarize', pageId, prompt: 'raw' })).rejects.toThrow('Invalid AI request')
    await expect(invoke('ai:run', win.event, 'summarize')).rejects.toThrow('Invalid AI request')
    await expect(invoke('ai:cancel', win.event, { id: 'x' })).rejects.toThrow('Invalid request id')
    expect(win.sent).toEqual([])
  })

  it('reports the program found', async () => {
    expect(await invoke('ai:status', sender(1).event)).toEqual({ available: true, path: FAKE, version: '2.1.296' })
  })

  it('runs a request on the stored page and streams it to the requesting window only', async () => {
    const win = sender(1)
    const other = sender(2)
    const { id } = (await invoke('ai:run', win.event, { action: 'improve', pageId, blockIds: [blockId] })) as { id: string }
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await until(() => win.sent.some((entry) => entry.channel !== 'ai:delta'))).toBe(true)
    const last = win.sent[win.sent.length - 1]
    expect(last.channel).toBe('ai:done')
    // The text came from the database (the renderer sent ids only) and went through the stand-in's tidy-up.
    expect(last.payload).toMatchObject({ id, text: 'We ship the editor in May.', truncated: false })
    const deltas = win.sent.filter((entry) => entry.channel === 'ai:delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.every((entry) => entry.payload.id === id)).toBe(true)
    expect(deltas.map((entry) => (entry.payload as AiDelta).text).join('')).toBe('We ship the editor in May.')
    expect(other.sent).toEqual([])
  })

  it('sends failures as an error event with a code and no raw output', async () => {
    const win = sender(1)
    const { id } = (await invoke('ai:run', win.event, { action: 'custom', pageId, instruction: 'go [[fake:error-login]]' })) as {
      id: string
    }
    expect(await until(() => win.sent.length > 0)).toBe(true)
    expect(win.sent).toEqual([{ channel: 'ai:error', payload: { id, code: 'not-logged-in', message: expect.stringContaining('sign in') } }])
    // A page that is not one: the request is well-formed, the content is not there.
    const gone = (await invoke('ai:run', win.event, { action: 'summarize', pageId: blockId })) as { id: string }
    expect(await until(() => win.sent.length > 1)).toBe(true)
    expect(win.sent[1]).toEqual({
      channel: 'ai:error',
      payload: { id: gone.id, code: 'failed', message: expect.any(String), detail: 'The page no longer exists' }
    })
  })

  it('lets only the window that started a request cancel it, and cancels all of a closed window', async () => {
    const win = sender(3)
    const other = sender(4)
    const { id } = (await invoke('ai:run', win.event, { action: 'custom', instruction: '[[fake:hang]]' })) as { id: string }
    expect(await until(() => win.sent.some((entry) => entry.channel === 'ai:delta'))).toBe(true)
    expect(await invoke('ai:cancel', other.event, id)).toBe(false)
    expect(await invoke('ai:cancel', win.event, id)).toBe(true)
    expect(await until(() => win.sent.some((entry) => entry.channel === 'ai:error'))).toBe(true)
    expect(win.sent[win.sent.length - 1].payload).toMatchObject({ id, code: 'cancelled' })

    const closing = sender(5)
    await invoke('ai:run', closing.event, { action: 'custom', instruction: '[[fake:hang]]' })
    expect(await until(() => closing.sent.some((entry) => entry.channel === 'ai:delta'))).toBe(true)
    closing.destroy()
    expect(await until(() => closing.sent.some((entry) => entry.channel === 'ai:error'))).toBe(true)
    expect(closing.sent[closing.sent.length - 1].payload).toMatchObject({ code: 'cancelled' })
  })

  it('never takes the program path from a renderer, only from the file dialog', async () => {
    const win = sender(1)
    await expect(invoke('app:setSetting', win.event, 'ai.cliPath', 'C:\\Windows\\System32\\calc.exe')).rejects.toThrow('file dialog')
    await expect(invoke('app:setSetting', win.event, 'ai.args', ['--dangerously-skip-permissions'])).rejects.toThrow('read-only')
    expect(repo.getSetting('ai.cliPath')).toBeNull()
    // Cancelled dialog: nothing changes.
    electron.dialog = { canceled: true, filePaths: [] }
    expect(await invoke('ai:pickCli', win.event)).toBeNull()
    // A directory, and a file this platform cannot start: reported, not stored.
    for (const path of [electron.userData, join(electron.userData, 'missing.exe')]) {
      electron.dialog = { canceled: false, filePaths: [path] }
      expect(await invoke('ai:pickCli', win.event)).toEqual({ available: false, reason: 'not-executable' })
      expect(repo.getSetting('ai.cliPath')).toBeNull()
    }
    // Clearing the choice and the other settings go through the ordinary, typed channel.
    await invoke('app:setSetting', win.event, 'ai.cliPath', null)
    await invoke('app:setSetting', win.event, 'ai.timeoutSec', 5)
    expect(repo.getSetting('ai.timeoutSec')).toBe(10)
    await invoke('app:setSetting', win.event, 'ai.timeoutSec', null)
  })

  it('turns everything off with the setting, at once', async () => {
    const win = sender(1)
    await invoke('app:setSetting', win.event, 'ai.enabled', false)
    expect(await invoke('ai:status', win.event)).toEqual({ available: false, reason: 'disabled' })
    await invoke('app:setSetting', win.event, 'ai.enabled', null)
    expect(await invoke('ai:status', win.event)).toMatchObject({ available: true })
  })

  it('reads the stand-in from the environment in unpackaged builds only', () => {
    expect(devCliOverride(FAKE, false)).toBe(FAKE)
    expect(devCliOverride(FAKE, true)).toBeNull()
    expect(devCliOverride(undefined, false)).toBeNull()
    expect(devCliOverride('', false)).toBeNull()
  })
})
