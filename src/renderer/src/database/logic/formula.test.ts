import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '../../../../shared/types'
import { cellText, filterTypeOf, readCell } from './cell'
import {
  DEFAULT_FORMULA,
  compiledFormulas,
  computeFormula,
  describePosition,
  formulaCompletions,
  formulaDisplayText,
  formulaReferences,
  formulaResultType,
  formulaStoredText,
  previewFormula,
  sanitizeFormulaConfig,
  type FormulaOutcome
} from './formula'
import { checkFormula, runFormula } from './formulaEngine'
import { FORMULA_LIMITS, parseFormula } from './formulaSyntax'
import { addProperty, changePropertyType, deleteProperty, renameProperty, setFormula } from './mutations'
import { normalizeDatabase, sanitizeViews } from './normalize'
import { operatorsOf, queryRows } from './query'
import type { CellContext } from './relation'
import { cellContext } from './resolve'
import type { Schema, Values } from './values'

const TODAY = '2026-10-14'

const BASE: Schema = {
  title: { id: 'title', name: 'Name', type: 'title' },
  price: { id: 'price', name: 'Price', type: 'number' },
  qty: { id: 'qty', name: 'Qty', type: 'number' },
  done: { id: 'done', name: 'Done', type: 'checkbox' },
  due: { id: 'due', name: 'Due', type: 'date' },
  note: { id: 'note', name: 'Note', type: 'text' },
  site: { id: 'site', name: 'Site', type: 'url' },
  status: {
    id: 'status',
    name: 'Status',
    type: 'select',
    options: [
      { id: 's1', name: 'To do', color: 'gray' },
      { id: 's2', name: 'Done', color: 'green' }
    ]
  },
  tags: {
    id: 'tags',
    name: 'Tags',
    type: 'multi_select',
    options: [
      { id: 't1', name: 'Red', color: 'red' },
      { id: 't2', name: 'Blue', color: 'blue' }
    ]
  },
  created: { id: 'created', name: 'Created', type: 'created_time' },
  project: { id: 'project', name: 'Project', type: 'relation', relation: { databaseId: 'projects' } },
  links: { id: 'links', name: 'Links', type: 'rollup', rollup: { relationId: 'project', function: 'count' } }
}

function formula(id: string, name: string, expression: string): PropertySchema {
  return { id, name, type: 'formula', formula: { expression } }
}

function db(id: string, schema: Schema, content: string[]): Block {
  return { id, type: 'database', parentId: null, content, props: { schema, views: [] }, createdAt: 1, updatedAt: 1, trashedAt: null }
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

const PROJECTS = [row('p1', 'projects', 'Apollo'), row('p2', 'projects', 'Gemini')]

interface World {
  ctx: CellContext
  schema: Schema
  rows: Block[]
}

function world(schema: Schema, rows: Block[]): World {
  const blocks = [
    db(
      'tasks',
      schema,
      rows.map((r) => r.id)
    ),
    db('projects', { title: BASE.title }, ['p1', 'p2']),
    ...PROJECTS,
    ...rows
  ]
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const ctx = cellContext({ get: (id) => byId.get(id) })
  return { ctx, schema: ctx.schemaOf('tasks') as Schema, rows }
}

const SAMPLE: Values = {
  price: 12.5,
  qty: 4,
  done: true,
  due: { start: '2026-01-31' },
  note: 'Hello World',
  site: 'example.com',
  status: 's2',
  tags: ['t1', 't2'],
  project: ['p1', 'p2']
}

/** Evaluates `expression` (property names allowed, as typed) as formula `f` of a row holding `values`. */
function evaluate(expression: string, values: Values = SAMPLE, extra: Schema = {}): FormulaOutcome | null {
  const r = row('r1', 'tasks', 'Row one', values, { createdAt: new Date(2026, 4, 3, 15).getTime() })
  const w = world({ ...BASE, ...extra, f: formula('f', 'F', expression) }, [r])
  return computeFormula(r, w.schema.f, w.ctx, { today: TODAY, locale: 'en-US' })
}

function value(expression: string, values?: Values, extra?: Schema): unknown {
  const outcome = evaluate(expression, values, extra)
  if (!outcome?.ok) throw new Error(`${expression}: ${outcome ? outcome.error : 'no outcome'}`)
  return outcome.value
}

function error(expression: string, values?: Values, extra?: Schema): string {
  const outcome = evaluate(expression, values, extra)
  if (!outcome || outcome.ok) throw new Error(`${expression}: expected an error, got ${JSON.stringify(outcome)}`)
  return outcome.error
}

describe('formula arithmetic and logic', () => {
  it('computes with the usual precedence', () => {
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('(1 + 2) * 3')).toBe(9)
    expect(value('2 ^ 10')).toBe(1024)
    expect(value('-2 ^ 2')).toBe(-4)
    expect(value('2 ^ 3 ^ 2')).toBe(512)
    expect(value('7 % 3')).toBe(1)
    expect(value('10 / 4')).toBe(2.5)
    expect(value('-(3 - 5)')).toBe(2)
    expect(value('0 * -1')).toBe(0)
    expect(Object.is(value('0 * -1'), -0)).toBe(false)
  })

  it('reads properties into the arithmetic, an empty number counting as 0', () => {
    expect(value('prop("Price") * prop("Qty")')).toBe(50)
    expect(value('prop("Price") * prop("Qty")', { price: 3 })).toBe(0)
    expect(value('prop("Price")', {})).toBeNull()
  })

  it('fails on division by zero and on results that are not finite', () => {
    expect(error('1 / 0')).toBe('Division by zero')
    expect(error('5 % prop("Qty")', {})).toBe('Division by zero')
    expect(error('10 ^ 400')).toBe('The result is not a finite number')
    expect(error('0 ^ -1')).toBe('The result is not a finite number')
  })

  it('compares values of the same type and combines checkboxes', () => {
    expect(value('prop("Qty") > 3 and prop("Done")')).toBe(true)
    expect(value('not prop("Done") or 1 >= 2')).toBe(false)
    expect(value('!prop("Done") || 1 <= 2')).toBe(true)
    expect(value('"b" > "a"')).toBe(true)
    expect(value('"a" == "A"')).toBe(false)
    expect(value('prop("Note") != ""')).toBe(true)
    expect(value('prop("Due") < today()')).toBe(true)
    expect(value('prop("Due") > today()', {})).toBe(false)
    expect(value('prop("Due") == prop("Due")', {})).toBe(true)
    expect(value('prop("Tags") == prop("Tags")')).toBe(true)
    expect(value('prop("Qty") == 0', {})).toBe(true)
  })

  it('only evaluates what it needs', () => {
    expect(value('false and 1 / 0 > 0')).toBe(false)
    expect(value('true or 1 / 0 > 0')).toBe(true)
    expect(value('if(prop("Qty") == 0, 0, prop("Price") / prop("Qty"))', {})).toBe(0)
    expect(value('ifs(true, 1, 1 / 0 > 0, 2)')).toBe(1)
  })
})

