import type { SqlDriver } from './driver'

/**
 * Ordered migrations. Index + 1 is the `user_version` reached after running it.
 * Never edit a released migration; append a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE blocks (
    -- Explicit integer key so the FTS rowid mapping survives VACUUM.
    rid        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL,
    parent_id  TEXT,
    content    TEXT NOT NULL DEFAULT '[]',
    props      TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    trashed_at INTEGER
  );
  CREATE INDEX blocks_parent_idx ON blocks(parent_id);
  CREATE INDEX blocks_trashed_idx ON blocks(trashed_at) WHERE trashed_at IS NOT NULL;
  CREATE INDEX blocks_type_updated_idx ON blocks(type, updated_at);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE VIRTUAL TABLE blocks_fts USING fts5(
    id UNINDEXED,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
  // The (type, updated_at) index covered every block, so each keystroke-driven update of a
  // text block rewrote an index entry that only "recent pages" ever reads - and that query
  // still had to sort all pages, because it spans two types. This one holds live pages and
  // databases only, already in recency order.
  `
  DROP INDEX blocks_type_updated_idx;
  CREATE INDEX blocks_pages_recent_idx ON blocks(updated_at)
    WHERE type IN ('page', 'database') AND trashed_at IS NULL;
  `,
  // Version history: snapshots of one page's own content (see ./versions.ts). `data` is the
  // deflated canonical JSON of the snapshot and `hash` identifies its content, so that the
  // same state is never stored twice in a row. No foreign key: a page in the trash keeps its
  // history, and the repository removes it when the page is deleted for good.
  `
  CREATE TABLE page_versions (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    kind        TEXT NOT NULL, -- 'auto' | 'manual' | 'restore' | 'daily'
    label       TEXT,
    block_count INTEGER,
    text_size   INTEGER,
    data        BLOB NOT NULL,
    hash        TEXT NOT NULL
  );
  CREATE INDEX page_versions_page_idx ON page_versions(page_id, created_at DESC);
  `,
  // Sync (see ../sync): what was last uploaded of each page. `hash` is a fingerprint of the
  // page's stored rows, so that a cycle only rewrites the files of pages that changed since.
  `
  CREATE TABLE sync_state (
    page_id     TEXT PRIMARY KEY,
    hash        TEXT NOT NULL,
    exported_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  `,
  // The app was called Selida before its first release (see ../../shared/legacy.ts): the
  // addresses it stored under that name become today's. The same text, so no block counts as
  // edited; forgetting what sync wrote last makes the next upload bring the repository over too.
  `
  UPDATE blocks SET props = replace(replace(props, 'selida-file://', 'sel-file://'), 'selida://', 'sel://') WHERE props LIKE '%selida%://%';
  UPDATE settings SET value = replace(value, 'selida-file://', 'sel-file://') WHERE value LIKE '%selida-file://%';
  DELETE FROM sync_state WHERE page_id = '~meta';
  `
]

/** The `user_version` of a database this build has fully migrated. */
export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Connection settings for a desktop app with one writer (this process).
 *
 * Left at their defaults on purpose:
 * - `mmap_size` (0): on Windows a mapped database cannot be truncated by a
 *   checkpoint or VACUUM while mapped, and a failing disk turns into a crash
 *   instead of an SQLITE_IOERR; the page cache below already avoids the copies.
 * - `wal_autocheckpoint` (1000 pages, ~4 MB): checkpoints stay short enough to
 *   go unnoticed between keystrokes.
 */
export function configure(db: SqlDriver): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // With WAL, NORMAL cannot corrupt the database; a power cut may only drop the last commits.
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  // Sorts and the recursive tree queries keep their scratch data in memory, not in temp files.
  db.exec('PRAGMA temp_store = MEMORY')
  // Up to 8 MB of page cache (the default is 2 MB). It is a ceiling, not a reservation.
  db.exec('PRAGMA cache_size = -8192')
  // After a large import the WAL file shrinks back instead of keeping its high-water mark.
  db.exec('PRAGMA journal_size_limit = 8388608')
}

export function migrate(db: SqlDriver): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  let version = Number(row?.user_version ?? 0)
  if (version > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${version} is newer than this app supports (${SCHEMA_VERSION})`)
  }
  while (version < SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(MIGRATIONS[version])
      version += 1
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* the migration error is the one worth reporting */
      }
      throw err
    }
  }
}
