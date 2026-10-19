import { beforeEach, describe, expect, it } from 'vitest'
import type { Block, BlockProps, DatabaseView } from '../../shared/types'
import { isLinkedView, isTrashable, sourceIdOf } from '../../shared/linked'
import { pageToMarkdown } from '../markdown'
import type { Repository } from './repository'
import { openTestRepository } from './testing'

let repo: Repository

const ids = (blocks: Block[]): string[] => blocks.map((b) => b.id)
const page = (title: string, parentId: string | null = null): Block => repo.create({ type: 'page', parentId, props: { title: [[title]] } })
const view = (id: string, visibleProperties: string[] = ['title']): DatabaseView => ({
  id,
  name: 'Table',
  type: 'table',
  visibleProperties,
  filters: [],
  sorts: []
})

/** A source database "Tasks" with a status property and two rows. */
function source(parentId: string | null, title = 'Tasks'): { db: Block; rows: Block[] } {
  const db = repo.create({
    type: 'database',
    parentId,
    props: {
      title: [[title]],
      icon: '📋',
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        st: { id: 'st', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'Done', color: 'green' }] }
      },
      views: [view('v-source', ['title', 'st'])]
    }
  })
  const rows = [
    repo.create({ type: 'page', parentId: db.id, props: { title: [['Write report']], values: { st: 'o1' } } }),
    repo.create({ type: 'page', parentId: db.id, props: { title: [['Call Ada']] } })
  ]
  return { db: repo.get(db.id)!, rows }
}

function link(parentId: string | null, sourceId: string, props: BlockProps = {}): Block {
  return repo.create({ type: 'database', parentId, props: { views: [view('v-linked')], ...props, sourceId } })
}

beforeEach(() => {
  repo = openTestRepository()
})

describe('shared helpers', () => {
  it('recognise a linked view only on a database with a valid, foreign source id', () => {
    const base = { id: 'a', type: 'database' as const }
    expect(sourceIdOf({ ...base, props: { sourceId: 'b' } })).toBe('b')
    expect(sourceIdOf({ ...base, props: { sourceId: 'a' } })).toBeNull()
    expect(sourceIdOf({ ...base, props: { sourceId: 'not an id' } })).toBeNull()
    expect(sourceIdOf({ ...base, props: { sourceId: 7 } })).toBeNull()
    expect(sourceIdOf({ ...base, props: null })).toBeNull()
    expect(sourceIdOf({ id: 'a', type: 'page', props: { sourceId: 'b' } })).toBeNull()
    expect(sourceIdOf(undefined)).toBeNull()
    expect(isLinkedView({ ...base, props: { sourceId: 'b' } })).toBe(true)
    expect(isTrashable({ ...base, props: { sourceId: 'b' } })).toBe(false)
    expect(isTrashable({ ...base, props: {} })).toBe(true)
    expect(isTrashable({ id: 'p', type: 'page', props: {} })).toBe(true)
    expect(isTrashable({ id: 't', type: 'text', props: {} })).toBe(false)
  })
})

