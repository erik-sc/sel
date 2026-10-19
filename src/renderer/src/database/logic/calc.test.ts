import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '../../../../shared/types'
import { calcSplitProperty, evaluateCalc, evaluateSplit, isCalcNumber } from './calc'
import { cellContext } from './resolve'
import { calcRef, defaultCalcs, MAX_CALCS, sanitizeCalcs } from './calcConfig'
import { sanitizeViews } from './normalize'
import { createDefaultView } from './views'

const SCHEMA: Record<string, PropertySchema> = {
  title: { id: 'title', name: 'Name', type: 'title' },
  limit: { id: 'limit', name: 'Monthly limit', type: 'number', numberFormat: 'currency' },
  spent: { id: 'spent', name: 'Gasto', type: 'number', numberFormat: 'currency' },
  share: { id: 'share', name: 'Share', type: 'number', numberFormat: 'percent' },
  fixed: { id: 'fixed', name: 'Fixed', type: 'checkbox' },
  notes: { id: 'notes', name: 'Notes', type: 'text' },
  avg: { id: 'avg', name: 'Média', type: 'number' }
}

let n = 0
const row = (title: string, values: Record<string, unknown> = {}): Block =>
  ({
    id: `r${++n}`,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: title ? [[title]] : [], values },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }) as unknown as Block

const ROWS = [
  row('Aluguel', { limit: 2600, spent: 2600, fixed: true, notes: 'dia 5' }),
  row('Alimentação', { limit: 1000, spent: 1250.5, fixed: false }),
  row('Lazer', { limit: 800, notes: '' }),
  row('', { limit: 200, spent: 0 })
]

const value = (formula: string, rows = ROWS): unknown => {
  const result = evaluateCalc({ formula }, rows, SCHEMA)
  return result.ok ? result.value : result.error
}

