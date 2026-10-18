// Which of the sidebar's popovers is open, the Trash or the Archive, and what it hangs from.
// Kept outside the buttons so that the palette can open them too, when their button is hidden
// or the sidebar is closed.
import { create } from 'zustand'
import type { PopoverAnchor } from '@/ui/Popover'

export type SidebarPanel = 'trash' | 'archive'

interface SidebarPanelState {
  open: SidebarPanel | null
  anchor: PopoverAnchor
}

export const useSidebarPanel = create<SidebarPanelState>(() => ({ open: null, anchor: null }))

/** The sidebar button's click: opens its popover under it, or closes it when it is open. */
export function toggleSidebarPanel(panel: SidebarPanel, anchor: HTMLElement): void {
  if (useSidebarPanel.getState().open === panel) closeSidebarPanel()
  else useSidebarPanel.setState({ open: panel, anchor })
}

/** From the palette: next to its button when the sidebar shows it, else near the top left corner. */
export function openSidebarPanel(panel: SidebarPanel): void {
  const button = document.querySelector<HTMLElement>(`.sidebar:not(.is-collapsed) [data-sidebar-item="${panel}"] button`)
  useSidebarPanel.setState({ open: panel, anchor: button ?? { x: 16, y: 48 } })
}

export function closeSidebarPanel(): void {
  useSidebarPanel.setState({ open: null, anchor: null })
}
