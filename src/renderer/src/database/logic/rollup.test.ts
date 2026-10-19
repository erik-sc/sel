import { describe, expect, it, vi } from 'vitest'
import type { Block, DatabaseView, PropertySchema, RollupConfig, RollupFunction } from '../../../../shared/types'
import { cellText, filterTypeOf, readCell } from './cell'
import { addProperty, changePropertyType, updateRollup } from './mutations'
import { normalizeDatabase, sanitizeViews } from './normalize'
import { operatorsOf, queryRows } from './query'
import type { CellContext } from './relation'
import { cellContext } from './resolve'
import {
  DEFAULT_ROLLUP,
  aggregateRollup,
  computeRollup,
  resolveRollup,
  rollupFunctionsFor,
  rollupKind,
  rollupValue,
  sanitizeRollupConfig
} from './rollup'
import type { Schema, Values } from './values'

const TITLE: PropertySchema = { id: 'title', name: 'Name', type: 'title' }

const itemsSchema: Schema = {
  title: TITLE,
  price: { id: 'price', name: 'Price', type: 'number', numberFormat: 'currency' },
  done: { id: 'done', name: 'Done', type: 'checkbox' },
  due: { id: 'due', name: 'Due', type: 'date' },
  tag: {
    id: 'tag',
    name: 'Tag',
    type: 'select',
    options: [
      { id: 'red', name: 'Red', color: 'red' },
      { id: 'blue', name: 'Blue', color: 'blue' }
    ]
  },
  tags: {
    id: 'tags',
    name: 'Tags',
    type: 'multi_select',
    options: [
      { id: 'x', name: 'X', color: 'gray' },
      { id: 'y', name: 'Y', color: 'gray' }
    ]
  },
  back: { id: 'back', name: 'Orders', type: 'relation', relation: { databaseId: 'orders' } }
}

function rollup(config: RollupConfig, id = 'total'): PropertySchema {
  return { id, name: 'Total', type: 'rollup', rollup: config }
}

function ordersSchema(extra: Record<string, PropertySchema> = {}): Schema {
  return { title: TITLE, items: { id: 'items', name: 'Items', type: 'relation', relation: { databaseId: 'items' } }, ...extra }
}

function db(id: string, schema: Schema, content: string[], extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'database',
    parentId: null,
    content,
    props: { schema, views: [] },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    ...extra
  }
}

function row(id: string, parentId: string, title: string, values: Values = {}, extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'page',
    parentId,
    content: [],
    props: { title: [[title]], values },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    ...extra
  }
}

const ITEMS = [
  row(
    'i1',
    'items',
    'Bread',
    { price: 2.5, done: true, due: { start: '2026-03-02' }, tag: 'red', tags: ['x'] },
    { createdAt: Date.UTC(2026, 0, 5, 12) }
  ),
  row(
    'i2',
    'items',
    'Milk',
    { price: 1, due: { start: '2026-01-10', end: '2026-04-01' }, tag: 'red', tags: ['x', 'y'] },
    { createdAt: Date.UTC(2026, 0, 1, 12) }
  ),
  row('i3', 'items', 'Eggs', { price: 4, done: true }, { createdAt: Date.UTC(2026, 0, 9, 12) }),
  row('i4', 'items', '', {})
]

function world(
  orderSchema: Schema,
  orderValues: Values = { items: ['i1', 'i2', 'i3', 'i4'] },
  items: Block[] = ITEMS
): { ctx: CellContext; order: Block } {
  const order = row('o1', 'orders', 'Order', orderValues)
  const blocks = [
    db(
      'items',
      itemsSchema,
      items.map((b) => b.id)
    ),
    db('orders', orderSchema, ['o1']),
    order,
    ...items
  ]
  const byId = new Map(blocks.map((b) => [b.id, b]))
  return { ctx: cellContext({ get: (id) => byId.get(id) }), order }
}

function run(fn: RollupFunction, propertyId?: string, items: Block[] = ITEMS): ReturnType<typeof computeRollup> {
  const total = rollup(propertyId ? { relationId: 'items', propertyId, function: fn } : { relationId: 'items', function: fn })
  const { ctx, order } = world(ordersSchema({ total }), { items: items.map((b) => b.id) }, items)
  return computeRollup(order, total, ctx)
}