describe('creating and updating linked views', () => {
  it('stores a linked view with its own views and nothing of the source', () => {
    const p = page('P')
    const { db } = source(p.id)
    const v = repo.create({
      type: 'database',
      parentId: p.id,
      props: {
        sourceId: db.id,
        views: [view('mine')],
        schema: { title: { id: 'title', name: 'Mine', type: 'title' } },
        values: { st: 'o1' }
      }
    })
    expect(v.props.sourceId).toBe(db.id)
    expect(v.props.views).toEqual([view('mine')])
    expect('schema' in v.props).toBe(false)
    expect('values' in v.props).toBe(false)
    expect(v.content).toEqual([])
    // No default schema or view is invented for it either.
    const bare = repo.create({ type: 'database', parentId: p.id, props: { sourceId: db.id } })
    expect(bare.props).toEqual({ sourceId: db.id })
  })

  it('rejects a source that is missing, not a database, malformed, or the block itself', () => {
    const p = page('P')
    const { db } = source(p.id)
    const own = '6f1c0a4e-1111-4222-8333-444455556666'
    expect(() => link(p.id, 'missing')).toThrow(/Source database not found/)
    expect(() => link(p.id, p.id)).toThrow(/Source database not found/)
    expect(() => repo.create({ type: 'database', parentId: p.id, props: { sourceId: 'no spaces allowed' } })).toThrow(/Invalid sourceId/)
    expect(() => repo.create({ type: 'database', parentId: p.id, props: { sourceId: 7 as never } })).toThrow(/Invalid sourceId/)
    expect(() => repo.create({ id: own, type: 'database', parentId: p.id, props: { sourceId: own } })).toThrow(/itself/)
    // A failed create leaves nothing behind.
    expect(repo.get(own)).toBeNull()
    expect(repo.get(p.id)!.content).toEqual([db.id])
  })

  it('links to the source when asked to link to a linked view', () => {
    const p = page('P')
    const { db } = source(p.id)
    const first = link(p.id, db.id)
    const second = link(p.id, first.id)
    expect(second.props.sourceId).toBe(db.id)
    expect(ids(repo.databaseLocations(db.id).map((l) => l.block))).toEqual([first.id, second.id])
  })

  it('refuses a corrupt chain instead of following it', () => {
    const p = page('P')
    const { db } = source(p.id)
    const a = link(p.id, db.id)
    const b = link(p.id, db.id)
    // Not reachable through the API: written straight into the row, as a corrupt file would have it.
    repo.transaction(() => {
      ;(repo as unknown as { stmt(sql: string): { run(...args: unknown[]): unknown } })
        .stmt('UPDATE blocks SET props = ? WHERE id = ?')
        .run(JSON.stringify({ sourceId: b.id }), a.id)
    })
    expect(() => link(p.id, b.id)).not.toThrow()
    expect(() => link(p.id, a.id)).toThrow(/another linked view/)
  })

  it('keeps sourceId off blocks that are not databases', () => {
    const p = page('P')
    const { db } = source(p.id)
    const t = repo.create({ type: 'text', parentId: p.id, props: { title: [['x']], sourceId: db.id } })
    expect(t.props).toEqual({ title: [['x']] })
    const v = link(p.id, db.id)
    // Turning a linked view into something else drops the link (and it is then an ordinary block).
    const turned = repo.update(v.id, { type: 'text' })
    expect('sourceId' in turned.props).toBe(false)
  })

  it('validates the link when an update sets or changes it, and only then', () => {
    const p = page('P')
    const { db } = source(p.id)
    const other = source(p.id, 'Other').db
    const v = link(p.id, db.id)

    expect(() => repo.update(v.id, { props: { sourceId: v.id } })).toThrow(/itself/)
    expect(() => repo.update(v.id, { props: { sourceId: 'missing' } })).toThrow(/not found/)
    expect(repo.update(v.id, { props: { sourceId: other.id } }).props.sourceId).toBe(other.id)

    // A database with rows, or with linked views of its own, cannot become a view.
    expect(() => repo.update(db.id, { props: { sourceId: other.id } })).toThrow(/has rows/)
    const empty = repo.create({ type: 'database', parentId: p.id })
    link(p.id, empty.id)
    expect(() => repo.update(empty.id, { props: { sourceId: other.id } })).toThrow(/has linked views/)

    // An empty one can; its schema goes, and a schema patch on a view never sticks.
    const lone = repo.create({ type: 'database', parentId: p.id })
    const turned = repo.update(lone.id, { props: { sourceId: other.id } })
    expect(turned.props.sourceId).toBe(other.id)
    expect('schema' in turned.props).toBe(false)
    const patched = repo.update(lone.id, { props: { schema: { title: { id: 'title', name: 'X', type: 'title' } } } })
    expect('schema' in patched.props).toBe(false)

    // Unlinking gives it a schema of its own again.
    const unlinked = repo.update(lone.id, { props: { sourceId: null } })
    expect(unlinked.props.sourceId).toBeUndefined()
    expect(unlinked.props.schema).toBeDefined()
  })

  it('lets a view whose source is gone for good still be edited and removed', () => {
    const p = page('P')
    const { db } = source(p.id)
    const v = link(p.id, db.id)
    repo.deleteForever(db.id)
    const renamed = repo.update(v.id, { props: { title: [['Mine']], views: [view('again')] } })
    expect(renamed.props.sourceId).toBe(db.id)
    expect(renamed.props.views).toEqual([view('again')])
    repo.delete(v.id)
    expect(repo.get(v.id)).toBeNull()
  })

  it('keeps rows out of linked views', () => {
    const p = page('P')
    const { db, rows } = source(p.id)
    const v = link(p.id, db.id)
    expect(() => repo.create({ type: 'page', parentId: v.id })).toThrow(/source database/)
    expect(() => repo.move(rows[0].id, v.id)).toThrow(/source database/)
    expect(() => repo.createTree({ type: 'page' }, v.id)).toThrow(/source database/)
    expect(repo.get(v.id)!.content).toEqual([])
    expect(repo.get(db.id)!.content).toEqual(ids(rows))
    // Moving the view itself is unaffected.
    const q = page('Q')
    expect(repo.move(v.id, q.id).parentId).toBe(q.id)
  })

  it('applies the same rules inside a batch and rolls the batch back on a bad link', () => {
    const p = page('P')
    const { db } = source(p.id)
    const a = '6f1c0a4e-1111-4222-8333-000000000001'
    const b = '6f1c0a4e-1111-4222-8333-000000000002'
    const out = repo.apply([{ op: 'create', input: { id: a, type: 'database', parentId: p.id, props: { sourceId: db.id } } }])
    expect(out.find((x) => x.id === a)!.props.sourceId).toBe(db.id)
    expect(() =>
      repo.apply([
        { op: 'create', input: { id: b, type: 'database', parentId: p.id, props: { sourceId: db.id } } },
        { op: 'update', id: b, patch: { props: { sourceId: b } } }
      ])
    ).toThrow(/itself/)
    expect(repo.get(b)).toBeNull()
  })
})

