import Database from 'better-sqlite3'
import type { SqlDriver } from '../db/driver'
import { copyAndCheck, type DatabaseCheck, type ReadOnlyOpener } from './backups'

/**
 * The daily backup's copy and check, in a utility process of their own (out/main/backup.js,
 * started by ./register.ts for each backup): `VACUUM INTO` and `quick_check` of a large
 * database take seconds, and in the main process they would hold up every window meanwhile.
 * It opens the database read-only on a connection of its own, answers once and is done.
 */

/** What the main process asks: copy `file` to `partial` and check the copy. */
export interface BackupRequest {
  file: string
  partial: string
}

export type BackupReply = { check: DatabaseCheck } | { error: { message: string; code?: string } }

const open: ReadOnlyOpener = (file) => new Database(file, { readonly: true, fileMustExist: true }) as unknown as SqlDriver

process.parentPort.once('message', (event: { data: BackupRequest }) => {
  let reply: BackupReply
  try {
    reply = { check: copyAndCheck(open, event.data.file, event.data.partial) }
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    reply = { error: { message: err instanceof Error ? err.message : String(err), ...(typeof code === 'string' ? { code } : {}) } }
  }
  process.parentPort.postMessage(reply)
})
