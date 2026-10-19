import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '../../../../shared/types'
import * as L from '../logic'

/** Persisted JSON as it could come back from disk: parsed, never type-checked. */
function parsed<T>(json: string): T {
  return JSON.parse(json) as T
}

function block(props: unknown, extra: Partial<Block> = {}): Block {
  return {
    id: 'db',
    type: 'database',
    parentId: null,
    content: [],
    props: props as Block['props'],
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    ...extra
  }
}

function row(props: unknown, extra: Partial<Block> = {}): Block {
  return block(props, { id: 'row', type: 'page', parentId: 'db', ...extra })
}

const select: PropertySchema = {
  id: 'sel',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'a', name: 'A', color: 'red' },
    { id: 'b', name: 'B', color: 'blue' }
  ]
}

describe('normalizeDatabase: shape of the result', () => {
  it.each([
    ['undefined block', undefined],
    ['null props', block(null)],
    ['string props', block('oops')],
    ['array props', block([])],
    ['schema is a string', block({ schema: 'x', views: 'y' })],
    ['schema is an array', block({ schema: [1, 2], views: {} })],
    ['schema of junk', block({ schema: { a: 1, b: null, c: [], d: 'x', e: { type: 'nope' } }, views: [1, null, 'v', []] })]
  ])('%s yields a title property and one table view', (_name, input) => {
    const out = L.normalizeDatabase(input as Block | undefined)
    const props = Object.values(out.schema)
    expect(props).toHaveLength(1)
    expect(props[0]).toEqual({ id: L.DEFAULT_TITLE_ID, name: 'Name', type: 'title' })
    expect(out.views).toHaveLength(1)
    expect(out.views[0]).toMatchObject({ type: 'table', visibleProperties: [L.DEFAULT_TITLE_ID], filters: [], sorts: [] })
    expect(out.changed).toBe(true)
  })

  it('is idempotent: normalising its own output changes nothing and keeps references', () => {
    const dirty = block({
      schema: { t: { type: 'title' }, sel: { ...select, options: [null, { id: 'a' }, { id: 'a', name: 'dup' }] } },
      views: [{ type: 'board', groupBy: 'nope', filters: [{ propertyId: 'sel', operator: 'equals', value: 'zzz' }] }]
    })
    const first = L.normalizeDatabase(dirty)
    expect(first.changed).toBe(true)
    const second = L.normalizeDatabase(block({ schema: first.schema, views: first.views }))
    expect(second.changed).toBe(false)
    expect(second.schema).toBe(first.schema)
    expect(second.views).toBe(first.views)
  })

  it('returns the very same result for the same stored objects (identity cache)', () => {
    const props = { schema: { t: { id: 't', name: 'Name', type: 'title' } }, views: [] }
    const a = L.normalizeDatabase(block(props))
    // A new block / props object around the same schema and views, as after adding a row.
    const b = L.normalizeDatabase(block({ ...props }, { content: ['r1'] }))
    expect(b).toBe(a)
    expect(L.normalizeDatabase(block({ ...props, views: [] }))).not.toBe(a)
  })
})

