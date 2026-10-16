import type { HermanLocale, HermanNudgeKind } from '../../shared/herman'

/**
 * What Herman says unasked: a small bank of lines per kind of nudge, in English and in
 * Brazilian Portuguese. Every line was written for this app; none is a quotation. They are
 * chosen and filled in locally (see ./counsel.ts): no model writes or sees them.
 *
 * His voice: observant, kind, a little dry, and few words. One short sentence, two at most; a
 * question more often than an instruction; never a scolding, never an explanation of himself.
 */

/** The words a line can be built from, already in the right language and form. */
export interface Words {
  /** A count, in words up to twelve ("three", "três"), and the same starting a sentence. */
  n: string
  N: string
  /** True when the count is one. */
  one: boolean
  /** A title (of a task, an event), tidied and capped. Empty when there is none. */
  title: string
  /** "since Thursday", "desde quinta". */
  since: string
  /** A number of minutes, in words where they read well, and the same starting a sentence. */
  minutes: string
  Minutes: string
  /** "until 3:00 PM" / "for the rest of the day"; "até as 15:00" / "pelo resto do dia". */
  until: string
  /** "two hours", "an hour and a half", and the same starting a sentence. */
  span: string
  Span: string
  /** "two months", "more than a year", and the same starting a sentence. */
  ago: string
  Ago: string
}

export interface Line {
  text(words: Words): string
  /** The line names a title: it is left out when there is none. */
  title?: true
}

const line = (text: (w: Words) => string): Line => ({ text })
const titled = (text: (w: Words) => string): Line => ({ text, title: true })

/** Singular or plural, by the count. */
const s = (w: Words, one: string, many: string): string => (w.one ? one : many)

const EN: Record<HermanNudgeKind, Line[]> = {
  overdue: [
    line((w) => `${w.N} ${s(w, 'thing has', 'things have')} been waiting ${w.since}. ${s(w, 'Is it actually yours to do?', 'Which one is actually yours to do?')}`),
    line((w) => `${w.N} overdue. ${s(w, 'Do it, or drop it.', 'Do one, or drop one.')}`),
    titled((w) => `“${w.title}” has waited ${w.since}. Do it, or drop it.`),
    line((w) => `Something has waited ${w.since}. The smallest step?`),
    line((w) => `${w.N} late. What is that telling you?`),
    titled((w) => `You keep walking past “${w.title}”. Why?`),
    line((w) => `${w.N} overdue. ${s(w, 'Does it still matter?', 'Which still matters?')}`),
    line((w) => `The oldest task has waited ${w.since}. Still true?`),
    line((w) => `${w.N} waiting ${w.since}. Ten minutes would change the day.`),
    line(() => 'Old tasks weigh more in the head. Look at them.')
  ],
  today: [
    line((w) => `${w.N} for today. ${s(w, 'When will you do it?', 'Which one first?')}`),
    line((w) => `${w.N} today. ${s(w, 'Start before you think about it.', 'Start with the one you would rather not.')}`),
    line((w) => `${w.N} ${s(w, 'thing', 'things')} today. That fits in a day.`),
    titled((w) => `“${w.title}” is for today. Now?`),
    line((w) => `${w.N} ${s(w, 'task', 'tasks')} today. ${s(w, 'Do it whole, then stop.', 'One at a time, each one whole.')}`),
    line(() => 'Today’s list can be finished.'),
    line((w) => `${w.N} for today. Just the first ten minutes.`),
    line(() => 'What did you promise yourself today?')
  ],
  'free-block': [
    line((w) => `Nothing scheduled ${w.until}. What deserves it?`),
    line((w) => `${w.Span} free. Give it to deep work.`),
    line((w) => `Clear ${w.until}. Choose one thing.`),
    line((w) => `No meetings ${w.until}. Use it well.`),
    line((w) => `${w.Span} without interruption. Close the rest.`),
    line((w) => `Quiet ${w.until}. Which page is waiting?`),
    line(() => 'Empty time fills itself. What should fill this?'),
    line((w) => `Nothing booked ${w.until}. Slow work is allowed.`)
  ],
  'long-session': [
    line((w) => `${w.Minutes} minutes. Stand up.`),
    line((w) => `${w.Minutes} minutes here. Look far away.`),
    line((w) => `${w.Minutes} minutes. Is the work still moving?`),
    line((w) => `${w.Minutes} minutes without a pause. Try the window.`),
    line(() => 'A long sitting. Drink some water.'),
    line((w) => `${w.Minutes} minutes. Say in one line what this page wants.`),
    line(() => 'Tired eyes edit badly. Five minutes away.'),
    line((w) => `Still here after ${w.minutes} minutes. A short walk?`),
    line((w) => `${w.Minutes} minutes in. Note what comes next, then breathe.`)
  ],
  reopened: [
    line((w) => `Untouched for ${w.ago}. Still true?`),
    line((w) => `${w.Ago} since you were here. Read it fresh.`),
    line(() => 'An old page. What brought you back?'),
    line((w) => `Resting for ${w.ago}. Has it improved?`),
    line((w) => `Left ${w.ago} ago. Keep, finish or let go?`),
    line((w) => `${w.Ago} of dust. What is still alive here?`),
    line((w) => `This waited ${w.ago} for a reply.`),
    line((w) => `Back after ${w.ago}. Read before you change it.`)
  ],
  morning: [
    line(() => 'Morning. What is the one thing?'),
    line(() => 'A new day. Leave yesterday behind.'),
    line(() => 'Good morning. Look at the day once, slowly.'),
    line(() => 'Here again. What would make today enough?'),
    line(() => 'Morning. Listen for what matters.'),
    line(() => 'Before anything asks: what do you want today?'),
    line(() => 'Another morning. Begin small.'),
    line(() => 'Good morning. Start with what is in front of you.')
  ],
  // Each is an invitation to close the day: its button opens the ritual.
  evening: [
    line(() => 'Enough for today. What is worth keeping?'),
    line(() => 'The day is closing. Shall we close it properly?'),
    line(() => 'Evening. The unfinished can wait until tomorrow.'),
    line(() => 'A good place to end. One line for the notebook?'),
    line(() => 'Late enough. Leave tomorrow three small things.'),
    line(() => 'Close the day before it closes you.'),
    line(() => 'Day’s end. One thing you would repeat?'),
    line(() => 'You gave today what you had. Close gently.')
  ],
  streak: [
    line((w) => `${w.N} done. Notice how that feels.`),
    line((w) => `${w.N} in a row. Be pleased.`),
    line((w) => `${w.N} crossed off. Keep the door open.`),
    line((w) => `${w.N} done. Which one mattered?`),
    line((w) => `${w.N} in a row. Now the one you avoid.`),
    line(() => 'Done, done, done. Rest a minute.'),
    line((w) => `${w.N} closed. Less to carry.`),
    line((w) => `Steady today. ${w.N} done.`)
  ]
}

