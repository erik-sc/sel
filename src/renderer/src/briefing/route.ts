// The small part of the briefing that is always loaded: its route, the ways to reach it and
// the rule for opening it at start-up. The screen itself is a chunk of its own (see Host.tsx).
import { localDay, type OpenOnLaunch } from '@shared/briefing'
import { activateTab, activeTab, newTab, openPage, tabPage, TODAY_ROUTE, useTabs } from '@/store/tabs'

export { TODAY_ROUTE }

export const TODAY_TITLE = 'Today'

/** True when a tab shows the Today screen rather than a stored page. */
export function isTodayRoute(pageId: string | null | undefined): boolean {
  return pageId === TODAY_ROUTE
}

/** Shows Today: the tab that already has it, the blank tab in front, or a new tab. */
export function openToday(): void {
  const state = useTabs.getState()
  const existing = state.tabs.find((tab) => tabPage(tab) === TODAY_ROUTE)
  if (existing) activateTab(existing.id)
  else if (activeTab(state) && !tabPage(activeTab(state))) openPage(TODAY_ROUTE)
  else newTab(TODAY_ROUTE)
}

/** Which section the settings window opens on next time (the screen links to its own settings). */
let settingsSection: 'today' | null = null

export function requestTodaySettings(): void {
  settingsSection = 'today'
}

export function takeSettingsSection(): 'today' | null {
  const section = settingsSection
  settingsSection = null
  return section
}

/**
 * Start-up: opens Today according to `briefing.openOnLaunch` — on the first launch of each day
 * (the default), always, or never. Windows opened for one page are left alone.
 */
export async function openTodayOnLaunch(): Promise<void> {
  if (useTabs.getState().ephemeral) return
  try {
    const [mode, last] = await Promise.all([
      window.api.app.getSetting<OpenOnLaunch>('briefing.openOnLaunch'),
      window.api.app.getSetting<string>('briefing.lastOpened')
    ])
    const today = localDay()
    if (mode === 'never') return
    if (mode !== 'always' && last === today) return
    openToday()
    if (last !== today) await window.api.app.setSetting('briefing.lastOpened', today)
  } catch (error) {
    console.error('could not open Today at start-up', error)
  }
}
