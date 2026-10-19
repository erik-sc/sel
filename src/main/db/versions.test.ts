import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { plainText } from '../../shared/richtext'
import type { Block, Op } from '../../shared/types'
import { canonicalJson, type VersionInfo, type VersionSnapshot } from '../../shared/versions'
import type { SqlDriver } from './driver'
import type { Repository } from './repository'
import { openTestDatabase } from './testing'
import {
  buildSnapshot,
  decodeSnapshot,
  encodeSnapshot,
  isProtected,
  parseSnapshot,
  replacedChars,
  retentionPlan,
  serializeSnapshot,
  type RetentionRow
} from './versions'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

let repo: Repository
let db: SqlDriver
let t: number

const page = (title: string, parentId: string | null = null): Block => repo.create({ type: 'page', parentId, props: { title: [[title]] } })
const text = (title: string, parentId: string, afterId?: string | null): Block =>
  repo.create({ type: 'text', parentId, props: { title: [[title]] }, afterId })
const retitle = (id: string, title: string): Block => repo.update(id, { props: { title: [[title]] } })
const titles = (id: string): string[] =>
  repo
    .getTree(id)
    .slice(1)
    .map((b) => plainText(b.props.title))
const snapTitles = (v: VersionSnapshot): string[] => v.blocks.slice(1).map((b) => plainText(b.props.title))
const list = (id: string): VersionInfo[] => repo.listVersions(id)
/** Moves the clock past the session gap, so that the next write snapshots the state before it. */
const later = (ms = 11 * MIN): void => {
  t += ms
}
const clean = (props: Record<string, unknown>) => props as never

beforeEach(() => {
  t = Date.UTC(2026, 0, 10, 12, 0, 0)
  ;({ repo, db } = openTestDatabase(':memory:', { clock: () => t }))
})

describe('canonical JSON and hashes', () => {
  it('serializes equal data to the same text whatever the key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }], u: undefined })).toBe('{"a":[{"c":"x","d":null}],"b":1}')
    expect(canonicalJson({ a: [{ c: 'x', d: null }], b: 1 })).toBe(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }] }))
    expect(canonicalJson('é😀')).toBe(JSON.stringify('é😀'))
    expect(canonicalJson([1, 'a', true, null, Number.NaN])).toBe('[1,"a",true,null,null]')
  })

  it('gives a state the same hash whatever order its props were written in, and another when it differs', () => {
    const tree = (props: Block['props']): Block[] => [
      { id: 'p', type: 'page', parentId: null, content: ['a'], props: { title: [['P']] }, createdAt: 1, updatedAt: 5, trashedAt: null },
      { id: 'a', type: 'to_do', parentId: 'p', content: [], props, createdAt: 2, updatedAt: 9, trashedAt: null }
    ]
    const one = serializeSnapshot(buildSnapshot(tree({ title: [['x']], checked: true, color: 'red' }))!)
    const two = serializeSnapshot(buildSnapshot(tree({ color: 'red', checked: true, title: [['x']] }))!)
    const other = serializeSnapshot(buildSnapshot(tree({ title: [['x']], checked: false, color: 'red' }))!)
    expect(two.hash).toBe(one.hash)
    expect(two.json).toBe(one.json)
    expect(other.hash).not.toBe(one.hash)
    expect(one.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores updatedAt, the favourite flag and the titles of nested pages', () => {
    const p = page('P')
    text('a', p.id)
    const sub = page('Sub', p.id)
    const before = serializeSnapshot(buildSnapshot(repo.getTree(p.id))!).hash
    repo.update(p.id, { props: { favorite: true } })
    retitle(sub.id, 'Renamed')
    expect(serializeSnapshot(buildSnapshot(repo.getTree(p.id))!).hash).toBe(before)
    retitle(p.id, 'P2')
    expect(serializeSnapshot(buildSnapshot(repo.getTree(p.id))!).hash).not.toBe(before)
  })

  it('round-trips through deflate and keeps the order of a database schema', () => {
    const d = repo.create({
      type: 'database',
      parentId: null,
      props: {
        title: [['D']],
        schema: {
          title: { id: 'title', name: 'Name', type: 'title' },
          zeta: { id: 'zeta', name: 'Z', type: 'text' },
          alpha: { id: 'alpha', name: 'A', type: 'number' }
        }
      }
    })
    repo.create({ type: 'page', parentId: d.id, props: { title: [['Row é😀']], values: { zeta: 'v', alpha: 3 } } })
    const snapshot = buildSnapshot(repo.getTree(d.id))!
    const decoded = decodeSnapshot(encodeSnapshot(serializeSnapshot(snapshot).json), clean)
    expect(Object.keys(decoded.blocks[0].props.schema!)).toEqual(['title', 'zeta', 'alpha'])
    expect(decoded.rows).toEqual(snapshot.rows)
    expect(serializeSnapshot(decoded).hash).toBe(serializeSnapshot(snapshot).hash)
  })
})

