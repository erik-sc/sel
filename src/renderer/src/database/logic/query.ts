// Filters, quick search, sorts and grouping of rows.
import type {
  Block,
  DatabaseView,
  FilterOperator,
  PropertySchema,
  PropertyType,
  PropertyValue,
  RelativeDate,
  SelectOption,
  ViewFilter,
  ViewSort
} from '../../../../shared/types'
import { RELATIVE_DATES } from '../../../../shared/types'
import { relationIds } from '../../../../shared/relation'
import { cellText, filterTypeOf, readCell } from './cell'
import { MAX_RANGE_DAYS, addDays, dayKey, formatDay, inSpan, isDateValue, momentKey, relativeSpan, todayISO } from './dates'
import type { CellContext } from './relation'
import { visibleProps } from './views'
import {
  findOption,
  formatValue,
  getCellValue,
  isDateLikeType,
  isEmptyValue,
  optionsOf,
  propOf,
  titleOf,
  type Schema,
  type Values
} from './values'

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const TEXT_OPS: FilterOperator[] = ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty']
const OPERATORS: Record<PropertyType, FilterOperator[]> = {
  title: TEXT_OPS,
  text: TEXT_OPS,
  url: TEXT_OPS,
  number: ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  select: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  multi_select: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  date: ['equals', 'date_is', 'lt', 'gt', 'is_empty', 'is_not_empty'],
  checkbox: ['checked', 'unchecked'],
  created_time: ['equals', 'date_is', 'lt', 'gt'],
  last_edited_time: ['equals', 'date_is', 'lt', 'gt'],
  relation: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  // A rollup filters as what it gives (`filterTypeOf`); these are the operators of a count.
  rollup: ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  // So does a formula; these are the operators of text (what a formula with an error counts as).
  formula: TEXT_OPS
}

/** Operators of a property type. For a property, use `operatorsOf`: a rollup or a formula filters as what it gives. */
export function operatorsFor(type: PropertyType): FilterOperator[] {
  return Object.hasOwn(OPERATORS, type) ? OPERATORS[type] : TEXT_OPS
}

/** Operators of a property. A formula's depend on what it gives, which `schema` tells. */
export function operatorsOf(prop: PropertySchema, schema?: Schema): FilterOperator[] {
  return operatorsFor(filterTypeOf(prop, schema))
}

/**
 * The operators a stored rule on a property may keep. A formula's are those of anything a
 * formula can give: a rule that does not fit what it gives right now (say, while it has an
 * error) is ignored rather than dropped, and works again once the formula does.
 */
export function ruleOperatorsOf(prop: PropertySchema, schema?: Schema): FilterOperator[] {
  return prop.type === 'formula' ? FORMULA_RULE_OPERATORS : operatorsOf(prop, schema)
}

const FORMULA_RULE_OPERATORS: FilterOperator[] = [
  ...new Set([...OPERATORS.number, ...OPERATORS.text, ...OPERATORS.checkbox, ...OPERATORS.date])
]

/** True for the name of a span of days `date_is` understands. */
export function isRelativeDate(value: unknown): value is RelativeDate {
  return typeof value === 'string' && (RELATIVE_DATES as readonly string[]).includes(value)
}

const RELATIVE_LABELS: Record<RelativeDate, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  overdue: 'Before today',
  by_today: 'Today or before',
  next_7_days: 'Next 7 days',
  past_7_days: 'Past 7 days',
  this_week: 'This week',
  next_week: 'Next week',
  this_month: 'This month'
}

export function relativeDateLabel(name: RelativeDate): string {
  return RELATIVE_LABELS[name]
}

/** The value a stored rule keeps: for a formula any text or number (what it means depends on what the formula gives). */
export function ruleValueOf(prop: PropertySchema, value: unknown, schema?: Schema, operator?: FilterOperator): PropertyValue | undefined {
  if (operator === 'date_is') return isRelativeDate(value) ? value : undefined
  if (prop.type !== 'formula') return filterValueFor(prop, value, schema)
  if (typeof value === 'number') return isFinite(value) ? value : undefined
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** The schema a row's formulas are read with: its database's, as the context has it. */
function schemaFor(row: Block, ctx: CellContext | undefined): Schema | undefined {
  return ctx && row.parentId ? ctx.schemaOf(row.parentId) : undefined
}

export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== 'is_empty' && op !== 'is_not_empty' && op !== 'checked' && op !== 'unchecked'
}

