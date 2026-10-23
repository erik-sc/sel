/**
 * page_links: which blocks link to which page, kept by the repository as it writes (release
 * 0.7.0). It has to say exactly what the scan of every block it replaced found.
 */
import { describe, expect, it } from 'vitest'
import { pageLink, parsePageLink } from '../../shared/pageLink'
import type { Block, RichText } from '../../shared/types'
import type { SqlDriver } from './driver'
import { Repository } from './repository'
import { SCHEMA_VERSION } from './schema'
import { openTestDatabase } from './testing'

/** The test the old "Linked from" made of every block's marks (db/search.ts before 0.7.0). */
function linksTo(rt: unknown, pageId: string): boolean {
  if (!Array.isArray(rt)) return false
  for (const span of rt as unknown[]) {
    const marks = Array.isArray(span) ? (span[1] as unknown) : null
    if (!Array.isArray(marks)) continue
    for (const m of marks as unknown[]) {
      if (Array.isArray(m) && m[0] === 'a' && parsePageLink(m[1])?.pageId === pageId) return true
    }
  }
  return false
}

/**
 * The old scan, for every page anything could link to: the rows whose props contain its
 * address, then their marks. Returned as `from>to`, sorted. The trash is included here (the
 * table keeps its links, for when it comes back; "Linked from" leaves it out when reading).
 */
function oldScan(db: SqlDriver): string[] {
  const out: string[] = []
  const targets = new Set<string>()
  for (const r of db.prepare(`SELECT props FROM blocks WHERE instr(props, 'sel://page/') > 0`).all() as { props: string }[]) {
    for (const m of r.props.matchAll(/sel:\/\/page\/([A-Za-z0-9_-]{1,64})/g)) targets.add(m[1])
  }
  for (const to of targets) {
    const rows = db.prepare('SELECT id, props FROM blocks WHERE instr(props, ?) > 0').all(pageLink(to)) as { id: string; props: string }[]
    for (const r of rows) {
      let props: { title?: unknown; caption?: unknown } = {}
      try {
        props = JSON.parse(r.props)
      } catch {
        /* read as {} */
      }
      if (linksTo(props.title, to) || linksTo(props.caption, to)) out.push(`${r.id}>${to}`)
    }
  }
  return out.sort()
}

function table(db: SqlDriver): string[] {
  return (db.prepare('SELECT from_block, to_page FROM page_links').all() as { from_block: string; to_page: string }[])
    .map((r) => `${r.from_block}>${r.to_page}`)
    .sort()
}

const link = (text: string, to: string, blockId?: string): RichText => [[text, [['a', pageLink(to, blockId)]]]]

/** Pages `p1` and `p10` (one id begins the other) and blocks that link to them in every way there is, and in ways that are not links. */
function workspace(repo: Repository): { p1: Block; p10: Block; holder: Block } {
  const p1 = repo.create({ id: 'p1', type: 'page', parentId: null, props: { title: [['One']] } })
  const p10 = repo.create({ id: 'p10', type: 'page', parentId: null, props: { title: [['Ten']] } })
  const holder = repo.create({ type: 'page', parentId: null, props: { title: [['Holder']] } })
  const add = (id: string, props: Block['props'], parentId = holder.id): Block => repo.create({ id, type: 'text', parentId, props })
  add('title-link', { title: [['see '], ...link('one', 'p1')] })
  add('caption-link', { caption: link('ten', 'p10', 'b7'), title: [['an image']] })
  add('both', { title: [...link('one', 'p1'), ...link('ten', 'p10')] })
  add('twice', { title: [...link('a', 'p1'), ...link('b', 'p1', 'x')] })
  add('plain-text', { title: [['sel://page/p1 written out, not a link']] })
  add('bad-href', { title: [['x', [['a', 'sel://page/p1/extra']]]] })
  add('other-mark', { title: [['x', [['b'], ['a', 'https://example.com/sel://page/p1']]]] })
  add('other-key', { url: pageLink('p1'), title: [['bookmark']] })
  add('dangling', { title: link('gone', 'nowhere-page') })
  repo.create({ id: 'page-title', type: 'page', parentId: holder.id, props: { title: link('a page titled with a link', 'p1') } })
  const bin = repo.create({ id: 'binned', type: 'page', parentId: null, props: { title: [['Bin']] } })
  add('in-the-trash', { title: link('one', 'p1') }, bin.id)
  repo.delete(bin.id)
  return { p1, p10, holder }
}