describe('what a version holds', () => {
  it('stops at nested pages and databases, which are only referenced', () => {
    const p = page('P')
    const a = text('a', p.id)
    const toggle = repo.create({ type: 'toggle', parentId: p.id, props: { title: [['t']] } })
    const inner = text('inner', toggle.id)
    const sub = page('Sub', toggle.id)
    text('inside sub', sub.id)
    const d = repo.create({ type: 'database', parentId: p.id, props: { title: [['D']] } })
    repo.create({ type: 'page', parentId: d.id, props: { title: [['row']] } })
    const v = repo.currentVersion(p.id)
    expect(v.info).toBeNull()
    expect(v.blocks.map((b) => b.id)).toEqual([p.id, a.id, toggle.id, inner.id])
    expect(v.blocks[0].parentId).toBeNull()
    expect(v.blocks[2].content).toEqual([inner.id, sub.id])
    expect(v.refs).toEqual([
      { id: sub.id, type: 'page', title: 'Sub' },
      { id: d.id, type: 'database', title: 'D' }
    ])
    expect(v.rows).toBeUndefined()
  })

  it('holds a database as schema, views and the title, icon, values and order of its rows', () => {
    const d = repo.create({ type: 'database', parentId: null, props: { title: [['D']] } })
    const r1 = repo.create({ type: 'page', parentId: d.id, props: { title: [['one']], icon: '🍎', values: { x: 1 } } })
    const r2 = repo.create({ type: 'page', parentId: d.id, props: { title: [['two']] }, afterId: null })
    text('body of the row', r1.id)
    const v = repo.currentVersion(d.id)
    expect(v.blocks).toHaveLength(1)
    expect(v.blocks[0].props.schema).toBeDefined()
    expect(v.blocks[0].props.views).toHaveLength(1)
    expect(v.rows!.map((r) => r.id)).toEqual([r2.id, r1.id])
    expect(v.rows![1]).toMatchObject({ title: [['one']], icon: '🍎', values: { x: 1 } })
    expect(v.refs).toEqual([])
  })

  it('holds a linked view as itself only, on its own or inside a page', () => {
    const d = repo.create({ type: 'database', parentId: null, props: { title: [['D']] } })
    repo.create({ type: 'page', parentId: d.id, props: { title: [['row']] } })
    const p = page('P')
    const view = repo.create({ type: 'database', parentId: p.id, props: { sourceId: d.id } })
    const own = repo.currentVersion(view.id)
    expect(own.blocks).toHaveLength(1)
    expect(own.rows).toBeUndefined()
    const inPage = repo.currentVersion(p.id)
    expect(inPage.blocks.map((b) => b.id)).toEqual([p.id, view.id])
    expect(inPage.blocks[1].props.sourceId).toBe(d.id)
    expect(inPage.refs).toEqual([])
  })
})

