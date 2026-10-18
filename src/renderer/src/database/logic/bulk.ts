// Editing one property of many rows at once (the table's selection bar).
import type { PropertySchema, PropertyType, PropertyValue } from '../../../../shared/types'
import { dayKey, isDateValue, shiftDateValue } from './dates'
import { findOption } from './values'

/**
 * What a bulk edit does to each selected row's cell. `day` moves a date to that day,
 * keeping its time of day and the length of a range; an empty cell gets just the day.
 */
export type BulkChange =
  | { kind: 'clear' }
  | { kind: 'set'; value: PropertyValue }
  | { kind: 'add'; optionId: string }
  | { kind: 'remove'; optionId: string }
  | { kind: 'day'; day: string }

const BULK_TYPES: ReadonlySet<PropertyType> = new Set(['select', 'multi_select', 'checkbox', 'date', 'text', 'url', 'number'])

/** Properties a bulk edit can change: stored values only (no title, relation or computed property). */
export function isBulkEditable(prop: PropertySchema): boolean {
  return BULK_TYPES.has(prop.type)
}

/** The value a cell gets from a bulk change, or `current` when the change does not apply to it. */
export function bulkValue(prop: PropertySchema, current: PropertyValue, change: BulkChange): PropertyValue {
  if (!isBulkEditable(prop)) return current
  switch (change.kind) {
    case 'clear':
      return prop.type === 'checkbox' ? false : null
    case 'set':
      if (prop.type === 'checkbox') return change.value === true
      if (prop.type === 'select') return findOption(prop, change.value) ? change.value : current
      return current
    case 'add':
    case 'remove': {
      if (prop.type !== 'multi_select' || !findOption(prop, change.optionId)) return current
      const have = Array.isArray(current) ? current : []
      if (change.kind === 'add') return have.includes(change.optionId) ? current : [...have, change.optionId]
      return have.includes(change.optionId) ? have.filter((id) => id !== change.optionId) : current
    }
    case 'day': {
      const day = dayKey(change.day)
      if (prop.type !== 'date' || !day) return current
      return isDateValue(current) && dayKey(current.start) ? shiftDateValue(current, day) : { start: day }
    }
  }
}
