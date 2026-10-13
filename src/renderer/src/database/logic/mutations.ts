// Schema mutations: properties, options, type changes and the views that depend on them.
// All functions are pure and return their input by reference when nothing changes.
import type { Block, DatabaseView, PropertySchema, PropertyType, PropertyValue, SelectOption, ViewType } from '../../../../shared/types'
import { isDateValue, normalizeDateValue, parseLooseDay } from './dates'
import { sanitizeViews } from './normalize'
import {
  DEFAULT_TITLE_ID,
  OPTION_COLORS,
  TYPE_LABELS,
  VIEW_LABELS,
  cleanName,
  findOption,
  formatValue,
  getCellValue,
  getTitleProperty,
  isComputedType,
  isSafeKey,
  isSelectType,
  makeId,
  numberToInput,
  optionsOf,
  parseNumberInput,
  propOf,
  sameValue,
  setValue,
  valuesOf,
  type Schema,
  type Values
} from './values'
import { createDefaultView, firstPropertyOfType, uniqueName } from './views'

export function nextOptionColor(options: SelectOption[] | undefined): string {
  const used = new Map<string, number>()
  for (const c of OPTION_COLORS) used.set(c, 0)
  for (const o of options ?? []) used.set(o.color, (used.get(o.color) ?? 0) + 1)
  let best: string = OPTION_COLORS[0]
  // Skip gray as a first pick so new tags look distinct; least-used colour wins.
  const candidates = [...OPTION_COLORS.slice(1), OPTION_COLORS[0]]
  let bestCount = Infinity
  for (const c of candidates) {
    const n = used.get(c) ?? 0
    if (n < bestCount) {
      best = c
      bestCount = n
    }
  }
  return best
}

