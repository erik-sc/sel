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
}

/** Why the last attempt made no backup. */
export type BackupProblem = 'disk-full' | 'damaged' | 'failed'

export interface BackupStatus {
  /** Newest first. */
  backups: BackupEntry[]
  /** The last attempt failed (after the newest backup, if any): why, and when. */
  problem: BackupProblem | null
  problemAt: number | null
}

/** Why a file cannot be restored. `current` is the database sel has open. */
export type BackupFileProblem = 'not-sel' | 'damaged' | 'newer' | 'unreadable' | 'current'

export type RestoreOutcome =
  | { outcome: 'cancelled' }
  | { outcome: 'invalid'; problem: BackupFileProblem }
  /** The backup is in place for the next start, and sel is restarting. */
  | { outcome: 'restarting' }

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
  /**
   * Opens a file dialog in the backups folder, checks the chosen file and asks to confirm. On
   * yes, the current state is backed up first, then sel restarts with the chosen one.
   */
  restore(): Promise<RestoreOutcome>
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
  'data:restore': true,
  'data:showBackups': true,
  'data:openLogs': true,
  'data:exportMarkdown': true
} as const satisfies Record<InvokeChannels<{ data: DataApi }>, true>
