// The formulas of a "Calculations" view. Pure: a formula, the rows and the schema go in, a
// number (or the reason there is none) comes out.
//
//   sum(Monthly limit) / 12
//   5000 - sum("Monthly limit")
//   count(Done) / count() * 100
//
// A formula is arithmetic (+ - * / and parentheses, `%` after a number) over numbers and
// functions of one property: sum, avg, min, max, median, and count (the rows that have a
// value; all rows when it is given nothing). A property is named as it is in the database,
// in quotes or brackets when the name could be misread. Rollups and formulas count as what
// they give when the rows' `CellContext` is known.
//
// A view split by a select property computes every figure once per option (the rows that
// have it) and once over all its rows, the total: a small table of groups by figures.
import type { Block, DatabaseView, PropertySchema, SelectOption, ViewCalc } from '@shared/types'
import { filterTypeOf, numberFormatOf, readCell } from './cell'
import { groupRows } from './query'
import type { CellContext } from './relation'
import { isEmptyValue, orderedProperties, propOf, type Schema } from './values'

export type CalcFormat = NonNullable<ViewCalc['format']>

export type CalcResult =
  /** `value` is null when the formula is sound but has nothing to work on (the average of no rows). */
  | { ok: true; value: number | null; format: CalcFormat }
  | { ok: false; error: string }

export const CALC_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'median', 'count'] as const
export type CalcFunction = (typeof CALC_FUNCTIONS)[number]

export const CALC_FUNCTION_LABELS: Record<CalcFunction, string> = {
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  median: 'Median',
  count: 'Count'
}

const ALIASES: Record<string, CalcFunction> = {
  sum: 'sum',
  total: 'sum',
  soma: 'sum',
  avg: 'avg',
  average: 'avg',
  mean: 'avg',
  media: 'avg',
  min: 'min',
  max: 'max',
  median: 'median',
  mediana: 'median',
  count: 'count',
  contar: 'count'
}

/** Lower-case and without diacritics: "Média" and "media" are the same word. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .trim()
}

class FormulaError extends Error {}

/** Thrown through the evaluation when a function has no values: the result is "nothing", not an error. */
const NOTHING = Symbol('nothing')

interface Context {
  rows: readonly Block[]
  schema: Schema
  /** What rollups and formulas are computed from; without it they hold nothing. */
  ctx?: CellContext
  /** Number formats of the properties the formula reads numbers from. */
  formats: Set<CalcFormat>
  /** Whether the result is a ratio or a count rather than an amount. */
  plain: boolean
}

function findProperty(schema: Schema, name: string): PropertySchema {
  const wanted = fold(name)
  const found = orderedProperties(schema).find((prop) => fold(prop.name) === wanted)
  if (!found) throw new FormulaError(`There is no property called "${name}"`)
  return found
}

/** Whether sum, avg, min, max and median can read `prop`: a number or a checkbox, or a rollup or formula that gives one. */
export function isCalcNumber(prop: PropertySchema, schema: Schema): boolean {
  const type = filterTypeOf(prop, schema)
  return type === 'number' || type === 'checkbox'
}

function numbersOf(context: Context, prop: PropertySchema): number[] {
  if (!isCalcNumber(prop, context.schema)) throw new FormulaError(`"${prop.name}" is not a number`)
  const checkbox = filterTypeOf(prop, context.schema) === 'checkbox'
  if (checkbox) context.plain = true
  else context.formats.add(numberFormatOf(prop, context.schema, context.ctx))
  const out: number[] = []
  for (const row of context.rows) {
    const value = readCell(row, prop, context.ctx)
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
    else if (checkbox) out.push(value === true ? 1 : 0)
  }
  return out
}

function call(context: Context, fn: CalcFunction, argument: string): number {
  if (fn === 'count') {
    context.plain = true
    if (!argument) return context.rows.length
    const prop = findProperty(context.schema, argument)
    const checkbox = filterTypeOf(prop, context.schema) === 'checkbox'
    let count = 0
    for (const row of context.rows) {
      const value = readCell(row, prop, context.ctx)
      // A checkbox counts when it is ticked; anything else when it holds something.
      if (checkbox ? value === true : !isEmptyValue(value)) count++
    }
    return count
  }
  if (!argument) throw new FormulaError(`${fn}() needs a property, like ${fn}(Amount)`)
  const numbers = numbersOf(context, findProperty(context.schema, argument))
  if (fn === 'sum') return numbers.reduce((total, n) => total + n, 0)
  if (!numbers.length) throw NOTHING
  if (fn === 'avg') return numbers.reduce((total, n) => total + n, 0) / numbers.length
  if (fn === 'min') return numbers.reduce((least, n) => Math.min(least, n), Infinity)
  if (fn === 'max') return numbers.reduce((most, n) => Math.max(most, n), -Infinity)
  const sorted = [...numbers].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '[': ']' }
const MAX_DEPTH = 40

