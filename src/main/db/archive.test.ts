import { beforeEach, describe, expect, it } from 'vitest'
import { NOTEBOOK_ID } from '../../shared/notebook'
import type { Block } from '../../shared/types'
import type { Repository } from './repository'
import { openTestRepository } from './testing'

let repo: Repository
let t: number

const ids = (blocks: Block[]): string[] => blocks.map((b) => b.id)
const page = (title: string, parentId: string | null = null): Block =>
  repo.create({ type: 'page', parentId, props: { title: [[title]] } })
const text = (title: string, parentId: string): Block => repo.create({ type: 'text', parentId, props: { title: [[title]] } })
const archive = (id: string): Block => repo.update(id, { props: { archivedAt: ++t } })
const unarchive = (id: string): Block => repo.update(id, { props: { archivedAt: null } })

beforeEach(() => {
  t = Date.UTC(2026, 9, 15, 12, 0, 0)
  repo = openTestRepository(':memory:', { clock: () => ++t })
})

describe('archiving a page', () => {
  it('takes it out of the root, children and favorites lists, and into listArchived', () => {
    const a = page('A')
    const b = page('B')
    const sub = page('Sub', a.id)
    const other = page('Other', a.id)
    const deep = page('Deep', sub.id)
    repo.update(sub.id, { props: { favorite: true } })
    repo.update(deep.id, { props: { favorite: true } })
    repo.update(b.id, { props: { favorite: true } })

    archive(b.id)
    archive(sub.id)
    expect(ids(repo.listRoot())).toEqual([a.id])
    expect(ids(repo.listChildren(a.id))).toEqual([other.id])
    // What lies inside an archived page goes with it.
    expect(ids(repo.listFavorites())).toEqual([])
    expect(ids(repo.listArchived())).toEqual([sub.id, b.id])
    // The page itself keeps its place: parent and content are untouched.
    expect(repo.get(sub.id)).toMatchObject({ parentId: a.id, trashedAt: null })
    expect(repo.get(a.id)!.content).toEqual([sub.id, other.id])
  })

  it('keeps archived pages, and what they hold, out of the recent pages', () => {
    const a = page('A')
    const sub = page('Sub', a.id)
    const inside = page('Inside', sub.id)
    text('edited', inside.id)
    archive(sub.id)
    expect(ids(repo.listRecent())).toEqual([a.id])
    expect(repo.archivedAmong([a.id, sub.id, inside.id, 'not-an-id'])).toEqual(new Set([sub.id, inside.id]))
  })

  it('lets search find archived pages and says so', () => {
    const a = page('Otters')
    const sub = page('River otters', a.id)
    text('otters swim', sub.id)
    archive(sub.id)
    const hits = repo.search('otters')
    expect(hits.find((h) => h.id === a.id)?.archived).toBeUndefined()
    expect(hits.filter((h) => h.pageId === sub.id).map((h) => h.archived)).toEqual([true])
  })

  it('puts the page back where it was when it is unarchived', () => {
    const a = page('A')
    const b = page('B')
    const c = page('C')
    const one = page('One', b.id)
    const two = page('Two', b.id)
    const three = page('Three', b.id)
    archive(b.id)
    archive(two.id)
    // Things change around them meanwhile.
    const d = page('D')
    repo.move(c.id, null, null)
    expect(ids(repo.listRoot())).toEqual([c.id, a.id, d.id])
    unarchive(b.id)
    unarchive(two.id)
    expect(ids(repo.listRoot())).toEqual([c.id, a.id, b.id, d.id])
    expect(ids(repo.listChildren(b.id))).toEqual([one.id, two.id, three.id])
    expect(repo.get(b.id)!.props.archivedAt).toBeUndefined()
    expect(repo.listArchived()).toEqual([])
  })

  it('leaves the archived page editable', () => {
    const p = page('P')
    archive(p.id)
    const t1 = text('still writing', p.id)
    expect(repo.update(p.id, { props: { title: [['Renamed']] } }).props.archivedAt).toBeTypeOf('number')
    expect(repo.get(p.id)!.content).toEqual([t1.id])
  })

  it('works for a database of the tree', () => {
    const p = page('P')
    const db = repo.create({ type: 'database', parentId: p.id, props: { title: [['Reading list']] } })
    archive(db.id)
    expect(repo.listChildren(p.id)).toEqual([])
    expect(ids(repo.listArchived())).toEqual([db.id])
    expect(ids(repo.listDatabases())).toEqual([db.id])
    expect(repo.listDatabases({ archived: false })).toEqual([])
  })
})

