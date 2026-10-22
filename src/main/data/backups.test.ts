/**
 * Backups of the database: their names, the rotation, the check a copy must pass, and the two
 * ways a backup comes back (a restore chosen in Settings, and a start-up whose database is damaged).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { openTestRepository } from '../db/testing'
import {
  applyStagedRestore,
  BackupError,
  backupName,
  backupsToKeep,
  copyAndCheck,
  inspectDatabase,
  isDamageError,
  isNewerError,
  listBackups,
  newestGoodBackup,
  parseBackupName,
  REPLACED_FILE,
  restoreOverDamaged,
  stageRestore,
  takeBackup,
  takeBackupApart,
  type ReadOnlyOpener
} from './backups'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-backups-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
let serial = 0
const folder = (): string => {
  const dir = join(ROOT, `case-${++serial}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const open: ReadOnlyOpener = (file) => new DatabaseSync(file, { readOnly: true })
const plenty = (): number => 1e12
const DAY = 24 * 60 * 60 * 1000
const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime()

/** A workspace in `dir/sel.db` with `titles` as root pages; closed again, as the app leaves it. */
function workspace(dir: string, titles: string[]): string {
  const file = join(dir, 'sel.db')
  const repo = openTestRepository(file)
  for (const title of titles) repo.create({ type: 'page', parentId: null, props: { title: [[title]] } })
  repo.close()
  return file
}

function titlesIn(file: string): string[] {
  const repo = openTestRepository(file)
  try {
    return repo.listRoot().map((b) => b.props.title?.[0]?.[0] ?? '')
  } finally {
    repo.close()
  }
}

describe('backup names', () => {
  it('carry the local time and how the backup was made, and nothing else is one', () => {
    const when = at(2026, 10, 18, 9, 12) + 33_000
    expect(backupName(when, 'auto')).toBe('sel-2026-10-18-091233.db')
    expect(backupName(when, 'manual')).toBe('sel-2026-10-18-091233-manual.db')
    expect(backupName(when, 'before-restore')).toBe('sel-2026-10-18-091233-before-restore.db')
    expect(parseBackupName('sel-2026-10-18-091233-before-restore.db')).toEqual({ at: when, kind: 'before-restore' })
    for (const other of ['sel.db', 'sel-2026-10-18.db', 'sel-2026-02-31-091233.db', 'sel-2026-10-18-091233-other.db', 'notes.md']) {
      expect(parseBackupName(other)).toBeNull()
    }
  })
})

describe('the rotation', () => {
  const entry = (when: number, kind: 'auto' | 'manual' | 'before-restore' = 'auto') => ({ name: backupName(when, kind), at: when, kind })

  it('keeps the newest of each of the last three days, then one a week for three weeks', () => {
    const now = at(2026, 10, 30, 20)
    const list = Array.from({ length: 40 }, (_, i) => entry(at(2026, 10, 30, 9) - i * DAY))
    // Two more today: only the newest of the day is kept.
    list.push(entry(at(2026, 10, 30, 15), 'manual'), entry(at(2026, 10, 30, 16), 'manual'))
    const kept = [...backupsToKeep(list, now)].map((name) => parseBackupName(name)!.at).sort((a, b) => b - a)
    expect(kept.map((t) => new Date(t).getDate())).toEqual([30, 29, 28, 21, 14, 7])
    expect(new Date(kept[0]).getHours()).toBe(16)
  })

  it('counts days that have a backup, not calendar days', () => {
    const list = [entry(at(2026, 10, 30)), entry(at(2026, 10, 20)), entry(at(2026, 10, 10)), entry(at(2026, 10, 2)), entry(at(2026, 10, 1))]
    expect(backupsToKeep(list, at(2026, 10, 30, 20)).size).toBe(4)
  })

  it('keeps what a restore replaced for a week, whatever else is made', () => {
    const now = at(2026, 10, 30, 20)
    const replaced = entry(at(2026, 10, 25), 'before-restore')
    const old = entry(at(2026, 10, 10), 'before-restore')
    const list = [replaced, old, ...Array.from({ length: 5 }, (_, i) => entry(at(2026, 10, 30) - i * DAY))]
    const kept = backupsToKeep(list, now)
    expect(kept.has(replaced.name)).toBe(true)
    expect(kept.has(old.name)).toBe(false)
  })
})

