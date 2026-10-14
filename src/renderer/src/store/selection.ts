import { create } from 'zustand'

/**
 * The blocks selected as blocks (not as text) in the open page editor, for readers outside the
 * editor, such as the word count in the top bar. The editor keeps its own selection; it only
 * copies it here.
 */
interface BlockSelectionState {
  pageId: string | null
  ids: readonly string[]
}

const NONE: readonly string[] = []

export const useBlockSelection = create<BlockSelectionState>(() => ({ pageId: null, ids: NONE }))

export function setBlockSelection(pageId: string, ids: readonly string[]): void {
  const next = ids.length ? ids : NONE
  const current = useBlockSelection.getState()
  if (current.pageId === pageId && current.ids === next) return
  useBlockSelection.setState({ pageId, ids: next })
}

/** The editor of `pageId` closed: its selection goes with it (unless another editor took over). */
export function clearBlockSelection(pageId: string): void {
  if (useBlockSelection.getState().pageId === pageId) useBlockSelection.setState({ pageId: null, ids: NONE })
}
