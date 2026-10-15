import { create } from 'zustand'
import { notifyError } from '../ui/toast'
import { addCacheRoots, fetchBlocks, newId, scheduleSweep } from './blocks'

export interface Tab {
  id: string
  /** Visited page ids; `history[index]` is the page shown. Empty = blank tab. */
  history: string[]
  index: number
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  /** False until persisted tabs were restored. */
  ready: boolean
  /** Secondary windows (opened with ?page=) do not overwrite the persisted tab set. */
  ephemeral: boolean
}

const SETTING_KEY = 'shell.tabs'
const MAX_HISTORY = 50
/** Restored tab sets are cut to this many tabs. */
const MAX_RESTORED_TABS = 100
const PERSIST_DELAY = 250
/**
 * The built-in Today screen as a tab: not a stored page, so it has an id of its own that no
 * block can have (block ids are uuids). See briefing/route.ts.
 */
export const TODAY_ROUTE = '_today'
/** The calendar screen, likewise. */
export const CALENDAR_ROUTE = '_calendar'
/** The ink notebook (see notebook/route.ts). */
export const NOTEBOOK_ROUTE = '_notebook'
/** The shape of every block id (the backend enforces the same). */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isBlockId(value: unknown): value is string {
  // `__proto__` fits the pattern but can never be a key of a plain object map.
  return typeof value === 'string' && ID_PATTERN.test(value) && value !== '__proto__'
}

/** `?page=<id>` opens that page in a window of its own (see api.app.newWindow). */
export function initialPageId(): string | null {
  const id = new URLSearchParams(window.location.search).get('page')
  // The query string is input like any other: only something shaped like an id is used.
  return isBlockId(id) ? id : null
}

export const useTabs = create<TabsState>(() => ({
  tabs: [],
  activeId: null,
  ready: false,
  ephemeral: false
}))

export function tabPage(tab: Tab | undefined | null): string | null {
  if (!tab) return null
  return tab.history[tab.index] ?? null
}

export function activeTab(state: TabsState = useTabs.getState()): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeId)
}

export function useActiveTab(): Tab | undefined {
  return useTabs((state) => state.tabs.find((t) => t.id === state.activeId))
}

// The page shown by every open tab keeps its tree in the block cache; a tab that closes or
// navigates away releases it (see the eviction note in blocks.ts).
addCacheRoots(() => ({
  trees: useTabs
    .getState()
    .tabs.map(tabPage)
    .filter((id): id is string => !!id)
}))
useTabs.subscribe((state, previous) => {
  if (state.tabs !== previous.tabs) scheduleSweep()
})

function makeTab(pageId?: string | null): Tab {
  return { id: newId(), history: pageId ? [pageId] : [], index: 0 }
}

export function newTab(pageId?: string | null, opts?: { background?: boolean }): void {
  const tab = makeTab(pageId)
  useTabs.setState((state) => {
    const at = state.tabs.findIndex((t) => t.id === state.activeId)
    const tabs = [...state.tabs]
    tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab)
    return { tabs, activeId: opts?.background && state.activeId ? state.activeId : tab.id }
  })
}

export function openPage(pageId: string, opts?: { newTab?: boolean }): void {
  const state = useTabs.getState()
  const current = activeTab(state)
  if (opts?.newTab || !current) {
    newTab(pageId)
    return
  }
  if (tabPage(current) === pageId) return
  const history = [...current.history.slice(0, current.index + 1), pageId].slice(-MAX_HISTORY)
  const next: Tab = { ...current, history, index: history.length - 1 }
  useTabs.setState({ tabs: state.tabs.map((t) => (t.id === current.id ? next : t)) })
}

/** Shows a built-in screen: the tab that already has it, the blank tab in front, or a new tab. */
export function openScreen(route: string): void {
  const state = useTabs.getState()
  const existing = state.tabs.find((tab) => tabPage(tab) === route)
  if (existing) activateTab(existing.id)
  else if (activeTab(state) && !tabPage(activeTab(state))) openPage(route)
  else newTab(route)
}

export function activateTab(id: string): void {
  if (useTabs.getState().tabs.some((t) => t.id === id)) useTabs.setState({ activeId: id })
}

/** Recently closed tabs, most recent last, for reopenTab(). */
const closedTabs: { tab: Tab; at: number }[] = []
const MAX_CLOSED = 10

export function reopenTab(): void {
  const closed = closedTabs.pop()
  if (!closed) return
  useTabs.setState((state) => {
    const tabs = [...state.tabs]
    tabs.splice(Math.min(closed.at, tabs.length), 0, closed.tab)
    return { tabs, activeId: closed.tab.id }
  })
}

/** position is 1-based; 9 selects the last tab. */
export function selectTabAt(position: number): void {
  const { tabs } = useTabs.getState()
  const tab = position >= 9 ? tabs[tabs.length - 1] : tabs[position - 1]
  if (tab) useTabs.setState({ activeId: tab.id })
}

export function closeTab(id?: string | null): void {
  useTabs.setState((state) => {
    const target = id ?? state.activeId
    const at = state.tabs.findIndex((t) => t.id === target)
    if (at < 0) return state
    if (tabPage(state.tabs[at])) {
      closedTabs.push({ tab: state.tabs[at], at })
      if (closedTabs.length > MAX_CLOSED) closedTabs.shift()
    }
    const tabs = state.tabs.filter((t) => t.id !== target)
    let activeId = state.activeId
    if (activeId === target) activeId = (tabs[at] ?? tabs[at - 1])?.id ?? null
    return { tabs, activeId }
  })
}

export function closeOtherTabs(id: string): void {
  useTabs.setState((state) =>
    state.tabs.some((t) => t.id === id) ? { tabs: state.tabs.filter((t) => t.id === id), activeId: id } : state
  )
}

