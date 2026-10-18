// The link field of the selection toolbar: a url, or a page of the workspace looked up by its words.
import { useEffect, useId, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { SearchResult } from '@shared/types'
import { pageLink, parsePageLink } from '@shared/pageLink'
import { plainText } from '@shared/richtext'
import { Page } from '@/ui/icons'
import { IconGlyph } from '@/ui/IconGlyph'
import { useArchiveCopy } from '@/archive/locale'
import { PAGE_SUGGESTIONS, pageSuggestions, readLinkInput } from './pageLinks'

/** Pause after the last keystroke before pages are looked up. */
const DEBOUNCE_MS = 120

export interface LinkPanelProps {
  value: string
  invalid: boolean
  /** The selection already carries a link (offers Remove). */
  hasLink: boolean
  /** The page being edited, never offered as a target. */
  pageId: string
  onChange(value: string): void
  /** Sets the link (null removes it). */
  onApply(value: string | null): void
  onCancel(): void
}

export function LinkPanel({ value, invalid, hasLink, pageId, onChange, onApply, onCancel }: LinkPanelProps): JSX.Element {
  const [pages, setPages] = useState<SearchResult[]>([])
  const [active, setActive] = useState(-1)
  const [linkedTitle, setLinkedTitle] = useState<string | null>(null)
  const archive = useArchiveCopy()
  const listId = useId()
  const kind = readLinkInput(value)
  const query = kind === 'words' || kind === 'address' ? value.trim() : ''
  const linked = parsePageLink(value.trim())?.pageId ?? null

  useEffect(() => {
    if (!query) {
      setPages([])
      setActive(-1)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      window.api.search
        .query(query, PAGE_SUGGESTIONS * 2)
        .then((found) => {
          if (!alive) return
          const next = pageSuggestions(found, pageId)
          setPages(next)
          // Words pick the first page on Enter; something that reads as an address stays one.
          setActive(next.length && readLinkInput(query) === 'words' ? 0 : -1)
        })
        .catch(() => {
          if (alive) setPages([])
        })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, pageId])

  // A link to a page reads as its address in the field; its title says where it goes.
  useEffect(() => {
    setLinkedTitle(null)
    if (!linked) return
    let alive = true
    window.api.blocks
      .get(linked)
      .then((block) => {
        if (alive) setLinkedTitle(block && !block.trashedAt ? plainText(block.props.title) || 'Untitled' : null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [linked])

  const shown = query ? pages : []
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length) {
      e.preventDefault()
      // -1 is the typed text itself.
      const count = shown.length + 1
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((index) => ((index + 1 + step + count) % count) - 1)
    }
  }

  return (
    <form
      className="pe-tb-panel pe-tb-link"
      onSubmit={(e) => {
        e.preventDefault()
        const page = shown[active]
        onApply(page ? pageLink(page.pageId) : value.trim() || null)
      }}
    >
      <div className="pe-tb-link-row">
        <input
          autoFocus
          value={value}
          placeholder="Paste a link or find a page"
          aria-label="Link URL or page"
          aria-invalid={invalid}
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          spellCheck={false}
          className={invalid ? 'is-invalid' : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="pe-tb-btn pe-tb-wide">
          Apply
        </button>
        {hasLink && (
          <button type="button" className="pe-tb-btn pe-tb-wide" onClick={() => onApply(null)}>
            Remove
          </button>
        )}
      </div>
      {linkedTitle !== null && !shown.length && (
        <div className="pe-tb-linked">
          <Page size={14} />
          <span>{linkedTitle}</span>
        </div>
      )}
      <div className="pe-tb-pages" id={listId} role="listbox" aria-label="Pages" hidden={!shown.length}>
        {shown.map((page, index) => (
          <button
            key={page.pageId}
            id={`${listId}-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            className={index === active ? 'pe-tb-turn-item pe-tb-page is-active' : 'pe-tb-turn-item pe-tb-page'}
            onMouseMove={() => {
              if (index !== active) setActive(index)
            }}
            onClick={() => onApply(pageLink(page.pageId))}
          >
            <span className="pe-tb-page-icon">{page.icon ? <IconGlyph icon={page.icon} /> : <Page size={14} />}</span>
            <span className="pe-tb-page-title">{page.title || 'Untitled'}</span>
            {page.archived && <span className="quickfind-badge">{archive.badge}</span>}
            {page.path.length > 0 && <span className="pe-tb-page-path">{page.path.join(' / ')}</span>}
          </button>
        ))}
      </div>
    </form>
  )
}
