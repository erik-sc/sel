import { useRef, useState } from 'react'
import type {
  CSSProperties,
  DragEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  SyntheticEvent
} from 'react'
import type { Block, DatabaseView, PropertyType, SelectOption, ViewType } from '@shared/types'
import {
  ArrowUpRight,
  Board,
  Calendar,
  ChartColumn,
  Check,
  Clock,
  Close,
  Formula,
  Gallery,
  Hash,
  Link,
  List,
  Sigma,
  Table,
  Tag,
  Text,
  Type
} from '@/ui/icons'
import { Popover, type PopoverProps } from '@/ui/Popover'
import * as L from './logic'
import * as actions from './actions'
import { useCommitOnUnmount } from './hooks'
import { IconGlyph } from '@/ui/IconGlyph'

export function TypeIcon({ type, size = 14 }: { type: PropertyType; size?: number }): JSX.Element {
  switch (type) {
    case 'title':
      return <Type size={size} />
    case 'number':
      return <Hash size={size} />
    case 'select':
      return <Tag size={size} />
    case 'multi_select':
      return <List size={size} />
    case 'date':
      return <Calendar size={size} />
    case 'checkbox':
      return <Check size={size} />
    case 'url':
      return <Link size={size} />
    case 'created_time':
    case 'last_edited_time':
      return <Clock size={size} />
    case 'relation':
      return <ArrowUpRight size={size} />
    case 'rollup':
      return <Sigma size={size} />
    case 'formula':
      return <Formula size={size} />
    default:
      return <Text size={size} />
  }
}

export function ViewIcon({ type, size = 14 }: { type: ViewType; size?: number }): JSX.Element {
  switch (type) {
    case 'board':
      return <Board size={size} />
    case 'list':
      return <List size={size} />
    case 'gallery':
      return <Gallery size={size} />
    case 'calendar':
      return <Calendar size={size} />
    case 'chart':
      return <ChartColumn size={size} />
    case 'calc':
      return <Sigma size={size} />
    default:
      return <Table size={size} />
  }
}

let weekdays: string[] | undefined
/** Short weekday names of the UI locale, Sunday first (computed once). */
export function weekdayLabels(): string[] {
  weekdays ??= L.weekdayLabels()
  return weekdays
}

export function colorName(color: string | undefined): string {
  return color && (L.OPTION_COLORS as readonly string[]).includes(color) ? color : 'gray'
}

export function tagStyle(color: string | undefined): CSSProperties {
  const c = colorName(color)
  return { background: `var(--c-${c}-bg)`, color: `var(--c-${c})` }
}