describe('formula functions', () => {
  it('if and ifs pick a value, empty without a fallback', () => {
    expect(value('if(prop("Done"), "yes", "no")')).toBe('yes')
    expect(value('if(prop("Done"), "yes", "no")', {})).toBe('no')
    expect(value('if(false, 5)')).toBeNull()
    expect(value('if(false, "x")')).toBe('')
    expect(value('ifs(prop("Qty") > 10, "many", prop("Qty") > 2, "some", "few")')).toBe('some')
    expect(value('ifs(false, "a", false, "b")')).toBe('')
    expect(value('ifs(false, "a", "fallback")')).toBe('fallback')
  })

  it('empty tells empty values of every type', () => {
    expect(value('empty(prop("Price"))', {})).toBe(true)
    expect(value('empty(prop("Price"))', { price: 0 })).toBe(false)
    expect(value('empty(prop("Note"))', { note: '   ' })).toBe(true)
    expect(value('empty(prop("Due"))')).toBe(false)
    expect(value('empty(prop("Tags"))', {})).toBe(true)
    expect(value('empty(prop("Done"))', {})).toBe(true)
    expect(value('empty(prop("Project"))')).toBe(false)
  })

  it('works with text', () => {
    expect(value('length(prop("Note"))')).toBe(11)
    expect(value('length("👍🏽a")')).toBe(3)
    expect(value('length(prop("Tags"))')).toBe(2)
    expect(value('concat("a", "b", "c")')).toBe('abc')
    expect(value('concat(prop("Tags"), prop("Project"))')).toEqual(['Red', 'Blue', 'Apollo', 'Gemini'])
    expect(value('prop("Note") + "!"')).toBe('Hello World!')
    expect(value('join(prop("Tags"))')).toBe('Red, Blue')
    expect(value('join(prop("Tags"), " / ")')).toBe('Red / Blue')
    expect(value('contains(prop("Note"), "World")')).toBe(true)
    expect(value('contains(prop("Note"), "world")')).toBe(false)
    expect(value('contains(prop("Tags"), "Blue")')).toBe(true)
    expect(value('contains(prop("Tags"), "Bl")')).toBe(false)
    expect(value('lower(prop("Note")) + upper("x")')).toBe('hello worldX')
    expect(value('trim("  a b  ")')).toBe('a b')
    expect(value('replace("a-b-c", "-", "+")')).toBe('a+b-c')
    expect(value('replaceAll("a-b-c", "-", "+")')).toBe('a+b+c')
    expect(value('replaceAll("a.b", ".", "$&")')).toBe('a$&b')
    expect(value('replace("abc", "", "x")')).toBe('abc')
  })

  it('works with numbers', () => {
    expect(value('round(2.5)')).toBe(3)
    expect(value('round(-2.5)')).toBe(-3)
    expect(value('round(1.005, 2)')).toBe(1.01)
    expect(value('round(1234.5678, 1)')).toBe(1234.6)
    expect(value('round(0.0000001234, 9)')).toBe(1.23e-7)
    expect(error('round(1, 11)')).toBe('round() keeps 0 to 10 decimal places')
    expect(value('floor(-1.5) + ceil(1.2) + abs(-3)')).toBe(3)
    expect(value('min(3, prop("Price"), 7)', {})).toBe(3)
    expect(value('max(prop("Price"), prop("Qty"))')).toBe(12.5)
    expect(value('max(prop("Price"), prop("Qty"))', {})).toBeNull()
    expect(value('sum(prop("Price"), prop("Qty"), 1)', { qty: 2 })).toBe(3)
    expect(value('sum(prop("Price"))', {})).toBe(0)
    expect(value('toNumber("12.5") + toNumber(prop("Done")) + toNumber(" 3e2 ")')).toBe(313.5)
    expect(value('toNumber("12 apples")')).toBeNull()
    expect(value('format(1234.5) + " " + format(prop("Done")) + " " + format(prop("Due")) + " " + format(prop("Tags"))')).toBe(
      '1234.5 true 2026-01-31 Red, Blue'
    )
  })

  it('works with dates (days, in any time zone)', () => {
    expect(value('today()')).toEqual({ start: TODAY })
    expect(value('now()')).toEqual({ start: TODAY })
    expect(value('dateAdd(prop("Due"), 1, "months")')).toEqual({ start: '2026-02-28' })
    expect(value('dateAdd(prop("Due"), 1, "month")', { due: { start: '2024-01-31' } })).toEqual({ start: '2024-02-29' })
    expect(value('dateAdd(prop("Due"), 2, "weeks")')).toEqual({ start: '2026-02-14' })
    expect(value('dateAdd(prop("Due"), -1, "years")')).toEqual({ start: '2025-01-31' })
    expect(value('dateAdd(prop("Due"), 1.9, "days")')).toEqual({ start: '2026-02-01' })
    expect(value('dateSubtract(prop("Due"), 31, "days")')).toEqual({ start: '2025-12-31' })
    expect(value('dateAdd(prop("Due"), 1, "days")', { due: { start: '2026-03-01', end: '2026-03-03' } })).toEqual({
      start: '2026-03-02',
      end: '2026-03-04'
    })
    expect(value('dateAdd(prop("Due"), 1, "days")', {})).toBeNull()
    expect(error('dateAdd(prop("Due"), 99999, "years")')).toBe('The date is out of range')
    expect(value('dateBetween(today(), prop("Due"), "days")')).toBe(256)
    expect(value('dateBetween(prop("Due"), today(), "weeks")')).toBe(-36)
    expect(value('dateBetween(today(), prop("Due"), "months")')).toBe(8)
    expect(value('dateBetween(today(), prop("Due"), "years")')).toBe(0)
    expect(value('dateBetween(today(), prop("Due"), "months")', { due: { start: '2026-09-15' } })).toBe(0)
    expect(value('formatDate(prop("Due"))')).toBe('Jan 31, 2026')
    expect(value('formatDate(prop("Due"), "YYYY-MM-DD, D/M/YY, MMMM MMM, dddd ddd")')).toBe(
      '2026-01-31, 31/1/26, January Jan, Saturday Sat'
    )
    expect(value('formatDate(prop("Due"), "year YYYY")')).toBe('year 2026')
    expect(value('formatDate(prop("Due"))', {})).toBe('')
    expect(value('year(prop("Due")) * 10000 + month(prop("Due")) * 100 + day(prop("Due"))')).toBe(20260131)
    expect(value('weekday(prop("Due"))')).toBe(6)
    expect(value('weekday(today())')).toBe(3)
    expect(value('year(prop("Due"))', {})).toBeNull()
    expect(value('year(prop("Created"))')).toBe(2026)
  })

  it('checks units it can see, and the others when it runs', () => {
    expect(error('dateAdd(today(), 1, "fortnights")')).toBe('Unknown unit "fortnights": use "days", "weeks", "months" or "years"')
    expect(error('dateAdd(today(), 1, prop("Note"))')).toBe('Unknown unit "Hello World": use "days", "weeks", "months" or "years"')
    expect(value('dateAdd(today(), 1, prop("Note"))', { note: 'Days' })).toEqual({ start: '2026-10-15' })
  })
})

