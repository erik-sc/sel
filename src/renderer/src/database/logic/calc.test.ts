import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '../../../../shared/types'
import { evaluateCalc } from './calc'
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
  ({ id: `r${++n}`, type: 'page', parentId: 'db', content: [], props: { title: title ? [[title]] : [], values }, createdAt: 0, updatedAt: 0, trashedAt: null }) as unknown as Block

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
    for (const hostile of ['constructor()', '__proto__(Gasto)', 'sum(__proto__)', 'sum(constructor)', 'toString()']) expect(typeof value(hostile)).toBe('string')
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
