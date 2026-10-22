import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FocusEvent, JSX, KeyboardEvent } from 'react'
import type { Block, Op, PropertySchema } from '@shared/types'
import { MoreHorizontal, Plus } from '@/ui/icons'
import { a11yCopy, announce } from '@/a11y/announce'
import { takeMenuKey } from '@/a11y/keys'
import * as L from '../logic'
import * as actions from '../actions'
import { RowProps } from '../cells'
import { OptionEditPane } from '../SelectEditor'
import { Floating, OptionTag, RowIcon, RowTitleInput, beginDrag, draggedOf, endDrag, rowTitle, type ViewProps } from '../common'

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
  // The card that had the focus last: its column's Tab stop. Every other column's is its first card.
  const [focusId, setFocusId] = useState<string | null>(null)
  // A card moved from the keyboard is drawn again in its new place: the focus follows it there.
  const pendingFocus = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    const card = rootRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)
    if (!card) return
    pendingFocus.current = null
    card.focus({ preventScroll: false })
  })

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

  /** Puts a card in `group`, before `before` (null: at the end of the column). Dropping and the keyboard both move cards so. */
  const moveCard = (rowId: string, group: L.RowGroup, before: string | null): void => {
    // Both ops are built from the row as it is in the store now, not as it was rendered.
    const ops: Op[] = []
    const update = actions.cellUpdateOp(rowId, groupProp, group.key)
    if (update) ops.push(update)
    if (!canReorder) {
      actions.runOps(ops)
      return
    }
    if (before) {
      actions.moveRowBefore(databaseId, rowId, before, ops)
      return
    }
    // End of the column: right after its last other card (not the end of the database).
    const others = group.rows.filter((r) => r.id !== rowId)
    const last = others[others.length - 1]
    if (last) actions.moveRowAfter(databaseId, rowId, last.id, ops)
    else actions.runOps(ops)
  }

  const onColumnDrop = (event: DragEvent<HTMLDivElement>, group: L.RowGroup): void => {
    const dragged = draggedOf('card', databaseId)
    const target = drop
    setDrop(null)
    setDraggingId(null)
    if (!dragged) return
    event.preventDefault()
    endDrag()
    moveCard(dragged.id, group, target && target.group === group.key ? target.before : null)
  }

  const focusCard = (id: string | undefined): void => {
    if (!id) return
    rootRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus()
  }

  // The keys of a focused card (the card itself, not a field being typed in on it).
  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const card = event.target as HTMLElement
    const id = card.dataset.cardId
    if (!id || event.nativeEvent.isComposing) return
    const column = groups.findIndex((g) => g.rows.some((r) => r.id === id))
    const group = groups[column]
    if (!group) return
    const at = group.rows.findIndex((r) => r.id === id)
    const copy = a11yCopy()
    let handled = true
    if (takeMenuKey(event)) p.onRowMenu(event, id, card)
    else if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const to = groups[column + (event.key === 'ArrowLeft' ? -1 : 1)]
        if (to) {
          pendingFocus.current = id
          moveCard(id, to, null)
          announce(copy.cardMoved(to.label))
        }
      } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && canReorder) {
        const up = event.key === 'ArrowUp'
        if (up ? at > 0 : at < group.rows.length - 1) {
          pendingFocus.current = id
          // Down: before the card after the next one, or at the end.
          moveCard(id, group, up ? group.rows[at - 1].id : (group.rows[at + 2]?.id ?? null))
          announce(up ? copy.movedUp : copy.movedDown)
        }
      } else handled = false
    } else if (event.ctrlKey || event.altKey || event.metaKey) {
      if (event.key === 'Enter' && !event.altKey) p.onOpen(id, event)
      else handled = false
    } else {
      switch (event.key) {
        case 'Enter':
          p.onOpen(id)
          break
        case 'ArrowUp':
          focusCard(group.rows[at - 1]?.id)
          break
        case 'ArrowDown':
          focusCard(group.rows[at + 1]?.id)
          break
        case 'Home':
          focusCard(group.rows[0]?.id)
          break
        case 'End':
          focusCard(group.rows[group.rows.length - 1]?.id)
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          // The nearest column that has cards, at about the same height.
          const step = event.key === 'ArrowLeft' ? -1 : 1
          for (let c = column + step; c >= 0 && c < groups.length; c += step) {
            const rows = groups[c].rows
            if (!rows.length) continue
            focusCard(rows[Math.min(at, rows.length - 1)].id)
            break
          }
          break
        }
        default:
          handled = false
      }
    }
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const onCardFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const id = (event.target as HTMLElement).dataset.cardId
    if (id) setFocusId(id)
  }

  const editingOption = optionMenu ? L.findOption(groupProp, optionMenu.optionId) : undefined

  return (
    <div className="db-board" ref={rootRef} onKeyDown={onCardKeyDown} onFocus={onCardFocus}>
      {groups.map((group) => {
        const isTarget = drop?.group === group.key
        const stop = group.rows.some((r) => r.id === focusId) ? focusId : (group.rows[0]?.id ?? null)
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
                    setOptionMenu((prev) => (prev?.optionId === group.key ? null : { optionId: group.key as string, anchor }))
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
            {/* A list only with cards in it: an empty one says nothing and is an error to axe. */}
            <div
              className="db-board-cards"
              role={group.rows.length ? 'list' : undefined}
              aria-label={group.rows.length ? group.label : undefined}
            >
              {group.rows.map((row) => (
                <BoardCard
                  key={row.id}
                  row={row}
                  props={props}
                  skip={groupProp.id}
                  editing={editingRowId === row.id}
                  tabStop={stop === row.id}
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
        <Floating open anchor={optionMenu.anchor} label={`Edit group ${editingOption.name}`} onClose={() => setOptionMenu(null)}>
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
  tabStop,
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
  /** The column's one Tab stop (roving tabindex). */
  tabStop: boolean
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
      role="listitem"
      tabIndex={tabStop ? 0 : -1}
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
