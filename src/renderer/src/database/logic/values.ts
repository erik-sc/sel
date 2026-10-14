// Reading, writing and formatting cell values. Everything that touches persisted
// row data goes through here and tolerates missing / wrong-typed / dangling data.
import type { Block, PropertySchema, PropertyType, PropertyValue, SelectOption, ViewType } from '../../../../shared/types'
import { relationIds } from '../../../../shared/relation'
import {
  formatDate,
  formatDay,
  formatTimestamp,
  isDateValue,
  normalizeDateValue,
  type FormatOptions
} from './dates'

export type Schema = Record<string, PropertySchema>
export type Values = Record<string, PropertyValue>

export const OPTION_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const

/** Types a user can pick for a new property (the title is unique and implicit). */
export const PROPERTY_TYPES: PropertyType[] = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'created_time',
  'last_edited_time',
  'relation',
  'rollup',
  'formula'
]

export const TYPE_LABELS: Record<PropertyType, string> = {
  title: 'Title',
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
  created_time: 'Created time',
  last_edited_time: 'Last edited time',
  relation: 'Relation',
  rollup: 'Rollup',
  formula: 'Formula'
}

export const VIEW_TYPES: ViewType[] = ['table', 'board', 'list', 'gallery', 'calendar', 'chart', 'calc']

export const VIEW_LABELS: Record<ViewType, string> = {
  table: 'Table',
  board: 'Board',
  list: 'List',
  gallery: 'Gallery',
  calendar: 'Calendar',
  chart: 'Chart',
  calc: 'Calculations'
}

export const DEFAULT_TITLE_ID = 'title'
export const DEFAULT_VIEW_ID = 'default-view'

/** Longest property / option / view name that is stored. */
export const MAX_NAME_LENGTH = 100
/** Longest text / url cell that is stored. */
export const MAX_TEXT_LENGTH = 10_000
const MAX_ID_LENGTH = 200

/** Random id for properties, options and views. Never derived from user text. */
export function makeId(): string {
  return globalThis.crypto.randomUUID()
}

/** Trims and caps a user-typed name. */
export function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH).trim() : ''
}

/**
 * True for strings that are safe as keys of `schema` / `values`: non-empty,
 * bounded, and not a member of Object.prototype (`__proto__`, `constructor`...).
 */
