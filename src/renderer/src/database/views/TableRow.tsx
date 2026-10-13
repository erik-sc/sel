import { memo } from 'react'
import type { DragEvent, JSX, MouseEvent as ReactMouseEvent } from 'react'
import type { Block, PropertySchema } from '@shared/types'
import { DragHandle } from '@/ui/icons'
import { PropertyCell, type EditMove } from '../cells'
import { RowIcon, beginDrag, type OpenModifiers } from '../common'

/** Horizontal offset of the drag image under the pointer. */
const DRAG_IMAGE_OFFSET_X = 20

export function cellKey(rowId: string, propertyId: string): string {
  return `${rowId}:${propertyId}`
}

export interface TableRowProps {
  databaseId: string
  row: Block
  props: PropertySchema[]
  widths: number[]
  selected: boolean
  anySelected: boolean
  focusedProp: string | null
  editingProp: string | null
  initialText: string | undefined
  /** The row was just created and its title is being typed: Escape removes it again. */
  discardOnCancel: boolean
  canReorder: boolean
  dropEdge: 'before' | 'after' | null
  onFocusCell: (row: string, prop: string) => void
  onStartEdit: (row: string, prop: string) => void
  onStopEdit: (move?: EditMove) => void
  onToggleSelect: (row: string, shift: boolean) => void
  onOpen: (rowId: string, event?: OpenModifiers) => void
  onRowMenu: (event: ReactMouseEvent, rowId: string) => void
  onDragOverRow: (event: DragEvent, rowId: string) => void
  onDropRow: (event: DragEvent) => void
  onDragEndRow: () => void
}

/**
 * One table row. Memoised: every callback is stable and every other prop is a
 * primitive or a store object, so editing one cell re-renders one row.
 */
export const TableRow = memo(function TableRow(p: TableRowProps): JSX.Element {
  const { row } = p
  const classes = ['db-tr']
  if (p.selected) classes.push('is-selected')
  if (p.dropEdge) classes.push(`drop-${p.dropEdge}`)
  return (
    <div
      className={classes.join(' ')}
      data-row-id={row.id}
      onContextMenu={(event) => p.onRowMenu(event, row.id)}
      onDragOver={(event) => p.onDragOverRow(event, row.id)}
      onDrop={p.onDropRow}
    >
      <div className={p.anySelected ? 'db-gutter is-visible' : 'db-gutter'}>
        <span
          className={p.canReorder ? 'db-drag-handle' : 'db-drag-handle is-disabled'}
          draggable={p.canReorder}
          title={p.canReorder ? 'Drag to reorder' : 'Remove the sorts to reorder rows'}
          onDragStart={(event) => {
            beginDrag(event, { kind: 'row', id: row.id, databaseId: p.databaseId })
            const rowEl = event.currentTarget.closest('.db-tr')
            if (rowEl) event.dataTransfer.setDragImage(rowEl, DRAG_IMAGE_OFFSET_X, rowEl.getBoundingClientRect().height / 2)
          }}
          onDragEnd={p.onDragEndRow}
        >
          <DragHandle size={14} />
        </span>
        <input
          type="checkbox"
          className="db-row-check"
          aria-label="Select row"
          checked={p.selected}
          onChange={() => undefined}
          onClick={(event) => p.onToggleSelect(row.id, event.shiftKey)}
        />
      </div>
      {p.props.map((prop, index) => {
        const focused = p.focusedProp === prop.id
        const editing = p.editingProp === prop.id
        const tdClasses = ['db-td']
        if (prop.type === 'title') tdClasses.push('is-title')
        if (prop.type === 'number') tdClasses.push('is-number')
        if (focused) tdClasses.push('is-focused')
        return (
          <div
            key={prop.id}
            className={tdClasses.join(' ')}
            style={{ width: p.widths[index] }}
            data-cell={cellKey(row.id, prop.id)}
            onMouseDown={() => p.onFocusCell(row.id, prop.id)}
          >
            {prop.type === 'title' && !editing && <RowIcon row={row} />}
            <PropertyCell
              databaseId={p.databaseId}
              row={row}
              prop={prop}
              editing={editing}
              initialText={editing ? p.initialText : undefined}
              discardOnCancel={editing && p.discardOnCancel}
              onStartEdit={() => p.onStartEdit(row.id, prop.id)}
              onStopEdit={p.onStopEdit}
            />
            {prop.type === 'title' && !editing && (
              <button
                type="button"
                className="db-open-button"
                title="Open page (Ctrl+click: new tab)"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  p.onOpen(row.id, event)
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                  p.onOpen(row.id, { button: 1 })
                }}
              >
                Open
              </button>
            )}
          </div>
        )
      })}
      <div className="db-td is-filler" />
    </div>
  )
})
