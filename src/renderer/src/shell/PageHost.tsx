import { Component, memo, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { Block } from '@shared/types'
import { bootMark } from '@/boot'
import { DatabaseView } from '@/database/lazy'
import { PageEditor } from '@/editor/lazy'
import { fetchBlocks, useBlock, useBlockStatus } from '@/store/blocks'
import { closeTab, openPage, useTabs } from '@/store/tabs'
import { setQuickFindOpen } from '@/store/ui'
import { Button } from '@/ui/Button'
import { Archive, Board, Home, Plus, Search, Trash, Undo } from '@/ui/icons'
import { isArchived, unarchivePage } from '@/archive/actions'
import { useArchiveCopy } from '@/archive/locale'
import { goHome, useHomeCopy, useHomeStatus } from '@/home/store'
import { openTemplates, useTemplatesCopy } from '@/templates/gate'
import { preloadTemplates } from '@/templates/Host'
import { PageSkeleton } from '@/ui/Skeleton'
import { createPage, deletePageForever, logError, pageTitle, reportError, restorePage } from './actions'
import { isLinkedView } from './linked'
import { PageIcon } from './PageIcon'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('page failed to render', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page-state">
        <h2>Something went wrong showing this page</h2>
        <p>{this.state.error.message}</p>
        <Button onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    )
  }
}

function TrashBanner({ block }: { block: Block }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="trash-banner" role="status">
      <span>This page is in the Trash.</span>
      <Button
        icon={<Undo />}
        onClick={() => void restorePage(block.id).catch(reportError('restore the page'))}
      >
        Restore
      </Button>
      <Button
        variant="danger"
        icon={<Trash />}
        onBlur={() => setConfirming(false)}
        onClick={() => {
          if (!confirming) {
            setConfirming(true)
            return
          }
          void deletePageForever(block.id)
            .then(() => closeTab())
            .catch(reportError('delete the page'))
        }}
      >
        {confirming ? 'Click again to delete forever' : 'Delete forever'}
      </Button>
    </div>
  )
}

/** Over an archived page: only a notice, the page stays editable (the Trash banner wins when both apply). */
function ArchiveBanner({ block }: { block: Block }) {
  const copy = useArchiveCopy()
  return (
    <div className="archive-banner" role="status">
      <Archive />
      <span>{copy.banner}</span>
      <Button icon={<Undo />} onClick={() => void unarchivePage(block.id)}>
        {copy.unarchive}
      </Button>
    </div>
  )
}

function NotFound() {
  return (
    <div className="page-state">
      <h2>Page not found</h2>
      <p>This page does not exist any more. It may have been deleted forever.</p>
      <div className="page-state-actions">
        <Button icon={<Search />} onClick={() => setQuickFindOpen(true)}>
          Search pages
        </Button>
        <Button onClick={() => closeTab()}>Close tab</Button>
      </div>
    </div>
  )
}

/** Recently edited pages offered on the empty state. */
const RECENT_PAGES = 6

export function EmptyState() {
  const [recent, setRecent] = useState<Block[]>([])
  const homeCopy = useHomeCopy()
  const templatesCopy = useTemplatesCopy()
  const home = useHomeStatus()
  const noTabs = useTabs((state) => state.tabs.length === 0)

  // A window with nothing open shows the home, when there is one it can open.
  useEffect(() => {
    if (noTabs && home.status === 'ready') goHome()
  }, [noTabs, home.status])

  useEffect(() => {
    let alive = true
    bootMark('first-page')
    const load = (): void => {
      fetchBlocks(() => window.api.pages.listRecent(RECENT_PAGES))
        .then((pages) => {
          if (alive) setRecent(pages.filter((p) => !p.trashedAt && !isLinkedView(p)))
        })
        .catch(logError('list recent'))
    }
    load()
    const off = window.api.onChange(load)
    return () => {
      alive = false
      off()
    }
  }, [])

  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <h1>sel</h1>
        <p>Open a page from the sidebar, or start something new.</p>
        <div className="page-state-actions">
          <Button
            variant="primary"
            icon={<Plus />}
            onClick={() => void createPage(null).catch(reportError('create the page'))}
          >
            New page
          </Button>
          <Button icon={<Board />} onPointerEnter={preloadTemplates} onFocus={preloadTemplates} onClick={() => openTemplates()}>
            {templatesCopy.command}
          </Button>
          {home.home !== null && (
            <Button icon={<Home />} disabled={home.status !== 'ready'} onClick={goHome}>
              {homeCopy.openHome}
            </Button>
          )}
          <Button icon={<Search />} onClick={() => setQuickFindOpen(true)}>
            Search
          </Button>
        </div>
        {recent.length > 0 && (
          <div className="empty-recent">
            <div className="empty-recent-title">Recently edited</div>
            <div className="empty-recent-list">
              {recent.map((page) => (
                <button
                  type="button"
                  key={page.id}
                  className="empty-recent-row"
                  onClick={(event) => openPage(page.id, { newTab: event.ctrlKey || event.metaKey })}
                >
                  <PageIcon block={page} />
                  <span>{pageTitle(page)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Renders the routed block: a page editor, a full-page database, or a fallback state. */
export const PageHost = memo(function PageHost({ pageId }: { pageId: string }) {
  const block = useBlock(pageId)
  const status = useBlockStatus(pageId)

  if (status === 'loading') {
    return (
      <div className="page-host" aria-busy="true">
        <div className="page-scroll">
          <PageSkeleton />
        </div>
      </div>
    )
  }
  if (!block || (block.type !== 'page' && block.type !== 'database')) {
    return (
      <div className="page-host">
        <NotFound />
      </div>
    )
  }

  return (
    <div className="page-host">
      {block.trashedAt ? <TrashBanner block={block} /> : isArchived(block) && <ArchiveBanner block={block} />}
      <div className="page-scroll" key={pageId}>
        <ErrorBoundary>
          {block.type === 'database' ? (
            <DatabaseView databaseId={pageId} onOpenPage={openPage} />
          ) : (
            <PageEditor pageId={pageId} onOpenPage={openPage} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
})
