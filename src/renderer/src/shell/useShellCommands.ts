import { useEffect } from 'react'
import { goBack, goForward } from '@/store/tabs'
import { setFocusMode, setQuickFindOpen, useUi } from '@/store/ui'
import { openFind } from './findStore'
import { IS_MAC } from '@/ui/platform'
import { openPalette } from '@/commands/store'
import { openShortcuts } from '@/shortcuts/gate'
import { runMenuCommand } from './menuCommands'
import { escapeLeavesFocus } from './focusMode'

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  )
}

/** Wires menu commands from the main process plus the renderer-side shortcuts. */
export function useShellCommands(): void {
  useEffect(() => {
    const offCommand = window.api.onCommand(runMenuCommand)

    // Bubble phase on purpose: the editor claims Ctrl+K for links (with text selected) with preventDefault.
    const onKeyDown = (event: KeyboardEvent): void => {
      // Last in line: an Escape that a menu, the find bar or the editor did not take.
      if (escapeLeavesFocus(event, useUi.getState().focusMode)) {
        event.preventDefault()
        setFocusMode(false)
        return
      }
      // Not while an IME is composing, and not once per auto-repeat of a held key.
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      // Main delivers Ctrl+Alt+N as a command; this catches it when the key reaches the page instead.
      if (event.altKey && !event.shiftKey && (IS_MAC ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        runMenuCommand('open-notebook')
        return
      }
      if (event.altKey) return
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      // Main delivers Ctrl+/ as a command; this catches it when the key reaches the page instead,
      // as it does where / needs Shift (Shift+7 on a German keyboard).
      if (key === '/' && (IS_MAC ? event.metaKey : event.ctrlKey)) {
        event.preventDefault()
        openShortcuts()
        return
      }
      if (event.shiftKey) return
      if (key === 'p') {
        event.preventDefault()
        setQuickFindOpen(true)
      } else if (key === 'k' && !(isEditable(event.target) && hasSelection())) {
        // Main leaves Ctrl+K to the page (see APP_SHORTCUTS), so this is where the palette opens from the keyboard.
        event.preventDefault()
        openPalette()
      } else if (key === 'f' && (IS_MAC ? event.metaKey : event.ctrlKey)) {
        // On a Mac, Ctrl+F stays the text fields' "one character forward".
        // Main delivers Ctrl+F as a command; this catches it when the key reaches the page instead.
        event.preventDefault()
        openFind(window.getSelection()?.toString())
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
