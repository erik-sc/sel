// Formula properties: a value computed for each row from its other properties.
//
// The syntax is in ./formulaSyntax.ts and the types, functions and evaluation in
// ./formulaEngine.ts; this module ties them to a database. Each schema object's formulas are
// parsed (texts are cached), resolved and typed once, with circular references found; each
// row's results are computed when first read and kept for that version of the row (a store
// row is immutable, so a new version is a new object). Nothing is ever stored in the row.
//
// Property references are stored by id (`prop("<id>")`) and shown by name: renaming a
// property changes no formula, so a rename and a formula edit made on two devices merge
// cleanly, and two properties that share a name stay apart. A reference that is not an id
// is read as a name, so a formula typed before its property existed starts working once
// it does.
import type { Block, FormulaConfig, PropertySchema, PropertyType } from '../../../../shared/types'
import { dayKey, formatDate, normalizeDateValue, todayISO, type FormatOptions } from './dates'
import {
  FORMULA_LIMITS,
  lineColumn,
  parseFormula,
  propReferences,
  quoteText,
  rewriteReferences,
  tokenize,
  type FormulaNode,
  type FormulaProblem,
  type ParseResult
} from './formulaSyntax'
import {
  FORMULA_FUNCTIONS,
  FormulaRunError,
  checkFormula,
  isFormulaFunction,
  runFormula,
  type CheckedFormula,
  type FormulaType,
  type FormulaValue,
  type PropertyRef
} from './formulaEngine'
import { linkedTitles, type CellContext } from './relation'
import { computeRollup, rollupKind, DEFAULT_ROLLUP } from './rollup'
import { findOption, formatNumber, getCellValue, isPlainObject, orderedProperties, propOf, type Schema } from './values'

export { FORMULA_LIMITS, lineColumn, type FormulaProblem } from './formulaSyntax'
export { FORMULA_FUNCTIONS, FORMULA_OPERATORS, FORMULA_TYPE_LABELS, isEmptyFormulaValue, type FormulaType, type FormulaValue } from './formulaEngine'

/** What a new formula holds: nothing yet (its cells stay empty). */
export const DEFAULT_FORMULA: FormulaConfig = { expression: '' }

/** A formula configuration with a string expression no longer than the limit. Returns `raw` itself when it is fine. */
export function sanitizeFormulaConfig(raw: unknown): FormulaConfig {
  if (!isPlainObject(raw) || typeof raw.expression !== 'string') return DEFAULT_FORMULA
  if (raw.expression.length > FORMULA_LIMITS.length) return { ...raw, expression: raw.expression.slice(0, FORMULA_LIMITS.length) }
  return raw as unknown as FormulaConfig
}

export function expressionOf(prop: PropertySchema | undefined): string {
  const expression: unknown = prop?.formula?.expression
  return typeof expression === 'string' ? expression : ''
}

// ---------------------------------------------------------------------------
// Parsing (cached by text)
// ---------------------------------------------------------------------------

const PARSE_CACHE_SIZE = 500
const parsed = new Map<string, ParseResult>()

/** The parse of a formula text; the same text is parsed once (up to a few hundred texts are kept). */
export function parseCached(text: string): ParseResult {
  const hit = parsed.get(text)
  if (hit) return hit
  const result = parseFormula(text, isFormulaFunction)
  if (parsed.size >= PARSE_CACHE_SIZE) parsed.clear()
  parsed.set(text, result)
  return result
}

// ---------------------------------------------------------------------------
// Compiling the formulas of a schema
// ---------------------------------------------------------------------------

export type CompiledFormula = { ok: true; formula: CheckedFormula } | { ok: false; error: FormulaProblem }

/** Properties by name, the first of each name in property order (how a name is resolved). */
function namesOf(schema: Schema): Map<string, PropertySchema> {
  const out = new Map<string, PropertySchema>()
  for (const prop of orderedProperties(schema)) if (!out.has(prop.name)) out.set(prop.name, prop)
  return out
}

/** The property a reference names. Stored formulas hold ids (a name still works); the editor's text holds names. */
function lookup(schema: Schema, names: Map<string, PropertySchema>, ref: string, mode: 'stored' | 'display'): PropertySchema | undefined {
  return mode === 'stored' ? (propOf(schema, ref) ?? names.get(ref)) : (names.get(ref) ?? propOf(schema, ref))
}

