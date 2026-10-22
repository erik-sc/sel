/**
 * Test-only: what the sync integration tests share. REAL git, local bare repositories as
 * remotes, and simulated devices, each with its own database, files folder and clone.
 * Not imported by the app bundle.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, vi } from 'vitest'
import type { SyncStatus } from '../../shared/sync'
import type { Block, RichText } from '../../shared/types'
import type { Repository } from '../db/repository'
import { calendarSync, CalendarStore, type Cipher } from '../briefing/secrets'
import { openTestRepository } from '../db/testing'
import { SyncEngine, type SecretStore, type SyncStep } from './engine'
import { locateGit } from './git'
import { gitSuite } from './gitSuite'

export const GIT = locateGit()
if (!GIT && !process.env['CI']) console.warn('[sync.test] git was not found on this computer: the sync integration tests are skipped')
/** `describe`; without git, skipped here and failed on CI (./gitSuite.ts). */
export function suite(name: string, fn: () => void): void {
  gitSuite(GIT, name, fn)
}
// Every cycle starts git a dozen times, and starting a program is slow on Windows.
vi.setConfig({ testTimeout: 180_000 })

export const ROOT = mkdtempSync(join(tmpdir(), 'sel-sync-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('IHDR-and-some-pixels-0123456789')
])
const KDF = { N: 1 << 14, r: 8, p: 1 }
let serial = 0
/** A name no other folder of this run has. */
export function unique(prefix: string): string {
  return join(ROOT, `${prefix}-${++serial}`)
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT as string, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
}

export function bareRemote(): string {
  const dir = join(ROOT, `remote-${++serial}.git`)
  mkdirSync(dir)
  git(dir, 'init', '--bare', '-q', '-b', 'main')
  return dir
}

/** The files of the branch on the remote, by path. */
export function remoteFiles(remote: string, branch = 'main'): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  let listing: string
  try {
    listing = git(remote, 'ls-tree', '-r', '--name-only', branch)
  } catch {
    return out
  }
  for (const path of listing.split('\n').filter(Boolean)) {
    out.set(path, execFileSync(GIT as string, ['show', `${branch}:${path}`], { cwd: remote, stdio: ['ignore', 'pipe', 'pipe'] }))
  }
  return out
}

export function commitCount(remote: string): number {
  try {
    return Number(git(remote, 'rev-list', '--count', 'main').trim())
  } catch {
    return 0
  }
}

export interface Device {
  name: string
  repo: Repository
  engine: SyncEngine
  dir: string
  filesDir: string
  clock: { t: number }
  applied: number
  statuses: SyncStatus[]
  spawns: { args: readonly string[]; env: Readonly<Record<string, string>> }[]
  hook: ((step: SyncStep) => void | Promise<void>) | null
  secrets: { value: string | null }
  /** The device's connected calendars, as the briefing keeps them. */
  calendars: CalendarStore
  /** Whether the device has a key store for them (false: like Linux without a keyring). */
  keyStore: { available: boolean }
  /** Calendar ids whose events a sync told the reader to forget. */
  forgotten: string[]
  setup(remote: string, extra?: Record<string, unknown>): Promise<SyncStatus>
  page(title: string, parentId?: string | null): Block
  text(parentId: string, text: string): Block
  titles(): string[]
  texts(pageId: string): string[]
}

export function plain(rich: RichText | undefined): string {
  return (rich ?? []).map((span) => span[0]).join('')
}

/** A device: `start` sets its clock, so that tests decide whose edit is the later one. */
export function device(name: string, start: number): Device {
  const dir = join(ROOT, `device-${++serial}-${name.replace(/\W/g, '')}`)
  const filesDir = join(dir, 'files')
  mkdirSync(filesDir, { recursive: true })
  const clock = { t: start }
  const repo = openTestRepository(':memory:', { clock: () => ++clock.t })
  const secrets: { value: string | null } = { value: null }
  const store: SecretStore = { load: () => secrets.value, save: (value) => void (secrets.value = value) }
  const keyStore = { available: true }
  // A stand-in for the OS key store: reversible, and nothing like the plain text.
  const cipher: Cipher = {
    isAvailable: () => keyStore.available,
    encrypt: (text) => Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a)),
    decrypt: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString('utf8')
  }
  const calendars = new CalendarStore(
    join(dir, 'briefing', 'calendars.bin'),
    cipher,
    () => ({}),
    () => ++clock.t
  )
  const forgotten: string[] = []
  const self: Device = {
    name,
    repo,
    dir,
    filesDir,
    clock,
    applied: 0,
    statuses: [],
    spawns: [],
    hook: null,
    secrets,
    calendars,
    keyStore,
    forgotten,
    engine: null as unknown as SyncEngine,
    setup: (remote, extra = {}) => self.engine.setup({ remoteUrl: remote, deviceName: name, ...extra }),
    page: (title, parentId = null) => repo.create({ type: 'page', parentId, props: { title: [[title]] } }),
    text: (parentId, text) => repo.create({ type: 'text', parentId, props: { title: [[text]] } }),
    titles: () => repo.listRoot().map((b) => plain(b.props.title)),
    texts: (pageId) =>
      repo
        .getTree(pageId)
        .slice(1)
        .map((b) => plain(b.props.title))
  }
  self.engine = new SyncEngine({
    repo,
    dir: join(dir, 'sync'),
    filesDir,
    hostName: name,
    allowLocal: true,
    secrets: store,
    acceptImage: (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50,
    clock: () => ++clock.t,
    onApplied: () => {
      self.applied++
      repo.drainChanges()
    },
    onStatus: (status) => self.statuses.push(status),
    calendars: async () => calendarSync(calendars, { forget: (id) => void forgotten.push(id) }, () => undefined),
    onSpawn: (args, env) => self.spawns.push({ args, env }),
    beforeStep: (step) => self.hook?.(step),
    backoffMs: 5,
    kdfCost: KDF
  })
  return self
}

export async function sync(...devices: Device[]): Promise<void> {
  for (const d of devices) {
    const status = await d.engine.now()
    expect(status.lastError, `${d.name}: ${status.lastError?.code} ${status.lastError?.message}`).toBeUndefined()
    expect(status.state).toBe('idle')
  }
}

/** Two devices on one remote, each showing the same page with three paragraphs. */
export async function pair(): Promise<{ remote: string; a: Device; b: Device; pageId: string; blocks: string[] }> {
  const remote = bareRemote()
  const a = device('Device A', 1_000_000)
  const b = device('Device B', 2_000_000)
  const page = a.page('Shared page')
  const blocks = ['one', 'two', 'three'].map((text) => a.text(page.id, text).id)
  expect((await a.setup(remote)).lastError).toBeUndefined()
  expect((await b.setup(remote)).lastError).toBeUndefined()
  return { remote, a, b, pageId: page.id, blocks }
}
