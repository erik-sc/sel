import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { app, BrowserWindow, dialog, shell, utilityProcess } from 'electron'
import type { BackupKind, BackupProblem, BackupStatus, ExportResult, RestoreOutcome } from '../../shared/data'
import { backupWhen, DATA_COPY, dataLocale, type DataCopy } from '../../shared/dataCopy'
import type { SqlDriver } from '../db/driver'
import type { Repository } from '../db/repository'
import { filesDir } from '../files'
import type { Handlers } from '../invoke'
import { DB_FILE } from '../legacy'
import {
  BackupError,
  BACKUPS_DIR,
  type DatabaseCheck,
  inspectDatabase,
  listBackups,
  stageRestore,
  takeBackupApart,
  type ReadOnlyOpener
} from './backups'
import type { BackupReply, BackupRequest } from './backupWorker'
import { defineFeature, type Registered } from '../feature'

/** The first automatic backup waits for the app to settle; then, once an hour, one is made when the newest is this old. */
const FIRST_CHECK_MS = 60_000
const CHECK_EVERY_MS = 60 * 60_000
const BACKUP_AGE_MS = 20 * 60 * 60_000
const SYNC_URL_KEY = 'sync.remoteUrl'

/** better-sqlite3, read-only: how the main process looks inside a backup. */
export const openReadOnly: ReadOnlyOpener = (file) => new Database(file, { readonly: true, fileMustExist: true }) as unknown as SqlDriver

export function backupsDir(): string {
  return join(app.getPath('userData'), BACKUPS_DIR)
}

/**
 * Copies and checks the database in a utility process (./backupWorker.ts): seconds of work on
 * a large database that would otherwise hold up every window (release 0.7.0, decision 5).
 */
function copyApart(file: string, partial: string): Promise<DatabaseCheck> {
  // Next to the main bundle: this folder, or the one above when this code lands in a chunk.
  const script =
    [join(__dirname, 'backup.js'), join(__dirname, '..', 'backup.js')].find((path) => existsSync(path)) ?? join(__dirname, 'backup.js')
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(script, [], { serviceName: 'sel backup' })
    let done = false
    child.once('spawn', () => child.postMessage({ file, partial } satisfies BackupRequest))
    child.once('message', (reply: BackupReply) => {
      done = true
      child.kill()
      if ('check' in reply) resolve(reply.check)
      else reject(Object.assign(new Error(reply.error.message), reply.error.code ? { code: reply.error.code } : {}))
    })
    child.once('exit', (code) => {
      if (!done) reject(new Error(`The backup process stopped before answering (${code})`))
    })
  })
}

export interface DataContext {
  repo: Repository
  /** True while something must not be cut short by a restart (a meeting being recorded). */
  busy(): boolean
}

/**
 * The `data:*` channel (backups, restore, export) and the daily backup. Registered by ../ipc.ts
 * behind its wrapper, which checks the sender and reduces failures to safe messages. Every file
 * is chosen in a native dialog: no path comes from, or goes to, a window.
 */
export function registerDataIpc({ repo, busy }: DataContext): { handlers: Handlers<'data'>; start(): void } {
  let problem: BackupProblem | null = null
  let problemAt: number | null = null

  const copy = (): DataCopy => DATA_COPY[dataLocale(repo.getSetting('ai.language'), app.getLocale())]

  const status = (): BackupStatus => ({
    backups: listBackups(backupsDir()).map(({ at, size, kind }) => ({ at, size, kind })),
    problem,
    problemAt
  })

  /** One backup at a time: a second asked for while one is being made waits for it, then is made. */
  let queue: Promise<unknown> = Promise.resolve()
  const backUp = (kind: BackupKind): Promise<void> => {
    const run = async (): Promise<void> => {
      try {
        const file = join(app.getPath('userData'), DB_FILE)
        await takeBackupApart({ source: repo, file, dir: backupsDir(), kind, now: Date.now(), work: copyApart })
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

  const ownerOf = (sender: Electron.WebContents): BrowserWindow | null => BrowserWindow.fromWebContents(sender)

  const restore = async (win: BrowserWindow | null): Promise<RestoreOutcome> => {
    if (busy()) throw new Error('Stop the recording first')
    const words = copy()
    const options: Electron.OpenDialogOptions = {
      title: words.chooseBackupTitle,
      defaultPath: backupsDir(),
      properties: ['openFile'],
      filters: [{ name: words.backupFilter, extensions: ['db'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = picked.filePaths[0]
    if (picked.canceled || !file) return { outcome: 'cancelled' }
    const live = join(app.getPath('userData'), DB_FILE)
    if (resolve(file).toLowerCase() === resolve(live).toLowerCase()) return { outcome: 'invalid', problem: 'current' }
    const check = inspectDatabase(openReadOnly, file)
    if (!check.ok) return { outcome: 'invalid', problem: check.problem }

    const locale = dataLocale(repo.getSetting('ai.language'), app.getLocale())
    const madeAt = listBackups(backupsDir()).find((b) => resolve(b.path).toLowerCase() === resolve(file).toLowerCase())?.at
    const when = backupWhen(madeAt ?? check.lastEdit ?? Date.now(), Date.now(), locale)
    const question: Electron.MessageBoxOptions = {
      type: 'question',
      message: words.restoreQuestion(when),
      detail: words.restoreDetail(check.pages, typeof repo.getSetting(SYNC_URL_KEY) === 'string'),
      buttons: [words.restoreAndRestart, words.cancel],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'sel'
    }
    const answer = win ? await dialog.showMessageBox(win, question) : await dialog.showMessageBox(question)
    if (answer.response !== 0 || busy()) return { outcome: 'cancelled' }

    // What is here now becomes a backup first: a restore can be undone by restoring that one.
    await backUp('before-restore')
    stageRestore(app.getPath('userData'), file)
    setImmediate(() => {
      app.relaunch()
      app.quit()
    })
    return { outcome: 'restarting' }
  }

  const exportMarkdown = async (win: BrowserWindow | null): Promise<ExportResult> => {
    const words = copy()
    const options: Electron.OpenDialogOptions = { title: words.exportTitle, properties: ['openDirectory', 'createDirectory'] }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const parent = picked.filePaths[0]
    if (picked.canceled || !parent) return { saved: false }
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
    'data:restore': (_args, event) => restore(ownerOf(event.sender)),
    'data:showBackups': async () => {
      mkdirSync(backupsDir(), { recursive: true })
      const failed = await shell.openPath(backupsDir())
      if (failed) throw new Error(failed)
    },
    'data:exportMarkdown': (_args, event) => exportMarkdown(ownerOf(event.sender))
  }

  return {
    handlers,
    start() {
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