describe('what cannot be archived', () => {
  it('refuses built-in blocks, linked views, database rows and ordinary blocks', () => {
    const tasks = repo.create({ type: 'database', parentId: null, props: { title: [['Tasks']], system: 'tasks' } })
    expect(() => archive(tasks.id)).toThrow(/built-in/)
    const notebook = repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { system: 'notebook' } })
    expect(() => archive(notebook.id)).toThrow(/built-in/)

    const source = repo.create({ type: 'database', parentId: null, props: { title: [['Source']] } })
    const linked = repo.create({ type: 'database', parentId: null, props: { sourceId: source.id } })
    expect(() => archive(linked.id)).toThrow(/linked view/)

    const row = repo.create({ type: 'page', parentId: source.id, props: { title: [['Row']] } })
    expect(() => archive(row.id)).toThrow(/database row/)

    const p = page('P')
    const block = text('t', p.id)
    expect(() => archive(block.id)).toThrow(/Only pages and databases/)

    expect(() => repo.update(p.id, { props: { archivedAt: 'yesterday' as never } })).toThrow(/Invalid archivedAt/)
    expect(() => repo.update(p.id, { props: { archivedAt: -1 } })).toThrow(/Invalid archivedAt/)
    expect(repo.listArchived()).toEqual([])
  })

  it('never creates a block that is already archived', () => {
    const p = repo.create({ type: 'page', parentId: null, props: { title: [['P']], archivedAt: 5 } })
    expect(p.props.archivedAt).toBeUndefined()
    expect(ids(repo.listRoot())).toEqual([p.id])
  })
})

describe('archive and the trash', () => {
  it('sends an archived page to the trash and brings it back still archived', () => {
    const a = page('A')
    const sub = page('Sub', a.id)
    archive(sub.id)
    repo.delete(sub.id)
    expect(repo.listArchived()).toEqual([])
    expect(ids(repo.listTrash())).toEqual([sub.id])
    repo.restore(sub.id)
    expect(repo.get(sub.id)).toMatchObject({ parentId: a.id, trashedAt: null })
    expect(repo.get(sub.id)!.props.archivedAt).toBeTypeOf('number')
    expect(ids(repo.listArchived())).toEqual([sub.id])
    expect(repo.listChildren(a.id)).toEqual([])
  })

  it('leaves archived pages under a trashed page out of the archive', () => {
    const a = page('A')
    const sub = page('Sub', a.id)
    archive(sub.id)
    repo.delete(a.id)
    expect(repo.listArchived()).toEqual([])
  })
})

describe('copies and versions', () => {
  it('does not archive the copy of an archived page', () => {
    const p = page('P')
    archive(p.id)
    const copy = repo.duplicate(p.id)
    expect(copy.props.archivedAt).toBeUndefined()
    expect(ids(repo.listRoot())).toEqual([copy.id])
  })

  it('keeps archiving out of the history: a restore keeps the page as archived as it is now', () => {
    const p = page('P')
    text('a', p.id)
    archive(p.id)
    const saved = repo.saveVersion(p.id, 'Archived then')
    expect(repo.getVersion(saved.id).blocks[0].props.archivedAt).toBeUndefined()

    unarchive(p.id)
    repo.restoreVersion(saved.id, 'replace')
    expect(repo.get(p.id)!.props.archivedAt).toBeUndefined()

    archive(p.id)
    repo.restoreVersion(saved.id, 'replace')
    expect(repo.get(p.id)!.props.archivedAt).toBeTypeOf('number')

    const copy = repo.restoreVersion(saved.id, 'copy')
    expect(repo.get(copy.pageId)!.props.archivedAt).toBeUndefined()
  })
})