describe('deleting', () => {
  it('hard-deletes a linked view and leaves its source and rows alone', () => {
    const p = page('P')
    const { db, rows } = source(p.id)
    const v = link(p.id, db.id)
    const before = repo.get(db.id)!
    repo.drainChanges()

    repo.delete(v.id)
    expect(repo.get(v.id)).toBeNull()
    expect(repo.listTrash()).toEqual([])
    expect(repo.get(p.id)!.content).toEqual([db.id])
    expect(repo.get(db.id)).toEqual(before)
    expect(ids(repo.children(db.id))).toEqual(ids(rows))
    // Nothing about the source is announced as changed.
    const changed = repo.drainChanges()
    expect(changed).toContain(v.id)
    expect(changed).not.toContain(db.id)
    for (const r of rows) expect(changed).not.toContain(r.id)
  })

  it('removes a linked view with the block that holds it instead of trashing it', () => {
    const p = page('P')
    const { db } = source(p.id)
    const toggle = repo.create({ type: 'toggle', parentId: p.id })
    const v = link(toggle.id, db.id)
    const nested = page('Nested', toggle.id)
    repo.delete(toggle.id)
    expect(repo.get(v.id)).toBeNull()
    // Real pages in the same holder still go to the trash.
    expect(ids(repo.listTrash())).toEqual([nested.id])
    expect(repo.get(db.id)!.trashedAt).toBeNull()
  })

  it('trashes a source as before; its views survive and heal on restore', () => {
    const p = page('P')
    const q = page('Q')
    const { db, rows } = source(p.id)
    const v = link(q.id, db.id)

    repo.delete(db.id)
    expect(repo.get(db.id)!.trashedAt).not.toBeNull()
    expect(ids(repo.listTrash())).toEqual([db.id])
    // The view and the page holding it are untouched; the rows wait in the trashed source.
    expect(repo.get(v.id)!.props.sourceId).toBe(db.id)
    expect(repo.get(q.id)!.content).toEqual([v.id])
    expect(ids(repo.getTree(q.id))).toEqual([q.id, v.id])
    expect(ids(repo.children(db.id))).toEqual(ids(rows))
    expect(repo.listDatabases()).toEqual([])
    // A new view of a trashed source can still be written (undo of a removal relies on it).
    expect(() => link(q.id, db.id)).not.toThrow()

    repo.restore(db.id)
    expect(repo.get(db.id)!.trashedAt).toBeNull()
    expect(ids(repo.listDatabases())).toEqual([db.id])
    expect(ids(repo.children(repo.get(v.id)!.props.sourceId!))).toEqual(ids(rows))
  })

  it('leaves views dangling but harmless when the source is deleted forever', () => {
    const p = page('P')
    const q = page('Q')
    const { db, rows } = source(p.id)
    const v = link(q.id, db.id)
    repo.deleteForever(db.id)
    expect(repo.get(db.id)).toBeNull()
    for (const r of rows) expect(repo.get(r.id)).toBeNull()
    expect(repo.get(v.id)!.props.sourceId).toBe(db.id)
    expect(ids(repo.getTree(q.id))).toEqual([q.id, v.id])
    expect(repo.children(v.id)).toEqual([])
    expect(repo.databaseLocations(db.id).map((l) => l.block.id)).toEqual([v.id])
    expect(pageToMarkdown(repo, q.id).markdown).toBe('# Q\n')
    expect(() => repo.duplicate(q.id)).not.toThrow()
    expect(() => repo.search('report')).not.toThrow()
  })

  it('deleting a page for good takes the linked views inside it, not their source', () => {
    const p = page('P')
    const q = page('Q')
    const { db, rows } = source(p.id)
    const v = link(q.id, db.id)
    repo.delete(q.id)
    expect(repo.databaseLocations(db.id)).toEqual([])
    repo.deleteForever(q.id)
    expect(repo.get(v.id)).toBeNull()
    expect(ids(repo.children(db.id))).toEqual(ids(rows))
  })
})

