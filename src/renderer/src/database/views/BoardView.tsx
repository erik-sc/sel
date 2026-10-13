import { memo, useCallback, useMemo, useState } from 'react'
import type { DragEvent, JSX } from 'react'
import type { Block, Op, PropertySchema } from '@shared/types'
import { MoreHorizontal, Plus } from '@/ui/icons'
import * as L from '../logic'
import * as actions from '../actions'
import { RowProps } from '../cells'
import { OptionEditPane } from '../SelectEditor'
import {
  Floating,
  OptionTag,
  RowIcon,
  RowTitleInput,
  beginDrag,
  draggedOf,
  endDrag,
  rowTitle,
  type ViewProps
} from '../common'

interface DropTarget {
  group: string | null
  /** Card the dragged one would be placed before; null = end of the column. */
  before: string | null
}

function AddGroup({ onAdd }: { onAdd: (name: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const finish = (save: boolean): void => {
    if (save && name.trim()) onAdd(name)
    setName('')
    setOpen(false)
  }
  if (!open) {
    return (
      <button type="button" className="db-board-add-group" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add group
      </button>
    )
  }
  return (
    <div className="db-board-add-group is-editing">
      <input
        className="ui-input"
        autoFocus
        value={name}
        placeholder="Group name"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') finish(true)
          else if (event.key === 'Escape') finish(false)
        }}
      />
    </div>
  )
}

