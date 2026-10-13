import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, JSX, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { PropertySchema } from '@shared/types'
import { Plus, Trash, Close } from '@/ui/icons'
import * as L from '../logic'
import * as actions from '../actions'
import { isTextLike, type EditMove } from '../cells'
import { TypeIcon, beginDrag, draggedOf, endDrag, type ViewProps } from '../common'
import { AddPropertyMenu, PropertyMenu } from '../propertyMenus'
import { TableRow, cellKey } from './TableRow'
import { WINDOW_THRESHOLD, scrollToRow, useRowHeight, useWindowedRange } from './tableWindow'

interface CellRef {
  row: string
  prop: string
}

interface EditingCell extends CellRef {
  /** Character that started the edit by typing; replaces the cell text. */
  initial?: string
  /** The row was just created: cancelling the edit removes it again. */
  isNew?: boolean
}

type DropEdge = { id: string; edge: 'before' | 'after' }

const NO_SELECTION: ReadonlySet<string> = new Set()

export function TableView(p: ViewProps): JSX.Element {
  const { databaseId, schema, view, rows, canReorder, editingRowId, setEditingRowId } = p
  const props = useMemo(() => L.visibleProps(view, schema), [view, schema])
  const titleId = L.getTitleProperty(schema)?.id
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({})
  const [focus, setFocus] = useState<CellRef | null>(null)
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION)
  const lastSelected = useRef<string | null>(null)
  const [menu, setMenu] = useState<{ propId: string; anchor: HTMLElement } | null>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const [rowDrop, setRowDrop] = useState<DropEdge | null>(null)
  const [colDrop, setColDrop] = useState<DropEdge | null>(null)

  const widths = useMemo(
    () => props.map((prop) => liveWidths[prop.id] ?? L.columnWidth(view, prop)),
    [props, view, liveWidths]
  )
  const rowHeight = useRowHeight(rootRef)
  const range = useWindowedRange(bodyRef, rows.length, rowHeight, rows.length > WINDOW_THRESHOLD)
  const rowIndex = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows])

  // Latest values for the stable callbacks handed to the memoised rows.
  const latest = useRef({ rows, rowIndex, props, focus, rowDrop, rowHeight, canReorder })
  latest.current = { rows, rowIndex, props, focus, rowDrop, rowHeight, canReorder }

  // Drop selection, focus and editing state of rows / columns that left the view.
  useEffect(() => {
    const gone = (cell: CellRef | null): boolean =>
      !!cell && (!rowIndex.has(cell.row) || !props.some((prop) => prop.id === cell.prop))
    setSelected((prev) => {
      const kept = [...prev].filter((id) => rowIndex.has(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
    setFocus((prev) => (gone(prev) ? null : prev))
    setEditing((prev) => (gone(prev) ? null : prev))
  }, [rowIndex, props])

  // A row created through "New": edit its title right away.
  useEffect(() => {
    if (!editingRowId || !titleId) return
    if (rowIndex.has(editingRowId)) {
      setFocus({ row: editingRowId, prop: titleId })
      setEditing({ row: editingRowId, prop: titleId, isNew: true })
    }
    setEditingRowId(null)
  }, [editingRowId, rowIndex, titleId, setEditingRowId])

  // Keep the focused cell on screen, including when its row is outside the rendered window.
  useEffect(() => {
    if (!focus) return
    const selector = `[data-cell="${CSS.escape(cellKey(focus.row, focus.prop))}"]`
    const el = rootRef.current?.querySelector<HTMLElement>(selector)
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return
    }
    const index = latest.current.rowIndex.get(focus.row)
    if (index !== undefined && bodyRef.current) scrollToRow(bodyRef.current, index, latest.current.rowHeight)
  }, [focus])

  const refocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(refocusTimer.current), [])

  const moveFocus = useCallback((dRow: number, dCol: number, wrap = false): boolean => {
    const { rows: rs, rowIndex: index, props: ps, focus: f } = latest.current
    if (!rs.length || !ps.length) return false
    if (!f) {
      setFocus({ row: rs[0].id, prop: ps[0].id })
      return true
    }
    let r = index.get(f.row) ?? 0
    let c = Math.max(0, ps.findIndex((x) => x.id === f.prop))
    c += dCol
    r += dRow
    if (wrap) {
      if (c >= ps.length) {
        c = 0
        r += 1
      } else if (c < 0) {
        c = ps.length - 1
        r -= 1
      }
    }
    if (r < 0 || r >= rs.length) return false
    c = Math.max(0, Math.min(ps.length - 1, c))
    setFocus({ row: rs[r].id, prop: ps[c].id })
    return true
  }, [])

  /** Jumps to an absolute row / column (Home, End, Page Up / Down). */
  const focusAt = useCallback((r: number, c: number): boolean => {
    const { rows: rs, props: ps } = latest.current
    if (!rs.length || !ps.length) return false
    const row = rs[Math.max(0, Math.min(rs.length - 1, r))]
    const prop = ps[Math.max(0, Math.min(ps.length - 1, c))]
    setFocus({ row: row.id, prop: prop.id })
    return true
  }, [])

  const onFocusCell = useCallback((row: string, prop: string) => {
    setFocus((prev) => (prev && prev.row === row && prev.prop === prop ? prev : { row, prop }))
  }, [])

  const onStartEdit = useCallback((row: string, prop: string) => {
    setFocus({ row, prop })
    setEditing({ row, prop })
  }, [])

  const onStopEdit = useCallback(
    (move?: EditMove) => {
      setEditing(null)
      if (move === 'next') moveFocus(0, 1, true)
      else if (move === 'prev') moveFocus(0, -1, true)
      // Take keyboard focus back only when it was dropped (editor unmounted);
      // never steal it from whatever the user clicked to end the edit.
      clearTimeout(refocusTimer.current)
      refocusTimer.current = setTimeout(() => {
        const active = document.activeElement
        if (!active || active === document.body) rootRef.current?.focus({ preventScroll: true })
      }, 0)
    },
    [moveFocus]
  )

  const onToggleSelect = useCallback((rowId: string, shift: boolean) => {
    const { rows: rs, rowIndex: index } = latest.current
    const anchor = lastSelected.current
    lastSelected.current = rowId
    setSelected((prev) => {
      const next = new Set(prev)
      const a = shift && anchor && anchor !== rowId ? index.get(anchor) : undefined
      const b = index.get(rowId)
      if (a !== undefined && b !== undefined) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(rs[i].id)
        return next
      }
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }, [])

  // ---- row drag & drop (the handlers are stable and read the latest state through refs) ----

  const onDragOverRow = useCallback(
    (event: DragEvent, rowId: string) => {
      if (!latest.current.canReorder || !draggedOf('row', databaseId)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const edge = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      setRowDrop((prev) => (prev && prev.id === rowId && prev.edge === edge ? prev : { id: rowId, edge }))
    },
    [databaseId]
  )

  const onDropRow = useCallback(
    (event: DragEvent) => {
      const dragged = draggedOf('row', databaseId)
      const { rowDrop: drop, rows: rs, canReorder: allowed } = latest.current
      setRowDrop(null)
      if (!dragged || !drop || !allowed) return
      event.preventDefault()
      endDrag()
      // The visible order may be filtered: the target is expressed relative to visible rows.
      const target = L.rowDropTarget(
        rs.map((r) => r.id),
        dragged.id,
        drop.id,
        drop.edge
      )
      if (!target) return
      if ('beforeId' in target) actions.moveRowBefore(databaseId, dragged.id, target.beforeId)
      else actions.moveRowAfter(databaseId, dragged.id, target.afterId)
    },
    [databaseId]
  )

  const onDragEndRow = useCallback(() => {
    endDrag()
    setRowDrop(null)
  }, [])

  // ---- columns ----

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>, prop: PropertySchema, startWidth: number): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const startX = event.clientX
    const viewId = view.id
    let width = startWidth
    handle.setPointerCapture(event.pointerId)
    const onMove = (e: PointerEvent): void => {
      width = L.clampWidth(startWidth + e.clientX - startX)
      setLiveWidths((prev) => (prev[prop.id] === width ? prev : { ...prev, [prop.id]: width }))
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      // The store is updated synchronously, so the live width can go in the same batch.
      if (width !== startWidth) actions.patchView(databaseId, viewId, (v) => L.setPropertyWidth(v, prop.id, width))
      setLiveWidths((prev) => {
        if (!(prop.id in prev)) return prev
        const next = { ...prev }
        delete next[prop.id]
        return next
      })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const onColumnDrop = (event: DragEvent, index: number): void => {
    const dragged = draggedOf('column', databaseId)
    const drop = colDrop
    setColDrop(null)
    if (!dragged || !drop) return
    event.preventDefault()
    endDrag()
    const beforeId = drop.edge === 'after' ? (props[index + 1]?.id ?? null) : drop.id
    if (beforeId !== dragged.id) {
      actions.patchView(databaseId, view.id, (v) => L.moveVisibleProperty(v, dragged.id, beforeId))
    }
  }

  // ---- keyboard ----

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (editing) return
    const target = event.target as HTMLElement
    if (target !== event.currentTarget && target.closest('input, textarea, select, button, [data-popover]')) return
    const row = focus ? rows[rowIndex.get(focus.row) ?? -1] : undefined
    const prop = focus ? props.find((x) => x.id === focus.prop) : undefined
    const r = row ? (rowIndex.get(row.id) ?? 0) : 0
    const c = prop ? props.indexOf(prop) : 0
    const mod = event.ctrlKey || event.metaKey
    const page = Math.max(1, Math.floor(window.innerHeight / rowHeight) - 1)
    let handled = true
    switch (event.key) {
      case 'ArrowUp':
        if (mod) focusAt(0, c)
        else moveFocus(-1, 0)
        break
      case 'ArrowDown':
        if (mod) focusAt(rows.length - 1, c)
        else moveFocus(1, 0)
        break
      case 'ArrowLeft':
        if (mod) focusAt(r, 0)
        else moveFocus(0, -1)
        break
      case 'ArrowRight':
        if (mod) focusAt(r, props.length - 1)
        else moveFocus(0, 1)
        break
      case 'Home':
        handled = focusAt(mod ? 0 : r, 0)
        break
      case 'End':
        handled = focusAt(mod ? rows.length - 1 : r, props.length - 1)
        break
      case 'PageUp':
        handled = focusAt(r - page, c)
        break
      case 'PageDown':
        handled = focusAt(r + page, c)
        break
      case 'Tab':
        // Leave the table at its ends so focus is never trapped.
        handled = moveFocus(0, event.shiftKey ? -1 : 1, true)
        break
      case 'Enter':
      case 'F2':
        if (!row || !prop) handled = false
        else if (event.key === 'Enter' && mod) p.onOpen(row.id)
        else if (prop.type === 'checkbox') actions.toggleCheckbox(row.id, prop)
        else if (!L.isComputedType(prop.type)) setEditing({ row: row.id, prop: prop.id })
        break
      case ' ':
        if (row && prop?.type === 'checkbox') actions.toggleCheckbox(row.id, prop)
        else handled = false
        break
      case 'Escape':
        if (selected.size) setSelected(NO_SELECTION)
        else if (focus) setFocus(null)
        else handled = false
        break
      case 'Delete':
      case 'Backspace':
        if (row && prop && !L.isComputedType(prop.type) && prop.type !== 'title') {
          actions.setCell(row.id, prop, prop.type === 'checkbox' ? false : null)
        } else handled = false
        break
      default:
        handled = false
        // Typing on a text-like cell starts editing with that character.
        if (row && prop && isTextLike(prop.type) && event.key.length === 1 && !mod && !event.altKey) {
          setEditing({ row: row.id, prop: prop.id, initial: event.key })
          handled = true
        }
    }
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const allSelected = rows.length > 0 && selected.size === rows.length
  const menuProp = menu ? L.propOf(schema, menu.propId) : undefined
  const visibleRows = rows.slice(range.start, range.end)

  return (
    <div className="db-table" ref={rootRef} tabIndex={0} role="grid" aria-rowcount={rows.length} onKeyDown={onKeyDown}>
      {selected.size > 0 && (
        <div className="db-bulk-bar">
          <span className="db-bulk-count">{selected.size} selected</span>
          <button
            type="button"
            className="db-link-button is-danger"
            onClick={() => {
              actions.deleteRows([...selected])
              setSelected(NO_SELECTION)
            }}
          >
            <Trash size={14} /> Delete
          </button>
          <button type="button" className="db-mini-button" aria-label="Clear selection" onClick={() => setSelected(NO_SELECTION)}>
            <Close size={12} />
          </button>
        </div>
      )}
      <div className="db-table-sheet">
        <div className="db-thead">
          <div className={selected.size ? 'db-gutter is-visible' : 'db-gutter'}>
            <span className="db-drag-handle is-placeholder" />
            <input
              type="checkbox"
              className="db-row-check"
              aria-label="Select all rows"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? NO_SELECTION : new Set(rows.map((r) => r.id)))}
            />
          </div>
          {props.map((prop, index) => {
            const classes = ['db-th']
            if (colDrop?.id === prop.id) classes.push(`drop-${colDrop.edge}`)
            if (menu?.propId === prop.id) classes.push('is-active')
            return (
              <div
                key={prop.id}
                className={classes.join(' ')}
                style={{ width: widths[index] }}
                draggable
                onDragStart={(event) => beginDrag(event, { kind: 'column', id: prop.id, databaseId })}
                onDragEnd={() => {
                  endDrag()
                  setColDrop(null)
                }}
                onDragOver={(event) => {
                  if (!draggedOf('column', databaseId)) return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  const edge = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                  setColDrop((prev) => (prev && prev.id === prop.id && prev.edge === edge ? prev : { id: prop.id, edge }))
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setColDrop((prev) => (prev?.id === prop.id ? null : prev))
                  }
                }}
                onDrop={(event) => onColumnDrop(event, index)}
                onClick={(event) => {
                  const anchor = event.currentTarget
                  setMenu((prev) => (prev?.propId === prop.id ? null : { propId: prop.id, anchor }))
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ propId: prop.id, anchor: event.currentTarget })
                }}
              >
                <span className="db-th-icon">
                  <TypeIcon type={prop.type} />
                </span>
                <span className="db-th-name">{prop.name}</span>
                <span
                  className="db-resize-handle"
                  draggable={false}
                  onPointerDown={(event) => startResize(event, prop, widths[index])}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    actions.patchView(databaseId, view.id, (v) => L.resetPropertyWidth(v, prop.id))
                  }}
                />
              </div>
            )
          })}
          <button
            type="button"
            className="db-th is-add"
            aria-label="Add a property"
            title="Add a property"
            onClick={(event) => setAddAnchor(event.currentTarget)}
          >
            <Plus size={14} />
          </button>
          <div className="db-th is-filler" />
        </div>

        <div
          className="db-tbody"
          ref={bodyRef}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRowDrop(null)
          }}
        >
          {range.start > 0 && <div style={{ height: range.start * rowHeight }} />}
          {visibleRows.map((row) => (
            <TableRow
              key={row.id}
              databaseId={databaseId}
              row={row}
              props={props}
              widths={widths}
              selected={selected.has(row.id)}
              anySelected={selected.size > 0}
              focusedProp={focus?.row === row.id ? focus.prop : null}
              editingProp={editing?.row === row.id ? editing.prop : null}
              initialText={editing?.row === row.id ? editing.initial : undefined}
              discardOnCancel={editing?.row === row.id && editing.isNew === true}
              canReorder={canReorder}
              dropEdge={rowDrop?.id === row.id ? rowDrop.edge : null}
              onFocusCell={onFocusCell}
              onStartEdit={onStartEdit}
              onStopEdit={onStopEdit}
              onToggleSelect={onToggleSelect}
              onOpen={p.onOpen}
              onRowMenu={p.onRowMenu}
              onDragOverRow={onDragOverRow}
              onDropRow={onDropRow}
              onDragEndRow={onDragEndRow}
            />
          ))}
          {range.end < rows.length && <div style={{ height: (rows.length - range.end) * rowHeight }} />}
          {rows.length === 0 && <div className="db-empty-row">No rows{view.filters.length ? ' match the filters' : ''}</div>}
        </div>

        <button type="button" className="db-new-row" onClick={() => p.onNewRow()}>
          <Plus size={14} /> New
        </button>
      </div>
      <div className="db-table-footer">
        <span className="db-count-label">Count</span>
        <span className="db-count-value">{rows.length}</span>
      </div>

      {menu && menuProp && (
        <PropertyMenu
          key={menuProp.id}
          databaseId={databaseId}
          prop={menuProp}
          view={view}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onFilter={p.onAddFilter}
        />
      )}
      {addAnchor && (
        <AddPropertyMenu
          databaseId={databaseId}
          viewId={view.id}
          anchor={addAnchor}
          placement="bottom-end"
          onClose={() => setAddAnchor(null)}
        />
      )}
    </div>
  )
}
