import { memo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useTree } from '@/store/tree'
import {
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  setQuickFindOpen,
  setSettingsOpen,
  setSidebarWidth,
  toggleSidebar,
  useUi
} from '@/store/ui'
import { IconButton } from '@/ui/Button'
import { Calendar, Check, ChevronLeft, Clock, Feedback, Mic, Moon, Pen, Plus, Search, Settings, Trash } from '@/ui/icons'
import { openFeedback } from '@/feedback/gate'
import { preloadFeedback } from '@/feedback/Host'
import { openCalendar, openToday } from '@/briefing/route'
import { openCloseDay, openNotebook } from '@/notebook/route'
import { openTasks, preloadTasks } from '@/tasks/gate'
import { newMeeting } from '@/meetings/gate'
import { MOD_KEY } from '@/ui/platform'
import { createPage, reportError } from './actions'
import { PageRow, PageTree } from './PageTree'
import { preloadSettings } from './SettingsModal'
import { TrashPopover, preloadTrash } from './TrashPopover'
import { SyncIndicator } from '@/sync/SyncIndicator'
import { ArchiveButton } from '@/archive/ArchiveButton'

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

// Memoised: the shell re-renders on every frame of a sidebar resize; its panels need not.
export const Sidebar = memo(function Sidebar() {
  // Focus mode hides it the way collapsing does, without changing whether it is collapsed.
  const collapsed = useUi((state) => state.sidebarCollapsed || state.focusMode)
  const favorites = useTree((state) => state.favorites)
  const trashRef = useRef<HTMLButtonElement>(null)
  const [trashOpen, setTrashOpen] = useState(false)

  const newRootPage = (): void => void createPage(null).catch(reportError('create the page'))

  return (
    <aside className={collapsed ? 'sidebar glass is-collapsed' : 'sidebar glass'} aria-hidden={collapsed} inert={collapsed}>
      <div className="sidebar-inner">
        <header className="sidebar-header">
          <span className="workspace-badge" aria-hidden="true">
            S
          </span>
          <span className="workspace-name">sel</span>
          <IconButton label="Close sidebar" onClick={toggleSidebar}>
            <ChevronLeft />
          </IconButton>
        </header>

        <div className="sidebar-actions">
          <button type="button" className="sidebar-action is-search" onClick={() => setQuickFindOpen(true)}>
            <Search />
            <span>Search</span>
            <kbd>{MOD_KEY}P</kbd>
          </button>
          <button type="button" className="sidebar-action" onClick={openToday}>
            <Clock />
            <span>Today</span>
          </button>
          <button type="button" className="sidebar-action" onClick={openCalendar}>
            <Calendar />
            <span>Calendar</span>
          </button>
          <button type="button" className="sidebar-action" onPointerEnter={preloadTasks} onFocus={preloadTasks} onClick={openTasks}>
            <Check />
            <span>Tasks</span>
          </button>
          <button type="button" className="sidebar-action" onClick={openNotebook}>
            <Pen />
            <span>Meditations</span>
          </button>
          <button type="button" className="sidebar-action" onClick={openCloseDay}>
            <Moon />
            <span>Close the day</span>
          </button>
          <button type="button" className="sidebar-action" onClick={newRootPage}>
            <Plus />
            <span>New page</span>
          </button>
          <button type="button" className="sidebar-action" onClick={() => void newMeeting()}>
            <Mic />
            <span>New meeting</span>
          </button>
        </div>

        <div className="sidebar-scroll">
          {favorites.length > 0 && (
            <section className="sidebar-section">
              <div className="sidebar-section-title">Favorites</div>
              <div role="tree">
                {favorites.map((id) => (
                  <PageRow key={id} id={id} depth={0} flat />
                ))}
              </div>
            </section>
          )}
          <section className="sidebar-section is-grow">
            <div className="sidebar-section-title">
              <span>Private</span>
              <IconButton size="small" label="Add a page" onClick={newRootPage}>
                <Plus />
              </IconButton>
            </div>
            <PageTree />
          </section>
        </div>

        <footer className="sidebar-footer">
          <button
            type="button"
            ref={trashRef}
            className={trashOpen ? 'sidebar-action is-active' : 'sidebar-action'}
            aria-haspopup="dialog"
            aria-expanded={trashOpen}
            onPointerEnter={preloadTrash}
            onFocus={preloadTrash}
            onClick={() => setTrashOpen((open) => !open)}
          >
            <Trash />
            <span>Trash</span>
          </button>
          <ArchiveButton />
          <button
            type="button"
            className="sidebar-action"
            onPointerEnter={preloadFeedback}
            onFocus={preloadFeedback}
            onClick={() => openFeedback()}
          >
            <Feedback />
            <span>Feedback</span>
          </button>
          <div className="sync-footer-row">
            <button
              type="button"
              className="sidebar-action"
              onPointerEnter={preloadSettings}
              onFocus={preloadSettings}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings />
              <span>Settings</span>
            </button>
            {/* Nothing at all until this device syncs; then a quiet icon that says how it is going. */}
            <SyncIndicator />
          </div>
        </footer>
      </div>
      <Resizer />
      <TrashPopover anchor={trashRef.current} open={trashOpen} onClose={() => setTrashOpen(false)} />
    </aside>
  )
})
