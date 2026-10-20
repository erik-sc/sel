// Showing and hiding the side panels, the same from a shortcut, the menu or a button.
import { toggleAssistant, useAiGate } from '@/ai/gate'
import { setFocusMode, toggleSidebar, useUi } from '@/store/ui'

/**
 * Focus mode hides the sidebar and the assistant panel without closing them, so asking for one
 * there means "show it": focus mode ends and the panel is open, rather than a hidden one closing.
 */
function showOrToggle(open: boolean, toggle: () => void): void {
  if (!useUi.getState().focusMode) return toggle()
  setFocusMode(false)
  if (!open) toggle()
}

export function showOrHideAssistant(): void {
  showOrToggle(useAiGate.getState().panelOpen, toggleAssistant)
}

export function showOrHideSidebar(): void {
  showOrToggle(!useUi.getState().sidebarCollapsed, toggleSidebar)
}
