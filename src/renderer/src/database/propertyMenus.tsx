import { Suspense, useRef, useState } from 'react'
import type { JSX } from 'react'
import { systemKindOf } from '@shared/system'
import { isTaskCoreProperty } from '@shared/tasks'
import { RELATIVE_DATES } from '@shared/types'
import type { DatabaseView, PropertySchema, PropertyType, ViewFilter } from '@shared/types'
import { Menu, type MenuItem } from '@/ui/Menu'
import type { PopoverAnchor, PopoverPlacement } from '@/ui/Popover'
import { ArrowUpRight, Check, Filter, Formula, Sigma, Sort, Trash } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { Floating, TypeIcon } from './common'
import { useCommitOnUnmount } from './hooks'
import { FormulaEditor, PartFallback, RelationTargetPicker } from './lazyParts'
import { useRelated } from './related'

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
  // A relation needs its database first: the menu turns into the database picker.
  const [pickingTarget, setPickingTarget] = useState(false)
  // A new formula opens its editor in place of the menu.
  const [formulaId, setFormulaId] = useState<string | null>(null)
  // The menu closes itself after a pick; the relation entry replaces it instead.
  const keepOpen = useRef(false)
  const items: MenuItem[] = [
    { header: 'Property type' },
    ...L.PROPERTY_TYPES.map<MenuItem>((type) => ({
      id: type,
      label: L.TYPE_LABELS[type],
      icon: <TypeIcon type={type} />,
      onSelect: () => {
        if (type === 'relation') {
          keepOpen.current = true
          setPickingTarget(true)
          return
        }
        // Not `onAdded?.(addProperty(...))`: without a listener that would skip the add itself.
        const id = actions.addProperty(databaseId, type, viewId)
        if (type === 'formula') {
          keepOpen.current = true
          setFormulaId(id)
        }
        onAdded?.(id)
      }
    }))
  ]
  const formulaProp = formulaId ? L.propOf(actions.snapshot(databaseId).schema, formulaId) : undefined
  return (
    <Floating open anchor={anchor} placement={placement} onClose={onClose}>
      {formulaProp ? (
        <Suspense fallback={<PartFallback kind="popover" />}>
          <FormulaEditor databaseId={databaseId} prop={formulaProp} onClose={onClose} />
        </Suspense>
      ) : pickingTarget ? (
        <Suspense fallback={<PartFallback kind="popover" />}>
          <RelationTargetPicker
            databaseId={databaseId}
            onPick={(targetId) => {
              const id = actions.addRelation(databaseId, targetId, viewId)
              if (id) onAdded?.(id)
              onClose()
            }}
          />
        </Suspense>
      ) : (
        <Menu
          items={items}
          onClose={() => {
            if (!keepOpen.current) onClose()
          }}
          autoFocus
        />
      )}
    </Floating>
  )
}

/** The menu entries that configure a relation: its database, how many pages it links, and the other side. */
function relationItems(
  databaseId: string,
  prop: PropertySchema,
  cells: L.CellContext | undefined,
  onPickTarget: () => void
): MenuItem[] {
  const config = L.relationOf(prop)
  const targetTitle = config ? L.titleOf(cells?.get(config.databaseId)) || 'Untitled' : ''
  const state = config && cells ? L.relatedDatabaseState(config.databaseId, cells) : 'loading'
  const ownId = actions.rowsOwnerId(databaseId)
  const twoWay = !!config && !!cells && L.partnerOf(config, prop.id, ownId, cells.schemaOf(config.databaseId)) !== undefined
  const items: MenuItem[] = [
    { separator: true },
    {
      id: 'relation-target',
      label: config ? `Related to: ${state === 'missing' ? 'a deleted database' : targetTitle}` : 'Choose a database…',
      icon: <ArrowUpRight size={14} />,
      hint: state === 'trashed' ? 'In the trash' : undefined,
      onSelect: onPickTarget
    }
  ]
  if (!config) return items
  items.push(
    {
      id: 'relation-limit',
      label: config.limit === 'one' ? 'Limit: 1 page' : 'Limit: no limit',
      submenu: [
        {
          id: 'limit-many',
          label: 'No limit',
          icon: config.limit !== 'one' ? <Check size={14} /> : <span />,
          onSelect: () => actions.setRelationLimit(databaseId, prop.id, undefined)
        },
        {
          id: 'limit-one',
          label: '1 page',
          icon: config.limit === 'one' ? <Check size={14} /> : <span />,
          onSelect: () => actions.setRelationLimit(databaseId, prop.id, 'one')
        }
      ]
    },
    {
      id: 'relation-two-way',
      label: config.databaseId === ownId ? 'Two-way: show the other side here too' : `Two-way: show on ${targetTitle}`,
      icon: twoWay ? <Check size={14} /> : <span />,
      disabled: state !== 'ok',
      onSelect: () => actions.setRelationTwoWay(databaseId, prop.id, !twoWay)
    }
  )
  return items
}