describe('page_links', () => {
  it('is filled by the migration exactly as the old scan of every block found the links', () => {
    const { repo, db } = openTestDatabase()
    const { holder } = workspace(repo)
    const expected = oldScan(db)
    expect(expected.length).toBeGreaterThan(5)
    // A database as the previous release left it: no table, no indexes, user_version 5.
    db.exec(`
      DROP TABLE page_links;
      DROP INDEX blocks_favorite_idx;
      DROP INDEX blocks_archived_idx;
      DROP INDEX blocks_source_idx;
      PRAGMA user_version = 5;
    `)
    const reopened = new Repository(db)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(7)
    expect(table(db)).toEqual(expected)
    expect(table(db)).toEqual([
      'both>p1',
      'both>p10',
      'caption-link>p10',
      'dangling>nowhere-page',
      'in-the-trash>p1',
      'page-title>p1',
      'title-link>p1',
      'twice>p1'
    ])
    // And "Linked from" answers as before: once per page, the trash left out.
    expect(reopened.backlinks('p1').map((r) => r.pageId)).toEqual([holder.id, 'page-title'])
    expect(reopened.backlinks('p10').map((r) => r.id)).toEqual(['caption-link'])
  })

  it('runs again over its own result without a change (a rewound user_version)', () => {
    const { repo, db } = openTestDatabase()
    workspace(repo)
    const before = table(db)
    db.exec('PRAGMA user_version = 5')
    new Repository(db)
    expect(table(db)).toEqual(before)
  })

  it('stores a page whose props are not JSON as {}, so that the JSON indexes can be built', () => {
    const { repo, db } = openTestDatabase()
    const p = repo.create({ type: 'page', parentId: null, props: { title: [['Fine']] } })
    db.exec(`
      DROP TABLE page_links;
      DROP INDEX blocks_favorite_idx;
      DROP INDEX blocks_archived_idx;
      DROP INDEX blocks_source_idx;
      INSERT INTO blocks (id, type, props, created_at, updated_at) VALUES ('broken', 'page', '{"title":[["no end"', 1, 1);
      PRAGMA user_version = 5;
    `)
    const reopened = new Repository(db)
    expect((db.prepare(`SELECT props FROM blocks WHERE id = 'broken'`).get() as { props: string }).props).toBe('{}')
    expect(reopened.get(p.id)!.props.title).toEqual([['Fine']])
    expect(reopened.listFavorites()).toEqual([])
  })

  it('follows every write: create, edit, change of type, move, delete, restore of a version and sync', () => {
    let t = Date.UTC(2026, 0, 1)
    const { repo, db } = openTestDatabase(':memory:', { clock: () => t })
    const { holder } = workspace(repo)
    const check = (): void => expect(table(db)).toEqual(oldScan(db))
    check()
    const a = repo.create({ type: 'text', parentId: holder.id, props: { title: link('x', 'p1') } })
    check()
    repo.update(a.id, { props: { title: link('x', 'p10') } })
    check()
    repo.update(a.id, { type: 'quote' })
    check()
    repo.update(a.id, { props: { title: [['no link any more']] } })
    check()
    repo.update(a.id, { props: { caption: link('back', 'p1') } })
    check()
    repo.move(a.id, 'p10')
    check()
    const v = repo.saveVersion('p10')
    repo.delete(a.id)
    check()
    expect(table(db).some((row) => row.startsWith(`${a.id}>`))).toBe(false)
    t += 60 * 60_000
    repo.restoreVersion(v.id, 'replace')
    check()
    expect(table(db)).toContain(`${a.id}>p1`)
    repo.apply([
      { op: 'update', id: 'title-link', patch: { props: { title: [['unlinked by apply']] } } },
      { op: 'create', input: { id: 'made-by-apply', type: 'text', parentId: holder.id, props: { title: link('y', 'p10') } } }
    ])
    check()
    repo.duplicate(holder.id)
    check()
    const synced: Block = { ...(repo.get('both') as Block), props: { title: link('only ten now', 'p10') }, updatedAt: t + 1 }
    const fresh: Block = { ...synced, id: 'from-sync', props: { title: link('new from sync', 'p1') } }
    repo.applySync({ put: [synced, fresh], remove: ['twice'], snapshots: [], foreign: [], resetPages: [], settings: {} })
    check()
    repo.deleteForever('binned')
    check()
  })

  it('tells which changed blocks hold or held a link, so that "Linked from" can ignore the rest', () => {
    const { repo } = openTestDatabase()
    const { holder } = workspace(repo)
    repo.drainChanges()
    repo.drainLinks()
    const plain = repo.create({ type: 'text', parentId: holder.id, props: { title: [['typing']] } })
    for (let i = 0; i < 5; i++) repo.update(plain.id, { props: { title: [[`typing ${i}`]] } })
    expect(repo.drainChanges()).toContain(plain.id)
    expect(repo.drainLinks()).toEqual([])
    repo.update(plain.id, { props: { title: link('now a link', 'p1') } })
    expect(repo.drainChanges()).toContain(plain.id)
    expect(repo.drainLinks()).toEqual([plain.id])
    // Typing in a block that holds a link changes what "Linked from" shows of it.
    repo.update('title-link', { props: { title: [['see the '], ...link('one', 'p1')] } })
    repo.update(plain.id, { props: { title: [['the link is gone']] } })
    repo.drainChanges()
    expect(repo.drainLinks().sort()).toEqual([plain.id, 'title-link'].sort())
    repo.delete('title-link')
    repo.drainChanges()
    expect(repo.drainLinks()).toEqual(['title-link'])
    // A caller that drains the changes without asking for the links drops them with the changes.
    repo.update('both', { props: { title: [['plain']] } })
    repo.drainChanges()
    repo.drainChanges()
    expect(repo.drainLinks()).toEqual([])
  })
})
