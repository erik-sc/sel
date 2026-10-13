// Charts: turning the rows of a view into categories, series and numbers.
//
// A chart is a view type, so it is given rows that already went through the view's
// filters and the quick search (`queryRows`). Everything here is pure: the renderer
// draws the result, the markdown export writes it as a table, and both agree.
//
// Dates are civil days (`YYYY-MM-DD`) bucketed with the helpers of ./dates, so no
// bucket ever depends on the machine's timezone or on a DST transition. Only the
// computed "created" / "last edited" timestamps are mapped to the local day they fell on.
import type { Block, ChartAggregate, ChartConfig, ChartDateBucket, ChartKind, PropertySchema } from '../../../../shared/types'
import { CHART_KIND_LABELS, chartKindCanAccumulate, chartKindHasSeries, normalizeChartConfig } from './chartConfig'
import { binEdge, binIndex, niceBins, type Bins } from './chartScale'
import { bucketLabel, bucketStart, dayKey, diffDays, nextBucketStart, todayISO, type FormatOptions } from './dates'
import {
  OPTION_COLORS,
  defaultCurrency,
  formatNumber,
  getCellValue,
  isDateLikeType,
  isSelectType,
  optionsOf,
  propOf,
  type Schema
} from './values'

// ---------------------------------------------------------------------------
// Colours and limits
// ---------------------------------------------------------------------------

/**
 * Series and category colours, as names of the `--c-<name>` tokens. The order is fixed
 * and chosen so that neighbours stay apart for red-green colour-blind readers as far as
 * the nine tag colours allow (blue next to orange, never red next to green or orange).
 * Gray is kept for "Other" and "No value".
 */
export const CHART_COLOURS = ['blue', 'orange', 'pink', 'yellow', 'brown', 'purple', 'green', 'red'] as const
export const CHART_NEUTRAL_COLOUR = 'gray'
/** The colour of a single series under the `accent` palette (the `--accent` token). */
export const CHART_ACCENT_COLOUR = 'accent'

/** More series than colours never get a generated hue: the smallest fold into "Other". */
export const MAX_CHART_SERIES = CHART_COLOURS.length
/** Categories drawn when no limit is set; the rest fold into "Other". */
export const DEFAULT_CATEGORY_LIMIT = 50
/** A pie with more slices than colours cannot be read. */
export const MAX_PIE_SLICES = CHART_COLOURS.length
/** Buckets of a continuous date axis; a longer span is drawn with a coarser bucket. */
export const MAX_DATE_BUCKETS = 400
/** Distinct numbers above which a numeric axis is binned. */
export const MAX_DISTINCT_NUMBERS = 12
export const MAX_NUMBER_BINS = 10

const MAX_LABEL_LENGTH = 120

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ChartCategory {
  key: string
  label: string
  /** Name of a `--c-<name>` token (or `accent`); absent when the series colour applies. */
  colour?: string
  /** `empty`: rows without a value; `other`: what the limit folded away. */
  kind?: 'empty' | 'other'
  /** Date axes: the bucket today falls in. */
  current?: boolean
}

export interface ChartSeries {
  key: string
  label: string
  colour?: string
  kind?: 'empty' | 'other'
  /** One value per category; null where there is nothing to aggregate. */
  values: (number | null)[]
}

export interface ChartYFormat {
  numberFormat: NonNullable<PropertySchema['numberFormat']>
  /** Counts: ticks and labels never show fractions. */
  integer: boolean
}

export type ChartStatus = 'ok' | 'no_rows' | 'no_x'

export interface ChartData {
  status: ChartStatus
  kind: ChartKind
  categories: ChartCategory[]
  series: ChartSeries[]
  /** The aggregate over every row that is part of the chart (each row once). */
  total: number | null
  yFormat: ChartYFormat
  /** Rows that are part of the chart (rows without a value are not, unless the empty group is shown). */
  rowCount: number
  /** Count and sum: parts add up to a whole, so shares and stacks mean something. */
  additive: boolean
  /** True when the series are a split by a second property (false: one series of values). */
  split: boolean
  xLabel: string
  yLabel: string
  seriesLabel?: string
  /** The bucket a date axis was drawn with (coarser than asked for when the span is long). */
  bucket?: ChartDateBucket
  /** line / area: the values are running totals along the axis. */
  cumulative?: boolean
}

export const CHART_EMPTY_KEY = '__empty'
export const CHART_OTHER_KEY = '__other'
export const CHART_ALL_KEY = '__all'
const SINGLE_SERIES_KEY = '__value'

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

interface Group {
  key: string
  label: string
  /** Position in the manual order: option order, chronological, ascending, or first seen. */
  order: number
  /** The option's own colour (select types). */
  optionColour?: string
  sortNumber?: number
  current?: boolean
}

