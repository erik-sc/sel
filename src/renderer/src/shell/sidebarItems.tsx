// Every item the sidebar can show, by its stable id (see shared/sidebar.ts for the ids, their
// default order and the zones). The sidebar draws from here in the order the `sidebar` setting
// gives, and Settings → Sidebar lists the same entries. A new item adds its id to
// SIDEBAR_ITEMS at its default place and an entry here.
import type { ComponentType, ReactNode } from 'react'
import type { SidebarItemId } from '@shared/sidebar'
import { setQuickFindOpen, setSettingsOpen } from '@/store/ui'
import { IconButton } from '@/ui/Button'
import { Archive, Calendar, Check, Clock, Feedback, Home, Mic, Moon, Pen, Plus, Search, Settings, Sky, Star, Page, Trash } from '@/ui/icons'
import { openFeedback } from '@/feedback/gate'
import { preloadFeedback } from '@/feedback/Host'
import { openCalendar, openToday } from '@/briefing/route'
import { openCloseDay, openNotebook } from '@/notebook/route'
import { openSky, useSkyEnabled } from '@/sky/route'
import { openTasks, preloadTasks } from '@/tasks/gate'
import { newMeeting } from '@/meetings/gate'
import { MOD_KEY } from '@/ui/platform'
import { useTree } from '@/store/tree'
import { SyncIndicator } from '@/sync/SyncIndicator'
import { SyncDone } from '@/sync/icons'
import { ArchiveButton } from '@/archive/ArchiveButton'
import { HomeButton } from '@/home/HomeButton'
import { createPage, reportError } from './actions'
import { NewPageButton } from './NewPageButton'
import { PageRow, PageTree } from './PageTree'
import { preloadSettings } from './SettingsModal'
import { preloadTrash } from './TrashPopover'
import { toggleSidebarPanel, useSidebarPanel } from './sidebarPanels'
import { useSidebarCopy } from './sidebarLayout'

export interface SidebarItemDef {
  id: SidebarItemId
  /** Shown next to the item's name in Settings → Sidebar. */
  icon: ReactNode
  /** What the sidebar shows for it. */
  Render: ComponentType
}

const newRootPage = (): void => void createPage(null).catch(reportError('create the page'))

/** A row of the sidebar that does one thing. */
function Action({ id, icon, onClick, preload }: { id: SidebarItemId; icon: ReactNode; onClick: () => void; preload?: () => void }) {
  const copy = useSidebarCopy()
  return (
    <button type="button" className="sidebar-action" onPointerEnter={preload} onFocus={preload} onClick={onClick}>
      {icon}
      <span>{copy.items[id]}</span>
    </button>
  )
}

function SearchItem() {
  const copy = useSidebarCopy()
  return (
    <button type="button" className="sidebar-action is-search" onClick={() => setQuickFindOpen(true)}>
      <Search />
      <span>{copy.items.search}</span>
      <kbd>{MOD_KEY}P</kbd>
    </button>
  )
}

function FavoritesItem() {
  const copy = useSidebarCopy()
  const favorites = useTree((state) => state.favorites)
  if (favorites.length === 0) return null
  return (
    <section className="sidebar-section">
      <div className="sidebar-section-title">{copy.items.favorites}</div>
      <div role="tree">
        {favorites.map((id) => (
          <PageRow key={id} id={id} depth={0} flat />
        ))}
      </div>
    </section>
  )
}

function PagesItem() {
  const copy = useSidebarCopy()
  return (
    <section className="sidebar-section is-grow">
      <div className="sidebar-section-title">
        <span>{copy.privatePages}</span>
        <IconButton size="small" label={copy.addPage} onClick={newRootPage}>
          <Plus />
        </IconButton>
      </div>
      <PageTree />
    </section>
  )
}

function TrashItem() {
  const copy = useSidebarCopy()
  const open = useSidebarPanel((state) => state.open === 'trash')
  return (
    <button
      type="button"
      className={open ? 'sidebar-action is-active' : 'sidebar-action'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerEnter={preloadTrash}
      onFocus={preloadTrash}
      onClick={(event) => toggleSidebarPanel('trash', event.currentTarget)}
    >
      <Trash />
      <span>{copy.items.trash}</span>
    </button>
  )
}

function SettingsItem() {
  const copy = useSidebarCopy()
  return (
    <button type="button" className="sidebar-action" onPointerEnter={preloadSettings} onFocus={preloadSettings} onClick={() => setSettingsOpen(true)}>
      <Settings />
      <span>{copy.items.settings}</span>
    </button>
  )
}

export const SIDEBAR_ITEM_DEFS: Record<SidebarItemId, SidebarItemDef> = {
  search: { id: 'search', icon: <Search />, Render: SearchItem },
  home: { id: 'home', icon: <Home />, Render: HomeButton },
  today: { id: 'today', icon: <Clock />, Render: () => <Action id="today" icon={<Clock />} onClick={openToday} /> },
  calendar: { id: 'calendar', icon: <Calendar />, Render: () => <Action id="calendar" icon={<Calendar />} onClick={openCalendar} /> },
  tasks: { id: 'tasks', icon: <Check />, Render: () => <Action id="tasks" icon={<Check />} onClick={openTasks} preload={preloadTasks} /> },
  meditations: { id: 'meditations', icon: <Pen />, Render: () => <Action id="meditations" icon={<Pen />} onClick={openNotebook} /> },
  // Gone while the Sky is turned off (see useAvailableItem).
  sky: { id: 'sky', icon: <Sky />, Render: () => <Action id="sky" icon={<Sky />} onClick={openSky} /> },
  'close-day': { id: 'close-day', icon: <Moon />, Render: () => <Action id="close-day" icon={<Moon />} onClick={openCloseDay} /> },
  'new-page': { id: 'new-page', icon: <Plus />, Render: NewPageButton },
  'new-meeting': { id: 'new-meeting', icon: <Mic />, Render: () => <Action id="new-meeting" icon={<Mic />} onClick={() => void newMeeting()} /> },
  favorites: { id: 'favorites', icon: <Star />, Render: FavoritesItem },
  pages: { id: 'pages', icon: <Page />, Render: PagesItem },
  trash: { id: 'trash', icon: <Trash />, Render: TrashItem },
  archive: { id: 'archive', icon: <Archive />, Render: ArchiveButton },
  feedback: { id: 'feedback', icon: <Feedback />, Render: () => <Action id="feedback" icon={<Feedback />} onClick={() => openFeedback()} preload={preloadFeedback} /> },
  settings: { id: 'settings', icon: <Settings />, Render: SettingsItem },
  // Nothing at all until this device syncs; then a quiet icon that says how it is going.
  sync: { id: 'sync', icon: <SyncDone />, Render: SyncIndicator }
}

/**
 * Which items can be shown at all: an item whose feature is off is out of the sidebar and of
 * its settings, whatever the layout says.
 */
export function useAvailableItem(): (id: SidebarItemId) => boolean {
  const skyEnabled = useSkyEnabled((state) => state.enabled)
  return (id) => id !== 'sky' || skyEnabled
}
