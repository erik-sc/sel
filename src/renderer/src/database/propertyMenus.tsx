import { Suspense, useId, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { systemKindOf } from '@shared/system'
import { TASK_PROPS, isTaskCoreProperty } from '@shared/tasks'
import { RELATIVE_DATES } from '@shared/types'
import type { DatabaseView, PropertySchema, PropertyType, ViewFilter } from '@shared/types'
import { announce } from '@/a11y/announce'
import { Menu, type MenuItem } from '@/ui/Menu'
import type { PopoverAnchor, PopoverPlacement } from '@/ui/Popover'
import { ArrowUpRight, Check, Filter, Formula, InsertLeft, InsertRight, Sigma, Sort, Trash } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { Floating, TypeIcon } from './common'
import { type DatabaseCopy, useDatabaseCopy } from './copy'
import { useCommitOnUnmount } from './hooks'
import { FormulaEditor, PartFallback, RelationTargetPicker } from './lazyParts'
import { OptionList, type OptionFocus } from './optionList'
import { useRelated } from './related'
import { OptionEditPane } from './SelectEditor'

const NUMBER_FORMATS: NonNullable<PropertySchema['numberFormat']>[] = ['number', 'percent', 'currency']

type MenuCopy = DatabaseCopy['propertyMenu']

/**
 * Popover that adds a property: its name in a field on top (focused), then the list of types.
 * Picking a type adds a property of that type with the typed name, or with the type's name in the
 * home's language when nothing is typed; Enter in the field adds a text property. A relation asks
 * for its database first, a formula opens its editor: both keep the typed name.
 */
export function AddPropertyMenu({
  databaseId,
  viewId,
  anchor,
  placement,
  before,
  onClose,
  onAdded
}: {
  databaseId: string
  /** View in which the new property becomes visible. */
  viewId?: string
  anchor: PopoverAnchor
  /** In that view, the property it goes before (a table header's "Insert left / right"); the end when omitted. */
  before?: string
  placement?: PopoverPlacement
  onClose: () => void
  onAdded?: (propertyId: string) => void
}): JSX.Element {
  const copy = useDatabaseCopy()
  const [name, setName] = useState('')
  // A relation needs its database first: the menu turns into the database picker.
  const [pickingTarget, setPickingTarget] = useState(false)
  // A new formula opens its editor in place of the menu.
  const [formulaId, setFormulaId] = useState<string | null>(null)
  // The menu closes itself after a pick; the relation entry replaces it instead.
  const keepOpen = useRef(false)
  const fieldRef = useRef<HTMLInputElement>(null)
  // Bumped to draw the list again: focused, with its first type active (ArrowDown in the field),
  // or with nothing active (back in the field).
  const [listTurn, setListTurn] = useState({ key: 0, focus: false })
  const hintId = useId()
  const typed = name.trim()

  const added = (id: string): void => {
    const prop = L.propOf(actions.snapshot(databaseId).schema, id)
    if (prop) announce(copy.addProperty.added(prop.name))
    onAdded?.(id)
  }
  const add = (type: PropertyType): string => {
    const id = actions.addProperty(databaseId, type, viewId, typed || copy.types[type], { before })
    added(id)
    return id
  }

  const items: MenuItem[] = [
    { header: copy.addProperty.typeHeader },
    ...L.PROPERTY_TYPES.map<MenuItem>((type) => ({
      id: type,
      label: copy.types[type],
      icon: <TypeIcon type={type} />,
      onSelect: () => {
        if (type === 'relation') {
          keepOpen.current = true
          setPickingTarget(true)
          return
        }
        const id = add(type)
        if (type === 'formula') {
          keepOpen.current = true
          setFormulaId(id)
        }
      }
    }))
  ]
  const formulaProp = formulaId ? L.propOf(actions.snapshot(databaseId).schema, formulaId) : undefined
  return (
    <Floating open anchor={anchor} placement={placement} label={copy.addProperty.label} onClose={onClose}>
      {formulaProp ? (
        <Suspense fallback={<PartFallback kind="popover" />}>
          <FormulaEditor databaseId={databaseId} prop={formulaProp} onClose={onClose} />
        </Suspense>
      ) : pickingTarget ? (
        <Suspense fallback={<PartFallback kind="popover" />}>
          <RelationTargetPicker
            databaseId={databaseId}
            onPick={(targetId) => {
              const id = actions.addRelation(databaseId, targetId, viewId, typed || undefined, before)
              if (id) added(id)
              onClose()
            }}
          />
        </Suspense>
      ) : (
        <div className="db-prop-menu db-add-prop-menu">
          <div className="db-prop-menu-name">
            <input
              ref={fieldRef}
              className="ui-input"
              value={name}
              autoFocus
              placeholder={copy.addProperty.nameLabel}
              aria-label={copy.addProperty.nameLabel}
              aria-describedby={typed ? hintId : undefined}
              maxLength={L.MAX_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'ArrowDown' || (event.key === 'Enter' && !typed)) {
                  event.preventDefault()
                  setListTurn((turn) => ({ key: turn.key + 1, focus: true }))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  add('text')
                  onClose()
                }
              }}
            />
            {/* Its line is kept while hidden, so the list does not move when the first letter is typed. */}
            <div className={typed ? 'db-add-prop-hint' : 'db-add-prop-hint is-hidden'} id={hintId} aria-hidden={!typed || undefined}>
              {copy.addProperty.enterHint}
            </div>
          </div>
          <Menu
            key={listTurn.key}
            items={items}
            autoFocus={listTurn.focus}
            onExitStart={() => {
              const field = fieldRef.current
              if (!field) return
              field.focus()
              field.setSelectionRange(field.value.length, field.value.length)
            }}
            onClose={() => {
              if (!keepOpen.current) onClose()
            }}
          />
        </div>
      )}
    </Floating>
  )
}

