// The always-loaded part of the keyboard shortcuts screen (Ctrl+/): whether it is open. The
// screen itself is a chunk of its own (Host.tsx).
import { create } from 'zustand'

interface ShortcutsGate {
  open: boolean
  /** Bumped on every Ctrl+/, so a second press while open selects the filter again. */
  nonce: number
}

export const useShortcutsGate = create<ShortcutsGate>(() => ({ open: false, nonce: 0 }))

export function openShortcuts(): void {
  useShortcutsGate.setState((state) => ({ open: true, nonce: state.nonce + 1 }))
}

export function closeShortcuts(): void {
  useShortcutsGate.setState({ open: false })
}