/** A recursive-descent reading of the formula that computes as it goes. */
function compute(source: string, context: Context): number {
  let at = 0
  const space = (): void => {
    while (at < source.length && /\s/.test(source[at])) at++
  }
  const peek = (): string => {
    space()
    return source[at] ?? ''
  }

  /** What stands between a function's parentheses: a property's name, quoted or not. */
  const argument = (): string => {
    space()
    const close = QUOTES[source[at]]
    let name: string
    if (close) {
      const end = source.indexOf(close, at + 1)
      if (end < 0) throw new FormulaError('A quoted name is not closed')
      name = source.slice(at + 1, end)
      at = end + 1
    } else {
      const end = source.indexOf(')', at)
      if (end < 0) throw new FormulaError('A parenthesis is not closed')
      name = source.slice(at, end)
      at = end
    }
    if (peek() !== ')') throw new FormulaError('A parenthesis is not closed')
    at++
    return name.trim()
  }

  const primary = (depth: number): number => {
    if (depth > MAX_DEPTH) throw new FormulaError('The formula is nested too deeply')
    const next = peek()
    if (next === '(') {
      at++
      const value = sum(depth + 1)
      if (peek() !== ')') throw new FormulaError('A parenthesis is not closed')
      at++
      return value
    }
    const number = /^(\d+(\.\d+)?|\.\d+)/.exec(source.slice(at))
    if (number) {
      at += number[0].length
      let value = Number(number[0])
      if (peek() === '%') {
        at++
        value /= 100
      }
      return value
    }
    const word = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(source.slice(at))
    if (word) {
      at += word[0].length
      const key = fold(word[0])
      const fn = Object.hasOwn(ALIASES, key) ? ALIASES[key] : undefined
      if (peek() !== '(') throw new FormulaError(fn ? `${word[0]} needs parentheses, like ${word[0]}(Amount)` : `Use a function on "${word[0]}", like sum(${word[0]})`)
      if (!fn) throw new FormulaError(`"${word[0]}" is not a function. Try sum, avg, min, max, median or count`)
      at++
      return call(context, fn, argument())
    }
    throw new FormulaError(next ? `"${next}" is not expected here` : 'The formula is not finished')
  }

  const unary = (depth: number): number => {
    if (peek() === '-') {
      at++
      return -unary(depth + 1)
    }
    if (peek() === '+') {
      at++
      return unary(depth + 1)
    }
    return primary(depth)
  }

  const product = (depth: number): number => {
    let value = unary(depth)
    for (;;) {
      const operator = peek()
      if (operator !== '*' && operator !== '/' && operator !== '×' && operator !== '÷') return value
      at++
      const right = unary(depth)
      if (operator === '*' || operator === '×') {
        value *= right
        continue
      }
      context.plain = true
      if (right === 0) throw new FormulaError('Division by zero')
      value /= right
    }
  }

  function sum(depth: number): number {
    let value = product(depth)
    for (;;) {
      const operator = peek()
      if (operator !== '+' && operator !== '-') return value
      at++
      const right = product(depth)
      value = operator === '+' ? value + right : value - right
    }
  }

  const value = sum(0)
  if (peek()) throw new FormulaError(`"${peek()}" is not expected here`)
  return value
}

/**
 * The value of a formula over `rows`. Without a format of its own the result is written like
 * the number property it was computed from (an amount stays an amount); a ratio, a count or
 * a mix of formats is a plain number.
 */
export function evaluateCalc(calc: Pick<ViewCalc, 'formula' | 'format'>, rows: readonly Block[], schema: Schema, ctx?: CellContext): CalcResult {
  const formula = typeof calc.formula === 'string' ? calc.formula.trim() : ''
  if (!formula) return { ok: false, error: 'Write a formula, like sum(Amount)' }
  const context: Context = { rows, schema, ctx, formats: new Set(), plain: false }
  const format = (): CalcFormat => calc.format ?? (!context.plain && context.formats.size === 1 ? [...context.formats][0] : 'number')
  try {
    const value = compute(formula, context)
    if (!Number.isFinite(value)) return { ok: false, error: 'The result is not a number' }
    return { ok: true, value, format: format() }
  } catch (error) {
    if (error === NOTHING) return { ok: true, value: null, format: format() }
    if (error instanceof FormulaError) return { ok: false, error: error.message }
    throw error
  }
}

/** The select property a calculations view is split by, when it still has one. */
export function calcSplitProperty(view: DatabaseView | undefined, schema: Schema): PropertySchema | undefined {
  const prop = propOf(schema, view?.groupBy)
  return prop?.type === 'select' ? prop : undefined
}

export interface CalcGroup {
  /** Option id, or null for the rows without one. */
  key: string | null
  label: string
  option?: SelectOption
  /** One per figure, in the view's order. */
  results: CalcResult[]
}

export interface CalcSplit {
  groups: CalcGroup[]
  /** The figures over all the rows. */
  total: CalcResult[]
}

/**
 * Every figure computed for each option of `by` that some row has (in option order, the
 * rows without one last) and over all the rows.
 */
export function evaluateSplit(calcs: readonly Pick<ViewCalc, 'formula' | 'format'>[], rows: readonly Block[], schema: Schema, by: PropertySchema, ctx?: CellContext): CalcSplit {
  const run = (subset: readonly Block[]): CalcResult[] => calcs.map((calc) => evaluateCalc(calc, subset, schema, ctx))
  const [none, ...options] = groupRows([...rows], by, ctx)
  const groups = [...options, none]
    .filter((group) => group.rows.length > 0)
    .map<CalcGroup>((group) => ({ key: group.key, label: group.label, option: group.option, results: run(group.rows) }))
  return { groups, total: run(rows) }
}
