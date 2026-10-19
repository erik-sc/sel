// The contents of the Trash popover. Loaded on demand through TrashPopover.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Block } from '@shared/types'
import { openPage } from '@/store/tabs'
import { IconButton } from '@/ui/Button'
import { Trash, Undo } from '@/ui/icons'
import { deletePageForever, pageTitle, reportError, restorePage } from './actions'
import { PageIcon } from './PageIcon'

const MS_PER_MINUTE = 60_000
/** Older than this many days, a date says more than a count. */
const MAX_RELATIVE_DAYS = 30

function ago(timestamp: number | null): string {
  if (!timestamp) return ''
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / MS_PER_MINUTE))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < MAX_RELATIVE_DAYS) return `${days} d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function TrashList({ onClose }: { onClose: () => void }) {
  const [pages, setPages] = useState<Block[] | null>(null)
  const [query, setQuery] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    window.api.pages
      .listTrash()
      .then((list) => setPages([...list].sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))))
      .catch(reportError('load the Trash'))
  }, [])

  useEffect(() => {
    reload()
    inputRef.current?.focus()
    return window.api.onChange(reload)
  }, [reload])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!pages) return []
    return needle ? pages.filter((p) => pageTitle(p).toLowerCase().includes(needle)) : pages
  }, [pages, query])

  return (
    <div className="trash">
      <div className="trash-search">
        <input
          ref={inputRef}
          className="ui-input"
          placeholder="Search pages in Trash"
          aria-label="Search pages in Trash"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="trash-list">
        {pages && visible.length === 0 && <div className="trash-empty">{pages.length ? 'No matches' : 'Trash is empty'}</div>}
        {visible.map((page) => (
          <div
            key={page.id}
            className="trash-row"
            role="button"
            tabIndex={0}
            onClick={() => {
              openPage(page.id)
              onClose()
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
              event.preventDefault()
              openPage(page.id)
              onClose()
            }}
          >
            <PageIcon block={page} />
            <span className="trash-title">{pageTitle(page)}</span>
            <span className="trash-when">{ago(page.trashedAt)}</span>
            <span className="trash-actions" onClick={(event) => event.stopPropagation()}>
              {confirmId === page.id ? (
                <button
                  type="button"
                  className="ui-button is-danger trash-confirm"
                  onBlur={() => setConfirmId(null)}
                  autoFocus
                  onClick={() => {
                    setConfirmId(null)
                    void deletePageForever(page.id).then(reload).catch(reportError('delete the page'))
                  }}
                >
                  Delete forever?
                </button>
              ) : (
                <>
                  <IconButton
                    size="small"
                    label="Restore"
                    onClick={() => void restorePage(page.id).then(reload).catch(reportError('restore the page'))}
                  >
                    <Undo />
                  </IconButton>
                  <IconButton size="small" label="Delete forever" onClick={() => setConfirmId(page.id)}>
                    <Trash />
                  </IconButton>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="trash-footer">Pages stay in Trash until you delete them forever.</div>
    </div>
  )
}
