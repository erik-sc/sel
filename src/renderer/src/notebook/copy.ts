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
