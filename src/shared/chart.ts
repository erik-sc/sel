import type { ChartAggregate, ChartConfig, ChartDateBucket, ChartKind, ChartPalette, ChartSort } from './types'

/**
 * The shape of a chart view's configuration, checked the same way by the main process
 * (before anything is stored), the renderer's normalisation layer and the clipboard.
 * Only shapes are decided here: whether a property id exists in a schema, and whether it
 * has the right type for its role, is decided where the schema is known
 * (`normalizeChartConfig` in the renderer's database logic).
 */

export const CHART_KINDS: readonly ChartKind[] = ['column', 'bar', 'line', 'area', 'pie', 'donut', 'number']
export const CHART_DATE_BUCKETS: readonly ChartDateBucket[] = ['day', 'week', 'month', 'quarter', 'year']
export const CHART_AGGREGATES: readonly ChartAggregate[] = [
  'count',
  'count_unique',
  'sum',
  'average',
  'min',
  'max',
  'median',
  'percent_checked'
]
export const CHART_SORTS: readonly ChartSort[] = ['manual', 'x_asc', 'x_desc', 'y_desc', 'y_asc']
export const CHART_PALETTES: readonly ChartPalette[] = ['accent', 'colourful', 'options']

export const CHART_MIN_HEIGHT = 120
export const CHART_MAX_HEIGHT = 960
export const CHART_MIN_LIMIT = 1
export const CHART_MAX_LIMIT = 50

/** What a chart view shows before anything was chosen. */
export const DEFAULT_CHART_CONFIG: ChartConfig = { kind: 'column', y: { aggregate: 'count' } }

const MAX_ID_LENGTH = 200
const BOOLEAN_KEYS = ['stacked', 'showEmpty', 'showValues', 'showLegend', 'showGrid', 'cumulative'] as const

function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A string that may be used as a property id: non-empty, bounded, never a member of Object.prototype. */
function isPropertyId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_ID_LENGTH && !(value in Object.prototype)
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(Math.max(min, Math.min(max, value)))
}

/**
 * A chart configuration rebuilt field by field from untrusted JSON: known keys only,
 * known enum members only, numbers clamped. Undefined when the value is not a
 * configuration at all (not an object, or without a known `kind`).
 */
export function sanitizeChartConfig(raw: unknown): ChartConfig | undefined {
  if (!isPlain(raw) || !oneOf(CHART_KINDS, raw.kind)) return undefined
  const y: ChartConfig['y'] = { aggregate: 'count' }
  if (isPlain(raw.y)) {
    if (oneOf(CHART_AGGREGATES, raw.y.aggregate)) y.aggregate = raw.y.aggregate
    if (isPropertyId(raw.y.property)) y.property = raw.y.property
  }
  // Keys are added in one fixed order, so equal configurations serialise equally.
  const out = { kind: raw.kind } as ChartConfig
  if (isPropertyId(raw.x)) out.x = raw.x
  if (oneOf(CHART_DATE_BUCKETS, raw.xDateBucket)) out.xDateBucket = raw.xDateBucket
  out.y = y
  if (isPropertyId(raw.series)) out.series = raw.series
  if (oneOf(CHART_SORTS, raw.sort)) out.sort = raw.sort
  const limit = clampInt(raw.limit, CHART_MIN_LIMIT, CHART_MAX_LIMIT)
  if (limit !== undefined) out.limit = limit
  for (const key of BOOLEAN_KEYS) {
    const flag = raw[key]
    if (typeof flag === 'boolean') out[key] = flag
  }
  if (oneOf(CHART_PALETTES, raw.palette)) out.palette = raw.palette
  const height = clampInt(raw.height, CHART_MIN_HEIGHT, CHART_MAX_HEIGHT)
  if (height !== undefined) out.height = height
  return out
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The `views` of a database block with every chart configuration in its checked shape:
 * a chart view always has one (the default when what was sent is unusable), and a view
 * of another type keeps a well-formed one (so that nothing is lost while a view is
 * shown as something else) and loses a malformed one. Everything else about a view is
 * left alone. Returns its input when there is nothing to change.
 */
export function sanitizeViewCharts(views: unknown): unknown {
  if (!Array.isArray(views)) return views
  let changed = false
  const out = views.map((view: unknown) => {
    if (!isPlain(view)) return view
    const isChart = view.type === 'chart'
    if (!isChart && !Object.hasOwn(view, 'chart')) return view
    const clean = sanitizeChartConfig(view.chart) ?? (isChart ? { ...DEFAULT_CHART_CONFIG, y: { ...DEFAULT_CHART_CONFIG.y } } : undefined)
    if (clean !== undefined && same(clean, view.chart)) return view
    changed = true
    const next: Record<string, unknown> = { ...view }
    if (clean === undefined) delete next.chart
    else next.chart = clean
    return next
  })
  return changed ? out : views
}
