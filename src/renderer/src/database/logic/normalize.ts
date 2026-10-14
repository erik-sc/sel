// The single normalisation layer between persisted database JSON and the UI.
//
// `props.schema` / `props.views` may be missing, malformed, written by an older
// version or half-written by another window. Everything downstream (views, cells,
// actions) only ever sees the output of `normalizeDatabase`, which guarantees:
//   - schema: own, prototype-safe keys; `prop.id === key`; a known type; a bounded
//     string name; exactly one title; `options` an array of well-formed, uniquely
//     identified options on select types (absent elsewhere); a valid numberFormat;
//     a well-formed `relation` on relations that point somewhere and a `rollup` on
//     every rollup (absent elsewhere). Where those point is checked when they are read.
//   - views: at least one; unique string ids; a known type; only references to
//     existing properties; operators valid for the property type; filter values of
//     the right shape that never point at a deleted option; unique sorts with a
//     valid direction; finite clamped widths; a groupBy of the type the layout needs;
//     on a chart view, a chart configuration whose every reference fits the schema;
//     on a calculations view, a list of well-formed calculations.
// Valid data comes back by reference (`changed: false`), so memoisation holds.
import type { Block, BlockProps, DatabaseView, PropertySchema, PropertyType, SelectOption, ViewFilter, ViewSort, ViewType } from '../../../../shared/types'
import { sanitizeChartConfig } from '../../../../shared/chart'
import { defaultCalcs, sanitizeCalcs } from './calcConfig'
import { sanitizeRelationConfig } from '../../../../shared/relation'
import { normalizeChartConfig } from './chartConfig'
import { filterValueFor, operatorNeedsValue, operatorsOf } from './query'
import { sanitizeRollupConfig } from './rollup'
import {
  DEFAULT_TITLE_ID,
  DEFAULT_VIEW_ID,
  MAX_NAME_LENGTH,
  TYPE_LABELS,
  VIEW_LABELS,
  VIEW_TYPES,
  getTitleProperty,
  isPlainObject,
  isSafeKey,
  isSelectType,
  makeId,
  propOf,
  sameValue,
  type Schema
} from './values'
import { clampWidth, createDefaultView, firstPropertyOfType, groupTypeOf } from './views'

const NUMBER_FORMATS: readonly unknown[] = ['number', 'percent', 'currency']

function isPropertyType(t: unknown): t is PropertyType {
  return typeof t === 'string' && Object.hasOwn(TYPE_LABELS, t)
}

function isViewType(t: unknown): t is ViewType {
  return typeof t === 'string' && (VIEW_TYPES as string[]).includes(t)
}

function boundedName(name: unknown, fallback: string): string {
  if (typeof name !== 'string' || name.trim() === '') return fallback
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH) : name
}

function normalizeOptions(raw: unknown): SelectOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  let clean = true
  const out: SelectOption[] = []
  for (const item of raw as unknown[]) {
    if (!isPlainObject(item) || !isSafeKey(item.id) || seen.has(item.id)) {
      clean = false
      continue
    }
    seen.add(item.id)
    const name = boundedName(item.name, 'Untitled')
    const color = typeof item.color === 'string' ? item.color : 'gray'
    if (name === item.name && color === item.color) out.push(item as unknown as SelectOption)
    else {
      clean = false
      out.push({ ...item, id: item.id, name, color })
    }
  }
  return clean ? (raw as SelectOption[]) : out
}

/** One property, repaired. Returns the input object itself when it needs no change. */
function normalizeProperty(id: string, raw: unknown): PropertySchema | undefined {
  if (!isPlainObject(raw) || !isPropertyType(raw.type)) return undefined
  const type = raw.type
  const name = boundedName(raw.name, TYPE_LABELS[type])
  const options = isSelectType(type) ? normalizeOptions(raw.options) : undefined
  const validFormat = raw.numberFormat === undefined || NUMBER_FORMATS.includes(raw.numberFormat)
  // A relation that points nowhere yet has no `relation`; a rollup always has a (repaired) `rollup`.
  const relation = type === 'relation' ? sanitizeRelationConfig(raw.relation) : undefined
  const rollup = type === 'rollup' ? sanitizeRollupConfig(raw.rollup) : undefined
  if (
    raw.id === id &&
    raw.name === name &&
    raw.options === options &&
    validFormat &&
    raw.relation === relation &&
    raw.rollup === rollup
  ) {
    return raw as unknown as PropertySchema
  }
  const fixed = { ...raw, id, name, type } as PropertySchema
  if (options) fixed.options = options
  else delete fixed.options
  if (!validFormat) delete fixed.numberFormat
  if (relation) fixed.relation = relation
  else delete fixed.relation
  if (rollup) fixed.rollup = rollup
  else delete fixed.rollup
  return fixed
}

