/**
 * The guided restore (release 0.8.0, F3): what differs between a backup and now, bringing back
 * one page without touching anything else, restoring everything only after a backup of now, and
 * the check of the database at start. Real files throughout, on node:sqlite.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import type { Block } from '../../shared/types'
import type { SqlDriver } from '../db/driver'
import type { Repository } from '../db/repository'
import { openTestDatabase } from '../db/testing'
import { checkIntegrity, findBackups, inspectDatabase, type ReadOnlyOpener, STAGED_FILE, stageRestore, takeBackup } from './backups'
import { compareFiles } from './compare'
import { readBackupPages } from './pageRestore'
import { restoreAllSteps, restorePageSteps } from './restoreSteps'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-restore-'))
/** Every database a test opened: closed at the end even when the test failed, so the folder can go. */
const opened: Repository[] = []
afterAll(() => {
  for (const repo of opened) {
    try {
      repo.close()
    } catch {
      /* closed by the test */
    }
  }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
let serial = 0
const folder = (): string => {
  const dir = join(ROOT, `case-${++serial}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const open: ReadOnlyOpener = (file) => new DatabaseSync(file, { readOnly: true })

interface Live {
  dir: string
  file: string
  repo: Repository
  db: SqlDriver
}

function live(): Live {
  const dir = folder()
  const file = join(dir, 'sel.db')
  const { repo, db } = openTestDatabase(file)
  opened.push(repo)
  return { dir, file, repo, db }
}

/** A copy of the database as it is now, the way a backup is made. */
function backUpNow(w: Live, name = 'backup.db'): string {
  const file = join(w.dir, name)
  w.repo.copyTo(file)
  return file
}

const page = (repo: Repository, title: string, parentId: string | null = null): Block =>
  repo.create({ type: 'page', parentId, props: { title: [[title]] } })
const text = (repo: Repository, parentId: string, words: string): Block =>
  repo.create({ type: 'text', parentId, props: { title: [[words]] } })
const words = (repo: Repository, id: string): string => repo.get(id)?.props.title?.[0]?.[0] ?? ''
const titleOf = (b: Block | null): string => b?.props.title?.[0]?.[0] ?? ''

/** Every stored row, as it is: the proof that a restore wrote nothing it should not have. */
function rows(db: SqlDriver, except: readonly string[] = []): unknown[] {
  return (db.prepare('SELECT * FROM blocks ORDER BY id').all() as { id: string }[]).filter((r) => !except.includes(r.id))
}

/** The pages of a backup, read the way the app reads them. */
function fromBackup(file: string, pageId: string, withSubpages: boolean) {
  const db = open(file)
  try {
    return readBackupPages(db, pageId, withSubpages)
  } finally {
    db.close()
  }
}

/** Restores one page the way the app does, with a backup of now that only counts. */
async function restoreOne(w: Live, backup: string, pageId: string, withSubpages = false) {
  let backups = 0
  const result = await restorePageSteps({
    read: () => fromBackup(backup, pageId, withSubpages),
    backUp: async () => {
      backups++
    },
    apply: (pages) => w.repo.restoreFromBackup(pages, Date.now(), withSubpages)
  })
  return { result, backups }
}

describe('what differs between a backup and now', () => {
  it('lists the pages deleted, changed and made since, by title, with whole counts', () => {
    const w = live()
    const gone = page(w.repo, 'Gone')
    const edited = page(w.repo, 'Edited')
    const line = text(w.repo, edited.id, 'before')
    const kept = page(w.repo, 'Kept')
    text(w.repo, kept.id, 'never touched')
    const inner = page(w.repo, 'Inner', kept.id)
    const db = w.repo.create({ type: 'database', parentId: null, props: { title: [['Books']] } })
    const row = page(w.repo, 'Dune', db.id)
    const backup = backUpNow(w)

    w.repo.update(line.id, { props: { title: [['after']] } })
    w.repo.delete(gone.id)
    page(w.repo, 'Fresh')
    // A row edited is its database changed; the row is not a page of its own in the list.
    w.repo.update(row.id, { props: { title: [['Dune Messiah']] } })

    const result = compareFiles(open, backup, w.file)
    expect(result.counts).toEqual({ 'only-backup': 1, changed: 2, 'only-now': 1, same: 2 })
    expect(result.pages).toBe(5)
    expect(result.differences.map((d) => [d.change, d.title, d.kind])).toEqual([
      ['only-backup', 'Gone', 'page'],
      ['changed', 'Books', 'database'],
      ['changed', 'Edited', 'page'],
      ['only-now', 'Fresh', 'page']
    ])
    w.repo.update(inner.id, { props: { title: [['Inner, renamed']] } })
    const again = compareFiles(open, backup, w.file)
    const renamed = again.differences.find((d) => d.id === inner.id)
    expect(renamed).toMatchObject({ change: 'changed', title: 'Inner, renamed', path: ['Kept'] })
    // What "with the pages below it" would bring back.
    expect(again.differences.find((d) => d.id === gone.id)?.subpages).toBe(0)
    w.repo.close()
  })

  it('reads a page edited and edited back as the same', () => {
    const w = live()
    const p = page(w.repo, 'Notes')
    const line = text(w.repo, p.id, 'one')
    const backup = backUpNow(w)
    w.repo.update(line.id, { props: { title: [['two']] } })
    w.repo.update(line.id, { props: { title: [['one']] } })
    expect(compareFiles(open, backup, w.file).counts).toEqual({ 'only-backup': 0, changed: 0, 'only-now': 0, same: 1 })
    w.repo.close()
  })
})

describe('restoring one page', () => {
  it('brings that page back and leaves every other row exactly as it was', async () => {
    const w = live()
    const a = page(w.repo, 'A')
    const aLine = text(w.repo, a.id, 'a1')
    const sub = page(w.repo, 'A1', a.id)
    const subLine = text(w.repo, sub.id, 'x1')
    const b = page(w.repo, 'B')
    const bLine = text(w.repo, b.id, 'b1')
    const backup = backUpNow(w)

    w.repo.update(aLine.id, { props: { title: [['a2']] } })
    w.repo.update(subLine.id, { props: { title: [['x2']] } })
    w.repo.update(bLine.id, { props: { title: [['b2']] } })
    const since = page(w.repo, 'Made since', a.id)
    const before = rows(w.db, [a.id, aLine.id])

    const { result, backups } = await restoreOne(w, backup, a.id)
    expect(result).toMatchObject({ outcome: 'restored', pageId: a.id, pages: 1 })
    expect(backups).toBe(1)
    expect(words(w.repo, aLine.id)).toBe('a1')
    // Not even the pages inside it, nor the one made since: only the page itself.
    expect(rows(w.db, [a.id, aLine.id])).toEqual(before)
    expect(words(w.repo, subLine.id)).toBe('x2')
    expect(words(w.repo, bLine.id)).toBe('b2')
    expect(w.repo.get(a.id)?.content).toEqual([aLine.id, sub.id, since.id])
    // The page keeps a version of what it was, as a restored version does.
    expect(w.repo.listVersions(a.id).some((v) => v.kind === 'restore')).toBe(true)
    w.repo.close()
  })

  it('with the pages below it, brings those back too', async () => {
    const w = live()
    const a = page(w.repo, 'A')
    const sub = page(w.repo, 'A1', a.id)
    const subLine = text(w.repo, sub.id, 'x1')
    const backup = backUpNow(w)
    w.repo.update(subLine.id, { props: { title: [['x2']] } })
    const { result } = await restoreOne(w, backup, a.id, true)
    expect(result).toMatchObject({ outcome: 'restored', pages: 2 })
    expect(words(w.repo, subLine.id)).toBe('x1')
    w.repo.close()
  })

  it('leaves alone a page moved out of it since, unless the pages below are asked for', async () => {
    const w = live()
    const a = page(w.repo, 'A')
    const sub = page(w.repo, 'A1', a.id)
    const b = page(w.repo, 'B')
    const backup = backUpNow(w)
    w.repo.move(sub.id, b.id)
    await restoreOne(w, backup, a.id)
    expect(w.repo.get(sub.id)?.parentId).toBe(b.id)
    await restoreOne(w, backup, a.id, true)
    expect(w.repo.get(sub.id)?.parentId).toBe(a.id)
    expect(w.repo.get(b.id)?.content).toEqual([])
    w.repo.close()
  })

  it('brings back a page deleted for good, under its own ids and where it was', async () => {
    const w = live()
    const parent = page(w.repo, 'Projects')
    const gone = page(w.repo, 'Plan', parent.id)
    const line = text(w.repo, gone.id, 'step one')
    const inner = page(w.repo, 'Details', gone.id)
    const backup = backUpNow(w)
    w.repo.deleteForever(gone.id)
    expect(w.repo.get(gone.id)).toBeNull()

    const { result } = await restoreOne(w, backup, gone.id, true)
    expect(result).toMatchObject({ outcome: 'restored', pageId: gone.id, pages: 2 })
    expect(w.repo.get(gone.id)?.parentId).toBe(parent.id)
    expect(w.repo.get(parent.id)?.content).toEqual([gone.id])
    expect(w.repo.get(gone.id)?.content).toEqual([line.id, inner.id])
    expect(words(w.repo, line.id)).toBe('step one')
    expect(titleOf(w.repo.get(inner.id))).toBe('Details')
    expect(w.repo.search('step').map((r) => r.pageId)).toContain(gone.id)
    w.repo.close()
  })

  it('takes a page out of the Trash, and brings back the rows of a database deleted since', async () => {
    const w = live()
    const db = w.repo.create({ type: 'database', parentId: null, props: { title: [['Books']] } })
    const kept = page(w.repo, 'Dune', db.id)
    const lost = page(w.repo, 'Emma', db.id)
    text(w.repo, lost.id, 'a note on Emma')
    const backup = backUpNow(w)
    w.repo.deleteForever(lost.id)
    w.repo.update(kept.id, { props: { title: [['Dune (renamed)']] } })
    w.repo.delete(db.id)

    const { result } = await restoreOne(w, backup, db.id)
    expect(result.outcome).toBe('restored')
    expect(w.repo.get(db.id)?.trashedAt).toBeNull()
    expect(w.repo.get(db.id)?.content).toEqual([kept.id, lost.id])
    expect(titleOf(w.repo.get(kept.id))).toBe('Dune')
    expect(titleOf(w.repo.get(lost.id))).toBe('Emma')
    expect(w.repo.getTree(lost.id).length).toBe(2)
    w.repo.close()
  })

  it('says so for a page that is not in the backup, and backs up nothing for it', async () => {
    const w = live()
    const backup = backUpNow(w)
    const fresh = page(w.repo, 'Fresh')
    const { result, backups } = await restoreOne(w, backup, fresh.id)
    expect(result).toEqual({ outcome: 'refused', problem: 'not-in-backup' })
    expect(backups).toBe(0)
    w.repo.close()
  })

  it('writes nothing when everything could not be backed up first', async () => {
    const w = live()
    const a = page(w.repo, 'A')
    const line = text(w.repo, a.id, 'one')
    const backup = backUpNow(w)
    w.repo.update(line.id, { props: { title: [['two']] } })
    const result = await restorePageSteps({
      read: () => fromBackup(backup, a.id, false),
      backUp: () => Promise.reject(new Error('disk full')),
      apply: (pages) => w.repo.restoreFromBackup(pages, Date.now(), false)
    })
    expect(result).toEqual({ outcome: 'refused', problem: 'backup-failed' })
    expect(words(w.repo, line.id)).toBe('two')
    w.repo.close()
  })
})

describe('restoring everything', () => {
  /** The app's steps on real files: a before-restore backup in `backups`, the chosen one staged in `dir`. */
  function steps(w: Live, chosen: string, calls: string[], over: { busy?: boolean; failBackup?: boolean; damaged?: boolean } = {}) {
    const backups = join(w.dir, 'backups')
    return {
      backups,
      run: () =>
        restoreAllSteps(
          {
            busy: () => over.busy ?? false,
            inspect: async () => inspectDatabase(open, chosen),
            backUp: async () => {
              calls.push('backup')
              if (over.failBackup) throw new Error('could not copy')
              takeBackup({ source: w.repo, dir: backups, kind: 'before-restore', now: Date.now(), open })
            },
            damaged: () => over.damaged ?? false,
            stage: () => {
              calls.push('stage')
              stageRestore(w.dir, chosen)
            },
            restart: () => calls.push('restart')
          },
          () => undefined
        )
    }
  }

  it('backs up everything as it is now before the chosen backup is put in place', async () => {
    const w = live()
    page(w.repo, 'Then')
    const chosen = backUpNow(w)
    page(w.repo, 'Since')
    const calls: string[] = []
    const { backups, run } = steps(w, chosen, calls)
    expect(await run()).toEqual({ outcome: 'restarting' })
    expect(calls).toEqual(['backup', 'stage', 'restart'])
    const made = findBackups(backups)
    expect(made.map((b) => b.kind)).toEqual(['before-restore'])
    // That backup holds what is here now: the restore can be undone with it.
    expect(compareFiles(open, made[0].path, w.file).counts.same).toBe(2)
    expect(readFileSync(join(w.dir, STAGED_FILE)).equals(readFileSync(chosen))).toBe(true)
    w.repo.close()
  })

  it('puts nothing in place when now could not be backed up, unless the database is damaged', async () => {
    const w = live()
    const chosen = backUpNow(w)
    const calls: string[] = []
    expect(await steps(w, chosen, calls, { failBackup: true }).run()).toEqual({ outcome: 'refused', problem: 'backup-failed' })
    expect(existsSync(join(w.dir, STAGED_FILE))).toBe(false)
    expect(await steps(w, chosen, calls, { failBackup: true, damaged: true }).run()).toEqual({ outcome: 'restarting' })
    expect(existsSync(join(w.dir, STAGED_FILE))).toBe(true)
    w.repo.close()
  })

  it('refuses a damaged file and waits for a recording to end', async () => {
    const w = live()
    const junk = join(w.dir, 'junk.db')
    writeFileSync(junk, 'not a database at all, only some words that fill a header or two.'.repeat(4))
    const calls: string[] = []
    expect(await steps(w, junk, calls).run()).toEqual({ outcome: 'invalid', problem: 'damaged' })
    expect(await steps(w, backUpNow(w), calls, { busy: true }).run()).toEqual({ outcome: 'refused', problem: 'busy' })
    expect(calls).toEqual([])
    w.repo.close()
  })
})

describe('the check of the database at start', () => {
  it('passes a sound database and finds a damaged one', () => {
    const w = live()
    for (let i = 0; i < 200; i++) text(w.repo, page(w.repo, `Page ${i}`).id, 'some words to fill the pages of the file '.repeat(10))
    w.repo.close()
    expect(checkIntegrity(open, w.file)).toBe('ok')

    // Damage the middle of the file, past the header and the schema: the tables' pages.
    const bytes = readFileSync(w.file)
    const pageSize = bytes.readUInt16BE(16)
    for (let p = 3; p < Math.floor(bytes.length / pageSize) - 1; p += 2) bytes.fill(0x5a, p * pageSize + 8, p * pageSize + 200)
    const damaged = join(w.dir, 'damaged.db')
    writeFileSync(damaged, bytes)
    expect(checkIntegrity(open, damaged)).toBe('damaged')

    const junk = join(w.dir, 'junk.db')
    writeFileSync(junk, 'this is not a database, only some text that is long enough to have a header.'.repeat(4))
    expect(checkIntegrity(open, junk)).toBe('damaged')
    expect(checkIntegrity(open, join(w.dir, 'missing.db'))).toBe('unreadable')
  })
})
