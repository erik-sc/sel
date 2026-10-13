import { useEffect } from 'react'
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

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  )
}

/** Wires menu commands from the main process plus the renderer-side shortcuts. */
export function useShellCommands(): void {
  useEffect(() => {
    const offCommand = window.api.onCommand((command, arg) => {
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
        case 'version-history': {
          // The shortcut toggles: the history of the page in the active tab.
          const pageId = tabPage(activeTab())
          setHistoryPage(useUi.getState().historyPageId ? null : (pageId ?? null))
          break
        }
      }
    })

    // Bubble phase on purpose: an editor may claim Ctrl+K (e.g. for links) with preventDefault.
    const onKeyDown = (event: KeyboardEvent): void => {
      // Not while an IME is composing, and not once per auto-repeat of a held key.
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey) return
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'p' || (key === 'k' && !(isEditable(event.target) && hasSelection()))) {
        event.preventDefault()
        setQuickFindOpen(true)
      }
    }

    // Mouse back / forward buttons.
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === 3) {
        event.preventDefault()
        goBack()
      } else if (event.button === 4) {
        event.preventDefault()
        goForward()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      offCommand()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])
}

function hasSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}
