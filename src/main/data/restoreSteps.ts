import type { RestoreOutcome, RestorePageOutcome } from '../../shared/data'
import { BackupRestoreError, type BackupPage } from '../db/repository'
import { type DatabaseCheck, isDamageError } from './backups'
import { NotInBackup } from './pageRestore'

/**
 * The order of the two restores of the guided restore, apart from Electron so that tests run
 * them on real files: what is checked first, that everything is backed up before anything is
 * written, and what is said when a step fails. ./register.ts gives them the app's files and
 * processes.
 */

export interface RestorePageSteps {
  /** Reads the pages out of the backup (./pageRestore.ts readBackupPages). */
  read(): BackupPage[]
  /** Backs up everything as it is now (a `before-restore` backup). Throws when none was made. */
  backUp(): Promise<void>
  /** Writes the pages (Repository.restoreFromBackup). */
  apply(pages: BackupPage[]): { pageId: string; title: string; pages: number; notes: string[] }
}

/** One page (and the pages below it, when asked): read it, back up everything, then write it. */
export async function restorePageSteps(steps: RestorePageSteps): Promise<RestorePageOutcome> {
  // Read first: a page that is not in the backup costs no backup.
  let pages: BackupPage[]
  try {
    pages = steps.read()
  } catch (err) {
    if (err instanceof NotInBackup) return { outcome: 'refused', problem: 'not-in-backup' }
    return { outcome: 'invalid', problem: isDamageError(err) ? 'damaged' : 'unreadable' }
  }
  try {
    await steps.backUp()
  } catch {
    return { outcome: 'refused', problem: 'backup-failed' }
  }
  try {
    return { outcome: 'restored', ...steps.apply(pages) }
  } catch (err) {
    if (err instanceof BackupRestoreError) return { outcome: 'refused', problem: err.problem }
    throw err
  }
}

export interface RestoreAllSteps {
  /** True while a restart would cut something short (a recording). */
  busy(): boolean
  /** The check of the backup (backups.ts inspectDatabase). */
  inspect(): Promise<DatabaseCheck>
  /** Backs up everything as it is now (a `before-restore` backup). Throws when none was made. */
  backUp(): Promise<void>
  /** True when the check of the open database at start found it damaged. */
  damaged(): boolean
  /** Puts the backup next to the database for the next start (backups.ts stageRestore). */
  stage(): void
  /** Restarts sel, once the answer has gone back to the window. */
  restart(): void
}

/**
 * Everything: check the backup, back up the state now, then stage the backup and restart. A
 * database that cannot be backed up is only restored over when its check found it damaged
 * (it often cannot be copied then): the start that puts the backup in place keeps it as
 * `sel.db.replaced`, so nothing is lost either way.
 */
export async function restoreAllSteps(steps: RestoreAllSteps, log: (message: string, err: unknown) => void): Promise<RestoreOutcome> {
  if (steps.busy()) return { outcome: 'refused', problem: 'busy' }
  const check = await steps.inspect()
  if (!check.ok) return { outcome: 'invalid', problem: check.problem }
  try {
    await steps.backUp()
  } catch (err) {
    if (!steps.damaged()) return { outcome: 'refused', problem: 'backup-failed' }
    log('[data] restoring over a damaged database that could not be backed up first', err)
  }
  if (steps.busy()) return { outcome: 'refused', problem: 'busy' }
  steps.stage()
  steps.restart()
  return { outcome: 'restarting' }
}
