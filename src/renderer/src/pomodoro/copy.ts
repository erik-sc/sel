// The words of the pomodoro widget, in English and in Brazilian Portuguese: the two languages
// Herman speaks, chosen the same way, by the main process (PomodoroSnapshot.locale). Pure: no
// React, no DOM.
import type { PomodoroPhase } from '../../../shared/pomodoro'

export interface PomodoroCopy {
  phase: Record<PomodoroPhase, string>
  paused: string
  /** The question at the end of a phase: what starts next, and for how long. */
  ask: (next: PomodoroPhase, minutes: number) => string
  start: string
  skipBreak: string
  pause: string
  resume: string
  skip: string
  restart: string
  stop: string
  /** Where this focus phase is in its set: "2 of 4". */
  ofSet: (position: number, total: number) => string
  /** What a screen reader hears for the widget. */
  label: (phase: string, clock: string) => string
  ended: string
}

export const COPY: Record<'en' | 'pt-BR', PomodoroCopy> = {
  en: {
    phase: { focus: 'Focus', short: 'Break', long: 'Long break' },
    paused: 'Paused',
    ask: (next, minutes) =>
      next === 'focus' ? 'Back to focus?' : next === 'long' ? `A ${minutes} min long break?` : `A ${minutes} min break?`,
    start: 'Start',
    skipBreak: 'Skip the break',
    pause: 'Pause',
    resume: 'Resume',
    skip: 'Skip to the next phase',
    restart: 'Start over',
    stop: 'Stop',
    ofSet: (position, total) => `${position} of ${total}`,
    label: (phase, clock) => `Pomodoro: ${phase}, ${clock} left`,
    ended: 'Done'
  },
  'pt-BR': {
    phase: { focus: 'Foco', short: 'Pausa', long: 'Pausa longa' },
    paused: 'Pausado',
    ask: (next, minutes) =>
      next === 'focus' ? 'Voltar ao foco?' : next === 'long' ? `Pausa longa de ${minutes} min?` : `Pausa de ${minutes} min?`,
    start: 'Começar',
    skipBreak: 'Pular a pausa',
    pause: 'Pausar',
    resume: 'Retomar',
    skip: 'Pular para a próxima fase',
    restart: 'Recomeçar',
    stop: 'Parar',
    ofSet: (position, total) => `${position} de ${total}`,
    label: (phase, clock) => `Pomodoro: ${phase}, faltam ${clock}`,
    ended: 'Fim'
  }
}