describe('what a formula reads', () => {
  it('gives each kind of property in the shape of its formula type', () => {
    expect(value('prop("Name")')).toBe('Row one')
    expect(value('prop("Status")')).toBe('Done')
    expect(value('prop("Status")', {})).toBe('')
    expect(value('prop("Tags")')).toEqual(['Red', 'Blue'])
    expect(value('prop("Site")')).toBe('example.com')
    expect(value('prop("Project")')).toEqual(['Apollo', 'Gemini'])
    expect(value('length(prop("Project"))')).toBe(2)
    expect(value('prop("Links") * 10')).toBe(20)
    expect(value('prop("Created")')).toEqual({ start: '2026-05-03' })
  })

  it('reads other formulas', () => {
    const extra = { total: formula('total', 'Total', 'prop("Price") * prop("Qty")'), big: formula('big', 'Big', 'prop("Total") > 40') }
    expect(value('if(prop("Big"), "big: " + format(prop("Total")), "small")', SAMPLE, extra)).toBe('big: 50')
  })
})

describe('formula type errors', () => {
  it('are found before anything runs, with the place they are at', () => {
    const cases: [string, string][] = [
      ['1 + "a"', '+ adds two numbers or joins two texts, not a number and text (use format() to turn a value into text)'],
      ['prop("Done") + 1', '+ adds two numbers or joins two texts, not a checkbox and a number'],
      ['prop("Note") * 2', '* needs two numbers, not text and a number'],
      ['-"a"', 'Only a number can be negated, not text'],
      ['not 1', 'not needs a checkbox (true or false), not a number'],
      ['1 and true', 'and needs two checkboxes (true or false)'],
      ['1 == "1"', 'Cannot compare a number with text'],
      ['prop("Done") < true', '< compares numbers, texts or dates, not a checkboxs'],
      ['if(1, 2, 3)', 'The condition of if() must be a checkbox (true or false), not a number'],
      ['if(true, 2, "3")', 'Both results of if() must have the same type (a number and text)'],
      ['ifs(true, 1, "x", 2)', 'Argument 3 of ifs() is a condition: it must be a checkbox, not text'],
      ['round("1")', 'Argument 1 of round() must be a number, not text'],
      ['round(1, 2, 3)', 'round() takes 1 to 2 arguments: round(number, places?)'],
      ['today(1)', 'today() takes 0 arguments: today()'],
      ['if(true)', 'if() takes 2 to 3 arguments: if(condition, then, else?)'],
      ['concat("a", prop("Tags"))', 'Every argument of concat() must have the same type (text and a list)'],
      ['concat(1, 2)', 'concat() takes texts or lists, not a number'],
      ['length(5)', 'length() takes text or a list, not a number'],
      ['contains(1, "a")', 'contains() searches text or a list, not a number'],
      ['join(prop("Tags"), 1)', 'Argument 2 of join() must be text, not a number'],
      ['formatDate("2026-01-01")', 'Argument 1 of formatDate() must be a date, not text'],
      ['toNumber(today())', 'toNumber() takes text or a checkbox, not a date'],
      ['frobnicate(1)', 'Unknown function "frobnicate"'],
      ['prop("Nope")', 'No property named "Nope"']
    ]
    for (const [text, message] of cases) expect([text, error(text)]).toEqual([text, message])
  })

  it('point at the part that is wrong', () => {
    const r = row('r1', 'tasks', 'R')
    const w = world({ ...BASE, f: formula('f', 'F', '1 + (2 * "x")') }, [r])
    const compiled = compiledFormulas(w.schema).get('f')
    expect(compiled).toMatchObject({ ok: false, error: { start: 5, end: 12 } })
  })

  it('make the result type text, so filters fall back to text rules', () => {
    const w = world({ ...BASE, f: formula('f', 'F', '1 + "a"') }, [])
    expect(formulaResultType(w.schema.f, w.schema)).toBe('text')
    expect(filterTypeOf(w.schema.f, w.schema)).toBe('text')
  })
})