describe('capture policy', () => {
  it('snapshots the state before the first edit of a session, and nothing while the session lasts', () => {
    const p = page('P')
    const a = text('hello', p.id)
    // The page was empty before its first edit: there is nothing worth keeping.
    expect(list(p.id)).toEqual([])
    t += MIN
    retitle(a.id, 'hello w')
    t += 5 * MIN
    retitle(a.id, 'hello world')
    expect(list(p.id)).toEqual([])

    later(10 * MIN)
    retitle(a.id, 'hello world!')
    const versions = list(p.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ pageId: p.id, kind: 'auto', label: null, blockCount: 1, textSize: 12 })
    expect(snapTitles(repo.getVersion(versions[0].id))).toEqual(['hello world'])

    // Every keystroke of the same session leaves the history alone.
    for (let i = 0; i < 50; i++) {
      t += 5_000
      retitle(a.id, `typing ${i}`)
    }
    expect(list(p.id)).toHaveLength(1)

    later()
    text('second', p.id)
    expect(list(p.id)).toHaveLength(2)
    expect(snapTitles(repo.getVersion(list(p.id)[0].id))).toEqual(['typing 49'])
  })

  it('reads the page once per session, never per keystroke', () => {
    const p = page('P')
    const blocks = Array.from({ length: 40 }, (_, i) => text(`b${i}`, p.id))
    later()
    const reads = vi.spyOn(repo, 'getTree')
    retitle(blocks[0].id, 'first edit of the session')
    expect(reads).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 300; i++) {
      t += 1_000
      retitle(blocks[i % blocks.length].id, `keystroke ${i}`)
    }
    expect(reads).toHaveBeenCalledTimes(1)
    later()
    retitle(blocks[1].id, 'next session')
    expect(reads).toHaveBeenCalledTimes(2)
    reads.mockRestore()
    expect(list(p.id)).toHaveLength(2)
  })

  it('tracks each page on its own and attributes a nested edit to the page that holds the block', () => {
    const p = page('P')
    const q = page('Q', p.id)
    const a = text('a', p.id)
    const toggle = repo.create({ type: 'toggle', parentId: q.id, props: { title: [['t']] } })
    const deep = text('deep', toggle.id)
    later()
    retitle(deep.id, 'deep 2')
    expect(list(q.id)).toHaveLength(1)
    expect(list(p.id)).toHaveLength(0)
    retitle(a.id, 'a 2')
    expect(list(p.id)).toHaveLength(1)
    // Renaming the nested page is an edit of that page, not of the one that links to it.
    later()
    retitle(q.id, 'Q2')
    expect(list(q.id)).toHaveLength(2)
    expect(list(p.id)).toHaveLength(1)
  })

  it('counts a row edit as an edit of the database too', () => {
    const d = repo.create({ type: 'database', parentId: null, props: { title: [['D']] } })
    const row = repo.create({ type: 'page', parentId: d.id, props: { title: [['row']], values: { n: 1 } } })
    later()
    repo.update(row.id, { props: { values: { n: 2 } } })
    expect(list(d.id)).toHaveLength(1)
    expect(repo.getVersion(list(d.id)[0].id).rows![0].values).toEqual({ n: 1 })
    // The row has no content of its own yet: what it shows in the database is in the database's history.
    expect(list(row.id)).toEqual([])
    text('notes', row.id)
    later()
    repo.update(row.id, { props: { values: { n: 3 } } })
    expect(list(row.id)).toHaveLength(1)
    expect(repo.getVersion(list(row.id)[0].id).blocks[0].props.values).toEqual({ n: 2 })
    expect(list(d.id)).toHaveLength(2)
  })

  it('never stores the same state twice in a row', () => {
    const p = page('P')
    const a = text('one', p.id)
    later()
    retitle(a.id, 'two')
    expect(list(p.id)).toHaveLength(1)
    retitle(a.id, 'one')
    // Back to the state of the latest version: the next session finds nothing new to keep.
    later()
    repo.update(p.id, { props: { favorite: true } })
    expect(list(p.id)).toHaveLength(1)
    expect(repo.flushVersions()).toBe(0)
    expect(list(p.id)).toHaveLength(1)
    const hashes = db.prepare('SELECT hash FROM page_versions WHERE page_id = ?').all(p.id) as { hash: string }[]
    expect(new Set(hashes.map((h) => h.hash)).size).toBe(hashes.length)
  })

  it('flushes the latest state of edited pages on quit, once', () => {
    const p = page('P')
    const a = text('draft', p.id)
    const untouched = page('Other')
    retitle(a.id, 'final words')
    expect(list(p.id)).toEqual([])
    expect(repo.flushVersions()).toBe(1)
    expect(snapTitles(repo.getVersion(list(p.id)[0].id))).toEqual(['final words'])
    expect(list(untouched.id)).toEqual([])
    expect(repo.flushVersions()).toBe(0)
    expect(list(p.id)).toHaveLength(1)
  })

  it('snapshots before an apply that deletes 20 blocks or more, even in the middle of a session', () => {
    const p = page('P')
    const blocks = Array.from({ length: 30 }, (_, i) => text(`b${i}`, p.id))
    expect(list(p.id)).toEqual([])
    const del = (from: number, to: number): Op[] => blocks.slice(from, to).map((b) => ({ op: 'delete', id: b.id }))
    repo.apply(del(0, 5))
    expect(list(p.id)).toEqual([])
    repo.apply(del(5, 25))
    const versions = list(p.id)
    expect(versions).toHaveLength(1)
    expect(versions[0].blockCount).toBe(25)
    expect(titles(p.id)).toHaveLength(5)
    // The affected blocks are still reported once, by the run that committed.
    repo.drainChanges()
    repo.apply(del(25, 28))
    expect(list(p.id)).toHaveLength(1)
    expect(repo.drainChanges().sort()).toEqual([p.id, ...blocks.slice(25, 28).map((b) => b.id)].sort())
  })

  it('counts the blocks inside a deleted block', () => {
    const p = page('P')
    const toggle = repo.create({ type: 'toggle', parentId: p.id, props: { title: [['t']] } })
    for (let i = 0; i < 19; i++) text(`k${i}`, toggle.id)
    repo.delete(toggle.id)
    expect(list(p.id)).toHaveLength(1)
    expect(list(p.id)[0].blockCount).toBe(20)
  })

  it('snapshots before most of the text of a page is replaced', () => {
    const p = page('P')
    const long = 'lorem ipsum dolor sit amet '.repeat(40)
    const a = text(long, p.id)
    const b = text('short', p.id)
    // An ordinary edit: a few characters at the end.
    retitle(a.id, long + 'more')
    retitle(b.id, 'shorter')
    expect(list(p.id)).toEqual([])
    retitle(a.id, 'something else entirely')
    expect(list(p.id)).toHaveLength(1)
    expect(snapTitles(repo.getVersion(list(p.id)[0].id))[0]).toBe(long + 'more')
    expect(replacedChars('abc def', 'abc xyz def')).toBe(0)
    expect(replacedChars('abcdef', 'abXYef')).toBe(2)
    expect(replacedChars('abcdef', '')).toBe(6)
  })

  it('takes nothing when history is turned off, and resumes when it is turned on', () => {
    repo.setSetting('history.enabled', false)
    const p = page('P')
    const a = text('a', p.id)
    later()
    retitle(a.id, 'b')
    expect(repo.flushVersions()).toBe(0)
    expect(list(p.id)).toEqual([])
    repo.setSetting('history.enabled', true)
    later()
    retitle(a.id, 'c')
    expect(list(p.id)).toHaveLength(1)
  })

  it('honours the session length setting', () => {
    repo.setSetting('history.sessionMinutes', 2)
    const p = page('P')
    const a = text('a', p.id)
    t += 3 * MIN
    retitle(a.id, 'b')
    expect(list(p.id)).toHaveLength(1)
    // Out-of-range and mistyped values fall back to something sane instead of breaking capture.
    repo.setSetting('history.sessionMinutes', 'soon')
    t += 3 * MIN
    retitle(a.id, 'c')
    expect(list(p.id)).toHaveLength(1)
  })

  it('leaves no version and no bookkeeping behind when the write fails', () => {
    const p = page('P')
    const a = text('a', p.id)
    later()
    expect(() =>
      repo.apply([
        { op: 'update', id: a.id, patch: { props: { title: [['b']] } } },
        { op: 'update', id: 'missing', patch: {} }
      ])
    ).toThrow(/not found/)
    expect(list(p.id)).toEqual([])
    retitle(a.id, 'c')
    expect(list(p.id)).toHaveLength(1)
    expect(snapTitles(repo.getVersion(list(p.id)[0].id))).toEqual(['a'])
  })

  it('saves a version on demand, with or without a name', () => {
    const p = page('P')
    const a = text('a', p.id)
    const saved = repo.saveVersion(p.id, '  First draft  ')
    expect(saved).toMatchObject({ kind: 'manual', label: 'First draft', blockCount: 1 })
    // Saving the same state again names the existing version instead of storing a copy.
    expect(repo.saveVersion(p.id).id).toBe(saved.id)
    expect(repo.saveVersion(p.id, 'Renamed by saving').label).toBe('Renamed by saving')
    expect(list(p.id)).toHaveLength(1)
    retitle(a.id, 'b')
    expect(repo.saveVersion(p.id).label).toBeNull()
    expect(list(p.id).map((v) => v.kind)).toEqual(['manual', 'manual'])
    expect(() => repo.saveVersion(a.id)).toThrow('Page not found')
    expect(() => repo.saveVersion('nope')).toThrow('Page not found')
  })
})

