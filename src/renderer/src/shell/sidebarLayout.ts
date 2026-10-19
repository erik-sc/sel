// The sidebar's layout as this window knows it (the synced `sidebar` setting) and the language
// of its words. Small and always loaded: the sidebar draws from it.
import { create } from 'zustand'
import { cleanSidebar, editedSidebar, SIDEBAR_SETTING, sidebarOrder, type SidebarItemId, type SidebarLayout } from '@shared/sidebar'
import { setSettingsOpen, useUi } from '@/store/ui'
import { useSync } from '@/sync/store'
import { notifyError } from '@/ui/toast'
import { SIDEBAR_COPY, sidebarLocale, type SidebarCopy, type SidebarLocale } from './sidebarCopy'

interface SidebarLayoutState {
  /** Null is the default layout. */
  layout: SidebarLayout | null
  locale: SidebarLocale
}

export const useSidebarLayout = create<SidebarLayoutState>(() => ({ layout: null, locale: sidebarLocale(null, navigator.language) }))

/** Other windows of this app hear about a layout changed here on this channel. */
const CHANNEL_NAME = 'sidebar'

async function reload(): Promise<void> {
  const [layout, language] = await Promise.all([
    window.api.app.getSetting<unknown>(SIDEBAR_SETTING),
    window.api.app.getSetting<unknown>('ai.language')
  ])
  useSidebarLayout.setState({ layout: cleanSidebar(layout) ?? null, locale: sidebarLocale(language, navigator.language) })
}

let started = false

/** Loads the layout, and follows it when another window or a sync changes it. */
function start(): void {
  if (started) return
  started = true
  const reloadQuietly = (): void => void reload().catch((error) => console.error('could not load the sidebar layout', error))
  reloadQuietly()
  if (typeof BroadcastChannel !== 'undefined') new BroadcastChannel(CHANNEL_NAME).onmessage = reloadQuietly
  // A sync may have brought another device's layout.
  useSync.subscribe((state, previous) => {
    if (state.status.lastSyncAt !== previous.status.lastSyncAt) reloadQuietly()
  })
  // The AI language, which picks the words, can change in another window.
  window.addEventListener('focus', reloadQuietly)
}

export function useSidebarCopy(): SidebarCopy {
  start()
  return SIDEBAR_COPY[useSidebarLayout((state) => state.locale)]
}

/** The sidebar's words now (for menus and commands, built when they open). */
export function sidebarCopy(): SidebarCopy {
  start()
  return SIDEBAR_COPY[useSidebarLayout.getState().locale]
}

export function useLayout(): SidebarLayout | null {
  start()
  return useSidebarLayout((state) => state.layout)
}

function tellOtherWindows(): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage('changed')
  channel.close()
}

async function save(layout: SidebarLayout | null): Promise<void> {
  const previous = useSidebarLayout.getState().layout
  useSidebarLayout.setState({ layout })
  try {
    await window.api.app.setSetting(SIDEBAR_SETTING, layout)
    tellOtherWindows()
  } catch (error) {
    useSidebarLayout.setState({ layout: previous })
    notifyError(sidebarCopy().saveFailed, error)
  }
}

/** Stores a new order of the items; the hidden ones stay hidden. */
export function setSidebarOrder(order: readonly SidebarItemId[]): Promise<void> {
  const layout = useSidebarLayout.getState().layout
  return save(editedSidebar(layout, order, layout?.hidden ?? []))
}

export function setSidebarItemHidden(id: SidebarItemId, hidden: boolean): Promise<void> {
  const layout = useSidebarLayout.getState().layout
  const set = new Set(layout?.hidden ?? [])
  if (hidden) set.add(id)
  else set.delete(id)
  return save(editedSidebar(layout, sidebarOrder(layout), set))
}

/** Every item back, in the default order. */
export function restoreSidebar(): Promise<void> {
  return save(null)
}

/** Opens Settings on the sidebar's section. */
export function customizeSidebar(): void {
  useUi.setState({ settingsSection: 'sidebar' })
  setSettingsOpen(true)
}