/** The type a property has inside a formula, without looking into other formulas. */
function plainType(prop: PropertySchema): FormulaType {
  switch (prop.type) {
    case 'number':
      return 'number'
    case 'checkbox':
      return 'checkbox'
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return 'date'
    case 'multi_select':
    case 'relation':
      return 'list'
    case 'rollup': {
      const kind = rollupKind(prop.rollup?.function ?? DEFAULT_ROLLUP.function)
      return kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'
    }
    default:
      return 'text'
  }
}

interface Source {
  text: string
  mode: 'stored' | 'display'
}

/**
 * Compiles every formula of a schema. `override` replaces one formula's text with what the
 * editor holds (names, not ids); the result is then not cached.
 */
function compileAll(schema: Schema, override?: { id: string; text: string }): Map<string, CompiledFormula> {
  const names = namesOf(schema)
  const sources = new Map<string, Source>()
  for (const id of Object.keys(schema)) {
    const prop = schema[id]
    if (prop?.type !== 'formula') continue
    sources.set(id, override?.id === id ? { text: override.text, mode: 'display' } : { text: expressionOf(prop), mode: 'stored' })
  }
  if (override && !sources.has(override.id)) sources.set(override.id, { text: override.text, mode: 'display' })

  const out = new Map<string, CompiledFormula>()
  /** For each formula: the formulas it reads, with the node that reads each. */
  const deps = new Map<string, { id: string; node: FormulaNode }[]>()
  const asts = new Map<string, FormulaNode | null>()
  for (const [id, source] of sources) {
    const result = parseCached(source.text)
    if (!result.ok) {
      out.set(id, result)
      continue
    }
    asts.set(id, result.ast)
    const list: { id: string; node: FormulaNode }[] = []
    const walk = (node: FormulaNode): void => {
      if (node.kind === 'prop') {
        const target = lookup(schema, names, node.ref, source.mode)
        if (target && sources.has(target.id)) list.push({ id: target.id, node })
      } else if (node.kind === 'unary') walk(node.operand)
      else if (node.kind === 'binary') {
        walk(node.left)
        walk(node.right)
      } else if (node.kind === 'call') node.args.forEach(walk)
    }
    if (result.ast) walk(result.ast)
    deps.set(id, list)
  }

  // Depth-first over the formulas each one reads: one met again on the way is a cycle.
  const stack: string[] = []
  const circular = new Map<string, FormulaProblem>()
  const chain = new Map<string, number>()
  const visit = (id: string): void => {
    if (out.has(id) || !asts.has(id)) return
    const ast = asts.get(id) as FormulaNode | null
    stack.push(id)
    for (const dep of deps.get(id) ?? []) {
      const at = stack.indexOf(dep.id)
      if (at < 0) {
        visit(dep.id)
        continue
      }
      // A loop: every formula on it is an error, shown where it reads the next one.
      const loop = stack.slice(at)
      const message =
        loop.length === 1
          ? 'A formula cannot read itself'
          : `Circular reference: ${[...loop, dep.id].map((member) => propOf(schema, member)?.name ?? member).join(' → ')}`
      loop.forEach((member, k) => {
        if (circular.has(member)) return
        const next = k + 1 < loop.length ? loop[k + 1] : dep.id
        const node = deps.get(member)?.find((d) => d.id === next)?.node
        circular.set(member, { message, start: node?.start ?? 0, end: node?.end ?? 0 })
      })
    }
    stack.pop()
    const loopProblem = circular.get(id)
    if (loopProblem) {
      out.set(id, { ok: false, error: loopProblem })
      return
    }
    let depth = 0
    for (const dep of deps.get(id) ?? []) depth = Math.max(depth, chain.get(dep.id) ?? 0)
    chain.set(id, depth + 1)
    const source = sources.get(id) as Source
    const resolve = (ref: string): PropertyRef => {
      const target = lookup(schema, names, ref, source.mode)
      if (!target) return { error: `No property named "${ref}"` }
      if (target.type !== 'formula') return { id: target.id, type: plainType(target) }
      const compiled = out.get(target.id)
      if (!compiled?.ok) return { error: `${target.name} has an error` }
      if (depth + 1 > FORMULA_LIMITS.chain) return { error: `Too many formulas read one another (at most ${FORMULA_LIMITS.chain} in a chain)` }
      return { id: target.id, type: compiled.formula.type }
    }
    out.set(id, checkFormula(ast, resolve))
  }
  for (const id of sources.keys()) visit(id)
  return out
}

