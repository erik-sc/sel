// The meaning of formulas: the type each part of a formula has, the functions it may call,
// and its evaluation for one row. Pure: no React, no store; property values come in
// through `RunEnv.read`.
//
// Values are numbers, text, checkboxes (true / false), dates (calendar days, possibly a
// range) and lists of text (the linked pages of a relation, the tags of a multi-select).
// Each part's type is known before anything runs, so a formula that mixes them up is an
// error in every row, shown where it is wrong, instead of a surprise in some rows.
//
// Empty values: a missing number counts as 0 and missing text as "" wherever an operator
// or a function needs one (sum, min and max skip them); a missing date gives a missing
// result. `empty(x)` tells them apart.
//
// Nothing here throws at the caller: every failure is a message, and evaluation stops after
// FORMULA_LIMITS.steps steps or when text grows past FORMULA_LIMITS.text characters.
import { addDays, diffDays, formatDate as formatDay, isDateValue, type DateValue } from './dates'
import { FORMULA_LIMITS, type FormulaNode, type FormulaProblem } from './formulaSyntax'

export type FormulaType = 'number' | 'text' | 'checkbox' | 'date' | 'list'
/** number: number or null (empty) · text: string · checkbox: boolean · date: DateValue or null · list: string[] */
export type FormulaValue = number | string | boolean | DateValue | string[] | null

export const FORMULA_TYPE_LABELS: Record<FormulaType, string> = {
  number: 'number',
  text: 'text',
  checkbox: 'checkbox',
  date: 'date',
  list: 'list'
}

/** What `prop("…")` reads: its type and the id of the property, or why it cannot be read. */
export type PropertyRef = { id: string; type: FormulaType } | { error: string }

/** A formula with every part typed and every property reference resolved, ready to run. */
export interface CheckedFormula {
  ast: FormulaNode | null
  type: FormulaType
  types: Map<FormulaNode, FormulaType>
  /** The property id each `prop("…")` node reads. */
  props: Map<FormulaNode, string>
  /** Whether it calls now() or today(): its result changes with the day. */
  usesToday: boolean
}

export type CheckResult = { ok: true; formula: CheckedFormula } | { ok: false; error: FormulaProblem }

export interface RunEnv {
  /** The value of a property of the row (formulas included), in the shape of its formula type. */
  read(id: string): FormulaValue
  /** Today, `YYYY-MM-DD`. */
  today: string
  locale?: string
  /** Steps left; shared with the formulas this one reads. */
  budget: { steps: number }
}

export type RunResult = { ok: true; value: FormulaValue } | { ok: false; error: string }

class CheckError extends Error {
  constructor(
    message: string,
    readonly node: { start: number; end: number }
  ) {
    super(message)
  }
}

/** A failure while evaluating: the cell shows the message. */
export class FormulaRunError extends Error {}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

type Thunk = (index: number) => FormulaValue

interface FunctionSpec {
  /** How it is called, for the editor: `round(number, places?)`. */
  signature: string
  /** One line of help. */
  help: string
  min: number
  max: number
  /** The result type for these argument types, or a message saying what is wrong. */
  check(args: FormulaType[], nodes: FormulaNode[]): FormulaType | string
  /** Arguments are evaluated on demand (`if` only runs the branch it takes). */
  run(arg: Thunk, count: number, env: RunEnv, types: FormulaType[]): FormulaValue
}

const UNITS: Record<string, 'days' | 'weeks' | 'months' | 'years'> = {
  day: 'days',
  days: 'days',
  week: 'weeks',
  weeks: 'weeks',
  month: 'months',
  months: 'months',
  year: 'years',
  years: 'years'
}

const MAX_LIST = 10_000

function nameOf(type: FormulaType): string {
  return type === 'list' ? 'a list' : type === 'text' ? 'text' : `a ${type}`
}

function expect(types: FormulaType[], wanted: FormulaType[], fn: string): string | null {
  for (let i = 0; i < types.length; i++) {
    const want = wanted[Math.min(i, wanted.length - 1)]
    if (types[i] !== want) return `Argument ${i + 1} of ${fn}() must be ${nameOf(want)}, not ${nameOf(types[i])}`
  }
  return null
}

