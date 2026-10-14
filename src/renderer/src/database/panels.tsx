// Toolbar panels: filters, sorts and property visibility/order.
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DatabaseView, FilterOperator, PropertySchema, PropertyValue, ViewFilter, ViewSort } from '@shared/types'
import { Close, DragHandle, Plus } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { TypeIcon, beginDrag, draggedOf, endDrag } from './common'
import { useCommitOnUnmount } from './hooks'
import { AddPropertyMenu } from './propertyMenus'
import { useRelated } from './related'

interface PanelProps {
  databaseId: string
  schema: L.Schema
  view: DatabaseView
}

/** Typing pause after which a filter value is applied. */
const COMMIT_DELAY_MS = 250

/** Text input that commits shortly after typing stops, on blur and when it is removed. */
function DebouncedInput({
  value,
  onCommit,
  type = 'text',
  placeholder
}: {
  value: string
  onCommit: (value: string) => void
  type?: 'text' | 'number' | 'date'
  placeholder?: string
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  useEffect(() => {
    // External change (other window, undo): adopt it.
    if (value !== committed.current) {
      committed.current = value
      setDraft(value)
    }
  }, [value])

  const flush = (): void => {
    if (draft === committed.current) return
    committed.current = draft
    commitRef.current(draft)
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    if (draft === committed.current) return
    const timer = setTimeout(() => flushRef.current(), COMMIT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft])

  // The panel can close (Escape, outside click) while the debounce is still pending.
  useCommitOnUnmount(flush)

  return (
    <input
      className="ui-input db-rule-value"
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={flush}
    />
  )
}

function FilterValueEditor({
  prop,
  schema,
  filter,
  onChange
}: {
  prop: PropertySchema
  schema: L.Schema
  filter: ViewFilter
  onChange: (value: PropertyValue | undefined) => void
}): JSX.Element | null {
  const { cells } = useRelated()
  if (!L.operatorNeedsValue(filter.operator)) return <span className="db-rule-value is-empty" />
  const value = filter.value
  switch (L.filterTypeOf(prop, schema)) {
    case 'relation': {
      const current = Array.isArray(value) ? (value[0] ?? '') : typeof value === 'string' ? value : ''
      const rows = cells ? L.linkableRows(L.relationOf(prop), cells) : []
      return (
        <select
          className="db-select db-rule-value"
          value={current}
          aria-label="Page"
          onChange={(event) => onChange(event.target.value ? [event.target.value] : undefined)}
        >
          <option value="">Select a page…</option>
          {current && !rows.some((row) => row.id === current) && <option value={current}>A page that is gone</option>}
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {L.titleOf(row) || 'Untitled'}
            </option>
          ))}
        </select>
      )
    }
    case 'select':
    case 'multi_select': {
      const current = Array.isArray(value) ? (value[0] ?? '') : typeof value === 'string' ? value : ''
      return (
        <select
          className="db-select db-rule-value"
          value={current}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Select an option…</option>
          {L.optionsOf(prop).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      )
    }
    case 'number':
      return (
        <DebouncedInput
          type="number"
          placeholder="Number"
          value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
          onCommit={(text) => {
            const n = Number(text)
            onChange(text.trim() === '' || isNaN(n) ? undefined : n)
          }}
        />
      )
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return (
        <DebouncedInput
          type="date"
          value={L.dayKey(value ?? null) ?? ''}
          onCommit={(text) => onChange(text || undefined)}
        />
      )
    default:
      return (
        <DebouncedInput
          placeholder="Value"
          value={typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)}
          onCommit={(text) => onChange(text === '' ? undefined : text)}
        />
      )
  }
}