describe('normalizeDatabase: schema', () => {
  it('never lets a prototype key act as a property', () => {
    const hostile = parsed<Block['props']>(
      `{"schema":{"__proto__":{"id":"__proto__","name":"P","type":"text"},"constructor":{"id":"constructor","name":"C","type":"text"},
        "toString":{"id":"toString","name":"S","type":"text"},"t":{"id":"t","name":"Name","type":"title"}},
        "views":[{"id":"v","name":"V","type":"table","visibleProperties":["constructor","__proto__","t"],
        "filters":[{"propertyId":"constructor","operator":"contains","value":"x"},{"propertyId":"hasOwnProperty","operator":"is_empty"}],
        "sorts":[{"propertyId":"toString","direction":"asc"},{"propertyId":"valueOf","direction":"asc"}],"groupBy":"__proto__"}]}`
    )
    const out = L.normalizeDatabase(block(hostile))
    expect(Object.keys(out.schema)).toEqual(['t'])
    expect(out.views[0].visibleProperties).toEqual(['t'])
    expect(out.views[0].filters).toEqual([])
    expect(out.views[0].sorts).toEqual([])
    expect(out.views[0].groupBy).toBeUndefined()
    expect(Object.getPrototypeOf(out.schema)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).name).toBeUndefined()
  })

  it('propOf only resolves own properties', () => {
    const schema: L.Schema = { t: { id: 't', name: 'Name', type: 'title' } }
    expect(L.propOf(schema, 't')).toBe(schema.t)
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'missing', 5, null, undefined, {}]) {
      expect(L.propOf(schema, id)).toBeUndefined()
    }
    expect(L.propOf(undefined, 't')).toBeUndefined()
  })

  it('rejects unknown types, including names that exist on Object.prototype', () => {
    const out = L.normalizeDatabase(
      block({ schema: { a: { type: 'constructor' }, b: { type: 'toString' }, c: { type: 42 }, d: { type: 'text' } } })
    )
    expect(Object.keys(out.schema)).toEqual([L.DEFAULT_TITLE_ID, 'd'])
  })

  it('repairs ids, names, options and number formats', () => {
    const out = L.normalizeDatabase(
      block({
        schema: {
          t: { id: 'other', name: 7, type: 'title' },
          long: { id: 'long', name: 'x'.repeat(5000), type: 'text', options: [{ id: 'stale' }] },
          blank: { id: 'blank', name: '   ', type: 'number', numberFormat: 'hex' },
          sel: {
            id: 'sel',
            name: 'Status',
            type: 'select',
            options: [
              null,
              'x',
              { id: 'ok', name: 'OK', color: 'green' },
              { id: 'ok', name: 'duplicate id', color: 'red' },
              { id: '__proto__', name: 'proto', color: 'red' },
              { id: 5, name: 'numeric id' },
              { id: 'noname', color: {} },
              { id: 'longname', name: 'n'.repeat(999), color: 'blue' }
            ]
          },
          multi: { id: 'multi', name: 'Tags', type: 'multi_select', options: { not: 'an array' } },
          sel2: { id: 'sel2', name: 'No options', type: 'select' }
        }
      })
    ).schema
    expect(out.t).toEqual({ id: 't', name: 'Title', type: 'title' })
    expect(out.long.name).toHaveLength(L.MAX_NAME_LENGTH)
    expect(out.long.options).toBeUndefined()
    expect(out.blank).toEqual({ id: 'blank', name: 'Number', type: 'number' })
    expect(out.sel.options).toEqual([
      { id: 'ok', name: 'OK', color: 'green' },
      { id: 'noname', name: 'Untitled', color: 'gray' },
      { id: 'longname', name: 'n'.repeat(L.MAX_NAME_LENGTH), color: 'blue' }
    ])
    expect(out.multi.options).toEqual([])
    expect(out.sel2.options).toEqual([])
  })

  it('keeps exactly one title', () => {
    const out = L.normalizeDatabase(
      block({ schema: { a: { id: 'a', name: 'A', type: 'title' }, b: { id: 'b', name: 'B', type: 'title' } } })
    ).schema
    expect(Object.values(out).map((p) => p.type)).toEqual(['title', 'text'])
  })
})

