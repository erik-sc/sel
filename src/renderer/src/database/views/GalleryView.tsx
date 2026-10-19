import { memo, useCallback, useMemo } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { Block, PropertySchema } from '@shared/types'
import { useBlocks } from '@/store/blocks'
import { Plus } from '@/ui/icons'
import * as L from '../logic'
import { RowProps } from '../cells'
import { RowIcon, RowTitleInput, rowTitle, type ViewProps } from '../common'
import { IconGlyph } from '@/ui/IconGlyph'

/** Body blocks read for the text preview of a card without a cover. */
const PREVIEW_BLOCKS = 6

/** Inline style for a stored cover, or null when the value is not a safe colour / image. */
function coverStyle(cover: unknown): CSSProperties | null {
  const safe = L.coverStyle(cover)
  if (!safe) return null
  if (safe.kind === 'css') return { background: safe.background }
  return { backgroundImage: safe.backgroundImage, backgroundSize: 'cover', backgroundPosition: 'center' }
}

/** First lines of the page body, loaded lazily through the block store. */
function BodyPreview({ row }: { row: Block }): JSX.Element {
  const ids = useMemo(() => L.contentOf(row).slice(0, PREVIEW_BLOCKS), [row])
  const blocks = useBlocks(ids)
  const lines: string[] = []
  for (const block of blocks) {
    if (!block || block.type === 'page' || block.type === 'database') continue
    const text = L.titleOf(block)
    if (text) lines.push(text)
  }
  const icon = L.iconOf(row)
  if (!lines.length) return <div className="db-gallery-preview is-empty">{icon ? <IconGlyph icon={icon} /> : ''}</div>
  return (
    <div className="db-gallery-preview">
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  )
}

// Memoised: editing one row re-renders its card, not the whole gallery.
const GalleryCard = memo(function GalleryCard({
  row,
  props,
  editing,
  onDoneEditing,
  onOpen,
  onRowMenu
}: {
  row: Block
  props: PropertySchema[]
  editing: boolean
  onDoneEditing: () => void
  onOpen: ViewProps['onOpen']
  onRowMenu: ViewProps['onRowMenu']
}): JSX.Element {
  const title = rowTitle(row)
  const cover = coverStyle(row.props?.cover)
  return (
    <div
      className="db-gallery-card"
      onClick={(event) => {
        if (!editing) onOpen(row.id, event)
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onOpen(row.id, { button: 1 })
      }}
      onContextMenu={(event) => onRowMenu(event, row.id)}
    >
      {cover ? <div className="db-gallery-cover" style={cover} /> : <BodyPreview row={row} />}
      <div className="db-gallery-body">
        <div className="db-card-title">
          <RowIcon row={row} />
          {editing ? (
            <RowTitleInput row={row} onDone={onDoneEditing} />
          ) : (
            <span className={title ? 'db-text' : 'db-text is-muted'}>{title || 'Untitled'}</span>
          )}
        </div>
        <RowProps row={row} props={props} className="db-card-props" />
      </div>
    </div>
  )
})

export function GalleryView(p: ViewProps): JSX.Element {
  const { schema, view, rows, editingRowId, setEditingRowId } = p
  const props = useMemo(() => L.visibleProps(view, schema), [view, schema])
  const onDoneEditing = useCallback(() => setEditingRowId(null), [setEditingRowId])
  return (
    <div className="db-gallery">
      {rows.map((row) => (
        <GalleryCard
          key={row.id}
          row={row}
          props={props}
          editing={editingRowId === row.id}
          onDoneEditing={onDoneEditing}
          onOpen={p.onOpen}
          onRowMenu={p.onRowMenu}
        />
      ))}
      <button type="button" className="db-gallery-card is-new" onClick={() => p.onNewRow()}>
        <Plus size={14} /> New
      </button>
    </div>
  )
}
