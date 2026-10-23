import type { HermanLocale } from '../../shared/herman'
import type { RoutineId } from '../../shared/routines'

/**
 * What the persona says when a routine has something ready, written by hand in the two languages
 * of its lines (like ../herman/lines.ts). In the first person and without its name, so that Herman
 * and Hermine say them alike.
 */

export interface RoutineWords {
  /** The line in the corner. */
  line: string
  /** The button. */
  label: string
  /** The conversation's title in "Earlier". */
  title: string
  /** What stands as the user's side of the conversation. */
  request: string
}

type Words = Record<Exclude<RoutineId, 'stalled'>, RoutineWords> & {
  stalled: (title: string) => RoutineWords
  /** The daily limit was reached: said once. */
  limit: string
  /** "Run routine now" found nothing stuck. */
  nothingStalled: string
  /** "Run routine now" while a routine is already running. */
  busy: string
}

const quote = (title: string, open: string, close: string): string => {
  const short = title.length > 60 ? `${title.slice(0, 59)}…` : title
  return `${open}${short}${close}`
}

export const ROUTINE_WORDS: Record<HermanLocale, Words> = {
  en: {
    morning: {
      line: 'I put together a plan for today. Want to see it?',
      label: 'Show me',
      title: 'Plan for today',
      request: 'Plan my day.'
    },
    midday: {
      line: 'Halfway through the day: I looked at how it is going.',
      label: 'Show me',
      title: 'Midday check-in',
      request: 'How is my day going?'
    },
    evening: {
      line: 'I drafted the close of your day. Want to look before you go?',
      label: 'Show me',
      title: 'Close of the day',
      request: 'Draft the close of my day.'
    },
    weekly: {
      line: 'The week is closing. Shall we look back at it?',
      label: 'Open the review',
      title: 'Weekly review',
      request: 'Review my week.'
    },
    stalled: (title) => ({
      line: `${quote(title, '“', '”')} has been waiting a while. I have an idea to get it moving.`,
      label: 'Show me',
      title: 'Unstick a task',
      request: `Help me unstick ${quote(title, '“', '”')}.`
    }),
    limit: 'That is all the routines for today: I reached the daily limit. They come back tomorrow.',
    nothingStalled: 'Nothing seems stuck right now.',
    busy: 'I am still working on the last one.'
  },
  'pt-BR': {
    morning: {
      line: 'Montei um plano para hoje. Quer ver?',
      label: 'Mostrar',
      title: 'Plano para hoje',
      request: 'Planeje o meu dia.'
    },
    midday: {
      line: 'Metade do dia: dei uma olhada em como está indo.',
      label: 'Mostrar',
      title: 'Meio do dia',
      request: 'Como está indo o meu dia?'
    },
    evening: {
      line: 'Rascunhei o fechamento do seu dia. Quer ver antes de ir?',
      label: 'Mostrar',
      title: 'Fechamento do dia',
      request: 'Rascunhe o fechamento do meu dia.'
    },
    weekly: {
      line: 'A semana está terminando. Vamos olhar para ela?',
      label: 'Abrir a revisão',
      title: 'Revisão da semana',
      request: 'Revise a minha semana.'
    },
    stalled: (title) => ({
      line: `${quote(title, '“', '”')} está parada há um tempo. Tenho uma ideia para destravar.`,
      label: 'Mostrar',
      title: 'Destravar uma tarefa',
      request: `Me ajude a destravar ${quote(title, '“', '”')}.`
    }),
    limit: 'Por hoje chega de rotinas: atingi o limite diário. Elas voltam amanhã.',
    nothingStalled: 'Nada parece travado agora.',
    busy: 'Ainda estou terminando a anterior.'
  }
}
