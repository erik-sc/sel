/**
 * The start-up whose database does not open: what the person is told, and what comes back, with
 * a good backup, with only a damaged one, and with a backups folder that cannot be read.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_COPY } from '../../shared/dataCopy'
import type { SqlDriver } from '../db/driver'
import { openTestRepository } from '../db/testing'
import { backupName } from './backups'

const answers: number[] = []
const shown: { message?: string; detail?: string }[] = []
vi.mock('electron', () => ({
  app: { whenReady: async () => undefined, getLocale: () => 'en-US' },
  dialog: {
    showMessageBox: vi.fn(async (options: { message?: string; detail?: string }) => {
      shown.push(options)
      return { response: answers.shift() ?? 0 }
    }),
    showErrorBox: vi.fn()
  },
  shell: { openPath: vi.fn(async () => '') }
}))
// The app's drivers are native; the tests open the same files with node:sqlite.
vi.mock('./register', () => ({
  openReadOnly: (file: string) => new DatabaseSync(file, { readOnly: true }) as unknown as SqlDriver
}))
vi.mock('../db', () => ({ openDatabase: (file: string) => openTestRepository(file) }))

const { recoverDatabase } = await import('./startup')

const ROOT = mkdtempSync(join(tmpdir(), 'sel-startup-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
let serial = 0
const folder = (): string => {
  const dir = join(ROOT, `case-${++serial}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const words = DATA_COPY.en
const damage = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' })

/** A damaged `sel.db` in a fresh profile folder. */
function damagedProfile(): string {
  const userData = folder()
  writeFileSync(join(userData, 'sel.db'), 'not a database')
  return userData
}

function goodCopy(title: string): Buffer {
  const file = join(folder(), 'sel.db')
  const repo = openTestRepository(file)
  repo.create({ type: 'page', parentId: null, props: { title: [[title]] } })
  repo.close()
  return readFileSync(file)
}

beforeEach(() => {
  answers.length = 0
  shown.length = 0
})

describe('a start-up whose database is damaged', () => {
  it('offers the good backup and, when taken, opens it and keeps the damaged file', async () => {
    const userData = damagedProfile()
    mkdirSync(join(userData, 'backups'))
    writeFileSync(join(userData, 'backups', backupName(Date.now() - 60_000, 'auto')), goodCopy('Kept'))
    answers.push(0)
    const repo = await recoverDatabase(damage, userData)
    expect(shown[0].detail).toContain('There is a backup from')
    expect(repo?.listRoot().map((b) => b.props.title?.[0]?.[0])).toEqual(['Kept'])
    repo?.close()
    expect(readdirSync(userData).some((name) => name.startsWith('sel.db.damaged-'))).toBe(true)
  })

  it('says there is no backup when the only one is damaged too', async () => {
    const userData = damagedProfile()
    mkdirSync(join(userData, 'backups'))
    writeFileSync(join(userData, 'backups', backupName(Date.now(), 'auto')), 'damaged as well')
    answers.push(1)
    expect(await recoverDatabase(damage, userData)).toBeNull()
    expect(shown[0].detail).toBe(words.damagedWithoutBackup(userData))
    expect(readFileSync(join(userData, 'sel.db'), 'utf8')).toBe('not a database')
  })

  it('tells an unreadable backups folder from an empty one', async () => {
    const userData = damagedProfile()
    // There, but not a folder that can be listed.
    writeFileSync(join(userData, 'backups'), 'a file where the folder should be')
    answers.push(1)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await recoverDatabase(damage, userData)).toBeNull()
    logged.mockRestore()
    expect(shown[0].detail).toBe(words.damagedBackupsUnreadable(join(userData, 'backups')))
    expect(shown[0].detail).not.toBe(words.damagedWithoutBackup(userData))
    expect(existsSync(join(userData, 'sel.db'))).toBe(true)
  })

  it('says there is no backup when the folder was never made', async () => {
    const userData = damagedProfile()
    answers.push(1)
    expect(await recoverDatabase(damage, userData)).toBeNull()
    expect(shown[0].detail).toBe(words.damagedWithoutBackup(userData))
  })
})
