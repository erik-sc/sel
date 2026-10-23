import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { fetchBlocks, useBlock } from '@/store/blocks'
import { canGoBack, canGoForward, goBack, goForward, openPage, tabPage, useActiveTab } from '@/store/tabs'
import { IconButton } from '@/ui/Button'
import { Menu } from '@/ui/Menu'
import { Popover } from '@/ui/Popover'
import { ChevronLeft, ChevronRight, MoreHorizontal, Sparkle, Star, StarFilled } from '@/ui/icons'
import { MOD_KEY } from '@/ui/platform'
import { useAiGate } from '@/ai/gate'
import { preloadAssistant } from '@/ai/Host'
import { useHerman, usePersona } from '@/herman/gate'
import { RecordingIndicator } from '@/meetings/slot'
import { logError, reportError, toggleFavorite } from './actions'
import { usePageTitle } from './linked'
import { PageIcon } from './PageIcon'
import { topBarPageMenu } from './pageMenu'
import { showOrHideAssistant } from './panels'
import { WordCount } from './WordCount'

function Crumb({ id, current }: { id: string; current?: boolean }) {
  const block = useBlock(id)
  const title = usePageTitle(block)
  if (!block) return <span className="crumb is-placeholder">…</span>
  return (
    <button
      type="button"
      className={current ? 'crumb is-current' : 'crumb'}
      onClick={(event) => {
        if (!current || event.ctrlKey || event.metaKey) {
          openPage(id, { newTab: event.ctrlKey || event.metaKey })
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) openPage(id, { newTab: true })
      }}
    >
      <PageIcon block={block} size={14} />
      <span className="crumb-title">{title}</span>
    </button>
  )
}

/** Ancestors shown in full before the middle of the trail collapses. */
const MAX_VISIBLE_ANCESTORS = 3

function Breadcrumb({ pageId }: { pageId: string }) {
  const block = useBlock(pageId)
  const parentId = block?.parentId
  const [trail, setTrail] = useState<{ pageId: string; ids: string[] }>({ pageId, ids: [] })
  const [hiddenAnchor, setHiddenAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let alive = true
    fetchBlocks(() => window.api.pages.ancestors(pageId))
      .then((ancestors) => {
        if (alive) setTrail({ pageId, ids: ancestors.map((a) => a.id) })
      })
      .catch(logError('ancestors'))
    return () => {
      alive = false
    }
  }, [pageId, parentId])

  const ids = trail.pageId === pageId ? trail.ids : []
  // Long trails keep the root and the direct parent; the middle collapses into "…".
  const long = ids.length > MAX_VISIBLE_ANCESTORS
  const head = long ? ids.slice(0, 1) : ids
  const hidden = long ? ids.slice(1, -1) : []
  const tail = long ? ids.slice(-1) : []

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {head.map((id) => (
        <Fragment key={id}>
          <Crumb id={id} />
          <span className="crumb-sep">/</span>
        </Fragment>
      ))}
      {hidden.length > 0 && (
        <>
          <button
            type="button"
            className="crumb is-more"
            aria-label="Show hidden pages"
            aria-haspopup="dialog"
            aria-expanded={!!hiddenAnchor}
            onClick={(event) => setHiddenAnchor(hiddenAnchor ? null : event.currentTarget)}
          >
            …
          </button>
          <span className="crumb-sep">/</span>
          <Popover open={!!hiddenAnchor} anchor={hiddenAnchor} label="Pages above" onClose={() => setHiddenAnchor(null)}>
            <div className="crumb-menu" onClick={() => setHiddenAnchor(null)}>
              {hidden.map((id) => (
                <Crumb key={id} id={id} />
              ))}
            </div>
          </Popover>
        </>
      )}
      {tail.map((id) => (
        <Fragment key={id}>
          <Crumb id={id} />
          <span className="crumb-sep">/</span>
        </Fragment>
      ))}
      <Crumb id={pageId} current />
    </nav>
  )
}

// Memoised: the shell re-renders on every frame of a sidebar resize; its panels need not.
export const TopBar = memo(function TopBar() {
  const tab = useActiveTab()
  const pageId = tabPage(tab)
  const block = useBlock(pageId)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const isPage = !!block && (block.type === 'page' || block.type === 'database')
  const ai = useAiGate((state) => state.enabled)
  const assistantOpen = useAiGate((state) => state.balloonOpen)
  const herman = useHerman((state) => state.on)
  const { name } = usePersona()

  return (
    <div className="topbar">
      <div className="topbar-nav">
        <IconButton label="Back" disabled={!canGoBack(tab)} onClick={goBack}>
          <ChevronLeft />
        </IconButton>
        <IconButton label="Forward" disabled={!canGoForward(tab)} onClick={goForward}>
          <ChevronRight />
        </IconButton>
      </div>
      {pageId && isPage ? <Breadcrumb pageId={pageId} /> : <div className="breadcrumb" />}
      {pageId && block?.type === 'page' && <WordCount pageId={pageId} />}
      <RecordingIndicator />
      {pageId && isPage && block && (
        <div className="topbar-actions">
          <IconButton
            label={block.props.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            className={block.props.favorite ? 'is-favorite' : undefined}
            onClick={() => void toggleFavorite(pageId).catch(reportError('update Favorites'))}
          >
            {block.props.favorite ? <StarFilled /> : <Star />}
          </IconButton>
          <IconButton
            ref={moreRef}
            label="More"
            active={menuOpen}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal />
          </IconButton>
          <Popover open={menuOpen} anchor={moreRef.current} placement="bottom-end" role="none" onClose={() => setMenuOpen(false)}>
            <Menu items={topBarPageMenu(block, ai)} onClose={() => setMenuOpen(false)} autoFocus />
          </Popover>
        </div>
      )}
      {ai && (
        <div className="topbar-actions">
          <IconButton
            label={herman ? (assistantOpen ? `Hide ${name}` : name) : assistantOpen ? 'Hide assistant' : 'Assistant'}
            shortcut={`${MOD_KEY}J`}
            active={assistantOpen}
            aria-pressed={assistantOpen}
            onPointerEnter={preloadAssistant}
            onFocus={preloadAssistant}
            onClick={showOrHideAssistant}
          >
            <Sparkle />
          </IconButton>
        </div>
      )}
    </div>
  )
})