describe('retention', () => {
  const now = Date.UTC(2026, 5, 1, 12)
  const auto = (id: string, age: number, extra: Partial<RetentionRow> = {}): RetentionRow => ({
    id,
    createdAt: now - age,
    kind: 'auto',
    label: null,
    ...extra
  })

  it('keeps everything from the last 24 hours', () => {
    const rows = Array.from({ length: 40 }, (_, i) => auto(`v${i}`, i * 30 * MIN))
    expect(retentionPlan(rows, now, 300)).toEqual({ drop: [], daily: [] })
  })

  it('keeps the newest of each hour for a week, of each day for 90 days, of each week after that', () => {
    const base = Math.floor((now - 2 * DAY) / HOUR) * HOUR
    const hourly = [auto('h-new', now - (base + 50 * MIN)), auto('h-mid', now - (base + 20 * MIN)), auto('h-old', now - base)]
    const day = Math.floor((now - 30 * DAY) / DAY) * DAY
    const daily = [auto('d-new', now - (day + 20 * HOUR)), auto('d-old', now - (day + 2 * HOUR))]
    const week = Math.floor((now - 200 * DAY) / (7 * DAY)) * 7 * DAY
    const weekly = [auto('w-new', now - (week + 6 * DAY)), auto('w-mid', now - (week + 3 * DAY)), auto('w-old', now - week)]
    const plan = retentionPlan([...hourly, ...daily, ...weekly], now, 300)
    expect(plan.drop.sort()).toEqual(['d-old', 'h-mid', 'h-old', 'w-mid', 'w-old'])
    // The survivors of a day or a week stand for it.
    expect(plan.daily).toEqual(['d-new', 'w-new'])
  })

  it('never drops saved or named versions, and they do not use up a bucket', () => {
    const day = Math.floor((now - 30 * DAY) / DAY) * DAY
    const rows = [
      auto('manual', now - (day + 22 * HOUR), { kind: 'manual' }),
      auto('named', now - (day + 21 * HOUR), { label: 'Before the rewrite' }),
      auto('auto-new', now - (day + 20 * HOUR)),
      auto('restore', now - (day + 10 * HOUR), { kind: 'restore', label: 'Before restoring 1 May 2026, 10:00' }),
      auto('restore-named', now - (day + 9 * HOUR), { kind: 'restore', label: 'Keep this one' }),
      auto('auto-old', now - (day + 2 * HOUR))
    ]
    expect(retentionPlan(rows, now, 300).drop.sort()).toEqual(['auto-old', 'restore'])
    expect(isProtected(rows[0])).toBe(true)
    expect(isProtected(rows[1])).toBe(true)
    expect(isProtected(rows[3])).toBe(false)
    expect(isProtected(rows[4])).toBe(true)
    // Even far above the cap.
    expect(retentionPlan(rows.slice(0, 2), now, 1).drop).toEqual([])
  })

  it('enforces the cap per page by dropping the oldest automatic versions first', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => auto(`a${i}`, i * MIN)),
      auto('saved', 7 * MIN, { kind: 'manual' }),
      auto('oldest', 8 * MIN)
    ]
    expect(retentionPlan(rows, now, 5).drop).toEqual(['oldest', 'a5', 'a4'])
  })

  it('prunes a page after a capture: buckets, the daily kind and the cap setting', () => {
    const p = page('P')
    const a = text('a', p.id)
    const insert = db.prepare(
      'INSERT INTO page_versions (id, page_id, created_at, kind, label, block_count, text_size, data, hash) VALUES (?, ?, ?, ?, NULL, 1, 1, ?, ?)'
    )
    const blob = encodeSnapshot(serializeSnapshot(buildSnapshot(repo.getTree(p.id))!).json)
    const day = Math.floor((t - 20 * DAY) / DAY) * DAY
    insert.run('old-1', p.id, day + 1 * HOUR, 'auto', blob, 'h1')
    insert.run('old-2', p.id, day + 5 * HOUR, 'auto', blob, 'h2')
    insert.run('old-3', p.id, day + 9 * HOUR, 'manual', blob, 'h3')
    later()
    retitle(a.id, 'b')
    const kept = list(p.id)
    expect(kept.map((v) => v.id).slice(1)).toEqual(['old-3', 'old-2'])
    expect(kept.map((v) => v.kind)).toEqual(['auto', 'manual', 'daily'])

    repo.setSetting('history.maxPerPage', 10)
    for (let i = 0; i < 14; i++) {
      later()
      retitle(a.id, `v${i}`)
    }
    const capped = list(p.id)
    expect(capped).toHaveLength(10)
    expect(capped.some((v) => v.id === 'old-3')).toBe(true)
    expect(capped.some((v) => v.id === 'old-2')).toBe(false)
  })

  it('enforces the global size budget, oldest automatic versions first, whatever their page', () => {
    repo.setSetting('history.budgetMb', 10)
    const p = page('P')
    const q = page('Q')
    const a = text('a', p.id)
    const b = text('b', q.id)
    repo.saveVersion(q.id, 'Keep')
    // Incompressible text: each version costs about a megabyte.
    const noise = (): string => randomBytes(800_000).toString('base64')
    for (let i = 0; i < 14; i++) {
      later()
      retitle(i % 2 ? a.id : b.id, noise())
    }
    const stats = repo.versionStats()
    expect(stats.bytes).toBeLessThanOrEqual(10 * 1024 * 1024)
    expect(stats.bytes).toBeGreaterThan(7 * 1024 * 1024)
    expect(list(q.id).some((v) => v.label === 'Keep')).toBe(true)
    // What is left are the newest ones.
    const all = [...list(p.id), ...list(q.id)].filter((v) => v.kind !== 'manual')
    const rows = db.prepare("SELECT MIN(created_at) AS oldest FROM page_versions WHERE kind <> 'manual'").get() as { oldest: number }
    expect(Math.min(...all.map((v) => v.createdAt))).toBe(Number(rows.oldest))
    expect(all.length).toBeLessThan(14)
  }, 60_000)

  it('housekeeping visits pages in slices, thins them and removes the history of pages that are gone', () => {
    const insert = db.prepare(
      "INSERT INTO page_versions (id, page_id, created_at, kind, label, block_count, text_size, data, hash) VALUES (?, ?, ?, 'auto', NULL, 1, 1, ?, ?)"
    )
    const pages = Array.from({ length: 5 }, (_, i) => page(`P${i}`))
    const blob = encodeSnapshot('{}')
    const day = Math.floor((t - 20 * DAY) / DAY) * DAY
    for (const p of pages) {
      insert.run(`${p.id}-1`, p.id, day + HOUR, blob, 'a')
      insert.run(`${p.id}-2`, p.id, day + 2 * HOUR, blob, 'b')
    }
    insert.run('orphan-1', 'no-such-page', day, blob, 'c')
    expect(repo.maintainVersions(3)).toBe(false)
    expect(repo.maintainVersions(3)).toBe(false)
    expect(repo.maintainVersions(3)).toBe(true)
    const left = db.prepare('SELECT id FROM page_versions ORDER BY id').all() as { id: string }[]
    expect(left.map((r) => r.id).sort()).toEqual(pages.map((p) => `${p.id}-2`).sort())
    expect(repo.maintainVersions(3)).toBe(false)
  })
})