export function isSafeKey(id: unknown): id is string {
  return typeof id === 'string' && id !== '' && id.length <= MAX_ID_LENGTH && !(id in Object.prototype)
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Own-property lookup: an id coming from persisted data can never reach the prototype. */
export function propOf(schema: Schema | undefined | null, id: unknown): PropertySchema | undefined {
  if (!schema || typeof id !== 'string' || !Object.hasOwn(schema, id)) return undefined
  const prop = schema[id]
  return isPlainObject(prop) ? prop : undefined
}

export function isSelectType(type: PropertyType): type is 'select' | 'multi_select' {
  return type === 'select' || type === 'multi_select'
}

/**
 * Properties whose value is derived (from the block itself, from related rows for a
 * rollup, from the row's other properties for a formula), never stored or edited.
 */
export function isComputedType(type: PropertyType): boolean {
  return type === 'created_time' || type === 'last_edited_time' || type === 'rollup' || type === 'formula'
}

/** Properties whose value is a day or a moment: dates, and the created / last edited times. */
export function isDateLikeType(type: PropertyType): boolean {
  return type === 'date' || type === 'created_time' || type === 'last_edited_time'
}

// ---------------------------------------------------------------------------
// Blocks (rows) as they come out of the store: nothing is trusted
// ---------------------------------------------------------------------------

/** Plain text of a block title, whatever shape the stored rich text has. */
export function titleOf(block: Block | undefined | null): string {
  const title: unknown = block?.props?.title
  if (typeof title === 'string') return title
  if (!Array.isArray(title)) return ''
  let out = ''
  for (const span of title) {
    if (Array.isArray(span) && typeof span[0] === 'string') out += span[0]
    else if (typeof span === 'string') out += span
  }
  return out
}

export function iconOf(block: Block | undefined | null): string | undefined {
  const icon: unknown = block?.props?.icon
  return typeof icon === 'string' && icon !== '' ? icon : undefined
}

export function contentOf(block: Block | undefined | null): string[] {
  const content: unknown = block?.content
  return Array.isArray(content) ? content.filter((id): id is string => typeof id === 'string') : []
}

/** The stored `values` of a row, or an empty object when it is missing or not an object. */
export function valuesOf(row: Block | undefined | null): Values {
  const values: unknown = row?.props?.values
  return isPlainObject(values) ? (values as Values) : {}
}

function storedValue(row: Block, propertyId: string): unknown {
  const values = valuesOf(row)
  return Object.hasOwn(values, propertyId) ? values[propertyId] : undefined
}

export function getTitleProperty(schema: Schema): PropertySchema | undefined {
  for (const id of Object.keys(schema)) if (schema[id]?.type === 'title') return schema[id]
  return undefined
}

/** All properties: title first, then schema insertion order. */
export function orderedProperties(schema: Schema): PropertySchema[] {
  const out: PropertySchema[] = []
  for (const id of Object.keys(schema)) {
    const prop = schema[id]
    if (!prop) continue
    if (prop.type === 'title') out.unshift(prop)
    else out.push(prop)
  }
  return out
}

export function optionsOf(prop: PropertySchema | undefined): SelectOption[] {
  return Array.isArray(prop?.options) ? prop.options : []
}

export function findOption(prop: PropertySchema | undefined, id: unknown): SelectOption | undefined {
  if (typeof id !== 'string') return undefined
  return optionsOf(prop).find((o) => o?.id === id)
}

/**
 * The value of a cell, normalised to the property type: wrong-typed or dangling
 * data (e.g. a deleted select option) reads as empty instead of crashing.
 *
 * Only what the row itself holds: a relation gives every linked id it stores (whether
 * those rows still exist or not) and a rollup or a formula gives null. What other rows
 * and properties add to a cell is read through `readCell` (./cell.ts).
 */
export function getCellValue(row: Block, prop: PropertySchema): PropertyValue {
  switch (prop.type) {
    case 'title':
      return titleOf(row)
    case 'created_time':
      return typeof row.createdAt === 'number' && isFinite(row.createdAt) ? row.createdAt : null
    case 'last_edited_time':
      return typeof row.updatedAt === 'number' && isFinite(row.updatedAt) ? row.updatedAt : null
    case 'rollup':
    case 'formula':
      return null
  }
  const raw = storedValue(row, prop.id)
  if (raw === undefined || raw === null) return prop.type === 'checkbox' ? false : null
  switch (prop.type) {
    case 'text':
    case 'url':
      if (typeof raw === 'string') return raw
      if (typeof raw === 'number' && isFinite(raw)) return String(raw)
      return null
    case 'number':
      if (typeof raw === 'number') return isFinite(raw) ? raw : null
      if (typeof raw === 'string' && raw.trim() !== '' && isFinite(Number(raw))) return Number(raw)
      return null
    case 'checkbox':
      return raw === true
    case 'select': {
      const id: unknown = Array.isArray(raw) ? raw[0] : raw
      return findOption(prop, id) ? (id as string) : null
    }
    case 'multi_select': {
      const ids: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
      const seen = new Set<string>()
      for (const id of ids) if (typeof id === 'string' && findOption(prop, id)) seen.add(id)
      return [...seen]
    }
    case 'date':
      return normalizeDateValue(raw)
    case 'relation':
      return relationIds(raw, prop.relation?.limit)
  }
  return null
}

export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (typeof v === 'number') return isNaN(v)
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'boolean') return false
  return typeof (v as { start?: unknown }).start !== 'string' || (v as { start: string }).start === ''
}

/** Returns a new values object with the cell set (or removed when empty). */
export function setValue(values: Values | undefined | null, propertyId: string, value: PropertyValue): Values {
  const out: Values = isPlainObject(values) ? { ...values } : {}
  if (!isSafeKey(propertyId)) return out
  if (value === null || value === undefined || (value !== false && isEmptyValue(value))) {
    delete out[propertyId]
  } else {
    out[propertyId] = value
  }
  return out
}

/** Deep equality of two stored cell values (they are plain JSON). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * What may be written for a property: the value in its canonical stored shape,
 * or null when it does not fit the type. Guards every write against wrong types,
 * NaN / Infinity, unknown options and oversized text.
 */