describe('rollup configuration', () => {
  it('keeps a clean configuration by reference and repairs the rest', () => {
    const clean: RollupConfig = { relationId: 'items', propertyId: 'price', function: 'sum' }
    expect(sanitizeRollupConfig(clean)).toBe(clean)
    expect(sanitizeRollupConfig({ relationId: 'items', function: 'nope' })).toEqual({ relationId: 'items', function: 'count' })
    expect(sanitizeRollupConfig({ relationId: '__proto__', propertyId: 4, function: 'max' })).toEqual({ function: 'max' })
    expect(sanitizeRollupConfig('x')).toBe(DEFAULT_ROLLUP)
  })

  it('is always there on a normalised rollup, and dropped from other types', () => {
    const schema = normalizeDatabase(db('o', { title: TITLE, r: { id: 'r', name: 'R', type: 'rollup' } as PropertySchema }, [])).schema
    expect(schema.r.rollup).toEqual(DEFAULT_ROLLUP)
    const text = normalizeDatabase(
      db('o', { title: TITLE, r: { id: 'r', name: 'R', type: 'text', rollup: { function: 'sum' } } as PropertySchema }, [])
    ).schema
    expect(text.r.rollup).toBeUndefined()
    const kept: Schema = { title: TITLE, r: rollup({ relationId: 'items', function: 'sum', propertyId: 'price' }, 'r') }
    expect(normalizeDatabase(db('o', kept, [])).schema).toBe(kept)
  })

  it('offers the functions that fit the related property', () => {
    expect(rollupFunctionsFor(undefined)).toEqual(['count'])
    expect(rollupFunctionsFor(itemsSchema.price)).toContain('sum')
    expect(rollupFunctionsFor(itemsSchema.price)).not.toContain('earliest')
    expect(rollupFunctionsFor(itemsSchema.done)).toContain('percent_checked')
    expect(rollupFunctionsFor(itemsSchema.due)).toEqual(['show_original', 'count', 'count_values', 'count_unique', 'earliest', 'latest'])
    expect(rollupFunctionsFor(itemsSchema.title)).toEqual(['show_original', 'count', 'count_values', 'count_unique'])
    // No chains: a relation or a rollup of the related database cannot be rolled up.
    expect(rollupFunctionsFor(itemsSchema.back)).toEqual([])
    expect(rollupFunctionsFor(rollup({ function: 'count' }))).toEqual([])
  })

  it('filters and sorts as the kind of value it gives', () => {
    expect(rollupKind('sum')).toBe('number')
    expect(rollupKind('latest')).toBe('date')
    expect(rollupKind('show_original')).toBe('text')
    expect(filterTypeOf(rollup({ function: 'percent_checked' }))).toBe('number')
    expect(filterTypeOf(rollup({ function: 'earliest' }))).toBe('date')
    expect(operatorsOf(rollup({ function: 'show_original' }))).toContain('contains')
    expect(operatorsOf(rollup({ function: 'count' }))).toContain('gt')
  })
})