describe('restore: replace', () => {
  it('makes the page equal to the version: updates, moves, recreates and removes blocks', () => {
    const p = page('P')
    const a = text('a', p.id)
    const b = repo.create({ type: 'to_do', parentId: p.id, props: { title: [['b']], checked: false } })
    const toggle = repo.create({ type: 'toggle', parentId: p.id, props: { title: [['t']] } })
    const c = text('c', toggle.id)
    const saved = repo.saveVersion(p.id, 'Good')
    const before = repo.getTree(p.id)

    later()
    retitle(a.id, 'a changed')
    repo.update(b.id, { type: 'text', props: { checked: null } })
    repo.move(c.id, p.id, null)
    repo.delete(toggle.id)
    const added = text('added later', p.id)
    retitle(p.id, 'P renamed')
    repo.update(p.id, { props: { favorite: true } })
    repo.drainChanges()

    const result = repo.restoreVersion(saved.id, 'replace')
    expect(result.pageId).toBe(p.id)
    expect(result.notes).toEqual([])
    const after = repo.getTree(p.id)
    const shape = (blocks: Block[]) =>
      blocks.map((x) => ({ id: x.id, type: x.type, parentId: x.parentId, content: x.content, props: x.props }))
    // Same ids, same order, same content - the deleted toggle is back under its original id.
    expect(shape(after.slice(1))).toEqual(shape(before.slice(1)))
    expect(after[0].content).toEqual(before[0].content)
    expect(after[0].props).toEqual({ title: [['P']], favorite: true })
    expect(repo.get(added.id)).toBeNull()
    expect(repo.get(toggle.id)!.createdAt).toBe(toggle.createdAt)

    // Everything that changed is announced, the page is flagged as reset, search follows.
    const changed = repo.drainChanges()
    expect(changed).toEqual(expect.arrayContaining([p.id, a.id, b.id, c.id, toggle.id, added.id]))
    expect(repo.drainResets()).toEqual([p.id])
    expect(repo.drainResets()).toEqual([])
    expect(repo.search('changed')).toEqual([])
    expect(repo.search('added')).toEqual([])
    expect(repo.search('t').some((r) => r.id === toggle.id)).toBe(true)
  })

  it('first saves the state being replaced, and restoring that undoes the restore', () => {
    const p = page('P')
    const a = text('one', p.id)
    const v1 = repo.saveVersion(p.id)
    later()
    retitle(a.id, 'two')
    const extra = text('extra', p.id)
    const result = repo.restoreVersion(v1.id, 'replace')
    expect(titles(p.id)).toEqual(['one'])
    const versions = list(p.id)
    const backup = versions.find((v) => v.id === result.backupId)!
    expect(backup.kind).toBe('restore')
    expect(backup.label).toMatch(/^Before restoring \d{1,2} \w{3} 2026, \d{2}:\d{2}$/)
    expect(snapTitles(repo.getVersion(backup.id))).toEqual(['two', 'extra'])

    const undo = repo.restoreVersion(backup.id, 'replace')
    expect(titles(p.id)).toEqual(['two', 'extra'])
    expect(repo.get(extra.id)!.parentId).toBe(p.id)
    // The state the undo replaced is the first version: nothing new had to be stored.
    expect(undo.backupId).toBe(v1.id)
    expect(list(p.id)).toHaveLength(versions.length)

    // The next edit within the session does not snapshot again: the restored state is a version.
    retitle(a.id, 'three')
    expect(list(p.id)).toHaveLength(versions.length)
  })

  it('gives a block a new id when its original one is taken elsewhere', () => {
    const p = page('P')
    const other = page('Other')
    const a = text('a', p.id)
    const b = text('b', p.id)
    const v = repo.saveVersion(p.id)
    repo.move(b.id, other.id)
    retitle(b.id, 'b lives elsewhere now')
    repo.restoreVersion(v.id, 'replace')
    const now = repo.getTree(p.id)
    expect(now.map((x) => plainText(x.props.title))).toEqual(['P', 'a', 'b'])
    expect(now[1].id).toBe(a.id)
    expect(now[2].id).not.toBe(b.id)
    // The other page is not robbed.
    expect(titles(other.id)).toEqual(['b lives elsewhere now'])
    expect(repo.get(b.id)!.parentId).toBe(other.id)
  })

  it('re-attaches nested pages: from the trash, from elsewhere; reports the ones deleted forever', () => {
    const p = page('P')
    const top = text('top', p.id)
    const toggle = repo.create({ type: 'toggle', parentId: p.id, props: { title: [['t']] } })
    const trashed = page('Trashed', toggle.id)
    const moved = page('Moved', p.id)
    const erased = page('Erased', p.id)
    const kept = page('Kept', p.id)
    text('body of trashed', trashed.id)
    const v = repo.saveVersion(p.id)

    const other = page('Other')
    repo.delete(trashed.id)
    repo.move(moved.id, other.id)
    repo.delete(erased.id)
    repo.deleteForever(erased.id)
    repo.delete(toggle.id)
    expect(repo.get(p.id)!.content).toEqual([top.id, kept.id])

    const result = repo.restoreVersion(v.id, 'replace')
    expect(repo.get(p.id)!.content).toEqual([top.id, toggle.id, moved.id, kept.id])
    expect(repo.get(toggle.id)!.content).toEqual([trashed.id])
    expect(repo.get(trashed.id)).toMatchObject({ trashedAt: null, parentId: toggle.id })
    expect(titles(trashed.id)).toEqual(['body of trashed'])
    expect(repo.get(moved.id)!.parentId).toBe(p.id)
    expect(repo.get(other.id)!.content).toEqual([])
    expect(repo.listTrash()).toEqual([])
    expect(result.notes).toEqual(['1 sub-page was deleted forever and could not be brought back: "Erased".'])
    expect(repo.listChildren(p.id).map((x) => x.id)).toEqual([trashed.id, moved.id, kept.id])
  })

  it('never destroys a sub-page created after the version: it is kept at the end of the page', () => {
    const p = page('P')
    const a = text('a', p.id)
    const v = repo.saveVersion(p.id)
    const toggle = repo.create({ type: 'toggle', parentId: p.id, props: { title: [['new toggle']] } })
    const young = page('Young', toggle.id)
    text('precious', young.id)
    const db2 = repo.create({ type: 'database', parentId: p.id, props: { title: [['Young db']] }, afterId: null })
    repo.create({ type: 'page', parentId: db2.id, props: { title: [['row']] } })

    const result = repo.restoreVersion(v.id, 'replace')
    expect(result.notes).toEqual([])
    expect(repo.get(p.id)!.content).toEqual([a.id, db2.id, young.id])
    expect(repo.get(toggle.id)).toBeNull()
    expect(repo.get(young.id)).toMatchObject({ parentId: p.id, trashedAt: null })
    expect(titles(young.id)).toEqual(['precious'])
    expect(repo.children(db2.id)).toHaveLength(1)
    expect(repo.listTrash()).toEqual([])
  })

  it('leaves alone a former sub-page that now contains the page', () => {
    const p = page('P')
    const sub = page('Sub', p.id)
    const v = repo.saveVersion(p.id)
    repo.move(sub.id, null)
    repo.move(p.id, sub.id)
    const result = repo.restoreVersion(v.id, 'replace')
    expect(result.notes).toEqual(['"Sub" now contains this page and was left where it is.'])
    expect(repo.get(p.id)).toMatchObject({ parentId: sub.id, content: [] })
    expect(repo.get(sub.id)).toMatchObject({ parentId: null, content: [p.id] })
  })

  it('restores a database: schema and views, and the title, values and order of its rows', () => {
    const d = repo.create({
      type: 'database',
      parentId: null,
      props: {
        title: [['Tasks']],
        schema: { title: { id: 'title', name: 'Name', type: 'title' }, n: { id: 'n', name: 'Points', type: 'number' } }
      }
    })
    const row = (title: string, n: number): Block =>
      repo.create({ type: 'page', parentId: d.id, props: { title: [[title]], values: { n } } })
    const r1 = row('one', 1)
    const r2 = row('two', 2)
    const r3 = row('three', 3)
    const r4 = row('four', 4)
    text('notes inside row one', r1.id)
    const views = repo.get(d.id)!.props.views!
    const v = repo.saveVersion(d.id)

    later()
    repo.update(d.id, {
      props: {
        title: [['Renamed']],
        schema: { title: { id: 'title', name: 'Task', type: 'title' }, extra: { id: 'extra', name: 'Extra', type: 'text' } },
        views: [{ ...views[0], id: 'chart', name: 'Chart', type: 'chart', chart: { kind: 'bar', y: { aggregate: 'count' } } }]
      }
    })
    repo.update(r1.id, { props: { title: [['ONE']], values: { n: 100, extra: 'x' }, icon: '🔥', cover: 'var(--c-red-bg)' } })
    text('more notes', r1.id)
    repo.move(r3.id, d.id, null)
    repo.delete(r2.id)
    repo.delete(r4.id)
    repo.deleteForever(r4.id)
    const r5 = row('five', 5)

    const result = repo.restoreVersion(v.id, 'replace')
    const now = repo.get(d.id)!
    expect(plainText(now.props.title)).toBe('Tasks')
    expect(Object.keys(now.props.schema!)).toEqual(['title', 'n'])
    expect(now.props.views).toEqual(views)
    // Snapshot order, minus the row that is gone for good, then the row made since.
    expect(now.content).toEqual([r1.id, r2.id, r3.id, r5.id])
    expect(repo.get(r2.id)!.trashedAt).toBeNull()
    const one = repo.get(r1.id)!
    expect(one.props).toEqual({ title: [['one']], values: { n: 1 }, cover: 'var(--c-red-bg)' })
    // The body of a row is the row's own business.
    expect(titles(r1.id)).toEqual(['notes inside row one', 'more notes'])
    expect(repo.get(r5.id)!.props.values).toEqual({ n: 5 })
    expect(result.notes).toEqual(['1 row was deleted forever and could not be brought back: "four".'])
    expect(repo.drainResets()).toEqual([d.id])
  })

  it('restores chart views of a linked view, and a linked view inside a page whose source is gone', () => {
    const d = repo.create({ type: 'database', parentId: null, props: { title: [['D']] } })
    const p = page('P')
    const view = repo.create({
      type: 'database',
      parentId: p.id,
      props: {
        sourceId: d.id,
        views: [
          {
            id: 'c',
            name: 'Chart',
            type: 'chart',
            visibleProperties: [],
            filters: [],
            sorts: [],
            chart: { kind: 'pie', y: { aggregate: 'count' } }
          }
        ]
      }
    })
    const v = repo.saveVersion(p.id)
    const own = repo.saveVersion(view.id)
    repo.update(view.id, { props: { views: [{ id: 't', name: 'Table', type: 'table', visibleProperties: [], filters: [], sorts: [] }] } })
    repo.restoreVersion(own.id, 'replace')
    expect(repo.get(view.id)!.props.views![0].chart).toEqual({ kind: 'pie', y: { aggregate: 'count' } })

    repo.delete(view.id)
    repo.delete(d.id)
    repo.deleteForever(d.id)
    repo.restoreVersion(v.id, 'replace')
    expect(repo.get(view.id)).toMatchObject({ type: 'database', parentId: p.id, content: [] })
    expect(repo.get(view.id)!.props.sourceId).toBe(d.id)
  })

  it('refuses a page that is in the trash or gone, a wrong mode and an unknown version', () => {
    const p = page('P')
    text('a', p.id)
    const v = repo.saveVersion(p.id)
    repo.delete(p.id)
    expect(() => repo.restoreVersion(v.id, 'replace')).toThrow('This page is in the Trash. Restore it first.')
    expect(() => repo.restoreVersion(v.id, 'copy')).toThrow('Trash')
    expect(() => repo.restoreVersion(v.id, 'merge' as never)).toThrow('Invalid restore mode')
    expect(() => repo.restoreVersion('nope', 'replace')).toThrow('Version not found')
    expect(() => repo.restoreVersion('x y', 'replace')).toThrow('Invalid version id')
  })
})