/** The menu entries that configure a relation: its database, how many pages it links, and the other side. */
function relationItems(
  databaseId: string,
  prop: PropertySchema,
  cells: L.CellContext | undefined,
  onPickTarget: () => void,
  copy: MenuCopy
): MenuItem[] {
  const config = L.relationOf(prop)
  const targetTitle = config ? L.titleOf(cells?.get(config.databaseId)) || copy.untitled : ''
  const state = config && cells ? L.relatedDatabaseState(config.databaseId, cells) : 'loading'
  const ownId = actions.rowsOwnerId(databaseId)
  const twoWay = !!config && !!cells && L.partnerOf(config, prop.id, ownId, cells.schemaOf(config.databaseId)) !== undefined
  const items: MenuItem[] = [
    { separator: true },
    {
      id: 'relation-target',
      label: config ? copy.relatedTo(state === 'missing' ? copy.deletedDatabase : targetTitle) : copy.chooseDatabase,
      icon: <ArrowUpRight size={14} />,
      hint: state === 'trashed' ? copy.inTrash : undefined,
      onSelect: onPickTarget
    }
  ]
  if (!config) return items
  items.push(
    {
      id: 'relation-limit',
      label: config.limit === 'one' ? copy.limitOne : copy.limitNone,
      submenu: [
        {
          id: 'limit-many',
          label: copy.noLimit,
          icon: config.limit !== 'one' ? <Check size={14} /> : <span />,
          onSelect: () => actions.setRelationLimit(databaseId, prop.id, undefined)
        },
        {
          id: 'limit-one',
          label: copy.onePage,
          icon: config.limit === 'one' ? <Check size={14} /> : <span />,
          onSelect: () => actions.setRelationLimit(databaseId, prop.id, 'one')
        }
      ]
    },
    {
      id: 'relation-two-way',
      label: config.databaseId === ownId ? copy.twoWayHere : copy.twoWayOn(targetTitle),
      icon: twoWay ? <Check size={14} /> : <span />,
      disabled: state !== 'ok',
      onSelect: () => actions.setRelationTwoWay(databaseId, prop.id, !twoWay)
    }
  )
  return items
}

