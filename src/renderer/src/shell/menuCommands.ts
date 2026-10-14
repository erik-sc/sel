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
import { setHistoryPage, setQuickFindOpen, setSettingsOpen, toggleSidebar, toggleTheme, useUi } from '@/store/ui'
import { createPage, reportError } from './actions'
import { toggleAssistant } from '@/ai/gate'
import { openCalendar, openToday } from '@/briefing/route'
import { newMeeting } from '@/meetings/gate'
import { openFind } from './findStore'
import { openFeedback } from '@/feedback/gate'
import { openPalette } from '@/commands/store'
import { openShortcuts } from '@/shortcuts/gate'

export function runMenuCommand(command: MenuCommand, arg?: unknown): void {
  switch (command) {
    case 'new-page':
      void createPage(null).catch(reportError('create the page'))
      break
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
      toggleSidebar()
      break
    case 'toggle-theme':
      toggleTheme()
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
      toggleAssistant()
      break
    case 'open-today':
      openToday()
      break
    case 'open-calendar':
      openCalendar()
      break
    case 'new-meeting':
      void newMeeting()
      break
    case 'send-feedback':
      openFeedback()
      break
    case 'version-history': {
      // The shortcut toggles: the history of the page in the active tab.
      const pageId = tabPage(activeTab())
      setHistoryPage(useUi.getState().historyPageId ? null : (pageId ?? null))
      break
    }
  }
}
