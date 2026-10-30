// The words of the Today screen's task list and of ticking a task, in English and in Brazilian
// Portuguese, in the language of the home (home/copy.ts). Pure: no React, no DOM.
import type { HomeLocale } from '../home/copy'
import type { TaskGroup } from './format'

export interface BriefingCopy {
  /** The heading over the list. */
  openTasks: string
  /** The heading of each group. */
  groups: Record<TaskGroup['key'], string>
  nothingOpen: string
  /** The toast after a task is done: it names the task. `next` is when a repeating one comes again. */
  done: (title: string, next?: string) => string
  undo: string
  doneFailed: string
  undoFailed: string
}

export const BRIEFING_COPY: Record<HomeLocale, BriefingCopy> = {
  en: {
    openTasks: 'Open tasks',
    groups: { overdue: 'Overdue', today: 'Today', noDate: 'No date' },
    nothingOpen: 'Nothing open for today.',
    done: (title, next) => (next ? `Done: ${title}. Next: ${next}.` : `Done: ${title}`),
    undo: 'Undo',
    doneFailed: 'Could not mark the task as done.',
    undoFailed: 'Could not undo that.'
  },
  'pt-BR': {
    openTasks: 'tarefas abertas',
    groups: { overdue: 'atrasadas', today: 'hoje', noDate: 'sem data' },
    nothingOpen: 'Nada aberto para hoje.',
    done: (title, next) => (next ? `Feita: ${title}. Próxima: ${next}.` : `Feita: ${title}`),
    undo: 'Desfazer',
    doneFailed: 'Não foi possível concluir a tarefa.',
    undoFailed: 'Não foi possível desfazer.'
  }
}

/** For code outside React; components use `BRIEFING_COPY[useHome((s) => s.locale)]`. */
export function briefingCopy(locale: HomeLocale): BriefingCopy {
  return BRIEFING_COPY[locale]
}
