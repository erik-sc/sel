import { memo, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import { useBlock } from '@/store/blocks'
import { create } from 'zustand'
import { preloadDatabase } from '@/database/lazy'
import { openPage, tabPage, useTabs } from '@/store/tabs'
import { ROOT, loadTreeChildren, useTree } from '@/store/tree'
import { setExpanded, setRenaming, useUi } from '@/store/ui'
import { IconButton } from '@/ui/Button'
import { Menu } from '@/ui/Menu'
import { Popover } from '@/ui/Popover'
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from '@/ui/icons'
import {
  createPage,
  dropPage,
  isAncestorOrSelf,
  movePageToRoot,
  pageTitle,
  renamePage,
  reportError,
  type DropPosition
} from './actions'
import { usePageTitle } from './linked'
import { PageIcon } from './PageIcon'
import { sidebarPageMenu } from './pageMenu'

const DRAG_TYPE = 'application/x-sel-page'
/** Left padding of a root row, and how much each level adds, in px. */
const ROW_PADDING = 6
const INDENT = 14
/** Width of the icon slot, which the "No pages inside" note lines up after. */
const LEAD_WIDTH = 24
/** The top and bottom slices of a row that mean "drop before / after" rather than "inside". */
const DROP_EDGE = 0.28

interface DropTarget {
  id: string
  position: DropPosition
}

interface DragState {
  dragId: string | null
  drop: DropTarget | null
}

/*
 * Drag state of the tree (there is one tree per window). A store rather than a context: a
 * row subscribes to the two facts that concern it ("am I being dragged?", "is the drop
 * marker on me?"), so moving the pointer over the tree re-renders two rows, not all of them.
 */
const useDrag = create<DragState>(() => ({ dragId: null, drop: null }))

function setDragId(dragId: string | null): void {
  if (useDrag.getState().dragId !== dragId) useDrag.setState({ dragId })
}

function setDrop(drop: DropTarget | null): void {
  const current = useDrag.getState().drop
  if (current?.id === drop?.id && current?.position === drop?.position) return
  useDrag.setState({ drop })
}

function RenameInput({ id, initial }: { id: string; initial: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    if (commit && ref.current) void renamePage(id, ref.current.value.trim()).catch(reportError('rename the page'))
    setRenaming(null)
  }

  return (
    <input
      ref={ref}
      className="tree-rename"
      defaultValue={initial}
      placeholder="Untitled"
      aria-label="Page title"
      onClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation()
        // Enter and Escape that confirm or cancel an IME composition are not for us.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') finish(true)
        else if (event.key === 'Escape') finish(false)
      }}
    />
  )
}

interface PageRowProps {
  id: string
  depth: number
  /** Favourites are shown flat: no nesting, no drag & drop. */
  flat?: boolean
}

