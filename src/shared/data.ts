/**
 * Data and trust: copies of the database kept on this computer (backups), putting one back
 * (restore), and the whole workspace as Markdown files (export). The shapes shared by the main
 * process, which does all of it, and the Settings rows that show it. No path ever crosses to a
 * window: files are chosen in native dialogs and named by the main process.
 */

import type { InvokeChannels } from './ipc'

/** `auto`: the daily one. `manual`: "Back up now". `before-restore`: the state replaced by a restore. */
export type BackupKind = 'auto' | 'manual' | 'before-restore'

export interface BackupEntry {
  /** When it was made, from its file name (ms). */
  at: number
  /** Bytes on disk. */
  size: number
  kind: BackupKind
  /** Its file name: how a window names it to the main process (a name in the backups folder, never a path). */
  name: string
}

/** Why the last attempt made no backup. */
export type BackupProblem = 'disk-full' | 'damaged' | 'failed'

export interface BackupStatus {
  /** Newest first. */
  backups: BackupEntry[]
  /** The last attempt failed (after the newest backup, if any): why, and when. */
  problem: BackupProblem | null
  problemAt: number | null
  /**
   * What the check of the open database at start found (`PRAGMA quick_check`, made apart once the
   * first window is up): `unchecked` until it is done, `damaged` when SQLite found a problem.
   */
  integrity: IntegrityState
}

export type IntegrityState = 'unchecked' | 'ok' | 'damaged'

/** Why a file cannot be restored. `current` is the database sel has open. */
export type BackupFileProblem = 'not-sel' | 'damaged' | 'newer' | 'unreadable' | 'current'

export type RestoreOutcome =
  | { outcome: 'invalid'; problem: BackupFileProblem }
  /** The state before could not be backed up first, so nothing was restored. */
  | { outcome: 'refused'; problem: RestoreRefusal }
  /** The backup is in place for the next start, and sel is restarting. */
  | { outcome: 'restarting' }

/**
 * Where a restore comes from: the name of a backup in the backups folder, or the token
 * `pickFile` gave a file chosen elsewhere (`picked:…`). Never a path.
 */
export type RestoreSource = string

/** A file chosen with "Another file…", checked and ready to compare. */
export type PickOutcome =
  | { outcome: 'cancelled' }
  | { outcome: 'invalid'; problem: BackupFileProblem }
  | { outcome: 'picked'; source: RestoreSource; at: number }

/** How a page of the backup differs from the workspace now. */
export type PageChange = 'only-backup' | 'only-now' | 'changed'

/** A page or database (not a row of one) that differs between a backup and now. */
export interface PageDifference {
  id: string
  /** Its title as the backup has it when it is only there, as it is now otherwise. Empty when it has none. */
  title: string
  icon: string | null
  kind: 'page' | 'database'
  /** The titles of the pages above it, outermost first. */
  path: string[]
  change: PageChange
  /** Pages and databases below it in the backup: what "with its sub-pages" brings back too. */
  subpages: number
}

export interface BackupComparison {
  source: RestoreSource
  /** When the backup was made (from its name), or when it was last edited for a file chosen elsewhere. */
  at: number
  /** Pages and databases in the backup (the rows of databases are not counted). */
  pages: number
  counts: Record<PageChange | 'same', number>
  /** The differences, each group sorted by title and cut at MAX_LISTED_DIFFERENCES (the counts are whole). */
  differences: PageDifference[]
}

/** Of each kind of difference, at most this many are listed. */
export const MAX_LISTED_DIFFERENCES = 300

export type CompareOutcome = { outcome: 'compared'; comparison: BackupComparison } | { outcome: 'invalid'; problem: BackupFileProblem }

/** Why a restore did not happen. */
export type RestoreRefusal =
  /** The state before could not be backed up first. */
  | 'backup-failed'
  /** The page is not in that backup (or is in its Trash there). */
  | 'not-in-backup'
  /** Past days of Meditations never change. */
  | 'notebook'
  /** The block with that id is now something else (a page became a database…). */
  | 'kind-changed'
  /** A recording is going on: a restart would cut it short. */
  | 'busy'

export type RestorePageOutcome =
  | {
      outcome: 'restored'
      /** The page that was brought back, to open it, and its title now (empty when it has none). */
      pageId: string
      title: string
      /** How many pages and databases were written. */
      pages: number
      /** Plain sentences about what could not be brought back. */
      notes: string[]
    }
  | { outcome: 'invalid'; problem: BackupFileProblem }
  | { outcome: 'refused'; problem: RestoreRefusal }

export interface ExportResult {
  saved: boolean
  pages?: number
  images?: number
}

/** `window.api.data`. */
export interface DataApi {
  status(): Promise<BackupStatus>
  /** Makes a backup now and resolves with the state afterwards (its `problem` says when it failed). */
  backUp(): Promise<BackupStatus>
  /** Opens a file dialog for a backup kept somewhere else and checks the chosen file. */
  pickFile(): Promise<PickOutcome>
  /** What differs between a backup and the workspace now, page by page. Read apart: nothing is changed. */
  compare(source: RestoreSource): Promise<CompareOutcome>
  /**
   * Brings one page back as the backup has it (and the pages below it, with `withSubpages`), and
   * nothing else. Everything is backed up first; the page keeps a version of what it was too.
   */
  restorePage(source: RestoreSource, pageId: string, withSubpages: boolean): Promise<RestorePageOutcome>
  /**
   * Brings everything back as the backup has it: the current state is backed up first, then
   * sel restarts with the chosen one. The window asks to confirm before calling this.
   */
  restoreAll(source: RestoreSource): Promise<RestoreOutcome>
  /** Opens the backups folder in the system's file manager. */
  showBackups(): Promise<void>
  /** Opens the folder of the local log (src/main/log.ts) in the system's file manager. */
  openLogs(): Promise<void>
  /** Opens a folder dialog and writes every page there as Markdown, with its images. */
  exportMarkdown(): Promise<ExportResult>
}

/** The invoke channels of `api.data` (see `INVOKE` in ./api.ts): every method of DataApi that returns a promise, and no other. */
export const DATA_INVOKE = {
  'data:status': true,
  'data:backUp': true,
  'data:pickFile': true,
  'data:compare': true,
  'data:restorePage': true,
  'data:restoreAll': true,
  'data:showBackups': true,
  'data:openLogs': true,
  'data:exportMarkdown': true
} as const satisfies Record<InvokeChannels<{ data: DataApi }>, true>