describe('rollup functions', () => {
  it('counts rows, values and unique values', () => {
    expect(run('count')).toEqual({ kind: 'number', value: 4, format: 'number' })
    expect(run('count_values', 'price')).toMatchObject({ value: 3 })
    // A multi-select counts each of its options; a checkbox counts the checked ones.
    expect(run('count_values', 'tags')).toMatchObject({ value: 3 })
    expect(run('count_values', 'done')).toMatchObject({ value: 2 })
    expect(run('count_unique', 'tag')).toMatchObject({ value: 1 })
    expect(run('count_unique', 'tags')).toMatchObject({ value: 2 })
    expect(run('count_unique', 'done')).toMatchObject({ value: 2 })
    expect(run('count_unique', 'title')).toMatchObject({ value: 3 })
  })

  it('sums up numbers in the format of the related property', () => {
    expect(run('sum', 'price')).toEqual({ kind: 'number', value: 7.5, format: 'currency' })
    expect(run('average', 'price')).toMatchObject({ value: 2.5 })
    expect(run('min', 'price')).toMatchObject({ value: 1 })
    expect(run('max', 'price')).toMatchObject({ value: 4 })
    expect(run('range', 'price')).toMatchObject({ value: 3 })
    // Nothing to sum is 0; nothing to average has no value.
    expect(run('sum', 'price', [])).toMatchObject({ value: 0 })
    expect(run('average', 'price', [])).toMatchObject({ value: null })
    expect(run('min', 'price', [ITEMS[3]])).toMatchObject({ value: null })
  })

  it('gives the share of checked rows as a percentage', () => {
    expect(run('percent_checked', 'done')).toEqual({ kind: 'number', value: 0.5, format: 'percent' })
    expect(run('percent_checked', 'done', [])).toMatchObject({ value: null })
  })

  it('finds the earliest and latest day, a range counting by its end', () => {
    expect(run('earliest', 'due')).toEqual({ kind: 'date', value: { start: '2026-01-10' } })
    expect(run('latest', 'due')).toEqual({ kind: 'date', value: { start: '2026-04-01' } })
    expect(run('earliest', 'due', [ITEMS[3]])).toEqual({ kind: 'date', value: null })
    const created: PropertySchema = { id: 'made', name: 'Made', type: 'created_time' }
    expect(aggregateRollup('latest', ITEMS.slice(0, 3), created)).toEqual({ kind: 'date', value: { start: '2026-01-09' } })
  })

  it('shows the original values, options as tags', () => {
    const shown = run('show_original', 'tags')
    expect(shown?.kind === 'text' && shown.items.map((item) => [item.text, item.option?.id])).toEqual([
      ['X', 'x'],
      ['X', 'x'],
      ['Y', 'y']
    ])
    expect(rollupValue(run('show_original', 'title'))).toBe('Bread, Milk, Eggs')
    expect(rollupValue(run('show_original', 'done'))).toBe('Yes, No, Yes, No')
    expect(rollupValue(run('show_original', 'price', []))).toBeNull()
  })

  it('leaves out rows that are gone or in the trash', () => {
    const items = [ITEMS[0], { ...ITEMS[1], trashedAt: 3 }, ITEMS[2]]
    const total = rollup({ relationId: 'items', propertyId: 'price', function: 'sum' })
    const { ctx, order } = world(ordersSchema({ total }), { items: ['i1', 'i2', 'i3', 'gone'] }, items)
    expect(computeRollup(order, total, ctx)).toMatchObject({ value: 6.5 })
  })
})

describe('a rollup that cannot be computed', () => {
  it('gives nothing without a relation, a related property, or a fitting function', () => {
    const { ctx, order } = world(ordersSchema())
    expect(computeRollup(order, rollup({ function: 'count' }), ctx)).toBeNull()
    expect(computeRollup(order, rollup({ relationId: 'title', function: 'count' }), ctx)).toBeNull()
    expect(computeRollup(order, rollup({ relationId: 'items', function: 'sum' }), ctx)).toBeNull()
    expect(computeRollup(order, rollup({ relationId: 'items', propertyId: 'gone', function: 'sum' }), ctx)).toBeNull()
    expect(computeRollup(order, rollup({ relationId: 'items', propertyId: 'title', function: 'sum' }), ctx)).toBeNull()
    expect(computeRollup(order, rollup({ relationId: 'items', propertyId: 'back', function: 'show_original' }), ctx)).toBeNull()
    // Without a context a rollup reads as empty.
    expect(readCell(order, rollup({ relationId: 'items', function: 'count' }))).toBeNull()
  })

  it('gives nothing (not a zero) while the related database is in the trash or gone', () => {
    const total = rollup({ relationId: 'items', propertyId: 'price', function: 'sum' })
    const order = row('o1', 'orders', 'Order', { items: ['i1'] })
    const orders = db('orders', ordersSchema({ total }), ['o1'])
    const trashed = [db('items', itemsSchema, ['i1'], { trashedAt: 5 }), orders, order, ITEMS[0]]
    const byId = new Map(trashed.map((b) => [b.id, b]))
    expect(computeRollup(order, total, cellContext({ get: (id) => byId.get(id) }))).toBeNull()
    const gone = new Map([orders, order].map((b) => [b.id, b]))
    expect(computeRollup(order, total, cellContext({ get: (id) => gone.get(id), isMissing: () => true }))).toBeNull()
  })

  it('reports what it resolved to', () => {
    const { ctx } = world(ordersSchema())
    const resolved = resolveRollup(rollup({ relationId: 'items', propertyId: 'price', function: 'sum' }), ordersSchema(), ctx)
    expect(resolved.ready).toBe(true)
    expect(resolved.relation?.id).toBe('items')
    expect(resolved.target?.id).toBe('price')
  })
})

