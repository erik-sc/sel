import { memo, useCallback, useState } from 'react'
import type { DragEvent } from 'react'
import { useBlock } from '@/store/blocks'
import {
  activateTab,
  closeOtherTabs,
  closeTab,
  moveTab,
  newTab,
  tabPage,
  useTabs,
  type Tab
} from '@/store/tabs'
import { toggleSidebar, useUi } from '@/store/ui'
import { IconButton } from '@/ui/Button'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Popover } from '@/ui/Popover'
import { Close, Plus, Sidebar as SidebarIcon } from '@/ui/icons'
import { reportError } from './actions'
import { isTodayRoute, TODAY_TITLE } from '@/briefing/route'
import { usePageTitle } from './linked'
import { PageIcon } from './PageIcon'
import { WindowControls } from './WindowControls'

const DRAG_TYPE = 'application/x-sel-tab'

interface TabItemProps {
  tab: Tab
  active: boolean
  dragging: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>, tabId: string) => void
  onDragOver: (event: DragEvent<HTMLDivElement>, tabId: string) => void
  onDragEnd: () => void
}

// Memoised with handlers that are stable across renders: activating a tab or renaming a
// page re-renders the tabs concerned, not the whole strip.
const TabItem = memo(function TabItem({ tab, active, dragging, onDragStart, onDragOver, onDragEnd }: TabItemProps) {
  const pageId = tabPage(tab)
  const today = isTodayRoute(pageId)
  const block = useBlock(today ? null : pageId)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const pageName = usePageTitle(block)
  const title = today ? TODAY_TITLE : pageId ? pageName : 'New tab'

  const menuItems = (): MenuItem[] => [
    { id: 'close', label: 'Close tab', onSelect: () => closeTab(tab.id) },
    { id: 'close-others', label: 'Close other tabs', onSelect: () => closeOtherTabs(tab.id) },
    { separator: true },
    { id: 'duplicate', label: 'Duplicate tab', disabled: !pageId, onSelect: () => newTab(pageId) },
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
        {pageId && !today && <PageIcon block={block} size={14} />}
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

// Memoised: the shell re-renders on every frame of a sidebar resize; its panels need not.
export const TabBar = memo(function TabBar() {
  const tabs = useTabs((state) => state.tabs)
  const activeId = useTabs((state) => state.activeId)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const [dragId, setDragId] = useState<string | null>(null)

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
        <IconButton label="Open sidebar" className="tabbar-button" onClick={toggleSidebar}>
          <SidebarIcon />
        </IconButton>
      )}
      <div className="tabs" role="tablist" aria-label="Open pages">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            dragging={tab.id === dragId}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
      <IconButton label="New tab" className="tabbar-button" onClick={() => newTab()}>
        <Plus />
      </IconButton>
      <div className="tabbar-drag" aria-hidden="true" onDoubleClick={() => window.api.app.window.toggleMaximize()} />
      <WindowControls />
    </div>
  )
})