describe('duplicate', () => {
  it('copies a linked view as another view of the same source, not a copy of the rows', () => {
    const p = page('P')
    const q = page('Q')
    const { db, rows } = source(p.id)
    const v = link(q.id, db.id, { title: [['My tasks']] })

    const copy = repo.duplicate(q.id)
    const [cv] = repo.children(copy.id)
    expect(cv.id).not.toBe(v.id)
    expect(cv.props.sourceId).toBe(db.id)
    expect(cv.props.title).toEqual([['My tasks']])
    expect(cv.content).toEqual([])
    expect(ids(repo.children(db.id))).toEqual(ids(rows))
    expect(ids(repo.databaseLocations(db.id).map((l) => l.block)).sort()).toEqual([v.id, cv.id].sort())
  })

  it('duplicating a linked view itself keeps the source title showing through', () => {
    const p = page('P')
    const { db } = source(p.id)
    const untitled = link(p.id, db.id)
    const titled = link(p.id, db.id, { title: [['Mine']] })
    expect(repo.duplicate(untitled.id).props.title).toBeUndefined()
    expect(repo.duplicate(titled.id).props.title).toEqual([['Mine'], [' (copy)']])
    expect(repo.duplicate(untitled.id).props.sourceId).toBe(db.id)
  })

  it('deep-copies a source and re-points the views copied along with it', () => {
    const p = page('P')
    const outside = page('Outside')
    const { db, rows } = source(p.id)
    // One view before the source in the page, one after, one nested deeper, one elsewhere.
    const before = repo.create({ type: 'database', parentId: p.id, afterId: null, props: { sourceId: db.id } })
    const after = link(p.id, db.id)
    const toggle = repo.create({ type: 'toggle', parentId: p.id })
    const deep = link(toggle.id, db.id)
    const elsewhere = link(outside.id, db.id)
    const foreign = source(outside.id, 'Foreign').db
    const toForeign = link(p.id, foreign.id)

    const copy = repo.duplicate(p.id)
    const kids = repo.children(copy.id)
    expect(kids.map((k) => k.type)).toEqual(['database', 'database', 'database', 'toggle', 'database'])
    const [cBefore, cDb, cAfter, cToggle, cToForeign] = kids
    const [cDeep] = repo.children(cToggle.id)

    // The source was copied with its rows...
    expect(cDb.id).not.toBe(db.id)
    expect(cDb.props.sourceId).toBeUndefined()
    expect(cDb.props.schema).toEqual(db.props.schema)
    const copiedRows = repo.children(cDb.id)
    expect(copiedRows.map((r) => r.props.title)).toEqual(rows.map((r) => r.props.title))
    for (const r of copiedRows) expect(ids(rows)).not.toContain(r.id)
    // ...and every view inside the copy follows the copied source,
    for (const v of [cBefore, cAfter, cDeep]) expect(v.props.sourceId).toBe(cDb.id)
    // while a view of a database outside the copy keeps its source,
    expect(cToForeign.props.sourceId).toBe(foreign.id)
    // and the originals are exactly as they were.
    for (const v of [before, after, deep, elsewhere]) expect(repo.get(v.id)!.props.sourceId).toBe(db.id)
    expect(repo.get(toForeign.id)!.props.sourceId).toBe(foreign.id)
    expect(ids(repo.databaseLocations(db.id).map((l) => l.block)).sort()).toEqual(ids([before, after, deep, elsewhere]).sort())
    expect(ids(repo.databaseLocations(cDb.id).map((l) => l.block)).sort()).toEqual(ids([cBefore, cAfter, cDeep]).sort())
  })
})

