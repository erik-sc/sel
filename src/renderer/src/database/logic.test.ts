import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema, PropertyValue } from '../../../shared/types'
import * as L from './logic'

const opts = { locale: 'en-US' }

const schema: L.Schema = {
  t: { id: 't', name: 'Name', type: 'title' },
  txt: { id: 'txt', name: 'Notes', type: 'text' },
  num: { id: 'num', name: 'Price', type: 'number', numberFormat: 'number' },
  sel: {
    id: 'sel',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'todo', name: 'To do', color: 'gray' },
      { id: 'doing', name: 'Doing', color: 'blue' },
      { id: 'done', name: 'Done', color: 'green' }
    ]
  },
  tags: {
    id: 'tags',
    name: 'Tags',
    type: 'multi_select',
    options: [
      { id: 'a', name: 'Alpha', color: 'red' },
      { id: 'b', name: 'Beta', color: 'pink' }
    ]
  },
  date: { id: 'date', name: 'Due', type: 'date' },
  chk: { id: 'chk', name: 'Done?', type: 'checkbox' },
  url: { id: 'url', name: 'Link', type: 'url' },
  created: { id: 'created', name: 'Created', type: 'created_time' },
  edited: { id: 'edited', name: 'Edited', type: 'last_edited_time' }
}

let clock = 1_700_000_000_000
function row(id: string, title: string, values: Record<string, PropertyValue> = {}, extra: Partial<Block> = {}): Block {
  clock += 86_400_000
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: title ? [[title]] : [], values },
    createdAt: clock,
    updatedAt: clock,
    trashedAt: null,
    ...extra
  }
}

const rows: Block[] = [
  row('r1', 'Banana', { txt: 'yellow fruit', num: 3, sel: 'done', tags: ['a'], date: { start: '2026-03-10' }, chk: true }),
  row('r2', 'apple', { txt: 'Red fruit', num: 10, sel: 'todo', tags: ['a', 'b'], date: { start: '2026-01-05', end: '2026-01-08' } }),
  row('r3', 'Cherry', { num: -1, sel: 'doing', date: { start: '2026-02-01' }, chk: false }),
  row('r4', '', {}),
  row('r5', 'apple 2', { txt: 'green', num: 10, sel: 'ghost', tags: ['b', 'ghost'] })
]

const ids = (list: Block[]): string[] => list.map((r) => r.id)
const view = (patch: Partial<DatabaseView> = {}): DatabaseView => ({
  id: 'v',
  name: 'View',
  type: 'table',
  visibleProperties: ['t', 'txt', 'num'],
  filters: [],
  sorts: [],
  ...patch
})

describe('getCellValue', () => {
  it('reads title, timestamps and normalises dangling data', () => {
    expect(L.getCellValue(rows[0], schema.t)).toBe('Banana')
    expect(L.getCellValue(rows[0], schema.created)).toBe(rows[0].createdAt)
    expect(L.getCellValue(rows[4], schema.sel)).toBeNull()
    expect(L.getCellValue(rows[4], schema.tags)).toEqual(['b'])
    expect(L.getCellValue(rows[3], schema.chk)).toBe(false)
    expect(L.getCellValue(rows[3], schema.num)).toBeNull()
  })

  it('tolerates rows without values and wrong-typed values', () => {
    const bare = { ...rows[0], props: {} } as Block
    for (const id in schema) expect(() => L.getCellValue(bare, schema[id])).not.toThrow()
    const odd = row('x', 'x', { num: 'abc', date: 'nope', sel: 5, tags: 'a', txt: 7 })
    expect(L.getCellValue(odd, schema.num)).toBeNull()
    expect(L.getCellValue(odd, schema.date)).toBeNull()
    expect(L.getCellValue(odd, schema.sel)).toBeNull()
    expect(L.getCellValue(odd, schema.tags)).toEqual(['a'])
    expect(L.getCellValue(odd, schema.txt)).toBe('7')
  })
})

