/**
 * The sync ipc channels as a renderer reaches them: sender and argument checks, the settings a
 * renderer cannot write, the git path that only comes from the native dialog, and the test-only
 * switch a shipped app ignores. Electron is replaced by a recorder.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  userData: '',
  packaged: true,
  keychain: true,
  dialog: { canceled: true, filePaths: [] as string[] },
  sent: [] as { channel: string; payload: unknown }[]
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
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }) } }],
    fromWebContents: () => null
  },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => electron.handlers.set(channel, fn),
    on: () => undefined
  },
  dialog: { showOpenDialog: async () => electron.dialog },
  safeStorage: {
    isEncryptionAvailable: () => electron.keychain,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
    decryptString: (data: Buffer) => data.toString().replace(/^sealed:/, '')
  },
  nativeTheme: {},
  shell: {},
  protocol: {}
}))

import type { SyncStatus } from '../../shared/sync'
import { openTestRepository } from '../db/testing'
import { registerIpc, type SyncHooks } from '../ipc'
import { RENDERER_FILE } from '../security'
import { allowLocalRemotes, syncSetup } from './index'

const APP_URL = pathToFileURL(RENDERER_FILE).toString()
const CLIENT = 'client-1'
const CHANNELS: [string, unknown[]][] = [
  ['sync:status', []],
  ['sync:setup', [{ remoteUrl: 'https://github.com/o/r.git' }]],
  ['sync:now', []],
  ['sync:pause', [true]],
  ['sync:disconnect', [{ keepRemote: true }]],
  ['sync:pickGit', []],
  ['sync:unlock', ['a passphrase']],
  ['sync:setEncryption', ['a passphrase']]
]

function sender(url = APP_URL): { sender: object; senderFrame: object } {
  const frame = { url }
  return { sender: { id: 1, mainFrame: frame, isDestroyed: () => false }, senderFrame: frame }
}

const invoke = (channel: string, event: unknown, ...args: unknown[]): Promise<unknown> => {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler(event, CLIENT, ...args)
}

const repo = openTestRepository()
let hooks: SyncHooks

beforeAll(() => {
  electron.userData = mkdtempSync(join(tmpdir(), 'sel-sync-ipc-'))
  // A shipped app must ignore this.
  process.env['SEL_SYNC_ALLOW_LOCAL'] = '1'
  hooks = registerIpc({ repo, ready: Promise.resolve(), createWindow: () => undefined })
  repo.create({ type: 'page', parentId: null, props: { title: [['A page']] } })
})

afterAll(() => {
  for (const fn of electron.quit) fn()
  delete process.env['SEL_SYNC_ALLOW_LOCAL']
  repo.close()
  rmSync(electron.userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
})

describe('sync ipc', () => {
  it('refuses every channel to a sender that is not the app itself', async () => {
    const remote = sender('https://evil.test/index.html')
    const own = sender()
    const sub = { sender: own.sender, senderFrame: { url: APP_URL } }
    for (const event of [remote, sub]) {
      for (const [channel, args] of CHANNELS) await expect(invoke(channel, event, ...args), channel).rejects.toThrow('Forbidden')
    }
    await expect(electron.handlers.get('sync:status')!(sender(), 'bad client id!')).rejects.toThrow('Invalid client id')
    // Nothing was loaded or stored on their account.
    expect(repo.getSetting('sync.remoteUrl')).toBeNull()
  })

  it('answers that nothing is set up, and starts nothing by itself', async () => {
    hooks.start()
    expect(hooks.beforeQuit()).toBeNull()
    const status = (await invoke('sync:status', sender())) as SyncStatus
    expect(status).toMatchObject({ configured: false, state: 'needs-setup', branch: 'main', pending: 0, encrypted: false, paused: false, activity: [] })
    expect(status.deviceName.length).toBeGreaterThan(0)
    expect(await invoke('sync:now', sender())).toMatchObject({ configured: false, state: 'needs-setup' })
    expect(hooks.beforeQuit()).toBeNull()
  })

  it('rejects malformed requests before anything runs', async () => {
    const win = sender()
    for (const bad of [null, 'https://github.com/o/r.git', [], { remoteUrl: 5 }, { remoteUrl: 'x'.repeat(600) }, { remoteUrl: 'https://github.com/o/r.git', branch: '--force' }, { remoteUrl: 'https://github.com/o/r.git', mode: 'overwrite' }, { remoteUrl: 'https://github.com/o/r.git', passphrase: 'short' }, { remoteUrl: 'https://github.com/o/r.git', useAnyway: 'yes' }, { remoteUrl: 'https://github.com/o/r.git', gitPath: 'C:\\evil.exe' }, { remoteUrl: 'https://github.com/o/r.git', deviceName: 7 }]) {
      await expect(invoke('sync:setup', win, bad), JSON.stringify(bad)).rejects.toThrow()
    }
    await expect(invoke('sync:pause', win, 'yes')).rejects.toThrow('Invalid sync request')
    await expect(invoke('sync:disconnect', win, {})).rejects.toThrow('Invalid sync request')
    await expect(invoke('sync:disconnect', win, { keepRemote: false })).rejects.toThrow('Invalid sync request')
    await expect(invoke('sync:disconnect', win)).rejects.toThrow('Invalid sync request')
    await expect(invoke('sync:unlock', win, 'short')).rejects.toThrow('Invalid passphrase')
    await expect(invoke('sync:unlock', win, { passphrase: 'long enough' })).rejects.toThrow('Invalid passphrase')
    await expect(invoke('sync:setEncryption', win, 5)).rejects.toThrow()
    expect(syncSetup({ remoteUrl: 'https://github.com/o/r.git', branch: 'main', deviceName: 'Laptop', mode: 'replace', passphrase: 'long enough', useAnyway: true })).toEqual({
      remoteUrl: 'https://github.com/o/r.git',
      branch: 'main',
      deviceName: 'Laptop',
      mode: 'replace',
      passphrase: 'long enough',
      useAnyway: true
    })
  })

  it('answers a bad address with a status, and takes no folder as a remote in a shipped app', async () => {
    const win = sender()
    for (const url of ['https://user:sekrit99@github.com/o/r.git', 'ext::sh -c calc', 'file:///C:/x', 'C:\\Users\\me\\remote.git', '/tmp/remote.git', '-oProxyCommand=calc']) {
      const status = (await invoke('sync:setup', win, { remoteUrl: url })) as SyncStatus
      expect(status, url).toMatchObject({ configured: false, lastError: { code: 'invalid-url' } })
      expect(JSON.stringify(status), url).not.toContain('sekrit99')
    }
    expect(repo.getSetting('sync.remoteUrl')).toBeNull()
    expect(allowLocalRemotes('1', true)).toBe(false)
    expect(allowLocalRemotes('1', false)).toBe(true)
    expect(allowLocalRemotes('true', false)).toBe(false)
    expect(allowLocalRemotes(undefined, false)).toBe(false)
  })

  it('lets a renderer read the sync settings and write none of them', async () => {
    const win = sender()
    for (const key of ['sync.remoteUrl', 'sync.gitPath', 'sync.lastCommit', 'sync.deviceName', 'sync.paused', 'sync.branch', 'sync.encrypted', 'sync.appearanceAt', 'sync.activity', 'sync.useAnyway']) {
      await expect(invoke('app:setSetting', win, key, 'x'), key).rejects.toThrow('read-only')
      await expect(invoke('app:setSetting', win, key, null), key).rejects.toThrow('read-only')
    }
    expect(repo.getSetting('sync.gitPath')).toBeNull()
    expect(await invoke('app:getSetting', win, 'sync.remoteUrl')).toBeNull()
  })

  it('stamps a change of the appearance settings, which is what the merge goes by', async () => {
    const before = Date.now()
    await invoke('app:setSetting', sender(), 'appearance', { version: 1, light: {}, dark: {}, shared: {}, customCss: '', presetId: null })
    expect(repo.getSetting<number>('sync.appearanceAt')).toBeGreaterThanOrEqual(before)
  })

  it('takes the git program from the native dialog only, and only a real git', async () => {
    const win = sender()
    electron.dialog = { canceled: true, filePaths: [] }
    expect(await invoke('sync:pickGit', win)).toBeNull()
    const dir = join(electron.userData, 'bin')
    mkdirSync(dir, { recursive: true })
    const windows = process.platform === 'win32'
    const impostor = join(dir, windows ? 'calc.exe' : 'calc')
    writeFileSync(impostor, '')
    electron.dialog = { canceled: false, filePaths: [impostor] }
    expect(await invoke('sync:pickGit', win)).toMatchObject({ lastError: { code: 'git-not-found', message: 'That file is not the git program.' } })
    expect(repo.getSetting('sync.gitPath')).toBeNull()
    const real = join(dir, windows ? 'git.exe' : 'git')
    writeFileSync(real, '')
    electron.dialog = { canceled: false, filePaths: [real] }
    const picked = (await invoke('sync:pickGit', win)) as SyncStatus
    expect(picked.lastError).toBeUndefined()
    expect(repo.getSetting('sync.gitPath')).toBe(real)
    // The path itself is not part of what a window is told.
    expect(JSON.stringify(picked)).not.toContain('git.exe')
    // An argument from the renderer changes nothing about which file is taken.
    electron.dialog = { canceled: true, filePaths: [] }
    expect(await invoke('sync:pickGit', win, 'C:\\evil\\git.exe')).toBeNull()
    expect(repo.getSetting('sync.gitPath')).toBe(real)
    repo.setSetting('sync.gitPath', null)
  })

  it('does not offer encryption where the key cannot be kept safely', async () => {
    electron.keychain = false
    const status = (await invoke('sync:setup', sender(), { remoteUrl: 'https://github.com/o/r.git', passphrase: 'a long passphrase' })) as SyncStatus
    expect(status).toMatchObject({ configured: false, lastError: { code: 'failed' } })
    expect(status.lastError?.message).toContain('no secure place')
    await expect(invoke('sync:setEncryption', sender(), 'a long passphrase')).rejects.toThrow('no secure place')
    electron.keychain = true
  })
})
