import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Block, DatabaseView as DatabaseViewModel, ViewType } from '@shared/types'
import { useBlocks } from '@/store/blocks'
import { IconGlyph } from '@/ui/IconGlyph'
import { IconPicker } from '@/ui/IconPicker'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Tooltip } from '@/ui/Tooltip'
import { notifyError, toast } from '@/ui/toast'
import type { PopoverAnchor } from '@/ui/Popover'
import { isMenuKeyEcho, keyboardAnchor } from '@/a11y/keys'
import { ArrowUpRight, ChartColumn, Close, Copy, Filter, MoreHorizontal, Plus, Search, Sort, Table, Trash, Undo } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { Floating, ViewIcon, wantsNewTab, type OpenModifiers, type ViewProps } from './common'
import { RenameInput, TitleInput } from './inputs'
import { bootMark, whenIdle } from '@/boot'
import {
  BoardView,
  CalcView,
  CalendarView,
  ChartPanel,
  ChartView,
  FilterPanel,
  GalleryView,
  LocationsPanel,
  PagePicker,
  PartFallback,
  PropertiesPanel,
  SortPanel,
  preloadChartPanel,
  preloadDatePicker,
  preloadLinkedPanels,
  preloadPanels,
  preloadView
} from './lazyParts'
import { useResolvedDatabase } from './resolved'
import { RelatedContext, useRelatedCells } from './related'
import { TableView } from './views/TableView'
import { ListView } from './views/ListView'
import './database.css'

const EMPTY: string[] = []
const ICON_SIZE_PAGE = 28
const ICON_SIZE_INLINE = 16
/** Remembers the active view of each database for the lifetime of the window. */
const activeViews = new Map<string, string>()
const settingKey = (databaseId: string): string => `database.activeView.${databaseId}`

/** Makes `viewId` the view a database opens on when it is next mounted (the Tasks screen links to views). */
export function chooseView(databaseId: string, viewId: string): void {
  activeViews.set(databaseId, viewId)
  window.api.app.setSetting(settingKey(databaseId), viewId).catch(() => undefined)
}

type Panel = 'filter' | 'sort' | 'properties' | 'chart'

const PANEL_LABEL: Record<Panel, string> = { filter: 'Filters', sort: 'Sorts', properties: 'Properties', chart: 'Chart settings' }

/** Popovers opened from the database menu ("⋯" in the header). */
type LinkPanel = 'menu' | 'locations' | 'link'

/**
 * What a linked view shows while its source cannot be used: nothing of the source,
 * and the two things that can be done about it.
 */
function SourceUnavailable(props: { databaseId: string; inline: boolean; trashedId: string | null }): JSX.Element {
  const { databaseId, inline, trashedId } = props
  const [busy, setBusy] = useState(false)
  const restore = (): void => {
    if (!trashedId || busy) return
    setBusy(true)
    // The change event that follows refreshes the source, and this view with it.
    window.api.pages
      .restore(trashedId)
      .catch((error: unknown) => notifyError('Could not restore the source database.', error))
      .finally(() => setBusy(false))
  }
  return (
    <div className={inline ? 'db-root is-inline is-unavailable' : 'db-root is-unavailable'}>
      <div className="db-unavailable" role="status">
        <span className="db-unavailable-text">
          {trashedId ? "This view's source database is in the trash" : "This view's source database was deleted"}
        </span>
        <span className="db-unavailable-actions">
          {trashedId && (
            <button type="button" className="db-link-button" disabled={busy} onClick={restore}>
              <Undo size={14} /> Restore
            </button>
          )}
          <button type="button" className="db-link-button is-danger" onClick={() => actions.removeLinkedView(databaseId)}>
            <Trash size={14} /> Remove view
          </button>
        </span>
      </div>
    </div>
  )
}

