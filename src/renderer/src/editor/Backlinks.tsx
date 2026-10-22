// "Linked from": the pages whose text links to this one, quietly below its content. Nothing when none.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ChangeEvent, SearchResult } from '@shared/types'
import { Page } from '@/ui/icons'
import { IconGlyph } from '@/ui/IconGlyph'
import { useArchiveCopy } from '@/archive/locale'
import { useEditor } from './context'

/** Edits come in bursts while someone types: look again once they settle. */
const REFRESH_MS = 800

/**
 * Whether a change can alter the list: one that touched a block whose text holds or held a
 * page link, one from another window or from sync (which says nothing about links), or one to
 * a page or block the list shows (renamed, moved to the trash). Typing anywhere else cannot.
 */
export function changesBacklinks(event: ChangeEvent, clientId: string, shown: readonly SearchResult[]): boolean {
  if (event.origin !== clientId || event.links?.length) return true
  if (!shown.length) return false
  const ids = new Set(event.ids)
  return shown.some((page) => ids.has(page.pageId) || ids.has(page.id))
}

export function Backlinks({ pageId }: { pageId: string }): JSX.Element | null {
  const { onOpenPage } = useEditor()
  const [pages, setPages] = useState<SearchResult[]>([])
  const archive = useArchiveCopy()

  useEffect(() => {
    let alive = true
    let timer = 0
    let shown: SearchResult[] = []
    setPages([])
    const load = (): void => {
      window.api.pages
        .backlinks(pageId)
        .then((found) => {
          if (!alive) return
          shown = found
          setPages(found)
        })
        .catch(() => undefined)
    }
    load()
    const off = window.api.onChange((event) => {
      if (!changesBacklinks(event, window.api.clientId, shown)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(load, REFRESH_MS)
    })
    return () => {
      alive = false
      window.clearTimeout(timer)
      off()
    }
  }, [pageId])

  if (!pages.length) return null
  return (
    <section className="pe-content pe-backlinks" aria-label="Linked from">
      <div className="pe-backlinks-heading">Linked from</div>
      {pages.map((page) => (
        <button
          type="button"
          key={page.pageId}
          className="pe-backlink"
          onClick={(e) => onOpenPage(page.pageId, e.ctrlKey || e.metaKey ? { newTab: true } : undefined)}
          onAuxClick={(e) => {
            if (e.button === 1) onOpenPage(page.pageId, { newTab: true })
          }}
        >
          <span className="pe-backlink-head">
            <span className="pe-backlink-icon">{page.icon ? <IconGlyph icon={page.icon} /> : <Page size={14} />}</span>
            <span className="pe-backlink-title">{page.title || 'Untitled'}</span>
            {page.archived && <span className="quickfind-badge">{archive.badge}</span>}
            {page.path.length > 0 && <span className="pe-backlink-path">{page.path.join(' / ')}</span>}
          </span>
          {page.snippet && <span className="pe-backlink-snippet">{page.snippet}</span>}
        </button>
      ))}
    </section>
  )
}
