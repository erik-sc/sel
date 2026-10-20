// Rollup properties: a value computed from the rows one of the row's relations links to.
// A rollup stores nothing; it is computed whenever it is read, so it follows the related
// rows as they change (the views get a new `CellContext` when they do).
import type { Block, PropertySchema, PropertyType, PropertyValue, RollupConfig, RollupFunction, SelectOption, ViewFilter } from '../types'
import { dayKey, type DateValue } from './dates'
import { applyFilters } from './query'
import { linkedRows, relatedDatabaseState, type CellContext } from './relation'
import { findOption, formatValue, getCellValue, isEmptyValue, isPlainObject, isSafeKey, propOf, type Schema } from './values'

export const ROLLUP_FUNCTIONS: RollupFunction[] = [
  'show_original',
  'count',
  'count_values',
  'count_unique',
  'sum',
  'average',
  'min',
  'max',
  'range',
  'earliest',
  'latest',
  'percent_checked'
]

export const ROLLUP_LABELS: Record<RollupFunction, string> = {
  show_original: 'Show original',
  count: 'Count all',
  count_values: 'Count values',
  count_unique: 'Count unique values',
  sum: 'Sum',
  average: 'Average',
  min: 'Min',
  max: 'Max',
  range: 'Range',
  earliest: 'Earliest date',
  latest: 'Latest date',
  percent_checked: 'Percent checked'
}

/** What a new rollup computes: the number of related rows, which needs no property. */
export const DEFAULT_ROLLUP: RollupConfig = { function: 'count' }

function isRollupFunction(fn: unknown): fn is RollupFunction {
  return typeof fn === 'string' && Object.hasOwn(ROLLUP_LABELS, fn)
}

/**
 * A rollup configuration with well-formed parts: a known function (else a count), and
 * the relation / related property ids only when they can be schema keys. Whether they
 * point at anything is decided when the rollup is computed. Returns `raw` itself when it
 * needs no change.
 */
export function sanitizeRollupConfig(raw: unknown): RollupConfig {
  if (!isPlainObject(raw)) return DEFAULT_ROLLUP
  const badFunction = !isRollupFunction(raw.function)
  const badRelation = raw.relationId !== undefined && !isSafeKey(raw.relationId)
  const badProperty = raw.propertyId !== undefined && !isSafeKey(raw.propertyId)
  const filters = raw.filters === undefined ? undefined : wellFormedRules(raw.filters)
  const badFilters =
    raw.filters !== undefined && (filters === undefined || filters.length === 0 || filters.length !== (raw.filters as unknown[]).length)
  if (!badFunction && !badRelation && !badProperty && !badFilters) return raw as unknown as RollupConfig
  const out = { ...raw, function: badFunction ? DEFAULT_ROLLUP.function : raw.function } as RollupConfig
  if (badRelation) delete out.relationId
  if (badProperty) delete out.propertyId
  if (badFilters) {
    if (filters?.length) out.filters = filters
    else delete out.filters
  }
  return out
}

/** The rules of a list that have the shape of one (a property key and an operator); undefined for anything but a list. */
function wellFormedRules(raw: unknown): ViewFilter[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.filter((rule): rule is ViewFilter => isPlainObject(rule) && isSafeKey(rule.propertyId) && typeof rule.operator === 'string')
}

/**
 * The rules of a rollup that apply: those on plain properties of the related database
 * (a rule on a relation, a rollup or a formula would let rollups read each other in a loop).
 * What each rule means is decided as views decide it, so an incomplete one keeps every row.
 */
export function rollupFilters(config: RollupConfig, targetSchema: Schema | undefined): ViewFilter[] {
  if (!config.filters?.length || !targetSchema) return []
  return config.filters.filter((rule) => isRollupSource(propOf(targetSchema, rule.propertyId)))
}

export type RollupKind = 'number' | 'date' | 'text'

/** The kind of value a function gives: counts and sums are numbers, the earliest / latest a date, the original values text. */
export function rollupKind(fn: RollupFunction): RollupKind {
  if (fn === 'earliest' || fn === 'latest') return 'date'
  if (fn === 'show_original') return 'text'
  return 'number'
}

/** The property type a rollup is filtered and sorted as. */
export function rollupValueType(config: RollupConfig | undefined): PropertyType {
  const kind = rollupKind(config?.function ?? DEFAULT_ROLLUP.function)
  return kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'
}

/**
 * Properties of a related database a rollup can read: anything but relations, rollups and
 * formulas (no chains, so nothing can read itself through another database).
 */
export function isRollupSource(prop: PropertySchema | undefined): prop is PropertySchema {
  return !!prop && prop.type !== 'relation' && prop.type !== 'rollup' && prop.type !== 'formula'
}

const TEXT_FUNCTIONS: RollupFunction[] = ['show_original', 'count', 'count_values', 'count_unique']

/** The functions that make sense for a related property (just the count without one). */
export function rollupFunctionsFor(target: PropertySchema | undefined): RollupFunction[] {
  if (!target) return ['count']
  if (!isRollupSource(target)) return []
  switch (target.type) {
    case 'number':
      return [...TEXT_FUNCTIONS, 'sum', 'average', 'min', 'max', 'range']
    case 'checkbox':
      return [...TEXT_FUNCTIONS, 'percent_checked']
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return [...TEXT_FUNCTIONS, 'earliest', 'latest']
    default:
      return TEXT_FUNCTIONS
  }
}

export interface RollupItem {
  text: string
  /** Set for the values of a select property: shown as its tag. */
  option?: SelectOption
}

export type RollupResult =
  | { kind: 'number'; value: number | null; format: PropertySchema['numberFormat'] }
  | { kind: 'date'; value: DateValue | null }
  | { kind: 'text'; items: RollupItem[] }