const compiledCache = new WeakMap<Schema, Map<string, CompiledFormula>>()

/** The compiled formulas of a schema, by property id; computed once per schema object. */
export function compiledFormulas(schema: Schema): Map<string, CompiledFormula> {
  let hit = compiledCache.get(schema)
  if (!hit) {
    hit = compileAll(schema)
    compiledCache.set(schema, hit)
  }
  return hit
}

/** The type of a formula's result (text when it has an error or there is no schema to tell). */
export function formulaResultType(prop: PropertySchema, schema: Schema | undefined): FormulaType {
  if (!schema || prop.type !== 'formula') return 'text'
  const compiled = compiledFormulas(schema).get(prop.id)
  return compiled?.ok ? compiled.formula.type : 'text'
}

/** The property type a formula filters and sorts as: what it gives (a list as its text). */
export function formulaValueType(prop: PropertySchema, schema: Schema | undefined): PropertyType {
  const type = formulaResultType(prop, schema)
  return type === 'list' ? 'text' : type
}

export function hasFormulas(schema: Schema): boolean {
  for (const id of Object.keys(schema)) if (schema[id]?.type === 'formula') return true
  return false
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type FormulaOutcome = { ok: true; type: FormulaType; value: FormulaValue } | { ok: false; error: string }

export interface FormulaOptions {
  /** `YYYY-MM-DD`; today's local day when absent. */
  today?: string
  locale?: string
}

interface Evaluation {
  schema: Schema
  compiled: Map<string, CompiledFormula>
  ctx: CellContext
  today: string
  locale: string | undefined
  results: Map<string, FormulaOutcome>
}

let clock = { at: -Infinity, day: '' }
/** Today's day, worked out at most once a second (formulas are read many times per render). */
function currentDay(): string {
  const now = Date.now()
  if (now - clock.at > 1000) clock = { at: now, day: todayISO() }
  return clock.day
}

/** What a property of the row is inside a formula, in the shape of its formula type. */
function readProperty(row: Block, prop: PropertySchema, ctx: CellContext): FormulaValue {
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'url': {
      const value = getCellValue(row, prop)
      return typeof value === 'string' ? value : ''
    }
    case 'select':
      return findOption(prop, getCellValue(row, prop))?.name ?? ''
    case 'multi_select': {
      const ids = getCellValue(row, prop)
      return Array.isArray(ids) ? ids.map((id) => findOption(prop, id)?.name ?? '').filter((name) => name !== '') : []
    }
    case 'number': {
      const value = getCellValue(row, prop)
      return typeof value === 'number' ? value : null
    }
    case 'checkbox':
      return getCellValue(row, prop) === true
    case 'date':
      return normalizeDateValue(getCellValue(row, prop))
    case 'created_time':
    case 'last_edited_time': {
      const day = dayKey(getCellValue(row, prop))
      return day ? { start: day } : null
    }
    case 'relation':
      return linkedTitles(row, prop, ctx)
    case 'rollup': {
      const result = computeRollup(row, prop, ctx)
      if (!result) return plainType(prop) === 'text' ? '' : null
      if (result.kind === 'text') return result.items.map((item) => item.text).join(', ')
      return result.value
    }
    default:
      return null
  }
}

function evaluate(ev: Evaluation, row: Block, id: string): FormulaOutcome {
  const hit = ev.results.get(id)
  if (hit) return hit
  const compiled = ev.compiled.get(id)
  let outcome: FormulaOutcome
  if (!compiled) outcome = { ok: false, error: 'This formula cannot be read' }
  else if (!compiled.ok) outcome = { ok: false, error: compiled.error.message }
  else {
    const read = (propertyId: string): FormulaValue => {
      const prop = propOf(ev.schema, propertyId)
      if (!prop) return null
      if (prop.type !== 'formula') return readProperty(row, prop, ev.ctx)
      const inner = evaluate(ev, row, propertyId)
      if (!inner.ok) throw new FormulaRunError(`${prop.name} has an error`)
      return inner.value
    }
    // Each formula has a budget of its own: a result never depends on which formula was read first.
    const result = runFormula(compiled.formula, { read, today: ev.today, locale: ev.locale, budget: { steps: FORMULA_LIMITS.steps } })
    outcome = result.ok ? { ok: true, type: compiled.formula.type, value: result.value } : result
  }
  ev.results.set(id, outcome)
  return outcome
}