/** Moves a tab so that it ends up at `toIndex` in the resulting array. */
export function moveTab(id: string, toIndex: number): void {
  useTabs.setState((state) => {
    const from = state.tabs.findIndex((t) => t.id === id)
    if (from < 0) return state
    const tabs = [...state.tabs]
    const [tab] = tabs.splice(from, 1)
    tabs.splice(Math.max(0, Math.min(tabs.length, toIndex)), 0, tab)
    return { tabs }
  })
}

export function cycleTab(delta: number): void {
  const state = useTabs.getState()
  if (state.tabs.length < 2) return
  const at = state.tabs.findIndex((t) => t.id === state.activeId)
  const next = state.tabs[(at + delta + state.tabs.length) % state.tabs.length]
  useTabs.setState({ activeId: next.id })
}

function step(delta: number): void {
  const state = useTabs.getState()
  const current = activeTab(state)
  if (!current) return
  const index = current.index + delta
  if (index < 0 || index >= current.history.length) return
  useTabs.setState({ tabs: state.tabs.map((t) => (t.id === current.id ? { ...t, index } : t)) })
}

export function goBack(): void {
  step(-1)
}

export function goForward(): void {
  step(1)
}

export function canGoBack(tab: Tab | undefined): boolean {
  return !!tab && tab.index > 0
}

export function canGoForward(tab: Tab | undefined): boolean {
  return !!tab && tab.index < tab.history.length - 1
}

export interface PersistedTabs {
  tabs: Tab[]
  activeId: string | null
}

/**
 * Rebuilds a tab set from a stored setting, which is treated as untrusted: ids must look like
 * ids and be unique, histories keep only page ids (the position follows what was removed) and
 * are capped, and the number of tabs is capped.
 */
export function sanitizeTabs(value: unknown): PersistedTabs | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { tabs?: unknown; activeId?: unknown }
  if (!Array.isArray(raw.tabs)) return null
  const tabs: Tab[] = []
  const seen = new Set<string>()
  for (const entry of raw.tabs as unknown[]) {
    if (tabs.length >= MAX_RESTORED_TABS) break
    if (!entry || typeof entry !== 'object') continue
    const t = entry as { id?: unknown; history?: unknown; index?: unknown }
    if (!isBlockId(t.id) || seen.has(t.id) || !Array.isArray(t.history)) continue
    const wanted = Math.trunc(Number(t.index)) || 0
    const history: string[] = []
    let index = 0
    ;(t.history as unknown[]).forEach((page, at) => {
      if (!isBlockId(page)) return
      if (at <= wanted) index = history.length
      history.push(page)
    })
    // Keep the newest entries, like openPage does.
    const cut = Math.max(0, history.length - MAX_HISTORY)
    seen.add(t.id)
    tabs.push({ id: t.id, history: history.slice(cut), index: Math.max(0, index - cut) })
  }
  const activeId = typeof raw.activeId === 'string' && seen.has(raw.activeId) ? raw.activeId : null
  return { tabs, activeId }
}

/**
 * Restores the persisted tabs (dropping those whose page is gone or trashed), or opens
 * just `initialPageId` when the window was created for a specific page.
 */
let initPromise: Promise<void> | null = null

export function initTabs(initialPageId: string | null): Promise<void> {
  initPromise ??= restoreTabs(initialPageId)
  return initPromise
}

async function restoreTabs(initialPageId: string | null): Promise<void> {
  if (initialPageId) {
    const tab = makeTab(initialPageId)
    useTabs.setState({ tabs: [tab], activeId: tab.id, ready: true, ephemeral: true })
    return
  }
  let restored: PersistedTabs | null = null
  try {
    restored = sanitizeTabs(await window.api.app.getSetting(SETTING_KEY))
    if (restored) {
      const pageIds = restored.tabs.map(tabPage).filter((id): id is string => !!id)
      // Through the cache: the tab strip and the page host need these blocks right away.
      const blocks = pageIds.length ? await fetchBlocks(() => window.api.blocks.getMany([...new Set(pageIds)])) : []
      const alive = new Set(blocks.filter((b) => !b.trashedAt).map((b) => b.id))
      alive.add(TODAY_ROUTE)
      alive.add(CALENDAR_ROUTE)
      alive.add(NOTEBOOK_ROUTE)
      restored.tabs = restored.tabs.filter((t) => {
        const page = tabPage(t)
        return page !== null && alive.has(page)
      })
    }
  } catch (error) {
    console.error('could not restore tabs', error)
  }
  const tabs = restored?.tabs ?? []
  const activeId = tabs.some((t) => t.id === restored?.activeId)
    ? restored!.activeId
    : (tabs[0]?.id ?? null)
  // Tabs opened while restoring (e.g. an early menu command) are kept after the restored ones.
  useTabs.setState((state) => ({
    tabs: [...tabs, ...state.tabs],
    activeId: state.activeId ?? activeId,
    ready: true
  }))
  startPersisting()
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persistNow(): void {
  if (persistTimer === null) return
  clearTimeout(persistTimer)
  persistTimer = null
  const { tabs, activeId } = useTabs.getState()
  window.api.app
    .setSetting(SETTING_KEY, { tabs, activeId })
    .catch((error) => notifyError('Your open tabs could not be saved.', error))
}

/** Called once per window, for its whole life: the subscription is never torn down. */
function startPersisting(): void {
  useTabs.subscribe((state, previous) => {
    if (state.ephemeral || !state.ready) return
    if (state.tabs === previous.tabs && state.activeId === previous.activeId) return
    if (persistTimer !== null) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistNow, PERSIST_DELAY)
  })
  // Do not lose a change made just before the window closes.
  window.addEventListener('pagehide', persistNow)
}
