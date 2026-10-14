import { create } from 'zustand'
import type { Theme } from '@shared/types'
import { readMirror, writeMirror } from '../boot'
import { notifyError } from '../ui/toast'

interface UiState {
  /** Width set by dragging the divider; null follows the `--sidebar-width` appearance token. */
  sidebarWidth: number | null
  sidebarCollapsed: boolean
  /** Expanded page ids in the sidebar tree. */
  expanded: Record<string, true>
  quickFindOpen: boolean
  settingsOpen: boolean
  /** The section Settings should show when it next opens (a click-through from elsewhere); null: wherever it was. */
  settingsSection: SettingsSection | null
  theme: Theme
  /** Page currently being renamed inline in the sidebar. */
  renamingId: string | null
  /** Page whose version history is open, if any. */
  historyPageId: string | null
  /**
   * Only the page on screen: no sidebar, bars, assistant or Herman. Per window and not kept
   * across launches: it is a moment of writing, not a layout, and a window that opened with
   * no way around it would look broken.
   */
  focusMode: boolean
  /** In focus mode, the blocks other than the one being written fade (`shell.focusDim`, kept). */
  focusDim: boolean
  /** The page's word count and reading time in the top bar. */
  wordCount: boolean
}

export type SettingsSection = 'general' | 'appearance' | 'history' | 'ai' | 'herman' | 'sync' | 'today' | 'meetings'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480
const SIDEBAR_KEY = 'shell.sidebar'
const EXPANDED_KEY = 'shell.expanded'
const FOCUS_DIM_KEY = 'shell.focusDim'
const WORD_COUNT_KEY = 'shell.wordCount'
/** Synchronous copy of what decides the first frame (see boot.ts). */
const MIRROR_KEY = 'ui'

export const useUi = create<UiState>(() => ({
  sidebarWidth: null,
  sidebarCollapsed: false,
  expanded: {},
  quickFindOpen: false,
  settingsOpen: false,
  settingsSection: null,
  theme: 'system',
  renamingId: null,
  historyPageId: null,
  focusMode: false,
  focusDim: false,
  wordCount: true
}))

function save(key: string, value: unknown): void {
  window.api.app.setSetting(key, value).catch((error) => notifyError('Your layout could not be saved.', error))
}

function clampWidth(width: number): number {
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)))
}

function mirror(): void {
  const { theme, sidebarWidth, sidebarCollapsed, wordCount } = useUi.getState()
  writeMirror(MIRROR_KEY, { theme, width: sidebarWidth, collapsed: sidebarCollapsed, words: wordCount })
}

function saveSidebar(): void {
  const { sidebarWidth, sidebarCollapsed } = useUi.getState()
  save(SIDEBAR_KEY, { width: sidebarWidth, collapsed: sidebarCollapsed })
  mirror()
}

/** `persist: false` while dragging; call again with true on release. null goes back to the appearance token. */
export function setSidebarWidth(width: number | null, persist = true): void {
  useUi.setState({ sidebarWidth: width === null ? null : clampWidth(width) })
  if (persist) saveSidebar()
}

export function toggleSidebar(): void {
  useUi.setState((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  saveSidebar()
}

export function setExpanded(id: string, open: boolean): void {
  const current = useUi.getState().expanded
  if (!!current[id] === open) return
  const expanded = { ...current }
  if (open) expanded[id] = true
  else delete expanded[id]
  useUi.setState({ expanded })
  save(EXPANDED_KEY, Object.keys(expanded))
}

export function setQuickFindOpen(open: boolean): void {
  useUi.setState({ quickFindOpen: open })
}

export function setSettingsOpen(open: boolean): void {
  useUi.setState({ settingsOpen: open })
}

export function setRenaming(id: string | null): void {
  useUi.setState({ renamingId: id })
}

/** Shows or hides the word count in the top bar. */
export function setWordCount(on: boolean): void {
  useUi.setState({ wordCount: on })
  save(WORD_COUNT_KEY, on)
  mirror()
}

/** Opens the version history of a page (null closes it). */
export function setHistoryPage(id: string | null): void {
  useUi.setState({ historyPageId: id })
}

// ---- focus mode ----

export function setFocusMode(on: boolean): void {
  if (useUi.getState().focusMode !== on) useUi.setState({ focusMode: on })
}

export function toggleFocusMode(): void {
  setFocusMode(!useUi.getState().focusMode)
}

/** Fading the other blocks is a preference, so it is kept; turning it on also enters focus mode, to show it. */
export function setFocusDim(on: boolean): void {
  useUi.setState(on ? { focusDim: true, focusMode: true } : { focusDim: false })
  save(FOCUS_DIM_KEY, on)
}

// ---- theme ----

const darkQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return darkQuery?.matches ? 'dark' : 'light'
  return theme
}

function paintTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(useUi.getState().theme)
}

export function setTheme(theme: Theme, persist = true): void {
  useUi.setState({ theme })
  paintTheme()
  if (persist) {
    mirror()
    window.api.app.setTheme(theme).catch((error) => notifyError('The theme could not be saved.', error))
  }
}

/** Flips between light and dark, starting from whatever is currently shown. */
export function toggleTheme(): void {
  setTheme(resolveTheme(useUi.getState().theme) === 'dark' ? 'light' : 'dark')
}

darkQuery?.addEventListener('change', paintTheme)

function readTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function readWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clampWidth(value) : null
}

/**
 * Applies the mirrored theme and sidebar geometry synchronously, before the first render.
 * Returns false when there is no mirror yet (first run): the caller then waits for initUi().
 */
export function bootUi(): boolean {
  const saved = readMirror(MIRROR_KEY)
  if (!saved || typeof saved !== 'object') return false
  const raw = saved as { theme?: unknown; width?: unknown; collapsed?: unknown; words?: unknown }
  useUi.setState({
    theme: readTheme(raw.theme),
    sidebarWidth: readWidth(raw.width),
    sidebarCollapsed: !!raw.collapsed,
    wordCount: raw.words !== false
  })
  paintTheme()
  return true
}

export async function initUi(): Promise<void> {
  const [theme, sidebar, expanded, focusDim, wordCount] = await Promise.all([
    window.api.app.getTheme().catch(() => 'system' as Theme),
    window.api.app
      .getSetting<{ width?: unknown; collapsed?: unknown }>(SIDEBAR_KEY)
      .catch(() => null),
    window.api.app.getSetting<string[]>(EXPANDED_KEY).catch(() => null),
    window.api.app.getSetting<unknown>(FOCUS_DIM_KEY).catch(() => null),
    window.api.app.getSetting<boolean>(WORD_COUNT_KEY).catch(() => null)
  ])
  const map: Record<string, true> = {}
  if (Array.isArray(expanded)) {
    for (const id of expanded) if (typeof id === 'string') map[id] = true
  }
  useUi.setState({
    theme: readTheme(theme),
    sidebarWidth: readWidth(sidebar?.width),
    sidebarCollapsed: !!sidebar?.collapsed,
    expanded: map,
    focusDim: focusDim === true,
    wordCount: wordCount !== false
  })
  paintTheme()
  mirror()
}
