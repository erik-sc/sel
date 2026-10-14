// State of the command palette: whether it is open, and the commands used most recently on this
// device (`shell.palette`, which sync leaves alone). Kept apart from the palette's component so
// the shell's shortcuts can open it without loading it.
import { create } from 'zustand'
import { getCommand, isAvailable } from './registry'
import { noteRecent, readRecent } from './match'
import { notifyError } from '../ui/toast'

const SETTING_KEY = 'shell.palette'

interface PaletteState {
  open: boolean
  /** Command ids, most recently used first. */
  recent: string[]
  /** Bumped on every Ctrl+K, so a second press while open selects the field again. */
  nonce: number
}

export const usePalette = create<PaletteState>(() => ({ open: false, recent: [], nonce: 0 }))

let loaded: Promise<void> | null = null

/** Reads the recently used commands once (done at idle time after start-up, or on first open). */
export function loadPaletteRecent(): Promise<void> {
  loaded ??= window.api.app
    .getSetting<{ recent?: unknown }>(SETTING_KEY)
    .then((value) => {
      // A command run before the setting arrived is already in front.
      const stored = readRecent(value?.recent)
      const current = usePalette.getState().recent
      usePalette.setState({ recent: readRecent([...current, ...stored]) })
    })
    .catch((error) => console.error('could not load recent commands', error))
  return loaded
}

export function openPalette(): void {
  void loadPaletteRecent()
  usePalette.setState((state) => ({ open: true, nonce: state.nonce + 1 }))
}

export function closePalette(): void {
  usePalette.setState({ open: false })
}

/**
 * Closes the palette and runs a command. It runs once the palette is gone, so that what it
 * opens (a dialog, the find bar) gets the focus the palette hands back to the page.
 */
export function runPaletteCommand(id: string): void {
  const command = getCommand(id)
  closePalette()
  if (!command || !isAvailable(command)) return
  const recent = noteRecent(usePalette.getState().recent, id)
  usePalette.setState({ recent })
  window.api.app.setSetting(SETTING_KEY, { recent }).catch((error) => console.error('could not save recent commands', error))
  setTimeout(() => {
    try {
      command.run()
    } catch (error) {
      notifyError(`“${command.title}” did not work.`, error)
    }
  }, 0)
}
