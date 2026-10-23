// What the balloon offers to ask before anything is typed, worked out from the moment without
// any AI: the page that is open, overdue tasks, a meeting just transcribed, the time of day.
// At most four, the most relevant first; each is a ready question (or, for a meeting, the
// "Write up notes" action it already has). Pure; unit tested.
import type { HomeLocale } from '@/home/copy'

export interface Moment {
  /** The local hour, 0–23. */
  hour: number
  /** The page in the active tab, when it is a page or a database. */
  page: { id: string; kind: 'page' | 'database'; empty: boolean } | null
  /** The Today screen is in front. */
  today: boolean
  /** Open tasks past their date. */
  overdue: number
  /** The open page is a meeting whose transcript is ready. */
  meeting: boolean
}

export type SuggestionId = 'meeting' | 'overdue' | 'summarize' | 'tasks' | 'plan-day' | 'close-day'

export interface Suggestion {
  id: SuggestionId
  label: string
  /** What is sent, as if typed. */
  prompt: string
  /** What the question is about: the open page, or the day (agenda and open tasks). */
  scope: 'page' | 'today'
  /** Instead of a question: the page action that does it (the meeting's notes, from its transcript). */
  run?: 'consolidate'
}

export const MAX_SUGGESTIONS = 4
/** Morning and evening, in local hours: [from, to). */
export const MORNING = [5, 12] as const
export const EVENING = [17, 24] as const

interface Words {
  meeting: string
  overdue: (count: number) => string
  overduePrompt: (count: number) => string
  summarize: string
  summarizePrompt: string
  tasks: string
  tasksPrompt: string
  planDay: string
  planDayPrompt: string
  closeDay: string
  closeDayPrompt: string
}

export const SUGGESTION_WORDS: Record<HomeLocale, Words> = {
  en: {
    meeting: 'Write up the minutes',
    overdue: (count) => `Replan ${count} overdue`,
    overduePrompt: (count) =>
      `I have ${count} overdue ${count === 1 ? 'task' : 'tasks'}. Help me replan them: propose new dates for what still matters, and say what I could drop.`,
    summarize: 'Summarize this page',
    summarizePrompt: 'Summarize this page.',
    tasks: 'Turn into tasks',
    tasksPrompt: 'Turn this page into tasks: propose the to-dos it implies, each with a clear next action.',
    planDay: 'Plan the day',
    planDayPrompt: 'Plan my day: three priorities, what can wait, and when to do what between my events.',
    closeDay: 'Close the day',
    closeDayPrompt: 'Help me close the day: what got done, what is left, and one suggestion for tomorrow.'
  },
  'pt-BR': {
    meeting: 'Escrever a ata',
    overdue: (count) => `Replanejar ${count} ${count === 1 ? 'atrasada' : 'atrasadas'}`,
    overduePrompt: (count) =>
      `Tenho ${count} ${count === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}. Me ajude a replanejar: proponha novas datas para o que ainda importa e diga o que eu poderia largar.`,
    summarize: 'Resumir esta página',
    summarizePrompt: 'Resuma esta página.',
    tasks: 'Transformar em tarefas',
    tasksPrompt: 'Transforme esta página em tarefas: proponha as tarefas que ela pede, cada uma com uma próxima ação clara.',
    planDay: 'Planejar o dia',
    planDayPrompt: 'Planeje meu dia: três prioridades, o que pode esperar e quando fazer o quê entre os meus compromissos.',
    closeDay: 'Fechar o dia',
    closeDayPrompt: 'Me ajude a fechar o dia: o que foi feito, o que ficou e uma sugestão para amanhã.'
  }
}

const within = (hour: number, [from, to]: readonly [number, number]): boolean => hour >= from && hour < to

/** The suggestions for a moment, most relevant first. */
export function suggestionsFor(moment: Moment, locale: HomeLocale): Suggestion[] {
  const words = SUGGESTION_WORDS[locale]
  const morning = within(moment.hour, MORNING)
  const evening = within(moment.hour, EVENING)
  const ranked: { weight: number; suggestion: Suggestion }[] = []
  const add = (weight: number, suggestion: Suggestion): void => {
    ranked.push({ weight, suggestion })
  }

  const page = moment.page
  // A meeting just transcribed: its notes are what is wanted most.
  if (page && moment.meeting) add(100, { id: 'meeting', label: words.meeting, prompt: words.meeting, scope: 'page', run: 'consolidate' })
  if (moment.overdue > 0) {
    // In the morning the day is still to be planned around them; later they are one thing among others.
    add(morning ? 85 : 70, {
      id: 'overdue',
      label: words.overdue(moment.overdue),
      prompt: words.overduePrompt(moment.overdue),
      scope: 'today'
    })
  }
  if (page && !page.empty) {
    add(60, { id: 'summarize', label: words.summarize, prompt: words.summarizePrompt, scope: 'page' })
    if (page.kind === 'page' && !moment.meeting) add(50, { id: 'tasks', label: words.tasks, prompt: words.tasksPrompt, scope: 'page' })
  }
  // The time of day counts most where the day is the subject: on Today, or with no page open.
  const daily = moment.today || !page ? 90 : 55
  if (morning) add(daily, { id: 'plan-day', label: words.planDay, prompt: words.planDayPrompt, scope: 'today' })
  if (evening) add(daily, { id: 'close-day', label: words.closeDay, prompt: words.closeDayPrompt, scope: 'today' })

  // Stable: equal weights keep the order they were added in.
  return ranked
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.suggestion)
}