export function operatorLabel(op: FilterOperator, type: PropertyType): string {
  const isDate = isDateLikeType(type)
  switch (op) {
    case 'contains':
      return 'contains'
    case 'not_contains':
      return 'does not contain'
    case 'equals':
      return type === 'number' ? '=' : 'is'
    case 'not_equals':
      return type === 'number' ? '≠' : 'is not'
    case 'is_empty':
      return 'is empty'
    case 'is_not_empty':
      return 'is not empty'
    case 'gt':
      return isDate ? 'is after' : '>'
    case 'lt':
      return isDate ? 'is before' : '<'
    case 'checked':
      return 'is checked'
    case 'unchecked':
      return 'is not checked'
    case 'date_is':
      return 'is within'
  }
}

export function defaultFilter(prop: PropertySchema, schema?: Schema): ViewFilter {
  return { propertyId: prop.id, operator: operatorsOf(prop, schema)[0] }
}

/**
 * The value of a filter rule in the shape its property expects, or undefined when
 * it is missing, wrong-typed or points at an option that no longer exists.
 * A rule without a usable value is "incomplete" and filters nothing out.
 */
export function filterValueFor(prop: PropertySchema, value: unknown, schema?: Schema): PropertyValue | undefined {
  if (value === null || value === undefined) return undefined
  switch (filterTypeOf(prop, schema)) {
    case 'title':
    case 'text':
    case 'url': {
      const text = typeof value === 'string' ? value : typeof value === 'number' && isFinite(value) ? String(value) : ''
      return text.trim() === '' ? undefined : text
    }
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
      return isFinite(n) ? n : undefined
    }
    case 'select': {
      const id: unknown = Array.isArray(value) ? value[0] : value
      return findOption(prop, id) ? (id as string) : undefined
    }
    case 'multi_select': {
      const ids = (Array.isArray(value) ? value : [value]).filter((id): id is string => !!findOption(prop, id))
      return ids.length ? ids : undefined
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return dayKey(value) ?? undefined
    case 'relation': {
      // Ids of linked rows; whether they still exist does not matter to the rule.
      const ids = relationIds(Array.isArray(value) ? value : [value])
      return ids.length ? ids : undefined
    }
    default:
      return undefined
  }
}

/** Whether a row passes one rule. `ctx` lets relations and rollups see the related rows, and formulas their schema. */
export function matchesFilter(row: Block, prop: PropertySchema, filter: ViewFilter, ctx?: CellContext): boolean {
  const op = filter?.operator
  const schema = prop.type === 'formula' ? schemaFor(row, ctx) : undefined
  const type = filterTypeOf(prop, schema)
  if (!operatorsFor(type).includes(op)) return true
  const v = readCell(row, prop, ctx)
  switch (op) {
    case 'is_empty':
      return isEmptyValue(v)
    case 'is_not_empty':
      return !isEmptyValue(v)
    case 'checked':
      return v === true
    case 'unchecked':
      return v !== true
    case 'date_is': {
      // A span relative to today; an unknown name is an incomplete rule and filters nothing out.
      const span = relativeSpan(filter.value, todayISO())
      if (!span) return true
      const start = dayKey(v)
      if (!start) return false
      const end = isDateValue(v) && v.end ? (dayKey(v.end) ?? start) : start
      return inSpan(start, end < start ? start : end, span)
    }
  }
  const fv = filterValueFor(prop, filter.value, schema)
  // An incomplete rule (no value typed yet) does not filter anything out.
  if (fv === undefined) return true

  switch (type) {
    case 'title':
    case 'text':
    case 'url': {
      const s = (typeof v === 'string' ? v : '').toLocaleLowerCase().trim()
      const q = String(fv).toLocaleLowerCase().trim()
      if (op === 'contains') return s.includes(q)
      if (op === 'not_contains') return !s.includes(q)
      if (op === 'equals') return s === q
      if (op === 'not_equals') return s !== q
      return true
    }
    case 'number': {
      const q = fv as number
      const n = typeof v === 'number' ? v : null
      if (op === 'equals') return n === q
      // Empty cells are "not equal" to any number but never greater / less than one.
      if (op === 'not_equals') return n !== q
      if (op === 'gt') return n !== null && n > q
      if (op === 'lt') return n !== null && n < q
      return true
    }
    case 'select': {
      if (op === 'equals') return v === fv
      if (op === 'not_equals') return v !== fv
      return true
    }
    case 'multi_select': {
      const have = Array.isArray(v) ? v : []
      const want = fv as string[]
      if (op === 'contains') return want.every((id) => have.includes(id))
      if (op === 'not_contains') return !want.some((id) => have.includes(id))
      return true
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const q = fv as string
      const start = dayKey(v)
      if (!start) return false
      // A range is "on" every day it covers, "after" when it ends after and "before" when it starts before.
      const end = isDateValue(v) && v.end ? (dayKey(v.end) ?? start) : start
      if (op === 'equals') return q >= start && q <= end
      if (op === 'gt') return end > q
      if (op === 'lt') return start < q
      return true
    }
    case 'relation': {
      const have = Array.isArray(v) ? v : []
      const want = fv as string[]
      if (op === 'contains') return want.every((id) => have.includes(id))
      if (op === 'not_contains') return !want.some((id) => have.includes(id))
      return true
    }
  }
  return true
}