describe('normalizeDatabase: views', () => {
  const schema = {
    t: { id: 't', name: 'Name', type: 'title' },
    n: { id: 'n', name: 'N', type: 'number' },
    d: { id: 'd', name: 'D', type: 'date' },
    sel: select,
    tags: { ...select, id: 'tags', type: 'multi_select' }
  }
  const viewsOf = (views: unknown): DatabaseView[] => L.normalizeDatabase(block({ schema, views })).views

  it('repairs ids, names and types and makes ids unique', () => {
    const views = viewsOf([
      { id: 'same', name: 'A', type: 'table' },
      { id: 'same', name: 'B', type: 'kanban' },
      { id: 9, name: '', type: 'list' },
      { id: '__proto__', name: 'x'.repeat(500), type: 'gallery' }
    ])
    expect(new Set(views.map((v) => v.id)).size).toBe(4)
    expect(views.map((v) => v.type)).toEqual(['table', 'table', 'list', 'gallery'])
    expect(views[2].name).toBe('List')
    expect(views[3].name).toHaveLength(L.MAX_NAME_LENGTH)
    for (const v of views) expect(v.visibleProperties[0]).toBe('t')
  })

  it('tolerates wrong-typed collections', () => {
    const [v] = viewsOf([
      { id: 'v', name: 'V', type: 'table', visibleProperties: 'tn', filters: { a: 1 }, sorts: 5, propertyWidths: [1, 2], groupBy: { x: 1 } }
    ])
    expect(v).toEqual({ id: 'v', name: 'V', type: 'table', visibleProperties: ['t'], filters: [], sorts: [] })
  })

  it('drops dangling and malformed filters, and values that do not fit the property', () => {
    const [v] = viewsOf([
      {
        id: 'v',
        name: 'V',
        type: 'table',
        visibleProperties: ['t', 'gone', 'n', 'n', 3],
        filters: [
          null,
          'x',
          { propertyId: 'gone', operator: 'equals', value: 1 },
          { propertyId: 'n', operator: 'contains', value: 1 },
          { propertyId: 'n', operator: 'gt', value: 'abc' },
          { propertyId: 'n', operator: 'gt', value: '12' },
          { propertyId: 'n', operator: 'is_empty', value: 'ignored' },
          { propertyId: 'sel', operator: 'equals', value: 'deleted-option' },
          { propertyId: 'sel', operator: 'equals', value: 'a' },
          { propertyId: 'tags', operator: 'contains', value: ['a', 'deleted', 7] },
          { propertyId: 'tags', operator: 'contains', value: 'b' },
          { propertyId: 'd', operator: 'equals', value: '2024-02-31' },
          { propertyId: 'd', operator: 'lt', value: '2024-02-29T10:00:00Z' },
          { propertyId: 't', operator: 'contains', value: { start: 1 } }
        ]
      }
    ])
    expect(v.visibleProperties).toEqual(['t', 'n'])
    expect(v.filters).toEqual([
      { propertyId: 'n', operator: 'gt' },
      { propertyId: 'n', operator: 'gt', value: 12 },
      { propertyId: 'n', operator: 'is_empty' },
      { propertyId: 'sel', operator: 'equals' },
      { propertyId: 'sel', operator: 'equals', value: 'a' },
      { propertyId: 'tags', operator: 'contains', value: ['a'] },
      { propertyId: 'tags', operator: 'contains', value: 'b' },
      { propertyId: 'd', operator: 'equals' },
      { propertyId: 'd', operator: 'lt', value: '2024-02-29' },
      { propertyId: 't', operator: 'contains' }
    ])
  })

  it('normalises sorts and widths', () => {
    const [v] = viewsOf([
      {
        id: 'v',
        name: 'V',
        type: 'table',
        visibleProperties: ['t'],
        filters: [],
        sorts: [
          { propertyId: 'n', direction: 'sideways' },
          { propertyId: 'n', direction: 'desc' },
          { propertyId: 'gone', direction: 'asc' },
          { propertyId: 't', direction: 'desc' },
          7
        ],
        propertyWidths: { t: 5, n: '200', gone: 100, d: Infinity, sel: 1e9, tags: 150.4 }
      }
    ])
    expect(v.sorts).toEqual([
      { propertyId: 'n', direction: 'asc' },
      { propertyId: 't', direction: 'desc' }
    ])
    expect(v.propertyWidths).toEqual({ t: L.MIN_COLUMN_WIDTH, sel: L.MAX_COLUMN_WIDTH, tags: 150 })
  })

  it('gives board and calendar views a groupBy of the right type, or none', () => {
    const views = viewsOf([
      { id: 'b', name: 'B', type: 'board', groupBy: 'd' },
      { id: 'c', name: 'C', type: 'calendar', groupBy: 'sel' },
      { id: 't', name: 'T', type: 'table', groupBy: 'gone' }
    ])
    expect(views.map((v) => v.groupBy)).toEqual(['sel', 'd', undefined])
    const noSelect = L.normalizeDatabase(block({ schema: { t: schema.t }, views: [{ id: 'b', name: 'B', type: 'board', groupBy: 'sel' }] }))
      .views[0]
    expect(noSelect.groupBy).toBeUndefined()
    expect(L.groupProperty(noSelect, { t: schema.t } as L.Schema)).toBeUndefined()
    expect(L.groupProperty(views[0], schema as L.Schema)?.id).toBe('sel')
  })
})