export function sanitizeValue(prop: PropertySchema, value: unknown): PropertyValue {
  if (value === null || value === undefined) return null
  switch (prop.type) {
    case 'text':
    case 'url': {
      const text = typeof value === 'string' ? value : typeof value === 'number' && isFinite(value) ? String(value) : ''
      return text.trim() === '' ? null : text.slice(0, MAX_TEXT_LENGTH)
    }
    case 'number':
      return typeof value === 'number' && isFinite(value) ? value : null
    case 'checkbox':
      return value === true
    case 'select': {
      const id: unknown = Array.isArray(value) ? value[0] : value
      return findOption(prop, id) ? (id as string) : null
    }
    case 'multi_select': {
      const ids: unknown[] = Array.isArray(value) ? value : [value]
      const out = [...new Set(ids.filter((id): id is string => !!findOption(prop, id)))]
      return out.length ? out : null
    }
    case 'date':
      return normalizeDateValue(value)
    case 'relation': {
      const ids = relationIds(Array.isArray(value) ? value : [value], prop.relation?.limit)
      return ids.length ? ids : null
    }
    default:
      // title lives in props.title; created/last edited time, rollups and formulas are computed.
      return null
  }
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  BR: 'BRL',
  GB: 'GBP',
  JP: 'JPY',
  CA: 'CAD',
  AU: 'AUD',
  MX: 'MXN',
  AR: 'ARS',
  CH: 'CHF',
  IN: 'INR',
  CN: 'CNY',
  PT: 'EUR',
  ES: 'EUR',
  FR: 'EUR',
  DE: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  IE: 'EUR'
}

/** Currency used by the "currency" number format: the one of the locale's region, else USD. */
export function defaultCurrency(locale?: string): string {
  let tag = locale
  if (!tag) {
    try {
      tag = new Intl.NumberFormat().resolvedOptions().locale
    } catch {
      tag = 'en-US'
    }
  }
  const region = /[-_]([A-Za-z]{2})(?![A-Za-z])/.exec(tag)?.[1]?.toUpperCase()
  return (region && Object.hasOwn(REGION_CURRENCY, region) && REGION_CURRENCY[region]) || 'USD'
}

export function formatNumber(n: number, format: PropertySchema['numberFormat'] = 'number', opts: FormatOptions = {}): string {
  if (typeof n !== 'number' || !isFinite(n)) return ''
  try {
    if (format === 'percent') {
      return new Intl.NumberFormat(opts.locale, { style: 'percent', maximumFractionDigits: 2 }).format(n)
    }
    if (format === 'currency') {
      return new Intl.NumberFormat(opts.locale, {
        style: 'currency',
        currency: opts.currency ?? defaultCurrency(opts.locale)
      }).format(n)
    }
    return new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 6 }).format(n)
  } catch {
    return String(n)
  }
}

/** Decimal separator of a locale (`.` when it cannot be determined). */
export function decimalSeparator(locale?: string): '.' | ',' {
  try {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')
    return part?.value === ',' ? ',' : '.'
  } catch {
    return '.'
  }
}

/** Full-precision text of a number for the cell editor; `parseNumberInput` reads it back exactly. */
export function numberToInput(n: number, locale?: string): string {
  if (typeof n !== 'number' || !isFinite(n)) return ''
  const text = String(n)
  // Exponent notation is locale-neutral and parsed as is.
  if (/e/i.test(text)) return text
  return decimalSeparator(locale) === ',' ? text.replace('.', ',') : text
}

/**
 * Parses what a user typed into a number cell. Returns null for blank input
 * and undefined when the text is not a number (the cell should be left alone).
 *
 * Both `1,234.5` and `1.234,5` are understood: when the two separators appear,
 * the last one is the decimal mark. A lone separator is the decimal mark unless
 * it is the locale's grouping separator in a grouping position (`1.234` in pt-BR).
 */
export function parseNumberInput(
  text: string,
  format: PropertySchema['numberFormat'] = 'number',
  locale?: string
): number | null | undefined {
  if (typeof text !== 'string') return undefined
  const s = text.replace(/[\s  ]/g, '').replace(/−/g, '-')
  if (s === '') return null
  const match = /[-+]?(?:\d[\d.,]*|[.,]\d+)(?:e[-+]?\d+)?/i.exec(s)
  if (!match) return undefined
  // More digits elsewhere ("5-3", "1 of 2") means this is not a single number.
  if (/\d/.test(s.slice(0, match.index) + s.slice(match.index + match[0].length))) return undefined

  const [mantissa, exponent = ''] = match[0].split(/e/i)
  const dots = mantissa.split('.').length - 1
  const commas = mantissa.split(',').length - 1
  let decimal: '.' | ',' | null = null
  if (dots && commas) {
    decimal = mantissa.lastIndexOf('.') > mantissa.lastIndexOf(',') ? '.' : ','
    // The decimal mark appears once; "1.234,5.6" is not a number.
    if ((decimal === '.' ? dots : commas) > 1) return undefined
  } else if (dots + commas === 1) {
    const sep: '.' | ',' = dots ? '.' : ','
    const groupingShape = /^[-+]?\d{1,3}[.,]\d{3}$/.test(mantissa)
    decimal = sep !== decimalSeparator(locale) && groupingShape ? null : sep
  }
  let normalised = ''
  for (const ch of mantissa) {
    if (ch === '.' || ch === ',') normalised += ch === decimal ? '.' : ''
    else normalised += ch
  }
  const n = Number(exponent ? `${normalised}e${exponent}` : normalised)
  if (!isFinite(n)) return undefined
  const percent = s.slice(match.index + match[0].length).startsWith('%')
  return percent && format === 'percent' ? n / 100 : n
}

