import Database from 'better-sqlite3'
import type { BackupComparison } from '../../shared/data'
import type { SqlDriver } from '../db/driver'
import { checkIntegrity, copyAndCheck, type DatabaseCheck, type Integrity, inspectDatabase, type ReadOnlyOpener } from './backups'
import { compareFiles } from './compare'

/**
 * The slow reads of whole databases, in a utility process of their own (out/main/backup.js,
 * started by ./register.ts for each request): the daily backup's copy and check, the comparison
 * of a backup with the workspace before a restore, and the check of the database at start.
 * `VACUUM INTO`, `quick_check` and reading every row of a large database take seconds, and in
 * the main process they would hold up every window meanwhile. It opens the files read-only on
 * connections of its own, answers once and is done.
 */

/** What the main process asks. A request without a `task` is a copy (the first kind there was). */
export type BackupRequest =
  | { task?: 'copy'; file: string; partial: string }
  | { task: 'compare'; backup: string; live: string }
  | { task: 'inspect'; file: string }
  | { task: 'integrity'; file: string }

export type BackupReply =
  | { check: DatabaseCheck }
  /** A compare whose backup did not pass its check answers with that check instead. */
  | { comparison: Omit<BackupComparison, 'source' | 'at'>; lastEdit: number | null }
  | { integrity: Integrity }
  | { error: { message: string; code?: string } }

const open: ReadOnlyOpener = (file) => new Database(file, { readonly: true, fileMustExist: true }) as unknown as SqlDriver

function answer(request: BackupRequest): BackupReply {
  if (request.task === 'compare') {
    const check = inspectDatabase(open, request.backup)
    if (!check.ok) return { check }
    return { comparison: compareFiles(open, request.backup, request.live), lastEdit: check.lastEdit }
  }
  if (request.task === 'inspect') return { check: inspectDatabase(open, request.file) }
  if (request.task === 'integrity') return { integrity: checkIntegrity(open, request.file) }
  return { check: copyAndCheck(open, request.file, request.partial) }
}

process.parentPort.once('message', (event: { data: BackupRequest }) => {
  let reply: BackupReply
  try {
    reply = answer(event.data)
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    reply = { error: { message: err instanceof Error ? err.message : String(err), ...(typeof code === 'string' ? { code } : {}) } }
  }
  process.parentPort.postMessage(reply)
})
