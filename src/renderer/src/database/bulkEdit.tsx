// The "Edit" menu of the table's selection bar: one property, one value, every selected row.
import type { JSX } from 'react'
import type { PropertySchema, SelectOption } from '@shared/types'
import type { MenuItem } from '@/ui/Menu'
import * as L from './logic'
import * as actions from './actions'
import { TypeIcon, tagStyle } from './common'

function Swatch({ option }: { option: SelectOption }): JSX.Element {
  return <span className="db-bulk-swatch" style={tagStyle(option.color)} />
}

function valueItems(prop: PropertySchema, apply: (change: L.BulkChange) => void): MenuItem[] {
  const clear: MenuItem = { id: 'clear', label: 'Clear', onSelect: () => apply({ kind: 'clear' }) }
  const options = L.optionsOf(prop)
  switch (prop.type) {
    case 'select':
      return [
        ...options.map<MenuItem>((option) => ({
          id: `set-${option.id}`,
          label: option.name,
          icon: <Swatch option={option} />,
          onSelect: () => apply({ kind: 'set', value: option.id })
        })),
        ...(options.length ? [{ separator: true as const }] : []),
        clear
      ]
    case 'multi_select':
      return [
        ...(options.length ? [{ header: 'Add' }] : []),
        ...options.map<MenuItem>((option) => ({
          id: `add-${option.id}`,
          label: option.name,
          icon: <Swatch option={option} />,
          onSelect: () => apply({ kind: 'add', optionId: option.id })
        })),
        ...(options.length ? [{ header: 'Remove' }] : []),
        ...options.map<MenuItem>((option) => ({
          id: `remove-${option.id}`,
          label: option.name,
          icon: <Swatch option={option} />,
          onSelect: () => apply({ kind: 'remove', optionId: option.id })
        })),
        ...(options.length ? [{ separator: true as const }] : []),
        { ...clear, label: 'Remove all' }
      ]
    case 'checkbox':
      return [
        { id: 'check', label: 'Checked', onSelect: () => apply({ kind: 'set', value: true }) },
        { id: 'uncheck', label: 'Unchecked', onSelect: () => apply({ kind: 'set', value: false }) }
      ]
    case 'date': {
      // Moving a date keeps its time of day and the length of a range.
      const today = L.todayISO()
      return [
        { id: 'today', label: 'Today', onSelect: () => apply({ kind: 'day', day: today }) },
        { id: 'tomorrow', label: 'Tomorrow', onSelect: () => apply({ kind: 'day', day: L.addDays(today, 1) }) },
        { id: 'next-week', label: 'In a week', onSelect: () => apply({ kind: 'day', day: L.addDays(today, 7) }) },
        { separator: true },
        clear
      ]
    }
    default:
      return [clear]
  }
}

/** One entry per property a bulk edit can change, each opening the values it can be given. */
export function bulkEditItems(schema: L.Schema, rowIds: () => string[]): MenuItem[] {
  const props = L.orderedProperties(schema).filter(L.isBulkEditable)
  if (!props.length) return [{ id: 'none', label: 'No property to edit', disabled: true }]
  return [
    { header: 'Set for the selected rows' },
    ...props.map<MenuItem>((prop) => ({
      id: prop.id,
      label: prop.name,
      icon: <TypeIcon type={prop.type} />,
      submenu: valueItems(prop, (change) => actions.editCells(rowIds(), prop, change))
    }))
  ]
}
