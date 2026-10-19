import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupEntry, BackupFileProblem, BackupKind, BackupProblem } from '../../shared/data'
import type { SqlDriver } from '../db/driver'
import { SCHEMA_VERSION } from '../db/schema'
import { DB_FILE } from '../legacy'

/**
 * Backups: copies of the database kept on this computer, in `<userData>/backups`.
 *
 * A copy is made with `VACUUM INTO` (one ordinary, compact file holding everything committed,
 * WAL included), written under a temporary name, opened again and checked, and only then given
 * its real name: a copy that fails its check never counts, and never pushes a good one out.
 * Images are not copied: they are written once under a unique name and never changed, so the
 * database is what needs points to go back to.
 *
 * Restoring never deletes anything: the file being replaced is renamed and stays next to the
 * new one. Free of Electron, so that all of it runs in tests.
 */

export const BACKUPS_DIR = 'backups'
/** A restore chosen in Settings waits under this name for the next start (see applyStagedRestore). */
export const STAGED_FILE = `${DB_FILE}.restore`
/** What a restore at start-up put aside. */
export const REPLACED_FILE = `${DB_FILE}.replaced`
/** SQLite finds its journal by the name of the database, so the three files move together. */
const DB_SUFFIXES = ['', '-wal', '-shm'] as const

const NAME_RE = /^sel-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(manual|before-restore))?\.db$/
const PARTIAL_RE = /^\.sel-.*\.partial$/
const DAY = 24 * 60 * 60 * 1000

/** The newest backup of each of this many days (on which one was made) is kept… */
export const KEEP_DAYS = 3
/** …and up to this many older ones, each at least a week older than the one kept before it. */
export const KEEP_WEEKS = 3
/** A copy of the state a restore replaced is kept this long whatever else is made. */
export const KEEP_BEFORE_RESTORE_MS = 7 * DAY
/** Room left on the disk beyond the copy itself. */
const DISK_MARGIN = 64 * 1024 * 1024

export interface BackupFile extends BackupEntry {
  name: string
  path: string
}

export class BackupError extends Error {
  constructor(readonly problem: BackupProblem) {
    super(`backup: ${problem}`)
  }
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/** `sel-2026-10-18-091233.db`, in local time; `-manual` / `-before-restore` say how it was made. */
export function backupName(at: number, kind: BackupKind): string {
  const d = new Date(at)
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `sel-${stamp}${kind === 'auto' ? '' : `-${kind}`}.db`
}

/** The time and kind a backup's name holds, or null for any other file. */
export function parseBackupName(name: string): { at: number; kind: BackupKind } | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [year, month, day, hours, minutes, seconds] = m.slice(1, 7).map(Number)
  const date = new Date(year, month - 1, day, hours, minutes, seconds)
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return { at: date.getTime(), kind: (m[7] as BackupKind | undefined) ?? 'auto' }
}

/** The backups in `dir`, newest first. Files that are not backups are left out (and alone). */
export function listBackups(dir: string): BackupFile[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const found: BackupFile[] = []
  for (const name of names) {
    const parsed = parseBackupName(name)
    if (!parsed) continue
    const path = join(dir, name)
    try {
      const info = statSync(path)
      if (info.isFile()) found.push({ name, path, at: parsed.at, kind: parsed.kind, size: info.size })
    } catch {
      /* gone between the listing and the look */
    }
  }
  return found.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name))
}

const localDay = (at: number): string => new Date(at).toDateString()

/**
 * The names to keep: the newest backup of each of the last KEEP_DAYS days that have one, then
 * up to KEEP_WEEKS older ones a week apart (about a month back in at most six files), and every
 * copy a restore replaced in the last week, which is how a restore is undone.
 */
