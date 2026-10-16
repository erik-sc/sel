import { memo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { resolveSidebar, type SidebarItemId } from '@shared/sidebar'
import { SIDEBAR_MAX, SIDEBAR_MIN, setSidebarWidth, toggleSidebar, useUi } from '@/store/ui'
import { IconButton } from '@/ui/Button'
import { Menu } from '@/ui/Menu'
import { Popover } from '@/ui/Popover'
import { ChevronLeft } from '@/ui/icons'
import { ArchivePopover } from '@/archive/ArchivePopover'
import { TrashPopover } from './TrashPopover'
import { SIDEBAR_ITEM_DEFS, useAvailableItem } from './sidebarItems'
import { customizeSidebar, setSidebarItemHidden, useLayout, useSidebarCopy } from './sidebarLayout'
import { closeSidebarPanel, useSidebarPanel } from './sidebarPanels'
import './sidebar.css'

/** Pixels the divider moves per arrow key press. */
const RESIZE_STEP = 16

function Resizer() {
  const [dragging, setDragging] = useState(false)
  const stored = useUi((state) => state.sidebarWidth)

  /** The width on screen: the dragged one, or whatever the appearance token gives. */
  const currentWidth = (el: HTMLElement): number =>
    useUi.getState().sidebarWidth ?? el.parentElement?.getBoundingClientRect().width ?? SIDEBAR_MIN

  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = currentWidth(event.currentTarget)
    setDragging(true)
    document.body.classList.add('is-resizing')
    // Mouse moves arrive faster than frames are painted: apply the latest one per frame.
    let frame = 0
    let latestX = startX
    const apply = (): void => {
      frame = 0
      setSidebarWidth(startWidth + latestX - startX, false)
    }
    const onMove = (move: MouseEvent): void => {
      latestX = move.clientX
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onUp = (): void => {
      if (frame) {
        cancelAnimationFrame(frame)
        apply()
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-resizing')
      setDragging(false)
      // A press without movement leaves the width alone (still following the token, if it was).
      setSidebarWidth(useUi.getState().sidebarWidth, true)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === 'ArrowLeft' ? -RESIZE_STEP : event.key === 'ArrowRight' ? RESIZE_STEP : 0
    if (!delta) return
    event.preventDefault()
    setSidebarWidth(currentWidth(event.currentTarget) + delta)
  }

  return (
    <div
      className={dragging ? 'sidebar-resizer is-dragging' : 'sidebar-resizer'}
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={stored ?? undefined}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      // Back to the width the appearance settings ask for.
      onDoubleClick={() => setSidebarWidth(null)}
    />
  )
}

/** One item, with the right-click menu that hides it or opens the sidebar's settings. */
function Item({ id, onMenu }: { id: SidebarItemId; onMenu: (id: SidebarItemId, x: number, y: number) => void }) {
  const { Render } = SIDEBAR_ITEM_DEFS[id]
  return (
    <div
      className="sidebar-item"
      data-sidebar-item={id}
      onContextMenu={(event) => {
        // A page row has a menu of its own.
        if (event.defaultPrevented) return
        event.preventDefault()
        onMenu(id, event.clientX, event.clientY)
      }}
    >
      <Render />
    </div>
  )
}

/** The items of the top or the footer. Settings with Sync right after it share a row, as they always have. */
function Items({ ids, onMenu }: { ids: SidebarItemId[]; onMenu: (id: SidebarItemId, x: number, y: number) => void }) {
  const out: ReactNode[] = []
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]
    if (id === 'settings' && ids[index + 1] === 'sync') {
      out.push(
        <div key="settings+sync" className="sync-footer-row">
          <Item id="settings" onMenu={onMenu} />
          <Item id="sync" onMenu={onMenu} />
        </div>
      )
      index++
    } else if (id === 'sync') {
      out.push(
        <div key="sync" className="sync-footer-row">
          <Item id="sync" onMenu={onMenu} />
        </div>
      )
    } else out.push(<Item key={id} id={id} onMenu={onMenu} />)
  }
  return out
}

// Memoised: the shell re-renders on every frame of a sidebar resize; its panels need not.
export const Sidebar = memo(function Sidebar() {
  // Focus mode hides it the way collapsing does, without changing whether it is collapsed.
  const collapsed = useUi((state) => state.sidebarCollapsed || state.focusMode)
  const copy = useSidebarCopy()
  const layout = useLayout()
  const available = useAvailableItem()
  const { top, middle, footer } = resolveSidebar(layout, available)
  const empty = top.length + middle.length + footer.length === 0
  const panel = useSidebarPanel()
  const [menu, setMenu] = useState<{ id: SidebarItemId; x: number; y: number } | null>(null)
  const onMenu = (id: SidebarItemId, x: number, y: number): void => setMenu({ id, x, y })

  return (
    <aside className={collapsed ? 'sidebar glass is-collapsed' : 'sidebar glass'} aria-hidden={collapsed} inert={collapsed}>
      <div className="sidebar-inner">
        <header className="sidebar-header">
          <span className="workspace-badge" aria-hidden="true">
            S
          </span>
          <span className="workspace-name">sel</span>
          <IconButton label={copy.closeSidebar} onClick={toggleSidebar}>
            <ChevronLeft />
          </IconButton>
        </header>

        {empty ? (
          <div className="sidebar-empty">
            <span>{copy.empty}</span>
            <span aria-hidden="true">·</span>
            <button type="button" className="sidebar-empty-action" onClick={customizeSidebar}>
              {copy.emptyAction}
            </button>
          </div>
        ) : (
          <>
            {top.length > 0 && (
              <div className="sidebar-actions">
                <Items ids={top} onMenu={onMenu} />
              </div>
            )}
            {/* Always there, even empty: it keeps the footer at the bottom. */}
            <div className="sidebar-scroll">
              {middle.map((id) => (
                <Item key={id} id={id} onMenu={onMenu} />
              ))}
            </div>
            {footer.length > 0 && (
              <footer className="sidebar-footer">
                <Items ids={footer} onMenu={onMenu} />
              </footer>
            )}
          </>
        )}
      </div>
      <Resizer />
      <TrashPopover anchor={panel.anchor} open={panel.open === 'trash'} onClose={closeSidebarPanel} />
      <ArchivePopover anchor={panel.anchor} open={panel.open === 'archive'} onClose={closeSidebarPanel} />
      {menu && (
        <Popover open anchor={menu} onClose={() => setMenu(null)}>
          <Menu
            autoFocus
            onClose={() => setMenu(null)}
            items={[
              { id: 'hide', label: copy.hide, onSelect: () => void setSidebarItemHidden(menu.id, true) },
              { id: 'customize', label: copy.customize, onSelect: customizeSidebar }
            ]}
          />
        </Popover>
      )}
    </aside>
  )
})