export function createDefaultSchema(): Schema {
  return { [DEFAULT_TITLE_ID]: { id: DEFAULT_TITLE_ID, name: 'Name', type: 'title' } }
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export function addProperty(
  schema: Schema,
  input: { id?: string; name?: string; type: PropertyType; options?: SelectOption[] }
): { schema: Schema; property: PropertySchema } {
  // A database has exactly one title property.
  const type: PropertyType = input.type === 'title' && getTitleProperty(schema) ? 'text' : input.type
  const id = isSafeKey(input.id) && !Object.hasOwn(schema, input.id) ? input.id : makeId()
  const names = Object.values(schema).map((p) => p.name)
  const property: PropertySchema = {
    id,
    name: uniqueName(names, cleanName(input.name) || TYPE_LABELS[type]),
    type
  }
  if (isSelectType(type)) property.options = input.options ?? []
  if (type === 'number') property.numberFormat = 'number'
  return { schema: { ...schema, [id]: property }, property }
}

export function renameProperty(schema: Schema, propertyId: string, name: string): Schema {
  const prop = propOf(schema, propertyId)
  const cleaned = cleanName(name)
  if (!prop || !cleaned || cleaned === prop.name) return schema
  return { ...schema, [propertyId]: { ...prop, name: cleaned } }
}

export function updateProperty(schema: Schema, propertyId: string, patch: Partial<Omit<PropertySchema, 'id' | 'type'>>): Schema {
  const prop = propOf(schema, propertyId)
  if (!prop) return schema
  const next = { ...prop, ...patch, id: prop.id, type: prop.type }
  return sameValue(next, prop) ? schema : { ...schema, [propertyId]: next }
}

// ---------------------------------------------------------------------------
// Type changes
// ---------------------------------------------------------------------------

function textOf(value: PropertyValue, from: PropertySchema): string {
  if (from.type === 'checkbox') return value === true ? 'Yes' : ''
  // In the notation `parseNumberInput` reads back, so number -> text -> number is lossless.
  if (from.type === 'number') return typeof value === 'number' ? numberToInput(value) : ''
  if (from.type === 'date') {
    if (!isDateValue(value)) return ''
    return value.end ? `${value.start} → ${value.end}` : value.start
  }
  return formatValue(value, from)
}

function nameKey(name: string): string {
  return cleanName(name).toLocaleLowerCase()
}

type OptionIndex = Map<string, SelectOption>

function indexOptions(prop: PropertySchema): OptionIndex {
  const index: OptionIndex = new Map()
  for (const option of optionsOf(prop)) {
    const key = nameKey(option.name)
    if (!index.has(key)) index.set(key, option)
  }
  return index
}

function optionByName(prop: PropertySchema, name: string): SelectOption | undefined {
  const key = nameKey(name)
  return optionsOf(prop).find((o) => nameKey(o.name) === key)
}

/**
 * Converts a (normalised) value from one property definition to another.
 * Returns null when the value has no meaningful counterpart in the target type.
 */
export function coerceValue(
  value: PropertyValue | undefined,
  from: PropertySchema,
  to: PropertySchema,
  index?: OptionIndex
): PropertyValue {
  if (value === null || value === undefined) return null
  if (from.type === to.type) return value
  const lookup = (name: string): SelectOption | undefined =>
    index ? index.get(nameKey(name)) : optionByName(to, name)
  switch (to.type) {
    case 'title':
    case 'text':
    case 'url': {
      const s = textOf(value, from)
      return s === '' ? null : s
    }
    case 'number': {
      if (typeof value === 'number') return isFinite(value) ? value : null
      if (typeof value === 'boolean') return value ? 1 : 0
      if (typeof value === 'string') return parseNumberInput(value) ?? null
      return null
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value !== 0
      if (typeof value === 'string') return /^(true|yes|y|1|x|checked|sim)$/i.test(value.trim())
      return false
    }
    case 'select': {
      if (from.type === 'multi_select') {
        const first: unknown = Array.isArray(value) ? value[0] : value
        return findOption(to, first) ? (first as string) : null
      }
      const s = textOf(value, from).trim()
      return s ? (lookup(s)?.id ?? null) : null
    }
    case 'multi_select': {
      if (from.type === 'select') return findOption(to, value) ? [value as string] : null
      const ids: string[] = []
      for (const part of textOf(value, from).split(',')) {
        const o = part.trim() ? lookup(part) : undefined
        if (o && !ids.includes(o.id)) ids.push(o.id)
      }
      return ids.length ? ids : null
    }
    case 'date': {
      if (isDateValue(value)) return normalizeDateValue(value)
      if (typeof value === 'string') {
        // "start → end" is what a date range turns into as text.
        const [first, second] = value.split('→')
        const start = parseLooseDay(first)
        return start ? normalizeDateValue({ start, end: second ? (parseLooseDay(second) ?? undefined) : undefined }) : null
      }
      return null
    }
    default:
      // created_time / last_edited_time are computed, nothing is stored.
      return null
  }
}

/**
 * Changes a property's type. Returns the new schema plus, for every row whose
 * stored value changes, its complete new `values` object (ready for an update op).
 * The title property cannot change type and nothing can become a second title.
 *
 * Text becoming a select derives one option per distinct text, so no cell is lost.
 * A computed property (created / last edited time) has nothing stored: stale
 * leftovers under its id are dropped rather than converted.
 */
export function changePropertyType(
  schema: Schema,
  propertyId: string,
  type: PropertyType,
  rows: Block[] = []
): { schema: Schema; rowValues: Record<string, Values> } {
  const from = propOf(schema, propertyId)
  if (!from || from.type === 'title' || type === 'title' || from.type === type || !Object.hasOwn(TYPE_LABELS, type)) {
    return { schema, rowValues: {} }
  }
  const to: PropertySchema = { id: from.id, name: from.name, type }
  const fromStored = !isComputedType(from.type)
  let index: OptionIndex | undefined
  if (isSelectType(type)) {
    to.options = isSelectType(from.type) ? optionsOf(from).slice() : []
    index = indexOptions(to)
    if (!isSelectType(from.type) && fromStored) {
      for (const row of rows) {
        const text = textOf(getCellValue(row, from), from)
        for (const part of type === 'multi_select' ? text.split(',') : [text]) {
          const name = cleanName(part)
          const key = nameKey(name)
          if (!name || index.has(key)) continue
          const option: SelectOption = { id: makeId(), name, color: nextOptionColor(to.options) }
          to.options.push(option)
          index.set(key, option)
        }
      }
    }
  }
  if (type === 'number') to.numberFormat = from.numberFormat ?? 'number'

  const rowValues: Record<string, Values> = {}
  for (const row of rows) {
    const values = valuesOf(row)
    if (!Object.hasOwn(values, propertyId)) continue
    const stored = values[propertyId]
    const next = fromStored ? coerceValue(getCellValue(row, from), from, to, index) : null
    const nextValues = setValue(values, propertyId, next)
    if (!sameValue(nextValues[propertyId], stored)) rowValues[row.id] = nextValues
  }
  return { schema: { ...schema, [propertyId]: to }, rowValues }
}

/** Removes a property (never the title) and every reference to it in the views. */
export function deleteProperty(
  schema: Schema,
  views: DatabaseView[],
  propertyId: string
): { schema: Schema; views: DatabaseView[] } {
  const prop = propOf(schema, propertyId)
  if (!prop || prop.type === 'title') return { schema, views }
  const next: Schema = {}
  for (const id of Object.keys(schema)) if (id !== propertyId) next[id] = schema[id]
  return { schema: next, views: sanitizeViews(views, next) }
}

/** The row's `values` without the property, or undefined when it holds nothing for it. */
export function stripPropertyFromValues(row: Block, propertyId: string): Values | undefined {
  const values = valuesOf(row)
  if (!Object.hasOwn(values, propertyId)) return undefined
  const next = { ...values }
  delete next[propertyId]
  return next
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export function addOption(
  schema: Schema,
  propertyId: string,
  name: string,
  color?: string
): { schema: Schema; option: SelectOption | undefined } {
  const prop = propOf(schema, propertyId)
  const cleaned = cleanName(name)
  if (!prop || !cleaned || !isSelectType(prop.type)) return { schema, option: undefined }
  const existing = optionByName(prop, cleaned)
  if (existing) return { schema, option: existing }
  const options = optionsOf(prop)
  const option: SelectOption = { id: makeId(), name: cleaned, color: color ?? nextOptionColor(options) }
  return { schema: { ...schema, [propertyId]: { ...prop, options: [...options, option] } }, option }
}

/** Renames / recolours an option. A blank name, or one another option already has, is ignored. */
export function updateOption(
  schema: Schema,
  propertyId: string,
  optionId: string,
  patch: { name?: string; color?: string }
): Schema {
  const prop = propOf(schema, propertyId)
  const current = findOption(prop, optionId)
  if (!prop || !current) return schema
  let name = current.name
  const cleaned = patch.name === undefined ? '' : cleanName(patch.name)
  if (cleaned) {
    const clash = optionByName(prop, cleaned)
    if (!clash || clash.id === optionId) name = cleaned
  }
  const color = typeof patch.color === 'string' && patch.color ? patch.color : current.color
  if (name === current.name && color === current.color) return schema
  const options = optionsOf(prop).map((o) => (o.id === optionId ? { ...o, name, color } : o))
  return { ...schema, [propertyId]: { ...prop, options } }
}

export function deleteOption(schema: Schema, propertyId: string, optionId: string): Schema {
  const prop = propOf(schema, propertyId)
  if (!prop || !findOption(prop, optionId)) return schema
  return { ...schema, [propertyId]: { ...prop, options: optionsOf(prop).filter((o) => o.id !== optionId) } }
}

/** Removes a deleted option from the filter rules that mention it (the rule stays, without a value). */
export function stripOptionFromViews(views: DatabaseView[], propertyId: string, optionId: string): DatabaseView[] {
  let changed = false
  const next = views.map((view) => {
    let touched = false
    const filters = view.filters.map((filter) => {
      if (filter.propertyId !== propertyId) return filter
      const value = filter.value
      if (value === optionId) {
        touched = true
        return { propertyId: filter.propertyId, operator: filter.operator }
      }
      if (Array.isArray(value) && value.includes(optionId)) {
        touched = true
        const rest = value.filter((id) => id !== optionId)
        return rest.length ? { ...filter, value: rest } : { propertyId: filter.propertyId, operator: filter.operator }
      }
      return filter
    })
    if (!touched) return view
    changed = true
    return { ...view, filters }
  })
  return changed ? next : views
}

/** The row's `values` without the option, or undefined when the row does not use it. */
export function stripOptionFromValues(row: Block, propertyId: string, optionId: string): Values | undefined {
  const values = valuesOf(row)
  const raw: unknown = Object.hasOwn(values, propertyId) ? values[propertyId] : undefined
  if (raw === optionId) return setValue(values, propertyId, null)
  if (Array.isArray(raw) && raw.includes(optionId)) {
    return setValue(
      values,
      propertyId,
      raw.filter((id) => id !== optionId)
    )
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Views that need a property
// ---------------------------------------------------------------------------

/**
 * Adds a view. Board and calendar views need a select / date property to
 * group by: one is created when the schema has none.
 */
export function addView(
  schema: Schema,
  views: DatabaseView[],
  type: ViewType,
  name?: string
): { schema: Schema; views: DatabaseView[]; view: DatabaseView } {
  let nextSchema = schema
  if (type === 'board' && !firstPropertyOfType(schema, 'select')) {
    nextSchema = addProperty(schema, {
      name: 'Status',
      type: 'select',
      options: [
        { id: makeId(), name: 'To do', color: 'gray' },
        { id: makeId(), name: 'In progress', color: 'blue' },
        { id: makeId(), name: 'Done', color: 'green' }
      ]
    }).schema
  }
  if (type === 'calendar' && !firstPropertyOfType(schema, 'date')) {
    nextSchema = addProperty(schema, { name: 'Date', type: 'date' }).schema
  }
  const viewName = uniqueName(
    views.map((v) => v.name),
    cleanName(name) || VIEW_LABELS[type]
  )
  const view = createDefaultView(type, nextSchema, makeId(), viewName)
  return { schema: nextSchema, views: [...views, view], view }
}