/** The menu entries that configure a rollup: which relation, which of the related properties, and how to sum them up. */
function rollupItems(
  databaseId: string,
  prop: PropertySchema,
  schema: L.Schema,
  cells: L.CellContext | undefined,
  copy: MenuCopy
): MenuItem[] {
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
      label: copy.relation(resolved?.relation?.name ?? copy.none),
      icon: <ArrowUpRight size={14} />,
      disabled: !relations.length,
      hint: relations.length ? undefined : copy.addRelationFirst,
      submenu: relations.map((p) => ({
        id: `rollup-relation-${p.id}`,
        label: p.name,
        icon: check(p.id === config.relationId),
        onSelect: () => actions.updateRollup(databaseId, prop.id, { relationId: p.id })
      }))
    },
    {
      id: 'rollup-property',
      label: copy.property(resolved?.target?.name ?? copy.none),
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
      label: copy.calculate(copy.functions[config.function]),
      icon: <Sigma size={14} />,
      submenu: functions.map((fn) => ({
        id: `rollup-function-${fn}`,
        label: copy.functions[fn],
        icon: check(fn === config.function),
        onSelect: () => actions.updateRollup(databaseId, prop.id, { function: fn })
      }))
    },
    rollupRowsItem(databaseId, prop, targetSchema, sources, copy)
  ]
}

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** One rule a rollup keeps rows by, in words: "Date: This month", "Group: Needs". */
function rollupRuleText(rule: ViewFilter, schema: L.Schema, copy: MenuCopy): string {
  const target = L.propOf(schema, rule.propertyId)
  if (!target) return ''
  if (rule.operator === 'date_is' && L.isRelativeDate(rule.value)) return `${target.name}: ${L.relativeDateLabel(rule.value)}`
  if (rule.operator === 'checked' || rule.operator === 'unchecked')
    return `${target.name}: ${rule.operator === 'checked' ? copy.checked : copy.unchecked}`
  const option = typeof rule.value === 'string' ? L.optionsOf(target).find((o) => o.id === rule.value) : undefined
  return `${target.name} ${L.operatorLabel(rule.operator, target.type).toLowerCase()} ${option?.name ?? (rule.value === undefined ? '' : String(rule.value))}`.trim()
}

/**
 * The menu entry that limits which linked rows a rollup counts: all of them, or those whose
 * date falls in a span ("this month"), whose option is one, or whose box is checked.
 */
function rollupRowsItem(
  databaseId: string,
  prop: PropertySchema,
  targetSchema: L.Schema | undefined,
  sources: PropertySchema[],
  copy: MenuCopy
): MenuItem {
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
      return RELATIVE_DATES.map((span) =>
        choice(`rollup-rows-${p.id}-${span}`, L.relativeDateLabel(span), { propertyId: p.id, operator: 'date_is', value: span })
      )
    }
    if (p.type === 'checkbox') {
      return (['checked', 'unchecked'] as const).map((operator) =>
        choice(`rollup-rows-${p.id}-${operator}`, capitalized(operator === 'checked' ? copy.checked : copy.unchecked), {
          propertyId: p.id,
          operator
        })
      )
    }
    return L.optionsOf(p).map((o) =>
      choice(`rollup-rows-${p.id}-${o.id}`, o.name, {
        propertyId: p.id,
        operator: p.type === 'select' ? 'equals' : 'contains',
        value: o.id
      })
    )
  }
  const keys = sources.filter((p) => L.isDateLikeType(p.type) || p.type === 'checkbox' || p.type === 'select' || p.type === 'multi_select')
  const label = targetSchema && rules.length ? rules.map((rule) => rollupRuleText(rule, targetSchema, copy)).join(', ') : copy.allRows
  return {
    id: 'rollup-rows',
    label: copy.rows(label),
    icon: <Filter size={14} />,
    disabled: !keys.length,
    hint: keys.length ? undefined : copy.nothingToKeepBy,
    submenu: [
      {
        id: 'rollup-rows-all',
        label: copy.allLinkedRows,
        icon: rules.length ? <span /> : <Check size={14} />,
        onSelect: () => actions.updateRollup(databaseId, prop.id, { filters: undefined })
      },
      { separator: true },
      ...keys.map((p) => ({ id: `rollup-rows-${p.id}`, label: p.name, icon: <TypeIcon type={p.type} />, submenu: choicesFor(p) }))
    ]
  }
}