describe('rows with malformed data never throw', () => {
  const schema: L.Schema = {
    t: { id: 't', name: 'Name', type: 'title' },
    txt: { id: 'txt', name: 'T', type: 'text' },
    n: { id: 'n', name: 'N', type: 'number' },
    sel: select,
    tags: { ...select, id: 'tags', type: 'multi_select' },
    d: { id: 'd', name: 'D', type: 'date' },
    c: { id: 'c', name: 'C', type: 'checkbox' },
    u: { id: 'u', name: 'U', type: 'url' },
    created: { id: 'created', name: 'Created', type: 'created_time' }
  }
  const junk: unknown[] = [
    undefined,
    null,
    'text',
    42,
    [],
    { title: 5, values: 'abc', icon: {}, cover: [] },
    { title: [null, 3, ['ok'], [7], 'bare'], values: [1, 2] },
    {
      values: {
        txt: { a: 1 },
        n: 'NaN',
        sel: ['zzz'],
        tags: [1, null, 'a', 'a', 'gone'],
        d: { start: 5, end: [] },
        c: 'yes',
        u: ['x']
      }
    },
    { values: { n: Infinity, d: { start: '2024-02-30' }, sel: {}, tags: 'b', txt: 12, d2: 1 } }
  ]

  it.each(junk.map((props, index) => [index, props] as const))('junk row #%i', (_index, props) => {
    const r = row(props, { content: 'nope' as unknown as string[], createdAt: NaN })
    for (const prop of Object.values(schema)) {
      expect(() => L.getCellValue(r, prop)).not.toThrow()
      expect(() => L.formatValue(L.getCellValue(r, prop), prop)).not.toThrow()
    }
    const view: DatabaseView = {
      id: 'v',
      name: 'V',
      type: 'table',
      visibleProperties: Object.keys(schema),
      filters: Object.values(schema).flatMap((prop) =>
        L.operatorsFor(prop.type).map((operator) => ({ propertyId: prop.id, operator, value: 'a' }))
      ),
      sorts: Object.keys(schema).map((propertyId) => ({ propertyId, direction: 'desc' as const }))
    }
    expect(() => L.queryRows([r, r], schema, view, 'q')).not.toThrow()
    expect(() => L.groupRows([r], schema.sel)).not.toThrow()
    expect(() => L.groupRows([r], schema.created)).not.toThrow()
    expect(() => L.rowsByDay([r], schema.d)).not.toThrow()
    expect(() => L.changePropertyType(schema, 'txt', 'select', [r])).not.toThrow()
    expect(() => L.changePropertyType(schema, 'tags', 'text', [r])).not.toThrow()
    expect(typeof L.titleOf(r)).toBe('string')
    expect(Array.isArray(L.contentOf(r))).toBe(true)
    expect(L.iconOf(r)).toBeUndefined()
  })

  it('reads wrong-typed cells as empty and canonicalises the rest', () => {
    const r = row(junk[7])
    expect(L.getCellValue(r, schema.txt)).toBeNull()
    expect(L.getCellValue(r, schema.n)).toBeNull()
    expect(L.getCellValue(r, schema.sel)).toBeNull()
    expect(L.getCellValue(r, schema.tags)).toEqual(['a'])
    expect(L.getCellValue(r, schema.d)).toBeNull()
    expect(L.getCellValue(r, schema.c)).toBe(false)
    expect(L.getCellValue(r, schema.u)).toBeNull()
    expect(L.getCellValue(r, schema.created)).toBe(1)

    const r2 = row(junk[8])
    expect(L.getCellValue(r2, schema.n)).toBeNull()
    expect(L.getCellValue(r2, schema.d)).toBeNull()
    expect(L.getCellValue(r2, schema.tags)).toEqual(['b'])
    expect(L.getCellValue(r2, schema.txt)).toBe('12')
    expect(L.titleOf(row(junk[6]))).toBe('okbare')
  })

  it('a property id that shadows a prototype member reads nothing from the prototype', () => {
    const hostile: PropertySchema = { id: 'constructor', name: 'X', type: 'text' }
    expect(L.getCellValue(row({ values: {} }), hostile)).toBeNull()
    expect(L.setValue({ a: 1 }, '__proto__', 'x')).toEqual({ a: 1 })
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('setValue starts from an empty object when the stored values are not an object', () => {
    expect(L.setValue('abc' as unknown as L.Values, 'a', 1)).toEqual({ a: 1 })
    expect(L.setValue([1, 2] as unknown as L.Values, 'a', 1)).toEqual({ a: 1 })
    expect(L.valuesOf(row({ values: 'abc' }))).toEqual({})
  })
})