describe('applyFilters', () => {
  const f = (propertyId: string, operator: L.Schema[string] extends never ? never : import('../../../shared/types').FilterOperator, value?: PropertyValue) =>
    ids(L.applyFilters(rows, schema, [{ propertyId, operator, value }]))

  it('returns the same rows without filters and ignores unknown properties', () => {
    expect(L.applyFilters(rows, schema, [])).toBe(rows)
    expect(L.applyFilters(rows, schema, undefined)).toBe(rows)
    expect(f('missing', 'equals', 'x')).toEqual(ids(rows))
  })

  it('text operators are case-insensitive', () => {
    expect(f('t', 'contains', 'APPLE')).toEqual(['r2', 'r5'])
    expect(f('t', 'not_contains', 'apple')).toEqual(['r1', 'r3', 'r4'])
    expect(f('t', 'equals', 'Apple')).toEqual(['r2'])
    expect(f('t', 'not_equals', 'apple')).toEqual(['r1', 'r3', 'r4', 'r5'])
    expect(f('t', 'is_empty')).toEqual(['r4'])
    expect(f('txt', 'is_not_empty')).toEqual(['r1', 'r2', 'r5'])
  })

  it('rules without a value do not filter', () => {
    expect(f('t', 'contains', '')).toEqual(ids(rows))
    expect(f('num', 'gt')).toEqual(ids(rows))
    expect(f('sel', 'equals', null)).toEqual(ids(rows))
  })

  it('number operators', () => {
    expect(f('num', 'equals', 10)).toEqual(['r2', 'r5'])
    expect(f('num', 'not_equals', 10)).toEqual(['r1', 'r3', 'r4'])
    expect(f('num', 'gt', 3)).toEqual(['r2', 'r5'])
    expect(f('num', 'lt', '3')).toEqual(['r3'])
    expect(f('num', 'is_empty')).toEqual(['r4'])
  })

  it('select and multi-select operators', () => {
    expect(f('sel', 'equals', 'done')).toEqual(['r1'])
    expect(f('sel', 'not_equals', 'done')).toEqual(['r2', 'r3', 'r4', 'r5'])
    expect(f('sel', 'is_empty')).toEqual(['r4', 'r5'])
    expect(f('tags', 'contains', 'b')).toEqual(['r2', 'r5'])
    expect(f('tags', 'contains', ['a', 'b'])).toEqual(['r2'])
    expect(f('tags', 'not_contains', 'a')).toEqual(['r3', 'r4', 'r5'])
    expect(f('tags', 'is_empty')).toEqual(['r3', 'r4'])
  })

  it('date operators compare by day and ranges match covered days', () => {
    expect(f('date', 'equals', '2026-03-10')).toEqual(['r1'])
    expect(f('date', 'equals', { start: '2026-01-07' })).toEqual(['r2'])
    expect(f('date', 'gt', '2026-01-31')).toEqual(['r1', 'r3'])
    expect(f('date', 'lt', '2026-02-01')).toEqual(['r2'])
    expect(f('date', 'is_empty')).toEqual(['r4', 'r5'])
    expect(f('created', 'gt', L.toISODate(new Date(rows[2].createdAt)))).toEqual(['r4', 'r5'])
  })

  it('checkbox operators and AND semantics', () => {
    expect(f('chk', 'checked')).toEqual(['r1'])
    expect(f('chk', 'unchecked')).toEqual(['r2', 'r3', 'r4', 'r5'])
    expect(
      ids(
        L.applyFilters(rows, schema, [
          { propertyId: 'num', operator: 'equals', value: 10 },
          { propertyId: 't', operator: 'contains', value: '2' }
        ])
      )
    ).toEqual(['r5'])
  })

  it('ignores operators that do not apply to the property type', () => {
    expect(f('chk', 'contains', 'x')).toEqual(ids(rows))
  })
})

describe('applySorts', () => {
  const s = (propertyId: string, direction: 'asc' | 'desc' = 'asc') => ids(L.applySorts(rows, schema, [{ propertyId, direction }]))

  it('returns input when there is nothing to sort by', () => {
    expect(L.applySorts(rows, schema, [])).toBe(rows)
    expect(L.applySorts(rows, schema, [{ propertyId: 'nope', direction: 'asc' }])).toBe(rows)
  })

  it('sorts text with locale compare, empties last in both directions', () => {
    expect(s('t')).toEqual(['r2', 'r5', 'r1', 'r3', 'r4'])
    expect(s('t', 'desc')).toEqual(['r3', 'r1', 'r5', 'r2', 'r4'])
  })

  it('sorts numbers numerically and is stable', () => {
    expect(s('num')).toEqual(['r3', 'r1', 'r2', 'r5', 'r4'])
    expect(s('num', 'desc')).toEqual(['r2', 'r5', 'r1', 'r3', 'r4'])
  })

  it('sorts select by option order', () => {
    expect(s('sel')).toEqual(['r2', 'r3', 'r1', 'r4', 'r5'])
    expect(s('sel', 'desc')).toEqual(['r1', 'r3', 'r2', 'r4', 'r5'])
  })

  it('sorts dates, checkboxes and timestamps', () => {
    expect(s('date')).toEqual(['r2', 'r3', 'r1', 'r4', 'r5'])
    expect(s('chk', 'desc')).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(s('chk')).toEqual(['r2', 'r3', 'r4', 'r5', 'r1'])
    expect(s('created', 'desc')).toEqual(['r5', 'r4', 'r3', 'r2', 'r1'])
  })

  it('applies secondary sorts', () => {
    const out = L.applySorts(rows, schema, [
      { propertyId: 'num', direction: 'desc' },
      { propertyId: 't', direction: 'desc' }
    ])
    expect(ids(out)).toEqual(['r5', 'r2', 'r1', 'r3', 'r4'])
  })

  it('does not mutate the input', () => {
    const before = ids(rows)
    s('t')
    expect(ids(rows)).toEqual(before)
  })
})

