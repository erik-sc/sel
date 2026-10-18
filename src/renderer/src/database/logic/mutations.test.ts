import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema, PropertyValue, ViewFilter } from '../../../../shared/types'
import * as L from '../logic'

let seq = 0
function row(id: string, values: Record<string, unknown> = {}, extra: Partial<Block> = {}): Block {
  seq += 1
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: [[id]], values: values as Record<string, PropertyValue> },
    createdAt: 1_700_000_000_000 + seq,
    updatedAt: 1_700_000_000_000 + seq,
    trashedAt: null,
    ...extra
  }
}

const options = [
  { id: 'todo', name: 'To do', color: 'gray' },
  { id: 'done', name: 'Done', color: 'green' }
]
const schema: L.Schema = {
  t: { id: 't', name: 'Name', type: 'title' },
  txt: { id: 'txt', name: 'Notes', type: 'text' },
  num: { id: 'num', name: 'Price', type: 'number', numberFormat: 'currency' },
  sel: { id: 'sel', name: 'Status', type: 'select', options },
  tags: { id: 'tags', name: 'Tags', type: 'multi_select', options },
  date: { id: 'date', name: 'Due', type: 'date' },
  chk: { id: 'chk', name: 'Done?', type: 'checkbox' },
  url: { id: 'url', name: 'Link', type: 'url' },
  created: { id: 'created', name: 'Created', type: 'created_time' }
}
const ids = (rows: Block[]): string[] => rows.map((r) => r.id)
const view = (patch: Partial<DatabaseView> = {}): DatabaseView => ({
  id: 'v',
  name: 'View',
  type: 'table',
  visibleProperties: ['t'],
  filters: [],
  sorts: [],
  ...patch
})

describe('changePropertyType never corrupts', () => {
  it('text -> select keeps every distinct value, however many there are', () => {
    const rows = Array.from({ length: 400 }, (_, i) => row(`r${i}`, { txt: `value ${i % 250}` }))
    const out = L.changePropertyType(schema, 'txt', 'select', rows)
    expect(out.schema.txt.options).toHaveLength(250)
    for (const r of rows) {
      const id = out.rowValues[r.id].txt
      expect(L.findOption(out.schema.txt, id)?.name).toBe(r.props.values!.txt)
    }
  })

  it('a computed property has nothing to convert: stale leftovers are dropped, not formatted', () => {
    const rows = [row('a', { created: 'stale text', txt: 'keep' }), row('b', { txt: 'keep' })]
    const out = L.changePropertyType(schema, 'created', 'text', rows)
    expect(out.schema.created).toEqual({ id: 'created', name: 'Created', type: 'text' })
    expect(out.rowValues).toEqual({ a: { txt: 'keep' } })
    const toSelect = L.changePropertyType(schema, 'created', 'select', rows)
    expect(toSelect.schema.created.options).toEqual([])
  })

  it('round-trips through text', () => {
    const rows = [row('a', { num: 1.234, sel: 'done', tags: ['done', 'todo'], date: { start: '2024-03-10', end: '2024-03-12' }, chk: true })]
    const roundTrip = (id: string): unknown => {
      const from = schema[id]
      const toText = L.changePropertyType(schema, id, 'text', rows)
      const textRows = rows.map((r) => ({ ...r, props: { ...r.props, values: toText.rowValues[r.id] ?? r.props.values } }))
      const back = L.changePropertyType({ ...toText.schema, [id]: { ...toText.schema[id], options: from.options } }, id, from.type, textRows)
      return (back.rowValues.a ?? textRows[0].props.values!)[id]
    }
    // 1.234 is the hard case: in pt-BR "1.234" reads as one thousand two hundred and thirty-four.
    expect(roundTrip('num')).toBe(1.234)
    expect(roundTrip('chk')).toBe(true)
    expect(roundTrip('date')).toEqual({ start: '2024-03-10', end: '2024-03-12' })
  })

  it('keeps the other cells of each row and leaves untouched rows alone', () => {
    const rows = [row('a', { txt: '12', num: 3 }), row('b', { num: 4 }), row('c', { txt: 'n/a', num: 5 })]
    const out = L.changePropertyType(schema, 'txt', 'number', rows)
    expect(out.rowValues).toEqual({ a: { txt: 12, num: 3 }, c: { num: 5 } })
    expect(out.schema.num).toBe(schema.num)
  })

  it('refuses unknown types and prototype keys', () => {
    expect(L.changePropertyType(schema, 'txt', 'bogus' as never).schema).toBe(schema)
    expect(L.changePropertyType(schema, 'constructor', 'text').schema).toBe(schema)
    expect(L.changePropertyType(schema, 'txt', 'toString' as never).schema).toBe(schema)
  })

  it('never produces NaN, Infinity or an invalid date', () => {
    const p = (type: PropertySchema['type']): PropertySchema => ({ id: 'x', name: 'X', type })
    expect(L.coerceValue('1e999', p('text'), p('number'))).toBeNull()
    expect(L.coerceValue('NaN', p('text'), p('number'))).toBeNull()
    expect(L.coerceValue(Infinity, p('text'), p('number'))).toBeNull()
    expect(L.coerceValue('2024-02-30', p('text'), p('date'))).toBeNull()
    expect(L.coerceValue('5', p('text'), p('date'))).toBeNull()
    expect(L.coerceValue('2024-03-10', p('text'), p('date'))).toEqual({ start: '2024-03-10' })
  })
})