describe('restore: copy', () => {
  it('creates a sibling page from the version with fresh ids and leaves the original alone', () => {
    const parent = page('Parent')
    const p = page('P', parent.id)
    const next = page('Next', parent.id)
    const a = text('a', p.id)
    const toggle = repo.create({ type: 'toggle', parentId: p.id, props: { title: [['t']] } })
    text('inner', toggle.id)
    page('Sub', p.id)
    repo.update(p.id, { props: { favorite: true, icon: '📄' } })
    const v = repo.saveVersion(p.id)
    later()
    retitle(a.id, 'changed')

    const result = repo.restoreVersion(v.id, 'copy')
    expect(result.backupId).toBeNull()
    expect(result.notes).toEqual(['1 sub-page was not copied and stays in the original page.'])
    expect(repo.get(parent.id)!.content).toEqual([p.id, result.pageId, next.id])
    const copy = repo.getTree(result.pageId)
    expect(plainText(copy[0].props.title)).toMatch(/^P \(restored \d{1,2} \w{3} 2026, \d{2}:\d{2}\)$/)
    expect(copy[0].props.icon).toBe('📄')
    expect(copy[0].props.favorite).toBeUndefined()
    expect(copy.slice(1).map((b) => plainText(b.props.title))).toEqual(['a', 't', 'inner'])
    const original = new Set(repo.getTree(p.id).map((b) => b.id))
    expect(copy.some((b) => original.has(b.id))).toBe(false)
    expect(titles(p.id)).toEqual(['changed', 't', 'inner', 'Sub'])
    expect(repo.drainResets()).toEqual([])
    // The copy starts without a history.
    expect(list(result.pageId)).toEqual([])
  })

  it('copies a database with its rows as new pages', () => {
    const d = repo.create({ type: 'database', parentId: null, props: { title: [['D']] } })
    const r = repo.create({ type: 'page', parentId: d.id, props: { title: [['row']], icon: '🍎', values: { n: 1 } } })
    text('body', r.id)
    const v = repo.saveVersion(d.id)
    const result = repo.restoreVersion(v.id, 'copy')
    const rows = repo.children(result.pageId)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(r.id)
    expect(rows[0].props).toEqual({ title: [['row']], icon: '🍎', values: { n: 1 } })
    expect(rows[0].content).toEqual([])
    expect(repo.get(result.pageId)!.props.schema).toEqual(repo.get(d.id)!.props.schema)
    expect(repo.listRoot().map((b) => b.id)).toEqual([d.id, result.pageId])
  })
})

