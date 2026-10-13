// The small part of the briefing that is always loaded: the routes of its two screens (Today
// and the calendar), the ways to reach them and the rule for opening Today at start-up. The
// screens themselves are chunks of their own (see Host.tsx).
import { localDay, type OpenOnLaunch } from '@shared/briefing'
import { activateTab, activeTab, CALENDAR_ROUTE, newTab, openPage, tabPage, TODAY_ROUTE, useTabs } from '@/store/tabs'

export { CALENDAR_ROUTE, TODAY_ROUTE }

export const TODAY_TITLE = 'Today'
export const CALENDAR_TITLE = 'Calendar'

/** True when a tab shows the Today screen rather than a stored page. */
export function isTodayRoute(pageId: string | null | undefined): boolean {
  return pageId === TODAY_ROUTE
}

export function isCalendarRoute(pageId: string | null | undefined): boolean {
  return pageId === CALENDAR_ROUTE
}

/** The name of the built-in screen a tab shows, or null when it shows a stored page (or nothing). */
export function routeTitle(pageId: string | null | undefined): string | null {
  return pageId === TODAY_ROUTE ? TODAY_TITLE : pageId === CALENDAR_ROUTE ? CALENDAR_TITLE : null
}

/** Shows a built-in screen: the tab that already has it, the blank tab in front, or a new tab. */
function openRoute(route: string): void {
  const state = useTabs.getState()
  const existing = state.tabs.find((tab) => tabPage(tab) === route)
  if (existing) activateTab(existing.id)
  else if (activeTab(state) && !tabPage(activeTab(state))) openPage(route)
  else newTab(route)
}

export function openToday(): void {
  openRoute(TODAY_ROUTE)
}

export function openCalendar(): void {
  openRoute(CALENDAR_ROUTE)
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
