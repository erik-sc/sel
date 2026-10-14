/**
 * The invoke channels as main registers them: exactly the ones declared in INVOKE, each behind
 * the wrapper that checks the sender and the client id before anything else runs. Electron is
 * replaced by a recorder.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  on: [] as string[],
  quit: [] as (() => void)[],
  userData: ''
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => electron.userData,
    on: (name: string, fn: () => void) => {
      if (name === 'will-quit') electron.quit.push(fn)
    }
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      if (electron.handlers.has(channel)) throw new Error(`second handler for ${channel}`)
      electron.handlers.set(channel, fn)
    },
    on: (channel: string) => electron.on.push(channel)
  },
  dialog: {},
  nativeTheme: {},
  shell: {},
  protocol: {}
}))

import { INVOKE, IPC } from '../shared/api'
import { MEETINGS_CHANNELS } from '../shared/meetings'
import { openTestRepository } from './db/testing'
import type { Handlers } from './invoke'
import { registerIpc } from './ipc'
import { RENDERER_FILE } from './security'

const APP_URL = pathToFileURL(RENDERER_FILE).toString()
const repo = openTestRepository()

function sender(url: string): { sender: object; senderFrame: object } {
  const frame = { url }
  return { sender: { id: 1, mainFrame: frame, isDestroyed: () => false }, senderFrame: frame }
}

beforeAll(() => {
  electron.userData = mkdtempSync(join(tmpdir(), 'sel-ipc-'))
  registerIpc({ repo, ready: Promise.resolve(), createWindow: () => undefined })
})

afterAll(() => {
  for (const fn of electron.quit) fn()
  repo.close()
  rmSync(electron.userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
})

describe('ipc registration', () => {
  it('registers a handler for every declared invoke channel, and for no other', () => {
    expect([...electron.handlers.keys()].sort()).toEqual(Object.keys(INVOKE).sort())
  })

  it('listens to the fire-and-forget channels only', () => {
    expect([...electron.on].sort()).toEqual([IPC.windowMinimize, IPC.windowToggleMaximize, IPC.windowClose, MEETINGS_CHANNELS.frames, MEETINGS_CHANNELS.encoded].sort())
  })

  it('refuses every channel to a sender that is not the app, and to a bad client id, before its handler runs', async () => {
    const before = repo.listRoot().length
    for (const [channel, handler] of electron.handlers) {
      await expect(handler(sender('https://evil.test/index.html'), 'client-1', 'x'), channel).rejects.toThrow('Forbidden')
      await expect(handler(sender(APP_URL), 'bad client id!', 'x'), channel).rejects.toThrow('Invalid client id')
    }
    expect(repo.listRoot().length).toBe(before)
  })

  it('answers a declared channel from the app', async () => {
    const page = repo.create({ type: 'page', parentId: null })
    await expect(electron.handlers.get('blocks:get')!(sender(APP_URL), 'client-1', page.id)).resolves.toMatchObject({ id: page.id })
  })
})

describe('the handler map type', () => {
  it('wants every channel of a namespace, and no channel that is not declared', () => {
    const ok = (): null => null
    const complete: Handlers<'feedback'> = { 'feedback:list': ok, 'feedback:create': ok, 'feedback:withdraw': ok, 'feedback:openFolder': ok }
    // @ts-expect-error: `feedback:openFolder` has no handler
    const missing: Handlers<'feedback'> = { 'feedback:list': ok, 'feedback:create': ok, 'feedback:withdraw': ok }
    // @ts-expect-error: no channel `feedback:nope` is declared
    const extra: Handlers<'feedback'> = { ...complete, 'feedback:nope': ok }
    expect(Object.keys({ ...complete, ...missing, ...extra })).toContain('feedback:list')
  })
})
