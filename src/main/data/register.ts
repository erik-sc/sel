import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { app, BrowserWindow, dialog, shell, utilityProcess } from 'electron'
import type {
  BackupComparison,
  BackupKind,
  BackupProblem,
  BackupStatus,
  CompareOutcome,
  ExportResult,
  IntegrityState,
  PickOutcome,
  RestoreOutcome,
  RestorePageOutcome
} from '../../shared/data'
import { DATA_COPY, dataLocale, type DataCopy } from '../../shared/dataCopy'
import type { SqlDriver } from '../db/driver'
import type { Repository } from '../db/repository'
import { defineFeature, type Registered } from '../feature'
import { filesDir } from '../files'
import type { Handlers } from '../invoke'
import { DB_FILE } from '../legacy'
import { LOGS_DIR } from '../log'
import { raiseNotice } from '../notices'
import * as arg from '../validate'
import {
  BackupError,
  BACKUPS_DIR,
  type DatabaseCheck,
  type Integrity,
  listBackups,
  type ReadOnlyOpener,
  stageRestore,
  takeBackupApart
} from './backups'
import type { BackupReply, BackupRequest } from './backupWorker'
import { readBackupPages } from './pageRestore'
import { restoreAllSteps, restorePageSteps } from './restoreSteps'

/** The first automatic backup waits for the app to settle; then, once an hour, one is made when the newest is this old. */
const FIRST_CHECK_MS = 60_000
const CHECK_EVERY_MS = 60 * 60_000
const BACKUP_AGE_MS = 20 * 60 * 60_000
/** A file chosen with "Another file…" is named by a token of this shape, never by its path. */
const PICKED_PREFIX = 'picked:'
const MAX_SOURCE_CHARS = 200

/** better-sqlite3, read-only: how the main process looks inside a backup. */
export const openReadOnly: ReadOnlyOpener = (file) => new Database(file, { readonly: true, fileMustExist: true }) as unknown as SqlDriver

export function backupsDir(): string {
  return join(app.getPath('userData'), BACKUPS_DIR)
}

function liveFile(): string {
  return join(app.getPath('userData'), DB_FILE)
}

/**
 * Runs one request in a utility process (./backupWorker.ts): reading or copying a whole
 * database takes seconds on a large one, and would otherwise hold up every window (release
 * 0.7.0, decision 5).
 */
function runApart(request: BackupRequest): Promise<Exclude<BackupReply, { error: unknown }>> {
  // Next to the main bundle: this folder, or the one above when this code lands in a chunk.
  const script =
    [join(__dirname, 'backup.js'), join(__dirname, '..', 'backup.js')].find((path) => existsSync(path)) ?? join(__dirname, 'backup.js')
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(script, [], { serviceName: 'sel backup' })
    let done = false
    child.once('spawn', () => child.postMessage(request))
    child.once('message', (reply: BackupReply) => {
      done = true
      child.kill()
      if ('error' in reply) reject(Object.assign(new Error(reply.error.message), reply.error.code ? { code: reply.error.code } : {}))
      else resolve(reply)
    })
    child.once('exit', (code) => {
      if (!done) reject(new Error(`The backup process stopped before answering (${code})`))
    })
  })
}

async function copyApart(file: string, partial: string): Promise<DatabaseCheck> {
  const reply = await runApart({ file, partial })
  if (!('check' in reply)) throw new Error('The backup process gave another answer')
  return reply.check
}

async function inspectApart(file: string): Promise<DatabaseCheck> {
  const reply = await runApart({ task: 'inspect', file })
  if (!('check' in reply)) throw new Error('The backup process gave another answer')
  return reply.check
}

const sameFile = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export interface DataContext {
  repo: Repository
  /** True while something must not be cut short by a restart (a meeting being recorded). */
  busy(): boolean
}

/**
 * The `data:*` channel (backups, restore, export) and the daily backup. Registered by ../ipc.ts
 * behind its wrapper, which checks the sender and reduces failures to safe messages. Every file
 * is chosen in a native dialog: no path comes from, or goes to, a window. A backup is named by
 * its file name in the backups folder, and a file chosen elsewhere by a token.
 */