function activeFilters(schema: Schema, filters: unknown): { filter: ViewFilter; prop: PropertySchema }[] {
  const out: { filter: ViewFilter; prop: PropertySchema }[] = []
  for (const filter of Array.isArray(filters) ? (filters as ViewFilter[]) : []) {
    const prop = propOf(schema, filter?.propertyId)
    if (prop) out.push({ filter, prop })
  }
  return out
}

/** AND of all rules. Rules pointing at a missing property are ignored. */
export function applyFilters(rows: Block[], schema: Schema, filters: ViewFilter[] | undefined, ctx?: CellContext): Block[] {
  const active = activeFilters(schema, filters)
  if (!active.length) return rows
  return rows.filter((row) => active.every(({ filter, prop }) => matchesFilter(row, prop, filter, ctx)))
}

/**
 * Client-side quick search: the row title, and the stored text of `props` (the ones the
 * view shows) — text, URLs, numbers as typed, and the names of select options.
 */
export function applySearch(rows: Block[], query: string, props: readonly PropertySchema[] = []): Block[] {
  const q = typeof query === 'string' ? query.trim().toLocaleLowerCase() : ''
  if (!q) return rows
  const searched = props.filter((prop) => SEARCHED_TYPES.has(prop.type))
  return rows.filter((r) => titleOf(r).toLocaleLowerCase().includes(q) || searched.some((prop) => cellHas(r, prop, q)))
}

const SEARCHED_TYPES: ReadonlySet<PropertyType> = new Set(['text', 'url', 'number', 'select', 'multi_select'])

function cellHas(row: Block, prop: PropertySchema, q: string): boolean {
  const v = getCellValue(row, prop)
  const has = (text: string | undefined): boolean => !!text && text.toLocaleLowerCase().includes(q)
  if (typeof v === 'string') return prop.type === 'select' ? has(findOption(prop, v)?.name) : has(v)
  if (typeof v === 'number') return has(String(v))
  if (Array.isArray(v)) return v.some((id) => has(findOption(prop, id)?.name))
  return false
}

/**
 * Values a new row should get so that it is visible under the given filters
 * (only for rules that have an unambiguous satisfying value).
 */
