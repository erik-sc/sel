import { useMemo } from 'react'
import type { JSX } from 'react'
import { Page, Plus } from '@/ui/icons'
import * as L from '../logic'
import { RowProps } from '../cells'
import { RowTitleInput, rowTitle, type ViewProps } from '../common'

export function ListView(p: ViewProps): JSX.Element {
  const { schema, view, rows, editingRowId, setEditingRowId } = p
  const props = useMemo(() => L.visibleProps(view, schema), [view, schema])
  return (
    <div className="db-list">
      {rows.map((row) => {
        const editing = editingRowId === row.id
        const title = rowTitle(row)
        return (
          <div
            key={row.id}
            className="db-list-row"
            onClick={(event) => {
              if (!editing) p.onOpen(row.id, event)
            }}
            onAuxClick={(event) => {
              if (event.button === 1) p.onOpen(row.id, { button: 1 })
            }}
            onContextMenu={(event) => p.onRowMenu(event, row.id)}
          >
            <span className="db-list-icon">{L.iconOf(row) ?? <Page size={16} />}</span>
            {editing ? (
              <RowTitleInput row={row} onDone={() => setEditingRowId(null)} />
            ) : (
              <span className={title ? 'db-list-title' : 'db-list-title is-muted'}>{title || 'Untitled'}</span>
            )}
            <RowProps row={row} props={props} className="db-list-props" />
          </div>
        )
      })}
      {rows.length === 0 && <div className="db-empty-row">No rows{view.filters.length ? ' match the filters' : ''}</div>}
      <button type="button" className="db-new-row" onClick={() => p.onNewRow()}>
        <Plus size={14} /> New
      </button>
    </div>
  )
}
