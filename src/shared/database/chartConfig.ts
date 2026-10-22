// Chart views: their configuration (what a chart view stores) and its repair against a
// schema. Part of the normalisation layer, so it ships with the database itself; the
// aggregation engine (./chart.ts) is only loaded with the chart view.
import type { ChartAggregate, ChartConfig, ChartDateBucket, ChartKind, DatabaseView, PropertySchema } from '../types'
import { DEFAULT_CHART_CONFIG, sanitizeChartConfig } from '../chart'
import { filterTypeOf } from './cell'
import { getTitleProperty, isDateLikeType, orderedProperties, propOf, type Schema } from './values'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  column: 'Column',
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  donut: 'Donut',
  number: 'Number'
}

export const CHART_AGGREGATE_LABELS: Record<ChartAggregate, string> = {
  count: 'Count of rows',
  count_unique: 'Count of unique values',
  sum: 'Sum',
  average: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  median: 'Median',
  percent_checked: 'Percent checked'
}

export const CHART_BUCKET_LABELS: Record<ChartDateBucket, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year'
}

export function isChartKindWithAxes(kind: ChartKind): boolean {
  return kind === 'bar' || kind === 'column' || kind === 'line' || kind === 'area'
}

/** Kinds that can show a second grouping (series). */
export function chartKindHasSeries(kind: ChartKind): boolean {
  return isChartKindWithAxes(kind)
}

export function chartKindCanStack(kind: ChartKind): boolean {
  return kind === 'bar' || kind === 'column' || kind === 'area'
}

export function chartKindCanAccumulate(kind: ChartKind): boolean {
  return kind === 'line' || kind === 'area'
}

export function aggregateNeedsProperty(aggregate: ChartAggregate): boolean {
  return aggregate !== 'count'
}

/**
 * Whether a chart can group by a property. Relations, rollups and formulas cannot: their
 * values are computed from other databases or properties, which a chart (and its Markdown
 * export) does not read.
 */
/**
 * Any property can be an axis or a split: a relation by the rows it links to, a rollup or
 * a formula by what it gives (see ./chart.ts).
 */
export function isChartAxisProperty(prop: PropertySchema | undefined): prop is PropertySchema {
  return !!prop
}

/** The properties a chart can group by, in schema order. */
export function chartAxisProperties(schema: Schema): PropertySchema[] {
  return orderedProperties(schema).filter(isChartAxisProperty)
}

/**
 * Whether a property can be the value of an aggregate. A rollup or a formula counts as
 * what it gives; a formula's result type depends on `schema` (without it, text).
 */
export function isChartValueProperty(prop: PropertySchema | undefined, aggregate: ChartAggregate, schema?: Schema): boolean {
  if (!isChartAxisProperty(prop)) return false
  const type = filterTypeOf(prop, schema)
  switch (aggregate) {
    case 'count':
      return false
    case 'count_unique':
      return true
    case 'percent_checked':
      return type === 'checkbox'
    default:
      return type === 'number' || type === 'checkbox'
  }
}

/** The properties offered as the value of an aggregate, in schema order. */
export function chartValueProperties(schema: Schema, aggregate: ChartAggregate): PropertySchema[] {
  return orderedProperties(schema).filter((prop) => isChartValueProperty(prop, aggregate, schema))
}

function firstOfType(schema: Schema, test: (prop: PropertySchema) => boolean): PropertySchema | undefined {
  return orderedProperties(schema).find(test)
}

/**
 * What a new chart view shows: rows counted by the first select property, else by
 * the first date property per month, else by title; as columns.
 */
export function defaultChartConfig(schema: Schema): ChartConfig {
  const config = { kind: DEFAULT_CHART_CONFIG.kind } as ChartConfig
  const select = firstOfType(schema, (prop) => prop.type === 'select')
  const date = select ? undefined : firstOfType(schema, (prop) => prop.type === 'date')
  const x = select ?? date ?? getTitleProperty(schema)
  if (x) config.x = x.id
  if (x && isDateLikeType(x.type)) config.xDateBucket = 'month'
  config.y = { aggregate: 'count' }
  return config
}

/**
 * A chart configuration that can be drawn against `schema`: the checked shape of
 * `raw` (see shared/chart.ts) with every reference repaired. A missing or dangling
 * axis falls back to the default one, a value property of the wrong type to the first
 * usable one (or to a plain count when there is none), a series that is gone or that
 * repeats the axis is dropped, and a date bucket only exists on a date axis.
 * Returns `raw` itself when it needs no change, so memoisation holds.
 */
export function normalizeChartConfig(raw: unknown, schema: Schema): ChartConfig {
  const clean = sanitizeChartConfig(raw)
  const fallback = defaultChartConfig(schema)
  if (!clean) return fallback

  const out = { kind: clean.kind } as ChartConfig
  const asked = propOf(schema, clean.x)
  const x = (isChartAxisProperty(asked) ? asked : undefined) ?? (clean.kind === 'number' ? undefined : propOf(schema, fallback.x))
  if (x) {
    out.x = x.id
    if (isDateLikeType(x.type)) out.xDateBucket = clean.xDateBucket ?? 'month'
  }

  let aggregate = clean.y.aggregate
  let valueProp = aggregateNeedsProperty(aggregate) ? propOf(schema, clean.y.property) : undefined
  if (aggregateNeedsProperty(aggregate) && !isChartValueProperty(valueProp, aggregate, schema)) {
    valueProp = aggregate === 'count_unique' ? getTitleProperty(schema) : chartValueProperties(schema, aggregate)[0]
    if (!valueProp) aggregate = 'count'
  }
  out.y = valueProp ? { aggregate, property: valueProp.id } : { aggregate }

  const series = propOf(schema, clean.series)
  if (isChartAxisProperty(series) && series.id !== x?.id) out.series = series.id

  if (clean.sort !== undefined) out.sort = clean.sort
  if (clean.limit !== undefined) out.limit = clean.limit
  if (clean.stacked !== undefined) out.stacked = clean.stacked
  if (clean.showEmpty !== undefined) out.showEmpty = clean.showEmpty
  if (clean.showValues !== undefined) out.showValues = clean.showValues
  if (clean.showLegend !== undefined) out.showLegend = clean.showLegend
  if (clean.showGrid !== undefined) out.showGrid = clean.showGrid
  if (clean.cumulative !== undefined) out.cumulative = clean.cumulative
  if (clean.palette !== undefined) out.palette = clean.palette
  if (clean.height !== undefined) out.height = clean.height
  return canonical(out, raw)
}

/** `config` in the key order every writer uses, or `raw` itself when that is what it already is. */
function canonical(config: ChartConfig, raw: unknown): ChartConfig {
  const ordered = sanitizeChartConfig(config) ?? config
  try {
    return JSON.stringify(ordered) === JSON.stringify(raw) ? (raw as ChartConfig) : ordered
  } catch {
    return ordered
  }
}

/** The configuration a view is drawn with, whatever is (or is not) stored on it. */
export function chartConfigOf(view: Pick<DatabaseView, 'chart'> | undefined | null, schema: Schema): ChartConfig {
  return normalizeChartConfig(view?.chart, schema)
}
