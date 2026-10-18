// The small part of Meditations (the notebook) that is always loaded: the routes of its two screens (the
// notebook and the ritual that closes the day), the ways to reach them and their names on a
// tab. The screens themselves are chunks of their own (see Host.tsx).
import { CLOSE_ROUTE, NOTEBOOK_ROUTE, openScreen, tabKey } from '@/store/tabs'

export { CLOSE_ROUTE, NOTEBOOK_ROUTE }

export const NOTEBOOK_TITLE = 'Meditations'
export const CLOSE_TITLE = 'Close the day'

/**
 * True when a tab shows the notebook: its route, or the notebook's own page, which a search
 * result or a link may open (tabKey makes it the route). That page is never shown as an ordinary
 * page: its past days never change.
 */
export function isNotebookRoute(pageId: string | null | undefined): boolean {
  return !!pageId && tabKey(pageId) === NOTEBOOK_ROUTE
}

export function isCloseRoute(pageId: string | null | undefined): boolean {
  return pageId === CLOSE_ROUTE
}

/** The name on the tab of a screen of the notebook, or null for anything else. */
export function notebookRouteTitle(pageId: string | null | undefined): string | null {
  return isNotebookRoute(pageId) ? NOTEBOOK_TITLE : isCloseRoute(pageId) ? CLOSE_TITLE : null
}

export function openNotebook(): void {
  openScreen(NOTEBOOK_ROUTE)
}

export function openCloseDay(): void {
  openScreen(CLOSE_ROUTE)
}