const PT: Record<HermanNudgeKind, Line[]> = {
  overdue: [
    line((w) => `${w.N} ${s(w, 'coisa espera', 'coisas esperam')} ${w.since}. ${s(w, 'Ela é mesmo sua?', 'Qual delas é mesmo sua?')}`),
    line((w) => `${w.N} ${s(w, 'atrasada', 'atrasadas')}. ${s(w, 'Faça, ou solte.', 'Faça uma, ou solte uma.')}`),
    titled((w) => `“${w.title}” espera ${w.since}. Faça, ou solte.`),
    line((w) => `Algo espera ${w.since}. Qual o menor passo?`),
    line((w) => `${w.N} ${s(w, 'tarefa atrasada', 'tarefas atrasadas')}. O que isso diz?`),
    titled((w) => `Você passa por “${w.title}” sem olhar. Por quê?`),
    line((w) => `${w.N} ${s(w, 'pendência vencida', 'pendências vencidas')}. ${s(w, 'Ainda importa?', 'Qual ainda importa?')}`),
    line((w) => `A tarefa mais antiga espera ${w.since}. Ainda vale?`),
    line((w) => `${w.N} esperando ${w.since}. Dez minutos mudam o dia.`),
    line(() => 'Tarefa velha pesa mais na cabeça. Olhe para elas.')
  ],
  today: [
    line((w) => `${w.N} ${s(w, 'coisa', 'coisas')} para hoje. ${s(w, 'Quando você faz?', 'Qual vem primeiro?')}`),
    line((w) => `${w.N} na lista de hoje. ${s(w, 'Comece antes de pensar.', 'Comece pela que menos quer.')}`),
    line((w) => `Hoje pede ${w.n} ${s(w, 'coisa', 'coisas')}. Cabe num dia.`),
    titled((w) => `“${w.title}” é para hoje. Agora?`),
    line((w) => `${w.N} ${s(w, 'tarefa', 'tarefas')} hoje. ${s(w, 'Inteira, e pare.', 'Uma de cada vez, inteira.')}`),
    line(() => 'A lista de hoje dá para terminar.'),
    line((w) => `${w.N} para hoje. Só os primeiros dez minutos.`),
    line(() => 'O que você prometeu a si para hoje?')
  ],
  'free-block': [
    line((w) => `Nada na agenda ${w.until}. O que merece esse tempo?`),
    line((w) => `${w.Span} sem ninguém pedindo nada. Use bem.`),
    line((w) => `Livre ${w.until}. Escolha uma coisa.`),
    line((w) => `Sem reuniões ${w.until}. Aproveite.`),
    line((w) => `${w.Span} sem interrupção. Feche o resto.`),
    line((w) => `Agenda quieta ${w.until}. Qual página espera você?`),
    line(() => 'Tempo vazio se enche sozinho. O que cabe aqui?'),
    line((w) => `Nada marcado ${w.until}. Trabalho lento é permitido.`)
  ],
  'long-session': [
    line((w) => `${w.Minutes} minutos. Levante-se.`),
    line((w) => `${w.Minutes} minutos aqui. Olhe para longe.`),
    line((w) => `${w.Minutes} minutos. O trabalho ainda anda?`),
    line((w) => `${w.Minutes} minutos sem pausa. Vá até a janela.`),
    line(() => 'Uma sentada longa. Beba água.'),
    line((w) => `${w.Minutes} minutos. Diga numa linha o que esta página quer.`),
    line(() => 'Olho cansado revisa mal. Cinco minutos longe.'),
    line((w) => `Ainda aqui depois de ${w.minutes} minutos. Uma caminhada?`),
    line((w) => `${w.Minutes} minutos. Anote o que vem depois, e respire.`)
  ],
  reopened: [
    line((w) => `Sem mexer há ${w.ago}. Ainda é verdade?`),
    line((w) => `${w.Ago} desde a última vez. Leia com olhos novos.`),
    line(() => 'Uma página antiga. O que trouxe você de volta?'),
    line((w) => `Descansou por ${w.ago}. Melhorou?`),
    line((w) => `Deixada há ${w.ago}. Guardar, terminar ou soltar?`),
    line((w) => `${w.Ago} de poeira. O que ainda vive aqui?`),
    line((w) => `Esta esperou ${w.ago} por uma resposta.`),
    line((w) => `De volta após ${w.ago}. Leia antes de mudar.`)
  ],
  morning: [
    line(() => 'Bom dia. Qual é a coisa de hoje?'),
    line(() => 'Dia novo. Deixe o de ontem para trás.'),
    line(() => 'Bom dia. Olhe o dia uma vez, devagar.'),
    line(() => 'De novo aqui. O que faria hoje bastar?'),
    line(() => 'Bom dia. Escute o que importa.'),
    line(() => 'Antes que peçam algo: o que você quer de hoje?'),
    line(() => 'Mais uma manhã. Comece pequeno.'),
    line(() => 'Bom dia. Comece pelo que está na frente.')
  ],
  evening: [
    line(() => 'Chega por hoje. O que vale guardar?'),
    line(() => 'O dia está fechando. Vamos fechá-lo direito?'),
    line(() => 'Fim de tarde. O inacabado pode esperar até amanhã.'),
    line(() => 'Bom lugar para parar. Uma linha para o caderno?'),
    line(() => 'Já é tarde. Deixe três coisas pequenas para amanhã.'),
    line(() => 'Feche o dia antes que ele feche você.'),
    line(() => 'Fim do dia. Uma coisa que você repetiria?'),
    line(() => 'Você deu a hoje o que tinha. Feche com calma.')
  ],
  streak: [
    line((w) => `${w.N} feitas. Repare em como é.`),
    line((w) => `${w.N} em sequência. Pode ficar contente.`),
    line((w) => `${w.N} riscadas. Deixe a porta aberta.`),
    line((w) => `${w.N} feitas. Qual delas importava?`),
    line((w) => `${w.N} em sequência. Agora aquela que você evita.`),
    line(() => 'Feita, feita, feita. Descanse um minuto.'),
    line((w) => `${w.N} fechadas. Menos peso.`),
    line((w) => `Mão firme hoje. ${w.N} feitas.`)
  ]
}