/** The menu entries that configure a rollup: which relation, which of the related properties, and how to sum them up. */
function rollupItems(databaseId: string, prop: PropertySchema, schema: L.Schema, cells: L.CellContext | undefined): MenuItem[] {
  const resolved = cells ? L.resolveRollup(prop, schema, cells) : undefined
  const config = prop.rollup ?? L.DEFAULT_ROLLUP
  const relations = L.orderedProperties(schema).filter((p) => p.type === 'relation')
  const targetSchema = resolved?.relation?.relation ? cells?.schemaOf(resolved.relation.relation.databaseId) : undefined
  const sources = targetSchema ? L.orderedProperties(targetSchema).filter(L.isRollupSource) : []
  const functions = L.rollupFunctionsFor(resolved?.target)
  const check = (on: boolean): JSX.Element => (on ? <Check size={14} /> : <span />)
  return [
    { separator: true },
    {
      id: 'rollup-relation',
      label: `Relation: ${resolved?.relation?.name ?? 'none'}`,
      icon: <ArrowUpRight size={14} />,
      disabled: !relations.length,
      hint: relations.length ? undefined : 'Add a relation first',
      submenu: relations.map((p) => ({
        id: `rollup-relation-${p.id}`,
        label: p.name,
        icon: check(p.id === config.relationId),
        onSelect: () => actions.updateRollup(databaseId, prop.id, { relationId: p.id })
      }))
    },
    {
      id: 'rollup-property',
      label: `Property: ${resolved?.target?.name ?? 'none'}`,
      disabled: !sources.length,
      submenu: sources.map((p) => ({
        id: `rollup-property-${p.id}`,
        label: p.name,
        icon: <TypeIcon type={p.type} />,
        hint: p.id === config.propertyId ? '✓' : undefined,
        onSelect: () => {
          const fits = L.rollupFunctionsFor(p)
          actions.updateRollup(databaseId, prop.id, {
            propertyId: p.id,
            function: fits.includes(config.function) ? config.function : 'show_original'
          })
        }
      }))
    },
    {
      id: 'rollup-function',
      label: `Calculate: ${L.ROLLUP_LABELS[config.function]}`,
      icon: <Sigma size={14} />,
      submenu: functions.map((fn) => ({
        id: `rollup-function-${fn}`,
        label: L.ROLLUP_LABELS[fn],
        icon: check(fn === config.function),
        onSelect: () => actions.updateRollup(databaseId, prop.id, { function: fn })
      }))
    },
    rollupRowsItem(databaseId, prop, targetSchema, sources)
  ]
}

/** One rule a rollup keeps rows by, in words: "Date: This month", "Group: Needs". */
function rollupRuleText(rule: ViewFilter, schema: L.Schema): string {
  const target = L.propOf(schema, rule.propertyId)
  if (!target) return ''
  if (rule.operator === 'date_is' && L.isRelativeDate(rule.value)) return `${target.name}: ${L.relativeDateLabel(rule.value)}`
  if (rule.operator === 'checked' || rule.operator === 'unchecked') return `${target.name}: ${rule.operator === 'checked' ? 'checked' : 'unchecked'}`
  const option = typeof rule.value === 'string' ? L.optionsOf(target).find((o) => o.id === rule.value) : undefined
  return `${target.name} ${L.operatorLabel(rule.operator, target.type).toLowerCase()} ${option?.name ?? (rule.value === undefined ? '' : String(rule.value))}`.trim()
}

/**
 * The menu entry that limits which linked rows a rollup counts: all of them, or those whose
 * date falls in a span ("this month"), whose option is one, or whose box is checked.
 */
