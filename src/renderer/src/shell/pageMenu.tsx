import type { Block } from '@shared/types'
import type { MenuItem } from '@/ui/Menu'
import { ArrowUpRight, Check, Clock, Copy, Home, Page, Plus, Sparkle, Star, StarFilled, Text, Trash, Type } from '@/ui/icons'
import { HOME_COPY } from '@/home/copy'
import { setHome, useHome } from '@/home/store'
import { requestPageAi } from '@/ai/gate'
import { IS_MAC } from '@/ui/platform'
import { openPage } from '@/store/tabs'
import { setHistoryPage, setRenaming } from '@/store/ui'
import { preloadVersionHistory } from '@/versions/VersionHistory'
import { isSystemBlock } from '@shared/system'
import { sourceIdOf } from './linked'
import {
  createPage,
  duplicatePage,
  exportMarkdown,
  reportError,
  toggleFavorite,
  toggleFullWidth,
  trashPage
} from './actions'

/**
 * The last item of both menus. A linked view is not moved to the Trash: it holds no
 * data, so it is simply removed (its source database and rows stay where they are).
 * A built-in database has none: it is part of the app.
 */
function removeItems(block: Block): MenuItem[] {
  return isSystemBlock(block) ? [] : [{ separator: true }, removeItem(block)]
}

function removeItem(block: Block): MenuItem {
  const linked = sourceIdOf(block) !== null
  return {
    id: 'trash',
    label: linked ? 'Remove linked view' : 'Move to Trash',
    icon: <Trash />,
    danger: true,
    disabled: !!block.trashedAt,
    onSelect: () => void trashPage(block.id).catch(reportError(linked ? 'remove the linked view' : 'move the page to the Trash'))
  }
}

/** "Set as home", or, on the page that is the home, the way back. */
function homeItem(block: Block): MenuItem {
  const { home, locale } = useHome.getState()
  const copy = HOME_COPY[locale]
  const isHome = home?.kind === 'page' && home.id === block.id
  return {
    id: 'home',
    label: isHome ? copy.removeAsHome : copy.setAsHome,
    icon: <Home />,
    disabled: !isHome && !!block.trashedAt,
    onSelect: () => void setHome(isHome ? null : { kind: 'page', id: block.id })
  }
}

function openSourceItems(block: Block): MenuItem[] {
  const sourceId = sourceIdOf(block)
  if (sourceId === null) return []
  return [{ id: 'open-source', label: 'Open source database', icon: <ArrowUpRight />, onSelect: () => openPage(sourceId) }]
}

/** Menu shown for a page in the sidebar ("⋯" and right-click). */
export function sidebarPageMenu(block: Block): MenuItem[] {
  const id = block.id
  const items: MenuItem[] = [
    ...openSourceItems(block),
    { id: 'open-tab', label: 'Open in new tab', icon: <Plus />, onSelect: () => openPage(id, { newTab: true }) },
    {
      id: 'open-window',
      label: 'Open in new window',
      icon: <ArrowUpRight />,
      onSelect: () => void window.api.app.newWindow(id).catch(reportError('open a new window'))
    },
    { separator: true },
    { id: 'rename', label: 'Rename', icon: <Type />, onSelect: () => setRenaming(id) },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <Copy />,
      onSelect: () => void duplicatePage(id).catch(reportError('duplicate the page'))
    },
    {
      id: 'favorite',
      label: block.props.favorite ? 'Remove from Favorites' : 'Add to Favorites',
      icon: block.props.favorite ? <StarFilled /> : <Star />,
      onSelect: () => void toggleFavorite(id).catch(reportError('update Favorites'))
    },
    homeItem(block)
  ]
  if (block.type === 'page') {
    items.push({
      id: 'add-subpage',
      label: 'Add a page inside',
      icon: <Page />,
      onSelect: () => void createPage(id).catch(reportError('create the page'))
    })
  }
  items.push(...removeItems(block))
  return items
}

/** Menu behind the "⋯" button in the top bar. */
export function topBarPageMenu(block: Block, ai = false): MenuItem[] {
  const id = block.id
  const items: MenuItem[] = [...openSourceItems(block)]
  if (block.type === 'page') {
    items.push(
      {
        id: 'full-width',
        label: 'Full width',
        icon: block.props.fullWidth ? <Check /> : <span />,
        onSelect: () => void toggleFullWidth(id).catch(reportError('change the page width'))
      },
      { separator: true }
    )
    // AI actions run in the page's editor: the answer is previewed there and only goes in when accepted.
    if (ai && !block.trashedAt) {
      items.push(
        { id: 'ai-summarize', label: 'Summarize page', icon: <Sparkle />, onSelect: () => requestPageAi(id, 'summarize') },
        { id: 'ai-title', label: 'Suggest title', icon: <Sparkle />, onSelect: () => requestPageAi(id, 'title') },
        { separator: true }
      )
    }
  }
  items.push(
    {
      id: 'favorite',
      label: block.props.favorite ? 'Remove from Favorites' : 'Add to Favorites',
      icon: block.props.favorite ? <StarFilled /> : <Star />,
      onSelect: () => void toggleFavorite(id).catch(reportError('update Favorites'))
    },
    homeItem(block),
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <Copy />,
      onSelect: () => void duplicatePage(id, { open: true }).catch(reportError('duplicate the page'))
    },
    {
      id: 'history',
      label: 'Version history',
      icon: <Clock />,
      hint: IS_MAC ? '⌥⇧⌘H' : 'Ctrl+Alt+Shift+H',
      onSelect: () => {
        preloadVersionHistory()
        setHistoryPage(id)
      }
    },
    {
      id: 'export',
      label: 'Export as Markdown…',
      icon: <Text />,
      onSelect: () => void exportMarkdown(id).catch(reportError('export the page'))
    },
    {
      id: 'open-window',
      label: 'Open in new window',
      icon: <ArrowUpRight />,
      onSelect: () => void window.api.app.newWindow(id).catch(reportError('open a new window'))
    },
    ...removeItems(block)
  )
  return items
}
