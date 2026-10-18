// "Linked from": the pages whose text links to this one, quietly below its content. Nothing when none.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { SearchResult } from '@shared/types'
import { Page } from '@/ui/icons'
import { IconGlyph } from '@/ui/IconGlyph'
import { useArchiveCopy } from '@/archive/locale'
import { useEditor } from './context'

/** Edits come in bursts while someone types: look again once they settle. */
const REFRESH_MS = 800

export function Backlinks({ pageId }: { pageId: string }): JSX.Element | null {
  const { onOpenPage } = useEditor()
  const [pages, setPages] = useState<SearchResult[]>([])
  const archive = useArchiveCopy()

  useEffect(() => {
    let alive = true
    let timer = 0
    setPages([])
    const load = (): void => {
      window.api.pages
        .backlinks(pageId)
        .then((found) => {
          if (alive) setPages(found)
        })
        .catch(() => undefined)
    }
    load()
    const off = window.api.onChange(() => {
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
