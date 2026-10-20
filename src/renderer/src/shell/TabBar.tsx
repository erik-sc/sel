import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { useBlock } from '@/store/blocks'
import { activateTab, closeOtherTabs, closeTab, closeTabsToRight, moveTab, newTab, tabPage, useTabs, type Tab } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { IconButton } from '@/ui/Button'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Popover } from '@/ui/Popover'
import { ChevronDown, Close, Plus, Sidebar as SidebarIcon } from '@/ui/icons'
import { reportError } from './actions'
import { routeTitle } from '@/briefing/route'
import { usePageTitle } from './linked'
import { PageIcon } from './PageIcon'
import { useAiGate } from '@/ai/gate'
import { WindowControls } from './WindowControls'
import { showOrHideSidebar } from './panels'

const DRAG_TYPE = 'application/x-sel-tab'

/** What a tab is called, and the page it shows when that is a page (not a screen). */
function useTabTitle(tab: Tab) {
  const pageId = tabPage(tab)
  const screen = routeTitle(pageId)
  const block = useBlock(screen ? null : pageId)
  const pageName = usePageTitle(block)
  return { pageId, screen, block, title: screen ?? (pageId ? pageName : 'New tab') }
}

interface TabItemProps {
  tab: Tab
  active: boolean
  last: boolean
  dragging: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>, tabId: string) => void
  onDragOver: (event: DragEvent<HTMLDivElement>, tabId: string) => void
  onDragEnd: () => void
}

// Memoised with handlers that are stable across renders: activating a tab or renaming a
// page re-renders the tabs concerned, not the whole strip.
const TabItem = memo(function TabItem({ tab, active, last, dragging, onDragStart, onDragOver, onDragEnd }: TabItemProps) {
  const { pageId, screen, block, title } = useTabTitle(tab)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // No "Duplicate tab": one page, one tab (see openPage).
  const menuItems = (): MenuItem[] => [
    { id: 'close', label: 'Close tab', onSelect: () => closeTab(tab.id) },
    { id: 'close-others', label: 'Close other tabs', onSelect: () => closeOtherTabs(tab.id) },
    { id: 'close-right', label: 'Close tabs to the right', disabled: last, onSelect: () => closeTabsToRight(tab.id) },
    { separator: true },
    {
      id: 'window',
      label: 'Open in new window',
      disabled: !pageId,
      onSelect: () => void window.api.app.newWindow(pageId ?? undefined).catch(reportError('open a new window'))
    }
  ]

  const classes = ['tab']
  if (active) classes.push('is-active')
  if (dragging) classes.push('is-dragging')

  return (
    <>
      <div
        className={classes.join(' ')}
        role="tab"
        aria-selected={active}
        title={title}
        draggable
        // Roving tabindex: Tab reaches the active tab, the arrow keys move along the strip.
        tabIndex={active ? 0 : -1}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            activateTab(tab.id)
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const tabEl = event.currentTarget
            const neighbour = event.key === 'ArrowLeft' ? tabEl.previousElementSibling : tabEl.nextElementSibling
            if (neighbour instanceof HTMLElement) {
              event.preventDefault()
              neighbour.focus()
            }
          }
        }}
        onMouseDown={(event) => {
          if (event.button === 0) activateTab(tab.id)
          // Stop the middle button from starting auto-scroll.
          else if (event.button === 1) event.preventDefault()
        }}
        onAuxClick={(event) => {
          if (event.button === 1) closeTab(tab.id)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        onDragStart={(event) => onDragStart(event, tab.id)}
        onDragOver={(event) => onDragOver(event, tab.id)}
        onDragEnd={onDragEnd}
        onDrop={(event) => event.preventDefault()}
      >
        {pageId && !screen && <PageIcon block={block} size={14} />}
        <span className="tab-title">{title}</span>
        <button
          type="button"
          className="tab-close"
          aria-label="Close tab"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            closeTab(tab.id)
          }}
        >
          <Close size={12} />
        </button>
      </div>
      {menu && (
        <Popover open anchor={menu} onClose={() => setMenu(null)}>
          <Menu items={menuItems()} onClose={() => setMenu(null)} autoFocus />
        </Popover>
      )}
    </>
  )
})

interface TabListRowProps {
  tab: Tab
  active: boolean
  current: boolean
  onHover: () => void
  onGo: () => void
}

function TabListRow({ tab, active, current, onHover, onGo }: TabListRowProps) {
  const { pageId, screen, block, title } = useTabTitle(tab)
  const classes = ['ui-menu-item', 'tab-list-row']
  if (active) classes.push('is-active')
  if (current) classes.push('is-current')
  return (
    <div
      className={classes.join(' ')}
      role="option"
      aria-selected={active}
      aria-current={current || undefined}
      onMouseEnter={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onGo}
    >
      <span className="ui-menu-icon">{pageId && !screen && <PageIcon block={block} size={14} />}</span>
      <span className="ui-menu-label">{title}</span>
      <button
        type="button"
        className="tab-close"
        aria-label="Close tab"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
          closeTab(tab.id)
        }}
      >
        <Close size={12} />
      </button>
    </div>
  )
}