export const LINES: Record<HermanLocale, Record<HermanNudgeKind, Line[]>> = { en: EN, 'pt-BR': PT }

/** The words around his lines: what the buttons say, and what he says of himself. */
export const PHRASES: Record<
  HermanLocale,
  {
    openToday: string
    /** The evening invitation's button: it opens the ritual that closes the day. */
    closeDay: string
    openTask: string
    ask: string
    notNow: string
    fewer: string
    /** His introduction, said once: a greeting and his name, nothing about himself. */
    greeting: string
    /** Said when he is asked to talk while AI is turned off. */
    aiOff: string
    /** Questions he writes into the conversation for the user to send or change. */
    askFirst: string
    askPage: string
  }
> = {
  en: {
    openToday: 'Open Today',
    closeDay: 'Close the day',
    openTask: 'Open it',
    ask: 'Ask Herman',
    notNow: 'Not now',
    fewer: 'Fewer like this',
    greeting: 'Hello. I am Herman.',
    aiOff: 'AI is off in Settings.',
    askFirst: 'What should I do first today?',
    askPage: 'What is this page really about?'
  },
  'pt-BR': {
    openToday: 'Abrir Hoje',
    closeDay: 'Fechar o dia',
    openTask: 'Abrir',
    ask: 'Perguntar ao Herman',
    notNow: 'Agora não',
    fewer: 'Menos como esta',
    greeting: 'Olá. Sou o Herman.',
    aiOff: 'A IA está desligada em Settings.',
    askFirst: 'O que devo fazer primeiro hoje?',
    askPage: 'Sobre o que é esta página, de verdade?'
  }
}

