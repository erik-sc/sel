// The contents of the Archive popover. Loaded on demand through ArchivePopover.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Block } from '@shared/types'
import { openPage } from '@/store/tabs'
import { IconButton } from '@/ui/Button'
import { ArrowUpRight, Undo } from '@/ui/icons'
import { notifyError } from '@/ui/toast'
import { pageTitle } from '@/shell/actions'
import { PageIcon } from '@/shell/PageIcon'
import { unarchivePage } from './actions'
import { archiveDateLocale, refreshArchiveLocale, useArchiveCopy } from './locale'

function when(timestamp: unknown, locale: string): string {
  if (typeof timestamp !== 'number') return ''
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(
    locale,
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }
  )
}

export function ArchiveList({ onClose }: { onClose: () => void }) {
  const copy = useArchiveCopy()
  const [pages, setPages] = useState<Block[] | null>(null)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    window.api.pages
      .listArchived()
      .then(setPages)
      .catch((error: unknown) => notifyError(copy.couldNotLoad, error))
  }, [copy])

  useEffect(() => {
    refreshArchiveLocale()
    reload()
    inputRef.current?.focus()
    return window.api.onChange(reload)
  }, [reload])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!pages) return []
    return needle ? pages.filter((p) => pageTitle(p).toLowerCase().includes(needle)) : pages
  }, [pages, query])

  const open = (id: string): void => {
    openPage(id)
    onClose()
  }

  return (
    <div className="trash archive">
      <div className="trash-search">
        <input
          ref={inputRef}
          className="ui-input"
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="trash-list">
        {pages && visible.length === 0 && <div className="trash-empty">{pages.length ? copy.noMatches : copy.empty}</div>}
        {visible.map((page) => {
          const date = when(page.props.archivedAt, archiveDateLocale())
          return (
            <div
              key={page.id}
              className="trash-row"
              role="button"
              tabIndex={0}
              onClick={() => open(page.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                open(page.id)
              }}
            >
              <PageIcon block={page} />
              <span className="trash-title">{pageTitle(page)}</span>
              <span className="trash-when" title={date ? copy.archivedOn(date) : undefined}>
                {date}
              </span>
              <span className="trash-actions" onClick={(event) => event.stopPropagation()}>
                <IconButton size="small" label={copy.unarchive} onClick={() => void unarchivePage(page.id).then(reload)}>
                  <Undo />
                </IconButton>
                <IconButton size="small" label={copy.open} onClick={() => open(page.id)}>
                  <ArrowUpRight />
                </IconButton>
              </span>
            </div>
          )
        })}
      </div>
      <div className="trash-footer">{copy.footer}</div>
    </div>
  )
}