describe('formulas', () => {
  it('aggregates a property named in any of the ways a name can be written', () => {
    expect(value('sum(Monthly limit)')).toBe(4600)
    expect(value('sum("Monthly limit")')).toBe(4600)
    expect(value("sum('monthly LIMIT')")).toBe(4600)
    expect(value('SUM( [Monthly limit] )')).toBe(4600)
    expect(value('sum(Gasto)')).toBe(3850.5)
    expect(value('avg(Monthly limit)')).toBe(1150)
    expect(value('min(Monthly limit)')).toBe(200)
    expect(value('max(Monthly limit)')).toBe(2600)
    expect(value('median(Monthly limit)')).toBe(900)
    expect(value('median(Gasto)')).toBe(1250.5)
    // Names are matched without case or accents, and so are the functions.
    expect(value('soma(media)')).toBe(0)
    expect(value('média(gasto)')).toBeCloseTo(1283.5)
  })

  it('counts rows, values and ticked boxes', () => {
    expect(value('count()')).toBe(4)
    expect(value('count(Gasto)')).toBe(3)
    expect(value('count(Notes)')).toBe(1)
    expect(value('count(Name)')).toBe(3)
    expect(value('count(Fixed)')).toBe(1)
    expect(value('sum(Fixed)')).toBe(1)
    expect(value('count(Fixed) / count() * 100')).toBe(25)
  })

  it('does arithmetic with the usual precedence', () => {
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('(1 + 2) * 3')).toBe(9)
    expect(value('-2 * -(3 - 5)')).toBe(-4)
    expect(value('10 / 4')).toBe(2.5)
    expect(value('.5 + 1.25')).toBe(1.75)
    expect(value('50% * 200')).toBe(100)
    expect(value('15000 - sum(Monthly limit)')).toBe(10400)
    expect(value('sum(Monthly limit) - sum(Gasto)')).toBeCloseTo(749.5)
    expect(value('sum(Monthly limit) × 12 ÷ 2')).toBe(27600)
  })

  it('writes the result like the property it came from, unless it is a ratio, a count or a mix', () => {
    const format = (formula: string, own?: 'number' | 'currency' | 'percent'): unknown => {
      const result = evaluateCalc({ formula, ...(own ? { format: own } : {}) }, ROWS, SCHEMA)
      return result.ok ? result.format : result.error
    }
    expect(format('sum(Monthly limit)')).toBe('currency')
    expect(format('15000 - sum(Monthly limit) * 2')).toBe('currency')
    expect(format('sum(Monthly limit) - sum(Gasto)')).toBe('currency')
    expect(format('sum(Gasto) / sum(Monthly limit)')).toBe('number')
    expect(format('count()')).toBe('number')
    expect(format('sum(Monthly limit) + sum(Share)')).toBe('number')
    expect(format('1 + 1')).toBe('number')
    expect(format('sum(Gasto) / sum(Monthly limit)', 'percent')).toBe('percent')
  })

  it('has nothing to say about no values, rather than a wrong number', () => {
    expect(evaluateCalc({ formula: 'avg(Monthly limit)' }, [], SCHEMA)).toEqual({ ok: true, value: null, format: 'currency' })
    expect(value('max(Share)')).toBeNull()
    expect(value('sum(Share)')).toBe(0)
    expect(value('count()', [])).toBe(0)
  })

  it('explains what is wrong with a formula', () => {
    expect(value('')).toMatch(/Write a formula/)
    expect(value('sum(Nope)')).toBe('There is no property called "Nope"')
    expect(value('sum(Notes)')).toBe('"Notes" is not a number')
    expect(value('sum()')).toMatch(/needs a property/)
    expect(value('sum')).toMatch(/needs parentheses/)
    expect(value('Gasto + 1')).toMatch(/Use a function on "Gasto"/)
    expect(value('foo(Gasto)')).toMatch(/is not a function/)
    expect(value('1 / 0')).toBe('Division by zero')
    expect(value('1 / (count() - 4)')).toBe('Division by zero')
    expect(value('(1 + 2')).toBe('A parenthesis is not closed')
    expect(value('sum(Gasto')).toBe('A parenthesis is not closed')
    expect(value('sum("Gasto)')).toBe('A quoted name is not closed')
    expect(value('1 +')).toBe('The formula is not finished')
    expect(value('1 2')).toBe('"2" is not expected here')
    expect(value('2 ** 3')).toBe('"*" is not expected here')
    expect(value('1; alert(1)')).toBe('";" is not expected here')
    expect(value('('.repeat(60) + '1' + ')'.repeat(60))).toMatch(/nested too deeply/)
    for (const hostile of ['constructor()', '__proto__(Gasto)', 'sum(__proto__)', 'sum(constructor)', 'toString()'])
      expect(typeof value(hostile)).toBe('string')
  })
})

describe('the calculations a view stores', () => {
  it('quotes a property name only when it needs it', () => {
    expect(calcRef('Gasto')).toBe('Gasto')
    expect(calcRef('Média')).toBe('Média')
    expect(calcRef('Monthly limit')).toBe('"Monthly limit"')
    expect(calcRef('2024')).toBe('"2024"')
    expect(value(`sum(${calcRef('Monthly limit')})`)).toBe(4600)
  })

  it('starts with the total of the first number property, or the count', () => {
    expect(defaultCalcs(SCHEMA)).toEqual([{ id: 'calc-0', name: 'Total Monthly limit', formula: 'sum("Monthly limit")' }])
    expect(defaultCalcs({ title: SCHEMA.title })).toEqual([{ id: 'calc-0', name: 'Count', formula: 'count()' }])
    expect(createDefaultView('calc', SCHEMA, 'v').calcs).toEqual(defaultCalcs(SCHEMA))
    expect(createDefaultView('table', SCHEMA, 'v').calcs).toBeUndefined()
  })

  it('keeps only well-formed calculations', () => {
    expect(sanitizeCalcs(undefined)).toBeNull()
    expect(sanitizeCalcs('sum(x)')).toBeNull()
    expect(
      sanitizeCalcs([
        { id: 'a', name: 'Total', formula: 'sum(Gasto)', format: 'currency', extra: 1 },
        { id: 'a', name: 'Again', formula: '1' },
        { id: 'b', name: 7, formula: 'count()', format: 'euros' },
        { id: 'c', name: 'No formula' },
        { id: '__proto__', name: 'Bad id', formula: '1' },
        null,
        'x',
        ['y']
      ])
    ).toEqual([
      { id: 'a', name: 'Total', formula: 'sum(Gasto)', format: 'currency' },
      { id: 'b', name: '', formula: 'count()' }
    ])
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, name: 'x'.repeat(500), formula: '1'.repeat(5000) }))
    const kept = sanitizeCalcs(many)!
    expect(kept).toHaveLength(MAX_CALCS)
    expect(kept[0].name).toHaveLength(100)
    expect(kept[0].formula).toHaveLength(400)
  })

  it('gives a calculations view its figures, and leaves a clean view as it is', () => {
    const bare = { id: 'v', name: 'Calculations', type: 'calc', visibleProperties: ['title'], filters: [], sorts: [] } as DatabaseView
    expect(sanitizeViews([bare], SCHEMA)[0].calcs).toEqual(defaultCalcs(SCHEMA))
    const clean: DatabaseView = { ...bare, calcs: [{ id: 'a', name: 'Total', formula: 'sum(Gasto)' }] }
    expect(sanitizeViews([clean], SCHEMA)[0]).toBe(clean)
    // An empty list is the user's own: nothing is put back.
    expect(sanitizeViews([{ ...bare, calcs: [] }], SCHEMA)[0].calcs).toEqual([])
    // Another kind of view keeps well-formed figures (it may become a calculations view again) and drops junk.
    const table = { ...clean, type: 'table' } as DatabaseView
    expect(sanitizeViews([table], SCHEMA)[0].calcs).toEqual(clean.calcs)
    expect(sanitizeViews([{ ...table, calcs: 'junk' } as unknown as DatabaseView], SCHEMA)[0].calcs).toBeUndefined()
  })
})