describe('formulas that read each other', () => {
  it('report a loop as circular, in every formula on it', () => {
    const schema: Schema = {
      ...BASE,
      a: formula('a', 'A', 'prop("B") + 1'),
      b: formula('b', 'B', 'prop("C") + 1'),
      c: formula('c', 'C', 'prop("A") + 1'),
      d: formula('d', 'D', 'prop("A") * 2'),
      e: formula('e', 'E', 'prop("E")')
    }
    const compiled = compiledFormulas(world(schema, []).schema)
    expect(compiled.get('a')).toMatchObject({ ok: false, error: { message: 'Circular reference: A → B → C → A', start: 0, end: 9 } })
    expect(compiled.get('b')).toMatchObject({ ok: false, error: { message: 'Circular reference: A → B → C → A' } })
    expect(compiled.get('c')).toMatchObject({ ok: false, error: { message: 'Circular reference: A → B → C → A', start: 0, end: 9 } })
    expect(compiled.get('d')).toMatchObject({ ok: false, error: { message: 'A has an error' } })
    expect(compiled.get('e')).toMatchObject({ ok: false, error: { message: 'A formula cannot read itself' } })
  })

  it('pass on a failure in a row as an error of the formula that reads it', () => {
    const extra = { ratio: formula('ratio', 'Ratio', 'prop("Price") / prop("Qty")') }
    expect(error('prop("Ratio") + 1', {}, extra)).toBe('Ratio has an error')
    expect(value('prop("Ratio") + 1', { price: 6, qty: 3 }, extra)).toBe(3)
  })

  it('refuse chains longer than the limit', () => {
    const extra: Schema = { f0: formula('f0', 'F0', '1') }
    for (let i = 1; i <= FORMULA_LIMITS.chain; i++) extra[`f${i}`] = formula(`f${i}`, `F${i}`, `prop("F${i - 1}") + 1`)
    // The formula under test reads through the others: it is the last one a chain may hold.
    expect(value(`prop("F${FORMULA_LIMITS.chain - 2}")`, {}, extra)).toBe(FORMULA_LIMITS.chain - 1)
    expect(error(`prop("F${FORMULA_LIMITS.chain - 1}")`, {}, extra)).toBe(
      `Too many formulas read one another (at most ${FORMULA_LIMITS.chain} in a chain)`
    )
    expect(error(`prop("F${FORMULA_LIMITS.chain}")`, {}, extra)).toBe(`F${FORMULA_LIMITS.chain} has an error`)
  })

  it('evaluate each formula once per row, however often it is read', () => {
    // Each level reads the one below twice: without memoising this is 2^9 evaluations.
    const extra: Schema = { g0: formula('g0', 'G0', '1') }
    for (let i = 1; i <= 8; i++) extra[`g${i}`] = formula(`g${i}`, `G${i}`, `prop("G${i - 1}") + prop("G${i - 1}")`)
    expect(value('prop("G8") * 2', {}, extra)).toBe(512)
  })
})