/**
 * Tab and Shift+Tab go round the fields and lists of a property menu instead of leaving the
 * popover (a menu's own root is a Tab stop here, see `Menu`'s `tabbable`).
 */
function keepTabInside(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button, [tabindex]')].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled
  )
  if (!stops.length) return
  const first = stops[0]
  const last = stops[stops.length - 1]
  const at = document.activeElement
  if (event.shiftKey ? at === first : at === last) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
}

/**
 * Property header menu: rename, a select's options, type, insert left or right (from a table's
 * header), sort, filter, hide, delete. Its words are in the home's language (`database/copy.ts`).
 */
export function PropertyMenu({
  databaseId,
  prop,
  view,
  anchor,
  placement,
  onClose,
  onFilter,
  onInsert
}: {
  databaseId: string
  prop: PropertySchema
  /** When omitted (row page), the view-specific entries are hidden. */
  view?: DatabaseView
  anchor: PopoverAnchor
  placement?: PopoverPlacement
  onClose: () => void
  onFilter?: (propertyId: string) => void
  /**
   * Given by a table's header: "Insert left" and "Insert right" are shown, and choosing one hands
   * the side to the table, which turns this popover into the add menu on the same header.
   */
  onInsert?: (side: 'left' | 'right') => void
}): JSX.Element {
  const copy = useDatabaseCopy()
  const words = copy.propertyMenu
  const [name, setName] = useState(prop.name)
  const isTitle = prop.type === 'title'
  // A property the built-in Tasks database is read by keeps its type and stays (the repository refuses too).
  const inTasks = systemKindOf(actions.snapshot(databaseId).source) === 'tasks'
  const locked = isTitle || (isTaskCoreProperty(prop.id) && inTasks)
  // The four priorities are read by id and in their order (TASK_PRIORITIES): renamed and
  // recoloured, never moved or deleted from here.
  const fixedOptions = inTasks && prop.id === TASK_PROPS.priority
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
  // An option opened from the list: its edit pane replaces the menu, Back (or Escape) returns.
  const [editing, setEditing] = useState<string | null>(null)
  const [optionFocus, setOptionFocus] = useState<OptionFocus>(null)
  const afterDelete = useRef<OptionFocus>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const hasOptions = prop.type === 'select' || prop.type === 'multi_select'

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

  // A rename typed before is kept: the menu goes, the add menu takes its place.
  const insert = (side: 'left' | 'right'): void => {
    commitName()
    onInsert?.(side)
  }

  const typeItems: MenuItem[] = L.PROPERTY_TYPES.map((type: PropertyType) => ({
    id: `type-${type}`,
    label: copy.types[type],
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
      label: words.type(copy.types[prop.type]),
      icon: <TypeIcon type={prop.type} />,
      disabled: locked,
      submenu: locked ? undefined : typeItems
    }
  ]
  // A formula that gives a number is written in a number format too (ignored for other results).
  if (prop.type === 'number' || prop.type === 'formula') {
    items.push({
      id: 'format',
      label: words.numberFormat,
      submenu: NUMBER_FORMATS.map((format) => ({
        id: `format-${format}`,
        label: words.numberFormats[format],
        icon: (prop.numberFormat ?? 'number') === format ? <Check size={14} /> : <span />,
        onSelect: () => actions.updateProperty(databaseId, prop.id, { numberFormat: format })
      }))
    })
  }
  if (prop.type === 'relation') items.push(...relationItems(databaseId, prop, cells, () => pick('target'), words))
  if (prop.type === 'rollup') items.push(...rollupItems(databaseId, prop, actions.snapshot(databaseId).schema, cells, words))
  if (prop.type === 'formula') {
    items.push(
      { separator: true },
      { id: 'formula-edit', label: words.editFormula, icon: <Formula size={14} />, onSelect: () => pick('formula') }
    )
  }
  // After the column's own settings (a relation's database, a rollup's sum, a formula), before sort.
  if (onInsert) {
    items.push(
      { separator: true },
      { id: 'insert-left', label: words.insertLeft, icon: <InsertLeft size={14} />, onSelect: () => insert('left') },
      { id: 'insert-right', label: words.insertRight, icon: <InsertRight size={14} />, onSelect: () => insert('right') }
    )
  }
  if (view) {
    items.push(
      { separator: true },
      {
        id: 'sort-asc',
        label: words.sortAscending,
        icon: <Sort size={14} />,
        onSelect: () => actions.patchView(databaseId, view.id, (v) => L.setSort(v, prop.id, 'asc'))
      },
      {
        id: 'sort-desc',
        label: words.sortDescending,
        icon: <Sort size={14} />,
        onSelect: () => actions.patchView(databaseId, view.id, (v) => L.setSort(v, prop.id, 'desc'))
      }
    )
    if (onFilter) {
      items.push({ id: 'filter', label: words.filter, icon: <Filter size={14} />, onSelect: () => onFilter(prop.id) })
    }
    items.push({
      id: 'hide',
      label: words.hide,
      disabled: isTitle,
      onSelect: () => actions.patchView(databaseId, view.id, (v, schema) => L.setPropertyVisible(v, schema, prop.id, false))
    })
  }
  items.push(
    { separator: true },
    {
      id: 'delete',
      label: words.deleteProperty,
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
      <Floating open anchor={anchor} placement={placement} label={prop.name} onClose={close}>
        <Suspense fallback={<PartFallback kind="popover" />}>
          <FormulaEditor databaseId={databaseId} prop={prop} onClose={close} />
        </Suspense>
      </Floating>
    )
  }

  if (picking) {
    return (
      <Floating open anchor={anchor} placement={placement} label={prop.name} onClose={close}>
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

  const editingOption = hasOptions && editing ? L.findOption(prop, editing) : undefined
  if (editingOption) {
    const back = (): void => {
      setOptionFocus(afterDelete.current ?? { optionId: editingOption.id })
      afterDelete.current = null
      setEditing(null)
    }
    return (
      <Floating open anchor={anchor} placement={placement} label={prop.name} onClose={close} onEscape={back}>
        <div className="db-prop-menu db-prop-menu-pane" onKeyDownCapture={keepTabInside}>
          <OptionEditPane
            key={editingOption.id}
            databaseId={databaseId}
            prop={prop}
            option={editingOption}
            backLabel={copy.options.back}
            canDelete={!fixedOptions}
            onBack={back}
            onDeleted={() => {
              // The list comes back on the next option, the previous one if it was the last, or the add field.
              const options = L.optionsOf(prop)
              const index = options.findIndex((o) => o.id === editingOption.id)
              const next = options[index + 1] ?? options[index - 1]
              afterDelete.current = next ? { optionId: next.id } : 'add'
            }}
          />
        </div>
      </Floating>
    )
  }

  return (
    <Floating open anchor={anchor} placement={placement} label={prop.name} onClose={close}>
      <div className="db-prop-menu" onKeyDownCapture={keepTabInside}>
        <div className="db-prop-menu-name">
          <input
            ref={nameRef}
            className="ui-input"
            value={name}
            autoFocus={optionFocus === null}
            aria-label={words.nameLabel}
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
        {hasOptions && (
          <>
            <OptionList
              databaseId={databaseId}
              prop={prop}
              fixedOrder={fixedOptions}
              initialFocus={optionFocus}
              addRef={addRef}
              onOpen={(id) => {
                afterDelete.current = null
                setEditing(id)
              }}
            />
            <div className="ui-menu-separator" aria-hidden="true" />
          </>
        )}
        <Menu
          items={items}
          tabbable
          onExitStart={() => (addRef.current ?? nameRef.current)?.focus()}
          onClose={() => {
            if (!keepOpen.current) close()
          }}
        />
      </div>
    </Floating>
  )
}
