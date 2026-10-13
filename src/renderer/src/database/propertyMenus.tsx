import { useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DatabaseView, PropertySchema, PropertyType } from '@shared/types'
import { Menu, type MenuItem } from '@/ui/Menu'
import type { PopoverAnchor, PopoverPlacement } from '@/ui/Popover'
import { Check, Filter, Sort, Trash } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { Floating, TypeIcon } from './common'
import { useCommitOnUnmount } from './hooks'

const NUMBER_FORMATS: { id: NonNullable<PropertySchema['numberFormat']>; label: string }[] = [
  { id: 'number', label: 'Number' },
  { id: 'percent', label: 'Percent' },
  { id: 'currency', label: 'Currency' }
]

/** Popover listing the property types; picking one adds a property. */
export function AddPropertyMenu({
  databaseId,
  viewId,
  anchor,
  placement,
  onClose,
  onAdded
}: {
  databaseId: string
  /** View in which the new property becomes visible. */
  viewId?: string
  anchor: PopoverAnchor
  placement?: PopoverPlacement
  onClose: () => void
  onAdded?: (propertyId: string) => void
}): JSX.Element {
  const items: MenuItem[] = [
    { header: 'Property type' },
    ...L.PROPERTY_TYPES.map<MenuItem>((type) => ({
      id: type,
      label: L.TYPE_LABELS[type],
      icon: <TypeIcon type={type} />,
      onSelect: () => {
        // Not `onAdded?.(addProperty(...))`: without a listener that would skip the add itself.
        const id = actions.addProperty(databaseId, type, viewId)
        onAdded?.(id)
      }
    }))
  ]
  return (
    <Floating open anchor={anchor} placement={placement} onClose={onClose}>
      <Menu items={items} onClose={onClose} autoFocus />
    </Floating>
  )
}

/** Property header menu: rename, type, sort, filter, hide, delete. */
export function PropertyMenu({
  databaseId,
  prop,
  view,
  anchor,
  placement,
  onClose,
  onFilter
}: {
  databaseId: string
  prop: PropertySchema
  /** When omitted (row page), the view-specific entries are hidden. */
  view?: DatabaseView
  anchor: PopoverAnchor
  placement?: PopoverPlacement
  onClose: () => void
  onFilter?: (propertyId: string) => void
}): JSX.Element {
  const [name, setName] = useState(prop.name)
  const isTitle = prop.type === 'title'

  // Only a name the user typed is written (and only once): an untouched input
  // never overwrites a rename that arrived from elsewhere in the meantime.
  const dirty = useRef(false)
  const commitName = (): void => {
    if (!dirty.current) return
    dirty.current = false
    actions.renameProperty(databaseId, prop.id, name)
  }
  // The menu can be removed without `onClose` (its property or view went away).
  useCommitOnUnmount(commitName)

  const typeItems: MenuItem[] = L.PROPERTY_TYPES.map((type: PropertyType) => ({
    id: `type-${type}`,
    label: L.TYPE_LABELS[type],
    icon: <TypeIcon type={type} />,
    hint: prop.type === type ? '✓' : undefined,
    onSelect: () => actions.changePropertyType(databaseId, prop.id, type)
  }))

  const items: MenuItem[] = [
    {
      id: 'type',
      label: `Type: ${L.TYPE_LABELS[prop.type]}`,
      icon: <TypeIcon type={prop.type} />,
      disabled: isTitle,
      submenu: isTitle ? undefined : typeItems
    }
  ]
  if (prop.type === 'number') {
    items.push({
      id: 'format',
      label: 'Number format',
      submenu: NUMBER_FORMATS.map((format) => ({
        id: `format-${format.id}`,
        label: format.label,
        icon: (prop.numberFormat ?? 'number') === format.id ? <Check size={14} /> : <span />,
        onSelect: () => actions.updateProperty(databaseId, prop.id, { numberFormat: format.id })
      }))
    })
  }
  if (view) {
    items.push(
      { separator: true },
      {
        id: 'sort-asc',
        label: 'Sort ascending',
        icon: <Sort size={14} />,
        onSelect: () => actions.patchView(databaseId, view.id, (v) => L.setSort(v, prop.id, 'asc'))
      },
      {
        id: 'sort-desc',
        label: 'Sort descending',
        icon: <Sort size={14} />,
        onSelect: () => actions.patchView(databaseId, view.id, (v) => L.setSort(v, prop.id, 'desc'))
      }
    )
    if (onFilter) {
      items.push({ id: 'filter', label: 'Filter', icon: <Filter size={14} />, onSelect: () => onFilter(prop.id) })
    }
    items.push({
      id: 'hide',
      label: 'Hide in view',
      disabled: isTitle,
      onSelect: () => actions.patchView(databaseId, view.id, (v, schema) => L.setPropertyVisible(v, schema, prop.id, false))
    })
  }
  items.push(
    { separator: true },
    {
      id: 'delete',
      label: 'Delete property',
      icon: <Trash size={14} />,
      danger: true,
      disabled: isTitle,
      onSelect: () => actions.deleteProperty(databaseId, prop.id)
    }
  )

  const close = (): void => {
    commitName()
    onClose()
  }

  return (
    <Floating open anchor={anchor} placement={placement} onClose={close}>
      <div className="db-prop-menu">
        <div className="db-prop-menu-name">
          <input
            className="ui-input"
            value={name}
            autoFocus
            aria-label="Property name"
            onFocus={(event) => event.target.select()}
            maxLength={L.MAX_NAME_LENGTH}
            onChange={(event) => {
              dirty.current = true
              setName(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                close()
              }
            }}
          />
        </div>
        <Menu items={items} onClose={close} />
      </div>
    </Floating>
  )
}