describe('rollups in views', () => {
  const total = rollup({ relationId: 'items', propertyId: 'price', function: 'sum' })
  const latest = rollup({ relationId: 'items', propertyId: 'due', function: 'latest' }, 'latest')
  const names = rollup({ relationId: 'items', propertyId: 'title', function: 'show_original' }, 'names')
  const schema = ordersSchema({ total, latest, names })

  function orders(): { ctx: CellContext; rows: Block[] } {
    const rows = [
      row('o1', 'orders', 'Big', { items: ['i1', 'i3'] }),
      row('o2', 'orders', 'Small', { items: ['i2'] }),
      row('o3', 'orders', 'None')
    ]
    const blocks = [
      db(
        'items',
        itemsSchema,
        ITEMS.map((b) => b.id)
      ),
      db(
        'orders',
        schema,
        rows.map((b) => b.id)
      ),
      ...rows,
      ...ITEMS
    ]
    const byId = new Map(blocks.map((b) => [b.id, b]))
    return { ctx: cellContext({ get: (id) => byId.get(id) }), rows }
  }
  const view = (patch: Partial<DatabaseView>): DatabaseView => ({
    id: 'v',
    name: 'V',
    type: 'table',
    visibleProperties: [],
    filters: [],
    sorts: [],
    ...patch
  })

  it('filters by the number, date or text it gives', () => {
    const { ctx, rows } = orders()
    const ids = (v: DatabaseView): string[] => queryRows(rows, schema, v, '', ctx).map((r) => r.id)
    expect(ids(view({ filters: [{ propertyId: 'total', operator: 'gt', value: 2 }] }))).toEqual(['o1'])
    // An order without items sums to 0, which is a value.
    expect(ids(view({ filters: [{ propertyId: 'total', operator: 'is_empty' }] }))).toEqual([])
    expect(ids(view({ filters: [{ propertyId: 'latest', operator: 'gt', value: '2026-03-15' }] }))).toEqual(['o2'])
    expect(ids(view({ filters: [{ propertyId: 'latest', operator: 'is_empty' }] }))).toEqual(['o3'])
    expect(ids(view({ filters: [{ propertyId: 'names', operator: 'contains', value: 'egg' }] }))).toEqual(['o1'])
  })

  it('sorts by its result, empty results last', () => {
    const { ctx, rows } = orders()
    expect(queryRows(rows, schema, view({ sorts: [{ propertyId: 'total', direction: 'desc' }] }), '', ctx).map((r) => r.id)).toEqual([
      'o1',
      'o2',
      'o3'
    ])
    expect(queryRows(rows, schema, view({ sorts: [{ propertyId: 'latest', direction: 'asc' }] }), '', ctx).map((r) => r.id)).toEqual([
      'o1',
      'o2',
      'o3'
    ])
  })

  it('formats its result as text', () => {
    const { ctx, rows } = orders()
    expect(cellText(rows[0], total, ctx, { locale: 'en-US', currency: 'USD' })).toBe('$6.50')
    expect(cellText(rows[0], names, ctx)).toBe('Bread, Eggs')
    expect(cellText(rows[2], latest, ctx)).toBe('')
  })

  it('drops filter rules whose operator does not fit what the rollup gives', () => {
    const v = view({
      filters: [
        { propertyId: 'latest', operator: 'contains', value: 'x' },
        { propertyId: 'total', operator: 'gt', value: 1 }
      ]
    })
    expect(sanitizeViews([v], schema)[0].filters).toEqual([{ propertyId: 'total', operator: 'gt', value: 1 }])
  })
})

