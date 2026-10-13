import Database from 'better-sqlite3'
import { Repository } from './repository'

export { Repository } from './repository'
export type { SqlDriver, SqlStatement } from './driver'

/**
 * Opens (creating and migrating if needed) the app database with better-sqlite3.
 * `file` may be `:memory:`. The welcome content is not created here: see
 * `seedIfEmpty` in ./seed, which the app loads on a first run only.
 */
export function openDatabase(file: string): Repository {
  const db = new Database(file)
  try {
    return new Repository(db)
  } catch (err) {
    db.close()
    throw err
  }
}
