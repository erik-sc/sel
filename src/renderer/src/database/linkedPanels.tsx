// Pickers and lists for linked views: choosing a source database, choosing the page a
// new linked view goes into, and listing every place a database appears. Loaded on
// demand (see lazy.tsx / lazyParts.tsx): most sessions never open any of them.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, ReactNode } from 'react'
import type { Block, BlockProps, ViewType } from '@shared/types'
import { fetchBlocks, getBlock, newId } from '@/store/blocks'
import { ArrowUpRight, Database, Page, Search } from '@/ui/icons'
import * as L from './logic'
import { markFreshChart } from './chartFresh'
import './linked.css'
import { IconGlyph } from '@/ui/IconGlyph'

const storeLookup: L.BlockLookup = { get: (id) => getBlock(id) }

/** Databases and pages whose path is looked up; beyond this the list still works, without paths. */
const MAX_PATHS = 200
const RECENT_PAGES = 200
const SEARCH_LIMIT = 30
const SEARCH_DEBOUNCE_MS = 150

interface PickItem {
  id: string
  title: string
  icon?: string
  kind: 'database' | 'linked' | 'page'
  /** Titles of the pages above the item, root first. */
  path: string
  /** Short note shown at the end of the row ("Source", "This view"). */
  tag?: string
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function titleOr(block: Block | undefined | null, fallback = 'Untitled'): string {
  return L.titleOf(block) || fallback
}

/** Titles of the pages above each block, root first, joined for display. Failures leave a path empty. */
async function loadPaths(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(
    ids.slice(0, MAX_PATHS).map(async (id) => {
      try {
        const ancestors = await window.api.pages.ancestors(id)
        out.set(id, ancestors.map((a) => titleOr(a)).join(' / '))
      } catch {
        /* the row is still useful without its path */
      }
    })
  )
  return out
}

function ItemGlyph({ item }: { item: PickItem }): JSX.Element {
  if (item.icon)
    return (
      <span className="db-pick-icon is-emoji">
        <IconGlyph icon={item.icon} />
      </span>
    )
  return (
    <span className="db-pick-icon">
      {item.kind === 'page' ? <Page size={14} /> : item.kind === 'linked' ? <ArrowUpRight size={14} /> : <Database size={14} />}
    </span>
  )
}

/**
 * A searchable, keyboard-navigable list: type to filter, arrows to move, Enter to
 * choose. Escape is left to the popover around it.
 */
function PickList(props: {
  items: PickItem[]
  label: string
  placeholder: string
  loading: boolean
  /** Shown when the list is empty; `query` is what the user typed, if anything. */
  empty: (query: string) => ReactNode
  onPick: (item: PickItem) => void
  /** Called with the trimmed query when it changes (for lists that search remotely as well). */
  onQuery?: (query: string) => void
  heading?: string
}): JSX.Element {
  const { items, label, placeholder, loading, empty, onPick, onQuery, heading } = props
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionId = (index: number): string => `${listId}-${index}`
  const trimmed = query.trim()

  // Not `autoFocus`: when this code is already loaded the list mounts with its popover, which
  // is still hidden (unplaced) at that point, and the key press or click that opened it has
  // not finished either. One frame later the popover is on screen and the focus is ours.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])

  const shown = useMemo(() => {
    const needle = fold(trimmed)
    if (!needle) return items
    return items.filter((item) => fold(item.title).includes(needle) || fold(item.path).includes(needle))
  }, [items, trimmed])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `onQuery` is the caller's latest closure; only a new query is a reason to call it.
  useEffect(() => {
    onQuery?.(trimmed)
    setActive(0)
  }, [trimmed])

  useEffect(() => {
    listRef.current?.querySelector('.db-pick-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active, shown])

  const index = Math.min(active, Math.max(0, shown.length - 1))

  const onKeyDown = (event: KeyboardEvent): void => {
    // Keys pressed while an IME is composing belong to the composition.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(shown.length ? (index + 1) % shown.length : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(shown.length ? (index - 1 + shown.length) % shown.length : 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (shown[index]) onPick(shown[index])
    }
  }

  return (
    <div className="db-pick">
      <div className="db-pick-search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          aria-label={label}
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown[index] ? optionId(index) : undefined}
          spellCheck={false}
          maxLength={L.MAX_NAME_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="db-pick-list" id={listId} ref={listRef} role="listbox" aria-label={label} aria-busy={loading}>
        {heading && shown.length > 0 && <div className="db-pick-heading">{heading}</div>}
        {shown.map((item, i) => (
          <div
            key={item.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === index}
            className={i === index ? 'db-pick-item is-active' : 'db-pick-item'}
            onMouseMove={() => {
              if (i !== active) setActive(i)
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(item)}
          >
            <ItemGlyph item={item} />
            <span className="db-pick-text">
              <span className="db-pick-title">{item.title}</span>
              {item.path && <span className="db-pick-path">{item.path}</span>}
            </span>
            {item.tag && <span className="db-pick-tag">{item.tag}</span>}
          </div>
        ))}
        {shown.length === 0 && <div className="db-pick-empty">{loading ? 'Loading…' : empty(trimmed)}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Source picker (slash menu: "Linked database view")
// ---------------------------------------------------------------------------

export interface SourcePickerProps {
  /** Called with the props of the linked view to create (`sourceId` and one default table view). */
  onPick: (props: BlockProps) => void
  /** Offered when there is nothing to link to. */
  onCreateNew?: () => void
  /** The type of the single view the linked view starts with (a table when absent). */
  view?: ViewType
}

/** Lists every database that can be a source and hands back the props of a new linked view of the chosen one. */
export function SourcePicker({ onPick, onCreateNew, view = 'table' }: SourcePickerProps): JSX.Element {
  const [items, setItems] = useState<PickItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // Through the store: the chosen database is read from it to derive the view.
    fetchBlocks(() => window.api.databases.list())
      .then(async (databases) => {
        if (!alive) return
        const sources = databases.filter((b) => b.type === 'database' && !L.isLinkedView(b) && !b.trashedAt)
        const base = (paths?: Map<string, string>): PickItem[] =>
          sources.map((b) => ({ id: b.id, title: titleOr(b), icon: L.iconOf(b), kind: 'database', path: paths?.get(b.id) ?? '' }))
        setItems(base())
        setLoading(false)
        const paths = await loadPaths(sources.map((b) => b.id))
        if (alive) setItems(base(paths))
      })
      .catch((error) => {
        console.error('database: listing sources failed', error)
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const pick = (item: PickItem): void => {
    const props = L.linkedViewProps(getBlock(item.id), storeLookup, newId, view)
    if (!props) return
    // A chart that was just inserted offers its type as a one-click choice.
    if (view === 'chart') for (const created of props.views ?? []) markFreshChart(created.id)
    onPick(props)
  }

  return (
    <PickList
      items={items}
      label="Search databases"
      placeholder="Search databases…"
      loading={loading}
      heading={view === 'chart' ? 'Chart a database' : view === 'calc' ? 'Calculate from a database' : 'Link to a database'}
      onPick={pick}
      empty={(query) => (
        <>
          <span>{query ? 'No databases match your search' : 'There are no databases to link to yet'}</span>
          {onCreateNew && (
            <button type="button" className="db-pick-action" onClick={onCreateNew}>
              Create a new database instead
            </button>
          )}
        </>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Related database picker (a new relation property, or a relation pointed elsewhere)
// ---------------------------------------------------------------------------

/** Lists every database a relation can link to (this one included) and reports the chosen one. */
export function RelationTargetPicker({ databaseId, onPick }: { databaseId: string; onPick: (targetId: string) => void }): JSX.Element {
  const [items, setItems] = useState<PickItem[]>([])
  const [loading, setLoading] = useState(true)
  // A linked view relates the rows of its source.
  const ownId = L.sourceIdOf(getBlock(databaseId)) ?? databaseId

  useEffect(() => {
    let alive = true
    fetchBlocks(() => window.api.databases.list())
      .then(async (databases) => {
        if (!alive) return
        const targets = databases.filter((b) => b.type === 'database' && !L.isLinkedView(b) && !b.trashedAt)
        const base = (paths?: Map<string, string>): PickItem[] =>
          targets.map((b) => ({
            id: b.id,
            title: titleOr(b),
            icon: L.iconOf(b),
            kind: 'database',
            path: paths?.get(b.id) ?? '',
            tag: b.id === ownId ? 'This database' : undefined
          }))
        setItems(base())
        setLoading(false)
        const paths = await loadPaths(targets.map((b) => b.id))
        if (alive) setItems(base(paths))
      })
      .catch((error) => {
        console.error('database: listing databases failed', error)
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [ownId])

  return (
    <PickList
      items={items}
      label="Search databases"
      placeholder="Search databases…"
      loading={loading}
      heading="Relate to a database"
      onPick={(item) => onPick(item.id)}
      empty={(query) => <span>{query ? 'No databases match your search' : 'There are no databases yet'}</span>}
    />
  )
}

// ---------------------------------------------------------------------------
// Page picker ("Create linked view…" on a source)
// ---------------------------------------------------------------------------

function pageItem(block: Block, path = ''): PickItem {
  return { id: block.id, title: titleOr(block), icon: L.iconOf(block), kind: 'page', path }
}

/** Lists pages (recently edited first; a search reaches the rest) and reports the chosen one. */
export function PagePicker({ onPick }: { onPick: (pageId: string, title: string) => void }): JSX.Element {
  const [recent, setRecent] = useState<PickItem[]>([])
  const [found, setFound] = useState<PickItem[]>([])
  const [loading, setLoading] = useState(true)
  const request = useRef(0)

  useEffect(() => {
    let alive = true
    window.api.pages
      .listRecent(RECENT_PAGES)
      .then(async (blocks) => {
        if (!alive) return
        const pages = blocks.filter((b) => b.type === 'page' && !b.trashedAt)
        setRecent(pages.map((b) => pageItem(b)))
        setLoading(false)
        const paths = await loadPaths(pages.map((b) => b.id))
        if (alive) setRecent(pages.map((b) => pageItem(b, paths.get(b.id))))
      })
      .catch((error) => {
        console.error('database: listing pages failed', error)
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      request.current += 1
    }
  }, [])

  // Pages that are not among the recent ones are reached through the full-text search.
  const onQuery = (query: string): void => {
    const current = ++request.current
    if (!query) {
      setFound([])
      return
    }
    setTimeout(() => {
      if (current !== request.current) return
      window.api.search
        .query(query, SEARCH_LIMIT)
        .then(async (hits) => {
          const titleHits = hits.filter((hit) => hit.id === hit.pageId)
          const blocks = await window.api.blocks.getMany(titleHits.map((hit) => hit.id))
          if (current !== request.current) return
          const paths = new Map(titleHits.map((hit) => [hit.id, hit.path.map((part) => part || 'Untitled').join(' / ')]))
          setFound(blocks.filter((b) => b.type === 'page' && !b.trashedAt).map((b) => pageItem(b, paths.get(b.id))))
        })
        .catch((error) => console.error('database: searching pages failed', error))
    }, SEARCH_DEBOUNCE_MS)
  }

  const items = useMemo(() => {
    const seen = new Set(recent.map((item) => item.id))
    return [...recent, ...found.filter((item) => !seen.has(item.id))]
  }, [recent, found])

  return (
    <PickList
      items={items}
      label="Search pages"
      placeholder="Search pages…"
      loading={loading}
      heading="Add a linked view to"
      onPick={(item) => onPick(item.id, item.title)}
      onQuery={onQuery}
      empty={(query) => <span>{query ? 'No pages match your search' : 'There are no pages yet'}</span>}
    />
  )
}

// ---------------------------------------------------------------------------
// Locations ("Show all locations")
// ---------------------------------------------------------------------------

/**
 * Every place a database appears: the source itself, then each linked view with the
 * page that contains it. Choosing one opens that page (or the database itself when
 * it is not inside a page).
 */
export function LocationsPanel(props: {
  /** The block the panel was opened from (a source or one of its linked views). */
  databaseId: string
  sourceId: string
  onOpen: (id: string) => void
}): JSX.Element {
  const { databaseId, sourceId, onOpen } = props
  const [items, setItems] = useState<(PickItem & { target: string })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const [sources, locations] = await Promise.all([window.api.blocks.getMany([sourceId]), window.api.databases.locations(sourceId)])
      const source = sources[0]
      const [above, paths] = await Promise.all([
        window.api.pages.ancestors(sourceId).catch(() => [] as Block[]),
        loadPaths(locations.map((l) => l.block.id))
      ])
      if (!alive) return
      const sourceTitle = titleOr(source)
      const sourceItem = {
        id: sourceId,
        title: sourceTitle,
        icon: L.iconOf(source),
        kind: 'database' as const,
        path: above.map((a) => titleOr(a)).join(' / '),
        tag: databaseId === sourceId ? 'Source · this one' : 'Source',
        target: above.length ? above[above.length - 1].id : sourceId
      }
      const views = locations.map((l) => ({
        id: l.block.id,
        title: L.titleOf(l.block) || sourceTitle,
        icon: L.iconOf(l.block) ?? L.iconOf(source),
        kind: 'linked' as const,
        path: paths.get(l.block.id) ?? titleOr(l.page, ''),
        tag: l.block.id === databaseId ? 'This view' : 'Linked view',
        target: l.page?.id ?? l.block.id
      }))
      setItems(source ? [sourceItem, ...views] : views)
      setLoading(false)
    }
    load().catch((error) => {
      console.error('database: listing locations failed', error)
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [databaseId, sourceId])

  return (
    <PickList
      items={items}
      label="Search locations"
      placeholder="Search locations…"
      loading={loading}
      heading={items.length === 1 ? 'Appears in 1 place' : `Appears in ${items.length} places`}
      onPick={(item) => {
        const hit = items.find((candidate) => candidate.id === item.id)
        if (hit) onOpen(hit.target)
      }}
      empty={(query) => <span>{query ? 'No locations match your search' : 'This database does not appear anywhere'}</span>}
    />
  )
}