/** The pieces of a rollup that can be resolved: its relation, the related property and the function. */
export interface ResolvedRollup {
  config: RollupConfig
  relation: PropertySchema | undefined
  target: PropertySchema | undefined
  /** False when something it needs is missing or does not fit (nothing to compute). */
  ready: boolean
}

/** Resolves a rollup of `schema` against the context: its relation and the property it reads. */
export function resolveRollup(prop: PropertySchema, schema: Record<string, PropertySchema> | undefined, ctx: CellContext): ResolvedRollup {
  const config = prop.rollup ?? DEFAULT_ROLLUP
  const candidate = propOf(schema, config.relationId)
  const relation = candidate?.type === 'relation' && candidate.relation ? candidate : undefined
  const targetSchema = relation?.relation ? ctx.schemaOf(relation.relation.databaseId) : undefined
  const target = config.propertyId ? propOf(targetSchema, config.propertyId) : undefined
  const ready = !!relation && (config.function === 'count' || (!!target && rollupFunctionsFor(target).includes(config.function)))
  return { config, relation, target, ready }
}

function itemsOf(value: PropertyValue, target: PropertySchema): RollupItem[] {
  if (target.type === 'select' || target.type === 'multi_select') {
    const ids = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    const out: RollupItem[] = []
    for (const id of ids) {
      const option = findOption(target, id)
      if (option) out.push({ text: option.name, option })
    }
    return out
  }
  if (target.type !== 'checkbox' && isEmptyValue(value)) return []
  const text = formatValue(value, target)
  return text ? [{ text }] : []
}

/** Unique keys of a value: each element of a list, a date by its days, anything else as it is. */
function uniqueKeys(value: PropertyValue, target: PropertySchema): string[] {
  if (target.type === 'checkbox') return [String(value === true)]
  if (isEmptyValue(value)) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value.trim()]
  return [JSON.stringify(value)]
}

function countValues(value: PropertyValue, target: PropertySchema): number {
  if (target.type === 'checkbox') return value === true ? 1 : 0
  if (Array.isArray(value)) return value.length
  return isEmptyValue(value) ? 0 : 1
}

function days(value: PropertyValue, target: PropertySchema, last: boolean): string | null {
  if (target.type === 'date' && value && typeof value === 'object' && !Array.isArray(value)) {
    return dayKey(last && value.end ? value.end : value.start)
  }
  return dayKey(value)
}

/** The rollup of rows already resolved: pure arithmetic over the values the related property holds. */
export function aggregateRollup(fn: RollupFunction, rows: readonly Block[], target: PropertySchema | undefined): RollupResult {
  const number = (value: number | null, format: PropertySchema['numberFormat'] = 'number'): RollupResult => ({
    kind: 'number',
    value: value !== null && isFinite(value) ? value : null,
    format
  })
  if (fn === 'count' || !target) return number(rows.length)
  const values = rows.map((row) => getCellValue(row, target))
  switch (fn) {
    case 'show_original':
      return { kind: 'text', items: values.flatMap((value) => itemsOf(value, target)) }
    case 'count_values':
      return number(values.reduce<number>((sum, value) => sum + countValues(value, target), 0))
    case 'count_unique':
      return number(new Set(values.flatMap((value) => uniqueKeys(value, target))).size)
    case 'percent_checked':
      return number(rows.length ? values.filter((value) => value === true).length / rows.length : null, 'percent')
    case 'earliest':
    case 'latest': {
      let best: string | null = null
      for (const value of values) {
        const day = days(value, target, fn === 'latest')
        if (day && (best === null || (fn === 'earliest' ? day < best : day > best))) best = day
      }
      return { kind: 'date', value: best ? { start: best } : null }
    }
  }
  const numbers = values.filter((value): value is number => typeof value === 'number' && isFinite(value))
  const format = target.numberFormat ?? 'number'
  if (fn === 'sum')
    return number(
      numbers.reduce((sum, n) => sum + n, 0),
      format
    )
  if (!numbers.length) return number(null, format)
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  switch (fn) {
    case 'average':
      return number(numbers.reduce((sum, n) => sum + n, 0) / numbers.length, format)
    case 'min':
      return number(min, format)
    case 'max':
      return number(max, format)
    case 'range':
      return number(max - min, format)
  }
  return number(null)
}

/**
 * The rollup of one row, or null when it cannot be computed: no relation chosen (or it
 * was deleted), the related property is gone, the function does not fit it, or the
 * related database is deleted, in the trash or not loaded yet.
 */
export function computeRollup(row: Block, prop: PropertySchema, ctx: CellContext): RollupResult | null {
  if (prop.type !== 'rollup' || !row.parentId) return null
  const resolved = resolveRollup(prop, ctx.schemaOf(row.parentId), ctx)
  if (!resolved.ready || !resolved.relation?.relation) return null
  const databaseId = resolved.relation.relation.databaseId
  if (relatedDatabaseState(databaseId, ctx) !== 'ok') return null
  const rows = linkedRows(row, resolved.relation, ctx)
  const targetSchema = ctx.schemaOf(databaseId)
  const rules = rollupFilters(resolved.config, targetSchema)
  // No context for the rules: they only read what the related rows store.
  const kept = rules.length && targetSchema ? applyFilters(rows, targetSchema, rules) : rows
  return aggregateRollup(resolved.config.function, kept, resolved.target)
}

/** A rollup result as a cell value: a number, a date, or the original values as one line of text. */
export function rollupValue(result: RollupResult | null): PropertyValue {
  if (!result) return null
  if (result.kind === 'number' || result.kind === 'date') return result.value
  const text = result.items.map((item) => item.text).join(', ')
  return text === '' ? null : text
}
