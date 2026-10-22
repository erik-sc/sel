// The small part of the briefing that is always loaded: the ways to reach its two screens (Today
// and the calendar) and the rule for opening Today at start-up. The screens themselves are
// chunks of their own (see screens.ts and Host.tsx).
import { localDay, type OpenOnLaunch } from '@shared/briefing'
import { CALENDAR_ROUTE, TODAY_ROUTE } from '@/routes'
import { openScreen, useTabs } from '@/store/tabs'

/** True when a tab shows the Today screen rather than a stored page. */
export function isTodayRoute(pageId: string | null | undefined): boolean {
  return pageId === TODAY_ROUTE
}

export function isCalendarRoute(pageId: string | null | undefined): boolean {
  return pageId === CALENDAR_ROUTE
}

export function openToday(): void {
  openScreen(TODAY_ROUTE)
}

export function openCalendar(): void {
  openScreen(CALENDAR_ROUTE)
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