export function OptionTag({ option, onRemove }: { option: SelectOption; onRemove?: () => void }): JSX.Element {
  return (
    <span className="db-tag" style={tagStyle(option.color)}>
      <span className="db-tag-label">{option.name}</span>
      {onRemove && (
        <button
          type="button"
          className="db-tag-remove"
          aria-label={`Remove ${option.name}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <Close size={10} />
        </button>
      )}
    </span>
  )
}

/** What is currently being dragged (dataTransfer payloads are not readable during dragover). */
export interface DragPayload {
  kind: 'row' | 'column' | 'card' | 'event' | 'sort' | 'property'
  id: string
  databaseId: string
}

export const dragState: { current: DragPayload | null } = { current: null }

export function endDrag(): void {
  dragState.current = null
}

/**
 * `dragend` is dispatched on the drag source, and never when the source left the
 * DOM mid-drag (a windowed row scrolled away, a re-render). Clearing on the next
 * window-level dragend / drop as well keeps a stale payload from outliving its drag.
 */
function clearWhenDragEnds(payload: DragPayload): void {
  const clear = (): void => {
    window.removeEventListener('dragend', clear, true)
    window.removeEventListener('drop', clear, true)
    // After the drop handlers of this same event have read the payload.
    setTimeout(() => {
      if (dragState.current === payload) endDrag()
    }, 0)
  }
  window.addEventListener('dragend', clear, true)
  window.addEventListener('drop', clear, true)
}

export function beginDrag(event: DragEvent, payload: DragPayload): void {
  dragState.current = payload
  clearWhenDragEnds(payload)
  event.dataTransfer.effectAllowed = 'move'
  try {
    event.dataTransfer.setData('text/plain', payload.id)
  } catch {
    // Some platforms refuse custom data; the module-level payload is enough.
  }
}

export function draggedOf(kind: DragPayload['kind'], databaseId: string): DragPayload | null {
  const d = dragState.current
  return d && d.kind === kind && d.databaseId === databaseId ? d : null
}

export interface OpenModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  button?: number
}

export function wantsNewTab(event: OpenModifiers | undefined): boolean {
  return !!event && (!!event.ctrlKey || !!event.metaKey || event.button === 1)
}

/** Props shared by the view renderers. */
export interface ViewProps {
  databaseId: string
  schema: L.Schema
  view: DatabaseView
  /** Rows of the view: filtered, searched and sorted. */
  rows: Block[]
  inline: boolean
  /** Manual ordering is only meaningful without sorts. */
  canReorder: boolean
  /** Row whose title should be edited in place (just created). */
  editingRowId: string | null
  setEditingRowId: (id: string | null) => void
  onOpen: (rowId: string, event?: OpenModifiers) => void
  /** The row menu: at the pointer, or under `from` (the focused card, cell or event) for the Menu key. */
  onRowMenu: (event: ReactMouseEvent | ReactKeyboardEvent, rowId: string, from?: Element) => void
  /** Creates a row honouring the view filters; returns its id and starts title editing. */
  onNewRow: (input?: { values?: L.Values; afterId?: string | null }) => string
  onAddFilter: (propertyId: string) => void
  /** Rows of the database before the view's filters and the quick search (when known). */
  totalRows?: number
  /** Chart views: opens the chart settings panel of the toolbar. */
  onOpenChartSettings?: () => void
}

export function rowTitle(row: Block): string {
  return L.titleOf(row)
}

/**
 * In-place title editor of a row that was just created (cards, list rows, calendar
 * items). Enter / blur / unmount save; Escape cancels the creation: the row is
 * removed again when nothing was put into it.
 */
export function RowTitleInput({ row, onDone }: { row: Block; onDone: () => void }): JSX.Element {
  const [text, setText] = useState(() => rowTitle(row))
  const done = useRef(false)
  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save) actions.setRowTitle(row.id, text)
    else actions.discardPristineRow(row.id)
    onDone()
  }
  useCommitOnUnmount(() => {
    if (done.current) return
    done.current = true
    actions.setRowTitle(row.id, text)
  })
  return (
    <input
      className="db-inline-title"
      autoFocus
      value={text}
      placeholder="Untitled"
      aria-label="Row title"
      maxLength={L.MAX_TEXT_LENGTH}
      onChange={(event) => setText(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}

export function RowIcon({ row, size = 14 }: { row: Block; size?: number }): JSX.Element | null {
  const icon = L.iconOf(row)
  if (!icon) return null
  return (
    <span className="db-row-icon" style={{ fontSize: size }}>
      <IconGlyph icon={icon} />
    </span>
  )
}

const stop = (event: SyntheticEvent): void => event.stopPropagation()

/**
 * Popover whose content does not leak React events to the component that
 * rendered it (portals bubble through the React tree, not the DOM tree).
 */
export function Floating({ children, ...rest }: PopoverProps): JSX.Element {
  return (
    <Popover {...rest}>
      <div
        className="db-floating"
        onClick={stop}
        onDoubleClick={stop}
        onAuxClick={stop}
        onMouseDown={stop}
        onMouseUp={stop}
        onPointerDown={stop}
        onContextMenu={stop}
        onKeyDown={stop}
        onKeyUp={stop}
        onDragStart={stop}
        onDragOver={stop}
        onDrop={stop}
        onFocus={stop}
        onBlur={stop}
      >
        {children}
      </div>
    </Popover>
  )
}