describe('deleting cleans every reference', () => {
  const views: DatabaseView[] = [
    view({
      filters: [
        { propertyId: 'sel', operator: 'equals', value: 'done' },
        { propertyId: 'sel', operator: 'not_equals', value: 'todo' },
        { propertyId: 'tags', operator: 'contains', value: ['done', 'todo'] },
        { propertyId: 'tags', operator: 'contains', value: ['done'] },
        { propertyId: 'txt', operator: 'contains', value: 'done' }
      ]
    }),
    view({ id: 'other' })
  ]

  it('an option leaves the filter rules', () => {
    const next = L.stripOptionFromViews(views, 'sel', 'done')
    expect(next[0].filters).toEqual([
      { propertyId: 'sel', operator: 'equals' },
      { propertyId: 'sel', operator: 'not_equals', value: 'todo' },
      { propertyId: 'tags', operator: 'contains', value: ['done', 'todo'] },
      { propertyId: 'tags', operator: 'contains', value: ['done'] },
      { propertyId: 'txt', operator: 'contains', value: 'done' }
    ])
    expect(next[1]).toBe(views[1])
    expect(L.stripOptionFromViews(views, 'tags', 'done')[0].filters.slice(2, 4)).toEqual([
      { propertyId: 'tags', operator: 'contains', value: ['todo'] },
      { propertyId: 'tags', operator: 'contains' }
    ])
    expect(L.stripOptionFromViews(views, 'sel', 'unused')).toBe(views)
  })

  it('an option leaves the row values', () => {
    expect(L.stripOptionFromValues(row('a', { sel: 'done', txt: 'x' }), 'sel', 'done')).toEqual({ txt: 'x' })
    expect(L.stripOptionFromValues(row('a', { tags: ['done', 'todo'] }), 'tags', 'done')).toEqual({ tags: ['todo'] })
    expect(L.stripOptionFromValues(row('a', { tags: ['done'], txt: 'x' }), 'tags', 'done')).toEqual({ txt: 'x' })
    expect(L.stripOptionFromValues(row('a', { sel: 'todo' }), 'sel', 'done')).toBeUndefined()
    expect(L.stripOptionFromValues(row('a'), 'sel', 'done')).toBeUndefined()
    expect(L.stripOptionFromValues({ ...row('a'), props: { values: 'junk' } } as unknown as Block, 'sel', 'done')).toBeUndefined()
  })

  it('a property leaves the row values', () => {
    expect(L.stripPropertyFromValues(row('a', { sel: 'done', txt: 'x' }), 'sel')).toEqual({ txt: 'x' })
    expect(L.stripPropertyFromValues(row('a', { txt: 'x' }), 'sel')).toBeUndefined()
  })

  it('a property leaves filters, sorts, widths, visibility and groupBy', () => {
    const before = [
      view({
        type: 'board',
        groupBy: 'sel',
        visibleProperties: ['t', 'sel', 'num'],
        filters: [{ propertyId: 'sel', operator: 'is_empty' }, { propertyId: 'num', operator: 'gt', value: 1 }],
        sorts: [{ propertyId: 'sel', direction: 'desc' }],
        propertyWidths: { sel: 100 }
      })
    ]
    const out = L.deleteProperty(schema, before, 'sel')
    expect(JSON.stringify(out)).not.toContain('"sel"')
    expect(out.views[0].filters).toEqual([{ propertyId: 'num', operator: 'gt', value: 1 }])
  })
})

