import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, RefObject } from 'react'
import type { Block, PropertySchema } from '@shared/types'
import { useBlocks } from '@/store/blocks'
import { Plus } from '@/ui/icons'
import * as L from '../logic'
import { RowProps } from '../cells'
import { RowIcon, RowTitleInput, rowTitle, type ViewProps } from '../common'
import { IconGlyph } from '@/ui/IconGlyph'
import { useGap, useItemWindow, WINDOW_MIN_ITEMS } from './windowing'

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
  measureRef,
  onDoneEditing,
  onOpen,
  onRowMenu
}: {
  row: Block
  props: PropertySchema[]
  editing: boolean
  measureRef: ((el: HTMLElement | null) => (() => void) | undefined) | undefined
  onDoneEditing: () => void
  onOpen: ViewProps['onOpen']
  onRowMenu: ViewProps['onRowMenu']
}): JSX.Element {
  const title = rowTitle(row)
  const cover = coverStyle(row.props?.cover)
  return (
    <div
      ref={measureRef}
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

/** A gallery row's height before it is measured: cover or preview, title and a line of properties. */
const ROW_ESTIMATE = 220
const NEW_KEY = '__new'

/** How many columns the grid lays out (auto-fill: it depends on the width). */
function useGridColumns(ref: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void => {
      const tracks = getComputedStyle(el)
        .gridTemplateColumns.split(' ')
        .filter((track) => track && track !== 'none').length
      setColumns(Math.max(1, tracks))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return columns
}

export function GalleryView(p: ViewProps): JSX.Element {
  const { schema, view, rows, editingRowId, setEditingRowId } = p
  const props = useMemo(() => L.visibleProps(view, schema), [view, schema])
  const onDoneEditing = useCallback(() => setEditingRowId(null), [setEditingRowId])
  // Big galleries draw only the grid rows near the viewport (and the card being edited). A grid
  // row is one window item; its first card is measured, the others stretch to its height.
  const gridRef = useRef<HTMLDivElement>(null)
  const columns = useGridColumns(gridRef)
  const gap = useGap(gridRef)
  const enabled = rows.length >= WINDOW_MIN_ITEMS
  // The "New" card is the last item of the grid.
  const cells = rows.length + 1
  const keys = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < cells; i += columns) out.push(rows[i]?.id ?? NEW_KEY)
    return out
  }, [rows, cells, columns])
  const pinned = useMemo(() => {
    const at = editingRowId ? rows.findIndex((row) => row.id === editingRowId) : -1
    return at < 0 ? [] : [Math.floor(at / columns)]
  }, [rows, editingRowId, columns])
  const { slots, measure } = useItemWindow(gridRef, { keys, estimate: ROW_ESTIMATE, gap, pinned, enabled })

  const card = (index: number, first: boolean): JSX.Element => {
    const ref = first ? measure(keys[Math.floor(index / columns)]) : undefined
    if (index === rows.length) {
      return (
        <button key={NEW_KEY} ref={ref} type="button" className="db-gallery-card is-new" onClick={() => p.onNewRow()}>
          <Plus size={14} /> New
        </button>
      )
    }
    const row = rows[index]
    return (
      <GalleryCard
        key={row.id}
        row={row}
        props={props}
        editing={editingRowId === row.id}
        measureRef={ref}
        onDoneEditing={onDoneEditing}
        onOpen={p.onOpen}
        onRowMenu={p.onRowMenu}
      />
    )
  }

  return (
    <div className="db-gallery" ref={gridRef}>
      {slots.flatMap((slot) => {
        if (slot.kind === 'spacer') {
          return <div key={slot.key} className="db-window-spacer is-grid-row" style={{ height: slot.height }} aria-hidden="true" />
        }
        const out: JSX.Element[] = []
        const end = enabled ? Math.min(cells, slot.end * columns) : cells
        for (let i = enabled ? slot.start * columns : 0; i < end; i++) out.push(card(i, enabled && i % columns === 0))
        return out
      })}
    </div>
  )
}