export function backupsToKeep(list: readonly Pick<BackupFile, 'name' | 'at' | 'kind'>[], now: number): Set<string> {
  const keep = new Set<string>()
  const regular = [...list].filter((b) => b.kind !== 'before-restore').sort((a, b) => b.at - a.at)
  const days = new Set<string>()
  let i = 0
  for (; i < regular.length && days.size < KEEP_DAYS; i++) {
    const day = localDay(regular[i].at)
    if (days.has(day)) continue
    days.add(day)
    keep.add(regular[i].name)
  }
  let last = Infinity
  for (const kept of regular) if (keep.has(kept.name)) last = Math.min(last, kept.at)
  let weeks = 0
  for (; i < regular.length && weeks < KEEP_WEEKS; i++) {
    if (last - regular[i].at < 7 * DAY) continue
    keep.add(regular[i].name)
    last = regular[i].at
    weeks += 1
  }
  for (const b of list) if (b.kind === 'before-restore' && now - b.at < KEEP_BEFORE_RESTORE_MS) keep.add(b.name)
  return keep
}

/** Removes the backups the rotation no longer keeps, and copies left half-written. */
export function pruneBackups(dir: string, now: number): void {
  const list = listBackups(dir)
  const keep = backupsToKeep(list, now)
  for (const b of list) if (!keep.has(b.name)) rmSync(b.path, { force: true })
  try {
    for (const name of readdirSync(dir)) if (PARTIAL_RE.test(name)) rmSync(join(dir, name), { force: true })
  } catch {
    /* nothing to tidy */
  }
}

export type DatabaseCheck =
  | { ok: true; pages: number; lastEdit: number | null }
  | { ok: false; problem: Exclude<BackupFileProblem, 'current'> }

/** Opens a database file read-only: better-sqlite3 in the app, node:sqlite in tests. */
export type ReadOnlyOpener = (file: string) => SqlDriver

/** True for SQLite's "this is not a database" and "the database is damaged". */
export function isDamageError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') return true
  const message = err instanceof Error ? err.message : String(err)
  return /not a database|malformed|corrupt/i.test(message)
}

/** True for the error of opening a database a newer sel migrated (see db/schema.ts migrate). */
export function isNewerError(err: unknown): boolean {
  return err instanceof Error && /schema version \d+ is newer/i.test(err.message)
}

/**
 * Whether `file` is a database sel can restore: an SQLite file that passes `quick_check`, with
 * sel's tables, from this version of sel or an earlier one. Also how many pages it holds and
 * when it was last edited, for the question asked before restoring it.
 */
export function inspectDatabase(open: ReadOnlyOpener, file: string): DatabaseCheck {
  let db: SqlDriver
  try {
    db = open(file)
  } catch (err) {
    return { ok: false, problem: isDamageError(err) ? 'damaged' : 'unreadable' }
  }
  try {
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0)
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
    )
    if (version === 0 || !tables.has('blocks') || !tables.has('settings')) return { ok: false, problem: 'not-sel' }
    if (version > SCHEMA_VERSION) return { ok: false, problem: 'newer' }
    const check = db.prepare('PRAGMA quick_check').all() as { quick_check?: string }[]
    if (check.length !== 1 || check[0].quick_check !== 'ok') return { ok: false, problem: 'damaged' }
    const row = db
      .prepare(
        // Pages and databases, not the rows of a database (a task is not a page to the person reading this).
        `SELECT COUNT(*) AS pages, MAX(updated_at) AS lastEdit FROM blocks
         WHERE type IN ('page', 'database') AND trashed_at IS NULL
           AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM blocks WHERE type = 'database'))`
      )
      .get() as { pages: number; lastEdit: number | null }
    return { ok: true, pages: Number(row.pages), lastEdit: row.lastEdit === null ? null : Number(row.lastEdit) }
  } catch (err) {
    return { ok: false, problem: isDamageError(err) ? 'damaged' : 'unreadable' }
  } finally {
    try {
      db.close()
    } catch {
      /* closing a read-only handle cannot lose anything */
    }
  }
}

/** What a backup needs of the open database. */
export interface CopySource {
  copyTo(file: string): void
  byteSize(): number
}

export interface TakeBackupOptions {
  source: CopySource
  dir: string
  kind: BackupKind
  now: number
  open: ReadOnlyOpener
  /** Free bytes on the disk of `dir`; injectable for tests. */
  freeBytes?: (dir: string) => number
}

function freeBytesOf(dir: string): number {
  const stats = statfsSync(dir)
  return Number(stats.bavail) * Number(stats.bsize)
}

