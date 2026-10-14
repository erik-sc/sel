// State of the find-in-page bar. Kept apart from the bar so the shell's shortcuts can open it
// without loading the component and its stylesheet.
import { create } from 'zustand'
import { seedFrom } from './findInPage'

interface FindState {
  open: boolean
  query: string
  /** Bumped on every Ctrl+F, so a second press while open focuses the field again. */
  nonce: number
}

export const useFind = create<FindState>(() => ({ open: false, query: '', nonce: 0 }))

/** Opens the bar (or focuses it again), starting from `selection` when it is a short phrase. */
export function openFind(selection?: string | null): void {
  // Not over a dialog: its focus trap would keep the field out of reach.
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
  const seed = seedFrom(selection)
  useFind.setState((state) => ({ open: true, query: seed || state.query, nonce: state.nonce + 1 }))
}

export function closeFind(): void {
  useFind.setState({ open: false })
}

export function setFindQuery(query: string): void {
  useFind.setState({ query })
}