describe('taking a backup', () => {
  it('writes a checked copy of everything committed and prunes the old ones', () => {
    const dir = folder()
    const repo = openTestRepository(join(dir, 'sel.db'))
    repo.create({ type: 'page', parentId: null, props: { title: [['Kept']] } })
    const backups = join(dir, 'backups')
    // Two weeks of daily backups already there, and a file that is not one.
    mkdirSync(backups)
    for (let i = 1; i <= 14; i++) writeFileSync(join(backups, backupName(Date.now() - i * DAY, 'auto')), 'old')
    writeFileSync(join(backups, 'notes.txt'), 'mine')

    const made = takeBackup({ source: repo, dir: backups, kind: 'auto', now: Date.now(), open, freeBytes: plenty })
    repo.close()

    expect(made.kind).toBe('auto')
    expect(titlesIn(made.path)).toEqual(['Kept'])
    expect(inspectDatabase(open, made.path)).toMatchObject({ ok: true, pages: 1 })
    const left = listBackups(backups)
    expect(left[0].name).toBe(made.name)
    expect(left.length).toBeLessThanOrEqual(6)
    expect(readFileSync(join(backups, 'notes.txt'), 'utf8')).toBe('mine')
    expect(readdirSync(backups).some((name) => name.endsWith('.partial'))).toBe(false)
  })

  it('never takes the name of one made in the same second', () => {
    const dir = folder()
    const repo = openTestRepository(join(dir, 'sel.db'))
    const now = Date.now()
    const a = takeBackup({ source: repo, dir, kind: 'manual', now, open, freeBytes: plenty })
    const b = takeBackup({ source: repo, dir, kind: 'manual', now, open, freeBytes: plenty })
    repo.close()
    expect(a.name).not.toBe(b.name)
    // The rotation keeps the newest of the day.
    expect(listBackups(dir).map((backup) => backup.name)).toEqual([b.name])
  })

  it('does not try without room on the disk', () => {
    const dir = folder()
    const repo = openTestRepository(join(dir, 'sel.db'))
    expect(() => takeBackup({ source: repo, dir, kind: 'auto', now: Date.now(), open, freeBytes: () => 1000 })).toThrow(
      expect.objectContaining({ problem: 'disk-full' })
    )
    repo.close()
    expect(listBackups(dir)).toEqual([])
  })

  it('discards a copy that fails its check, and keeps the earlier ones', () => {
    const dir = folder()
    const earlier = join(dir, backupName(Date.now() - DAY, 'auto'))
    writeFileSync(earlier, 'an earlier backup')
    const broken = { copyTo: (file: string) => writeFileSync(file, 'x'.repeat(4096)), byteSize: () => 4096 }
    let error: unknown
    try {
      takeBackup({ source: broken, dir, kind: 'auto', now: Date.now(), open, freeBytes: plenty })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(BackupError)
    expect((error as BackupError).problem).toBe('damaged')
    expect(readdirSync(dir)).toEqual([earlier.slice(dir.length + 1)])
  })

  it('says the disk is full when the copy runs out of room', () => {
    const dir = folder()
    const full = {
      copyTo: () => {
        throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' })
      },
      byteSize: () => 0
    }
    expect(() => takeBackup({ source: full, dir, kind: 'auto', now: Date.now(), open, freeBytes: plenty })).toThrow(
      expect.objectContaining({ problem: 'disk-full' })
    )
  })
})

describe('taking a backup apart from the main process', () => {
  // In the app `work` is a utility process running copyAndCheck (./backupWorker.ts); here it runs in place.
  const work = async (file: string, partial: string) => copyAndCheck(open, file, partial)

  it('makes the same checked, named and pruned copy as takeBackup', async () => {
    const dir = folder()
    const file = join(dir, 'sel.db')
    const repo = openTestRepository(file)
    repo.create({ type: 'page', parentId: null, props: { title: [['Kept']] } })
    const backups = join(dir, 'backups')
    mkdirSync(backups)
    for (let i = 1; i <= 14; i++) writeFileSync(join(backups, backupName(Date.now() - i * DAY, 'auto')), 'old')
    const made = await takeBackupApart({ source: repo, file, dir: backups, kind: 'auto', now: Date.now(), work, freeBytes: plenty })
    repo.close()
    expect(made.kind).toBe('auto')
    expect(titlesIn(made.path)).toEqual(['Kept'])
    expect(inspectDatabase(open, made.path)).toMatchObject({ ok: true, pages: 1 })
    const left = listBackups(backups)
    expect(left[0].name).toBe(made.name)
    expect(left.length).toBeLessThanOrEqual(6)
    expect(readdirSync(backups).some((name) => name.endsWith('.partial'))).toBe(false)
  })

  it('copies what is committed while the app goes on writing, without holding it up', () => {
    const dir = folder()
    const file = join(dir, 'sel.db')
    const repo = openTestRepository(file)
    repo.create({ type: 'page', parentId: null, props: { title: [['Committed']] } })
    const partial = join(dir, '.copy.partial')
    // The copy is made on its own connection while the app's write transaction is open.
    repo.transaction(() => {
      repo.create({ type: 'page', parentId: null, props: { title: [['Not yet']] } })
      expect(copyAndCheck(open, file, partial)).toMatchObject({ ok: true, pages: 1 })
    })
    expect(repo.listRoot()).toHaveLength(2)
    repo.close()
    expect(titlesIn(partial)).toEqual(['Committed'])
  })

  it('says what went wrong and leaves no partial copy behind', async () => {
    const dir = folder()
    const earlier = join(dir, backupName(Date.now() - DAY, 'auto'))
    writeFileSync(earlier, 'an earlier backup')
    const source = { byteSize: () => 0 }
    const attempt = (fail: (partial: string) => Promise<never> | Promise<{ ok: false; problem: 'damaged' }>) =>
      takeBackupApart({
        source,
        file: 'unused',
        dir,
        kind: 'auto',
        now: Date.now(),
        work: (_file, partial) => fail(partial),
        freeBytes: plenty
      })
    await expect(
      attempt(async (partial) => {
        writeFileSync(partial, 'half a copy')
        throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' })
      })
    ).rejects.toMatchObject({ problem: 'disk-full' })
    await expect(attempt(async () => ({ ok: false, problem: 'damaged' }))).rejects.toMatchObject({ problem: 'damaged' })
    await expect(
      attempt(async () => {
        throw new Error('The backup process stopped before answering (1)')
      })
    ).rejects.toMatchObject({ problem: 'failed' })
    await expect(
      takeBackupApart({ source, file: 'unused', dir, kind: 'auto', now: Date.now(), work, freeBytes: () => 1000 })
    ).rejects.toBeInstanceOf(BackupError)
    expect(readdirSync(dir)).toEqual([earlier.slice(dir.length + 1)])
  })
})

describe('checking a file before it is restored', () => {
  it('accepts a sel database and says what it holds: pages and databases, not their rows', () => {
    const dir = folder()
    const file = join(dir, 'sel.db')
    const repo = openTestRepository(file)
    repo.create({ type: 'page', parentId: null, props: { title: [['One']] } })
    const db = repo.create({ type: 'database', parentId: null, props: { title: [['Tasks']] } })
    for (const task of ['a', 'b', 'c']) repo.create({ type: 'page', parentId: db.id, props: { title: [[task]] } })
    repo.close()
    const check = inspectDatabase(open, file)
    expect(check).toMatchObject({ ok: true, pages: 2 })
    expect(check.ok && check.lastEdit).toBeGreaterThan(0)
  })

  it('refuses other files: not SQLite, another SQLite file, a newer sel, a damaged one', () => {
    const dir = folder()
    const junk = join(dir, 'junk.db')
    writeFileSync(junk, 'this is not a database, only some text that is long enough to have a header.'.repeat(4))
    expect(inspectDatabase(open, junk)).toEqual({ ok: false, problem: 'damaged' })

    const other = join(dir, 'other.db')
    const db = new DatabaseSync(other)
    db.exec('CREATE TABLE things (x)')
    db.close()
    expect(inspectDatabase(open, other)).toEqual({ ok: false, problem: 'not-sel' })

    const newer = workspace(folder(), ['Later'])
    const raw = new DatabaseSync(newer)
    raw.exec('PRAGMA user_version = 999')
    raw.close()
    expect(inspectDatabase(open, newer)).toEqual({ ok: false, problem: 'newer' })

    expect(inspectDatabase(open, join(dir, 'missing.db'))).toEqual({ ok: false, problem: 'unreadable' })
  })

  it('tells damage and a newer schema apart from other failures', () => {
    expect(isDamageError(Object.assign(new Error('x'), { code: 'SQLITE_NOTADB' }))).toBe(true)
    expect(isDamageError(new Error('database disk image is malformed'))).toBe(true)
    expect(isDamageError(new Error('EBUSY: resource busy or locked'))).toBe(false)
    expect(isNewerError(new Error('Database schema version 9 is newer than this app supports (5)'))).toBe(true)
    expect(isNewerError(new Error('file is not a database'))).toBe(false)
  })
})

describe('a restore chosen in Settings', () => {
  it('waits for the next start, then replaces the database and keeps the replaced one', () => {
    const userData = folder()
    workspace(userData, ['Now'])
    const backupDir = folder()
    const backup = workspace(backupDir, ['Then'])

    stageRestore(userData, backup)
    expect(titlesIn(join(userData, 'sel.db'))).toEqual(['Now'])

    expect(applyStagedRestore(userData)).toBe(true)
    expect(titlesIn(join(userData, 'sel.db'))).toEqual(['Then'])
    expect(titlesIn(join(userData, REPLACED_FILE))).toEqual(['Now'])
    // Once: the next start finds nothing staged.
    expect(applyStagedRestore(userData)).toBe(false)
    expect(titlesIn(join(userData, 'sel.db'))).toEqual(['Then'])
  })

  it('moves the journal files with the database they belong to', () => {
    const userData = folder()
    writeFileSync(join(userData, 'sel.db'), 'db')
    writeFileSync(join(userData, 'sel.db-wal'), 'wal')
    writeFileSync(join(userData, `${REPLACED_FILE}-shm`), 'stale')
    writeFileSync(join(userData, 'sel.db.restore'), 'backup')
    applyStagedRestore(userData)
    expect(readFileSync(join(userData, 'sel.db'), 'utf8')).toBe('backup')
    expect(existsSync(join(userData, 'sel.db-wal'))).toBe(false)
    expect(readFileSync(join(userData, `${REPLACED_FILE}-wal`), 'utf8')).toBe('wal')
    expect(existsSync(join(userData, `${REPLACED_FILE}-shm`))).toBe(false)
  })
})

describe('a start-up whose database cannot be opened', () => {
  it('finds the newest backup that passes its check', () => {
    const userData = folder()
    const backups = join(userData, 'backups')
    mkdirSync(backups)
    const good = workspace(folder(), ['Good'])
    writeFileSync(join(backups, backupName(Date.now() - DAY, 'auto')), readFileSync(good))
    writeFileSync(join(backups, backupName(Date.now(), 'auto')), 'damaged, and newer')
    const found = newestGoodBackup(backups, open)
    expect(found?.pages).toBe(1)
    expect(found?.file.at).toBeLessThan(Date.now() - DAY + 1000)
    expect(newestGoodBackup(join(userData, 'nothing'), open)).toBeNull()
  })

  it('puts the damaged files aside, never deleting them, and the backup in their place', () => {
    const userData = folder()
    writeFileSync(join(userData, 'sel.db'), 'damaged')
    writeFileSync(join(userData, 'sel.db-wal'), 'its journal')
    const backup = workspace(folder(), ['Restored'])
    const now = at(2026, 10, 18, 9, 12)
    const aside = restoreOverDamaged(userData, backup, now)
    expect(aside).toBe('sel.db.damaged-20261018-091200')
    expect(readFileSync(join(userData, aside), 'utf8')).toBe('damaged')
    expect(readFileSync(join(userData, `${aside}-wal`), 'utf8')).toBe('its journal')
    expect(existsSync(join(userData, 'sel.db-wal'))).toBe(false)
    expect(titlesIn(join(userData, 'sel.db'))).toEqual(['Restored'])
  })
})

describe('the copy the repository makes', () => {
  it('is refused inside a transaction, and the size it needs is known', () => {
    const dir = folder()
    const repo = openTestRepository(join(dir, 'sel.db'))
    expect(repo.byteSize()).toBeGreaterThan(0)
    expect(() => repo.transaction(() => repo.copyTo(join(dir, 'copy.db')))).toThrow(/transaction/)
    repo.copyTo(join(dir, 'copy.db'))
    repo.close()
    expect(inspectDatabase(open, join(dir, 'copy.db'))).toMatchObject({ ok: true, pages: 0 })
  })
})