function normalizeSchema(raw: unknown): { schema: Schema; changed: boolean } {
  let schema: Schema = {}
  let changed = !isPlainObject(raw)
  let hasTitle = false
  if (isPlainObject(raw)) {
    for (const id of Object.keys(raw)) {
      let prop = isSafeKey(id) ? normalizeProperty(id, raw[id]) : undefined
      if (!prop) {
        changed = true
        continue
      }
      if (prop.type === 'title') {
        // A database has exactly one title: later ones become plain text.
        if (hasTitle) prop = { ...prop, type: 'text' }
        hasTitle = true
      }
      if (prop !== raw[id]) changed = true
      schema[id] = prop
    }
  }
  if (!hasTitle) {
    const id = Object.hasOwn(schema, DEFAULT_TITLE_ID) ? makeId() : DEFAULT_TITLE_ID
    schema = { [id]: { id, name: 'Name', type: 'title' }, ...schema }
    changed = true
  }
  return changed ? { schema, changed } : { schema: raw as Schema, changed }
}

function normalizeFilters(raw: unknown, schema: Schema): ViewFilter[] {
  const out: ViewFilter[] = []
  for (const f of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (!isPlainObject(f)) continue
    const prop = propOf(schema, f.propertyId)
    const operator = f.operator as ViewFilter['operator']
    if (!prop || !operatorsOf(prop).includes(operator)) continue
    const filter: ViewFilter = { propertyId: prop.id, operator }
    if (operatorNeedsValue(operator)) {
      const value = filterValueFor(prop, f.value)
      // Keep the stored shape (e.g. a single option id) when it is already fine.
      if (value !== undefined) filter.value = sameValue(value, f.value) || sameValue([f.value], value) ? (f.value as ViewFilter['value']) : value
    }
    out.push(filter)
  }
  return out
}

function normalizeSorts(raw: unknown, schema: Schema): ViewSort[] {
  const out: ViewSort[] = []
  const seen = new Set<string>()
  for (const s of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (!isPlainObject(s)) continue
    const prop = propOf(schema, s.propertyId)
    if (!prop || seen.has(prop.id)) continue
    seen.add(prop.id)
    out.push({ propertyId: prop.id, direction: s.direction === 'desc' ? 'desc' : 'asc' })
  }
  return out
}

/**
 * Drops references to missing properties, invalid filter operators / values and
 * wrong-typed groupBy; guarantees unique ids and a visible title. Keeps object
 * identity of views that need no change. Entries that are not objects are dropped.
 */