export function defaultsFromFilters(schema: Schema, filters: ViewFilter[] | undefined): { title?: string; values: Values } {
  const out: { title?: string; values: Values } = { values: {} }
  for (const { filter: f, prop } of activeFilters(schema, filters)) {
    if (!operatorsOf(prop, schema).includes(f.operator)) continue
    if (prop.type === 'checkbox') {
      if (f.operator === 'checked') out.values[prop.id] = true
      else if (f.operator === 'unchecked') delete out.values[prop.id]
      continue
    }
    if (f.operator === 'date_is') {
      // A row added under "Due is within this week" is due today: the first day that is in it, from today on.
      const day = prop.type === 'date' ? firstDayFrom(relativeSpan(f.value, todayISO()), todayISO()) : null
      if (day) out.values[prop.id] = { start: day }
      continue
    }
    const fv = filterValueFor(prop, f.value, schema)
    if (fv === undefined) continue
    switch (prop.type) {
      case 'title':
        if (f.operator === 'equals' || f.operator === 'contains') out.title = String(fv)
        break
      case 'text':
      case 'url':
        if (f.operator === 'equals' || f.operator === 'contains') out.values[prop.id] = String(fv)
        break
      case 'number':
        if (f.operator === 'equals') out.values[prop.id] = fv
        break
      case 'select':
        if (f.operator === 'equals') out.values[prop.id] = fv
        break
      case 'multi_select': {
        if (f.operator !== 'contains') break
        const prev = out.values[prop.id]
        const merged = Array.isArray(prev) ? prev.slice() : []
        for (const id of fv as string[]) if (!merged.includes(id)) merged.push(id)
        out.values[prop.id] = merged
        break
      }
      case 'date':
        if (f.operator === 'equals') out.values[prop.id] = { start: fv as string }
        break
      case 'relation': {
        // A row added under "Project contains X" links to X.
        if (f.operator !== 'contains') break
        const prev = out.values[prop.id]
        const merged = Array.isArray(prev) ? prev.slice() : []
        for (const id of fv as string[]) if (!merged.includes(id)) merged.push(id)
        out.values[prop.id] = merged
        break
      }
    }
  }
  return out
}

/** Today when a span holds it, else the span's first day when that is still to come; null otherwise. */
function firstDayFrom(span: { from?: string; to?: string; whole?: boolean } | null, today: string): string | null {
  if (!span) return null
  if (inSpan(today, today, span)) return today
  return span.from !== undefined && span.from > today ? span.from : null
}

// ---------------------------------------------------------------------------
// Sorts
// ---------------------------------------------------------------------------

type SortKey = string | number | number[] | null

function sortKey(row: Block, prop: PropertySchema, ctx?: CellContext): SortKey {
  const type = filterTypeOf(prop, prop.type === 'formula' ? schemaFor(row, ctx) : undefined)
  // Relations sort by the titles of the rows they link to.
  if (type === 'relation') return ctx ? cellText(row, prop, ctx) || null : null
  const v = readCell(row, prop, ctx)
  switch (type) {
    case 'checkbox':
      return v === true ? 1 : 0
    case 'select': {
      if (typeof v !== 'string') return null
      const i = optionsOf(prop).findIndex((o) => o.id === v)
      return i < 0 ? null : i
    }
    case 'multi_select': {
      if (!Array.isArray(v) || !v.length) return null
      const options = optionsOf(prop)
      const idx = v.map((id) => options.findIndex((o) => o.id === id)).filter((i) => i >= 0)
      return idx.length ? idx : null
    }
    case 'date':
      // Time order: a day without a time first, then that day's times.
      return momentKey(v)
    case 'number':
    case 'created_time':
    case 'last_edited_time':
      return typeof v === 'number' && isFinite(v) ? v : null
    default:
      return typeof v === 'string' && v.trim() !== '' ? v : null
  }
}

let collator: Intl.Collator | undefined
function compareText(a: string, b: string): number {
  // One shared collator: `localeCompare` with options builds a new one per call.
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return collator.compare(a, b)
}

function compareKeys(a: Exclude<SortKey, null>, b: Exclude<SortKey, null>): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return a.length - b.length
  }
  return compareText(String(a), String(b))
}

/**
 * Stable multi-key sort: ties keep the incoming (manual) order. Empty values
 * always go last, whatever the direction.
 */