describe('lifetime of a history', () => {
  it('keeps versions while the page is in the trash and deletes them with it, nested pages included', () => {
    const p = page('P')
    const sub = page('Sub', p.id)
    text('a', p.id)
    text('b', sub.id)
    repo.saveVersion(p.id)
    repo.saveVersion(sub.id)
    const other = page('Other')
    text('c', other.id)
    repo.saveVersion(other.id)

    repo.delete(p.id)
    expect(list(p.id)).toHaveLength(1)
    expect(list(sub.id)).toHaveLength(1)
    repo.restore(p.id)
    expect(list(p.id)).toHaveLength(1)
    repo.delete(p.id)
    repo.deleteForever(p.id)
    expect(list(p.id)).toEqual([])
    expect(list(sub.id)).toEqual([])
    expect(list(other.id)).toHaveLength(1)
    expect(repo.versionStats().count).toBe(1)
  })

  it('does not copy versions when a page is duplicated', () => {
    const p = page('P')
    text('a', p.id)
    repo.saveVersion(p.id)
    const copy = repo.duplicate(p.id)
    expect(list(copy.id)).toEqual([])
    expect(list(p.id)).toHaveLength(1)
  })

  it('renames, deletes and clears versions, and reports what is stored', () => {
    const p = page('P')
    const q = page('Q')
    const a = text('a', p.id)
    text('b', q.id)
    const v1 = repo.saveVersion(p.id)
    retitle(a.id, 'a2')
    const v2 = repo.saveVersion(p.id, 'Two')
    repo.saveVersion(q.id)

    expect(repo.renameVersion(v1.id, '  Named  ').label).toBe('Named')
    expect(repo.renameVersion(v2.id, null).label).toBeNull()
    expect(repo.renameVersion(v2.id, '   ').label).toBeNull()
    expect(list(p.id).map((v) => v.label)).toEqual([null, 'Named'])
    expect(() => repo.renameVersion('missing', 'x')).toThrow('Version not found')
    expect(() => repo.renameVersion(v1.id, 5 as never)).toThrow('Invalid version name')

    const stats = repo.versionStats()
    expect(stats).toMatchObject({ count: 3, damaged: 0 })
    expect(stats.bytes).toBeGreaterThan(0)
    expect(repo.versionStats(p.id).count).toBe(2)

    repo.deleteVersion(v1.id)
    expect(list(p.id).map((v) => v.id)).toEqual([v2.id])
    repo.clearVersions(p.id)
    expect(list(p.id)).toEqual([])
    expect(list(q.id)).toHaveLength(1)
    repo.clearVersions()
    expect(repo.versionStats()).toEqual({ count: 0, bytes: 0, damaged: 0 })
  })
})