interface Grouper {
  prop: PropertySchema
  /** Keys of the groups a row belongs to; empty when it has no value. */
  keysOf(row: Block): string[]
  /** Every group in manual order (for text: those seen so far). */
  groups(): Group[]
  /** Date and binned-number axes: every bucket between the ends exists, and none is folded away. */
  continuous: boolean
  bucket?: ChartDateBucket
}

const BUCKET_DAYS: Record<ChartDateBucket, number> = { day: 1, week: 7, month: 30, quarter: 91, year: 365 }
const COARSER: Record<ChartDateBucket, ChartDateBucket | null> = {
  day: 'week',
  week: 'month',
  month: 'quarter',
  quarter: 'year',
  year: null
}

function cleanLabel(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > MAX_LABEL_LENGTH ? `${line.slice(0, MAX_LABEL_LENGTH - 1)}…` : line
}

function knownColour(colour: unknown): string {
  return typeof colour === 'string' && (OPTION_COLORS as readonly string[]).includes(colour) ? colour : CHART_NEUTRAL_COLOUR
}

function optionGrouper(prop: PropertySchema): Grouper {
  const list: Group[] = optionsOf(prop).map((option, order) => ({
    key: `o:${option.id}`,
    label: cleanLabel(option.name) || 'Untitled',
    order,
    optionColour: knownColour(option.color)
  }))
  return {
    prop,
    continuous: false,
    groups: () => list,
    keysOf(row) {
      // `getCellValue` only ever returns ids of options that exist.
      const value = getCellValue(row, prop)
      if (typeof value === 'string') return [`o:${value}`]
      return Array.isArray(value) ? value.map((id) => `o:${id}`) : []
    }
  }
}

function checkboxGrouper(prop: PropertySchema): Grouper {
  const list: Group[] = [
    { key: 'c:true', label: 'Checked', order: 0, sortNumber: 1 },
    { key: 'c:false', label: 'Unchecked', order: 1, sortNumber: 0 }
  ]
  return {
    prop,
    continuous: false,
    groups: () => list,
    keysOf: (row) => [getCellValue(row, prop) === true ? 'c:true' : 'c:false']
  }
}

function textGrouper(prop: PropertySchema): Grouper {
  const seen = new Map<string, Group>()
  const list: Group[] = []
  return {
    prop,
    continuous: false,
    groups: () => list,
    keysOf(row) {
      const value = getCellValue(row, prop)
      const text = typeof value === 'string' ? value.trim() : ''
      if (text === '') return []
      const key = `t:${text}`
      if (!seen.has(key)) {
        const group: Group = { key, label: cleanLabel(text), order: list.length }
        seen.set(key, group)
        list.push(group)
      }
      return [key]
    }
  }
}

function numberGrouper(prop: PropertySchema, rows: readonly Block[], opts: FormatOptions): Grouper {
  const distinct = new Set<number>()
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    const value = getCellValue(row, prop)
    if (typeof value !== 'number' || !isFinite(value)) continue
    if (distinct.size <= MAX_DISTINCT_NUMBERS) distinct.add(value)
    if (value < min) min = value
    if (value > max) max = value
  }
  const format = (n: number): string => formatNumber(n, prop.numberFormat, opts)

  if (distinct.size <= MAX_DISTINCT_NUMBERS) {
    const list: Group[] = [...distinct]
      .sort((a, b) => a - b)
      .map((value, order) => ({ key: `n:${value}`, label: format(value), order, sortNumber: value }))
    return {
      prop,
      continuous: false,
      groups: () => list,
      keysOf(row) {
        const value = getCellValue(row, prop)
        return typeof value === 'number' && isFinite(value) ? [`n:${value}`] : []
      }
    }
  }

  const bins: Bins = niceBins(min, max, MAX_NUMBER_BINS)
  const list: Group[] = []
  for (let i = 0; i < bins.count; i++) {
    const from = binEdge(i, bins)
    list.push({ key: `b:${i}`, label: `${format(from)} – ${format(binEdge(i + 1, bins))}`, order: i, sortNumber: from })
  }
  return {
    prop,
    continuous: true,
    groups: () => list,
    keysOf(row) {
      const value = getCellValue(row, prop)
      return typeof value === 'number' && isFinite(value) ? [`b:${binIndex(value, bins)}`] : []
    }
  }
}

