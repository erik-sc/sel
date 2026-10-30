import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DragEvent, JSX, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { PropertySchema } from '@shared/types'
import { Plus, Pen, Trash, Close } from '@/ui/icons'
import { Menu } from '@/ui/Menu'
import { rovingTarget, takeMenuKey } from '@/a11y/keys'
import * as L from '../logic'
import * as actions from '../actions'
import { bulkEditItems } from '../bulkEdit'
import { isTextLike, type EditMove } from '../cells'
import { Floating, TypeIcon, beginDrag, draggedOf, endDrag, type ViewProps } from '../common'
import { useDatabaseCopy } from '../copy'
import { AddPropertyMenu, PropertyMenu, TypeMenu, isTypeLocked } from '../propertyMenus'
import { TableRow, cellId, cellKey } from './TableRow'
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

/** The add menu: from the "+" header, or from a header's "Insert left / right" (`before`, anchored on that header). */
interface Adding {
  anchor: HTMLElement
  inserted: boolean
  before?: string
}

const NO_SELECTION: ReadonlySet<string> = new Set()

/** The "+" header, among the headers the keyboard moves along (a property id otherwise). */
const ADD_HEADER = '+'

/** The id of a column's header (or of "+"), which the grid names as its active descendant. */
export function headerId(gridId: string, propertyId: string): string {
  return propertyId === ADD_HEADER ? `${gridId}-header-add` : `${gridId}-h-${propertyId}`
}

