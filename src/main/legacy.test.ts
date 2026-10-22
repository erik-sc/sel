/**
 * What the app stored when it was called Selida, brought over: the data folder, the database
 * file, the addresses inside the database, and the check of an encrypted repository.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { modernizeUrls } from '../shared/legacy'
import { adoptLegacyProfile } from './legacy'
import { createEncryption, keysMatch, seal } from './sync/crypto'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-legacy-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
let serial = 0

/** An app-data folder holding the profile of the earlier app. */
function appData(): { old: string; now: string } {
  const root = join(ROOT, `appdata-${++serial}`)
  const old = join(root, 'selida')
  mkdirSync(join(old, 'files'), { recursive: true })
  writeFileSync(join(old, 'selida.db'), 'db')
  writeFileSync(join(old, 'selida.db-wal'), 'wal')
  writeFileSync(join(old, 'files', 'a.png'), 'png')
  writeFileSync(join(old, 'Local State'), 'state')
  return { old, now: join(root, 'sel') }
}

describe('the data folder of the earlier app', () => {
  it('becomes the folder of this app, with the database and its journal under the new name', () => {
    const { old, now } = appData()
    expect(adoptLegacyProfile(now)).toBe(true)
    expect(existsSync(old)).toBe(false)
    expect(readFileSync(join(now, 'sel.db'), 'utf8')).toBe('db')
    expect(readFileSync(join(now, 'sel.db-wal'), 'utf8')).toBe('wal')
    expect(existsSync(join(now, 'selida.db'))).toBe(false)
    expect(readFileSync(join(now, 'files', 'a.png'), 'utf8')).toBe('png')
    // Once: the second start finds its database and looks no further.
    expect(adoptLegacyProfile(now)).toBe(false)
  })

  it('is left alone when this app already has a database', () => {
    const { old, now } = appData()
    mkdirSync(now)
    writeFileSync(join(now, 'sel.db'), 'mine')
    expect(adoptLegacyProfile(now)).toBe(false)
    expect(readFileSync(join(now, 'sel.db'), 'utf8')).toBe('mine')
    expect(readFileSync(join(old, 'selida.db'), 'utf8')).toBe('db')
  })

  it('fills a folder that exists but has no database, keeping what is already there', () => {
    const { old, now } = appData()
    mkdirSync(now)
    writeFileSync(join(now, 'Local State'), 'newer')
    expect(adoptLegacyProfile(now)).toBe(true)
    // Only what this app already had its own copy of is left in the old folder.
    expect(readdirSync(old)).toEqual(['Local State'])
    expect(readFileSync(join(now, 'sel.db'), 'utf8')).toBe('db')
    expect(readFileSync(join(now, 'sel.db-wal'), 'utf8')).toBe('wal')
    expect(readFileSync(join(now, 'files', 'a.png'), 'utf8')).toBe('png')
    expect(readFileSync(join(now, 'Local State'), 'utf8')).toBe('newer')
  })

  it('finishes a rename of the database that was interrupted', () => {
    const { old, now } = appData()
    mkdirSync(now)
    // The journal went over, the database did not.
    writeFileSync(join(now, 'sel.db-wal'), 'wal')
    rmSync(join(old, 'selida.db-wal'))
    expect(adoptLegacyProfile(now)).toBe(true)
    expect(readFileSync(join(now, 'sel.db'), 'utf8')).toBe('db')
    expect(readFileSync(join(now, 'sel.db-wal'), 'utf8')).toBe('wal')
    expect(existsSync(old)).toBe(false)
  })

  it('does nothing on a computer that never had the earlier app', () => {
    const now = join(ROOT, `appdata-${++serial}`, 'sel')
    expect(adoptLegacyProfile(now)).toBe(false)
    expect(existsSync(now)).toBe(false)
  })
})

describe('addresses stored under the earlier name', () => {
  it('are rewritten, and nothing else is', () => {
    expect(modernizeUrls('{"url":"selida-file://files/a.png","a":"selida://page/x"}')).toBe(
      '{"url":"sel-file://files/a.png","a":"sel://page/x"}'
    )
    expect(modernizeUrls('url("SELIDA-FILE://images/a.png")')).toBe('url("sel-file://images/a.png")')
    for (const same of ['sel-file://files/a.png', 'https://example.com/selida.git', 'Selida is Greek for page', 'selida-file:x'])
      expect(modernizeUrls(same)).toBe(same)
  })

  it('are rewritten in the database by a migration that leaves the rest of each row as it was', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { Repository: Repo } = await import('./db/repository')
    const { SCHEMA_VERSION } = await import('./db/schema')
    const db = new DatabaseSync(':memory:')
    // A database of the last build that was called Selida: migrations 1 to 4.
    new Repo(db)
    db.exec(`
      DELETE FROM blocks;
      INSERT INTO blocks (id, type, content, props, created_at, updated_at) VALUES
        ('p', 'page', '["i","t"]', '{"title":[["Trip"]],"cover":"selida-file://files/c.png"}', 1, 2),
        ('i', 'image', '[]', '{"url":"selida-file://files/a.png"}', 3, 4),
        ('t', 'text', '[]', '{"title":[["see ",[["a","selida://page/p"]]],[" and https://example.com/selida.git"]]}', 5, 6);
      UPDATE blocks SET parent_id = 'p' WHERE id <> 'p';
      INSERT OR REPLACE INTO settings (key, value) VALUES
        ('appearance', '{"shared":{"--wall-image":"url(\\"selida-file://files/w.png\\")"}}'),
        ('sync.remoteUrl', '"https://example.com/me/selida-notes.git"');
      INSERT INTO sync_state (page_id, hash, exported_at) VALUES ('~meta', 'written', 1), ('p', 'abc', 1);
      PRAGMA user_version = 4;
    `)
    const repo = new Repo(db)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    const rows = (
      db.prepare('SELECT id, props, updated_at FROM blocks ORDER BY id').all() as { id: string; props: string; updated_at: number }[]
    ).map((r) => ({ ...r }))
    expect(rows).toEqual([
      { id: 'i', props: '{"url":"sel-file://files/a.png"}', updated_at: 4 },
      { id: 'p', props: '{"title":[["Trip"]],"cover":"sel-file://files/c.png"}', updated_at: 2 },
      { id: 't', props: '{"title":[["see ",[["a","sel://page/p"]]],[" and https://example.com/selida.git"]]}', updated_at: 6 }
    ])
    expect(repo.getSetting('appearance')).toEqual({ shared: { '--wall-image': 'url("sel-file://files/w.png")' } })
    expect(repo.getSetting('sync.remoteUrl')).toBe('https://example.com/me/selida-notes.git')
    // The next upload starts from "the repository was not written by this app yet".
    expect((db.prepare('SELECT page_id FROM sync_state').all() as { page_id: string }[]).map((r) => r.page_id)).toEqual(['p'])
    repo.close()
  })
})

describe('a repository encrypted under the earlier name', () => {
  it('still opens with its passphrase', async () => {
    const { params, keys } = await createEncryption('correct horse', { N: 1 << 14, r: 8, p: 1 })
    const legacy = { ...params, check: seal(keys, 'check', Buffer.from('selida-key-check')).toString('base64') }
    expect(keysMatch(keys, legacy)).toBe(true)
    expect(keysMatch(keys, { ...params, check: seal(keys, 'check', Buffer.from('other-key-check')).toString('base64') })).toBe(false)
    const other = await createEncryption('wrong', { N: 1 << 14, r: 8, p: 1 })
    expect(keysMatch(other.keys, legacy)).toBe(false)
  })
})
