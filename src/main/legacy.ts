import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LEGACY_NAME } from '../shared/legacy'

export const DB_FILE = 'sel.db'
const LEGACY_DB_FILE = `${LEGACY_NAME}.db`
/** SQLite finds its journal by the name of the database, so the three files are renamed together. */
const DB_SUFFIXES = ['-wal', '-shm', ''] as const

/**
 * Brings over the notes made when the app was called Selida: its data folder (next to this
 * one, under the old name) becomes this app's, and the database in it takes today's name.
 * Does nothing once this app has a database. Has to run before anything opens the folder.
 *
 * Every step is a rename, and the database goes last: stopped half-way (the old app still
 * running holds its files), the next start picks up where this one left off.
 */
export function adoptLegacyProfile(userData: string): boolean {
  if (existsSync(join(userData, DB_FILE))) return false
  let adopted = false
  for (const name of [LEGACY_NAME, 'Selida']) {
    const old = join(dirname(userData), name)
    if (old === userData || !existsSync(join(old, LEGACY_DB_FILE))) continue
    if (!existsSync(userData)) renameSync(old, userData)
    else {
      // Something made this app's folder already: what it lacks comes over, the database last.
      const rank = (entry: string): number => (entry === LEGACY_DB_FILE ? 2 : entry.startsWith(LEGACY_DB_FILE) ? 1 : 0)
      const entries = readdirSync(old).sort((a, b) => rank(a) - rank(b))
      for (const entry of entries) if (!existsSync(join(userData, entry))) renameSync(join(old, entry), join(userData, entry))
      try {
        rmdirSync(old)
      } catch {
        /* what this app already had stays behind in the old folder */
      }
    }
    adopted = true
    break
  }
  for (const suffix of DB_SUFFIXES) {
    const old = join(userData, LEGACY_DB_FILE + suffix)
    if (!existsSync(old) || existsSync(join(userData, DB_FILE + suffix))) continue
    renameSync(old, join(userData, DB_FILE + suffix))
    adopted = true
  }
  return adopted
}