function rollupRowsItem(databaseId: string, prop: PropertySchema, targetSchema: L.Schema | undefined, sources: PropertySchema[]): MenuItem {
  const config = prop.rollup ?? L.DEFAULT_ROLLUP
  const rules = L.rollupFilters(config, targetSchema)
  const keepOnly = (rule: ViewFilter): void => actions.updateRollup(databaseId, prop.id, { filters: [rule] })
  const isOnly = (rule: ViewFilter): boolean =>
    rules.length === 1 && rules[0].propertyId === rule.propertyId && rules[0].operator === rule.operator && rules[0].value === rule.value
  const choice = (id: string, label: string, rule: ViewFilter): MenuItem => ({
    id,
    label,
    icon: isOnly(rule) ? <Check size={14} /> : <span />,
    onSelect: () => keepOnly(rule)
  })
  const choicesFor = (p: PropertySchema): MenuItem[] => {
    if (L.isDateLikeType(p.type)) {
      return RELATIVE_DATES.map((span) => choice(`rollup-rows-${p.id}-${span}`, L.relativeDateLabel(span), { propertyId: p.id, operator: 'date_is', value: span }))
    }
    if (p.type === 'checkbox') {
      return (['checked', 'unchecked'] as const).map((operator) =>
        choice(`rollup-rows-${p.id}-${operator}`, operator === 'checked' ? 'Checked' : 'Unchecked', { propertyId: p.id, operator })
      )
    }
    return L.optionsOf(p).map((o) =>
      choice(`rollup-rows-${p.id}-${o.id}`, o.name, { propertyId: p.id, operator: p.type === 'select' ? 'equals' : 'contains', value: o.id })
    )
  }
  const keys = sources.filter((p) => L.isDateLikeType(p.type) || p.type === 'checkbox' || p.type === 'select' || p.type === 'multi_select')
  const label = targetSchema && rules.length ? rules.map((rule) => rollupRuleText(rule, targetSchema)).join(', ') : 'All'
  return {
    id: 'rollup-rows',
    label: `Rows: ${label}`,
    icon: <Filter size={14} />,
    disabled: !keys.length,
    hint: keys.length ? undefined : 'Nothing to keep rows by',
    submenu: [
      {
        id: 'rollup-rows-all',
        label: 'All linked rows',
        icon: rules.length ? <span /> : <Check size={14} />,
        onSelect: () => actions.updateRollup(databaseId, prop.id, { filters: undefined })
      },
      { separator: true },
      ...keys.map((p) => ({ id: `rollup-rows-${p.id}`, label: p.name, icon: <TypeIcon type={p.type} />, submenu: choicesFor(p) }))
    ]
  }
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
  // A property the built-in Tasks database is read by keeps its type and stays (the repository refuses too).
  const locked = isTitle || (isTaskCoreProperty(prop.id) && systemKindOf(actions.snapshot(databaseId).source) === 'tasks')
  const { cells } = useRelated()
  /**
   * The database picker replaces the menu: to point a relation elsewhere, or to turn the
   * property into one. So does the formula editor.
   */
  const [picking, setPicking] = useState<'target' | 'type' | 'formula' | null>(null)
  const keepOpen = useRef(false)
  const pick = (mode: 'target' | 'type' | 'formula'): void => {
    keepOpen.current = true
    setPicking(mode)
  }

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
    onSelect: () => {
      if (type === 'relation' && prop.type !== 'relation') pick('type')
      else {
        actions.changePropertyType(databaseId, prop.id, type)
        // A new formula is written straight away.
        if (type === 'formula' && prop.type !== 'formula') pick('formula')
      }
    }
  }))

  const items: MenuItem[] = [
    {
      id: 'type',
      label: `Type: ${L.TYPE_LABELS[prop.type]}`,
      icon: <TypeIcon type={prop.type} />,
      disabled: locked,
      submenu: locked ? undefined : typeItems
    }
  ]
  // A formula that gives a number is written in a number format too (ignored for other results).
  if (prop.type === 'number' || prop.type === 'formula') {
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
  if (prop.type === 'relation') items.push(...relationItems(databaseId, prop, cells, () => pick('target')))
  if (prop.type === 'rollup') items.push(...rollupItems(databaseId, prop, actions.snapshot(databaseId).schema, cells))
  if (prop.type === 'formula') {
    items.push({ separator: true }, { id: 'formula-edit', label: 'Edit formula…', icon: <Formula size={14} />, onSelect: () => pick('formula') })
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
      disabled: locked,
      onSelect: () => actions.deleteProperty(databaseId, prop.id)
    }
  )

  const close = (): void => {
    commitName()
    onClose()
  }

  if (picking === 'formula') {
    return (
      <Floating open anchor={anchor} placement={placement} onClose={close}>
        <Suspense fallback={<PartFallback kind="popover" />}>
          <FormulaEditor databaseId={databaseId} prop={prop} onClose={close} />
        </Suspense>
      </Floating>
    )
  }

  if (picking) {
    return (
      <Floating open anchor={anchor} placement={placement} onClose={close}>
        <Suspense fallback={<PartFallback kind="popover" />}>
          <RelationTargetPicker
            databaseId={databaseId}
            onPick={(targetId) => {
              if (picking === 'type') actions.changePropertyType(databaseId, prop.id, 'relation', targetId)
              else actions.setRelationTarget(databaseId, prop.id, targetId)
              close()
            }}
          />
        </Suspense>
      </Floating>
    )
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
        <Menu
          items={items}
          onClose={() => {
            if (!keepOpen.current) close()
          }}
        />
      </div>
    </Floating>
  )
}
