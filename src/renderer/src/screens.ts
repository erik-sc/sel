// The built-in screens a tab can show instead of a page: each feature describes its own
// (`<feature>/screens.ts`), and this lists them, one line each. Leaf data: a screen's mount point
// is a lazy import, so nothing of a screen is loaded until a tab shows it, and the tabs store
// can read this list (store/tabs.ts) without importing any feature.
import type { ComponentType } from 'react'
import { BRIEFING_SCREENS } from './briefing/screens'
import { NOTEBOOK_SCREENS } from './notebook/screens'
import { SKY_SCREENS } from './sky/screens'
import { TASKS_SCREENS } from './tasks/screens'

export interface Screen {
  /** What the tab holds (./routes.ts). */
  route: string
  /** Its name on the tab, in the palette's sense of "the current page". */
  title: string
  /** A stored page that is shown as this screen when a link or a search result opens it. */
  alias?: string
  /** Its mount point, a lazy component: Shell.tsx renders it in a Suspense boundary. */
  Host: ComponentType
}

export const SCREENS: readonly Screen[] = [...BRIEFING_SCREENS, ...TASKS_SCREENS, ...NOTEBOOK_SCREENS, ...SKY_SCREENS]

/** The screen a tab showing `pageId` shows: by its route, or by the page it stands for. */
export function screenOf(pageId: string | null | undefined): Screen | null {
  if (!pageId) return null
  return SCREENS.find((screen) => screen.route === pageId || screen.alias === pageId) ?? null
}

/** The name of the built-in screen a tab shows, or null when it shows a stored page (or nothing). */
export function routeTitle(pageId: string | null | undefined): string | null {
  return screenOf(pageId)?.title ?? null
}