function PropertySelect({
  schema,
  value,
  onChange
}: {
  schema: L.Schema
  value: string
  onChange: (propertyId: string) => void
}): JSX.Element {
  return (
    <select className="db-select" value={value} aria-label="Property" onChange={(event) => onChange(event.target.value)}>
      {L.orderedProperties(schema).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

export function FilterPanel({ databaseId, schema, view }: PanelProps): JSX.Element {
  const filters = view.filters
  const title = L.getTitleProperty(schema)

  /** Edits the rules as they are in the store when the edit lands, not as they were rendered. */
  const edit = (update: (current: ViewFilter[], schema: L.Schema) => ViewFilter[]): void =>
    actions.patchView(databaseId, view.id, (v, s) => {
      const next = update(v.filters, s)
      return next === v.filters ? v : { ...v, filters: next }
    })

  /** Replaces the rule at `index`, provided it is still the rule on `propertyId`. */
  const replace = (index: number, propertyId: string, make: (rule: ViewFilter, schema: L.Schema) => ViewFilter | null): void =>
    edit((current, s) => {
      const rule = current[index]
      if (!rule || rule.propertyId !== propertyId) return current
      const next = make(rule, s)
      return next ? current.map((f, i) => (i === index ? next : f)) : current
    })

  return (
    <div className="db-panel">
      <div className="db-panel-title">Filters</div>
      {filters.length === 0 && <div className="db-panel-empty">No filters. Rows must match every rule you add.</div>}
      {filters.map((filter, index) => {
        const prop = L.propOf(schema, filter.propertyId)
        if (!prop) return null
        const type = L.filterTypeOf(prop, schema)
        const fitting = L.operatorsOf(prop, schema)
        // A rule on a formula keeps its condition while the formula gives something else (an error, say).
        const operators = fitting.includes(filter.operator) ? fitting : [filter.operator, ...fitting]
        return (
          <div className="db-rule" key={index}>
            <span className="db-rule-prefix">{index === 0 ? 'Where' : 'And'}</span>
            <PropertySelect
              schema={schema}
              value={prop.id}
              onChange={(propertyId) =>
                replace(index, prop.id, (_rule, s) => {
                  const target = L.propOf(s, propertyId)
                  return target ? L.defaultFilter(target, s) : null
                })
              }
            />
            <select
              className="db-select"
              value={filter.operator}
              aria-label="Condition"
              onChange={(event) => {
                const operator = event.target.value as FilterOperator
                replace(index, prop.id, (rule) => {
                  const next: ViewFilter = { propertyId: rule.propertyId, operator }
                  if (L.operatorNeedsValue(operator) && rule.value !== undefined) next.value = rule.value
                  return next
                })
              }}
            >
              {operators.map((operator) => (
                <option key={operator} value={operator}>
                  {L.operatorLabel(operator, type)}
                </option>
              ))}
            </select>
            <FilterValueEditor
              key={`${prop.id}:${type}`}
              prop={prop}
              schema={schema}
              filter={filter}
              onChange={(value) =>
                replace(index, prop.id, (rule) => {
                  const next: ViewFilter = { propertyId: rule.propertyId, operator: rule.operator }
                  if (value !== undefined) next.value = value
                  return next
                })
              }
            />
            <button
              type="button"
              className="db-mini-button"
              aria-label="Remove filter"
              onClick={() =>
                edit((current) => (current[index]?.propertyId === prop.id ? current.filter((_, i) => i !== index) : current))
              }
            >
              <Close size={12} />
            </button>
          </div>
        )
      })}
      <div className="db-panel-actions">
        <button
          type="button"
          className="db-link-button"
          disabled={!title}
          onClick={() =>
            edit((current, s) => {
              const target = L.getTitleProperty(s)
              return target ? [...current, L.defaultFilter(target, s)] : current
            })
          }
        >
          <Plus size={14} /> Add filter
        </button>
        {filters.length > 0 && (
          <button type="button" className="db-link-button is-muted" onClick={() => edit((current) => (current.length ? [] : current))}>
            Clear all
          </button>
        )}
      </div>
    </div>
  )
}

export function SortPanel({ databaseId, schema, view }: PanelProps): JSX.Element {
  const sorts = view.sorts
  const [dropId, setDropId] = useState<string | null>(null)
  const unused = L.orderedProperties(schema).filter((p) => !sorts.some((s) => s.propertyId === p.id))

  /** Sorts are unique per property, so edits address a rule by its property in the latest state. */
  const edit = (update: (current: ViewSort[], schema: L.Schema) => ViewSort[]): void =>
    actions.patchView(databaseId, view.id, (v, s) => {
      const next = update(v.sorts, s)
      return next === v.sorts ? v : { ...v, sorts: next }
    })
  const patch = (propertyId: string, change: Partial<ViewSort>): void =>
    edit((current) => {
      if (change.propertyId && current.some((s) => s.propertyId === change.propertyId)) return current
      return current.map((s) => (s.propertyId === propertyId ? { ...s, ...change } : s))
    })

  return (
    <div className="db-panel">
      <div className="db-panel-title">Sorts</div>
      {sorts.length === 0 && <div className="db-panel-empty">No sorts. Rows keep their manual order.</div>}
      {sorts.map((sort) => {
        const prop = L.propOf(schema, sort.propertyId)
        if (!prop) return null
        return (
          <div
            key={sort.propertyId}
            className={dropId === sort.propertyId ? 'db-rule is-drop-target' : 'db-rule'}
            onDragOver={(event) => {
              if (!draggedOf('sort', databaseId)) return
              event.preventDefault()
              setDropId(sort.propertyId)
            }}
            onDragLeave={() => setDropId((current) => (current === sort.propertyId ? null : current))}
            onDrop={(event) => {
              const dragged = draggedOf('sort', databaseId)
              setDropId(null)
              if (!dragged) return
              event.preventDefault()
              endDrag()
              edit((current) => {
                const from = current.findIndex((s) => s.propertyId === dragged.id)
                const to = current.findIndex((s) => s.propertyId === sort.propertyId)
                return from >= 0 && to >= 0 && from !== to ? L.reorder(current, from, to) : current
              })
            }}
          >
            <span
              className="db-drag-handle"
              draggable
              title="Drag to reorder"
              onDragStart={(event) => beginDrag(event, { kind: 'sort', id: sort.propertyId, databaseId })}
              onDragEnd={() => {
                endDrag()
                setDropId(null)
              }}
            >
              <DragHandle size={14} />
            </span>
            <select
              className="db-select"
              value={sort.propertyId}
              aria-label="Property"
              onChange={(event) => patch(sort.propertyId, { propertyId: event.target.value })}
            >
              {[prop, ...unused].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="db-select"
              value={sort.direction}
              aria-label="Direction"
              onChange={(event) => patch(sort.propertyId, { direction: event.target.value === 'desc' ? 'desc' : 'asc' })}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <button
              type="button"
              className="db-mini-button"
              aria-label="Remove sort"
              onClick={() => edit((current) => current.filter((s) => s.propertyId !== sort.propertyId))}
            >
              <Close size={12} />
            </button>
          </div>
        )
      })}
      <div className="db-panel-actions">
        <button
          type="button"
          className="db-link-button"
          disabled={!unused.length}
          onClick={() =>
            edit((current, s) => {
              const next = L.orderedProperties(s).find((p) => !current.some((x) => x.propertyId === p.id))
              return next ? [...current, { propertyId: next.id, direction: 'asc' }] : current
            })
          }
        >
          <Plus size={14} /> Add sort
        </button>
        {sorts.length > 0 && (
          <button type="button" className="db-link-button is-muted" onClick={() => edit((current) => (current.length ? [] : current))}>
            Clear all
          </button>
        )}
      </div>
    </div>
  )
}

export function PropertiesPanel({ databaseId, schema, view }: PanelProps): JSX.Element {
  const visible = L.visibleProps(view, schema)
  const hidden = L.hiddenProps(view, schema)
  const [dropId, setDropId] = useState<string | null>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const groupType = L.groupTypeOf(view.type)
  const groupCandidates = groupType ? L.orderedProperties(schema).filter((p) => p.type === groupType) : []

  const setVisible = (propertyId: string, on: boolean): void =>
    actions.patchView(databaseId, view.id, (v, s) => L.setPropertyVisible(v, s, propertyId, on))

  const row = (prop: PropertySchema, isVisible: boolean): JSX.Element => (
    <div
      key={prop.id}
      className={dropId === prop.id ? 'db-prop-row is-drop-target' : 'db-prop-row'}
      onDragOver={(event) => {
        if (!isVisible || !draggedOf('property', databaseId)) return
        event.preventDefault()
        setDropId(prop.id)
      }}
      onDragLeave={() => setDropId((current) => (current === prop.id ? null : current))}
      onDrop={(event) => {
        const dragged = draggedOf('property', databaseId)
        setDropId(null)
        if (!dragged || !isVisible) return
        event.preventDefault()
        endDrag()
        actions.patchView(databaseId, view.id, (v) => L.moveVisibleProperty(v, dragged.id, prop.id))
      }}
    >
      <span
        className={isVisible ? 'db-drag-handle' : 'db-drag-handle is-disabled'}
        draggable={isVisible}
        onDragStart={(event) => beginDrag(event, { kind: 'property', id: prop.id, databaseId })}
        onDragEnd={() => {
          endDrag()
          setDropId(null)
        }}
      >
        <DragHandle size={14} />
      </span>
      <TypeIcon type={prop.type} />
      <span className="db-prop-row-name">{prop.name}</span>
      <input
        type="checkbox"
        className="db-toggle"
        aria-label={`Show ${prop.name}`}
        checked={isVisible}
        disabled={prop.type === 'title'}
        onChange={(event) => setVisible(prop.id, event.target.checked)}
      />
    </div>
  )

  return (
    <div className="db-panel is-narrow">
      {groupType && (
        <>
          <div className="db-panel-title">{view.type === 'board' ? 'Group by' : 'Show on calendar by'}</div>
          <div className="db-rule">
            {groupCandidates.length ? (
              <select
                className="db-select is-wide"
                value={view.groupBy ?? ''}
                onChange={(event) => actions.patchView(databaseId, view.id, { groupBy: event.target.value })}
              >
                {groupCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                className="db-link-button"
                onClick={() =>
                  actions.addProperty(databaseId, groupType, view.id, groupType === 'select' ? 'Status' : 'Date', {
                    groupView: true
                  })
                }
              >
                <Plus size={14} /> Add a {groupType === 'select' ? 'select' : 'date'} property
              </button>
            )}
          </div>
        </>
      )}
      <div className="db-panel-title">Shown in view</div>
      {visible.map((p) => row(p, true))}
      {hidden.length > 0 && (
        <>
          <div className="db-panel-title">
            Hidden
            <button
              type="button"
              className="db-link-button is-inline"
              onClick={() => actions.patchView(databaseId, view.id, (v, s) => L.showAllProperties(v, s))}
            >
              Show all
            </button>
          </div>
          {hidden.map((p) => row(p, false))}
        </>
      )}
      <div className="db-panel-actions">
        <button type="button" className="db-link-button" onClick={(event) => setAddAnchor(event.currentTarget)}>
          <Plus size={14} /> New property
        </button>
      </div>
      {addAnchor && (
        <AddPropertyMenu
          databaseId={databaseId}
          viewId={view.id}
          anchor={addAnchor}
          placement="right-start"
          onClose={() => setAddAnchor(null)}
        />
      )}
    </div>
  )
}
