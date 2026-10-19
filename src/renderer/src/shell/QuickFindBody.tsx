// The contents of the quick find dialog. Loaded on demand through QuickFind.tsx.
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { SearchResult } from '@shared/types'
import { openPage } from '@/store/tabs'
import { setQuickFindOpen } from '@/store/ui'
import { Page, Search } from '@/ui/icons'
import { MOD_KEY } from '@/ui/platform'
import { logError, pageTitle, reportError } from './actions'
import { isLinkedView } from './linked'
import { IconGlyph } from '@/ui/IconGlyph'
import { useArchiveCopy } from '@/archive/locale'

const DEBOUNCE_MS = 120
const RECENT_LIMIT = 10
const RESULT_LIMIT = 30

export function QuickFindBody() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [recent, setRecent] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)
  const listId = useId()
  const archive = useArchiveCopy()
  const optionId = (index: number): string => `${listId}-${index}`

  const trimmed = query.trim()
  const items = trimmed ? results : recent

  useEffect(() => {
    inputRef.current?.focus()
    let alive = true
    window.api.pages
      .listRecent(RECENT_LIMIT)
      .then((pages) => {
        if (!alive) return
        setRecent(
          pages
            // A linked view is another place its source appears: the source is what gets listed.
            .filter((p) => !p.trashedAt && !isLinkedView(p))
            .map((p) => ({ id: p.id, pageId: p.id, title: pageTitle(p), icon: p.props.icon, path: [] }))
        )
      })
      .catch(logError('list recent'))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const request = ++requestRef.current
    if (!trimmed) {
      setResults([])
      setSearching(false)
      setActive(0)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      window.api.search
        .query(trimmed, RESULT_LIMIT)
        .then((found) => {
          if (request !== requestRef.current) return
          setResults(found)
          setActive(0)
        })
        .catch(reportError('search'))
        .finally(() => {
          if (request === requestRef.current) setSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [trimmed])

  useEffect(() => {
    listRef.current?.querySelector('.quickfind-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active, items])

  const choose = (item: SearchResult | undefined, inNewTab: boolean): void => {
    if (!item) return
    setQuickFindOpen(false)
    openPage(item.pageId, { newTab: inNewTab })
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // Keys pressed while an IME is composing belong to the composition.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (items.length ? (index + 1) % items.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (items.length ? (index - 1 + items.length) % items.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(items[active], event.ctrlKey || event.metaKey)
    }
  }

  return (
    <>
      <div className="quickfind-input">
        <Search />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search pages and content…"
          aria-label="Search pages and content"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items[active] ? optionId(active) : undefined}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="quickfind-list" id={listId} ref={listRef} role="listbox" aria-label="Results">
        {!trimmed && items.length > 0 && <div className="quickfind-heading">Recent</div>}
        {items.map((item, index) => (
          <div
            key={`${item.id}:${index}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={index === active ? 'quickfind-item is-active' : 'quickfind-item'}
            onMouseMove={() => {
              if (index !== active) setActive(index)
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => choose(item, event.ctrlKey || event.metaKey)}
            onAuxClick={(event) => {
              if (event.button === 1) choose(item, true)
            }}
          >
            <span className="quickfind-icon">{item.icon ? <IconGlyph icon={item.icon} /> : <Page />}</span>
            <span className="quickfind-text">
              <span className="quickfind-title">
                {item.title || 'Untitled'}
                {item.archived && <span className="quickfind-badge">{archive.badge}</span>}
                {item.path.length > 0 && <span className="quickfind-path">{item.path.join(' / ')}</span>}
              </span>
              {item.snippet && <span className="quickfind-snippet">{item.snippet}</span>}
            </span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="quickfind-empty">{trimmed ? (searching ? 'Searching…' : 'No results') : 'Type to search your pages'}</div>
        )}
      </div>
      <div className="quickfind-footer">
        <span>
          <kbd>↑↓</kbd> Select
        </span>
        <span>
          <kbd>Enter</kbd> Open
        </span>
        <span>
          <kbd>{MOD_KEY}Enter</kbd> Open in new tab
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </>
  )
}