// ---- words --------------------------------------------------------------------

const NUMBERS: Record<HermanLocale, readonly string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
  'pt-BR': ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze']
}
const TENS: Record<HermanLocale, Record<number, string>> = {
  en: { 15: 'fifteen', 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety' },
  'pt-BR': { 15: 'quinze', 20: 'vinte', 30: 'trinta', 40: 'quarenta', 50: 'cinquenta', 60: 'sessenta', 70: 'setenta', 80: 'oitenta', 90: 'noventa' }
}
const WEEKDAYS: Record<HermanLocale, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  'pt-BR': ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
}

export function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : text
}

/** A count in words up to twelve, in digits beyond. `feminine` matters in Portuguese only (uma, duas). */
export function numberWord(value: number, locale: HermanLocale, feminine = false): string {
  const n = Math.max(0, Math.round(value))
  if (locale === 'pt-BR' && feminine && (n === 1 || n === 2)) return n === 1 ? 'uma' : 'duas'
  return NUMBERS[locale][n] ?? TENS[locale][n] ?? String(n)
}

/** "since yesterday", "since Thursday", "since last week", "for weeks": how long something has waited. */
export function sinceWords(daysLate: number, today: Date, locale: HermanLocale): string {
  const days = Math.max(1, Math.round(daysLate))
  const pt = locale === 'pt-BR'
  if (days === 1) return pt ? 'desde ontem' : 'since yesterday'
  if (days <= 6) {
    const then = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)
    return `${pt ? 'desde' : 'since'} ${WEEKDAYS[locale][then.getDay()]}`
  }
  if (days <= 13) return pt ? 'desde a semana passada' : 'since last week'
  return pt ? 'há semanas' : 'for weeks'
}

/** "two months", "a month", "more than a year": how long a page went untouched. */
export function agoWords(days: number, locale: HermanLocale): string {
  const pt = locale === 'pt-BR'
  const months = Math.max(1, Math.round(days / 30))
  if (days >= 400) return pt ? 'mais de um ano' : 'more than a year'
  if (months >= 12) return pt ? 'um ano' : 'a year'
  if (months === 1) return pt ? 'um mês' : 'a month'
  return `${numberWord(months, locale)} ${pt ? 'meses' : 'months'}`
}

/** "an hour and a half", "two hours": a free stretch, rounded down to half hours. */
export function spanWords(minutes: number, locale: HermanLocale): string {
  const pt = locale === 'pt-BR'
  const halves = Math.max(2, Math.floor(minutes / 30))
  const hours = Math.floor(halves / 2)
  const half = halves % 2 === 1
  if (hours === 1) return half ? (pt ? 'uma hora e meia' : 'an hour and a half') : pt ? 'uma hora' : 'an hour'
  const count = numberWord(hours, locale, true)
  if (pt) return `${count} horas${half ? ' e meia' : ''}`
  return half ? `${count} and a half hours` : `${count} hours`
}
