// The words of the ink notebook, in English and in Brazilian Portuguese: the two languages
// Herman's own lines are written in (main/herman/lines.ts), chosen the same way, by the main
// process. Pure: no React, no DOM.
import type { NotebookLocale } from '../../../shared/notebook'

export interface NotebookCopy {
  title: string
  placeholder: string
  /** Under today's line: what ink means here. */
  inkNote: string
  saving: string
  kept: string
  failed: string
  /** Shown when the day ended while its line was being written. */
  ended: string
  onThisDay: string
  /** "1 year ago you wrote" */
  yearsAgo: (years: number) => string
  earlier: string
  empty: string
  showMore: string
  loadFailed: string
  tryAgain: string
  todayLabel: string
}

export const COPY: Record<NotebookLocale, NotebookCopy> = {
  en: {
    title: 'Ink notebook',
    placeholder: 'One line for today.',
    inkNote: 'Written in ink: it can change until midnight, then it stays as it is.',
    saving: 'Writing…',
    kept: 'Kept',
    failed: 'This line could not be kept. It is still here; try again in a moment.',
    ended: 'The day ended while you wrote. What it holds stays as it was.',
    onThisDay: 'On this day',
    yearsAgo: (years) => `${years} ${years === 1 ? 'year' : 'years'} ago you wrote`,
    earlier: 'Earlier days',
    empty: 'Nothing written yet. The first line starts the notebook.',
    showMore: 'Earlier still',
    loadFailed: 'The notebook could not be opened.',
    tryAgain: 'Try again',
    todayLabel: 'Today'
  },
  'pt-BR': {
    title: 'Caderno de tinta',
    placeholder: 'Uma linha para hoje.',
    inkNote: 'Escrito a tinta: pode mudar até a meia-noite, depois fica como está.',
    saving: 'Escrevendo…',
    kept: 'Guardado',
    failed: 'Não foi possível guardar esta linha. Ela continua aqui; tente de novo daqui a pouco.',
    ended: 'O dia acabou enquanto você escrevia. O que ele guarda fica como estava.',
    onThisDay: 'Neste dia',
    yearsAgo: (years) => `Há ${years} ${years === 1 ? 'ano' : 'anos'} você escreveu`,
    earlier: 'Dias anteriores',
    empty: 'Nada escrito ainda. A primeira linha começa o caderno.',
    showMore: 'Mais antigos',
    loadFailed: 'Não foi possível abrir o caderno.',
    tryAgain: 'Tentar de novo',
    todayLabel: 'Hoje'
  }
}

/** A day as a heading: "Thursday, 15 October" / "quinta-feira, 15 de outubro". */
export function dayHeading(day: string, locale: NotebookLocale): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(year, month - 1, date))
}

/** A day in a list, with its year when it is not this one: "15 Oct", "15 Oct 2024". */
export function dayShort(day: string, locale: NotebookLocale, thisYear: number): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (year !== thisYear) options.year = 'numeric'
  return new Intl.DateTimeFormat(locale, options).format(new Date(year, month - 1, date))
}

/** The weekday of a day, short: "Thu" / "qui.". */
export function weekdayShort(day: string, locale: NotebookLocale): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return ''
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(year, month - 1, date))
}

// ---- closing the day ------------------------------------------------------------

export interface CloseCopy {
  title: string
  /** The four steps, as the step marks name them. */
  steps: [string, string, string, string]
  stepOf: (step: number, total: number) => string
  happenedTitle: string
  done: string
  edited: string
  quietDay: string
  keepTitle: string
  keepHelp: string
  keepReplace: string
  keepPlaceholder: string
  tomorrowTitle: string
  tomorrowHelp: string
  tomorrowPlaceholders: [string, string, string]
  closeTitle: string
  closeHelp: string
  closeButton: string
  next: string
  back: string
  rest: string
  restHint: string
  closed: string
  closedHelp: string
  openNotebook: string
  failed: string
  ended: string
  loadFailed: string
  tryAgain: string
  /** On the Today screen, above what was set aside the evening before. */
  plansLabel: string
  plansDismiss: string
}

export const CLOSE_COPY: Record<NotebookLocale, CloseCopy> = {
  en: {
    title: 'Close the day',
    steps: ['What happened', 'Worth keeping', 'Tomorrow', 'Close'],
    stepOf: (step, total) => `Step ${step} of ${total}`,
    happenedTitle: 'What happened today',
    done: 'Done',
    edited: 'Written in',
    quietDay: 'A quiet day: nothing marked done, no page touched. That counts too.',
    keepTitle: 'What is worth keeping?',
    keepHelp: 'One line. It goes into the ink notebook as today’s line.',
    keepReplace: 'Today already has a line. Writing here replaces it, while the day is still open.',
    keepPlaceholder: 'The thing worth keeping…',
    tomorrowTitle: 'Up to three things for tomorrow',
    tomorrowHelp: 'They will wait at the top of Today tomorrow morning.',
    tomorrowPlaceholders: ['First thing', 'Second', 'Third'],
    closeTitle: 'Ready to close the day',
    closeHelp: 'The window will rest. Any key or click brings it back.',
    closeButton: 'Close the day',
    next: 'Continue',
    back: 'Back',
    rest: 'Until tomorrow',
    restHint: 'Press any key to come back',
    closed: 'The day is closed.',
    closedHelp: 'Nothing more is asked of it.',
    openNotebook: 'Open the notebook',
    failed: 'This could not be kept. Try again in a moment.',
    ended: 'The day ended while you were closing it. Its line stays as it was.',
    loadFailed: 'The day could not be read.',
    tryAgain: 'Try again',
    plansLabel: 'Set aside last night',
    plansDismiss: 'Put away'
  },
  'pt-BR': {
    title: 'Fechar o dia',
    steps: ['O que aconteceu', 'O que guardar', 'Amanhã', 'Fechar'],
    stepOf: (step, total) => `Passo ${step} de ${total}`,
    happenedTitle: 'O que aconteceu hoje',
    done: 'Feito',
    edited: 'Escrito em',
    quietDay: 'Um dia quieto: nada marcado como feito, nenhuma página mexida. Isso também conta.',
    keepTitle: 'O que vale guardar?',
    keepHelp: 'Uma linha. Ela vai para o caderno de tinta como a linha de hoje.',
    keepReplace: 'Hoje já tem uma linha. Escrever aqui a substitui, enquanto o dia ainda está aberto.',
    keepPlaceholder: 'O que vale guardar…',
    tomorrowTitle: 'Até três coisas para amanhã',
    tomorrowHelp: 'Elas vão esperar no alto de Hoje, amanhã cedo.',
    tomorrowPlaceholders: ['Primeira coisa', 'Segunda', 'Terceira'],
    closeTitle: 'Pronto para fechar o dia',
    closeHelp: 'A janela vai descansar. Qualquer tecla ou clique a traz de volta.',
    closeButton: 'Fechar o dia',
    next: 'Continuar',
    back: 'Voltar',
    rest: 'Até amanhã',
    restHint: 'Aperte qualquer tecla para voltar',
    closed: 'O dia está fechado.',
    closedHelp: 'Nada mais é pedido dele.',
    openNotebook: 'Abrir o caderno',
    failed: 'Não foi possível guardar. Tente de novo daqui a pouco.',
    ended: 'O dia acabou enquanto você o fechava. A linha dele fica como estava.',
    loadFailed: 'Não foi possível ler o dia.',
    tryAgain: 'Tentar de novo',
    plansLabel: 'Deixado ontem à noite',
    plansDismiss: 'Dispensar'
  }
}
