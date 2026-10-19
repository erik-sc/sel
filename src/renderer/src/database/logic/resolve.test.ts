// Linked views: which database a block resolves to, and what it is rendered with.
import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType, DatabaseView } from '../../../../shared/types'
import * as L from '../logic'

function block(id: string, type: BlockType, parentId: string | null, props: unknown = {}, extra: Partial<Block> = {}): Block {
  return { id, type, parentId, content: [], props: props as BlockProps, createdAt: 1, updatedAt: 1, trashedAt: null, ...extra }
}

const schema: L.Schema = {
  title: { id: 'title', name: 'Name', type: 'title' },
  st: { id: 'st', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'Done', color: 'green' }] },
  due: { id: 'due', name: 'Due', type: 'date' }
}

const view = (id: string, patch: Partial<DatabaseView> = {}): DatabaseView => ({
  id,
  name: 'Table',
  type: 'table',
  visibleProperties: ['title', 'st'],
  filters: [],
  sorts: [],
  ...patch
})

const sourceViews = [view('sv')]
const source = block('src', 'database', 'home', { title: [['Tasks']], icon: '📋', schema, views: sourceViews }, { content: ['r1', 'r2'] })
const home = block('home', 'page', null, { title: [['Home']] })

function lookupOf(blocks: Block[], missing: string[] = []): L.BlockLookup {
  const map = new Map(blocks.map((b) => [b.id, b]))
  return { get: (id) => map.get(id), isMissing: (id) => missing.includes(id) }
}

const linkedTo = (sourceId: unknown, props: Record<string, unknown> = {}): Block =>
  block('lv', 'database', 'elsewhere', { views: [view('mine')], ...props, sourceId })

describe('resolveDatabase', () => {
  it('resolves an ordinary database to itself', () => {
    const r = L.resolveDatabase(source, lookupOf([]))
    expect(r).toEqual({ view: source, source, status: 'ok', linked: false, sourceId: null, trashedId: null })
  })

  it('resolves a linked view to its source', () => {
    const lv = linkedTo('src')
    const r = L.resolveDatabase(lv, lookupOf([source, home]))
    expect(r.view).toBe(lv)
    expect(r.source).toBe(source)
    expect(r).toMatchObject({ status: 'ok', linked: true, sourceId: 'src', trashedId: null })
  })

  it('tells "not loaded yet" from "does not exist"', () => {
    const lv = linkedTo('src')
    expect(L.resolveDatabase(lv, lookupOf([]))).toMatchObject({ source: null, status: 'loading', linked: true, sourceId: 'src' })
    expect(L.resolveDatabase(lv, lookupOf([], ['src']))).toMatchObject({ source: null, status: 'missing' })
    // Without a way to know, it is still loading: nothing is declared deleted by guesswork.
    expect(L.resolveDatabase(lv, { get: () => undefined }).status).toBe('loading')
  })

  it('reports a trashed source, and which block to restore', () => {
    const lv = linkedTo('src')
    const trashed = { ...source, trashedAt: 5 }
    expect(L.resolveDatabase(lv, lookupOf([trashed, home]))).toMatchObject({ source: null, status: 'trashed', trashedId: 'src' })
    // In the trash because the page it sits in is.
    const trashedHome = { ...home, trashedAt: 5 }
    expect(L.resolveDatabase(lv, lookupOf([source, trashedHome]))).toMatchObject({ source: null, status: 'trashed', trashedId: 'home' })
    // An ancestor that is not loaded says nothing either way.
    expect(L.resolveDatabase(lv, lookupOf([source])).status).toBe('ok')
  })

  it('never follows a chain, a non-database or a link to itself', () => {
    const other = block('other', 'database', null, { sourceId: 'src', views: [] })
    expect(L.resolveDatabase(linkedTo('other'), lookupOf([other, source]))).toMatchObject({ source: null, status: 'missing' })
    expect(L.resolveDatabase(linkedTo('home'), lookupOf([home]))).toMatchObject({ source: null, status: 'missing' })
    // A block that points at itself is not a linked view at all: it is its own (ordinary) database.
    const self = block('lv', 'database', null, { sourceId: 'lv', schema, views: sourceViews })
    expect(L.resolveDatabase(self, lookupOf([self]))).toMatchObject({ source: self, status: 'ok', linked: false })
  })

  it.each([[7], [null], [{}], [['src']], ['has spaces'], ['x'.repeat(65)], ['']])('ignores a malformed sourceId (%j)', (bad) => {
    const lv = linkedTo(bad, { schema, views: sourceViews })
    expect(L.sourceIdOf(lv)).toBeNull()
    expect(L.resolveDatabase(lv, lookupOf([source]))).toMatchObject({ source: lv, linked: false, status: 'ok' })
  })

  it('survives a parent cycle above the source', () => {
    const a = block('src', 'database', 'b', { schema, views: sourceViews })
    const b = block('b', 'page', 'src')
    expect(L.resolveDatabase(linkedTo('src'), lookupOf([a, b])).status).toBe('ok')
  })
})