function dateGrouper(
  prop: PropertySchema,
  rows: readonly Block[],
  asked: ChartDateBucket,
  today: string,
  opts: FormatOptions
): Grouper {
  let min: string | null = null
  let max: string | null = null
  for (const row of rows) {
    const day = dayKey(getCellValue(row, prop))
    if (!day) continue
    if (min === null || day < min) min = day
    if (max === null || day > max) max = day
  }

  // A span that would need more buckets than can be drawn is shown with a coarser one.
  let bucket = asked
  if (min !== null && max !== null) {
    const span = diffDays(min, max)
    while (span / BUCKET_DAYS[bucket] > MAX_DATE_BUCKETS && COARSER[bucket]) bucket = COARSER[bucket] as ChartDateBucket
  }

  const list: Group[] = []
  const known = new Set<string>()
  const add = (start: string): void => {
    known.add(start)
    list.push({ key: `d:${start}`, label: bucketLabel(start, bucket, opts), order: list.length, sortNumber: list.length })
  }
  if (min !== null && max !== null) {
    // Continuous axis: every bucket between the first and the last one, empty or not.
    const last = bucketStart(max, bucket) ?? max
    let cursor = bucketStart(min, bucket) ?? min
    for (let guard = 0; guard <= MAX_DATE_BUCKETS + 2; guard++) {
      add(cursor)
      if (cursor >= last) break
      const next = nextBucketStart(cursor, bucket)
      if (next === cursor) break
      cursor = next
    }
    // Longer than any drawable axis even by year: the last bucket still exists.
    if (!known.has(last)) add(last)
  }
  const current = bucketStart(today, bucket)
  for (const group of list) if (group.key === `d:${current}`) group.current = true

  return {
    prop,
    continuous: true,
    bucket,
    groups: () => list,
    keysOf(row) {
      const day = dayKey(getCellValue(row, prop))
      const start = day ? bucketStart(day, bucket) : null
      if (!start) return []
      // Only reachable past the guard above: such a row joins the nearest end.
      if (!known.has(start)) return list.length ? [list[start < list[0].key.slice(2) ? 0 : list.length - 1].key] : []
      return [`d:${start}`]
    }
  }
}

interface GrouperInput {
  rows: readonly Block[]
  bucket?: ChartDateBucket
  today: string
  opts: FormatOptions
}

