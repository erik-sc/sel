// What each menu command does in this window: the app menu and main's shortcuts send them
// (see useShellCommands), and the command palette runs the same ones.
import type { MenuCommand } from '@shared/api'
import {
  activeTab,
  closeTab,
  cycleTab,
  goBack,
  goForward,
  isBlockId,
  newTab,
  openPage,
  reopenTab,
  selectTabAt,
  tabPage
} from '@/store/tabs'
import { setFocusMode, setHistoryPage, setQuickFindOpen, setSettingsOpen, toggleFocusMode, toggleSidebar, toggleTheme, useUi } from '@/store/ui'
import { createPage, reportError } from './actions'
import { toggleAssistant, useAiGate } from '@/ai/gate'
import { openCalendar, openToday } from '@/briefing/route'
import { focusQuickAdd, openTasks } from '@/tasks/gate'
import { openCloseDay, openNotebook } from '@/notebook/route'
import { newMeeting } from '@/meetings/gate'
import { openFind } from './findStore'
import { openFeedback } from '@/feedback/gate'
import { openPalette } from '@/commands/store'
import { goHome } from '@/home/store'
import { openShortcuts } from '@/shortcuts/gate'
import { startOrShowPomodoro } from '@/pomodoro/gate'
import { openTemplates } from '@/templates/gate'

export function runMenuCommand(command: MenuCommand, arg?: unknown): void {
  switch (command) {
    case 'new-page':
      void createPage(null).catch(reportError('create the page'))
      break
    case 'new-from-template': {
      // The page in front is offered as a place for it; the workspace root stays the default.
      const pageId = tabPage(activeTab())
      openTemplates({ pageId: pageId && isBlockId(pageId) ? pageId : null })
      break
    }
    case 'new-tab':
      newTab()
      break
    case 'close-tab':
      closeTab()
      break
    case 'next-tab':
      cycleTab(1)
      break
    case 'prev-tab':
      cycleTab(-1)
      break
    case 'quick-find':
      setQuickFindOpen(true)
      break
    case 'find-in-page':
      openFind(window.getSelection()?.toString())
      break
    case 'command-palette':
      openPalette()
      break
    case 'keyboard-shortcuts':
      openShortcuts()
      break
    case 'toggle-sidebar':
      showOrHideSidebar()
      break
    case 'toggle-theme':
      toggleTheme()
      break
    case 'toggle-focus-mode':
      toggleFocusMode()
      break
    case 'go-back':
      goBack()
      break
    case 'go-forward':
      goForward()
      break
    case 'open-settings':
      setSettingsOpen(true)
      break
    case 'select-tab':
      if (typeof arg === 'number') selectTabAt(arg)
      break
    case 'reopen-tab':
      reopenTab()
      break
    case 'new-window':
      void window.api.app.newWindow(tabPage(activeTab()) ?? undefined).catch(reportError('open a new window'))
      break
    case 'open-page':
      if (isBlockId(arg)) openPage(arg)
      break
    case 'toggle-assistant':
      showOrHideAssistant()
      break
    case 'go-home':
      goHome()
      break
    case 'open-today':
      openToday()
      break
    case 'open-calendar':
      openCalendar()
      break
    case 'open-tasks':
      openTasks()
      break
    case 'add-task':
      openTasks()
      focusQuickAdd()
      break
    case 'open-notebook':
      openNotebook()
      break
    case 'close-day':
      openCloseDay()
      break
    case 'new-meeting':
      void newMeeting()
      break
    case 'send-feedback':
      openFeedback()
      break
    case 'start-pomodoro':
      startOrShowPomodoro()
      break
    case 'version-history': {
      // The shortcut toggles: the history of the page in the active tab.
      const pageId = tabPage(activeTab())
      setHistoryPage(useUi.getState().historyPageId ? null : (pageId ?? null))
      break
    }
  }
}

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