function sameTypes(types: FormulaType[], fn: string): FormulaType | string {
  const first = types[0]
  const other = types.findIndex((t) => t !== first)
  return other < 0 ? first : `Every argument of ${fn}() must have the same type (${nameOf(first)} and ${nameOf(types[other])})`
}

function num(value: FormulaValue): number {
  return typeof value === 'number' ? value : 0
}

function text(value: FormulaValue): string {
  return typeof value === 'string' ? value : ''
}

function list(value: FormulaValue): string[] {
  return Array.isArray(value) ? value : []
}

function date(value: FormulaValue): DateValue | null {
  return isDateValue(value) ? value : null
}

function finite(n: number): number {
  if (!isFinite(n)) throw new FormulaRunError('The result is not a finite number')
  return n === 0 ? 0 : n
}

function capText(s: string): string {
  if (s.length > FORMULA_LIMITS.text) throw new FormulaRunError(`The text is longer than ${FORMULA_LIMITS.text} characters`)
  return s
}

/** Joins texts, refusing (before building it) a result past the text limit. */
function joinCapped(parts: readonly string[], separator: string): string {
  let length = parts.length ? separator.length * (parts.length - 1) : 0
  for (const part of parts) length += part.length
  if (length > FORMULA_LIMITS.text) throw new FormulaRunError(`The text is longer than ${FORMULA_LIMITS.text} characters`)
  return parts.join(separator)
}

/** Whether a value counts as empty: no number, blank text, no date, an empty list or an unchecked box. */
export function isEmptyFormulaValue(value: FormulaValue): boolean {
  if (value === null || value === false) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function roundTo(n: number, places: number): number {
  if (places === 0) return Math.sign(n) * Math.round(Math.abs(n))
  // Decimal shifting through the exponent: 1.005 rounds to 1.01, as written.
  const abs = Math.abs(n)
  const shifted = /e/i.test(String(abs)) ? abs * 10 ** places : Number(`${abs}e${places}`)
  const back = Math.round(shifted)
  const out = /e/i.test(String(back)) ? back / 10 ** places : Number(`${back}e-${places}`)
  return Math.sign(n) * out
}

function parseNumberText(s: string): number | null {
  const t = s.trim()
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return isFinite(n) ? n : null
}

function formatText(value: FormulaValue): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(value === 0 ? 0 : value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return joinCapped(value, ', ')
  return value.end ? `${value.start} → ${value.end}` : value.start
}

function dayParts(iso: string): { year: number; month: number; day: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) }
}

