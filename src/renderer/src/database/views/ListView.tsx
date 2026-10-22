import { memo, useCallback, useMemo, useRef } from 'react'
import type { JSX } from 'react'
import type { Block, PropertySchema } from '@shared/types'
import { Page, Plus } from '@/ui/icons'
import * as L from '../logic'
import { RowProps } from '../cells'
import { RowTitleInput, rowTitle, type ViewProps } from '../common'
import { IconGlyph } from '@/ui/IconGlyph'
import { useItemWindow, WINDOW_MIN_ITEMS } from './windowing'

/** A list row's height before it is measured (rows are one line: the table row token). */
const ROW_ESTIMATE = 36

// Memoised: editing one row re-renders that row, not the whole list (a long list
// used to spend a fifth of a second on every edit).
const ListRow = memo(function ListRow({
  row,
  props,
  editing,
  measureRef,
  onDoneEditing,
  onOpen,
  onRowMenu
}: {
  row: Block
  props: PropertySchema[]
  editing: boolean
  measureRef: (el: HTMLElement | null) => (() => void) | undefined
  onDoneEditing: () => void
  onOpen: ViewProps['onOpen']
  onRowMenu: ViewProps['onRowMenu']
}): JSX.Element {
  const title = rowTitle(row)
  const icon = L.iconOf(row)
  return (
    <div
      ref={measureRef}
      className="db-list-row"
      onClick={(event) => {
        if (!editing) onOpen(row.id, event)
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onOpen(row.id, { button: 1 })
      }}
      onContextMenu={(event) => onRowMenu(event, row.id)}
    >
      <span className="db-list-icon">{icon ? <IconGlyph icon={icon} /> : <Page size={16} />}</span>
      {editing ? (
        <RowTitleInput row={row} onDone={onDoneEditing} />
      ) : (
        <span className={title ? 'db-list-title' : 'db-list-title is-muted'}>{title || 'Untitled'}</span>
      )}
      <RowProps row={row} props={props} className="db-list-props" />
    </div>
  )
})

export function ListView(p: ViewProps): JSX.Element {
  const { schema, view, rows, editingRowId, setEditingRowId } = p
  const props = useMemo(() => L.visibleProps(view, schema), [view, schema])
  const onDoneEditing = useCallback(() => setEditingRowId(null), [setEditingRowId])
  // Long lists draw only the rows near the viewport, and always the one being edited.
  const listRef = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => rows.map((row) => row.id), [rows])
  const pinned = useMemo(() => (editingRowId ? [keys.indexOf(editingRowId)] : []), [keys, editingRowId])
  const { slots, measure } = useItemWindow(listRef, {
    keys,
    estimate: ROW_ESTIMATE,
    gap: 0,
    pinned,
    enabled: rows.length >= WINDOW_MIN_ITEMS
  })
  return (
    <div className="db-list" ref={listRef}>
      {slots.flatMap((slot) =>
        slot.kind === 'spacer' ? (
          <div key={slot.key} className="db-window-spacer" style={{ height: slot.height }} aria-hidden="true" />
        ) : (
          rows
            .slice(slot.start, slot.end)
            .map((row) => (
              <ListRow
                key={row.id}
                row={row}
                props={props}
                editing={editingRowId === row.id}
                measureRef={measure(row.id)}
                onDoneEditing={onDoneEditing}
                onOpen={p.onOpen}
                onRowMenu={p.onRowMenu}
              />
            ))
        )
      )}
      {rows.length === 0 && <div className="db-empty-row">No rows{view.filters.length ? ' match the filters' : ''}</div>}
      <button type="button" className="db-new-row" onClick={() => p.onNewRow()}>
        <Plus size={14} /> New
      </button>
    </div>
  )
}