/** Per row version: the results computed so far, for one schema, context and day. */
const memo = new WeakMap<Block, Evaluation>()

/**
 * The result of a formula for a row, computed once per version of the row (and per schema,
 * context and day). Null when the row is not in a database the context knows, or the
 * property is not a formula of it.
 */
export function computeFormula(row: Block, prop: PropertySchema, ctx: CellContext, opts: FormulaOptions = {}): FormulaOutcome | null {
  if (prop.type !== 'formula' || !row.parentId) return null
  const schema = ctx.schemaOf(row.parentId)
  if (!schema || propOf(schema, prop.id)?.type !== 'formula') return null
  const today = opts.today ?? currentDay()
  let ev = memo.get(row)
  if (!ev || ev.schema !== schema || ev.ctx !== ctx || ev.today !== today || ev.locale !== opts.locale) {
    ev = { schema, compiled: compiledFormulas(schema), ctx, today, locale: opts.locale, results: new Map() }
    memo.set(row, ev)
  }
  return evaluate(ev, row, prop.id)
}

/** A formula result as a cell value: a number, text, true / false or a date; a list as one line of text; null when empty or failed. */
export function formulaCellValue(outcome: FormulaOutcome | null): number | string | boolean | { start: string; end?: string } | null {
  if (!outcome?.ok) return null
  const value = outcome.value
  if (Array.isArray(value)) return value.length ? value.join(', ') : null
  if (typeof value === 'string') return value === '' ? null : value
  return value
}

/**
 * A formula result as text: formatted like a number, date or checkbox cell (a number in the
 * property's own number format, when it has one). Empty for an error.
 */
export function formulaText(outcome: FormulaOutcome | null, opts: FormatOptions = {}, format: PropertySchema['numberFormat'] = 'number'): string {
  if (!outcome?.ok) return ''
  const value = outcome.value
  if (value === null) return ''
  if (typeof value === 'number') return formatNumber(value, format, opts)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ')
  return formatDate(value, opts)
}

// ---------------------------------------------------------------------------
// The editor: names in, ids out, completions and a live preview
// ---------------------------------------------------------------------------

/** How many properties have each name: a name two share is no way to tell them apart. */
function nameCounts(schema: Schema): Map<string, number> {
  const out = new Map<string, number>()
  for (const prop of Object.values(schema)) if (prop) out.set(prop.name, (out.get(prop.name) ?? 0) + 1)
  return out
}

/**
 * The text the editor shows: references by name. A property whose name another one
 * shares keeps its id, so saving it back is lossless.
 */
export function formulaDisplayText(expression: string, schema: Schema): string {
  const counts = nameCounts(schema)
  return rewriteReferences(expression, (ref) => {
    const prop = propOf(schema, ref)
    if (!prop || prop.name === ref) return null
    return counts.get(prop.name) === 1 ? prop.name : null
  })
}

/** The text that is stored for what the editor holds: references by id (names that match nothing stay names). */
export function formulaStoredText(text: string, schema: Schema): string {
  const names = namesOf(schema)
  return rewriteReferences(text.slice(0, FORMULA_LIMITS.length), (ref) => {
    const prop = lookup(schema, names, ref, 'display')
    return prop && prop.id !== ref ? prop.id : null
  })
}

/** The ids of the properties a stored formula reads (whether or not they exist). */
export function formulaReferences(expression: string): string[] {
  return propReferences(expression).map((reference) => reference.ref)
}

export interface FormulaPreview {
  /** A problem with the formula itself (the same in every row), with its place in the text. */
  problem?: FormulaProblem
  type?: FormulaType
  /** The result for the sample row: its value, or why it failed there. */
  outcome?: FormulaOutcome
}