function isDiskFull(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'SQLITE_FULL') return true
  return /database or disk is full|no space left/i.test(err instanceof Error ? err.message : String(err))
}

/**
 * Makes one backup and prunes the older ones. Throws a BackupError (`disk-full`, `damaged`,
 * `failed`) and leaves nothing behind when no checked copy came of it.
 */
export function takeBackup({ source, dir, kind, now, open, freeBytes = freeBytesOf }: TakeBackupOptions): BackupFile {
  let partial: string | null = null
  try {
    mkdirSync(dir, { recursive: true })
    if (freeBytes(dir) < source.byteSize() + DISK_MARGIN) throw new BackupError('disk-full')
    let at = Math.floor(now / 1000) * 1000
    while (existsSync(join(dir, backupName(at, kind)))) at += 1000
    const name = backupName(at, kind)
    partial = join(dir, `.${name}.partial`)
    rmSync(partial, { force: true })
    source.copyTo(partial)
    const check = inspectDatabase(open, partial)
    if (!check.ok) throw new BackupError('damaged')
    const path = join(dir, name)
    renameSync(partial, path)
    partial = null
    pruneBackups(dir, now)
    return { name, path, at, kind, size: statSync(path).size }
  } catch (err) {
    if (partial) rmSync(partial, { force: true })
    if (err instanceof BackupError) throw err
    throw new BackupError(isDiskFull(err) ? 'disk-full' : 'failed')
  }
}

/** The newest backup that passes its check, for a start-up whose database cannot be opened. */
export function newestGoodBackup(dir: string, open: ReadOnlyOpener): { file: BackupFile; pages: number } | null {
  for (const file of listBackups(dir)) {
    const check = inspectDatabase(open, file.path)
    if (check.ok) return { file, pages: check.pages }
  }
  return null
}

/** Renames the database `from` and its journal files to `to` (+ the same suffixes), replacing what is there. */
function moveDatabase(userData: string, from: string, to: string): void {
  for (const suffix of DB_SUFFIXES) {
    const source = join(userData, from + suffix)
    const target = join(userData, to + suffix)
    rmSync(target, { force: true })
    if (existsSync(source)) renameSync(source, target)
  }
}

/** Copies `source` to be the database: under a temporary name first, so a half copy is never `sel.db`. */
function installDatabase(userData: string, source: string): void {
  const partial = join(userData, `${DB_FILE}.partial`)
  copyFileSync(source, partial)
  renameSync(partial, join(userData, DB_FILE))
}

/** A restore chosen in Settings: the backup is copied next to the database, for the next start. */
export function stageRestore(userData: string, source: string): void {
  const partial = join(userData, `${STAGED_FILE}.partial`)
  copyFileSync(source, partial)
  renameSync(partial, join(userData, STAGED_FILE))
}

/**
 * At start, before the database is opened: puts a staged restore in place. The database it
 * replaces (already backed up before the restart) is kept as `sel.db.replaced`. True when one was.
 */
export function applyStagedRestore(userData: string): boolean {
  const staged = join(userData, STAGED_FILE)
  if (!existsSync(staged)) return false
  moveDatabase(userData, DB_FILE, REPLACED_FILE)
  try {
    renameSync(staged, join(userData, DB_FILE))
  } catch (err) {
    // Never leave no database behind: the app would start an empty one in its place.
    moveDatabase(userData, REPLACED_FILE, DB_FILE)
    throw err
  }
  return true
}

/** `sel.db.damaged-20261018-091233`: where a database that cannot be opened is put aside. */
export function damagedName(now: number): string {
  const d = new Date(now)
  return `${DB_FILE}.damaged-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * At start, when the database cannot be opened: the damaged files are renamed (never deleted)
 * and the backup is copied in their place. Returns the name the damaged database now has.
 */
export function restoreOverDamaged(userData: string, backup: string, now: number): string {
  const aside = damagedName(now)
  moveDatabase(userData, DB_FILE, aside)
  try {
    installDatabase(userData, backup)
  } catch (err) {
    moveDatabase(userData, aside, DB_FILE)
    throw err
  }
  return aside
}
