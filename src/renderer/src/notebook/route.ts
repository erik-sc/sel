// The small part of the ink notebook that is always loaded: its route, the way to reach it,
// and its name on a tab. The screen itself is a chunk of its own (see Host.tsx).
import { NOTEBOOK_ID } from '@shared/notebook'
import { NOTEBOOK_ROUTE, openScreen } from '@/store/tabs'

export { NOTEBOOK_ROUTE }

export const NOTEBOOK_TITLE = 'Ink notebook'

/**
 * True when a tab shows the notebook: its route, or the notebook's own page, which a search
 * result or a link may open. That page is never shown as an ordinary page: its days are ink.
 */
export function isNotebookRoute(pageId: string | null | undefined): boolean {
  return pageId === NOTEBOOK_ROUTE || pageId === NOTEBOOK_ID
}

/** The name on the tab of a screen of the notebook, or null for anything else. */
export function notebookRouteTitle(pageId: string | null | undefined): string | null {
  return isNotebookRoute(pageId) ? NOTEBOOK_TITLE : null
}

export function openNotebook(): void {
  openScreen(NOTEBOOK_ROUTE)
}