export function sanitizeViews(views: DatabaseView[], schema: Schema): DatabaseView[] {
  const title = getTitleProperty(schema)
  const usedIds = new Set<string>()
  const out: DatabaseView[] = []
  ;(Array.isArray(views) ? (views as unknown[]) : []).forEach((item, index) => {
    if (!isPlainObject(item)) return
    const raw = item as unknown as Partial<DatabaseView>
    const type: ViewType = isViewType(raw.type) ? raw.type : 'table'
    let id = isSafeKey(raw.id) && !usedIds.has(raw.id) ? raw.id : `${DEFAULT_VIEW_ID}-${index}`
    // Deterministic (so that concurrent repairs converge) and unique.
    for (let n = 1; usedIds.has(id); n++) id = `${DEFAULT_VIEW_ID}-${index}-${n}`
    usedIds.add(id)

    const v: DatabaseView = {
      ...(raw as DatabaseView),
      id,
      name: boundedName(raw.name, VIEW_LABELS[type]),
      type,
      visibleProperties: [],
      filters: normalizeFilters(raw.filters, schema),
      sorts: normalizeSorts(raw.sorts, schema)
    }
    const seen = new Set<string>()
    for (const propertyId of Array.isArray(raw.visibleProperties) ? (raw.visibleProperties as unknown[]) : []) {
      const prop = propOf(schema, propertyId)
      if (prop && !seen.has(prop.id)) {
        seen.add(prop.id)
        v.visibleProperties.push(prop.id)
      }
    }
    if (title && !seen.has(title.id)) v.visibleProperties.unshift(title.id)

    // Keys are assigned in place (never deleted and re-added) so that a clean view
    // serialises exactly like its source and keeps its identity.
    if (isPlainObject(raw.propertyWidths)) {
      const widths: Record<string, number> = {}
      for (const propertyId of Object.keys(raw.propertyWidths)) {
        const w: unknown = raw.propertyWidths[propertyId]
        if (propOf(schema, propertyId) && typeof w === 'number' && isFinite(w)) widths[propertyId] = clampWidth(w)
      }
      v.propertyWidths = widths
    } else {
      delete v.propertyWidths
    }

    const group = propOf(schema, raw.groupBy)
    const groupType = groupTypeOf(type)
    const chosen = groupType ? (group?.type === groupType ? group : firstPropertyOfType(schema, groupType)) : group
    if (chosen) v.groupBy = chosen.id
    else delete v.groupBy

    // A chart view always has a configuration that fits the schema. A view of another
    // type keeps a well-formed one untouched: it is what the view would draw again
    // (and what a build that does not know charts leaves behind when it shows one as a table).
    const rawChart: unknown = (raw as { chart?: unknown }).chart
    if (type === 'chart') v.chart = normalizeChartConfig(rawChart, schema)
    else if (rawChart !== undefined) {
      const kept = sanitizeChartConfig(rawChart)
      if (kept) v.chart = sameValue(kept, rawChart) ? (rawChart as DatabaseView['chart']) : kept
      else delete v.chart
    }

    // A calculations view always has its list of figures; one it has (even an empty one) is
    // the user's own and is only cleaned. A view of another type keeps a well-formed list, for
    // when it is shown as calculations again, and drops anything else.
    const rawCalcs: unknown = (raw as { calcs?: unknown }).calcs
    const calcs = sanitizeCalcs(rawCalcs)
    if (calcs) v.calcs = sameValue(calcs, rawCalcs) ? (rawCalcs as DatabaseView['calcs']) : calcs
    else if (type === 'calc') v.calcs = defaultCalcs(schema)
    else delete v.calcs
    out.push(sameValue(v, raw) ? (raw as DatabaseView) : v)
  })
  return out
}

export interface NormalizedDatabase {
  schema: Schema
  views: DatabaseView[]
  /** True when the stored data had to be repaired (and should be written back once). */
  changed: boolean
}

/**
 * Normalises a database block's props. Missing or legacy data gets a title
 * property "Name" and one table view (with deterministic ids, so that
 * concurrent lazy initialisations converge).
 */
export function ensureDatabaseProps(props: BlockProps | undefined | null): NormalizedDatabase {
  const source: Record<string, unknown> = isPlainObject(props) ? props : {}
  const { schema, changed: schemaChanged } = normalizeSchema(source.schema)

  const rawViews: unknown = source.views
  let views = sanitizeViews(Array.isArray(rawViews) ? (rawViews as DatabaseView[]) : [], schema)
  if (!views.length) views = [createDefaultView('table', schema, DEFAULT_VIEW_ID)]
  const viewsChanged =
    !Array.isArray(rawViews) || rawViews.length !== views.length || views.some((v, i) => v !== rawViews[i])
  if (!viewsChanged) views = rawViews as DatabaseView[]
  return { schema, views, changed: schemaChanged || viewsChanged }
}

/** Last result per `schema` object: store props are immutable, so identity is a valid cache key. */
const cache = new WeakMap<object, { views: unknown; result: NormalizedDatabase }>()

/**
 * The normalised schema and views of a database block. This is the only way the
 * UI and the actions read `props.schema` / `props.views`. Results are cached by
 * identity, so every caller sees the same objects for the same stored data.
 */
export function normalizeDatabase(block: Block | undefined | null): NormalizedDatabase {
  const props: unknown = block?.props
  const rawSchema: unknown = isPlainObject(props) ? props.schema : undefined
  const rawViews: unknown = isPlainObject(props) ? props.views : undefined
  if (isPlainObject(rawSchema)) {
    const hit = cache.get(rawSchema)
    if (hit && hit.views === rawViews) return hit.result
  }
  const result = ensureDatabaseProps({ schema: rawSchema, views: rawViews } as BlockProps)
  if (isPlainObject(rawSchema)) cache.set(rawSchema, { views: rawViews, result })
  return result
}
