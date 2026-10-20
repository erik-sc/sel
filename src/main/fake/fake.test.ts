/**
 * Adding a feature touches its own folders and one line in each list of features: here a feature
 * that does not exist (src/shared/fake, ./register.ts) is added to each list the way a real one
 * is, and its call, its setting and its command work with nothing else changed. Electron is
 * replaced by a recorder. The renderer's half (its screen, its handler, the palette and the
 * shortcuts screen) is in src/renderer/src/fake/fake.test.ts.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  menu: [] as { label?: string; submenu?: { label?: string; accelerator?: string; type?: string }[] }[],
  userData: ''
}))

vi.mock('electron', () => ({
  app: {
    name: 'sel',
    isPackaged: false,
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
  Menu: {
    buildFromTemplate: (template: typeof electron.menu) => (electron.menu = template),
    setApplicationMenu: () => undefined
  },
  dialog: {},
  nativeTheme: {},
  shell: {},
  protocol: {}
}))

import { INVOKE } from '../../shared/api'
import { COMMANDS } from '../../shared/commands'
import { FAKE_COMMANDS, FAKE_INVOKE, FAKE_LEVEL_KEY, FAKE_SETTINGS } from '../../shared/fake'
import { buildInvokers } from '../../shared/ipc'
import { SETTINGS, settingsSpecOf } from '../../shared/settings'
import { shortcutsOf } from '../../shared/shortcuts'
import { openTestRepository } from '../db/testing'
import { FEATURES } from '../features'
import { type IpcLists, registerIpc } from '../ipc'
import { buildMenu } from '../menu'
import { RENDERER_FILE } from '../security'
import { fakeFeature } from './register'

const repo = openTestRepository()
const frame = { url: pathToFileURL(RENDERER_FILE).toString() }
const app = { sender: { id: 1, mainFrame: frame, isDestroyed: () => false }, senderFrame: frame }

// The one line the feature adds to each list.
const invoke = { ...INVOKE, ...FAKE_INVOKE }
const settings = [...SETTINGS, FAKE_SETTINGS]
const commands = [...COMMANDS, ...FAKE_COMMANDS]
let registered: ReturnType<typeof fakeFeature.register> | null = null
const fake = {
  namespace: fakeFeature.namespace,
  register: (ctx: Parameters<typeof fakeFeature.register>[0]) => (registered = fakeFeature.register(ctx))
} as unknown as IpcLists['features'][number]

beforeAll(() => {
  electron.userData = mkdtempSync(join(tmpdir(), 'sel-fake-'))
  registerIpc({ repo, ready: Promise.resolve(), createWindow: () => undefined }, { invoke, features: [...FEATURES, fake], settings })
})

afterAll(() => {
  for (const fn of electron.quit) fn()
  repo.close()
  rmSync(electron.userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
})

const call = (channel: string, ...args: unknown[]): Promise<unknown> => electron.handlers.get(channel)!(app, 'client-1', ...args)

describe('a new feature', () => {
  it('is unknown to the app until it is in the lists', () => {
    expect(settingsSpecOf(FAKE_LEVEL_KEY)).toBeNull()
    expect(Object.keys(INVOKE)).not.toContain('fake:echo')
  })

  it('answers its call through the same checks as every other, and the preload exposes it', async () => {
    expect([...electron.handlers.keys()].sort()).toEqual(Object.keys(invoke).sort())
    await expect(
      electron.handlers.get('fake:echo')!(
        { sender: { ...app.sender, mainFrame: { url: 'https://evil.test/' } }, senderFrame: { url: 'https://evil.test/' } },
        'client-1',
        'x'
      )
    ).rejects.toThrow('Forbidden')
    const bridge = buildInvokers(
      Object.keys(invoke),
      (channel) =>
        (...args) =>
          call(channel, ...args)
    ) as { fake: { echo(text: string): Promise<string> } }
    await expect(bridge.fake.echo('hello')).resolves.toBe('hello (level null)')
  })

  it('has its setting written, cleaned, and heard by its main side', async () => {
    await call('app:setSetting', FAKE_LEVEL_KEY, 7.6)
    expect(repo.getSetting(FAKE_LEVEL_KEY)).toBe(8)
    await expect(call('app:setSetting', FAKE_LEVEL_KEY, 'high')).rejects.toThrow('Invalid setting value')
    await expect(call('app:setSetting', 'fake.other', 1)).rejects.toThrow('read-only')
    expect(registered?.heard).toEqual([FAKE_LEVEL_KEY])
    await expect(call('fake:echo', 'hello')).resolves.toBe('hello (level 8)')
  })

  it('gets its shortcut and its menu item from its command', () => {
    const shortcuts = shortcutsOf(commands)
    expect(shortcuts.find((s) => s.command === ('open-fake' as never))?.accelerator).toBe('CmdOrCtrl+Alt+Y')
    const combos = shortcuts.map((s) => `${s.ctrl ? 'c' : ''}${s.shift ? 's' : ''}${s.alt ? 'a' : ''}+${s.key}`)
    expect(new Set(combos).size).toBe(combos.length)
    buildMenu(commands)
    const view = electron.menu.find((menu) => menu.label === 'View')?.submenu ?? []
    const pomodoro = view.findIndex((item) => item.label === 'Start a Pomodoro')
    expect(view[pomodoro + 1]).toMatchObject({ label: 'Fake', accelerator: 'CmdOrCtrl+Alt+Y' })
  })
})

describe('each list of features', () => {
  // The lists a feature adds itself to. Each names one feature per line.
  const LISTS: [file: string, start: string][] = [
    ['src/shared/settings.ts', 'export const SETTINGS'],
    ['src/shared/commands.ts', 'export const COMMANDS'],
    ['src/main/features.ts', 'export const FEATURES'],
    ['src/renderer/src/features.ts', 'export const FEATURES'],
    ['src/renderer/src/screens.ts', 'export const SCREENS'],
    ['src/renderer/src/shell/settingsSections.ts', 'const LISTED']
  ]
  const root = resolve(__dirname, '../../..')
  /** The lines between the brackets that open after `start` and the one that closes them. */
  const entries = (file: string, start: string, open: string, close: string): string[] => {
    const text = readFileSync(join(root, file), 'utf8')
    const from = text.indexOf(`= ${open}`, text.indexOf(start)) + 2
    let depth = 0
    for (let at = from; at < text.length; at++) {
      if (text[at] === open) depth++
      else if (text[at] === close && --depth === 0)
        return text
          .slice(from + 1, at)
          .split(/[\n,]/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('//'))
    }
    throw new Error(`no list in ${file}`)
  }

  it('names a feature with one word, so a feature is one line added', () => {
    for (const [file, start] of LISTS) {
      const listed = entries(file, start, '[', ']')
      expect(listed.length, file).toBeGreaterThan(3)
      for (const entry of listed) expect(entry, file).toMatch(/^(\.\.\.)?[A-Za-z_]+$/)
    }
    // INVOKE writes the shell's own channels, then one spread per feature.
    const invokeEntries = entries('src/shared/api.ts', 'export const INVOKE', '{', '}')
    const spreads = invokeEntries.filter((entry) => entry.startsWith('...'))
    expect(spreads.length).toBeGreaterThan(3)
    for (const entry of spreads) expect(entry).toMatch(/^\.\.\.[A-Z_]+_INVOKE$/)
    for (const entry of invokeEntries.filter((entry) => !entry.startsWith('...')))
      expect(entry).toMatch(/^'(blocks|pages|databases|search|versions|files|app):[A-Za-z.]+': true$/)
  })
})
