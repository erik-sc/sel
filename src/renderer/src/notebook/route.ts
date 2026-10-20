// The small part of Meditations (the notebook) that is always loaded: the ways to reach its two
// screens (the notebook and the ritual that closes the day). The screens themselves are chunks
// of their own (see screens.ts and Host.tsx).
import { CLOSE_ROUTE, NOTEBOOK_ROUTE } from '@/routes'
import { openScreen, tabKey } from '@/store/tabs'

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

export function openNotebook(): void {
  openScreen(NOTEBOOK_ROUTE)
}

export function openCloseDay(): void {
  openScreen(CLOSE_ROUTE)
}