describe('normalizeResolved', () => {
  const resolve = (lv: Block, src: Block = source): L.ResolvedDatabase => L.resolveDatabase(lv, lookupOf([src, home]))

  it('is normalizeDatabase for an ordinary database', () => {
    const r = L.resolveDatabase(source, lookupOf([]))
    expect(L.normalizeResolved(r)).toBe(L.normalizeDatabase(source))
    expect(L.normalizeResolved(undefined)).toEqual(L.normalizeDatabase(undefined))
  })

  it('takes the schema from the source and the views from the linked block', () => {
    const lv = linkedTo('src')
    const n = L.normalizeResolved(resolve(lv))
    expect(n.schema).toBe(L.normalizeDatabase(source).schema)
    expect(n.views).toBe(lv.props.views)
    expect(n.changed).toBe(false)
    expect(n.views).not.toBe(sourceViews)
  })

  it('ignores a schema stored on the linked block', () => {
    const lv = linkedTo('src', { schema: { title: { id: 'title', name: 'Mine', type: 'title' }, x: { id: 'x', name: 'X', type: 'text' } } })
    const n = L.normalizeResolved(resolve(lv))
    expect(Object.keys(n.schema)).toEqual(['title', 'st', 'due'])
    expect(n.schema.title.name).toBe('Name')
  })

  it('validates the views against the source schema', () => {
    const lv = linkedTo('src', {
      views: [
        view('a', {
          visibleProperties: ['st', 'gone', 'st'],
          filters: [
            { propertyId: 'st', operator: 'equals', value: 'o1' },
            { propertyId: 'gone', operator: 'contains', value: 'x' },
            { propertyId: 'st', operator: 'equals', value: 'deleted-option' }
          ],
          sorts: [
            { propertyId: 'gone', direction: 'asc' },
            { propertyId: 'due', direction: 'desc' }
          ],
          propertyWidths: { st: 200, gone: 90 },
          groupBy: 'gone'
        }),
        'not a view',
        view('a', { name: 'Duplicate id' }),
        view('cal', { type: 'calendar', groupBy: 'st' })
      ]
    })
    const n = L.normalizeResolved(resolve(lv))
    expect(n.changed).toBe(true)
    expect(n.views.map((v) => v.id)).toEqual(['a', 'default-view-2', 'cal'])
    const [a, , cal] = n.views
    // The title is always shown; references to properties the source does not have are gone.
    expect(a.visibleProperties).toEqual(['title', 'st'])
    expect(a.filters.map((f) => f.propertyId)).toEqual(['st', 'st'])
    expect(a.filters[1].value).toBeUndefined()
    expect(a.sorts).toEqual([{ propertyId: 'due', direction: 'desc' }])
    expect(a.propertyWidths).toEqual({ st: 200 })
    expect(a.groupBy).toBeUndefined()
    // A calendar needs a date property: it is pointed at the source's.
    expect(cal.groupBy).toBe('due')
  })

  it('gives a linked view without usable views one default table of the source', () => {
    for (const views of [undefined, 'nope', [], [null, 7]]) {
      const n = L.normalizeResolved(resolve(linkedTo('src', { views })))
      expect(n.changed).toBe(true)
      expect(n.views).toHaveLength(1)
      expect(n.views[0]).toMatchObject({ id: L.DEFAULT_VIEW_ID, type: 'table', visibleProperties: ['title', 'st', 'due'] })
    }
  })

  it('tolerates props that are not an object', () => {
    const lv = { ...linkedTo('src'), props: null as unknown as BlockProps }
    // No readable sourceId: not a linked view, normalised as a (broken) database of its own.
    expect(L.resolveDatabase(lv, lookupOf([source])).linked).toBe(false)
    expect(() => L.normalizeResolved(L.resolveDatabase(lv, lookupOf([source])))).not.toThrow()
  })

  it('returns the same objects for the same stored data, whatever happens to the rows', () => {
    const lv = linkedTo('src')
    const first = L.normalizeResolved(resolve(lv))
    // A row was added: the source block is a new object with the same schema.
    const grown = { ...source, content: ['r1', 'r2', 'r3'] }
    const second = L.normalizeResolved(resolve(lv, grown))
    expect(second).toBe(first)
    // Repaired views are stable too.
    const broken = linkedTo('src', { views: [view('a', { visibleProperties: ['gone'] })] })
    expect(L.normalizeResolved(resolve(broken, grown)).views).toBe(L.normalizeResolved(resolve(broken)).views)
  })

  it('follows schema edits made in the source', () => {
    const lv = linkedTo('src', { views: [view('a', { visibleProperties: ['title', 'st', 'due'], groupBy: undefined })] })
    const { st: _removed, ...rest } = schema
    const edited = { ...source, props: { ...source.props, schema: rest } }
    const n = L.normalizeResolved(resolve(lv, edited))
    expect(n.views[0].visibleProperties).toEqual(['title', 'due'])
    expect(n.changed).toBe(true)
  })

  it('renders nothing and repairs nothing while the source is unavailable', () => {
    const lv = linkedTo('src', {
      views: [view('a', { visibleProperties: ['title', 'st'], filters: [{ propertyId: 'st', operator: 'is_empty' }] })]
    })
    for (const lookup of [lookupOf([]), lookupOf([], ['src']), lookupOf([{ ...source, trashedAt: 9 }])]) {
      const n = L.normalizeResolved(L.resolveDatabase(lv, lookup))
      // `changed: false` is what keeps the stored views (and their references) from being rewritten.
      expect(n.changed).toBe(false)
    }
  })
})