export function applySorts(rows: Block[], schema: Schema, sorts: ViewSort[] | undefined, ctx?: CellContext): Block[] {
  const active: { prop: PropertySchema; desc: boolean }[] = []
  for (const sort of Array.isArray(sorts) ? sorts : []) {
    const prop = propOf(schema, sort?.propertyId)
    if (prop) active.push({ prop, desc: sort.direction === 'desc' })
  }
  if (!active.length) return rows
  const decorated = rows.map((row, index) => ({ row, index, keys: active.map((s) => sortKey(row, s.prop, ctx)) }))
  decorated.sort((x, y) => {
    for (let i = 0; i < active.length; i++) {
      const a = x.keys[i]
      const b = y.keys[i]
      if (a === null && b === null) continue
      if (a === null) return 1
      if (b === null) return -1
      const c = compareKeys(a, b)
      if (c !== 0) return active[i].desc ? -c : c
    }
    return x.index - y.index
  })
  return decorated.map((d) => d.row)
}

/**
 * Filters, quick search and sorts of a view, in that order. `ctx` gives relations and
 * rollups the related rows; without it they filter and sort as if those were not loaded.
 */
export function queryRows(rows: Block[], schema: Schema, view: DatabaseView | undefined, search = '', ctx?: CellContext): Block[] {
  const filtered = applySearch(applyFilters(rows, schema, view?.filters, ctx), search, search ? visibleProps(view, schema) : [])
  return applySorts(filtered, schema, view?.sorts, ctx)
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface RowGroup {
  /** Option id (select), value key (other types) or null for the "no value" group. */
  key: string | null
  label: string
  option?: SelectOption
  rows: Block[]
}

/**
 * Groups rows by a property. For select/multi_select there is one group per
 * option (in option order, empty groups included); the "no value" group comes first.
 */
export function groupRows(rows: Block[], property: PropertySchema | undefined, ctx?: CellContext): RowGroup[] {
  const none: RowGroup = { key: null, label: property ? `No ${property.name}` : 'No group', rows: [] }
  if (!property) {
    none.rows = rows.slice()
    return [none]
  }
  if (property.type === 'select' || property.type === 'multi_select') {
    const groups = optionsOf(property).map<RowGroup>((o) => ({ key: o.id, label: o.name, option: o, rows: [] }))
    const byId = new Map(groups.map((g) => [g.key as string, g]))
    for (const row of rows) {
      const v = readCell(row, property, ctx)
      const ids = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
      let placed = false
      for (const id of ids) {
        const g = byId.get(id)
        if (g) {
          g.rows.push(row)
          placed = true
        }
      }
      if (!placed) none.rows.push(row)
    }
    return [none, ...groups]
  }
  const order: RowGroup[] = []
  const byKey = new Map<string, RowGroup>()
  const isDateLike = isDateLikeType(property.type)
  for (const row of rows) {
    const v = readCell(row, property, ctx)
    const key = property.type === 'checkbox' ? String(v === true) : isDateLike ? dayKey(v) : isEmptyValue(v) ? null : String(v)
    if (key === null) {
      none.rows.push(row)
      continue
    }
    let g = byKey.get(key)
    if (!g) {
      const label =
        property.type === 'checkbox' ? (v === true ? 'Checked' : 'Unchecked') : isDateLike ? formatDay(key) : formatValue(v, property)
      g = { key, label, rows: [] }
      byKey.set(key, g)
      order.push(g)
    }
    g.rows.push(row)
  }
  return [none, ...order]
}

/** Rows keyed by each calendar day they cover (start..end inclusive). */
export function rowsByDay(rows: Block[], property: PropertySchema | undefined): Map<string, Block[]> {
  const out = new Map<string, Block[]>()
  if (!property) return out
  for (const row of rows) {
    const v = readCell(row, property)
    const start = dayKey(v)
    if (!start) continue
    let end = isDateValue(v) && v.end ? (dayKey(v.end) ?? start) : start
    if (end < start) end = start
    let day = start
    // Guard against absurd ranges.
    for (let i = 0; i < MAX_RANGE_DAYS && day <= end; i++) {
      const list = out.get(day)
      if (list) list.push(row)
      else out.set(day, [row])
      const next = addDays(day, 1)
      if (next === day) break
      day = next
    }
  }
  return out
}
