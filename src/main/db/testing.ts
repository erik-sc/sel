import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import type { SqlDriver } from './driver'
import { Repository, type RepositoryOptions } from './repository'

/**
 * Test-only: a repository on Node's built-in SQLite, which needs no native
 * module. Set `SELIDA_TEST_DRIVER=better-sqlite3` to run the same tests (and
 * the benchmark) on the driver the app ships with.
 * Not imported by the app bundle.
 */
export function openTestRepository(file = ':memory:', options: RepositoryOptions = {}): Repository {
  return openTestDatabase(file, options).repo
}

/** The same, with the raw connection: for tests that need to plant rows no code path writes (corrupt data). */
export function openTestDatabase(file = ':memory:', options: RepositoryOptions = {}): { repo: Repository; db: SqlDriver } {
  let db: SqlDriver
  if (process.env['SELIDA_TEST_DRIVER'] === 'better-sqlite3') {
    const Database = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => SqlDriver
    db = new Database(file)
  } else db = new DatabaseSync(file)
  return { repo: new Repository(db, options), db }
}
