import { randomUUID } from 'node:crypto'
import { OPTION_COLORS } from '../../shared/database/values'
import type { Block, DatabaseView, PropertySchema, PropertyType, PropertyValue, SelectOption } from '../../shared/types'
import { plainText } from '../../shared/richtext'

/**
 * A database as a CSV table and back. Going out, each cell is written so it reads back as the
 * same type (checkbox Yes / No, dates as ISO days, options by name). Coming in, from Notion or
 * from sel, the first column is the title and every other column gets the type its values
 * fit: checkbox, number, date, url, select, multi-select, or text when nothing else fits.
 */

export interface CsvDatabase {
  schema: Record<string, PropertySchema>
  views: DatabaseView[]
  /** One per row of the table, in order: the title and the values of the other columns. */
  rows: { title: string; values: Record<string, PropertyValue> }[]
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const YES = new Set(['yes', 'true', 'sim', '☑', '✓', 'x'])
const NO = new Set(['no', 'false', 'não', 'nao', '☐', ''])
const NUMBER_RE = /^[-+]?(\d+(\.\d+)?|\.\d+)$/
const URL_RE = /^https?:\/\/\S+$/i
/** Names that say a column holds a few options. */
const SELECT_HINT = /status|type|tipo|priorit|stage|etapa|categor|kind|state|estado|area|área/i
const MULTI_HINT = /tags?|labels?|etiquetas?|marcador|categories|categorias|topics|temas/i
const MAX_OPTIONS = 50
const MAX_OPTION_CHARS = 60

const pad = (n: number): string => String(n).padStart(2, '0')

/** One date as sel keeps it (`YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm`), from the ways Notion and sel write them; null otherwise. */
export function parseDateText(text: string): string | null {
  const value = text.trim().replace(/^@/, '')
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value)
  if (m) {
    const [, y, mo, d, h, mi, zone] = m
    if (zone) {
      // A moment with a zone (an export's created time): the wall clock here.
      const at = new Date(value.replace(' ', 'T').replace(/\//g, '-'))
      if (Number.isNaN(at.getTime())) return null
      return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
    }
    return checkDate(Number(y), Number(mo), Number(d), h === undefined ? null : Number(h), mi === undefined ? null : Number(mi))
  }
  // Notion: "October 22, 2026" or "October 22, 2026 3:00 PM" (or 15:00).
  m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?$/.exec(value)
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m![1].toLowerCase()) && m![1].length >= 3) + 1
    if (!month) return null
    let hour = m[4] === undefined ? null : Number(m[4])
    if (hour !== null && m[6]) {
      const pm = m[6].toLowerCase() === 'pm'
      if (hour < 1 || hour > 12) return null
      hour = (hour % 12) + (pm ? 12 : 0)
    }
    return checkDate(Number(m[3]), month, Number(m[2]), hour, m[5] === undefined ? null : Number(m[5]))
  }
  return null
}

function checkDate(y: number, mo: number, d: number, h: number | null, mi: number | null): string | null {
  const at = new Date(Date.UTC(y, mo - 1, d))
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return null
  const day = `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)}`
  if (h === null || mi === null) return day
  if (h > 23 || mi > 59) return null
  return `${day}T${pad(h)}:${pad(mi)}`
}

/** A date cell, possibly a range ("start → end"). */
function parseDateValue(text: string): { start: string; end?: string } | null {
  const parts = text.split(/\s+(?:→|->)\s+/)
  if (parts.length > 2) return null
  const start = parseDateText(parts[0])
  if (!start) return null
  if (parts.length === 1) return { start }
  const end = parseDateText(parts[1])
  return end ? { start, end } : null
}

const splitTokens = (text: string): string[] =>
  text
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)

/** The type a column's values fit. `values` are the non-empty cells. */
function inferType(name: string, values: string[]): PropertyType {
  if (!values.length) return 'text'
  if (values.every((v) => YES.has(v.toLowerCase()) || NO.has(v.toLowerCase())) && values.some((v) => YES.has(v.toLowerCase())))
    return 'checkbox'
  if (values.every((v) => /^(yes|no)$/i.test(v))) return 'checkbox'
  if (values.every((v) => NUMBER_RE.test(v))) return 'number'
  if (values.every((v) => parseDateValue(v) !== null)) return 'date'
  if (values.every((v) => URL_RE.test(v))) return 'url'
  const tokens = values.flatMap(splitTokens)
  const distinct = new Set(tokens)
  const short = tokens.every((t) => t.length <= MAX_OPTION_CHARS)
  if (values.some((v) => splitTokens(v).length > 1)) {
    if (short && distinct.size <= MAX_OPTIONS && (MULTI_HINT.test(name) || tokens.length > distinct.size)) return 'multi_select'
    return 'text'
  }
  if (short && distinct.size <= MAX_OPTIONS && (SELECT_HINT.test(name) || MULTI_HINT.test(name) || distinct.size < values.length))
    return MULTI_HINT.test(name) ? 'multi_select' : 'select'
  return 'text'
}