describe('option edits', () => {
  it('ignore a rename that would duplicate another option and report no change by reference', () => {
    expect(L.updateOption(schema, 'sel', 'todo', { name: ' done ' })).toBe(schema)
    expect(L.updateOption(schema, 'sel', 'todo', { name: 'To do' })).toBe(schema)
    expect(L.updateOption(schema, 'sel', 'todo', { name: 'TO DO' }).sel.options![0].name).toBe('TO DO')
    expect(L.updateOption(schema, 'sel', 'todo', { color: 'gray' })).toBe(schema)
    expect(L.updateProperty(schema, 'num', { numberFormat: 'currency' })).toBe(schema)
    expect(L.renameProperty(schema, 'constructor', 'x')).toBe(schema)
  })
})

describe('filter semantics, empties included', () => {
  const rows = [
    row('full', { txt: 'Hello', num: 5, sel: 'done', tags: ['done'], date: { start: '2024-03-10', end: '2024-03-12' }, chk: true, url: 'https://a.b' }),
    row('empty'),
    row('blank', { txt: '   ', num: 0, tags: [], chk: false })
  ]
  const match = (filter: ViewFilter): string[] => ids(L.applyFilters(rows, schema, [filter]))

  it.each<[string, ViewFilter, string[]]>([
    ['text is_empty counts blanks', { propertyId: 'txt', operator: 'is_empty' }, ['empty', 'blank']],
    ['text is_not_empty', { propertyId: 'txt', operator: 'is_not_empty' }, ['full']],
    ['text not_contains keeps empties', { propertyId: 'txt', operator: 'not_contains', value: 'hell' }, ['empty', 'blank']],
    ['text not_equals keeps empties', { propertyId: 'txt', operator: 'not_equals', value: 'hello' }, ['empty', 'blank']],
    ['number: zero is not empty', { propertyId: 'num', operator: 'is_empty' }, ['empty']],
    ['number lt never matches empties', { propertyId: 'num', operator: 'lt', value: 10 }, ['full', 'blank']],
    ['number gt', { propertyId: 'num', operator: 'gt', value: 0 }, ['full']],
    ['number equals 0', { propertyId: 'num', operator: 'equals', value: 0 }, ['blank']],
    ['number not_equals keeps empties', { propertyId: 'num', operator: 'not_equals', value: 5 }, ['empty', 'blank']],
    ['select equals', { propertyId: 'sel', operator: 'equals', value: 'done' }, ['full']],
    ['select not_equals keeps empties', { propertyId: 'sel', operator: 'not_equals', value: 'done' }, ['empty', 'blank']],
    ['select with a deleted option filters nothing', { propertyId: 'sel', operator: 'equals', value: 'gone' }, ['full', 'empty', 'blank']],
    ['multi is_empty counts []', { propertyId: 'tags', operator: 'is_empty' }, ['empty', 'blank']],
    ['multi not_contains keeps empties', { propertyId: 'tags', operator: 'not_contains', value: ['done'] }, ['empty', 'blank']],
    ['date on a day inside the range', { propertyId: 'date', operator: 'equals', value: '2024-03-11' }, ['full']],
    ['date after: a range ending later counts', { propertyId: 'date', operator: 'gt', value: '2024-03-11' }, ['full']],
    ['date after the range', { propertyId: 'date', operator: 'gt', value: '2024-03-12' }, []],
    ['date before: a range starting earlier counts', { propertyId: 'date', operator: 'lt', value: '2024-03-11' }, ['full']],
    ['date is_empty', { propertyId: 'date', operator: 'is_empty' }, ['empty', 'blank']],
    ['date with an invalid value filters nothing', { propertyId: 'date', operator: 'equals', value: '2024-02-30' }, ['full', 'empty', 'blank']],
    ['checkbox unchecked includes never-set', { propertyId: 'chk', operator: 'unchecked' }, ['empty', 'blank']],
    ['checkbox checked', { propertyId: 'chk', operator: 'checked' }, ['full']],
    ['title contains', { propertyId: 't', operator: 'contains', value: 'EMP' }, ['empty']],
    ['wrong-typed value filters nothing', { propertyId: 'num', operator: 'gt', value: { start: 'x' } as never }, ['full', 'empty', 'blank']],
    ['unknown operator filters nothing', { propertyId: 'num', operator: 'between' as never, value: 1 }, ['full', 'empty', 'blank']]
  ])('%s', (_name, filter, expected) => {
    expect(match(filter)).toEqual(expected)
  })
})

