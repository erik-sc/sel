// The small part of the Sky that is always loaded: the way to reach it and whether it is on
// (`sky.enabled`). The screen itself is a chunk of its own (screens.ts, Host.tsx).
import { create } from 'zustand'
import { SKY_ENABLED_KEY, skyEnabled } from '@shared/sky'
import { SKY_ROUTE } from '@/routes'
import { openScreen, tabKey } from '@/store/tabs'

/**
 * True when a tab shows the Sky: its route, or the Sky's own page, which a search result or a link
 * may open (tabKey makes it the route). That page is never shown as an ordinary page: it holds
 * what happened, not notes.
 */
export function isSkyRoute(pageId: string | null | undefined): boolean {
  return !!pageId && tabKey(pageId) === SKY_ROUTE
}

/** Whether the Sky is on, as this window last read it. Off hides its button and command and quiets its shortcut. */
export const useSkyEnabled = create<{ enabled: boolean }>(() => ({ enabled: true }))

export function skyIsEnabled(): boolean {
  return useSkyEnabled.getState().enabled
}

export function setSkyEnabled(enabled: boolean): void {
  useSkyEnabled.setState({ enabled })
}

/** Reads `sky.enabled` once at start-up. */
export function initSky(): void {
  window.api.app.getSetting(SKY_ENABLED_KEY).then(
    (stored) => setSkyEnabled(skyEnabled(stored)),
    (error: unknown) => console.error('the sky setting failed to load', error)
  )
}

export function openSky(): void {
  if (skyIsEnabled()) openScreen(SKY_ROUTE)
}