export const PageRow = memo(function PageRow({ id, depth, flat }: PageRowProps) {
  const block = useBlock(id)
  // A boolean, so that switching pages re-renders the two rows involved and no other.
  const active = useTabs((state) => tabPage(state.tabs.find((t) => t.id === state.activeId)) === id)
  const expanded = useUi((state) => !flat && !!state.expanded[id])
  const renaming = useUi((state) => !flat && state.renamingId === id)
  const childIds = useTree((state) => state.children[id])
  const dragging = useDrag((state) => !flat && state.dragId === id)
  const dropPosition = useDrag((state) => (!flat && state.drop?.id === id ? state.drop.position : null))
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | { x: number; y: number } | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  // A linked view goes by its source's title until it is given one of its own.
  const title = usePageTitle(block)

  const expandable = !flat && block?.type === 'page'

  useEffect(() => {
    if (expanded && expandable && childIds === undefined) {
      loadTreeChildren(id).catch(reportError('load the pages inside'))
    }
  }, [expanded, expandable, childIds, id])

  if (!block || block.trashedAt) return null

  const ownTitle = pageTitle(block)

  const onClick = (event: MouseEvent): void => {
    openPage(id, { newTab: event.ctrlKey || event.metaKey })
  }

  const onDragStart = (event: DragEvent): void => {
    event.dataTransfer.setData(DRAG_TYPE, id)
    event.dataTransfer.setData('text/plain', title)
    event.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    const { dragId } = useDrag.getState()
    if (!dragId) return
    event.stopPropagation()
    if (isAncestorOrSelf(dragId, id)) {
      setDrop(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height
    const canNest = block.type === 'page'
    const position: DropPosition = canNest
      ? ratio < DROP_EDGE
        ? 'before'
        : ratio > 1 - DROP_EDGE
          ? 'after'
          : 'inside'
      : ratio < 0.5
        ? 'before'
        : 'after'
    setDrop({ id, position })
  }

  const onDrop = (event: DragEvent): void => {
    const { dragId, drop: target } = useDrag.getState()
    if (!dragId) return
    event.preventDefault()
    event.stopPropagation()
    setDrop(null)
    setDragId(null)
    if (target?.id === id) void dropPage(dragId, id, target.position).catch(reportError('move the page'))
  }

  // Rows are operated from the keyboard too; keys typed in a control inside the row are its own.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPage(id, { newTab: event.ctrlKey || event.metaKey })
    } else if (event.key === 'ArrowRight' && expandable && !expanded) {
      event.preventDefault()
      setExpanded(id, true)
    } else if (event.key === 'ArrowLeft' && expandable && expanded) {
      event.preventDefault()
      setExpanded(id, false)
    } else if (event.key === 'F2' && !flat) {
      event.preventDefault()
      setRenaming(id)
    }
  }

  const classes = ['tree-row']
  if (active) classes.push('is-active')
  if (menuAnchor) classes.push('is-menu-open')
  if (expandable) classes.push('is-expandable')
  if (dropPosition) classes.push(`is-drop-${dropPosition}`)
  if (dragging) classes.push('is-dragging')

  return (
    <>
      <div
        className={classes.join(' ')}
        role="treeitem"
        aria-selected={active}
        aria-expanded={expandable ? expanded : undefined}
        style={{ paddingLeft: ROW_PADDING + depth * INDENT }}
        draggable={!flat && !renaming}
        tabIndex={0}
        onClick={onClick}
        onKeyDown={onKeyDown}
        // A database is about to be opened: have its code ready.
        onPointerEnter={block.type === 'database' ? preloadDatabase : undefined}
        onAuxClick={(event) => {
          if (event.button === 1) openPage(id, { newTab: true })
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuAnchor({ x: event.clientX, y: event.clientY })
        }}
        onDragStart={flat ? undefined : onDragStart}
        onDragEnd={() => {
          setDragId(null)
          setDrop(null)
        }}
        onDragOver={flat ? undefined : onDragOver}
        onDrop={flat ? undefined : onDrop}
      >
        <span className="tree-lead">
          <PageIcon block={block} />
          {expandable && (
            <button
              type="button"
              className="tree-toggle"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={(event) => {
                event.stopPropagation()
                setExpanded(id, !expanded)
              }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </span>
        {renaming ? (
          <RenameInput id={id} initial={ownTitle === 'Untitled' ? '' : ownTitle} />
        ) : (
          <span className="tree-title">{title}</span>
        )}
        {!renaming && (
          <span className="tree-actions" onClick={(event) => event.stopPropagation()}>
            <IconButton
              ref={moreRef}
              size="small"
              label="Rename, duplicate, delete…"
              aria-haspopup="menu"
              aria-expanded={!!menuAnchor}
              onClick={() => setMenuAnchor(menuAnchor ? null : moreRef.current)}
            >
              <MoreHorizontal />
            </IconButton>
            {block.type === 'page' && (
              <IconButton
                size="small"
                label="Add a page inside"
                onClick={() => void createPage(id).catch(reportError('create the page'))}
              >
                <Plus />
              </IconButton>
            )}
          </span>
        )}
      </div>
      {menuAnchor && (
        <Popover open anchor={menuAnchor} onClose={() => setMenuAnchor(null)}>
          <Menu items={sidebarPageMenu(block)} onClose={() => setMenuAnchor(null)} autoFocus />
        </Popover>
      )}
      {expanded && expandable && (
        <div role="group">
          {childIds === undefined ? null : childIds.length === 0 ? (
            <div className="tree-empty" style={{ paddingLeft: ROW_PADDING + (depth + 1) * INDENT + LEAD_WIDTH }}>
              No pages inside
            </div>
          ) : (
            childIds.map((childId) => <PageRow key={childId} id={childId} depth={depth + 1} />)
          )}
        </div>
      )}
    </>
  )
})

/** The workspace page tree with drag & drop reordering / re-parenting. */
export function PageTree() {
  const rootIds = useTree((state) => state.children[ROOT])
  const loaded = useTree((state) => state.loaded)
  // A drop target with the ROOT id means "append to the workspace root".
  const rootDrop = useDrag((state) => state.drop?.id === ROOT)

  return (
    <div
      className={rootDrop ? 'tree is-drop-root' : 'tree'}
      role="tree"
      onDragOver={(event) => {
        // Only reached when not over a row (rows stop propagation).
        if (!useDrag.getState().dragId) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDrop({ id: ROOT, position: 'inside' })
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null)
      }}
      onDrop={(event) => {
        const id = useDrag.getState().dragId
        if (!id) return
        event.preventDefault()
        setDragId(null)
        setDrop(null)
        void movePageToRoot(id).catch(reportError('move the page'))
      }}
    >
      {(rootIds ?? []).map((id) => (
        <PageRow key={id} id={id} depth={0} />
      ))}
      {loaded && rootIds?.length === 0 && <div className="tree-empty tree-empty-root">No pages yet</div>}
      <div className="tree-tail" />
    </div>
  )
}
