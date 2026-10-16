// The small part of the pomodoro that is always loaded: the timer as the main process keeps it,
// what starts one (the palette, the View menu, Ctrl+Alt+P) and the sound at the end of a phase.
// The widget in the corner is a chunk of its own (./Widget.tsx), fetched when a pomodoro is on.
import { create } from 'zustand'
import type { PomodoroEnded, PomodoroSnapshot } from '@shared/pomodoro'
import { acceleratorOf } from '@shared/shortcuts'
import { registerCommands } from '@/commands/registry'
import { setFocusMode } from '@/store/ui'
import { IS_MAC } from '@/ui/platform'
import { notifyError } from '@/ui/toast'

interface PomodoroGate {
  /** The timer and its settings; null until the main process has answered. */
  snapshot: PomodoroSnapshot | null
  /** The controls next to the widget are open. */
  menuOpen: boolean
}

export const usePomodoro = create<PomodoroGate>(() => ({ snapshot: null, menuOpen: false }))

let started = false

export function initPomodoro(): void {
  if (started) return
  started = true
  window.api.pomodoro.onChanged((snapshot) => usePomodoro.setState({ snapshot }))
  window.api.pomodoro.onEnded((ended) => void ring(ended))
  window.api.pomodoro.state().then(
    (snapshot) => usePomodoro.setState({ snapshot }),
    (error: unknown) => console.error('the pomodoro could not be asked', error)
  )
  registerCommands(COMMANDS)
}

type Action = 'start' | 'pause' | 'resume' | 'skip' | 'next' | 'stop'

/** Asks the main process to change the timer; this window shows the answer at once. */
export function pomodoro(action: Action): Promise<void> {
  return window.api.pomodoro[action]().then(
    (snapshot) => {
      usePomodoro.setState({ snapshot, ...(action === 'stop' ? { menuOpen: false } : {}) })
      // Starting one in this window may hide everything but the page (`pomodoro.focusMode`).
      if (action === 'start' && snapshot.settings.focusMode) setFocusMode(true)
    },
    (error: unknown) => notifyError('The pomodoro could not be changed.', error)
  )
}

export function setPomodoroMenu(open: boolean): void {
  if (usePomodoro.getState().menuOpen !== open) usePomodoro.setState({ menuOpen: open })
}

/** Ctrl+Alt+P: starts a pomodoro, or, with one on, shows what can be done with it. */
export function startOrShowPomodoro(): void {
  if (!usePomodoro.getState().snapshot?.timer) void pomodoro('start')
  else setPomodoroMenu(true)
}

async function ring(ended: PomodoroEnded): Promise<void> {
  if (!ended.sound) return
  try {
    const { bell } = await import('./sound')
    await bell(ended.phase === 'focus' ? 'rest' : 'focus')
  } catch (error) {
    console.error('the pomodoro sound could not be played', error)
  }
}

const timer = (): PomodoroSnapshot['timer'] => usePomodoro.getState().snapshot?.timer ?? null
const KEYWORDS = ['pomodoro', 'timer', 'focus', 'break', 'tomato', 'foco', 'pausa']

const COMMANDS = [
  {
    id: 'start-pomodoro',
    title: 'Start a pomodoro',
    keywords: KEYWORDS,
    shortcut: acceleratorOf('start-pomodoro', IS_MAC),
    when: () => !timer(),
    run: () => void pomodoro('start')
  },
  { id: 'pomodoro-pause', title: 'Pause the pomodoro', keywords: KEYWORDS, when: () => !!timer() && !timer()!.paused && !timer()!.ended, run: () => void pomodoro('pause') },
  { id: 'pomodoro-resume', title: 'Resume the pomodoro', keywords: KEYWORDS, when: () => !!timer()?.paused, run: () => void pomodoro('resume') },
  { id: 'pomodoro-skip', title: 'Skip to the next pomodoro phase', keywords: KEYWORDS, when: () => !!timer() && !timer()!.ended, run: () => void pomodoro('skip') },
  { id: 'pomodoro-next', title: 'Start the next pomodoro phase', keywords: KEYWORDS, when: () => !!timer()?.ended, run: () => void pomodoro('next') },
  { id: 'pomodoro-restart', title: 'Restart the pomodoro', keywords: KEYWORDS, when: () => !!timer(), run: () => void pomodoro('start') },
  { id: 'pomodoro-stop', title: 'Stop the pomodoro', keywords: KEYWORDS, when: () => !!timer(), run: () => void pomodoro('stop') }
]