function createGrouper(prop: PropertySchema, input: GrouperInput): Grouper {
  if (isSelectType(prop.type)) return optionGrouper(prop)
  if (prop.type === 'checkbox') return checkboxGrouper(prop)
  if (prop.type === 'number') return numberGrouper(prop, input.rows, input.opts)
  if (isDateLikeType(prop.type)) return dateGrouper(prop, input.rows, input.bucket ?? 'month', input.today, input.opts)
  return textGrouper(prop)
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Acc {
  rows: number
  /** Rows that had a usable number. */
  n: number
  sum: number
  min: number
  max: number
  checked: number
  values: number[] | null
  unique: Set<string> | null
}

function newAcc(aggregate: ChartAggregate): Acc {
  return {
    rows: 0,
    n: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    checked: 0,
    values: aggregate === 'median' ? [] : null,
    unique: aggregate === 'count_unique' ? new Set() : null
  }
}

/** What one row contributes, read once however many groups it falls in. */
interface Reading {
  number: number | null
  checked: boolean
  unique: string[]
}

const NO_UNIQUE: string[] = []

function reader(aggregate: ChartAggregate, prop: PropertySchema | undefined): (row: Block) => Reading {
  if (!prop || aggregate === 'count') {
    const nothing: Reading = { number: null, checked: false, unique: NO_UNIQUE }
    return () => nothing
  }
  if (aggregate === 'count_unique') {
    return (row) => {
      const value = getCellValue(row, prop)
      let unique: string[]
      if (value === null || value === undefined || value === '') unique = NO_UNIQUE
      else if (Array.isArray(value)) unique = value
      else if (typeof value === 'object') unique = [JSON.stringify(value)]
      else unique = [typeof value === 'string' ? value.trim() : String(value)]
      return { number: null, checked: false, unique: unique.length === 1 && unique[0] === '' ? NO_UNIQUE : unique }
    }
  }
  return (row) => {
    const value = getCellValue(row, prop)
    // A checkbox reads as 1 / 0; anything that is not a finite number is left out.
    const number = typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' && isFinite(value) ? value : null
    return { number, checked: value === true, unique: NO_UNIQUE }
  }
}

function addTo(acc: Acc, reading: Reading): void {
  acc.rows++
  if (reading.checked) acc.checked++
  if (reading.number !== null) {
    acc.n++
    acc.sum += reading.number
    if (reading.number < acc.min) acc.min = reading.number
    if (reading.number > acc.max) acc.max = reading.number
    acc.values?.push(reading.number)
  }
  if (acc.unique) for (const key of reading.unique) acc.unique.add(key)
}

function mergeInto(target: Acc, from: Acc): void {
  target.rows += from.rows
  target.n += from.n
  target.sum += from.sum
  target.checked += from.checked
  if (from.min < target.min) target.min = from.min
  if (from.max > target.max) target.max = from.max
  if (target.values && from.values) for (const v of from.values) target.values.push(v)
  if (target.unique && from.unique) for (const key of from.unique) target.unique.add(key)
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function isAdditive(aggregate: ChartAggregate): boolean {
  return aggregate === 'count' || aggregate === 'sum'
}

/** The value of a group; for a group without rows: zero where nothing adds up to zero, null elsewhere. */
function resultOf(acc: Acc | undefined, aggregate: ChartAggregate): number | null {
  switch (aggregate) {
    case 'count':
      return acc ? acc.rows : 0
    case 'count_unique':
      return acc?.unique ? acc.unique.size : 0
    case 'sum':
      return acc ? acc.sum : 0
    case 'average':
      return acc && acc.n ? acc.sum / acc.n : null
    case 'min':
      return acc && acc.n ? acc.min : null
    case 'max':
      return acc && acc.n ? acc.max : null
    case 'median':
      return acc?.values ? median(acc.values) : null
    case 'percent_checked':
      return acc && acc.rows ? acc.checked / acc.rows : null
  }
}

function yLabelOf(aggregate: ChartAggregate, prop: PropertySchema | undefined): string {
  const name = prop?.name ?? ''
  switch (aggregate) {
    case 'count':
      return 'Count'
    case 'count_unique':
      return `Unique ${name}`.trim()
    case 'sum':
      return `Sum of ${name}`
    case 'average':
      return `Average ${name}`
    case 'min':
      return `Minimum ${name}`
    case 'max':
      return `Maximum ${name}`
    case 'median':
      return `Median ${name}`
    case 'percent_checked':
      return `${name} checked`
  }
}

function yFormatOf(aggregate: ChartAggregate, prop: PropertySchema | undefined): ChartYFormat {
  if (aggregate === 'count' || aggregate === 'count_unique') return { numberFormat: 'number', integer: true }
  if (aggregate === 'percent_checked') return { numberFormat: 'percent', integer: false }
  const numberFormat = prop?.type === 'number' ? (prop.numberFormat ?? 'number') : 'number'
  return { numberFormat, integer: prop?.type === 'checkbox' && aggregate !== 'average' && aggregate !== 'median' }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

interface Plan {
  config: ChartConfig
  x: Grouper | undefined
  series: Grouper | undefined
  valueProp: PropertySchema | undefined
  showEmpty: boolean
}

function plan(rows: readonly Block[], schema: Schema, raw: ChartConfig, now: Date | undefined, opts: FormatOptions): Plan {
  // Whatever the caller hands over, only a configuration that fits the schema is drawn.
  const config = normalizeChartConfig(raw, schema)
  const today = todayISO(now ?? new Date())
  const xProp = config.kind === 'number' ? undefined : propOf(schema, config.x)
  const seriesProp = chartKindHasSeries(config.kind) ? propOf(schema, config.series) : undefined
  return {
    config,
    x: xProp ? createGrouper(xProp, { rows, bucket: config.xDateBucket, today, opts }) : undefined,
    // A date used as a split is bucketed too (by month): one series per day would be noise.
    series: seriesProp ? createGrouper(seriesProp, { rows, bucket: 'month', today, opts }) : undefined,
    valueProp: propOf(schema, config.y.property),
    showEmpty: config.showEmpty === true
  }
}

let collator: Intl.Collator | undefined
function compareLabels(a: string, b: string): number {
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return collator.compare(a, b)
}

/** Position of each kept group among the colours: its own slot while slots are unique, else its rank. */
function colourSlots(groups: readonly Group[]): number[] {
  const own = groups.map((group) => group.order % CHART_COLOURS.length)
  return new Set(own).size === own.length ? own : groups.map((_, index) => index % CHART_COLOURS.length)
}

function coloursFor(groups: readonly Group[], palette: ChartConfig['palette'], prop: PropertySchema): string[] {
  if (palette === 'options' && isSelectType(prop.type)) return groups.map((group) => group.optionColour ?? CHART_NEUTRAL_COLOUR)
  return colourSlots(groups).map((slot) => CHART_COLOURS[slot])
}

function emptyData(config: ChartConfig, status: ChartStatus, labels: { x: string; y: string }, yFormat: ChartYFormat, additive: boolean): ChartData {
  return {
    status,
    kind: config.kind,
    categories: [],
    series: [],
    total: null,
    yFormat,
    rowCount: 0,
    additive,
    split: false,
    xLabel: labels.x,
    yLabel: labels.y
  }
}

/**
 * Aggregates `rows` (already filtered by the view) into what a chart draws.
 *
 * One pass over the rows fills an accumulator per (category, series) cell; a row
 * with several values (multi-select) counts in each of them, but only once in a
 * category total and once in `total`. `now` decides which date bucket is "current".
 */
export function buildChartData(
  rows: readonly Block[],
  schema: Schema,
  rawConfig: ChartConfig,
  now?: Date,
  opts: FormatOptions = {}
): ChartData {
  const { config, x, series, valueProp, showEmpty } = plan(rows, schema, rawConfig, now, opts)
  const aggregate = config.y.aggregate
  const additive = isAdditive(aggregate)
  const yFormat = yFormatOf(aggregate, valueProp)
  const yLabel = yLabelOf(aggregate, valueProp)
  const xLabel = x ? x.prop.name : ''
  const read = reader(aggregate, valueProp)

  if (config.kind !== 'number' && !x) return emptyData(config, 'no_x', { x: xLabel, y: yLabel }, yFormat, additive)

  // ---- one pass: cells, category totals, series totals, grand total ----
  const total = newAcc(aggregate)
  const byCategory = new Map<string, Acc>()
  const bySeries = new Map<string, Acc>()
  const cells = new Map<string, Map<string, Acc>>()
  const ALL = [CHART_ALL_KEY]
  const EMPTY = [CHART_EMPTY_KEY]
  const SINGLE = [SINGLE_SERIES_KEY]

  for (const row of rows) {
    let xKeys = x ? x.keysOf(row) : ALL
    if (!xKeys.length) {
      if (!showEmpty) continue
      xKeys = EMPTY
    }
    let sKeys = series ? series.keysOf(row) : SINGLE
    if (!sKeys.length) {
      if (!showEmpty) continue
      sKeys = EMPTY
    }
    const reading = read(row)
    addTo(total, reading)
    if (series) {
      for (const sKey of sKeys) {
        let acc = bySeries.get(sKey)
        if (!acc) bySeries.set(sKey, (acc = newAcc(aggregate)))
        addTo(acc, reading)
      }
    }
    for (const xKey of xKeys) {
      let acc = byCategory.get(xKey)
      if (!acc) byCategory.set(xKey, (acc = newAcc(aggregate)))
      addTo(acc, reading)
      if (!series) continue
      let rowCells = cells.get(xKey)
      if (!rowCells) cells.set(xKey, (rowCells = new Map()))
      for (const sKey of sKeys) {
        let cell = rowCells.get(sKey)
        if (!cell) rowCells.set(sKey, (cell = newAcc(aggregate)))
        addTo(cell, reading)
      }
    }
  }

  const base: Omit<ChartData, 'categories' | 'series'> = {
    status: total.rows ? 'ok' : 'no_rows',
    kind: config.kind,
    total: total.rows ? resultOf(total, aggregate) : null,
    yFormat,
    rowCount: total.rows,
    additive,
    split: false,
    xLabel,
    yLabel
  }
  if (x?.bucket) base.bucket = x.bucket

  if (!x) {
    // A single figure.
    return {
      ...base,
      categories: [{ key: CHART_ALL_KEY, label: yLabel }],
      series: [{ key: SINGLE_SERIES_KEY, label: yLabel, colour: CHART_ACCENT_COLOUR, values: [base.total] }]
    }
  }
  if (!total.rows) return { ...base, categories: [], series: [] }

  // ---- categories: manual order, limit, sort ----
  const isPie = config.kind === 'pie' || config.kind === 'donut'
  const valueOf = (key: string): number | null => resultOf(byCategory.get(key), aggregate)
  let groups = x.groups().slice()
  // A part of a whole needs a positive value; a text axis only has groups that were seen.
  if (isPie) groups = groups.filter((group) => (valueOf(group.key) ?? 0) > 0)

  let otherCategory: Acc | undefined
  const folded = new Set<string>()
  const limit = isPie
    ? Math.min(config.limit ?? MAX_PIE_SLICES, MAX_PIE_SLICES)
    : x.continuous
      ? Infinity
      : (config.limit ?? DEFAULT_CATEGORY_LIMIT)
  if (groups.length > limit) {
    const ranked = groups
      .map((group) => ({ group, value: valueOf(group.key) ?? -Infinity }))
      .sort((a, b) => b.value - a.value || a.group.order - b.group.order)
    // "Other" takes a slot of its own in a pie, which has no more colours than slices.
    const keep = new Set(ranked.slice(0, isPie && limit === MAX_PIE_SLICES ? limit - 1 : limit).map((entry) => entry.group.key))
    otherCategory = newAcc(aggregate)
    for (const group of groups) {
      if (keep.has(group.key)) continue
      folded.add(group.key)
      const acc = byCategory.get(group.key)
      if (acc) mergeInto(otherCategory, acc)
    }
    groups = groups.filter((group) => keep.has(group.key))
  }

  const sort = config.sort ?? 'manual'
  if (sort === 'x_asc' || sort === 'x_desc') {
    const direction = sort === 'x_asc' ? 1 : -1
    groups.sort((a, b) => {
      const byNumber = a.sortNumber !== undefined && b.sortNumber !== undefined ? a.sortNumber - b.sortNumber : compareLabels(a.label, b.label)
      return (byNumber || a.order - b.order) * direction
    })
  } else if (sort === 'y_asc' || sort === 'y_desc') {
    const direction = sort === 'y_asc' ? 1 : -1
    groups.sort((a, b) => {
      const va = valueOf(a.key)
      const vb = valueOf(b.key)
      // Groups without a value go last, whatever the direction.
      if (va === null || vb === null) return va === vb ? a.order - b.order : va === null ? 1 : -1
      return (va - vb) * direction || a.order - b.order
    })
  }

  const categories: ChartCategory[] = groups.map((group) => {
    const category: ChartCategory = { key: group.key, label: group.label }
    if (group.current) category.current = true
    return category
  })
  const categoryAccs: (Acc | undefined)[] = groups.map((group) => byCategory.get(group.key))
  if (otherCategory && otherCategory.rows) {
    categories.push({ key: CHART_OTHER_KEY, label: 'Other', kind: 'other' })
    categoryAccs.push(otherCategory)
  }
  const emptyCategory = byCategory.get(CHART_EMPTY_KEY)
  if (emptyCategory && (!isPie || (resultOf(emptyCategory, aggregate) ?? 0) > 0)) {
    categories.push({ key: CHART_EMPTY_KEY, label: `No ${x.prop.name}`, kind: 'empty' })
    categoryAccs.push(emptyCategory)
  }

  // ---- series ----
  let out: ChartSeries[]
  if (series) {
    let kept = series.groups().filter((group) => bySeries.has(group.key))
    const foldedSeries = new Set<string>()
    const hasEmptySeries = bySeries.has(CHART_EMPTY_KEY)
    const room = MAX_CHART_SERIES - (hasEmptySeries ? 1 : 0)
    if (kept.length > room) {
      const ranked = kept
        .map((group) => ({ group, value: resultOf(bySeries.get(group.key), aggregate) ?? -Infinity }))
        .sort((a, b) => b.value - a.value || a.group.order - b.group.order)
      const keep = new Set(ranked.slice(0, room - 1).map((entry) => entry.group.key))
      for (const group of kept) if (!keep.has(group.key)) foldedSeries.add(group.key)
      kept = kept.filter((group) => keep.has(group.key))
    }

    /** The accumulator of one (category, series) cell, with whatever was folded into either. */
    const cellOf = (categoryKey: string, seriesKey: string): Acc | undefined => {
      const xKeys = categoryKey === CHART_OTHER_KEY ? [...folded] : [categoryKey]
      const sKeys = seriesKey === CHART_OTHER_KEY ? [...foldedSeries] : [seriesKey]
      if (xKeys.length === 1 && sKeys.length === 1) return cells.get(xKeys[0])?.get(sKeys[0])
      let merged: Acc | undefined
      for (const xKey of xKeys) {
        const rowCells = cells.get(xKey)
        if (!rowCells) continue
        for (const sKey of sKeys) {
          const cell = rowCells.get(sKey)
          if (!cell) continue
          merged ??= newAcc(aggregate)
          mergeInto(merged, cell)
        }
      }
      return merged
    }
    const valuesOf = (seriesKey: string): (number | null)[] =>
      categories.map((category) => resultOf(cellOf(category.key, seriesKey), aggregate))

    const colours = coloursFor(kept, config.palette, series.prop)
    out = kept.map((group, index) => ({ key: group.key, label: group.label, colour: colours[index], values: valuesOf(group.key) }))
    if (foldedSeries.size) {
      out.push({ key: CHART_OTHER_KEY, label: 'Other', kind: 'other', colour: CHART_NEUTRAL_COLOUR, values: valuesOf(CHART_OTHER_KEY) })
    }
    if (hasEmptySeries) {
      out.push({
        key: CHART_EMPTY_KEY,
        label: `No ${series.prop.name}`,
        kind: 'empty',
        colour: CHART_NEUTRAL_COLOUR,
        values: valuesOf(CHART_EMPTY_KEY)
      })
    }
  } else {
    const values = categoryAccs.map((acc) => resultOf(acc, aggregate))
    const perCategory = isPie || ((config.palette === 'colourful' || config.palette === 'options') && !x.continuous)
    // Colours follow the group, not its rank; when there are more groups than colours the
    // axis labels carry identity alone and every mark wears the series colour.
    if (perCategory && (isPie || groups.length <= CHART_COLOURS.length)) {
      const colours = coloursFor(groups, config.palette, x.prop)
      categories.forEach((category, index) => {
        category.colour = category.kind ? CHART_NEUTRAL_COLOUR : colours[index]
      })
    }
    const single = config.palette === 'colourful' || config.palette === 'options' ? CHART_COLOURS[0] : CHART_ACCENT_COLOUR
    out = [{ key: SINGLE_SERIES_KEY, label: yLabel, colour: single, values }]
  }

  if (config.cumulative && chartKindCanAccumulate(config.kind)) {
    for (const item of out) {
      let running = 0
      item.values = item.values.map((value) => (running += value ?? 0))
    }
    base.cumulative = true
  }

  const data: ChartData = { ...base, categories, series: out, split: !!series }
  if (series) data.seriesLabel = series.prop.name
  return data
}

/**
 * The rows behind one mark: those of a category and, when the chart is split, of one
 * series (`seriesKey` null takes the whole category). Built with the same grouping as
 * `data`, so "Other" and "No value" resolve to exactly the rows that were folded there.
 */
export function chartRowsAt(
  rows: readonly Block[],
  schema: Schema,
  rawConfig: ChartConfig,
  data: ChartData,
  categoryKey: string,
  seriesKey: string | null,
  now?: Date,
  opts: FormatOptions = {}
): Block[] {
  const { x, series, showEmpty } = plan(rows, schema, rawConfig, now, opts)
  const categoryKeys = new Set(data.categories.map((category) => category.key))
  const seriesKeys = new Set(data.series.map((item) => item.key))
  const wantsSeries = series && data.split && seriesKey !== null
  const resolve = (keys: string[], known: Set<string>): string[] | null => {
    if (!keys.length) return showEmpty ? [CHART_EMPTY_KEY] : null
    return keys.map((key) => (known.has(key) ? key : CHART_OTHER_KEY))
  }
  const out: Block[] = []
  for (const row of rows) {
    const xKeys = x ? resolve(x.keysOf(row), categoryKeys) : [CHART_ALL_KEY]
    if (!xKeys) continue
    // A row without a series value is not part of the chart at all (see buildChartData).
    const sKeys = series ? resolve(series.keysOf(row), seriesKeys) : null
    if (series && !sKeys) continue
    if (!xKeys.includes(categoryKey)) continue
    if (wantsSeries && !sKeys?.includes(seriesKey)) continue
    out.push(row)
  }
  return out
}

// ---------------------------------------------------------------------------
// Text renderings: numbers, captions, tables, summaries
// ---------------------------------------------------------------------------

/**
 * A value of the chart as text, in the number format of the property it was computed
 * from. `compact` (axis ticks) abbreviates large numbers: 12K, 3.4M.
 */
export function formatChartValue(value: number | null | undefined, yFormat: ChartYFormat, opts: FormatOptions = {}, compact = false): string {
  if (typeof value !== 'number' || !isFinite(value)) return '–'
  try {
    if (yFormat.numberFormat === 'percent') {
      return new Intl.NumberFormat(opts.locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
    }
    if (compact && Math.abs(value) >= 10_000) {
      if (yFormat.numberFormat === 'currency') {
        // Same currency as the cells of the property (see formatNumber).
        return new Intl.NumberFormat(opts.locale, {
          style: 'currency',
          currency: opts.currency ?? defaultCurrency(opts.locale),
          notation: 'compact',
          maximumFractionDigits: 1
        }).format(value)
      }
      return new Intl.NumberFormat(opts.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    }
    if (yFormat.numberFormat === 'currency') return formatNumber(value, 'currency', opts)
    return new Intl.NumberFormat(opts.locale, { maximumFractionDigits: yFormat.integer ? 0 : 2 }).format(value)
  } catch {
    return String(value)
  }
}

/**
 * The ticks of a value axis as text, formatted as one set: all abbreviated or none
 * (12K next to 8,000.00 reads as two scales), and without ".00" when every tick is whole.
 */
export function formatChartTicks(values: readonly number[], yFormat: ChartYFormat, opts: FormatOptions = {}): string[] {
  const finite = values.filter((value) => typeof value === 'number' && isFinite(value))
  const compact = finite.some((value) => Math.abs(value) >= 10_000)
  const whole = finite.every((value) => Number.isInteger(value))
  try {
    let formatter: Intl.NumberFormat
    if (yFormat.numberFormat === 'percent') {
      formatter = new Intl.NumberFormat(opts.locale, { style: 'percent', maximumFractionDigits: 1 })
    } else {
      const digits: Intl.NumberFormatOptions = compact
        ? { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }
        : whole
          ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
          : { maximumFractionDigits: 2 }
      formatter =
        yFormat.numberFormat === 'currency'
          ? new Intl.NumberFormat(opts.locale, { style: 'currency', currency: opts.currency ?? defaultCurrency(opts.locale), ...digits })
          : new Intl.NumberFormat(opts.locale, digits)
    }
    return values.map((value) => (typeof value === 'number' && isFinite(value) ? formatter.format(value) : ''))
  } catch {
    return values.map((value) => String(value))
  }
}

/** A share as text ("42%"), or empty when there is no whole to be a part of. */
export function formatShare(value: number | null, whole: number | null, opts: FormatOptions = {}): string {
  if (typeof value !== 'number' || typeof whole !== 'number' || !isFinite(value) || !(whole > 0) || value < 0) return ''
  try {
    return new Intl.NumberFormat(opts.locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / whole)
  } catch {
    return `${Math.round((value / whole) * 100)}%`
  }
}

/** "Count by Status", "Sum of Amount by Due and Owner", "Count by Due, running total", or just the measure for a single figure. */
export function chartCaption(data: ChartData): string {
  if (data.kind === 'number' || !data.xLabel) return data.yLabel
  const split = data.split && data.seriesLabel ? ` and ${data.seriesLabel}` : ''
  return `${data.yLabel} by ${data.xLabel}${split}${data.cumulative ? ', running total' : ''}`
}

export interface ChartTable {
  header: string[]
  rows: string[][]
}

/**
 * The aggregated numbers as a table: one row per category, one column per series.
 * `raw` writes plain numbers (for spreadsheets); otherwise values are formatted.
 */
export function chartTable(data: ChartData, opts: FormatOptions = {}, raw = false): ChartTable {
  const cell = (value: number | null): string =>
    raw ? (typeof value === 'number' && isFinite(value) ? String(value) : '') : value === null ? '' : formatChartValue(value, data.yFormat, opts)
  if (data.kind === 'number') {
    return { header: ['Measure', 'Value'], rows: [[data.yLabel, cell(data.total)]] }
  }
  const header = [data.xLabel || 'Category', ...(data.split ? data.series.map((series) => series.label) : [data.yLabel])]
  const rows = data.categories.map((category, index) => [category.label, ...data.series.map((series) => cell(series.values[index] ?? null))])
  return { header, rows }
}

/** The aggregated table as tab-separated text, ready to paste into a spreadsheet. */
export function chartToTSV(data: ChartData, opts: FormatOptions = {}): string {
  const table = chartTable(data, opts, true)
  const clean = (text: string): string => text.replace(/[\t\r\n]+/g, ' ')
  return [table.header, ...table.rows].map((row) => row.map(clean).join('\t')).join('\n')
}

const SUMMARY_ITEMS = 8

/** One or two sentences that say what the chart shows, for readers who cannot see it. */
export function chartSummary(data: ChartData, opts: FormatOptions = {}): string {
  const kind = `${CHART_KIND_LABELS[data.kind]} chart`
  const caption = chartCaption(data)
  if (data.kind === 'number') return `${caption}: ${formatChartValue(data.total, data.yFormat, opts)}.`
  if (data.status === 'no_x') return `${kind}. No property is chosen for the horizontal axis.`
  if (data.status === 'no_rows' || !data.categories.length) return `${kind}. ${caption}. There is no data to show.`
  const format = (value: number | null): string => formatChartValue(value, data.yFormat, opts)
  const count = `${data.categories.length} ${data.categories.length === 1 ? 'category' : 'categories'}`
  if (data.split) {
    const parts = data.series.slice(0, SUMMARY_ITEMS).map((series) => series.label)
    const more = data.series.length > SUMMARY_ITEMS ? ` and ${data.series.length - SUMMARY_ITEMS} more` : ''
    return `${kind}. ${caption}. ${count}, ${data.series.length} series: ${parts.join(', ')}${more}.`
  }
  const values = data.series[0]?.values ?? []
  const parts = data.categories.slice(0, SUMMARY_ITEMS).map((category, index) => `${category.label} ${format(values[index] ?? null)}`)
  const more = data.categories.length > SUMMARY_ITEMS ? ` and ${data.categories.length - SUMMARY_ITEMS} more` : ''
  return `${kind}. ${caption}. ${count}: ${parts.join(', ')}${more}.`
}