describe('queryRows / search', () => {
  it('combines filters, search and sorts', () => {
    const v = view({
      filters: [{ propertyId: 'num', operator: 'gt', value: 0 }],
      sorts: [{ propertyId: 't', direction: 'desc' }]
    })
    expect(ids(L.queryRows(rows, schema, v, 'APP'))).toEqual(['r5', 'r2'])
    expect(ids(L.queryRows(rows, schema, undefined))).toEqual(ids(rows))
  })
})

describe('groupRows', () => {
  it('groups by select with a leading no-value group and empty groups', () => {
    const groups = L.groupRows(rows, schema.sel)
    expect(groups.map((g) => g.key)).toEqual([null, 'todo', 'doing', 'done'])
    expect(groups.map((g) => ids(g.rows))).toEqual([['r4', 'r5'], ['r2'], ['r3'], ['r1']])
    expect(groups[0].label).toBe('No Status')
    expect(groups[1].option?.name).toBe('To do')
  })

  it('puts multi-select rows in every matching group', () => {
    const groups = L.groupRows(rows, schema.tags)
    expect(groups.map((g) => ids(g.rows))).toEqual([['r3', 'r4'], ['r1', 'r2'], ['r2', 'r5']])
  })

  it('groups by other types and by nothing', () => {
    const byNum = L.groupRows(rows, schema.num)
    expect(byNum.map((g) => g.key)).toEqual([null, '3', '10', '-1'])
    expect(L.groupRows(rows, undefined)).toHaveLength(1)
    expect(L.groupRows(rows, schema.chk).map((g) => g.label)).toEqual(['No Done?', 'Checked', 'Unchecked'])
  })
})

describe('formatValue', () => {
  it('formats every type', () => {
    expect(L.formatValue('hi', schema.txt)).toBe('hi')
    expect(L.formatValue(1234.5, schema.num, opts)).toBe('1,234.5')
    expect(L.formatValue(0.256, { ...schema.num, numberFormat: 'percent' }, opts)).toBe('25.6%')
    expect(L.formatValue(12, { ...schema.num, numberFormat: 'currency' }, opts)).toBe('$12.00')
    expect(L.formatValue('done', schema.sel)).toBe('Done')
    expect(L.formatValue(['a', 'b', 'zz'], schema.tags)).toBe('Alpha, Beta')
    expect(L.formatValue({ start: '2026-03-10' }, schema.date, opts)).toBe('Mar 10, 2026')
    expect(L.formatValue({ start: '2026-03-10', end: '2026-03-12' }, schema.date, opts)).toBe('Mar 10, 2026 → Mar 12, 2026')
    expect(L.formatValue(true, schema.chk)).toBe('Yes')
    expect(L.formatValue(null, schema.num)).toBe('')
    expect(L.formatValue(new Date(2026, 0, 2, 15, 4).getTime(), schema.created, opts)).toContain('Jan 2, 2026')
    expect(L.formatValue('garbage', schema.date)).toBe('')
  })
})