describe('formula limits and safety', () => {
  it('stops an evaluation that takes too many steps', () => {
    const parsed = parseFormula('1 + 2 + 3 + 4')
    const checked = parsed.ok ? checkFormula(parsed.ast, () => ({ error: 'none' })) : null
    if (!checked?.ok) throw new Error('setup')
    const env = { read: () => null, today: TODAY, budget: { steps: 3 } }
    expect(runFormula(checked.formula, env)).toEqual({ ok: false, error: 'This formula takes too many steps' })
    expect(runFormula(checked.formula, { ...env, budget: { steps: 100 } })).toEqual({ ok: true, value: 10 })
  })

  it('refuses to build text longer than the limit', () => {
    const long = { note: 'a'.repeat(6000) }
    expect(error('prop("Note") + prop("Note")', long)).toBe(`The text is longer than ${FORMULA_LIMITS.text} characters`)
    expect(error('concat(prop("Note"), prop("Note"))', long)).toBe(`The text is longer than ${FORMULA_LIMITS.text} characters`)
    // Would be 36 million characters: refused before it is built.
    expect(error('replaceAll(prop("Note"), "a", prop("Note"))', long)).toBe(`The text is longer than ${FORMULA_LIMITS.text} characters`)
    expect(value('length(replaceAll(prop("Note"), "aa", "a"))', long)).toBe(3000)
  })

  it('never reaches JavaScript prototypes or globals', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype', 'valueOf']) {
      expect(error(`prop("${name}")`)).toBe(`No property named "${name}"`)
      expect(error(`${name}(1)`)).toBe(`Unknown function "${name}"`)
    }
    expect(error('globalThis(1)')).toBe('Unknown function "globalThis"')
    expect(error('eval("1")')).toBe('Unknown function "eval"')
    expect(error('window')).toBe('Unknown name "window". To read a property, write prop("window")')
    expect(error('process.exit()')).toBe('Unexpected character "."')
  })

  it('reads properties whose names look like prototype members', () => {
    const extra: Schema = {
      p1: { id: 'p1', name: '__proto__', type: 'number' },
      p2: { id: 'p2', name: 'constructor', type: 'text' }
    }
    expect(value('prop("__proto__") + 1', { p1: 41 }, extra)).toBe(42)
    expect(value('prop("constructor")', { p2: 'x' }, extra)).toBe('x')
  })
})

