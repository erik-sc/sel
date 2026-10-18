// The small part of the Sky that is always loaded: its route, the way to reach it, its name on a
// tab, and whether it is on (`sky.enabled`). The screen itself is a chunk of its own (Host.tsx).
import { create } from 'zustand'
import { SKY_ENABLED_KEY, SKY_ID, skyEnabled } from '@shared/sky'
import { openScreen, SKY_ROUTE } from '@/store/tabs'

export { SKY_ROUTE }

export const SKY_TITLE = 'Sky'

/**
 * True when a tab shows the Sky: its route, or the Sky's own page, which a search result or a link
 * may open. That page is never shown as an ordinary page: it holds what happened, not notes.
 */
export function isSkyRoute(pageId: string | null | undefined): boolean {
  return pageId === SKY_ROUTE || pageId === SKY_ID
}

export function skyRouteTitle(pageId: string | null | undefined): string | null {
  return isSkyRoute(pageId) ? SKY_TITLE : null
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