/** Every tab of the window, for when the strip holds more than it shows: Enter goes, Delete closes. */
function TabList({ onClose }: { onClose: () => void }) {
  const tabs = useTabs((state) => state.tabs)
  const activeId = useTabs((state) => state.activeId)
  const rootRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      tabs.findIndex((t) => t.id === activeId)
    )
  )
  const at = Math.min(cursor, tabs.length - 1)

  useEffect(() => {
    // Next frame: the popover stays hidden until it has been placed, and hidden takes no focus.
    const frame = requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    if (tabs.length === 0) onClose()
  }, [tabs.length, onClose])
  useEffect(() => {
    rootRef.current?.querySelectorAll('.tab-list-row')[at]?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const go = (tab: Tab | undefined): void => {
    if (!tab) return
    activateTab(tab.id)
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing || tabs.length === 0) return
    switch (event.key) {
      case 'ArrowDown':
        setCursor((at + 1) % tabs.length)
        break
      case 'ArrowUp':
        setCursor((at - 1 + tabs.length) % tabs.length)
        break
      case 'Home':
        setCursor(0)
        break
      case 'End':
        setCursor(tabs.length - 1)
        break
      case 'Enter':
        go(tabs[at])
        break
      case 'Delete':
      case 'Backspace':
        closeTab(tabs[at].id)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div ref={rootRef} className="ui-menu tab-list" role="listbox" aria-label="Open tabs" tabIndex={-1} onKeyDown={onKeyDown}>
      {tabs.map((tab, index) => (
        <TabListRow
          key={tab.id}
          tab={tab}
          active={index === at}
          current={tab.id === activeId}
          onHover={() => setCursor(index)}
          onGo={() => go(tab)}
        />
      ))}
    </div>
  )
}

/** Marks the ends of the strip that have tabs out of sight (the CSS fades them). */
function markEnds(el: HTMLElement): void {
  el.toggleAttribute('data-more-start', el.scrollLeft > 1)
  el.toggleAttribute('data-more-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
}

/**
 * The strip scrolls once its tabs are at their narrowest (the wheel scrolls it too), keeps the
 * active tab in view, and says whether it holds more than it shows.
 */
function useScrollingStrip(activeId: string | null, count: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1)
      markEnds(el)
    }
    const onScroll = (): void => markEnds(el)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    const onWheel = (event: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      event.preventDefault()
      el.scrollLeft += delta
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setOverflowing(el.scrollWidth > el.clientWidth + 1)
    const tab = el.querySelector<HTMLElement>('.tab.is-active')
    if (!tab) {
      markEnds(el)
      return
    }
    // A little of the neighbours shows too, so that it reads as a strip that goes on.
    const margin = 24
    if (tab.offsetLeft < el.scrollLeft) el.scrollLeft = tab.offsetLeft - margin
    else if (tab.offsetLeft + tab.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = tab.offsetLeft + tab.offsetWidth - el.clientWidth + margin
    }
    markEnds(el)
  }, [activeId, count])

  return { ref, overflowing }
}

// Memoised: the shell re-renders on every frame of a sidebar resize; its panels need not.
export const TabBar = memo(function TabBar() {
  const assistantOpen = useAiGate((state) => state.enabled && state.panelOpen)
  const tabs = useTabs((state) => state.tabs)
  const activeId = useTabs((state) => state.activeId)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const focus = useUi((state) => state.focusMode)
  const [dragId, setDragId] = useState<string | null>(null)
  const strip = useScrollingStrip(activeId, tabs.length)
  const listButton = useRef<HTMLButtonElement>(null)
  const [listOpen, setListOpen] = useState(false)
  const closeList = useCallback((): void => setListOpen(false), [])

  const onDragStart = useCallback((event: DragEvent<HTMLDivElement>, tabId: string): void => {
    event.dataTransfer.setData(DRAG_TYPE, tabId)
    event.dataTransfer.effectAllowed = 'move'
    setDragId(tabId)
    activateTab(tabId)
  }, [])

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, targetId: string): void => {
      if (!dragId) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragId === targetId) return
      const current = useTabs.getState().tabs
      const from = current.findIndex((t) => t.id === dragId)
      const to = current.findIndex((t) => t.id === targetId)
      if (from < 0 || to < 0) return
      const rect = event.currentTarget.getBoundingClientRect()
      const pastMiddle = event.clientX > rect.left + rect.width / 2
      // Only swap once the pointer crossed the neighbour's midpoint, to avoid flicker.
      if ((from < to && pastMiddle) || (from > to && !pastMiddle)) moveTab(dragId, to)
    },
    [dragId]
  )

  const onDragEnd = useCallback((): void => setDragId(null), [])

  return (
    <div className="tabbar">
      {sidebarCollapsed && (
        <IconButton label="Open sidebar" className="tabbar-button" onClick={showOrHideSidebar}>
          <SidebarIcon />
        </IconButton>
      )}
      <div className="tabs" role="tablist" aria-label="Open pages" ref={strip.ref}>
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            last={index === tabs.length - 1}
            dragging={tab.id === dragId}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
      {(strip.overflowing || listOpen) && (
        <IconButton
          label="All tabs"
          className="tabbar-button"
          ref={listButton}
          active={listOpen}
          aria-haspopup="listbox"
          aria-expanded={listOpen}
          onClick={() => setListOpen((open) => !open)}
        >
          <ChevronDown />
        </IconButton>
      )}
      {listOpen && (
        <Popover open anchor={listButton.current} placement="bottom-end" onClose={closeList}>
          <TabList onClose={closeList} />
        </Popover>
      )}
      <IconButton label="New tab" className="tabbar-button" onClick={() => newTab()}>
        <Plus />
      </IconButton>
      <div className="tabbar-drag" aria-hidden="true" onDoubleClick={() => window.api.app.window.toggleMaximize()} />
      {/* With the assistant open, its panel holds the corner of the window and the buttons with it
          (except in focus mode, which hides the panel). */}
      {(!assistantOpen || focus) && <WindowControls />}
    </div>
  )
})