/** The database a CSV table makes: `header` its first row, `rows` the others. */
export function csvToDatabase(header: readonly string[], rows: readonly (readonly string[])[]): CsvDatabase {
  const schema: Record<string, PropertySchema> = {}
  const ids: string[] = []
  const used = new Set<string>()
  const columns = Math.max(1, header.length)
  for (let i = 0; i < columns; i++) {
    let name = (header[i] ?? '').trim() || (i === 0 ? 'Name' : `Column ${i + 1}`)
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${(header[i] ?? '').trim() || 'Column'} (${n})`
    used.add(name.toLowerCase())
    const id = i === 0 ? 'title' : `p${i}`
    ids.push(id)
    const cells = rows.map((row) => (row[i] ?? '').trim()).filter(Boolean)
    const type: PropertyType = i === 0 ? 'title' : inferType(name, cells)
    const prop: PropertySchema = { id, name, type }
    if (type === 'select' || type === 'multi_select') {
      const names = [...new Set(type === 'select' ? cells : cells.flatMap(splitTokens))]
      prop.options = names.map(
        (option, index): SelectOption => ({ id: randomUUID(), name: option, color: OPTION_COLORS[index % OPTION_COLORS.length] })
      )
    }
    schema[id] = prop
  }
  const out = rows.map((row) => {
    const values: Record<string, PropertyValue> = {}
    for (let i = 1; i < ids.length; i++) {
      const cell = (row[i] ?? '').trim()
      const prop = schema[ids[i]]
      const value = cellValue(prop, cell)
      if (value !== null) values[prop.id] = value
    }
    return { title: (row[0] ?? '').trim(), values }
  })
  const view: DatabaseView = { id: randomUUID(), name: 'Table', type: 'table', visibleProperties: ids, filters: [], sorts: [] }
  return { schema, views: [view], rows: out }
}

function cellValue(prop: PropertySchema, cell: string): PropertyValue {
  if (prop.type === 'checkbox') return YES.has(cell.toLowerCase()) ? true : cell ? false : null
  if (!cell) return null
  const optionId = (name: string): string | undefined => prop.options?.find((o) => o.name === name)?.id
  switch (prop.type) {
    case 'number':
      return Number(cell)
    case 'date':
      return parseDateValue(cell)
    case 'select':
      return optionId(cell) ?? null
    case 'multi_select': {
      const chosen = splitTokens(cell)
        .map(optionId)
        .filter((id): id is string => !!id)
      return chosen.length ? [...new Set(chosen)] : null
    }
    default:
      return cell
  }
}

/**
 * One cell of a row, as the export's CSV writes it: what `csvToDatabase` reads back as the same
 * value. Relations, rollups and formulas are written as they read (`computed`), as text.
 */
export function csvCell(prop: PropertySchema, row: Block, computed: () => string): string {
  if (prop.type === 'title') return plainText(row.props.title)
  if (prop.type === 'relation' || prop.type === 'rollup' || prop.type === 'formula') return computed()
  if (prop.type === 'created_time' || prop.type === 'last_edited_time') {
    const at = new Date(prop.type === 'created_time' ? row.createdAt : row.updatedAt)
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
  }
  const value = row.props.values?.[prop.id]
  if (prop.type === 'checkbox') return value === true ? 'Yes' : 'No'
  if (value === undefined || value === null) return ''
  const optionName = (id: unknown): string => prop.options?.find((o) => o.id === id)?.name ?? ''
  switch (prop.type) {
    case 'select':
      return optionName(value)
    case 'multi_select':
      return Array.isArray(value) ? value.map(optionName).filter(Boolean).join(', ') : ''
    case 'date':
      return typeof value === 'object' && !Array.isArray(value) ? (value.end ? `${value.start} → ${value.end}` : value.start) : ''
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  }
}