describe('dates', () => {
  it('parses and formats local days without timezone shift', () => {
    expect(L.toISODate(L.parseISODate('2026-03-01')!)).toBe('2026-03-01')
    expect(L.parseISODate('nope')).toBeNull()
    expect(L.addDays('2026-02-27', 3)).toBe('2026-03-02')
    expect(L.addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(L.diffDays('2026-03-28', '2026-04-02')).toBe(5)
    expect(L.dayKey({ start: '2026-01-05T10:00:00' })).toBe('2026-01-05')
    expect(L.dayKey('')).toBeNull()
  })

  it('shifts a range keeping its duration', () => {
    expect(L.shiftDateValue({ start: '2026-01-05', end: '2026-01-08' }, '2026-01-10')).toEqual({
      start: '2026-01-10',
      end: '2026-01-13'
    })
    expect(L.shiftDateValue({ start: '2026-01-05' }, '2026-01-01')).toEqual({ start: '2026-01-01' })
  })

  it('calendarMatrix builds full weeks', () => {
    const feb = L.calendarMatrix(2026, 1) // Feb 2026 starts on a Sunday, 28 days
    expect(feb).toHaveLength(4)
    expect(feb[0][0]).toEqual({ date: '2026-02-01', day: 1, inMonth: true })
    expect(feb[3][6].date).toBe('2026-02-28')

    const oct = L.calendarMatrix(2026, 9) // Oct 1 2026 is a Thursday
    expect(oct.every((w) => w.length === 7)).toBe(true)
    expect(oct[0][0]).toEqual({ date: '2026-09-27', day: 27, inMonth: false })
    expect(oct[0][4]).toEqual({ date: '2026-10-01', day: 1, inMonth: true })
    expect(oct[oct.length - 1][6].date).toBe('2026-10-31')

    const monday = L.calendarMatrix(2026, 9, 1)
    expect(monday[0][0].date).toBe('2026-09-28')
    expect(L.calendarMatrix(2026, 7)).toHaveLength(6) // Aug 2026: starts Saturday
    const flat = L.calendarMatrix(2024, 1).flat().filter((d) => d.inMonth)
    expect(flat).toHaveLength(29)
  })

  it('rowsByDay spreads ranges', () => {
    const map = L.rowsByDay(rows, schema.date)
    expect(ids(map.get('2026-01-05')!)).toEqual(['r2'])
    expect(ids(map.get('2026-01-08')!)).toEqual(['r2'])
    expect(map.get('2026-01-09')).toBeUndefined()
    expect(ids(map.get('2026-03-10')!)).toEqual(['r1'])
    expect(L.rowsByDay(rows, undefined).size).toBe(0)
  })
})

describe('schema mutations', () => {
  it('createDefaultSchema has exactly one title', () => {
    const s = L.createDefaultSchema()
    expect(Object.values(s).filter((p) => p.type === 'title')).toHaveLength(1)
    expect(L.getTitleProperty(s)?.name).toBe('Name')
  })

  it('addProperty generates unique names and never a second title', () => {
    const a = L.addProperty(schema, { type: 'text', id: 'new' })
    expect(a.property).toMatchObject({ id: 'new', name: 'Text', type: 'text' })
    expect(a.schema).not.toBe(schema)
    expect(schema.new).toBeUndefined()
    const b = L.addProperty(a.schema, { type: 'text' })
    expect(b.property.name).toBe('Text 1')
    expect(L.addProperty(schema, { type: 'title' }).property.type).toBe('text')
    expect(L.addProperty(schema, { type: 'select' }).property.options).toEqual([])
    expect(L.addProperty(schema, { type: 'text', id: 't' }).property.id).not.toBe('t')
  })

  it('renameProperty trims and ignores blanks', () => {
    expect(L.renameProperty(schema, 'txt', '  Memo ').txt.name).toBe('Memo')
    expect(L.renameProperty(schema, 'txt', '   ')).toBe(schema)
    expect(L.renameProperty(schema, 'zzz', 'x')).toBe(schema)
  })

  it('changePropertyType refuses title changes', () => {
    expect(L.changePropertyType(schema, 't', 'text', rows).schema).toBe(schema)
    expect(L.changePropertyType(schema, 'txt', 'title', rows).schema).toBe(schema)
    expect(L.changePropertyType(schema, 'txt', 'text', rows).schema).toBe(schema)
  })

  it('changePropertyType number -> text and text -> number coerce values', () => {
    const toText = L.changePropertyType(schema, 'num', 'text', rows)
    expect(toText.schema.num).toEqual({ id: 'num', name: 'Price', type: 'text' })
    expect(toText.rowValues.r1.num).toBe('3')
    expect(toText.rowValues.r1.txt).toBe('yellow fruit')
    expect(toText.rowValues.r4).toBeUndefined()

    const data = [row('a', 'a', { txt: '$1,200.50' }), row('b', 'b', { txt: 'n/a' }), row('c', 'c', {})]
    const toNum = L.changePropertyType(schema, 'txt', 'number', data)
    expect(toNum.schema.txt.numberFormat).toBe('number')
    expect(toNum.rowValues.a.txt).toBe(1200.5)
    expect('txt' in toNum.rowValues.b).toBe(false)
    expect(toNum.rowValues.c).toBeUndefined()
  })

  it('changePropertyType text -> select derives options, select <-> multi keeps them', () => {
    const data = [row('a', 'a', { txt: 'Red' }), row('b', 'b', { txt: 'blue, red' }), row('c', 'c', { txt: 'red' })]
    const toSel = L.changePropertyType(schema, 'txt', 'select', data)
    const options = toSel.schema.txt.options!
    expect(options.map((o) => o.name)).toEqual(['Red', 'blue, red'])
    expect(toSel.rowValues.a.txt).toBe(options[0].id)
    expect(toSel.rowValues.c.txt).toBe(options[0].id)

    const toMulti = L.changePropertyType(schema, 'txt', 'multi_select', data)
    const mo = toMulti.schema.txt.options!
    expect(mo.map((o) => o.name)).toEqual(['Red', 'blue'])
    expect(toMulti.rowValues.b.txt).toEqual([mo[1].id, mo[0].id])

    const selToMulti = L.changePropertyType(schema, 'sel', 'multi_select', rows)
    expect(selToMulti.schema.sel.options).toEqual(schema.sel.options)
    expect(selToMulti.rowValues.r1.sel).toEqual(['done'])
    expect('sel' in selToMulti.rowValues.r5).toBe(false)

    const multiToSel = L.changePropertyType(schema, 'tags', 'select', rows)
    expect(multiToSel.rowValues.r2.tags).toBe('a')
    expect(multiToSel.rowValues.r5.tags).toBe('b')
  })

  it('coerceValue covers the remaining conversions', () => {
    const p = (type: PropertySchema['type']): PropertySchema => ({ id: 'x', name: 'X', type })
    expect(L.coerceValue('2026-04-01', p('text'), p('date'))).toEqual({ start: '2026-04-01' })
    expect(L.coerceValue('soon', p('text'), p('date'))).toBeNull()
    expect(L.coerceValue({ start: '2026-04-01', end: '2026-04-02' }, p('date'), p('text'))).toBe('2026-04-01 → 2026-04-02')
    expect(L.coerceValue('yes', p('text'), p('checkbox'))).toBe(true)
    expect(L.coerceValue('nah', p('text'), p('checkbox'))).toBe(false)
    expect(L.coerceValue(true, p('checkbox'), p('number'))).toBe(1)
    expect(L.coerceValue(0, p('number'), p('checkbox'))).toBe(false)
    expect(L.coerceValue('done', schema.sel, p('text'))).toBe('Done')
    expect(L.coerceValue(['a', 'b'], schema.tags, p('text'))).toBe('Alpha, Beta')
    expect(L.coerceValue('x', p('text'), p('created_time'))).toBeNull()
    expect(L.coerceValue(null, p('text'), p('number'))).toBeNull()
    expect(L.coerceValue('http://a', p('url'), p('text'))).toBe('http://a')
  })

  it('deleteProperty strips it from views and never deletes the title', () => {
    const views = [
      view({
        visibleProperties: ['t', 'sel', 'num'],
        filters: [
          { propertyId: 'sel', operator: 'equals', value: 'done' },
          { propertyId: 'num', operator: 'gt', value: 1 }
        ],
        sorts: [
          { propertyId: 'sel', direction: 'asc' },
          { propertyId: 't', direction: 'asc' }
        ],
        propertyWidths: { sel: 100, num: 90 }
      }),
      view({ id: 'b', type: 'board', groupBy: 'sel', visibleProperties: ['t'] })
    ]
    const out = L.deleteProperty(schema, views, 'sel')
    expect(out.schema.sel).toBeUndefined()
    expect(schema.sel).toBeDefined()
    expect(out.views[0].visibleProperties).toEqual(['t', 'num'])
    expect(out.views[0].filters).toEqual([{ propertyId: 'num', operator: 'gt', value: 1 }])
    expect(out.views[0].sorts).toEqual([{ propertyId: 't', direction: 'asc' }])
    expect(out.views[0].propertyWidths).toEqual({ num: 90 })
    expect(out.views[1].groupBy).toBeUndefined()

    const same = L.deleteProperty(schema, views, 't')
    expect(same.schema).toBe(schema)
    expect(same.views).toBe(views)
    expect(L.deleteProperty(schema, views, 'unknown').schema).toBe(schema)
  })

  it('option mutations', () => {
    const added = L.addOption(schema, 'sel', '  Blocked ')
    expect(added.option?.name).toBe('Blocked')
    expect(L.OPTION_COLORS).toContain(added.option!.color)
    expect(added.schema.sel.options).toHaveLength(4)
    expect(L.addOption(schema, 'sel', 'done').option?.id).toBe('done')
    expect(L.addOption(schema, 'sel', 'done').schema).toBe(schema)
    expect(L.addOption(schema, 'txt', 'x').option).toBeUndefined()
    expect(L.addOption(schema, 'sel', '  ').option).toBeUndefined()

    const renamed = L.updateOption(schema, 'sel', 'todo', { name: 'Backlog', color: 'red' })
    expect(renamed.sel.options![0]).toEqual({ id: 'todo', name: 'Backlog', color: 'red' })
    expect(L.updateOption(schema, 'sel', 'todo', { name: ' ' }).sel.options![0].name).toBe('To do')
    expect(L.updateOption(schema, 'sel', 'zz', { name: 'x' })).toBe(schema)

    const removed = L.deleteOption(schema, 'sel', 'doing')
    expect(removed.sel.options!.map((o) => o.id)).toEqual(['todo', 'done'])
    expect(L.deleteOption(schema, 'sel', 'zz')).toBe(schema)
  })

  it('nextOptionColor prefers unused colours', () => {
    expect(L.nextOptionColor([])).toBe('brown')
    const all = L.OPTION_COLORS.filter((c) => c !== 'pink').map((c, i) => ({ id: String(i), name: c, color: c }))
    expect(L.nextOptionColor(all)).toBe('pink')
  })

  it('setValue removes empties but keeps false', () => {
    expect(L.setValue({ a: 1 }, 'b', 'x')).toEqual({ a: 1, b: 'x' })
    expect(L.setValue({ a: 1 }, 'a', null)).toEqual({})
    expect(L.setValue({ a: 1 }, 'a', [])).toEqual({})
    expect(L.setValue({ a: 1 }, 'a', '')).toEqual({})
    expect(L.setValue(undefined, 'a', false)).toEqual({ a: false })
    expect(L.setValue(undefined, 'a', 0)).toEqual({ a: 0 })
  })
})

describe('views', () => {
  it('createDefaultView per type', () => {
    const table = L.createDefaultView('table', schema, 'id1')
    expect(table).toMatchObject({ id: 'id1', name: 'Table', type: 'table', filters: [], sorts: [] })
    expect(table.visibleProperties[0]).toBe('t')
    expect(table.visibleProperties).toHaveLength(Object.keys(schema).length)
    expect(L.createDefaultView('board', schema).groupBy).toBe('sel')
    expect(L.createDefaultView('calendar', schema).groupBy).toBe('date')
    expect(L.createDefaultView('list', schema).visibleProperties).toEqual(['t'])
    expect(L.createDefaultView('board', L.createDefaultSchema()).groupBy).toBeUndefined()
  })

  it('addView creates the grouping property when missing', () => {
    const base = L.createDefaultSchema()
    const views = [L.createDefaultView('table', base)]
    const board = L.addView(base, views, 'board')
    const status = L.firstPropertyOfType(board.schema, 'select')!
    expect(status.name).toBe('Status')
    expect(status.options).toHaveLength(3)
    expect(board.view.groupBy).toBe(status.id)
    expect(board.views).toHaveLength(2)

    const cal = L.addView(board.schema, board.views, 'calendar')
    expect(cal.schema[cal.view.groupBy!].type).toBe('date')

    const again = L.addView(schema, [view({ name: 'Table' })], 'table')
    expect(again.schema).toBe(schema)
    expect(again.view.name).toBe('Table 1')
  })

  it('rename / duplicate / delete', () => {
    const views = [view({ id: 'a', name: 'A' }), view({ id: 'b', name: 'B' })]
    expect(L.renameView(views, 'a', ' Z ')[0].name).toBe('Z')
    expect(L.renameView(views, 'a', '')).toBe(views)

    const dup = L.duplicateView(views, 'a')
    expect(dup.views.map((v) => v.name)).toEqual(['A', 'A copy', 'B'])
    expect(dup.view!.id).not.toBe('a')
    expect(dup.view!.filters).not.toBe(views[0].filters)
    expect(L.duplicateView(views, 'zz').view).toBeUndefined()

    expect(ids2(L.deleteView(views, 'a'))).toEqual(['b'])
    const single = [views[0]]
    expect(L.deleteView(single, 'a')).toBe(single)
    expect(L.deleteView(views, 'zz')).toBe(views)
  })

  it('visibility, order, widths, sort helpers', () => {
    const v = view()
    expect(L.visibleProps(v, schema).map((p) => p.id)).toEqual(['t', 'txt', 'num'])
    expect(L.hiddenProps(v, schema).map((p) => p.id)).toContain('sel')
    expect(L.setPropertyVisible(v, schema, 'sel', true).visibleProperties).toEqual(['t', 'txt', 'num', 'sel'])
    expect(L.setPropertyVisible(v, schema, 'txt', false).visibleProperties).toEqual(['t', 'num'])
    expect(L.setPropertyVisible(v, schema, 't', false)).toBe(v)
    expect(L.setPropertyVisible(v, schema, 'txt', true)).toBe(v)
    expect(L.moveVisibleProperty(v, 'num', 't').visibleProperties).toEqual(['num', 't', 'txt'])
    expect(L.moveVisibleProperty(v, 't', null).visibleProperties).toEqual(['txt', 'num', 't'])
    expect(L.moveVisibleProperty(v, 'sel', 't')).toBe(v)
    expect(L.setPropertyWidth(v, 'txt', 10).propertyWidths).toEqual({ txt: L.MIN_COLUMN_WIDTH })
    expect(L.columnWidth(L.setPropertyWidth(v, 'txt', 222.4), schema.txt)).toBe(222)
    expect(L.columnWidth(v, schema.t)).toBe(L.defaultColumnWidth(schema.t))
    const sorted = L.setSort(view({ sorts: [{ propertyId: 't', direction: 'asc' }] }), 'num', 'desc')
    expect(sorted.sorts).toEqual([
      { propertyId: 'num', direction: 'desc' },
      { propertyId: 't', direction: 'asc' }
    ])
    expect(L.setSort(sorted, 'num', 'asc').sorts).toHaveLength(2)
  })

  it('sanitizeViews keeps identity for clean views and repairs broken ones', () => {
    const clean = view()
    expect(L.sanitizeViews([clean], schema)[0]).toBe(clean)
    const broken = {
      id: 'x',
      type: 'board',
      visibleProperties: ['gone', 'num', 'num'],
      filters: [{ propertyId: 'chk', operator: 'contains', value: 'x' }],
      groupBy: 'num'
    } as unknown as DatabaseView
    const [fixed] = L.sanitizeViews([broken], schema)
    expect(fixed.visibleProperties).toEqual(['t', 'num'])
    expect(fixed.filters).toEqual([])
    expect(fixed.sorts).toEqual([])
    expect(fixed.groupBy).toBe('sel')
    expect(fixed.name).toBe('Board')
  })
})

function ids2(views: DatabaseView[]): string[] {
  return views.map((v) => v.id)
}

describe('ensureDatabaseProps', () => {
  it('initialises missing schema and views deterministically', () => {
    const a = L.ensureDatabaseProps({})
    const b = L.ensureDatabaseProps(undefined)
    expect(a.changed).toBe(true)
    expect(a).toEqual(b)
    expect(L.getTitleProperty(a.schema)?.name).toBe('Name')
    expect(a.views).toHaveLength(1)
    expect(a.views[0].type).toBe('table')
    expect(a.views[0].visibleProperties).toEqual([L.getTitleProperty(a.schema)!.id])
  })

  it('leaves valid data untouched (same references)', () => {
    const views = [view()]
    const out = L.ensureDatabaseProps({ schema, views })
    expect(out.changed).toBe(false)
    expect(out.schema).toBe(schema)
    expect(out.views).toBe(views)
  })

  it('repairs a schema without title, duplicate titles and junk views', () => {
    const noTitle = L.ensureDatabaseProps({ schema: { txt: schema.txt }, views: [] })
    expect(noTitle.changed).toBe(true)
    expect(Object.keys(noTitle.schema)[0]).toBe(L.DEFAULT_TITLE_ID)
    expect(noTitle.schema.txt).toBe(schema.txt)

    const twoTitles = L.ensureDatabaseProps({
      schema: { a: { id: 'a', name: 'A', type: 'title' }, b: { id: 'b', name: 'B', type: 'title' } },
      views: [null as unknown as DatabaseView, view({ visibleProperties: ['b'] })]
    })
    expect(Object.values(twoTitles.schema).filter((p) => p.type === 'title')).toHaveLength(1)
    expect(twoTitles.views).toHaveLength(1)
    expect(twoTitles.views[0].visibleProperties).toEqual(['a', 'b'])
    expect(twoTitles.changed).toBe(true)

    const junk = L.ensureDatabaseProps({ schema: { x: null, y: { id: 'zz', type: 'text' } } as never })
    expect(junk.schema.x).toBeUndefined()
    expect(junk.schema.y).toMatchObject({ id: 'y', name: 'Text', type: 'text' })
  })
})

describe('defaultsFromFilters', () => {
  it('derives values from simple rules only', () => {
    const out = L.defaultsFromFilters(schema, [
      { propertyId: 't', operator: 'contains', value: 'Task' },
      { propertyId: 'txt', operator: 'equals', value: 'note' },
      { propertyId: 'num', operator: 'equals', value: '5' },
      { propertyId: 'sel', operator: 'equals', value: 'doing' },
      { propertyId: 'tags', operator: 'contains', value: 'a' },
      { propertyId: 'tags', operator: 'contains', value: ['b', 'ghost'] },
      { propertyId: 'date', operator: 'equals', value: '2026-05-01' },
      { propertyId: 'chk', operator: 'checked' },
      { propertyId: 'url', operator: 'not_contains', value: 'x' },
      { propertyId: 'gone', operator: 'equals', value: 'x' }
    ])
    expect(out).toEqual({
      title: 'Task',
      values: { txt: 'note', num: 5, sel: 'doing', tags: ['a', 'b'], date: { start: '2026-05-01' }, chk: true }
    })
    const created = { ...row('n', out.title!, out.values) }
    expect(L.applyFilters([created], schema, [{ propertyId: 'sel', operator: 'equals', value: 'doing' }])).toHaveLength(1)
  })

  it('ignores inequality, blank and unknown-option rules', () => {
    expect(
      L.defaultsFromFilters(schema, [
        { propertyId: 'num', operator: 'gt', value: 5 },
        { propertyId: 'sel', operator: 'not_equals', value: 'done' },
        { propertyId: 'sel', operator: 'equals', value: 'ghost' },
        { propertyId: 'txt', operator: 'contains', value: '' },
        { propertyId: 'chk', operator: 'unchecked' }
      ])
    ).toEqual({ values: {} })
    expect(L.defaultsFromFilters(schema, undefined)).toEqual({ values: {} })
  })
})

describe('ordering helpers', () => {
  it('reorder and moveBefore', () => {
    expect(L.reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(L.reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(L.reorder(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(L.moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(L.moveBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a'])
  })

  it('afterIdForInsert', () => {
    const order = ['a', 'b', 'c', 'd']
    expect(L.afterIdForInsert(order, 'd', 'a')).toBeNull()
    expect(L.afterIdForInsert(order, 'a', 'c')).toBe('b')
    expect(L.afterIdForInsert(order, 'a', null)).toBe('d')
    expect(L.afterIdForInsert(order, 'd', null)).toBe('c')
    expect(L.afterIdForInsert(order, 'b', 'c')).toBe('a')
    expect(L.afterIdForInsert(order, 'b', 'b')).toBe('a')
    expect(L.afterIdForInsert(order, 'a', 'zz')).toBe('d')
    expect(L.afterIdForInsert(['a'], 'a', null)).toBeNull()
  })

  it('windowRange', () => {
    expect(L.windowRange(1000, 30, 0, 300, 5)).toEqual({ start: 0, end: 16 })
    expect(L.windowRange(1000, 30, 3000, 300, 5)).toEqual({ start: 95, end: 116 })
    expect(L.windowRange(1000, 30, 999999, 300, 5)).toEqual({ start: 1000, end: 1000 })
    expect(L.windowRange(0, 30, 0, 300)).toEqual({ start: 0, end: 0 })
    expect(L.windowRange(10, 30, -50, 300, 5)).toEqual({ start: 0, end: 10 })
  })
})

describe('operators', () => {
  it('every type has operators and labels', () => {
    for (const type of ['title', ...L.PROPERTY_TYPES] as PropertySchema['type'][]) {
      const ops = L.operatorsFor(type)
      expect(ops.length).toBeGreaterThan(0)
      for (const op of ops) expect(L.operatorLabel(op, type)).toBeTruthy()
    }
    expect(L.operatorNeedsValue('is_empty')).toBe(false)
    expect(L.operatorNeedsValue('contains')).toBe(true)
    expect(L.defaultFilter(schema.chk)).toEqual({ propertyId: 'chk', operator: 'checked' })
  })
})

describe('input helpers', () => {
  it('parseNumberInput', () => {
    expect(L.parseNumberInput('')).toBeNull()
    expect(L.parseNumberInput(' 12 ')).toBe(12)
    expect(L.parseNumberInput('1,5')).toBe(1.5)
    expect(L.parseNumberInput('1,234.5')).toBe(1234.5)
    expect(L.parseNumberInput('$ 40')).toBe(40)
    expect(L.parseNumberInput('-3e2')).toBe(-300)
    expect(L.parseNumberInput('50%', 'percent')).toBe(0.5)
    expect(L.parseNumberInput('50%')).toBe(50)
    expect(L.parseNumberInput('abc')).toBeUndefined()
    expect(L.parseNumberInput('--')).toBeUndefined()
  })

  it('safeExternalUrl promotes bare domains', () => {
    expect(L.safeExternalUrl('example.com/a')).toBe('https://example.com/a')
    expect(L.safeExternalUrl('http://x.y')).toBe('http://x.y')
    expect(L.safeExternalUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(L.safeExternalUrl('  ')).toBeNull()
  })
})

describe('defaultCurrency', () => {
  it('follows the locale region and falls back to USD', () => {
    expect(L.defaultCurrency('en-US')).toBe('USD')
    expect(L.defaultCurrency('pt-BR')).toBe('BRL')
    expect(L.defaultCurrency('de-DE')).toBe('EUR')
    expect(L.defaultCurrency('xx')).toBe('USD')
    expect(L.formatNumber(5, 'currency', { locale: 'en-US', currency: 'EUR' })).toBe('€5.00')
  })
})