export function registerDataIpc({ repo, busy }: DataContext): { handlers: Handlers<'data'>; start(): void } {
  let problem: BackupProblem | null = null
  let problemAt: number | null = null
  let integrity: IntegrityState = 'unchecked'
  /** Files chosen with "Another file…" in this run, by token. */
  const picked = new Map<string, { file: string; at: number }>()

  const copy = (): DataCopy => DATA_COPY[dataLocale(repo.getSetting('ai.language'), app.getLocale())]

  const status = (): BackupStatus => ({
    backups: listBackups(backupsDir()).map(({ at, size, kind, name }) => ({ at, size, kind, name })),
    problem,
    problemAt,
    integrity
  })

  /** One backup at a time: a second asked for while one is being made waits for it, then is made. */
  let queue: Promise<unknown> = Promise.resolve()
  const backUp = (kind: BackupKind): Promise<void> => {
    const run = async (): Promise<void> => {
      try {
        await takeBackupApart({ source: repo, file: liveFile(), dir: backupsDir(), kind, now: Date.now(), work: copyApart })
        problem = problemAt = null
      } catch (err) {
        problem = err instanceof BackupError ? err.problem : 'failed'
        problemAt = Date.now()
        console.error('[data] the backup was not made', err)
        throw err
      }
    }
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  /** The daily backup: when the newest one made by the day or by hand is old enough. */
  const backUpIfDue = async (): Promise<void> => {
    const newest = listBackups(backupsDir()).find((b) => b.kind !== 'before-restore')
    if (newest && Date.now() - newest.at < BACKUP_AGE_MS) return
    try {
      await backUp('auto')
    } catch {
      /* said in Settings; tried again in an hour */
    }
  }

  /** SQLite's check of the open database, once per run (see backups.ts checkIntegrity). */
  const checkOpenDatabase = async (): Promise<void> => {
    let found: Integrity
    try {
      const reply = await runApart({ task: 'integrity', file: liveFile() })
      found = 'integrity' in reply ? reply.integrity : 'unreadable'
    } catch (err) {
      console.error('[data] the database could not be checked', err)
      return
    }
    if (found === 'unreadable') return
    integrity = found
    if (found === 'damaged') {
      console.error('[data] the database did not pass its check')
      raiseNotice('database-damaged', 'lasting')
    }
  }

  /** The file a window names, and when it was made: a backup by its name, a chosen file by its token. */
  const sourceOf = (value: unknown): { file: string; at: number | null } | null => {
    const source = arg.text(value, 'backup', MAX_SOURCE_CHARS)
    if (source.startsWith(PICKED_PREFIX)) {
      const found = picked.get(source)
      return found ? { file: found.file, at: found.at } : null
    }
    const found = listBackups(backupsDir()).find((b) => b.name === source)
    return found ? { file: found.path, at: found.at } : null
  }

  const ownerOf = (sender: Electron.WebContents): BrowserWindow | null => BrowserWindow.fromWebContents(sender)

  const pickFile = async (win: BrowserWindow | null): Promise<PickOutcome> => {
    const words = copy()
    const options: Electron.OpenDialogOptions = {
      title: words.chooseBackupTitle,
      defaultPath: backupsDir(),
      properties: ['openFile'],
      filters: [{ name: words.backupFilter, extensions: ['db'] }]
    }
    const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = chosen.filePaths[0]
    if (chosen.canceled || !file) return { outcome: 'cancelled' }
    if (sameFile(file, liveFile())) return { outcome: 'invalid', problem: 'current' }
    const check = await inspectApart(file)
    if (!check.ok) return { outcome: 'invalid', problem: check.problem }
    const madeAt = listBackups(backupsDir()).find((b) => sameFile(b.path, file))?.at
    const at = madeAt ?? check.lastEdit ?? Date.now()
    const source = `${PICKED_PREFIX}${randomUUID()}`
    picked.set(source, { file, at })
    return { outcome: 'picked', source, at }
  }

  const compare = async (value: unknown): Promise<CompareOutcome> => {
    const source = arg.text(value, 'backup', MAX_SOURCE_CHARS)
    const found = sourceOf(source)
    if (!found) return { outcome: 'invalid', problem: 'unreadable' }
    const reply = await runApart({ task: 'compare', backup: found.file, live: liveFile() })
    if ('check' in reply && !reply.check.ok) return { outcome: 'invalid', problem: reply.check.problem }
    if (!('comparison' in reply)) throw new Error('The backup process gave another answer')
    const comparison: BackupComparison = { source, at: found.at ?? reply.lastEdit ?? Date.now(), ...reply.comparison }
    return { outcome: 'compared', comparison }
  }

  const restorePage = (value: unknown, rawPageId: unknown, rawWithSubpages: unknown): Promise<RestorePageOutcome> => {
    const pageId = arg.id(rawPageId, 'page id')
    if (typeof rawWithSubpages !== 'boolean') throw new Error('Invalid withSubpages')
    const found = sourceOf(value)
    if (!found) return Promise.resolve({ outcome: 'invalid', problem: 'unreadable' })
    return restorePageSteps({
      // One page is one subtree of the backup: read in a moment, here.
      read: () => {
        const db = openReadOnly(found.file)
        try {
          return readBackupPages(db, pageId, rawWithSubpages)
        } finally {
          db.close()
        }
      },
      backUp: () => backUp('before-restore'),
      apply: (pages) => repo.restoreFromBackup(pages, found.at ?? Date.now(), rawWithSubpages)
    })
  }

  const restoreAll = (value: unknown): Promise<RestoreOutcome> => {
    const found = sourceOf(value)
    if (!found) return Promise.resolve({ outcome: 'invalid', problem: 'unreadable' })
    return restoreAllSteps(
      {
        busy,
        inspect: () => inspectApart(found.file),
        backUp: () => backUp('before-restore'),
        damaged: () => integrity === 'damaged',
        stage: () => stageRestore(app.getPath('userData'), found.file),
        restart: () =>
          setImmediate(() => {
            app.relaunch()
            app.quit()
          })
      },
      (message, err) => console.error(message, err)
    )
  }

  const exportMarkdown = async (win: BrowserWindow | null): Promise<ExportResult> => {
    const words = copy()
    const options: Electron.OpenDialogOptions = { title: words.exportTitle, properties: ['openDirectory', 'createDirectory'] }
    const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const parent = chosen.filePaths[0]
    if (chosen.canceled || !parent) return { saved: false }
    const { makeExportFolder, planExport, writeExport } = await import('./exportAll')
    const plan = planExport(repo, { archive: words.archiveFolder })
    const today = new Date()
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const root = await makeExportFolder(parent, words.exportFolder(day))
    const written = await writeExport(plan, root, filesDir())
    void shell.openPath(root)
    return { saved: true, pages: written.pages, images: written.images }
  }

  const handlers: Handlers<'data'> = {
    'data:status': () => status(),
    'data:backUp': async () => {
      try {
        await backUp('manual')
      } catch {
        /* the status says what went wrong */
      }
      return status()
    },
    'data:pickFile': (_args, event) => pickFile(ownerOf(event.sender)),
    'data:compare': ([source]) => compare(source),
    'data:restorePage': ([source, pageId, withSubpages]) => restorePage(source, pageId, withSubpages),
    'data:restoreAll': ([source]) => restoreAll(source),
    'data:showBackups': async () => {
      mkdirSync(backupsDir(), { recursive: true })
      const failed = await shell.openPath(backupsDir())
      if (failed) throw new Error(failed)
    },
    'data:openLogs': async () => {
      const dir = join(app.getPath('userData'), LOGS_DIR)
      mkdirSync(dir, { recursive: true })
      const failed = await shell.openPath(dir)
      if (failed) throw new Error(failed)
    },
    'data:exportMarkdown': (_args, event) => exportMarkdown(ownerOf(event.sender))
  }

  return {
    handlers,
    start() {
      void checkOpenDatabase()
      setTimeout(() => {
        void backUpIfDue()
        setInterval(() => void backUpIfDue(), CHECK_EVERY_MS).unref()
      }, FIRST_CHECK_MS).unref()
    }
  }
}

/** Backups of the database, restoring one, the workspace as Markdown. The daily backup waits for the first window. */
export const dataFeature = defineFeature({
  namespace: 'data',
  register: (ctx): Registered<'data'> => registerDataIpc({ repo: ctx.repo, busy: () => ctx.recording() })
})