/**
 * Checks what the editor holds for the formula `propertyId` of `schema` and, given a row
 * of that database, evaluates it there, without touching any cache the views use.
 */
export function previewFormula(
  text: string,
  propertyId: string,
  schema: Schema,
  row: Block | undefined,
  ctx: CellContext | undefined,
  opts: FormulaOptions = {}
): FormulaPreview {
  const compiled = compileAll(schema, { id: propertyId, text })
  const own = compiled.get(propertyId)
  if (!own) return {}
  if (!own.ok) return { problem: own.error }
  const out: FormulaPreview = { type: own.formula.type }
  if (row && ctx) {
    const ev: Evaluation = {
      schema,
      compiled,
      ctx,
      today: opts.today ?? currentDay(),
      locale: opts.locale,
      results: new Map()
    }
    out.outcome = evaluate(ev, row, propertyId)
  }
  return out
}

/** `prop("Name")`, quoted so that it reads back as the name. */
export function formulaPropRef(name: string): string {
  return `prop(${quoteText(name)})`
}

export interface FormulaCompletion {
  kind: 'property' | 'function'
  label: string
  /** What replaces the text from `from` to `to`. */
  insert: string
  detail: string
}

export interface FormulaCompletions {
  from: number
  to: number
  items: FormulaCompletion[]
}

const MAX_COMPLETIONS = 8

function propertyItems(schema: Schema, query: string, exclude: string | undefined): FormulaCompletion[] {
  const q = query.toLocaleLowerCase()
  const props = orderedProperties(schema).filter((prop) => prop.id !== exclude && prop.name.toLocaleLowerCase().includes(q))
  // Names that start with what was typed first.
  props.sort((a, b) => Number(!a.name.toLocaleLowerCase().startsWith(q)) - Number(!b.name.toLocaleLowerCase().startsWith(q)))
  return props.map((prop) => ({
    kind: 'property',
    label: prop.name,
    insert: formulaPropRef(prop.name),
    detail: prop.type === 'formula' ? 'Formula' : plainType(prop)
  }))
}

/**
 * Suggestions for the word at `caret`: property names inside `prop("…`, else functions and
 * properties whose names start with (or contain) the word. Null when there is nothing to suggest.
 */
export function formulaCompletions(text: string, caret: number, schema: Schema, selfId?: string): FormulaCompletions | null {
  const before = text.slice(0, caret)
  const inProp = /prop\(\s*(["'])((?:[^"'\\]|\\.)*)$/.exec(before)
  if (inProp) {
    const from = inProp.index
    let to = caret
    const rest = text.slice(caret)
    const tail = /^[^"'()\n]*(["'])?\s*\)?/.exec(rest)
    if (tail) to += tail[0].length
    const items = propertyItems(schema, inProp[2], selfId).slice(0, MAX_COMPLETIONS)
    return items.length ? { from, to, items } : null
  }
  // Inside an unfinished text literal: nothing to suggest.
  const lexed = tokenize(before)
  if (!lexed.ok && /quote/.test(lexed.error.message)) return null
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)
  if (!word) return null
  const prefix = word[0].toLowerCase()
  const functions: FormulaCompletion[] = FORMULA_FUNCTIONS.filter((fn) => fn.name.toLowerCase().startsWith(prefix)).map((fn) => ({
    kind: 'function',
    label: fn.name,
    insert: `${fn.name}(`,
    detail: fn.help
  }))
  if ('prop'.startsWith(prefix)) functions.unshift({ kind: 'function', label: 'prop', insert: 'prop("', detail: 'The value of a property of the row' })
  const items = [...functions, ...propertyItems(schema, word[0], selfId)]
  const exact = items.length === 1 && items[0].kind === 'function' && items[0].label === word[0] && text[caret] === '('
  if (!items.length || exact) return null
  return { from: word.index, to: caret, items: items.slice(0, MAX_COMPLETIONS) }
}

/** "line 2, column 5" (or "character 5" on a one-line formula) for a place in the text. */
export function describePosition(text: string, offset: number): string {
  const { line, column } = lineColumn(text, offset)
  return text.includes('\n') ? `line ${line}, column ${column}` : `character ${column}`
}