// ---------------------------------------------------------------------------
// Urls and covers
// ---------------------------------------------------------------------------

const MAX_URL_LENGTH = 2048

/**
 * The only urls a cell may open: http(s) and mailto, with bare domains promoted
 * to https. Anything else (javascript:, file:, data:, control characters...) is null.
 * Mirrors `sanitizeHref` of the editor and the main-process `toExternalUrl` policy.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  if (!url || url.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(url)) return null
  let candidate: string
  if (/^(https?:\/\/|mailto:)/i.test(url)) candidate = url
  else if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(url)) candidate = `https://${url}`
  else return null
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol === 'mailto:') return parsed.pathname ? candidate : null
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    return candidate
  } catch {
    return null
  }
}

export type CoverStyle = { kind: 'css'; background: string } | { kind: 'image'; backgroundImage: string }

const CSS_COVER =
  /^(var\(--c-[a-z-]+\)|linear-gradient\((\d+deg, )?var\(--c-[a-z-]+\)(, var\(--c-[a-z-]+\))+\))$/
const IMAGE_COVER = /^(sel-file:|https?:\/\/)/i

/**
 * Turns a stored `props.cover` into something safe to put in a style attribute.
 * Same policy as the page header: token-based colours/gradients verbatim, images
 * only from `sel-file:` / http(s), percent-encoded and quoted so that no
 * character can close the `url()` and inject further CSS. Everything else: null.
 */
export function coverStyle(cover: unknown): CoverStyle | null {
  if (typeof cover !== 'string' || !cover || cover.length > MAX_URL_LENGTH) return null
  if (CSS_COVER.test(cover)) return { kind: 'css', background: cover }
  if (!IMAGE_COVER.test(cover) || /[\u0000-\u001f\u007f]/.test(cover)) return null
  let href: string
  try {
    // The URL parser percent-encodes spaces, quotes and backslashes without double-encoding.
    href = new URL(cover).href
  } catch {
    return null
  }
  // Whatever could still end the quoted string or the url() function.
  const encoded = href.replace(/["'()\\\s]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
  return { kind: 'image', backgroundImage: `url("${encoded}")` }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Plain-text rendering of a (normalised) cell value. */
export function formatValue(value: unknown, prop: PropertySchema, opts: FormatOptions = {}): string {
  if (value === null || value === undefined) return ''
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'url':
      return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
    case 'number':
      return typeof value === 'number' ? formatNumber(value, prop.numberFormat, opts) : ''
    case 'checkbox':
      return value === true ? 'Yes' : 'No'
    case 'select':
      return findOption(prop, value)?.name ?? ''
    case 'multi_select':
      return (Array.isArray(value) ? value : [value])
        .map((id) => findOption(prop, id)?.name)
        .filter((n): n is string => !!n)
        .join(', ')
    case 'date':
      if (isDateValue(value)) return formatDate(value, opts)
      if (typeof value === 'string') return formatDay(value, opts)
      return ''
    case 'created_time':
    case 'last_edited_time':
      return typeof value === 'number' ? formatTimestamp(value, opts) : ''
    case 'relation': {
      // Without the related rows at hand only their number is known (`cellText` gives titles).
      const count = relationIds(value).length
      return count === 0 ? '' : count === 1 ? '1 page' : `${count} pages`
    }
    case 'rollup':
    case 'formula':
      // A computed value, by its shape (`cellText` knows the format of a rollup's related property).
      if (typeof value === 'number') return formatNumber(value, prop.numberFormat, opts)
      if (typeof value === 'boolean') return value ? 'Yes' : 'No'
      if (isDateValue(value)) return formatDate(value, opts)
      return typeof value === 'string' ? value : ''
  }
  return ''
}