describe('databases.list / databases.locations', () => {
  it('lists live sources, most recently edited first, without linked views', () => {
    const p = page('P')
    const a = source(p.id, 'A').db
    const b = source(null, 'B').db
    const gone = source(p.id, 'Gone').db
    const hidden = page('Hidden')
    const inTrash = source(hidden.id, 'In a trashed page').db
    link(p.id, a.id)
    repo.delete(gone.id)
    repo.delete(hidden.id)
    expect(ids(repo.listDatabases())).toEqual([b.id, a.id])
    expect(inTrash.trashedAt).toBeNull()

    // Editing a database (a new row, a rename) moves it to the front.
    repo.create({ type: 'page', parentId: a.id, props: { title: [['New row']] } })
    expect(ids(repo.listDatabases())).toEqual([a.id, b.id])
    const listed = repo.listDatabases()[0]
    expect(listed.props.title).toEqual([['A']])
    expect(listed.props.icon).toBe('📋')
    expect(listed.parentId).toBe(p.id)
    expect(repo.ancestors(listed.id).map((x) => x.id)).toEqual([p.id])
  })

  it('reports every live linked view with the page that contains it', () => {
    const p = page('P')
    const q = page('Q')
    const { db } = source(p.id)
    const inPage = link(q.id, db.id)
    const toggle = repo.create({ type: 'toggle', parentId: q.id })
    const nested = link(toggle.id, db.id)
    const atRoot = link(null, db.id)
    const trashedHolder = page('Trashed holder')
    link(trashedHolder.id, db.id)
    repo.delete(trashedHolder.id)
    const other = source(p.id, 'Other').db
    link(q.id, other.id)

    const locations = repo.databaseLocations(db.id)
    expect(locations.map((l) => [l.block.id, l.page?.id ?? null])).toEqual([
      [inPage.id, q.id],
      [nested.id, q.id],
      [atRoot.id, null]
    ])
    expect(locations[0].page!.props.title).toEqual([['Q']])
    expect(locations[0].block.props.sourceId).toBe(db.id)
    // Asked about one of the views, it answers for the source.
    expect(ids(repo.databaseLocations(nested.id).map((l) => l.block))).toEqual(ids([inPage, nested, atRoot]))
    expect(repo.databaseLocations(other.id)).toHaveLength(1)
    expect(repo.databaseLocations('missing')).toEqual([])
    expect(repo.databaseLocations('not an id')).toEqual([])
    expect(repo.databaseLocations(p.id)).toEqual([])
  })

  it('shows linked views among the pages of the sidebar tree', () => {
    const p = page('P')
    const { db } = source(p.id)
    const v = link(p.id, db.id)
    expect(ids(repo.listChildren(p.id))).toEqual([db.id, v.id])
  })
})