describe('damaged versions', () => {
  const plant = (id: string, pageId: string, data: unknown, kind = 'auto'): void => {
    db.prepare(
      'INSERT INTO page_versions (id, page_id, created_at, kind, label, block_count, text_size, data, hash) VALUES (?, ?, ?, ?, NULL, 1, 1, ?, ?)'
    ).run(id, pageId, t, kind, data, id)
  }

  it('skips rows that cannot be a version when listing, and counts them', () => {
    const p = page('P')
    text('a', p.id)
    const good = repo.saveVersion(p.id)
    plant('text-not-blob', p.id, 'xœ plain text in a blob column')
    plant('empty', p.id, Buffer.alloc(0))
    plant('odd-kind', p.id, deflateSync(Buffer.from('{}')), 'weird')
    expect(list(p.id).map((v) => v.id)).toEqual([good.id])
    expect(repo.versionStats(p.id)).toMatchObject({ count: 1, damaged: 3 })
    expect(repo.versionStats().damaged).toBe(3)
    // The good one is still readable and restorable next to them.
    expect(repo.getVersion(good.id).blocks).toHaveLength(2)
    expect(repo.restoreVersion(good.id, 'replace').pageId).toBe(p.id)
  })

  it('stops listing a version once its data failed to decode, and never reads data to list', () => {
    const p = page('P')
    text('a', p.id)
    const good = repo.saveVersion(p.id)
    t += 1000
    plant('garbage', p.id, Buffer.from('this is not a zlib stream at all'))
    // Listing does not inflate anything, so a blob of the right shape is offered...
    expect(list(p.id).map((v) => v.id)).toEqual(['garbage', good.id])
    expect(repo.versionStats(p.id)).toMatchObject({ count: 2, damaged: 0 })
    // ...until somebody opens it.
    expect(() => repo.getVersion('garbage')).toThrow('This version is damaged and cannot be read')
    expect(list(p.id).map((v) => v.id)).toEqual([good.id])
    expect(repo.versionStats(p.id)).toMatchObject({ count: 1, damaged: 1 })
    // It no longer takes part in deduplication either: saving still works.
    expect(repo.saveVersion(p.id, 'After').id).toBe(good.id)
  })

  it('refuses to read or restore a version that does not decode, with a message that says nothing else', () => {
    const p = page('P')
    const a = text('a', p.id)
    const whole = deflateSync(Buffer.from(serializeSnapshot(buildSnapshot(repo.getTree(p.id))!).json))
    plant('truncated', p.id, whole.subarray(0, whole.length - 6))
    plant('not-json', p.id, deflateSync(Buffer.from('{"v":1,')))
    plant('wrong-shape', p.id, deflateSync(Buffer.from(JSON.stringify({ v: 1, rootId: p.id, blocks: 'nope' }))))
    plant(
      'other-page',
      p.id,
      deflateSync(Buffer.from(JSON.stringify({ v: 1, rootId: 'elsewhere', blocks: [{ id: 'elsewhere', type: 'page', content: [] }] })))
    )
    for (const id of ['truncated', 'not-json', 'wrong-shape', 'other-page']) {
      expect(() => repo.getVersion(id), id).toThrow('This version is damaged and cannot be read')
      expect(() => repo.restoreVersion(id, 'replace'), id).toThrow('This version is damaged and cannot be read')
      expect(() => repo.restoreVersion(id, 'copy'), id).toThrow('This version is damaged and cannot be read')
    }
    // Nothing was touched, not even a backup version was left behind.
    expect(titles(p.id)).toEqual(['a'])
    expect(repo.get(a.id)).not.toBeNull()
    expect(db.prepare("SELECT COUNT(*) AS n FROM page_versions WHERE kind = 'restore'").get()).toEqual({ n: 0 })
    // Each was opened once outside a restore: none of them is listed any more.
    expect(list(p.id)).toEqual([])
    expect(repo.versionStats(p.id)).toMatchObject({ count: 0, damaged: 4 })
    repo.deleteVersion('truncated')
    expect(repo.versionStats(p.id)).toMatchObject({ count: 0, damaged: 3 })
  })

  it('validates a decoded snapshot like any block that is written', () => {
    const base = { v: 1, rootId: 'p', blocks: [{ id: 'p', type: 'page', content: ['a', 'b', 'ghost', 'a'], props: { title: [['P']] } }] }
    const block = (extra: object): object => ({ id: 'a', type: 'text', content: [], props: {}, ...extra })
    const parse = (blocks: object[], more: object = {}) => parseSnapshot({ ...base, blocks: [base.blocks[0], ...blocks], ...more }, clean)

    const ok = parse([block({}), block({ id: 'b', parentId: 'nonsense', content: ['c'] }), block({ id: 'c' }), block({ id: 'stray' })])
    // Parents come from the child lists; unknown children, repeats and unreachable blocks are dropped.
    expect(ok.blocks.map((b) => [b.id, b.parentId, b.content])).toEqual([
      ['p', null, ['a', 'b']],
      ['a', 'p', []],
      ['b', 'p', ['c']],
      ['c', 'b', []]
    ])

    expect(() => parse([block({ id: 'bad id!' })])).toThrow('damaged')
    expect(() => parse([block({ type: 'script' })])).toThrow('damaged')
    expect(() => parse([block({ props: 'x' })])).toThrow('damaged')
    expect(() => parse([block({ props: [] })])).toThrow('damaged')
    expect(() => parse([block({}), block({})])).toThrow('damaged')
    // A page below the root would smuggle a second page in: pages are references.
    expect(() => parse([block({ type: 'page' })])).toThrow('damaged')
    expect(() => parse([block({ type: 'database', props: {} })])).toThrow('damaged')
    expect(() => parse([], { refs: [{ id: 'r', type: 'text' }] })).toThrow('damaged')
    expect(() => parse([], { rows: [{ id: 'r', title: [], values: {} }] })).toThrow('damaged')
    expect(() => parseSnapshot({ ...base, v: 2 }, clean)).toThrow('damaged')
    expect(() => parseSnapshot({ ...base, rootId: 'a' }, clean)).toThrow('damaged')
    expect(() => parseSnapshot(null, clean)).toThrow('damaged')
    expect(() => parseSnapshot([], clean)).toThrow('damaged')

    // Hostile keys never reach a props object, and rich text is reduced to spans.
    const hostile = JSON.parse(
      '{"v":1,"rootId":"d","blocks":[{"id":"d","type":"database","content":["r"],"props":{"__proto__":{"x":1},"title":[["D"]]}}],"rows":[{"id":"r","title":[["ok",[["b"],["a","http://x"],[1,2,3]]],"junk",[5]],"values":{"n":1}}]}'
    )
    const parsed = decodeSnapshot(deflateSync(Buffer.from(JSON.stringify(hostile))), (props) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(props)) if (k !== '__proto__') out[k] = v
      return out as never
    })
    expect(Object.keys(parsed.blocks[0].props)).toEqual(['title'])
    expect(parsed.rows![0].title).toEqual([['ok', [['b'], ['a', 'http://x']]]])
  })

  it('reads its own snapshots back through the real props check', () => {
    const p = page('P')
    text('a', p.id)
    const v = repo.saveVersion(p.id)
    db.prepare('UPDATE page_versions SET data = ? WHERE id = ?').run(
      deflateSync(
        Buffer.from(
          JSON.stringify({
            v: 1,
            rootId: p.id,
            blocks: [
              {
                id: p.id,
                type: 'page',
                content: [],
                props: JSON.parse('{"title":[["P"]],"constructor":{"a":1},"__proto__":{"polluted":true}}')
              }
            ]
          })
        )
      ),
      v.id
    )
    const read = repo.getVersion(v.id)
    expect(Object.keys(read.blocks[0].props)).toEqual(['title'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
