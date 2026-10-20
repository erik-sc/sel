// The shell's own commands (CORE_COMMANDS in src/shared/commands.ts): tabs, finding, the panels,
// the theme, settings, and opening a page.
import { openPalette } from '@/commands/store'
import { defineFeature } from '@/feature'
import { runLatexAction } from '@/latex/gate'
import { openShortcuts } from '@/shortcuts/gate'
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
import { setHistoryPage, setQuickFindOpen, setSettingsOpen, toggleFocusMode, toggleTheme, useUi } from '@/store/ui'
import { createPage, reportError } from './actions'
import { openFind } from './findStore'
import { showOrHideSidebar } from './panels'

export const shellFeature = defineFeature({
  id: 'shell',
  menu: {
    'new-page': { run: () => void createPage(null).catch(reportError('create the page')) },
    'new-tab': { run: () => newTab() },
    'close-tab': { run: () => closeTab() },
    'next-tab': { run: () => cycleTab(1) },
    'prev-tab': { run: () => cycleTab(-1) },
    'quick-find': { run: () => setQuickFindOpen(true) },
    'find-in-page': {
      run: () => {
        // A LaTeX document searches its source with its own find bar.
        if (!runLatexAction('find')) openFind(window.getSelection()?.toString())
      }
    },
    'command-palette': { run: () => openPalette() },
    'keyboard-shortcuts': { run: () => openShortcuts() },
    'toggle-sidebar': { run: () => showOrHideSidebar() },
    'toggle-theme': { run: () => toggleTheme() },
    // In focus mode the palette offers "Leave focus mode" instead (commands/builtin.ts).
    'toggle-focus-mode': { run: () => toggleFocusMode(), when: () => !useUi.getState().focusMode },
    'go-back': { run: () => goBack() },
    'go-forward': { run: () => goForward() },
    'open-settings': { run: () => setSettingsOpen(true) },
    'reopen-tab': { run: () => reopenTab() },
    'new-window': { run: () => void window.api.app.newWindow(tabPage(activeTab()) ?? undefined).catch(reportError('open a new window')) },
    'version-history': {
      // The shortcut toggles: the history of the page in the active tab.
      run: () => setHistoryPage(useUi.getState().historyPageId ? null : (tabPage(activeTab()) ?? null))
    },
    'open-page': {
      run: (arg) => {
        if (isBlockId(arg)) openPage(arg)
      }
    },
    'select-tab': {
      run: (arg) => {
        if (typeof arg === 'number') selectTabAt(arg)
      }
    }
  }
})