export function TableView(p: ViewProps): JSX.Element {
  const { databaseId, schema, view, rows, canReorder, editingRowId, setEditingRowId } = p
  const props = useMemo(() => L.visibleProps(view, schema), [view, schema])
  const titleId = L.getTitleProperty(schema)?.id
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const gridId = useId()
  const copy = useDatabaseCopy()

  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({})
  const [focus, setFocus] = useState<CellRef | null>(null)
  // The header the keyboard is on (a property id, or ADD_HEADER), while no cell is focused.
  const [header, setHeader] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION)
  const lastSelected = useRef<string | null>(null)
  const [menu, setMenu] = useState<{ propId: string; anchor: HTMLElement } | null>(null)
  const [adding, setAdding] = useState<Adding | null>(null)
  // The glyph of a header opened the choice of type, or its name is a field (rename in place).
  const [typeMenu, setTypeMenu] = useState<{ propId: string; anchor: HTMLElement } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // A property just added (from "+" or a header's insert): brought into view once the menu has closed.
  const [addedProp, setAddedProp] = useState<{ id: string; inserted: boolean } | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const [editAnchor, setEditAnchor] = useState<HTMLElement | null>(null)
  const [rowDrop, setRowDrop] = useState<DropEdge | null>(null)
  const [colDrop, setColDrop] = useState<DropEdge | null>(null)

  const widths = useMemo(() => props.map((prop) => liveWidths[prop.id] ?? L.columnWidth(view, prop)), [props, view, liveWidths])
  const rowHeight = useRowHeight(rootRef)
  const range = useWindowedRange(bodyRef, rows.length, rowHeight, rows.length > WINDOW_THRESHOLD)
  const rowIndex = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows])

  // Latest values for the stable callbacks handed to the memoised rows.
  const latest = useRef({ rows, rowIndex, props, focus, header, rowDrop, rowHeight, canReorder })
  latest.current = { rows, rowIndex, props, focus, header, rowDrop, rowHeight, canReorder }

  // Drop selection, focus and editing state of rows / columns that left the view.
  useEffect(() => {
    const gone = (cell: CellRef | null): boolean => !!cell && (!rowIndex.has(cell.row) || !props.some((prop) => prop.id === cell.prop))
    setSelected((prev) => {
      const kept = [...prev].filter((id) => rowIndex.has(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
    setFocus((prev) => (gone(prev) ? null : prev))
    setEditing((prev) => (gone(prev) ? null : prev))
    setHeader((prev) => (prev && prev !== ADD_HEADER && !props.some((prop) => prop.id === prev) ? null : prev))
  }, [rowIndex, props])

  // A cell and a header are never both the active one: a cell taking it (a click, an add) wins.
  useEffect(() => {
    if (focus) setHeader(null)
  }, [focus])

  // Keep the active header on screen (the table scrolls sideways).
  useEffect(() => {
    if (header === null) return
    document.getElementById(headerId(gridId, header))?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [header, gridId])

  // The edit menu belongs to a selection: it goes when the selection does.
  useEffect(() => {
    if (!selected.size) setEditAnchor(null)
  }, [selected])

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

  // After an add, the new column scrolls into view and its first cell becomes the active one, so
  // the next key edits it. Waits for the menu to close (a formula's editor stays open first). From
  // "+", the "+" header is what is scrolled to: the new column sits just before it, so both are in
  // view; an insert scrolls to its own header. With no rows, the focus stays where the menu returns
  // it ("+", or the grid with the new header active after an insert). A column that never shows
  // (a dropped write) is forgotten once the menu has closed.
  useEffect(() => {
    if (!addedProp || adding) return
    setAddedProp(null)
    const { id, inserted } = addedProp
    if (!props.some((prop) => prop.id === id)) return
    const shown = inserted ? document.getElementById(headerId(gridId, id)) : addRef.current
    shown?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (!rows.length) {
      // The add menu took the place of the header's menu, so it has no opener to give the focus back to.
      if (inserted) {
        gridRef.current?.focus({ preventScroll: true })
        setHeader(id)
      }
      return
    }
    // The grid first: focusing it picks a cell of its own when none is focused yet.
    gridRef.current?.focus({ preventScroll: true })
    setFocus({ row: rows[0].id, prop: id })
  }, [addedProp, adding, props, rows, gridId])

  const refocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(refocusTimer.current), [])
  // Take keyboard focus back only when it was dropped (an editor or a popover unmounted);
  // never steal it from whatever the user clicked meanwhile.
  const regainFocus = useCallback((): void => {
    clearTimeout(refocusTimer.current)
    refocusTimer.current = setTimeout(() => {
      const active = document.activeElement
      if (!active || active === document.body) gridRef.current?.focus({ preventScroll: true })
    }, 0)
  }, [])

  const moveFocus = useCallback((dRow: number, dCol: number, wrap = false): boolean => {
    const { rows: rs, rowIndex: index, props: ps, focus: f } = latest.current
    if (!rs.length || !ps.length) return false
    if (!f) {
      setFocus({ row: rs[0].id, prop: ps[0].id })
      return true
    }
    let r = index.get(f.row) ?? 0
    let c = Math.max(
      0,
      ps.findIndex((x) => x.id === f.prop)
    )
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
      regainFocus()
    },
    [moveFocus, regainFocus]
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

  /** Opens the menu of a header: a property's, or the add menu on "+". */
  const openHeaderMenu = (id: string): void => {
    if (id === ADD_HEADER) {
      if (addRef.current) setAdding({ anchor: addRef.current, inserted: false })
      return
    }
    const el = document.getElementById(headerId(gridId, id))
    if (el) setMenu({ propId: id, anchor: el })
  }

  /** "Insert left / right" in a header's menu: the add menu takes its place, on the same header. */
  const insertBeside = (propId: string, side: 'left' | 'right', anchor: HTMLElement): void => {
    const index = props.findIndex((prop) => prop.id === propId)
    if (index < 0) return
    setMenu(null)
    setAdding({ anchor, inserted: true, before: side === 'left' ? propId : props[index + 1]?.id })
  }

  /** Turns a header's name into a field, closing the menus that sit on it. */
  const startRename = (id: string): void => {
    setMenu(null)
    setAdding(null)
    setTypeMenu(null)
    setHeader(id)
    setRenaming(id)
  }

  /** Ends a rename: Enter and leaving the field save the name, Escape restores it. The header stays the active one. */
  const finishRename = (prop: PropertySchema, name: string | null): void => {
    setRenaming(null)
    if (name !== null) actions.renameProperty(databaseId, prop.id, name)
    setHeader(prop.id)
    regainFocus()
  }

  /** Keys on the header row: along it (ending on "+"), down to the first row, and into a header's menu. */
  const onHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>, at: string): void => {
    const ids = [...props.map((prop) => prop.id), ADD_HEADER]
    const index = Math.max(0, ids.indexOf(at))
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey
    let handled = true
    if (takeMenuKey(event)) openHeaderMenu(at)
    else if (!plain) handled = false
    else {
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'Home':
        case 'End': {
          const to = rovingTarget(event.key, index, ids.length, 'horizontal')
          if (to !== null) setHeader(ids[to])
          break
        }
        case 'ArrowUp':
          break
        case 'ArrowDown': {
          const prop = at === ADD_HEADER ? props[props.length - 1] : props[index]
          if (rows.length && prop) setFocus({ row: rows[0].id, prop: prop.id })
          break
        }
        case 'F2':
          // A column's name becomes a field in the header; "+" has no name.
          if (at === ADD_HEADER) openHeaderMenu(at)
          else startRename(at)
          break
        case 'Enter':
        case ' ':
          openHeaderMenu(at)
          break
        case 'Escape':
          // Nothing to close: the header stays the active one (ArrowDown goes back to the rows).
          break
        default:
          handled = false
      }
    }
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (editing) return
    const target = event.target as HTMLElement
    if (target !== event.currentTarget && target.closest('input, textarea, select, button, [data-popover]')) return
    if (header !== null && !focus) {
      onHeaderKeyDown(event, header)
      return
    }
    const row = focus ? rows[rowIndex.get(focus.row) ?? -1] : undefined
    const prop = focus ? props.find((x) => x.id === focus.prop) : undefined
    const r = row ? (rowIndex.get(row.id) ?? 0) : 0
    const c = prop ? props.indexOf(prop) : 0
    const mod = event.ctrlKey || event.metaKey
    const page = Math.max(1, Math.floor(window.innerHeight / rowHeight) - 1)
    if (row && prop && takeMenuKey(event)) {
      const cell = rootRef.current?.querySelector(`[data-cell="${CSS.escape(cellKey(row.id, prop.id))}"]`)
      p.onRowMenu(event, row.id, cell ?? undefined)
      return
    }
    let handled = true
    switch (event.key) {
      case 'ArrowUp':
        if (mod) focusAt(0, c)
        else if (row && prop && r === 0) {
          // From the first row up to the column's header.
          setFocus(null)
          setHeader(prop.id)
        } else moveFocus(-1, 0)
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
  const typeProp = typeMenu ? L.propOf(schema, typeMenu.propId) : undefined
  const visibleRows = rows.slice(range.start, range.end)
  // The focused cell, for the screen reader: only while its row is drawn (windowing).
  const focusIndex = focus ? rowIndex.get(focus.row) : undefined
  const activeCell =
    focus && focusIndex !== undefined && focusIndex >= range.start && focusIndex < range.end
      ? cellId(gridId, focus.row, focus.prop)
      : undefined
  const activeHeader = !focus && header !== null ? header : null

  return (
    <div className="db-table" ref={rootRef}>
      {selected.size > 0 && (
        <div className="db-bulk-bar">
          <span className="db-bulk-count">{selected.size} selected</span>
          <button
            type="button"
            className="db-link-button"
            aria-haspopup="menu"
            aria-expanded={!!editAnchor}
            onClick={(event) => {
              const anchor = event.currentTarget
              setEditAnchor((prev) => (prev ? null : anchor))
            }}
          >
            <Pen size={14} /> Edit
          </button>
          <button
            type="button"
            className="db-link-button is-danger"
            onClick={() => {
              actions.trashRows(databaseId, [...selected])
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
        <div
          className="db-grid"
          ref={gridRef}
          role="grid"
          tabIndex={0}
          aria-label={view.name}
          aria-rowcount={rows.length + 1}
          aria-colcount={props.length + 1}
          aria-multiselectable="true"
          aria-activedescendant={activeCell ?? (activeHeader !== null ? headerId(gridId, activeHeader) : undefined)}
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            // Tab arrives on the grid: a cell is focused at once, so there is something to read; with
            // no rows, the first header. Coming back to a header (Esc in its menu) keeps that header.
            if (event.target !== event.currentTarget || latest.current.focus || latest.current.header !== null) return
            if (!moveFocus(0, 0) && latest.current.props.length) setHeader(latest.current.props[0].id)
          }}
        >
          <div className="db-thead" role="row" aria-rowindex={1}>
            <div
              className={selected.size ? 'db-gutter is-visible' : 'db-gutter'}
              role="columnheader"
              aria-colindex={1}
              aria-label="Selection"
            >
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
              if (activeHeader === prop.id) classes.push('is-focused')
              return (
                <div
                  key={prop.id}
                  id={headerId(gridId, prop.id)}
                  className={classes.join(' ')}
                  style={{ width: widths[index] }}
                  role="columnheader"
                  aria-colindex={index + 2}
                  draggable={renaming !== prop.id}
                  onDragStart={(event) => beginDrag(event, { kind: 'column', id: prop.id, databaseId })}
                  onDoubleClick={() => startRename(prop.id)}
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
                    if (renaming === prop.id) return
                    // A click on the header the keyboard is already on renames it, as F2 does.
                    if (activeHeader === prop.id && !menu && !adding && !typeMenu) {
                      startRename(prop.id)
                      return
                    }
                    const anchor = event.currentTarget
                    // A click on the header an insert's add menu sits on closes that menu, as it would its own.
                    if (adding?.anchor === anchor) {
                      setAdding(null)
                      return
                    }
                    setMenu((prev) => (prev?.propId === prop.id ? null : { propId: prop.id, anchor }))
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setAdding(null)
                    setMenu({ propId: prop.id, anchor: event.currentTarget })
                  }}
                >
                  {isTypeLocked(databaseId, prop) ? (
                    <span className="db-th-icon" title={copy.header.fixedType(copy.types[prop.type])}>
                      <TypeIcon type={prop.type} />
                    </span>
                  ) : (
                    // Not a Tab stop: the keyboard reaches the type through the header's menu.
                    <button
                      type="button"
                      className="db-th-type"
                      tabIndex={-1}
                      aria-haspopup="menu"
                      aria-label={copy.header.typeGlyph(prop.name, copy.types[prop.type])}
                      onClick={(event) => {
                        event.stopPropagation()
                        const anchor = event.currentTarget
                        setMenu(null)
                        setAdding(null)
                        setTypeMenu((prev) => (prev?.propId === prop.id ? null : { propId: prop.id, anchor }))
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onContextMenu={(event) => event.stopPropagation()}
                    >
                      <TypeIcon type={prop.type} />
                    </button>
                  )}
                  {renaming === prop.id ? (
                    <HeaderNameField
                      name={prop.name}
                      label={copy.header.renameLabel(prop.name)}
                      onDone={(name) => finishRename(prop, name)}
                    />
                  ) : (
                    <span className="db-th-name">{prop.name}</span>
                  )}
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
            <div className="db-th-slot" id={headerId(gridId, ADD_HEADER)} role="columnheader" aria-colindex={props.length + 2}>
              <button
                type="button"
                ref={addRef}
                className={activeHeader === ADD_HEADER ? 'db-th is-add is-focused' : 'db-th is-add'}
                aria-label={copy.addProperty.label}
                title={copy.addProperty.label}
                onClick={(event) => setAdding({ anchor: event.currentTarget, inserted: false })}
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="db-th is-filler" aria-hidden="true" />
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
                gridId={gridId}
                index={rowIndex.get(row.id) ?? 0}
                row={row}
                schema={schema}
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
            {rows.length === 0 && (
              <div className="db-empty-row" role="row">
                <span role="gridcell">No rows{view.filters.length ? ' match the filters' : ''}</span>
              </div>
            )}
          </div>
        </div>

        <button type="button" className="db-new-row" onClick={() => p.onNewRow()}>
          <Plus size={14} /> New
        </button>
      </div>
      <div className="db-table-footer">
        <span className="db-count-label">Count</span>
        <span className="db-count-value">{rows.length}</span>
      </div>

      {editAnchor && selected.size > 0 && (
        <Floating open anchor={editAnchor} role="none" onClose={() => setEditAnchor(null)}>
          <Menu items={bulkEditItems(schema, () => [...selected])} onClose={() => setEditAnchor(null)} autoFocus />
        </Floating>
      )}
      {menu && menuProp && (
        <PropertyMenu
          key={menuProp.id}
          databaseId={databaseId}
          prop={menuProp}
          view={view}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onFilter={p.onAddFilter}
          onInsert={(side) => insertBeside(menuProp.id, side, menu.anchor)}
        />
      )}
      {typeMenu && typeProp && (
        <TypeMenu
          key={typeProp.id}
          databaseId={databaseId}
          prop={typeProp}
          anchor={typeMenu.anchor}
          onClose={() => {
            setTypeMenu(null)
            regainFocus()
          }}
        />
      )}
      {adding && (
        <AddPropertyMenu
          databaseId={databaseId}
          viewId={view.id}
          anchor={adding.anchor}
          placement={adding.inserted ? undefined : 'bottom-end'}
          before={adding.before}
          onClose={() => {
            setAdding(null)
            // An insert's menu replaced the header's: the focus it would give back went with that one.
            if (adding.inserted) regainFocus()
          }}
          onAdded={(id) => setAddedProp({ id, inserted: adding.inserted })}
        />
      )}
    </div>
  )
}

/**
 * A header's name as a field, in the header itself. Enter and leaving the field save, Escape puts
 * the old name back; the keys stop here so the grid does not take them for its own.
 */
function HeaderNameField({ name, label, onDone }: { name: string; label: string; onDone: (name: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(name)
  // One ending only: Enter then the blur it causes, or Escape then the blur, must not write twice.
  const done = useRef(false)
  const end = (next: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      className="db-th-input"
      value={value}
      aria-label={label}
      maxLength={L.MAX_NAME_LENGTH}
      autoFocus
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => end(value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          end(value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          end(null)
        }
      }}
    />
  )
}