describe('search', () => {
  it('finds a row once, however many views show it', () => {
    const p = page('P')
    const q = page('Q')
    const { db, rows } = source(p.id)
    link(q.id, db.id)
    link(q.id, db.id)
    link(p.id, db.id)
    const hits = repo.search('report')
    expect(ids(hits as unknown as Block[])).toEqual([rows[0].id])
    expect(hits[0].path).toEqual(['P', 'Tasks'])
  })

  it('returns the source for a database, never its linked views', () => {
    const p = page('P')
    const { db } = source(p.id)
    link(p.id, db.id)
    link(p.id, db.id, { title: [['Tasks for the week']] })
    expect(repo.search('tasks').map((h) => h.id)).toEqual([db.id])
    expect(repo.search('week')).toEqual([])
  })
})

describe('markdown export', () => {
  const table = (...rows: string[]): string[] => ['| Name | Status |', '| --- | --- |', ...rows]

  it('exports a linked view as the source table with the columns of its own view', () => {
    const p = page('P')
    const q = page('Q')
    const { db } = source(p.id)
    link(q.id, db.id, { views: [view('all', ['title', 'st'])] })
    link(q.id, db.id, { title: [['Names only']], views: [view('names', ['title'])] })

    expect(pageToMarkdown(repo, q.id).markdown).toBe(
      [
        '# Q',
        '',
        '**Tasks**',
        '',
        ...table('| Write report | Done |', '| Call Ada |  |'),
        '',
        '**Names only**',
        '',
        '| Name |',
        '| --- |',
        '| Write report |',
        '| Call Ada |',
        ''
      ].join('\n')
    )
  })

  it('exports a full-page linked view under the source title unless it has its own', () => {
    const p = page('P')
    const { db } = source(p.id)
    const plain = link(null, db.id, { views: [view('all', ['title', 'st'])] })
    const named = link(null, db.id, { title: [['Mine']], views: [view('all', ['title', 'st'])] })
    const body = table('| Write report | Done |', '| Call Ada |  |')
    expect(pageToMarkdown(repo, plain.id)).toEqual({ title: 'Tasks', markdown: ['# Tasks', '', ...body, ''].join('\n') })
    expect(pageToMarkdown(repo, named.id)).toEqual({ title: 'Mine', markdown: ['# Mine', '', ...body, ''].join('\n') })
  })

  it('exports nothing for a view whose source is in the trash', () => {
    const p = page('P')
    const q = page('Q')
    const { db } = source(p.id)
    link(q.id, db.id)
    const named = link(q.id, db.id, { title: [['Mine']] })
    repo.delete(db.id)
    expect(pageToMarkdown(repo, q.id).markdown).toBe('# Q\n\n**Mine**\n')
    expect(pageToMarkdown(repo, named.id).markdown).toBe('# Mine\n')
    repo.restore(db.id)
    expect(pageToMarkdown(repo, named.id).markdown).toContain('| Write report |')
  })
})