export function BoardView(p: ViewProps): JSX.Element {
  const { databaseId, schema, view, rows, canReorder, editingRowId, setEditingRowId } = p
  const groupProp: PropertySchema | undefined = L.groupProperty(view, schema)
  const props = useMemo(() => L.visibleProps(view, schema), [view, schema])
  const groups = useMemo(() => L.groupRows(rows, groupProp), [rows, groupProp])
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [optionMenu, setOptionMenu] = useState<{ optionId: string; anchor: HTMLElement } | null>(null)

  // Stable handlers for the memoised cards.
  const onDoneEditing = useCallback(() => setEditingRowId(null), [setEditingRowId])
  const onCardDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, rowId: string) => {
      beginDrag(event, { kind: 'card', id: rowId, databaseId })
      setDraggingId(rowId)
    },
    [databaseId]
  )
  const onCardDragEnd = useCallback(() => {
    endDrag()
    setDraggingId(null)
    setDrop(null)
  }, [])

  if (!groupProp) {
    return (
      <div className="db-empty-state">
        <p>A board groups rows by a select property.</p>
        <button
          type="button"
          className="ui-button"
          onClick={() => actions.addProperty(databaseId, 'select', view.id, 'Status', { groupView: true })}
        >
          <Plus size={14} /> Add a Status property
        </button>
      </div>
    )
  }

  const onColumnDragOver = (event: DragEvent<HTMLDivElement>, group: L.RowGroup): void => {
    const dragged = draggedOf('card', databaseId)
    if (!dragged) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    let before: string | null = null
    if (canReorder) {
      const cards = event.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]')
      for (const card of cards) {
        const id = card.dataset.cardId as string
        if (id === dragged.id) continue
        const rect = card.getBoundingClientRect()
        if (event.clientY < rect.top + rect.height / 2) {
          before = id
          break
        }
      }
    }
    setDrop((prev) => (prev && prev.group === group.key && prev.before === before ? prev : { group: group.key, before }))
  }

  const onColumnDrop = (event: DragEvent<HTMLDivElement>, group: L.RowGroup): void => {
    const dragged = draggedOf('card', databaseId)
    const target = drop
    setDrop(null)
    setDraggingId(null)
    if (!dragged) return
    event.preventDefault()
    endDrag()
    // Both ops are built from the row as it is in the store now, not as it was rendered.
    const ops: Op[] = []
    const update = actions.cellUpdateOp(dragged.id, groupProp, group.key)
    if (update) ops.push(update)
    if (!canReorder) {
      actions.runOps(ops)
      return
    }
    const before = target && target.group === group.key ? target.before : null
    if (before) {
      actions.moveRowBefore(databaseId, dragged.id, before, ops)
      return
    }
    // End of the column: right after its last other card (not the end of the database).
    const others = group.rows.filter((r) => r.id !== dragged.id)
    const last = others[others.length - 1]
    if (last) actions.moveRowAfter(databaseId, dragged.id, last.id, ops)
    else actions.runOps(ops)
  }

  const editingOption = optionMenu ? L.findOption(groupProp, optionMenu.optionId) : undefined

  return (
    <div className="db-board">
      {groups.map((group) => {
        const isTarget = drop?.group === group.key
        return (
          <div
            key={group.key ?? '__none'}
            className={isTarget ? 'db-board-column is-drop-target' : 'db-board-column'}
            onDragOver={(event) => onColumnDragOver(event, group)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDrop((prev) => (prev?.group === group.key ? null : prev))
              }
            }}
            onDrop={(event) => onColumnDrop(event, group)}
          >
            <div className="db-board-column-head">
              {group.option ? <OptionTag option={group.option} /> : <span className="db-board-none">{group.label}</span>}
              <span className="db-board-count">{group.rows.length}</span>
              <span className="db-spacer" />
              {group.option && (
                <button
                  type="button"
                  className="db-mini-button"
                  aria-label={`Edit group ${group.label}`}
                  onClick={(event) => {
                    const anchor = event.currentTarget
                    setOptionMenu((prev) =>
                      prev?.optionId === group.key ? null : { optionId: group.key as string, anchor }
                    )
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
              <button
                type="button"
                className="db-mini-button"
                aria-label={`New row in ${group.label}`}
                onClick={() => p.onNewRow({ values: group.key ? { [groupProp.id]: group.key } : {}, afterId: null })}
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="db-board-cards">
              {group.rows.map((row) => (
                <BoardCard
                  key={row.id}
                  row={row}
                  props={props}
                  skip={groupProp.id}
                  editing={editingRowId === row.id}
                  dragging={draggingId === row.id}
                  dropBefore={isTarget && drop?.before === row.id}
                  onDoneEditing={onDoneEditing}
                  onDragStart={onCardDragStart}
                  onDragEnd={onCardDragEnd}
                  onOpen={p.onOpen}
                  onRowMenu={p.onRowMenu}
                />
              ))}
              {isTarget && drop?.before === null && <div className="db-board-drop-line" />}
            </div>
            <button
              type="button"
              className="db-board-new"
              onClick={() => p.onNewRow({ values: group.key ? { [groupProp.id]: group.key } : {} })}
            >
              <Plus size={14} /> New
            </button>
          </div>
        )
      })}
      <AddGroup onAdd={(name) => actions.addOption(databaseId, groupProp.id, name)} />

      {optionMenu && editingOption && (
        <Floating open anchor={optionMenu.anchor} onClose={() => setOptionMenu(null)}>
          <div className="db-select-editor">
            <OptionEditPane
              key={editingOption.id}
              databaseId={databaseId}
              prop={groupProp}
              option={editingOption}
              onDeleted={() => setOptionMenu(null)}
            />
          </div>
        </Floating>
      )}
    </div>
  )
}

// Memoised: dragging a card or editing a row re-renders the cards concerned, not the board.
const BoardCard = memo(function BoardCard({
  row,
  props,
  skip,
  editing,
  dragging,
  dropBefore,
  onDoneEditing,
  onDragStart,
  onDragEnd,
  onOpen,
  onRowMenu
}: {
  row: Block
  props: PropertySchema[]
  skip: string
  editing: boolean
  dragging: boolean
  dropBefore: boolean
  onDoneEditing: () => void
  onDragStart: (event: DragEvent<HTMLDivElement>, rowId: string) => void
  onDragEnd: () => void
  onOpen: ViewProps['onOpen']
  onRowMenu: ViewProps['onRowMenu']
}): JSX.Element {
  const classes = ['db-card']
  if (dragging) classes.push('is-dragging')
  if (dropBefore) classes.push('drop-before')
  const title = rowTitle(row)
  return (
    <div
      className={classes.join(' ')}
      data-card-id={row.id}
      draggable={!editing}
      onDragStart={(event) => onDragStart(event, row.id)}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        if (!editing) onOpen(row.id, event)
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onOpen(row.id, { button: 1 })
      }}
      onContextMenu={(event) => onRowMenu(event, row.id)}
    >
      <div className="db-card-title">
        <RowIcon row={row} />
        {editing ? (
          <RowTitleInput row={row} onDone={onDoneEditing} />
        ) : (
          <span className={title ? 'db-text' : 'db-text is-muted'}>{title || 'Untitled'}</span>
        )}
      </div>
      <RowProps row={row} props={props} skip={skip} className="db-card-props" />
    </div>
  )
})