describe('display title and icon', () => {
  const resolve = (props: Record<string, unknown>): L.ResolvedDatabase =>
    L.resolveDatabase(linkedTo('src', props), lookupOf([source, home]))

  it('shows the source title and icon until the view has its own', () => {
    expect(L.displayTitle(resolve({}))).toBe('Tasks')
    expect(L.displayIcon(resolve({}))).toBe('📋')
    expect(L.displayTitle(resolve({ title: [['My tasks']], icon: '⭐' }))).toBe('My tasks')
    expect(L.displayIcon(resolve({ title: [['My tasks']], icon: '⭐' }))).toBe('⭐')
    // An empty override is no override.
    expect(L.displayTitle(resolve({ title: [], icon: '' }))).toBe('Tasks')
    expect(L.displayIcon(resolve({ title: [], icon: '' }))).toBe('📋')
  })

  it('has nothing to fall back on for an ordinary database or a missing source', () => {
    const plain = block('db', 'database', null, { schema, views: sourceViews })
    expect(L.displayTitle(L.resolveDatabase(plain, lookupOf([])))).toBe('')
    expect(L.displayIcon(L.resolveDatabase(plain, lookupOf([])))).toBeUndefined()
    expect(L.displayTitle(L.resolveDatabase(linkedTo('src'), lookupOf([])))).toBe('')
    expect(L.displayTitle(undefined)).toBe('')
  })
})

describe('linkedViewProps', () => {
  let n = 0
  const newId = (): string => `id-${++n}`

  it('builds one table view over every property of the source', () => {
    const props = L.linkedViewProps(source, lookupOf([source, home]), newId)
    expect(props).toEqual({
      sourceId: 'src',
      views: [
        {
          id: expect.stringMatching(/^id-/),
          name: 'Table',
          type: 'table',
          visibleProperties: ['title', 'st', 'due'],
          filters: [],
          sorts: []
        }
      ]
    })
    // Nothing of the source travels with the link.
    expect(Object.keys(props!)).toEqual(['sourceId', 'views'])
  })

  it('links to the source when given one of its linked views', () => {
    const props = L.linkedViewProps(linkedTo('src', { title: [['Mine']] }), lookupOf([source, home]), newId)
    expect(props?.sourceId).toBe('src')
    expect(props?.title).toBeUndefined()
  })

  it('refuses anything that is not a usable database', () => {
    expect(L.linkedViewProps(undefined, lookupOf([]), newId)).toBeNull()
    expect(L.linkedViewProps(home, lookupOf([home]), newId)).toBeNull()
    expect(L.linkedViewProps(linkedTo('src'), lookupOf([]), newId)).toBeNull()
    expect(L.linkedViewProps(linkedTo('src'), lookupOf([{ ...source, trashedAt: 3 }]), newId)).toBeNull()
  })

  it('repairs a malformed source schema in the view it derives, without touching the source', () => {
    const broken = block('src', 'database', null, { schema: { a: { id: 'a', name: 'A', type: 'text' } }, views: [] })
    const props = L.linkedViewProps(broken, lookupOf([broken]), newId)
    // The normalised schema always has a title; the view shows it first.
    expect(props?.views?.[0].visibleProperties).toEqual(['title', 'a'])
    expect(broken.props.schema).toEqual({ a: { id: 'a', name: 'A', type: 'text' } })
  })
})