describe('sorting', () => {
  it('is stable and puts empties last in both directions, for every type', () => {
    const rows = [
      row('e1'),
      row('b1', { txt: 'b', num: 2, sel: 'done', date: { start: '2024-02-01' } }),
      row('a1', { txt: 'a', num: 1, sel: 'todo', date: { start: '2024-01-01' } }),
      row('b2', { txt: 'B', num: 2, sel: 'done', date: { start: '2024-02-01' } }),
      row('e2', { txt: ' ', sel: 'deleted', date: { start: 'nope' } }),
      row('a2', { txt: 'A', num: 1, sel: 'todo', date: { start: '2024-01-01T09:00' } })
    ]
    for (const propertyId of ['txt', 'num', 'sel', 'date']) {
      expect(ids(L.applySorts(rows, schema, [{ propertyId, direction: 'asc' }]))).toEqual(['a1', 'a2', 'b1', 'b2', 'e1', 'e2'])
      // A time of day sorts after the same day without one, so it comes first going down.
      const desc = propertyId === 'date' ? ['b1', 'b2', 'a2', 'a1', 'e1', 'e2'] : ['b1', 'b2', 'a1', 'a2', 'e1', 'e2']
      expect(ids(L.applySorts(rows, schema, [{ propertyId, direction: 'desc' }]))).toEqual(desc)
    }
    expect(ids(rows)).toEqual(['e1', 'b1', 'a1', 'b2', 'e2', 'a2'])
  })

  it('sorts text naturally and ignores sorts on missing properties or with a junk direction', () => {
    const rows = [row('x10', { txt: 'item 10' }), row('x2', { txt: 'item 2' }), row('x1', { txt: 'Item 1' })]
    expect(ids(L.applySorts(rows, schema, [{ propertyId: 'txt', direction: 'asc' }]))).toEqual(['x1', 'x2', 'x10'])
    expect(L.applySorts(rows, schema, [{ propertyId: 'constructor', direction: 'asc' }])).toBe(rows)
    expect(ids(L.applySorts(rows, schema, [{ propertyId: 'txt', direction: 'up' as never }]))).toEqual(['x1', 'x2', 'x10'])
    expect(L.applySorts(rows, schema, 'junk' as never)).toBe(rows)
  })
})

describe('row drag-reorder under a filtered view', () => {
  // Database order: a b c d e; the view shows only a, c, e.
  const order = ['a', 'b', 'c', 'd', 'e']
  const visible = ['a', 'c', 'e']
  const place = (moving: string, target: string, edge: 'before' | 'after'): string[] => {
    const drop = L.rowDropTarget(visible, moving, target, edge)
    if (!drop) return order
    const rest = order.filter((id) => id !== moving)
    const after = 'beforeId' in drop ? L.afterIdForInsert(order, moving, drop.beforeId) : drop.afterId
    const at = after === null ? 0 : rest.indexOf(after) + 1
    return [...rest.slice(0, at), moving, ...rest.slice(at)]
  }
  const shown = (list: string[]): string[] => list.filter((id) => visible.includes(id))

  it('lands where the user dropped it among the visible rows', () => {
    expect(shown(place('e', 'a', 'before'))).toEqual(['e', 'a', 'c'])
    expect(shown(place('e', 'a', 'after'))).toEqual(['a', 'e', 'c'])
    expect(shown(place('a', 'c', 'after'))).toEqual(['c', 'a', 'e'])
    expect(shown(place('a', 'e', 'after'))).toEqual(['c', 'e', 'a'])
    expect(place('a', 'e', 'after')).toEqual(['b', 'c', 'd', 'e', 'a'])
    expect(place('a', 'c', 'after')).toEqual(['b', 'c', 'd', 'a', 'e'])
    // After the last *visible* row means right after it, not at the end of the database.
    expect(L.rowDropTarget(['a', 'c'], 'a', 'c', 'after')).toEqual({ afterId: 'c' })
  })

  it('treats drops that would not move the row as no-ops', () => {
    expect(L.rowDropTarget(visible, 'c', 'c', 'before')).toBeNull()
    expect(L.rowDropTarget(visible, 'c', 'c', 'after')).toBeNull()
    expect(L.rowDropTarget(visible, 'c', 'a', 'after')).toBeNull()
    expect(L.rowDropTarget(visible, 'e', 'e', 'after')).toBeNull()
    expect(L.rowDropTarget(visible, 'a', 'gone', 'after')).toEqual({ afterId: 'gone' })
  })
})