function daysInMonth(year: number, month: number): number {
  const d = new Date(0)
  d.setUTCFullYear(year, month, 0)
  return d.getUTCDate()
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function addMonths(iso: string, months: number): string {
  const { year, month, day } = dayParts(iso)
  const index = year * 12 + (month - 1) + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  if (y < 1 || y > 9999) throw new FormulaRunError('The date is out of range')
  return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`
}

function shiftDay(iso: string, amount: number, unit: string): string {
  const n = Math.trunc(amount)
  if (unit === 'months') return addMonths(iso, n)
  if (unit === 'years') return addMonths(iso, n * 12)
  const days = unit === 'weeks' ? n * 7 : n
  if (Math.abs(days) > 4_000_000) throw new FormulaRunError('The date is out of range')
  const out = addDays(iso, days)
  if (days !== 0 && out === iso) throw new FormulaRunError('The date is out of range')
  return out
}

function unitOf(value: FormulaValue): string {
  const key = text(value).trim().toLowerCase()
  if (!Object.hasOwn(UNITS, key)) throw new FormulaRunError(`Unknown unit "${text(value)}": use "days", "weeks", "months" or "years"`)
  return UNITS[key]
}

function checkUnitLiteral(node: FormulaNode | undefined): string | null {
  if (node?.kind !== 'text') return null
  return Object.hasOwn(UNITS, node.value.trim().toLowerCase())
    ? null
    : `Unknown unit "${node.value}": use "days", "weeks", "months" or "years"`
}

function monthsBetween(a: string, b: string): number {
  const x = dayParts(a)
  const y = dayParts(b)
  let months = (x.year - y.year) * 12 + (x.month - y.month)
  // Whole months only: 31 Jan to 28 Feb is not yet a month.
  if (months > 0 && x.day < y.day) months--
  else if (months < 0 && x.day > y.day) months++
  return months
}

const PATTERN_TOKENS = ['YYYY', 'YY', 'MMMM', 'MMM', 'MM', 'M', 'dddd', 'ddd', 'DD', 'D']

function civilName(iso: string, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  const { year, month, day } = dayParts(iso)
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(d)
  } catch {
    return ''
  }
}

function weekdayOf(iso: string): number {
  const { year, month, day } = dayParts(iso)
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  return ((d.getUTCDay() + 6) % 7) + 1
}

/** A day in a pattern of YYYY YY MMMM MMM MM M DD D dddd ddd; anything else is kept as written. */
export function formatDayPattern(iso: string, pattern: string, locale?: string): string {
  const { year, month, day } = dayParts(iso)
  let out = ''
  for (let i = 0; i < pattern.length; ) {
    const token = PATTERN_TOKENS.find((t) => pattern.startsWith(t, i))
    if (!token) {
      out += pattern[i++]
      continue
    }
    i += token.length
    switch (token) {
      case 'YYYY':
        out += pad(year, 4)
        break
      case 'YY':
        out += pad(year % 100)
        break
      case 'MMMM':
        out += civilName(iso, locale, { month: 'long' })
        break
      case 'MMM':
        out += civilName(iso, locale, { month: 'short' })
        break
      case 'MM':
        out += pad(month)
        break
      case 'M':
        out += String(month)
        break
      case 'dddd':
        out += civilName(iso, locale, { weekday: 'long' })
        break
      case 'ddd':
        out += civilName(iso, locale, { weekday: 'short' })
        break
      case 'DD':
        out += pad(day)
        break
      case 'D':
        out += String(day)
        break
    }
  }
  return out
}

function fixed(params: FormulaType[], result: FormulaType, fn: string): (args: FormulaType[]) => FormulaType | string {
  return (args) => expect(args, params, fn) ?? result
}

function numeric(fn: string, apply: (n: number) => number, help: string): FunctionSpec {
  return {
    signature: `${fn}(number)`,
    help,
    min: 1,
    max: 1,
    check: fixed(['number'], 'number', fn),
    run: (arg) => finite(apply(num(arg(0))))
  }
}

function dateField(fn: string, help: string, read: (iso: string) => number): FunctionSpec {
  return {
    signature: `${fn}(date)`,
    help,
    min: 1,
    max: 1,
    check: fixed(['date'], 'number', fn),
    run: (arg) => {
      const d = date(arg(0))
      return d ? read(d.start) : null
    }
  }
}

function aggregate(fn: 'sum' | 'min' | 'max', help: string): FunctionSpec {
  return {
    signature: `${fn}(number, …)`,
    help,
    min: 1,
    max: Infinity,
    check: fixed(['number'], 'number', fn),
    run: (arg, count) => {
      const values: number[] = []
      for (let i = 0; i < count; i++) {
        const v = arg(i)
        if (typeof v === 'number') values.push(v)
      }
      if (fn === 'sum') return finite(values.reduce((s, n) => s + n, 0))
      if (!values.length) return null
      let best = values[0]
      for (const v of values) if (fn === 'min' ? v < best : v > best) best = v
      return best
    }
  }
}

function dateShift(fn: 'dateAdd' | 'dateSubtract', sign: 1 | -1, help: string): FunctionSpec {
  return {
    signature: `${fn}(date, amount, "days" | "weeks" | "months" | "years")`,
    help,
    min: 3,
    max: 3,
    check: (args, nodes) => expect(args, ['date', 'number', 'text'], fn) ?? checkUnitLiteral(nodes[2]) ?? 'date',
    run: (arg) => {
      const d = date(arg(0))
      const amount = num(arg(1)) * sign
      const unit = unitOf(arg(2))
      if (!d) return null
      if (!isFinite(amount)) throw new FormulaRunError('The amount is not a finite number')
      const start = shiftDay(d.start, amount, unit)
      return d.end ? { start, end: shiftDay(d.end, amount, unit) } : { start }
    }
  }
}

/**
 * Every function a formula may call. A Map, so that no name a formula holds can reach an
 * object's prototype (`constructor`, `__proto__`…).
 */
const FUNCTIONS = new Map<string, FunctionSpec>([
  [
    'if',
    {
      signature: 'if(condition, then, else?)',
      help: 'then when the condition is true, else otherwise (empty without else)',
      min: 2,
      max: 3,
      check: (args) => {
        if (args[0] !== 'checkbox') return `The condition of if() must be a checkbox (true or false), not ${nameOf(args[0])}`
        if (args.length === 3 && args[1] !== args[2])
          return `Both results of if() must have the same type (${nameOf(args[1])} and ${nameOf(args[2])})`
        return args[1]
      },
      run: (arg, count, _env, types) => (arg(0) === true ? arg(1) : count > 2 ? arg(2) : emptyOf(types[1]))
    }
  ],
  [
    'ifs',
    {
      signature: 'ifs(condition, value, condition, value, …, else?)',
      help: 'The value of the first true condition; else (or empty) when none is true',
      min: 2,
      max: Infinity,
      check: (args) => {
        const result = args[1]
        for (let i = 0; i < args.length; i++) {
          const isCondition = i % 2 === 0 && i < args.length - 1
          if (isCondition && args[i] !== 'checkbox')
            return `Argument ${i + 1} of ifs() is a condition: it must be a checkbox, not ${nameOf(args[i])}`
          if (!isCondition && args[i] !== result)
            return `Every value of ifs() must have the same type (${nameOf(result)} and ${nameOf(args[i])})`
        }
        return result
      },
      run: (arg, count, _env, types) => {
        let i = 0
        for (; i + 1 < count; i += 2) if (arg(i) === true) return arg(i + 1)
        return i < count ? arg(i) : emptyOf(types[1])
      }
    }
  ],
  [
    'empty',
    {
      signature: 'empty(value)',
      help: 'true when the value is empty: no number, blank text, no date, no pages or unchecked',
      min: 1,
      max: 1,
      check: () => 'checkbox',
      run: (arg) => isEmptyFormulaValue(arg(0))
    }
  ],
  [
    'length',
    {
      signature: 'length(text | list)',
      help: 'The number of characters of a text, or of items in a list',
      min: 1,
      max: 1,
      check: (args) => (args[0] === 'text' || args[0] === 'list' ? 'number' : `length() takes text or a list, not ${nameOf(args[0])}`),
      run: (arg) => {
        const v = arg(0)
        return Array.isArray(v) ? v.length : [...text(v)].length
      }
    }
  ],
  [
    'concat',
    {
      signature: 'concat(text, text, …)',
      help: 'Texts one after the other (or lists joined into one list)',
      min: 1,
      max: Infinity,
      check: (args) => {
        const type = sameTypes(args, 'concat')
        if (!isType(type)) return type
        return type === 'text' || type === 'list' ? type : `concat() takes texts or lists, not ${nameOf(type)}`
      },
      run: (arg, count, _env, types) => {
        if (types[0] === 'list') {
          const out: string[] = []
          for (let i = 0; i < count; i++) {
            out.push(...list(arg(i)))
            if (out.length > MAX_LIST) throw new FormulaRunError(`A list can hold at most ${MAX_LIST} items`)
          }
          return out
        }
        const parts: string[] = []
        for (let i = 0; i < count; i++) parts.push(text(arg(i)))
        return joinCapped(parts, '')
      }
    }
  ],
  [
    'join',
    {
      signature: 'join(list, separator?)',
      help: 'The items of a list as one text, separated by ", " or the separator',
      min: 1,
      max: 2,
      check: fixed(['list', 'text'], 'text', 'join'),
      run: (arg, count) => joinCapped(list(arg(0)), count > 1 ? text(arg(1)) : ', ')
    }
  ],
  [
    'contains',
    {
      signature: 'contains(text | list, search)',
      help: 'true when the text contains the search text, or the list holds an item equal to it',
      min: 2,
      max: 2,
      check: (args) => {
        if (args[0] !== 'text' && args[0] !== 'list') return `contains() searches text or a list, not ${nameOf(args[0])}`
        return args[1] === 'text' ? 'checkbox' : `contains() searches for text, not ${nameOf(args[1])}`
      },
      run: (arg) => {
        const where = arg(0)
        const what = text(arg(1))
        return Array.isArray(where) ? where.includes(what) : text(where).includes(what)
      }
    }
  ],
  [
    'lower',
    {
      signature: 'lower(text)',
      help: 'The text in lower case',
      min: 1,
      max: 1,
      check: fixed(['text'], 'text', 'lower'),
      run: (arg) => capText(text(arg(0)).toLowerCase())
    }
  ],
  [
    'upper',
    {
      signature: 'upper(text)',
      help: 'The text in upper case',
      min: 1,
      max: 1,
      check: fixed(['text'], 'text', 'upper'),
      run: (arg) => capText(text(arg(0)).toUpperCase())
    }
  ],
  [
    'trim',
    {
      signature: 'trim(text)',
      help: 'The text without spaces at either end',
      min: 1,
      max: 1,
      check: fixed(['text'], 'text', 'trim'),
      run: (arg) => text(arg(0)).trim()
    }
  ],
  [
    'replace',
    {
      signature: 'replace(text, find, replacement)',
      help: 'The text with the first occurrence of find replaced (plain text, not a pattern)',
      min: 3,
      max: 3,
      check: fixed(['text'], 'text', 'replace'),
      run: (arg) => {
        const source = text(arg(0))
        const find = text(arg(1))
        const by = text(arg(2))
        const at = find ? source.indexOf(find) : -1
        return at < 0 ? source : capText(source.slice(0, at) + by + source.slice(at + find.length))
      }
    }
  ],
  [
    'replaceAll',
    {
      signature: 'replaceAll(text, find, replacement)',
      help: 'The text with every occurrence of find replaced (plain text, not a pattern)',
      min: 3,
      max: 3,
      check: fixed(['text'], 'text', 'replaceAll'),
      run: (arg) => {
        const source = text(arg(0))
        const find = text(arg(1))
        return find ? joinCapped(source.split(find), text(arg(2))) : source
      }
    }
  ],
  [
    'round',
    {
      signature: 'round(number, places?)',
      help: 'The number rounded to whole units, or to that many decimal places',
      min: 1,
      max: 2,
      check: fixed(['number'], 'number', 'round'),
      run: (arg, count) => {
        const places = count > 1 ? Math.trunc(num(arg(1))) : 0
        if (!(places >= 0 && places <= 10)) throw new FormulaRunError('round() keeps 0 to 10 decimal places')
        return finite(roundTo(num(arg(0)), places))
      }
    }
  ],
  ['floor', numeric('floor', Math.floor, 'The number rounded down')],
  ['ceil', numeric('ceil', Math.ceil, 'The number rounded up')],
  ['abs', numeric('abs', Math.abs, 'The number without its sign')],
  ['min', aggregate('min', 'The smallest of the numbers (empty ones are skipped)')],
  ['max', aggregate('max', 'The largest of the numbers (empty ones are skipped)')],
  ['sum', aggregate('sum', 'The numbers added up (empty ones are skipped)')],
  [
    'toNumber',
    {
      signature: 'toNumber(text | checkbox)',
      help: 'The number a text holds (empty when it holds none); 1 or 0 for a checkbox',
      min: 1,
      max: 1,
      check: (args) =>
        args[0] === 'text' || args[0] === 'checkbox' || args[0] === 'number'
          ? 'number'
          : `toNumber() takes text or a checkbox, not ${nameOf(args[0])}`,
      run: (arg) => {
        const v = arg(0)
        if (typeof v === 'boolean') return v ? 1 : 0
        if (typeof v === 'number' || v === null) return v
        return parseNumberText(text(v))
      }
    }
  ],
  [
    'format',
    {
      signature: 'format(value)',
      help: 'Any value as text: 1234.5, true, 2026-10-14, or the items of a list',
      min: 1,
      max: 1,
      check: () => 'text',
      run: (arg) => formatText(arg(0))
    }
  ],
  [
    'now',
    {
      signature: 'now()',
      help: 'Today (dates in sel are days)',
      min: 0,
      max: 0,
      check: () => 'date',
      run: (_arg, _count, env) => ({ start: env.today })
    }
  ],
  [
    'today',
    { signature: 'today()', help: 'Today', min: 0, max: 0, check: () => 'date', run: (_arg, _count, env) => ({ start: env.today }) }
  ],
  ['dateAdd', dateShift('dateAdd', 1, 'The date moved later by an amount of days, weeks, months or years')],
  ['dateSubtract', dateShift('dateSubtract', -1, 'The date moved earlier by an amount of days, weeks, months or years')],
  [
    'dateBetween',
    {
      signature: 'dateBetween(date, date, "days" | "weeks" | "months" | "years")',
      help: 'Whole units from the second date to the first (negative when the first is earlier)',
      min: 3,
      max: 3,
      check: (args, nodes) => expect(args, ['date', 'date', 'text'], 'dateBetween') ?? checkUnitLiteral(nodes[2]) ?? 'number',
      run: (arg) => {
        const a = date(arg(0))
        const b = date(arg(1))
        const unit = unitOf(arg(2))
        if (!a || !b) return null
        if (unit === 'days') return diffDays(b.start, a.start)
        if (unit === 'weeks') return Math.trunc(diffDays(b.start, a.start) / 7)
        const months = monthsBetween(a.start, b.start)
        return unit === 'months' ? months : Math.trunc(months / 12)
      }
    }
  ],
  [
    'formatDate',
    {
      signature: 'formatDate(date, pattern?)',
      help: 'The date as text, like "Oct 14, 2026", or in a pattern such as "YYYY-MM-DD" or "D MMMM YYYY"',
      min: 1,
      max: 2,
      check: fixed(['date', 'text'], 'text', 'formatDate'),
      run: (arg, count, env) => {
        const d = date(arg(0))
        const pattern = count > 1 ? text(arg(1)) : null
        if (pattern !== null && pattern.length > 100) throw new FormulaRunError('The pattern of formatDate() is too long')
        if (!d) return ''
        return pattern === null ? formatDay(d, { locale: env.locale }) : formatDayPattern(d.start, pattern, env.locale)
      }
    }
  ],
  ['year', dateField('year', 'The year of a date', (iso) => dayParts(iso).year)],
  ['month', dateField('month', 'The month of a date, 1 to 12', (iso) => dayParts(iso).month)],
  ['day', dateField('day', 'The day of the month of a date, 1 to 31', (iso) => dayParts(iso).day)],
  ['weekday', dateField('weekday', 'The day of the week of a date, 1 (Monday) to 7 (Sunday)', weekdayOf)]
])

function isType(value: unknown): value is FormulaType {
  return value === 'number' || value === 'text' || value === 'checkbox' || value === 'date' || value === 'list'
}

/** The empty value of a type. */
export function emptyOf(type: FormulaType | undefined): FormulaValue {
  switch (type) {
    case 'text':
      return ''
    case 'checkbox':
      return false
    case 'list':
      return []
    default:
      return null
  }
}

export function isFormulaFunction(name: string): boolean {
  return FUNCTIONS.has(name)
}

export interface FunctionHelp {
  name: string
  signature: string
  help: string
}

/** The functions, for the editor's list. */
export const FORMULA_FUNCTIONS: FunctionHelp[] = [...FUNCTIONS].map(([name, spec]) => ({
  name,
  signature: spec.signature,
  help: spec.help
}))

/** The operators, for the editor's list. */
export const FORMULA_OPERATORS: FunctionHelp[] = [
  { name: '+ - * / % ^', signature: 'a + b', help: 'Arithmetic; + also joins two texts' },
  { name: '== != < <= > >=', signature: 'a == b', help: 'Comparisons of two values of the same type' },
  { name: 'and or not', signature: 'a and not b', help: 'Logic on checkboxes (also && || !)' }
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

function arithmetic(op: string): boolean {
  return op === '-' || op === '*' || op === '/' || op === '%' || op === '^'
}

/**
 * Types every part of a parsed formula. `resolve` says what a `prop("…")` reads.
 * The first problem found is the result; nothing is evaluated.
 */
export function checkFormula(ast: FormulaNode | null, resolve: (ref: string) => PropertyRef): CheckResult {
  const types = new Map<FormulaNode, FormulaType>()
  const props = new Map<FormulaNode, string>()
  let usesToday = false

  const visit = (node: FormulaNode): FormulaType => {
    const type = typeOf(node)
    types.set(node, type)
    return type
  }

  const typeOf = (node: FormulaNode): FormulaType => {
    switch (node.kind) {
      case 'number':
        return 'number'
      case 'text':
        return 'text'
      case 'boolean':
        return 'checkbox'
      case 'prop': {
        const ref = resolve(node.ref)
        if ('error' in ref) throw new CheckError(ref.error, node)
        props.set(node, ref.id)
        return ref.type
      }
      case 'unary': {
        const operand = visit(node.operand)
        if (node.op === '-') {
          if (operand !== 'number') throw new CheckError(`Only a number can be negated, not ${nameOf(operand)}`, node)
          return 'number'
        }
        if (operand !== 'checkbox') throw new CheckError(`not needs a checkbox (true or false), not ${nameOf(operand)}`, node)
        return 'checkbox'
      }
      case 'binary': {
        const left = visit(node.left)
        const right = visit(node.right)
        const op = node.op
        if (op === 'and' || op === 'or') {
          if (left !== 'checkbox' || right !== 'checkbox') throw new CheckError(`${op} needs two checkboxes (true or false)`, node)
          return 'checkbox'
        }
        if (op === '+') {
          if (left === 'number' && right === 'number') return 'number'
          if (left === 'text' && right === 'text') return 'text'
          throw new CheckError(
            `+ adds two numbers or joins two texts, not ${nameOf(left)} and ${nameOf(right)}${left === 'text' || right === 'text' ? ' (use format() to turn a value into text)' : ''}`,
            node
          )
        }
        if (arithmetic(op)) {
          if (left !== 'number' || right !== 'number')
            throw new CheckError(`${op} needs two numbers, not ${nameOf(left)} and ${nameOf(right)}`, node)
          return 'number'
        }
        if (left !== right) throw new CheckError(`Cannot compare ${nameOf(left)} with ${nameOf(right)}`, node)
        if (op !== '==' && op !== '!=' && left !== 'number' && left !== 'text' && left !== 'date') {
          throw new CheckError(`${op} compares numbers, texts or dates, not ${nameOf(left)}s`, node)
        }
        return 'checkbox'
      }
      case 'call': {
        const spec = FUNCTIONS.get(node.name)
        if (!spec) throw new CheckError(`Unknown function "${node.name}"`, { start: node.start, end: node.start + node.name.length })
        if (node.name === 'now' || node.name === 'today') usesToday = true
        const count = node.args.length
        if (count < spec.min || count > spec.max) {
          const range =
            spec.min === spec.max ? `${spec.min}` : spec.max === Infinity ? `at least ${spec.min}` : `${spec.min} to ${spec.max}`
          throw new CheckError(`${node.name}() takes ${range} argument${range === '1' ? '' : 's'}: ${spec.signature}`, node)
        }
        const args = node.args.map(visit)
        const result = spec.check(args, node.args)
        if (!isType(result)) throw new CheckError(result, node)
        return result
      }
    }
  }

  if (!ast) return { ok: true, formula: { ast: null, type: 'text', types, props, usesToday } }
  try {
    const type = visit(ast)
    return { ok: true, formula: { ast, type, types, props, usesToday } }
  } catch (error) {
    if (error instanceof CheckError) return { ok: false, error: { message: error.message, start: error.node.start, end: error.node.end } }
    return { ok: false, error: { message: 'This formula cannot be read', start: 0, end: 0 } }
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function compare(left: FormulaValue, right: FormulaValue, type: FormulaType): number | null {
  if (type === 'number') return num(left) - num(right)
  if (type === 'text') {
    const a = text(left)
    const b = text(right)
    return a < b ? -1 : a > b ? 1 : 0
  }
  const a = date(left)
  const b = date(right)
  if (!a || !b) return null
  return a.start < b.start ? -1 : a.start > b.start ? 1 : 0
}

function equal(left: FormulaValue, right: FormulaValue, type: FormulaType): boolean {
  switch (type) {
    case 'number':
      return num(left) === num(right)
    case 'text':
      return text(left) === text(right)
    case 'checkbox':
      return left === right
    case 'list': {
      const a = list(left)
      const b = list(right)
      return a.length === b.length && a.every((item, i) => item === b[i])
    }
    case 'date': {
      const a = date(left)
      const b = date(right)
      if (!a || !b) return a === b
      return a.start === b.start && (a.end ?? a.start) === (b.end ?? b.start)
    }
  }
}

/** Evaluates a checked formula. Never throws: a failure comes back as its message. */
export function runFormula(formula: CheckedFormula, env: RunEnv): RunResult {
  const { types, props } = formula

  const evaluate = (node: FormulaNode): FormulaValue => {
    if (--env.budget.steps < 0) throw new FormulaRunError('This formula takes too many steps')
    switch (node.kind) {
      case 'number':
      case 'text':
      case 'boolean':
        return node.value
      case 'prop':
        return env.read(props.get(node) as string)
      case 'unary': {
        const value = evaluate(node.operand)
        return node.op === '-' ? finite(-num(value)) : value !== true
      }
      case 'binary': {
        const op = node.op
        if (op === 'and') return evaluate(node.left) === true && evaluate(node.right) === true
        if (op === 'or') return evaluate(node.left) === true || evaluate(node.right) === true
        const left = evaluate(node.left)
        const right = evaluate(node.right)
        const type = types.get(node.left) as FormulaType
        switch (op) {
          case '+':
            return type === 'text' ? capText(text(left) + text(right)) : finite(num(left) + num(right))
          case '-':
            return finite(num(left) - num(right))
          case '*':
            return finite(num(left) * num(right))
          case '/':
            if (num(right) === 0) throw new FormulaRunError('Division by zero')
            return finite(num(left) / num(right))
          case '%':
            if (num(right) === 0) throw new FormulaRunError('Division by zero')
            return finite(num(left) % num(right))
          case '^':
            return finite(num(left) ** num(right))
          case '==':
            return equal(left, right, type)
          case '!=':
            return !equal(left, right, type)
        }
        const order = compare(left, right, type)
        if (order === null) return false
        if (op === '<') return order < 0
        if (op === '<=') return order <= 0
        if (op === '>') return order > 0
        return order >= 0
      }
      case 'call': {
        const spec = FUNCTIONS.get(node.name) as FunctionSpec
        const cache = new Map<number, FormulaValue>()
        const arg: Thunk = (index) => {
          if (!cache.has(index)) cache.set(index, evaluate(node.args[index]))
          return cache.get(index) as FormulaValue
        }
        return spec.run(
          arg,
          node.args.length,
          env,
          node.args.map((a) => types.get(a) as FormulaType)
        )
      }
    }
  }

  if (!formula.ast) return { ok: true, value: emptyOf(formula.type) }
  try {
    return { ok: true, value: evaluate(formula.ast) }
  } catch (error) {
    if (error instanceof FormulaRunError) return { ok: false, error: error.message }
    if (error instanceof RangeError) return { ok: false, error: 'This formula is nested too deeply' }
    return { ok: false, error: 'This formula failed' }
  }
}