export function DatabaseView(props: {
  databaseId: string
  inline?: boolean
  onOpenPage: (id: string, opts?: { newTab?: boolean }) => void
}): JSX.Element {
  const { databaseId, inline = false, onOpenPage } = props
  // `databaseId` is the block on screen. It owns the views; schema and rows are its own too,
  // unless it is a linked view: then they are its source's (loaded, pinned and watched here).
  const resolved = useResolvedDatabase(databaseId, !inline)
  const db = resolved?.view
  const isDatabase = db?.type === 'database'
  const linked = !!resolved?.linked
  const source = resolved?.source ?? undefined
  const rowsOwnerId = source?.id ?? databaseId

  // ---- schema / views: only ever read through the normalisation layer ----
  // (results are cached by identity, so `schema` / `views` stay stable while rows come and go)
  const normalised = useMemo(() => L.normalizeResolved(resolved), [resolved])
  const { schema, views } = normalised
  const repaired = useRef<string | null>(null)
  useEffect(() => {
    if (!isDatabase || !normalised.changed) return
    // Missing, legacy or malformed data is written back repaired. One attempt per
    // database and mount: a failing write must not loop.
    if (repaired.current === databaseId) return
    repaired.current = databaseId
    actions.repairDatabase(databaseId)
  }, [isDatabase, normalised.changed, databaseId])

  // The first full-page database counts as the first page of the session.
  useEffect(() => {
    if (isDatabase && !inline) bootMark('first-page')
  }, [isDatabase, inline])

  // Once a database is on screen, its panels and (when it has dates) the date picker are
  // the likely next thing: fetch them while nothing else is going on.
  const hasDates = useMemo(() => Object.values(schema).some((prop) => prop.type === 'date'), [schema])
  useEffect(() => {
    if (!isDatabase) return
    whenIdle(() => {
      preloadPanels()
      if (hasDates) preloadDatePicker()
    })
  }, [isDatabase, hasDates])

  // ---- rows ----
  const rawContent: unknown = source?.content
  const rowIds = useMemo(() => {
    const ids = Array.isArray(rawContent) ? rawContent.filter((id): id is string => typeof id === 'string') : EMPTY
    return ids.length ? ids : EMPTY
  }, [rawContent])
  const rowBlocks = useBlocks(rowIds)
  const allRows = useMemo(
    () => rowBlocks.filter((b): b is Block => !!b && b.type === 'page' && !b.trashedAt && b.parentId === rowsOwnerId),
    [rowBlocks, rowsOwnerId]
  )

  // ---- active view ----
  const [activeId, setActiveId] = useState<string | null>(() => activeViews.get(databaseId) ?? null)
  useEffect(() => {
    const known = activeViews.get(databaseId)
    setActiveId(known ?? null)
    if (known) return
    let cancelled = false
    window.api.app
      .getSetting<string>(settingKey(databaseId))
      .then((saved) => {
        if (!cancelled && typeof saved === 'string' && !activeViews.has(databaseId)) setActiveId(saved)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [databaseId])
  const view: DatabaseViewModel = views.find((v) => v.id === activeId) ?? views[0]

  const selectView = useCallback(
    (id: string) => {
      activeViews.set(databaseId, id)
      setActiveId(id)
      window.api.app.setSetting(settingKey(databaseId), id).catch(() => undefined)
    },
    [databaseId]
  )

  // ---- toolbar state ----
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [addViewOpen, setAddViewOpen] = useState(false)
  const [viewMenu, setViewMenu] = useState<{ viewId: string; anchor: HTMLElement; renaming: boolean } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ rowId: string; anchor: PopoverAnchor } | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [linkPanel, setLinkPanel] = useState<LinkPanel | null>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const iconRef = useRef<HTMLButtonElement>(null)
  const filterRef = useRef<HTMLButtonElement>(null)
  const sortRef = useRef<HTMLButtonElement>(null)
  const propsRef = useRef<HTMLButtonElement>(null)
  const chartRef = useRef<HTMLButtonElement>(null)
  const addViewRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSearch('')
    setSearchOpen(false)
    setPanel(null)
    setEditingRowId(null)
    setLinkPanel(null)
  }, [databaseId])

  // Relations and rollups read the databases this one relates to; a change there re-runs the query.
  const cells = useRelatedCells(schema)
  const related = useMemo(() => ({ cells, openPage: onOpenPage }), [cells, onOpenPage])
  const rows = useMemo(() => L.queryRows(allRows, schema, view, search, cells), [allRows, schema, view, search, cells])

  const onOpen = useCallback(
    (rowId: string, event?: OpenModifiers) => {
      if (wantsNewTab(event)) onOpenPage(rowId, { newTab: true })
      else onOpenPage(rowId)
    },
    [onOpenPage]
  )

  const onRowMenu = useCallback((event: ReactMouseEvent | ReactKeyboardEvent, rowId: string, from?: Element) => {
    event.preventDefault()
    event.stopPropagation()
    if (!('clientX' in event)) setRowMenu({ rowId, anchor: keyboardAnchor(from ?? (event.currentTarget as Element)) })
    // The menu the Menu key opened already: Windows follows the key with a contextmenu event.
    else if (!isMenuKeyEcho()) setRowMenu({ rowId, anchor: { x: event.clientX, y: event.clientY } })
  }, [])

  const viewRef = useRef(view)
  viewRef.current = view
  const onNewRow = useCallback(
    (input?: { values?: L.Values; afterId?: string | null }) => {
      const id = actions.createRow(databaseId, { ...input, view: viewRef.current })
      // A chart has no place to type a title in: the new row opens as a page instead.
      if (viewRef.current.type === 'chart') onOpenPage(id)
      else setEditingRowId(id)
      return id
    },
    [databaseId, onOpenPage]
  )
  const onOpenChartSettings = useCallback(() => setPanel('chart'), [])

  const onAddFilter = useCallback(
    (propertyId: string) => {
      actions.patchView(databaseId, viewRef.current.id, (v, s) => {
        const prop = L.propOf(s, propertyId)
        return prop ? { ...v, filters: [...v.filters, L.defaultFilter(prop, s)] } : v
      })
      setPanel('filter')
    },
    [databaseId]
  )

  if (!db || !resolved) return <div className={inline ? 'db-root is-inline is-loading' : 'db-root is-loading'} />
  if (!isDatabase) {
    return <div className={inline ? 'db-root is-inline' : 'db-root'}>This block is not a database.</div>
  }
  if (resolved.status === 'loading') return <div className={inline ? 'db-root is-inline is-loading' : 'db-root is-loading'} />
  if (resolved.status !== 'ok') {
    return (
      <SourceUnavailable databaseId={databaseId} inline={inline} trashedId={resolved.status === 'trashed' ? resolved.trashedId : null} />
    )
  }

  // A linked view shows its source's title and icon unless it was given its own.
  const title = L.displayTitle(resolved)
  const icon = L.displayIcon(resolved)
  const sourceTitle = L.titleOf(source) || 'Untitled'
  const hasOwnTitle = linked && L.titleOf(db) !== ''
  const commitTitle = (text: string): void => actions.setTitle(databaseId, text)

  const databaseMenuItems: MenuItem[] = [
    ...(linked
      ? [
          {
            id: 'open-source',
            label: 'Open source database',
            icon: <ArrowUpRight size={14} />,
            onSelect: () => onOpenPage(rowsOwnerId)
          }
        ]
      : []),
    {
      id: 'locations',
      label: 'Show all locations',
      icon: <Search size={14} />,
      onSelect: () => setLinkPanel('locations')
    },
    ...(linked
      ? [
          {
            id: 'reset-title',
            label: 'Reset title',
            icon: <Undo size={14} />,
            disabled: !hasOwnTitle,
            onSelect: () => actions.resetTitle(databaseId)
          },
          { separator: true as const },
          {
            id: 'remove',
            label: 'Remove linked view',
            icon: <Trash size={14} />,
            danger: true,
            onSelect: () => actions.removeLinkedView(databaseId)
          }
        ]
      : [
          {
            id: 'link',
            label: 'Create linked view…',
            icon: <Plus size={14} />,
            onSelect: () => setLinkPanel('link')
          }
        ])
  ]

  const addLinkedViewTo = (pageId: string, pageName: string): void => {
    setLinkPanel(null)
    actions
      .insertLinkedView(pageId, databaseId)
      .then((id) => {
        if (id) toast(`Linked view added to ${pageName}.`, { kind: 'success' })
      })
      .catch((error: unknown) => notifyError('Could not create the linked view.', error))
  }

  const viewProps: ViewProps = {
    databaseId,
    schema,
    view,
    rows,
    totalRows: allRows.length,
    inline,
    canReorder: view.sorts.length === 0,
    editingRowId,
    setEditingRowId,
    onOpen,
    onRowMenu,
    onNewRow,
    onAddFilter,
    onOpenChartSettings
  }

  const addViewItems: MenuItem[] = [
    { header: 'New view' },
    ...L.VIEW_TYPES.map<MenuItem>((type: ViewType) => ({
      id: type,
      label: L.VIEW_LABELS[type],
      icon: <ViewIcon type={type} />,
      onSelect: () => {
        const id = actions.addView(databaseId, type)
        if (id) selectView(id)
      }
    }))
  ]

  const menuView = viewMenu ? views.find((v) => v.id === viewMenu.viewId) : undefined
  const viewMenuItems: MenuItem[] = menuView
    ? [
        {
          id: 'rename',
          label: 'Rename',
          onSelect: () => setViewMenu((prev) => (prev ? { ...prev, renaming: true } : prev))
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: <Copy size={14} />,
          onSelect: () => {
            const id = actions.duplicateView(databaseId, menuView.id)
            if (id) selectView(id)
            setViewMenu(null)
          }
        },
        { separator: true },
        {
          id: 'delete',
          label: 'Delete view',
          icon: <Trash size={14} />,
          danger: true,
          disabled: views.length <= 1,
          onSelect: () => {
            if (menuView.id === view.id) {
              const next = views.find((v) => v.id !== menuView.id)
              if (next) selectView(next.id)
            }
            actions.deleteView(databaseId, menuView.id)
            setViewMenu(null)
          }
        }
      ]
    : []

  const rowMenuItems: MenuItem[] = rowMenu
    ? [
        { id: 'open', label: 'Open', icon: <ArrowUpRight size={14} />, onSelect: () => onOpenPage(rowMenu.rowId) },
        {
          id: 'open-tab',
          label: 'Open in new tab',
          icon: <Plus size={14} />,
          onSelect: () => onOpenPage(rowMenu.rowId, { newTab: true })
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: <Copy size={14} />,
          onSelect: () => void actions.duplicateRow(databaseId, rowMenu.rowId)
        },
        { separator: true },
        {
          id: 'delete',
          label: 'Delete',
          icon: <Trash size={14} />,
          danger: true,
          onSelect: () => actions.trashRows(databaseId, [rowMenu.rowId])
        }
      ]
    : []

  const isChart = view.type === 'chart'
  // Figures are computed from all the rows the filters let through: their order and columns do not matter.
  const ordersRows = !isChart && view.type !== 'calc'
  // A panel only stays open on a view that has it (the chart panel on charts, sorts and properties on the views that order rows,
  // and the properties panel, which holds "Split by" there, on calculations).
  const openPanel: Panel | null =
    panel === 'filter' || (panel === 'chart' ? isChart : panel === 'properties' ? ordersRows || view.type === 'calc' : ordersRows)
      ? panel
      : null
  const panelAnchor =
    openPanel === 'filter'
      ? filterRef.current
      : openPanel === 'sort'
        ? sortRef.current
        : openPanel === 'properties'
          ? propsRef.current
          : openPanel === 'chart'
            ? chartRef.current
            : null
  const togglePanel = (next: Panel): void => setPanel((current) => (current === next ? null : next))

  let body: JSX.Element
  switch (view.type) {
    case 'board':
      body = <BoardView {...viewProps} />
      break
    case 'list':
      body = <ListView {...viewProps} />
      break
    case 'gallery':
      body = <GalleryView {...viewProps} />
      break
    case 'calendar':
      body = <CalendarView {...viewProps} />
      break
    case 'chart':
      body = <ChartView {...viewProps} />
      break
    case 'calc':
      body = <CalcView {...viewProps} />
      break
    default:
      body = <TableView {...viewProps} />
  }

  const content = (
    <div className={inline ? 'db-root is-inline' : 'db-root'} data-view-type={view.type}>
      <div className="db-header">
        <button type="button" ref={iconRef} className="db-icon" aria-label="Change icon" onClick={() => setEmojiOpen((open) => !open)}>
          {icon ? <IconGlyph icon={icon} /> : <Table size={inline ? ICON_SIZE_INLINE : ICON_SIZE_PAGE} />}
        </button>
        {linked && (
          <Tooltip label={`Linked view of ${sourceTitle}`}>
            <button
              type="button"
              className="db-linked-badge"
              aria-label={`Linked view of ${sourceTitle}. Open the source database`}
              onClick={(event) => onOpen(rowsOwnerId, event)}
              onAuxClick={(event) => {
                if (event.button === 1) onOpenPage(rowsOwnerId, { newTab: true })
              }}
            >
              <ArrowUpRight size={inline ? 12 : 14} />
            </button>
          </Tooltip>
        )}
        <TitleInput
          className="db-title"
          value={title}
          placeholder="Untitled"
          label={linked ? 'Linked view title' : 'Database title'}
          onCommit={commitTitle}
        />
        <button
          type="button"
          ref={menuRef}
          className="db-mini-button"
          title="Database options"
          aria-label="Database options"
          aria-haspopup="menu"
          aria-expanded={linkPanel === 'menu'}
          onPointerEnter={preloadLinkedPanels}
          onFocus={preloadLinkedPanels}
          onClick={() => setLinkPanel((current) => (current ? null : 'menu'))}
        >
          <MoreHorizontal size={14} />
        </button>
        {inline && (
          <button
            type="button"
            className="db-mini-button"
            title="Open as page"
            aria-label="Open as page"
            onClick={(event) => onOpen(databaseId, event)}
          >
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>

      <div className="db-bar">
        <div className="db-tabs">
          <div className="db-segmented" role="tablist">
            {views.map((v) => (
              <button
                type="button"
                key={v.id}
                role="tab"
                aria-selected={v.id === view.id}
                className={v.id === view.id ? 'db-tab is-active' : 'db-tab'}
                onPointerEnter={() => preloadView(v.type)}
                onFocus={() => preloadView(v.type)}
                onClick={(event) => {
                  if (v.id === view.id) {
                    const anchor = event.currentTarget
                    setViewMenu((prev) => (prev ? null : { viewId: v.id, anchor, renaming: false }))
                  } else {
                    selectView(v.id)
                  }
                }}
                onDoubleClick={(event) => setViewMenu({ viewId: v.id, anchor: event.currentTarget, renaming: true })}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setViewMenu({ viewId: v.id, anchor: event.currentTarget, renaming: false })
                }}
              >
                <ViewIcon type={v.type} />
                <span className="db-tab-name">{v.name}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            ref={addViewRef}
            className="db-mini-button is-add-view"
            aria-label="Add a view"
            title="Add a view"
            onClick={() => setAddViewOpen((open) => !open)}
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="db-tools">
          <button
            type="button"
            ref={filterRef}
            className={view.filters.length ? 'db-tool is-on' : 'db-tool'}
            onPointerEnter={preloadPanels}
            onFocus={preloadPanels}
            onClick={() => togglePanel('filter')}
          >
            <Filter size={14} />
            <span>Filter</span>
            {view.filters.length > 0 && <span className="db-tool-count">{view.filters.length}</span>}
          </button>
          {/* A chart orders its categories itself (chart settings), so row sorts are not offered on one. */}
          {ordersRows && (
            <button
              type="button"
              ref={sortRef}
              className={view.sorts.length ? 'db-tool is-on' : 'db-tool'}
              onPointerEnter={preloadPanels}
              onFocus={preloadPanels}
              onClick={() => togglePanel('sort')}
            >
              <Sort size={14} />
              <span>Sort</span>
              {view.sorts.length > 0 && <span className="db-tool-count">{view.sorts.length}</span>}
            </button>
          )}
          {isChart && (
            <button
              type="button"
              ref={chartRef}
              className={openPanel === 'chart' ? 'db-tool is-on' : 'db-tool'}
              aria-haspopup="dialog"
              aria-expanded={openPanel === 'chart'}
              onPointerEnter={preloadChartPanel}
              onFocus={preloadChartPanel}
              onClick={() => togglePanel('chart')}
            >
              <ChartColumn size={14} />
              <span>Chart</span>
            </button>
          )}
          {searchOpen ? (
            <span className="db-search">
              <Search size={14} />
              <input
                ref={searchRef}
                autoFocus
                value={search}
                placeholder="Search…"
                aria-label="Search rows"
                onChange={(event) => setSearch(event.target.value)}
                onBlur={() => {
                  if (!search) setSearchOpen(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setSearch('')
                    setSearchOpen(false)
                  }
                }}
              />
              {search && (
                <button
                  type="button"
                  className="db-mini-button"
                  aria-label="Clear search"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSearch('')
                    searchRef.current?.focus()
                  }}
                >
                  <Close size={12} />
                </button>
              )}
            </span>
          ) : (
            <button type="button" className="db-tool" aria-label="Search" title="Search" onClick={() => setSearchOpen(true)}>
              <Search size={14} />
            </button>
          )}
          {(ordersRows || view.type === 'calc') && (
            <button
              type="button"
              ref={propsRef}
              className="db-tool"
              aria-label={view.type === 'calc' ? 'Split by' : 'Properties'}
              title={view.type === 'calc' ? 'Split by' : 'Properties'}
              onPointerEnter={preloadPanels}
              onFocus={preloadPanels}
              onClick={() => togglePanel('properties')}
            >
              <MoreHorizontal size={14} />
            </button>
          )}
          <button type="button" className="db-new-button" onClick={() => onNewRow()}>
            New
          </button>
        </div>
      </div>

      <div className="db-body">
        <Suspense fallback={<PartFallback kind="view" />}>{body}</Suspense>
      </div>

      <Floating open={emojiOpen} anchor={iconRef.current} label="Database icon" onClose={() => setEmojiOpen(false)}>
        <IconPicker
          current={icon}
          onPick={(shape) => {
            actions.updateDatabase(databaseId, { icon: shape })
            setEmojiOpen(false)
          }}
        />
      </Floating>

      <Floating open={linkPanel === 'menu'} anchor={menuRef.current} placement="bottom-end" role="none" onClose={() => setLinkPanel(null)}>
        {/* The items that open another popover replace this one themselves: no close on select. */}
        <Menu items={databaseMenuItems} onClose={() => setLinkPanel((current) => (current === 'menu' ? null : current))} autoFocus />
      </Floating>

      <Floating
        open={linkPanel === 'locations' || linkPanel === 'link'}
        anchor={menuRef.current}
        placement="bottom-end"
        label={linkPanel === 'link' ? 'Link to a database' : 'Where this database appears'}
        onClose={() => setLinkPanel(null)}
      >
        <Suspense fallback={<PartFallback kind="popover" />}>
          {linkPanel === 'locations' && (
            <LocationsPanel
              databaseId={databaseId}
              sourceId={rowsOwnerId}
              onOpen={(id) => {
                setLinkPanel(null)
                onOpenPage(id)
              }}
            />
          )}
          {linkPanel === 'link' && <PagePicker onPick={addLinkedViewTo} />}
        </Suspense>
      </Floating>

      <Floating open={addViewOpen} anchor={addViewRef.current} role="none" onClose={() => setAddViewOpen(false)}>
        <Menu items={addViewItems} onClose={() => setAddViewOpen(false)} autoFocus />
      </Floating>

      {viewMenu && menuView && (
        <Floating
          open
          anchor={viewMenu.anchor}
          role={viewMenu.renaming ? 'dialog' : 'none'}
          label="View name"
          onClose={() => setViewMenu(null)}
        >
          {viewMenu.renaming ? (
            <RenameInput
              value={menuView.name}
              label="View name"
              onCommit={(name) => actions.renameView(databaseId, menuView.id, name)}
              onDone={() => setViewMenu(null)}
            />
          ) : (
            <Menu items={viewMenuItems} autoFocus />
          )}
        </Floating>
      )}

      <Floating
        open={!!openPanel && !!panelAnchor}
        anchor={panelAnchor}
        placement="bottom-end"
        label={openPanel ? PANEL_LABEL[openPanel] : undefined}
        onClose={() => setPanel(null)}
      >
        <Suspense fallback={<PartFallback kind="popover" />}>
          {openPanel === 'filter' && <FilterPanel databaseId={databaseId} schema={schema} view={view} />}
          {openPanel === 'sort' && <SortPanel databaseId={databaseId} schema={schema} view={view} />}
          {openPanel === 'properties' && <PropertiesPanel databaseId={databaseId} schema={schema} view={view} />}
          {openPanel === 'chart' && <ChartPanel databaseId={databaseId} schema={schema} view={view} />}
        </Suspense>
      </Floating>

      {rowMenu && (
        <Floating open anchor={rowMenu.anchor} role="none" onClose={() => setRowMenu(null)}>
          <Menu items={rowMenuItems} onClose={() => setRowMenu(null)} autoFocus />
        </Floating>
      )}
    </div>
  )
  // Cells, cards and panels below read the related databases (and open linked rows) through this.
  return <RelatedContext.Provider value={related}>{content}</RelatedContext.Provider>
}