describe('formula cells', () => {
  it('read as a value of their result type, and as formatted text', () => {
    const r = row('r1', 'tasks', 'R', SAMPLE)
    const w = world(
      {
        ...BASE,
        n: formula('n', 'N', 'prop("Price") * 1000'),
        t: formula('t', 'T', 'prop("Tags")'),
        c: formula('c', 'C', 'prop("Done")'),
        d: formula('d', 'D', 'dateAdd(prop("Due"), 1, "days")'),
        x: formula('x', 'X', '1 / 0'),
        e: formula('e', 'E', '')
      },
      [r]
    )
    expect(readCell(r, w.schema.n, w.ctx)).toBe(12500)
    expect(cellText(r, w.schema.n, w.ctx, { locale: 'en-US' })).toBe('12,500')
    expect(readCell(r, w.schema.t, w.ctx)).toBe('Red, Blue')
    expect(readCell(r, w.schema.c, w.ctx)).toBe(true)
    expect(cellText(r, w.schema.c, w.ctx)).toBe('Yes')
    expect(readCell(r, w.schema.d, w.ctx)).toEqual({ start: '2026-02-01' })
    expect(cellText(r, w.schema.d, w.ctx, { locale: 'en-US' })).toBe('Feb 1, 2026')
    expect(readCell(r, w.schema.x, w.ctx)).toBeNull()
    expect(cellText(r, w.schema.x, w.ctx)).toBe('')
    expect(readCell(r, w.schema.e, w.ctx)).toBeNull()
    // Without a context there is no schema to read: nothing.
    expect(readCell(r, w.schema.n)).toBeNull()
    expect(cellText(r, w.schema.n)).toBe('')
  })

  it('are computed once per version of a row', () => {
    const r = row('r1', 'tasks', 'R', SAMPLE)
    const w = world({ ...BASE, n: formula('n', 'N', 'prop("Price") * 2') }, [r])
    const first = computeFormula(r, w.schema.n, w.ctx)
    expect(computeFormula(r, w.schema.n, w.ctx)).toBe(first)
    const next = { ...r, props: { ...r.props, values: { price: 1 } } }
    expect(computeFormula(next, w.schema.n, w.ctx)).toEqual({ ok: true, type: 'number', value: 2 })
    // A new schema (an edited formula) is a new computation.
    const w2 = world({ ...BASE, n: formula('n', 'N', 'prop("Price") * 3') }, [r])
    expect(computeFormula(r, w2.schema.n, w2.ctx)).toEqual({ ok: true, type: 'number', value: 37.5 })
    // And so is another day for a formula that reads it.
    const w3 = world({ ...BASE, d: formula('d', 'D', 'today()') }, [r])
    expect(computeFormula(r, w3.schema.d, w3.ctx, { today: '2026-01-01' })).toMatchObject({ value: { start: '2026-01-01' } })
    expect(computeFormula(r, w3.schema.d, w3.ctx, { today: '2026-01-02' })).toMatchObject({ value: { start: '2026-01-02' } })
  })

  it('filter and sort as what they give', () => {
    const rows = [
      row('a', 'tasks', 'A', { price: 3, qty: 1, due: { start: '2026-05-01' } }),
      row('b', 'tasks', 'B', { price: 10, qty: 2, due: { start: '2026-01-01' } }),
      row('c', 'tasks', 'C', { price: 1, qty: 1 }),
      row('d', 'tasks', 'D', { price: 2, qty: 0 })
    ]
    const w = world(
      {
        ...BASE,
        total: formula('total', 'Total', 'prop("Price") * prop("Qty")'),
        cheap: formula('cheap', 'Cheap', 'prop("Total") < 5'),
        later: formula('later', 'Later', 'dateAdd(prop("Due"), 1, "months")')
      },
      rows
    )
    const { schema, ctx } = w
    expect(operatorsOf(schema.total, schema)).toContain('gt')
    expect(operatorsOf(schema.cheap, schema)).toEqual(['checked', 'unchecked'])
    expect(filterTypeOf(schema.later, schema)).toBe('date')
    const view = (filters: DatabaseView['filters'], sorts: DatabaseView['sorts'] = []): DatabaseView => ({
      id: 'v',
      name: 'V',
      type: 'table',
      visibleProperties: [],
      filters,
      sorts
    })
    const ids = (v: DatabaseView): string[] => queryRows(rows, schema, v, '', ctx).map((r) => r.id)
    expect(ids(view([{ propertyId: 'total', operator: 'gt', value: 2 }]))).toEqual(['a', 'b'])
    expect(ids(view([{ propertyId: 'cheap', operator: 'checked' }]))).toEqual(['a', 'c', 'd'])
    expect(ids(view([{ propertyId: 'later', operator: 'gt', value: '2026-03-01' }]))).toEqual(['a'])
    expect(ids(view([], [{ propertyId: 'total', direction: 'desc' }]))).toEqual(['b', 'a', 'c', 'd'])
    expect(ids(view([], [{ propertyId: 'later', direction: 'asc' }]))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('keep their filter rules while the formula has an error', () => {
    const rule = { propertyId: 'f', operator: 'gt' as const, value: 3 }
    const views: DatabaseView[] = [{ id: 'v', name: 'V', type: 'table', visibleProperties: ['title', 'f'], filters: [rule], sorts: [] }]
    const broken = { ...BASE, f: formula('f', 'F', 'prop("Price") +') }
    expect(sanitizeViews(views, broken)[0]).toBe(views[0])
    // It filters nothing out until the formula works again.
    const rows = [row('a', 'tasks', 'A', { price: 1 })]
    const w = world(broken, rows)
    expect(queryRows(rows, w.schema, views[0], '', w.ctx)).toEqual(rows)
    expect(
      sanitizeViews([{ ...views[0], filters: [{ propertyId: 'f', operator: 'gt', value: { start: 'x' } }] }], broken)[0].filters
    ).toEqual([{ propertyId: 'f', operator: 'gt' }])
  })
})

describe('formula configuration', () => {
  it('is repaired when it is malformed, and kept by reference when it is fine', () => {
    expect(sanitizeFormulaConfig(undefined)).toBe(DEFAULT_FORMULA)
    expect(sanitizeFormulaConfig({ expression: 5 })).toBe(DEFAULT_FORMULA)
    const fine = { expression: '1 + 1' }
    expect(sanitizeFormulaConfig(fine)).toBe(fine)
    expect(sanitizeFormulaConfig({ expression: 'x'.repeat(FORMULA_LIMITS.length + 10) }).expression).toHaveLength(FORMULA_LIMITS.length)
    const block = db('tasks', { title: BASE.title, f: { id: 'f', name: 'F', type: 'formula' } as PropertySchema }, [])
    const normalized = normalizeDatabase(block)
    expect(normalized.changed).toBe(true)
    expect(normalized.schema.f.formula).toEqual({ expression: '' })
    const clean = db('tasks', { title: BASE.title, f: formula('f', 'F', '1') }, [])
    expect(normalizeDatabase(clean).schema).toBe(clean.props.schema)
    // A formula property of another type loses the configuration.
    const other = db('tasks', { title: BASE.title, f: { id: 'f', name: 'F', type: 'text', formula: { expression: '1' } } }, [])
    expect(normalizeDatabase(other).schema.f.formula).toBeUndefined()
  })

  it('comes with a new formula property, and goes when it changes type', () => {
    const added = addProperty(BASE, { id: 'f', type: 'formula', name: 'Total' })
    expect(added.property).toEqual({ id: 'f', name: 'Total', type: 'formula', formula: { expression: '' } })
    const set = setFormula(added.schema, 'f', 'prop("price") * 2')
    expect(set.f.formula).toEqual({ expression: 'prop("price") * 2' })
    expect(setFormula(set, 'f', 'prop("price") * 2')).toBe(set)
    expect(setFormula(set, 'price', '1')).toBe(set)
    const rows = [row('r', 'tasks', 'R', { note: 'stale', f: 'left over' })]
    const toText = changePropertyType(set, 'f', 'text', rows)
    expect(toText.schema.f).toEqual({ id: 'f', name: 'Total', type: 'text' })
    expect(toText.rowValues.r).toEqual({ note: 'stale' })
    const toFormula = changePropertyType(BASE, 'note', 'formula', rows)
    expect(toFormula.schema.note).toEqual({ id: 'note', name: 'Note', type: 'formula', formula: { expression: '' } })
    expect(toFormula.rowValues.r).toEqual({ f: 'left over' })
  })
})

describe('property names in formulas', () => {
  const schema: Schema = { ...BASE, f: formula('f', 'Total', 'prop("price") * prop("qty")') }

  it('are stored as ids and shown as names', () => {
    expect(formulaDisplayText('prop("price") * prop("qty")', schema)).toBe('prop("Price") * prop("Qty")')
    expect(formulaStoredText('prop("Price") * prop("Qty")', schema)).toBe('prop("price") * prop("qty")')
    expect(formulaReferences('prop("price") + prop("gone")')).toEqual(['price', 'gone'])
  })

  it('survive a rename without the formula changing', () => {
    const renamed = renameProperty(schema, 'price', 'Unit "price"')
    expect(renamed.f).toBe(schema.f)
    expect(formulaDisplayText(renamed.f.formula?.expression ?? '', renamed)).toBe('prop("Unit \\"price\\"") * prop("Qty")')
    expect(formulaStoredText('prop("Unit \\"price\\"") * 2', renamed)).toBe('prop("price") * 2')
    const r = row('r', 'tasks', 'R', { price: 2, qty: 3 })
    const w = world(renamed, [r])
    expect(computeFormula(r, w.schema.f, w.ctx)).toMatchObject({ ok: true, value: 6 })
  })

  it('keep ids where a name is shared, so saving changes nothing', () => {
    const twins: Schema = { ...schema, other: { id: 'other', name: 'Price', type: 'number' } }
    const display = formulaDisplayText('prop("other") + prop("price")', twins)
    expect(display).toBe('prop("other") + prop("price")')
    expect(formulaStoredText(display, twins)).toBe('prop("other") + prop("price")')
  })

  it('show a deleted property as an error, and pick up a name once a property has it', () => {
    const { schema: without } = deleteProperty(schema, [], 'qty')
    const w = world(without, [])
    expect(compiledFormulas(w.schema).get('f')).toMatchObject({ ok: false, error: { message: 'No property named "qty"' } })
    const early = { ...BASE, f: formula('f', 'F', 'prop("Bonus") + 1') }
    expect(compiledFormulas(world(early, []).schema).get('f')).toMatchObject({ ok: false })
    const later = { ...early, bonus: { id: 'bonus', name: 'Bonus', type: 'number' } as PropertySchema }
    expect(compiledFormulas(world(later, []).schema).get('f')).toMatchObject({ ok: true })
  })

  it('prefer an id in stored text and a name in what the editor holds', () => {
    // A text property named "title" next to the title property, whose id is "title".
    const tricky: Schema = { ...BASE, lower: { id: 'lower', name: 'title', type: 'text' } }
    expect(formulaStoredText('prop("title") + prop("Name")', tricky)).toBe('prop("lower") + prop("title")')
    expect(formulaDisplayText('prop("lower") + prop("title")', tricky)).toBe('prop("title") + prop("Name")')
    const r = row('r', 'tasks', 'Heading', { lower: 'low' })
    const w = world({ ...tricky, f: formula('f', 'F', 'prop("lower") + "/" + prop("title")') }, [r])
    expect(computeFormula(r, w.schema.f, w.ctx)).toMatchObject({ value: 'low/Heading' })
  })
})

describe('the formula editor', () => {
  const schema: Schema = { ...BASE, f: formula('f', 'Total', 'prop("price") * 2'), g: formula('g', 'Double', 'prop("f") * 2') }

  it('previews what it holds on a row, with names, without caching anything', () => {
    const r = row('r', 'tasks', 'R', { price: 5 })
    const w = world(schema, [r])
    expect(previewFormula('prop("Price") + 1', 'f', w.schema, r, w.ctx, { today: TODAY })).toEqual({
      type: 'number',
      outcome: { ok: true, type: 'number', value: 6 }
    })
    expect(previewFormula('prop("Price") / 0', 'f', w.schema, r, w.ctx)).toEqual({
      type: 'number',
      outcome: { ok: false, error: 'Division by zero' }
    })
    expect(previewFormula('prop("Price") +', 'f', w.schema, r, w.ctx)).toMatchObject({
      problem: { message: expect.stringContaining('ends early'), start: 15 }
    })
    // Reading the formula that reads this one closes a loop.
    expect(previewFormula('prop("Double")', 'f', w.schema, r, w.ctx)).toMatchObject({
      problem: { message: 'Circular reference: Total → Double → Total', start: 0, end: 14 }
    })
    // The views still see the stored formula.
    expect(computeFormula(r, w.schema.f, w.ctx)).toMatchObject({ value: 10 })
    expect(previewFormula('1', 'f', w.schema, undefined, undefined)).toEqual({ type: 'number' })
  })

  it('suggests property names inside prop("…")', () => {
    const text = 'prop("pr'
    expect(formulaCompletions(text, text.length, schema, 'f')).toEqual({
      from: 0,
      to: text.length,
      items: [
        { kind: 'property', label: 'Price', insert: 'prop("Price")', detail: 'number' },
        { kind: 'property', label: 'Project', insert: 'prop("Project")', detail: 'list' }
      ]
    })
    const closed = 'prop("Pri") * 2'
    expect(formulaCompletions(closed, 9, schema, 'f')).toEqual({
      from: 0,
      to: 11,
      items: [{ kind: 'property', label: 'Price', insert: 'prop("Price")', detail: 'number' }]
    })
    expect(formulaCompletions('prop("zzz', 9, schema)).toBeNull()
  })

  it('suggests functions and properties for a word, and nothing inside text', () => {
    const result = formulaCompletions('1 + rou', 7, schema)
    expect(result).toMatchObject({ from: 4, to: 7, items: [{ kind: 'function', label: 'round', insert: 'round(' }] })
    // Functions first, then properties whose names start with the word, then those that contain it.
    expect(formulaCompletions('d', 1, schema)?.items.map((item) => item.label)).toEqual([
      'dateAdd',
      'dateSubtract',
      'dateBetween',
      'day',
      'Done',
      'Due',
      'Double',
      'Created'
    ])
    expect(formulaCompletions('pr', 2, schema)?.items[0]).toMatchObject({ label: 'prop', insert: 'prop("' })
    expect(formulaCompletions('"rou', 4, schema)).toBeNull()
    expect(formulaCompletions('1 + ', 4, schema)).toBeNull()
  })

  it('says where a problem is', () => {
    expect(describePosition('1 + x', 4)).toBe('character 5')
    expect(describePosition('1 +\n  x', 6)).toBe('line 2, column 3')
  })
})

describe('formulas on big tables', () => {
  it('filter, sort and show thousands of rows quickly, and faster the second time', () => {
    const count = 5000
    const rows: Block[] = []
    for (let i = 0; i < count; i++) {
      rows.push(
        row(`r${i}`, 'tasks', `Task ${i}`, {
          price: (i * 37) % 101,
          qty: i % 7,
          done: i % 3 === 0,
          due: { start: `2026-${String((i % 12) + 1).padStart(2, '0')}-15` },
          tags: i % 2 ? ['t1'] : ['t1', 't2']
        })
      )
    }
    const schema: Schema = {
      ...BASE,
      total: formula('total', 'Total', 'round(prop("Price") * prop("Qty") * 1.2, 2)'),
      label: formula(
        'label',
        'Label',
        'if(prop("Done"), "done", "open") + " · " + join(prop("Tags"), "/") + " · " + format(prop("Total"))'
      ),
      late: formula('late', 'Late', 'dateBetween(today(), prop("Due"), "days") > 30 and not prop("Done")')
    }
    const w = world(schema, rows)
    const view: DatabaseView = {
      id: 'v',
      name: 'V',
      type: 'table',
      visibleProperties: [],
      filters: [
        { propertyId: 'total', operator: 'gt', value: 10 },
        { propertyId: 'late', operator: 'checked' }
      ],
      sorts: [{ propertyId: 'label', direction: 'asc' }]
    }
    const started = performance.now()
    const result = queryRows(rows, w.schema, view, '', w.ctx)
    for (const r of result) cellText(r, w.schema.label, w.ctx)
    const first = performance.now() - started
    const again = performance.now()
    queryRows(rows, w.schema, view, '', w.ctx)
    for (const r of result) cellText(r, w.schema.label, w.ctx)
    const second = performance.now() - again
    expect(result.length).toBeGreaterThan(100)
    // Generous bounds for a slow machine: in practice the first pass takes a few tens of ms.
    expect(first).toBeLessThan(1500)
    expect(second).toBeLessThan(Math.max(first, 50))
  })
})