describe('figures from rollups and formulas, split by a select property', () => {
  const GROUP: PropertySchema = {
    id: 'group',
    name: 'Grupo',
    type: 'select',
    options: [
      { id: 'income', name: 'Renda', color: 'gray' },
      { id: 'needs', name: 'Essencial', color: 'blue' },
      { id: 'wants', name: 'Estilo de vida', color: 'purple' },
      { id: 'future', name: 'Futuro', color: 'green' }
    ]
  }
  const CATEGORIES: Record<string, PropertySchema> = {
    title: { id: 'title', name: 'Categoria', type: 'title' },
    group: GROUP,
    budget: { id: 'budget', name: 'Orçamento', type: 'number', numberFormat: 'currency' },
    entries: { id: 'entries', name: 'Lançamentos', type: 'relation', relation: { databaseId: 'entries', syncedPropertyId: 'category' } },
    spent: { id: 'spent', name: 'Gasto', type: 'rollup', rollup: { relationId: 'entries', propertyId: 'expense', function: 'sum' } },
    received: {
      id: 'received',
      name: 'Recebido',
      type: 'rollup',
      rollup: { relationId: 'entries', propertyId: 'income', function: 'sum' }
    },
    planned: {
      id: 'planned',
      name: 'Planejado',
      type: 'formula',
      formula: { expression: 'if(prop("group") == "Renda", prop("budget"), 0 - prop("budget"))' },
      numberFormat: 'currency'
    },
    actual: {
      id: 'actual',
      name: 'Realizado',
      type: 'formula',
      formula: { expression: 'prop("received") - prop("spent")' },
      numberFormat: 'currency'
    }
  }
  const ENTRIES: Record<string, PropertySchema> = {
    title: { id: 'title', name: 'Descrição', type: 'title' },
    income: { id: 'income', name: 'Entrada', type: 'number', numberFormat: 'currency' },
    expense: { id: 'expense', name: 'Saída', type: 'number', numberFormat: 'currency' },
    category: { id: 'category', name: 'Categoria', type: 'relation', relation: { databaseId: 'categories', syncedPropertyId: 'entries' } }
  }
  const block = (id: string, parentId: string | null, type: Block['type'], props: Block['props'], content: string[] = []): Block =>
    ({ id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }) as Block
  const category = (id: string, title: string, values: Record<string, unknown>): Block =>
    block(id, 'categories', 'page', { title: [[title]], values } as Block['props'])
  const entry = (id: string, values: Record<string, unknown>): Block =>
    block(id, 'entries', 'page', { title: [[id]], values } as Block['props'])

  const cats = [
    category('salary', 'Salário', { group: 'income', budget: 10000, entries: ['e1'] }),
    category('rent', 'Aluguel', { group: 'needs', budget: 3000, entries: ['e2'] }),
    category('food', 'Comida', { group: 'needs', budget: 1000, entries: ['e3', 'e4'] }),
    category('fun', 'Lazer', { group: 'wants', budget: 500, entries: ['e5'] }),
    category('other', 'Outros', { entries: ['e6'] })
  ]
  const entries = [
    entry('e1', { income: 10500, category: ['salary'] }),
    entry('e2', { expense: 3000, category: ['rent'] }),
    entry('e3', { expense: 700, category: ['food'] }),
    entry('e4', { expense: 450, category: ['food'] }),
    entry('e5', { expense: 900, category: ['fun'] }),
    entry('e6', { expense: 100, category: ['other'] })
  ]
  const blocks = [
    block(
      'categories',
      null,
      'database',
      { schema: CATEGORIES, views: [] } as unknown as Block['props'],
      cats.map((c) => c.id)
    ),
    block(
      'entries',
      null,
      'database',
      { schema: ENTRIES, views: [] } as unknown as Block['props'],
      entries.map((e) => e.id)
    ),
    ...cats,
    ...entries
  ]
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const ctx = cellContext({ get: (id) => byId.get(id) })
  const calcs = [{ formula: 'sum(Planejado)' }, { formula: 'sum(Realizado)' }, { formula: 'sum(Realizado) - sum(Planejado)' }]

  it('sums what rollups and formulas give, written like what they read', () => {
    expect(evaluateCalc({ formula: 'sum(Gasto)' }, cats, CATEGORIES, ctx)).toEqual({ ok: true, value: 5150, format: 'currency' })
    expect(evaluateCalc({ formula: 'sum(Planejado)' }, cats, CATEGORIES, ctx)).toEqual({ ok: true, value: 5500, format: 'currency' })
    expect(evaluateCalc({ formula: 'count(Gasto)' }, cats, CATEGORIES, ctx)).toMatchObject({ value: 5 })
    // Without the related rows there is nothing to compute them from.
    expect(evaluateCalc({ formula: 'sum(Gasto)' }, cats, CATEGORIES)).toMatchObject({ ok: true, value: 0 })
    expect(isCalcNumber(CATEGORIES.spent, CATEGORIES)).toBe(true)
    expect(isCalcNumber(CATEGORIES.planned, CATEGORIES)).toBe(true)
    expect(isCalcNumber(CATEGORIES.group, CATEGORIES)).toBe(false)
  })

  it('computes each figure per option that has rows, the rows without one last, and over all of them', () => {
    const split = evaluateSplit(calcs, cats, CATEGORIES, GROUP, ctx)
    const values = (results: ReturnType<typeof evaluateCalc>[]): unknown[] => results.map((r) => (r.ok ? r.value : r.error))
    expect(split.groups.map((g) => [g.key, g.label, values(g.results)])).toEqual([
      ['income', 'Renda', [10000, 10500, 500]],
      ['needs', 'Essencial', [-4000, -4150, -150]],
      ['wants', 'Estilo de vida', [-500, -900, -400]],
      [null, 'No Grupo', [0, -100, -100]]
    ])
    expect(split.groups[1].option).toBe(GROUP.options![1])
    expect(values(split.total)).toEqual([5500, 5350, -150])
  })

  it('splits only by a select property the schema still has', () => {
    const view = { id: 'v', name: 'Plano', type: 'calc', visibleProperties: ['title'], filters: [], sorts: [] } as DatabaseView
    expect(calcSplitProperty(view, CATEGORIES)).toBeUndefined()
    expect(calcSplitProperty({ ...view, groupBy: 'group' }, CATEGORIES)).toBe(GROUP)
    expect(calcSplitProperty({ ...view, groupBy: 'budget' }, CATEGORIES)).toBeUndefined()
    expect(calcSplitProperty({ ...view, groupBy: 'gone' }, CATEGORIES)).toBeUndefined()
    // The choice survives the view's repair.
    expect(sanitizeViews([{ ...view, calcs: [], groupBy: 'group' }], CATEGORIES)[0].groupBy).toBe('group')
  })
})