describe('rollup mutations', () => {
  it('a new rollup counts over the first relation', () => {
    const { property } = addProperty(ordersSchema(), { type: 'rollup' })
    expect(property.rollup).toEqual({ function: 'count', relationId: 'items' })
    expect(addProperty({ title: TITLE }, { type: 'rollup' }).property.rollup).toEqual(DEFAULT_ROLLUP)
    const changed = changePropertyType({ ...ordersSchema(), n: { id: 'n', name: 'N', type: 'number' } }, 'n', 'rollup')
    expect(changed.schema.n.rollup).toEqual({ function: 'count', relationId: 'items' })
  })

  it('a new relation forgets the related property', () => {
    const schema = ordersSchema({ total: rollup({ relationId: 'items', propertyId: 'price', function: 'sum' }) })
    expect(updateRollup(schema, 'total', { function: 'average' }).total.rollup).toEqual({
      relationId: 'items',
      propertyId: 'price',
      function: 'average'
    })
    expect(updateRollup(schema, 'total', { relationId: 'other' }).total.rollup).toEqual({ relationId: 'other', function: 'sum' })
    expect(updateRollup(schema, 'total', { function: 'sum' })).toBe(schema)
    expect(updateRollup(schema, 'items', { function: 'sum' })).toBe(schema)
  })
})

describe('rollup rules', () => {
  const sumWhere = (filters: RollupConfig['filters']): ReturnType<typeof computeRollup> => {
    const total = rollup({ relationId: 'items', propertyId: 'price', function: 'sum', filters })
    const { ctx, order } = world(ordersSchema({ total }))
    return computeRollup(order, total, ctx)
  }

  it('counts only the linked rows that pass every rule', () => {
    expect(sumWhere([{ propertyId: 'tag', operator: 'equals', value: 'red' }])).toMatchObject({ value: 3.5 })
    expect(sumWhere([{ propertyId: 'done', operator: 'checked' }])).toMatchObject({ value: 6.5 })
    expect(
      sumWhere([
        { propertyId: 'tag', operator: 'equals', value: 'red' },
        { propertyId: 'done', operator: 'checked' }
      ])
    ).toMatchObject({ value: 2.5 })
    expect(sumWhere([{ propertyId: 'tag', operator: 'equals', value: 'blue' }])).toMatchObject({ value: 0 })
  })

  it('keeps the rows whose date is in a span relative to today', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 2, 15, 12))
      // Bread is due on 2 March; Milk runs from January into April.
      expect(sumWhere([{ propertyId: 'due', operator: 'date_is', value: 'this_month' }])).toMatchObject({ value: 3.5 })
      expect(sumWhere([{ propertyId: 'due', operator: 'date_is', value: 'last_month' }])).toMatchObject({ value: 1 })
      vi.setSystemTime(new Date(2026, 5, 1, 12))
      expect(sumWhere([{ propertyId: 'due', operator: 'date_is', value: 'this_month' }])).toMatchObject({ value: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores rules on relations, rollups, formulas and properties that are gone', () => {
    expect(sumWhere([{ propertyId: 'back', operator: 'is_not_empty' }])).toMatchObject({ value: 7.5 })
    expect(sumWhere([{ propertyId: 'gone', operator: 'checked' }])).toMatchObject({ value: 7.5 })
  })

  it('keeps well-formed rules and drops the rest', () => {
    const clean: RollupConfig = { relationId: 'items', function: 'count', filters: [{ propertyId: 'done', operator: 'checked' }] }
    expect(sanitizeRollupConfig(clean)).toBe(clean)
    expect(sanitizeRollupConfig({ ...clean, filters: [...clean.filters!, { operator: 'checked' }, 'x'] })).toEqual(clean)
    expect(sanitizeRollupConfig({ ...clean, filters: 'done' })).toEqual({ relationId: 'items', function: 'count' })
    expect(sanitizeRollupConfig({ ...clean, filters: [] })).toEqual({ relationId: 'items', function: 'count' })
  })

  it('are set and cleared, and forgotten with the relation', () => {
    const schema = ordersSchema({ total: rollup({ relationId: 'items', propertyId: 'price', function: 'sum' }) })
    const rule = { propertyId: 'done', operator: 'checked' } as const
    const kept = updateRollup(schema, 'total', { filters: [rule] })
    expect(kept.total.rollup).toEqual({ relationId: 'items', propertyId: 'price', function: 'sum', filters: [rule] })
    expect(updateRollup(kept, 'total', { filters: undefined }).total.rollup).toEqual({
      relationId: 'items',
      propertyId: 'price',
      function: 'sum'
    })
    expect(updateRollup(kept, 'total', { relationId: 'other' }).total.rollup).toEqual({ relationId: 'other', function: 'sum' })
  })
})
