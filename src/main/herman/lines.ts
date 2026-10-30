import type { HermanLocale, HermanNudgeKind, PersonaId } from '../../shared/herman'

/**
 * What Herman says unasked: a small bank of lines per kind of nudge, in English and in
 * Brazilian Portuguese. Every line was written for this app; none is a quotation. They are
 * chosen and filled in locally (see ./counsel.ts): no model writes or sees them.
 *
 * His voice: observant, kind, a little dry, and few words. One short sentence, two at most; he
 * observes, and never asks an open question; never a scolding, never an explanation of himself.
 *
 * A nudge is a note of a fixed shape (docs: design "Herman: bilhete, não chat"): the line is the
 * observation; below it goes an effect line saying what the verb changes, with names (`effectOf`);
 * then the verb (the action's label) and "Not now". A line therefore never carries the action in
 * its own words, and never ends in a question.
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
    line((w) => `${w.N} ${s(w, 'thing has', 'things have')} been waiting ${w.since}.`),
    line((w) => `${w.N} overdue. ${s(w, 'Do it, or drop it.', 'Do one, or drop one.')}`),
    titled((w) => `“${w.title}” has waited ${w.since}. Do it, or drop it.`),
    line((w) => `Something has waited ${w.since}. The smallest step is enough.`),
    line((w) => `${w.N} late. ${s(w, 'It weighs', 'They weigh')} more every day.`),
    titled((w) => `You keep walking past “${w.title}”.`),
    line((w) => `${w.N} overdue. ${s(w, 'It may no longer matter.', 'Some may no longer matter.')}`),
    line((w) => `The oldest task has waited ${w.since}. It may no longer be true.`),
    line((w) => `${w.N} waiting ${w.since}. Ten minutes would change the day.`),
    line(() => 'Old tasks weigh more in the head. Look at them.')
  ],
  today: [
    line((w) => `${w.N} for today. ${s(w, 'Just that one.', 'One at a time.')}`),
    line((w) => `${w.N} today. ${s(w, 'Start before you think about it.', 'Start with the one you would rather not.')}`),
    line((w) => `${w.N} ${s(w, 'thing', 'things')} today. That fits in a day.`),
    titled((w) => `“${w.title}” is for today.`),
    line((w) => `${w.N} ${s(w, 'task', 'tasks')} today. ${s(w, 'Do it whole, then stop.', 'One at a time, each one whole.')}`),
    line(() => 'Today’s list can be finished.'),
    line((w) => `${w.N} for today. Just the first ten minutes.`),
    line(() => 'Today’s list is a promise you made yourself.')
  ],
  // Tasks in the Inbox for two days or more, still without a date, a priority or a project.
  inbox: [
    line((w) => `${w.N} ${s(w, 'thing has', 'things have')} waited in the Inbox ${w.since}.`),
    titled((w) => `“${w.title}” has sat in the Inbox ${w.since}.`),
    line((w) => `The Inbox has held ${w.n} ${s(w, 'thing', 'things')} ${w.since}.`),
    line((w) => `Things have waited in the Inbox ${w.since}. Decided, they weigh less.`),
    line((w) => `${w.N} in the Inbox, unsorted. A date is the first step.`),
    line((w) => `${w.N} without a place ${w.since}. ${s(w, 'It is easy to place.', 'Some are easy to place.')}`),
    titled((w) => `“${w.title}” is still in the Inbox, without a home.`),
    line(() => 'The Inbox is for catching, not keeping.')
  ],
  'free-block': [
    line((w) => `Nothing scheduled ${w.until}. Something deserves it.`),
    line((w) => `${w.Span} free. Give it to deep work.`),
    line((w) => `Clear ${w.until}. Choose one thing.`),
    line((w) => `No meetings ${w.until}. Use it well.`),
    line((w) => `${w.Span} without interruption. Close the rest.`),
    line((w) => `Quiet ${w.until}. A page is waiting.`),
    line(() => 'Empty time fills itself. Decide what fills this.'),
    line((w) => `Nothing booked ${w.until}. Slow work is allowed.`)
  ],
  'long-session': [
    line((w) => `${w.Minutes} minutes. Stand up.`),
    line((w) => `${w.Minutes} minutes here. Look far away.`),
    line((w) => `${w.Minutes} minutes. The work may have stopped moving.`),
    line((w) => `${w.Minutes} minutes without a pause. Try the window.`),
    line(() => 'A long sitting. Drink some water.'),
    line((w) => `${w.Minutes} minutes. Say in one line what this page wants.`),
    line(() => 'Tired eyes edit badly. Five minutes away.'),
    line((w) => `Still here after ${w.minutes} minutes. A short walk would help.`),
    line((w) => `${w.Minutes} minutes in. Note what comes next, then breathe.`)
  ],
  reopened: [
    line((w) => `Untouched for ${w.ago}. It may not be true anymore.`),
    line((w) => `${w.Ago} since you were here. Read it fresh.`),
    line(() => 'An old page. Something brought you back.'),
    line((w) => `Resting for ${w.ago}. It may have improved.`),
    line((w) => `Left ${w.ago} ago. Keep it, finish it or let it go.`),
    line((w) => `${w.Ago} of dust. Something here is still alive.`),
    line((w) => `This waited ${w.ago} for a reply.`),
    line((w) => `Back after ${w.ago}. Read before you change it.`)
  ],
  morning: [
    line(() => 'Morning. Pick the one thing.'),
    line(() => 'A new day. Leave yesterday behind.'),
    line(() => 'Good morning. Look at the day once, slowly.'),
    line(() => 'Here again. Decide what would make today enough.'),
    line(() => 'Morning. Listen for what matters.'),
    line(() => 'Before anything asks, choose what you want today.'),
    line(() => 'Another morning. Begin small.'),
    line(() => 'Good morning. Start with what is in front of you.')
  ],
  // Each is an invitation to close the day: its button opens the ritual.
  evening: [
    line(() => 'Enough for today. Keep what is worth keeping.'),
    line(() => 'The day is closing. Let us close it properly.'),
    line(() => 'Evening. The unfinished can wait until tomorrow.'),
    line(() => 'A good place to end. One line for your Meditations.'),
    line(() => 'Late enough. Leave tomorrow three small things.'),
    line(() => 'Close the day before it closes you.'),
    line(() => 'Day’s end. Name one thing you would repeat.'),
    line(() => 'You gave today what you had. Close gently.')
  ],
  streak: [
    line((w) => `${w.N} done. Notice how that feels.`),
    line((w) => `${w.N} in a row. Be pleased.`),
    line((w) => `${w.N} crossed off. Keep the door open.`),
    line((w) => `${w.N} done. One of them mattered most.`),
    line((w) => `${w.N} in a row. Now the one you avoid.`),
    line(() => 'Done, done, done. Rest a minute.'),
    line((w) => `${w.N} closed. Less to carry.`),
    line((w) => `Steady today. ${w.N} done.`)
  ]
}

const PT: Record<HermanNudgeKind, Line[]> = {
  overdue: [
    line((w) => `${w.N} ${s(w, 'coisa espera', 'coisas esperam')} ${w.since}.`),
    line((w) => `${w.N} ${s(w, 'atrasada', 'atrasadas')}. ${s(w, 'Faça, ou solte.', 'Faça uma, ou solte uma.')}`),
    titled((w) => `“${w.title}” espera ${w.since}. Faça, ou solte.`),
    line((w) => `Algo espera ${w.since}. O menor passo já basta.`),
    line((w) => `${w.N} ${s(w, 'tarefa atrasada', 'tarefas atrasadas')}. ${s(w, 'Pesa', 'Pesam')} mais a cada dia.`),
    titled((w) => `Você passa por “${w.title}” sem olhar.`),
    line(
      (w) =>
        `${w.N} ${s(w, 'pendência vencida', 'pendências vencidas')}. ${s(w, 'Pode já não importar.', 'Algumas podem já não importar.')}`
    ),
    line((w) => `A tarefa mais antiga espera ${w.since}. Pode já não ser verdade.`),
    line((w) => `${w.N} esperando ${w.since}. Dez minutos mudam o dia.`),
    line(() => 'Tarefa velha pesa mais na cabeça. Olhe para elas.')
  ],
  today: [
    line((w) => `${w.N} ${s(w, 'coisa', 'coisas')} para hoje. ${s(w, 'Só essa.', 'Uma de cada vez.')}`),
    line((w) => `${w.N} na lista de hoje. ${s(w, 'Comece antes de pensar.', 'Comece pela que menos quer.')}`),
    line((w) => `Hoje pede ${w.n} ${s(w, 'coisa', 'coisas')}. Cabe num dia.`),
    titled((w) => `“${w.title}” é para hoje.`),
    line((w) => `${w.N} ${s(w, 'tarefa', 'tarefas')} hoje. ${s(w, 'Inteira, e pare.', 'Uma de cada vez, inteira.')}`),
    line(() => 'A lista de hoje dá para terminar.'),
    line((w) => `${w.N} para hoje. Só os primeiros dez minutos.`),
    line(() => 'A lista de hoje é uma promessa que você fez a si.')
  ],
  // Tasks in the Inbox for two days or more, still without a date, a priority or a project.
  inbox: [
    line((w) => `${w.N} ${s(w, 'coisa espera', 'coisas esperam')} no Inbox ${w.since}.`),
    titled((w) => `“${w.title}” está no Inbox ${w.since}.`),
    line((w) => `O Inbox guarda ${w.n} ${s(w, 'coisa', 'coisas')} ${w.since}.`),
    line((w) => `Há coisas no Inbox ${w.since}. Decididas, pesam menos.`),
    line((w) => `${w.N} no Inbox, sem pontuar. A data é o primeiro passo.`),
    line((w) => `${w.N} sem lugar ${w.since}. ${s(w, 'É fácil de encaixar.', 'Algumas são fáceis de encaixar.')}`),
    titled((w) => `“${w.title}” ainda está no Inbox, sem casa.`),
    line(() => 'O Inbox é para pegar, não para guardar.')
  ],
  'free-block': [
    line((w) => `Nada na agenda ${w.until}. Algo merece esse tempo.`),
    line((w) => `${w.Span} sem ninguém pedindo nada. Use bem.`),
    line((w) => `Livre ${w.until}. Escolha uma coisa.`),
    line((w) => `Sem reuniões ${w.until}. Aproveite.`),
    line((w) => `${w.Span} sem interrupção. Feche o resto.`),
    line((w) => `Agenda quieta ${w.until}. Uma página espera você.`),
    line(() => 'Tempo vazio se enche sozinho. Decida o que cabe aqui.'),
    line((w) => `Nada marcado ${w.until}. Trabalho lento é permitido.`)
  ],
  'long-session': [
    line((w) => `${w.Minutes} minutos. Levante-se.`),
    line((w) => `${w.Minutes} minutos aqui. Olhe para longe.`),
    line((w) => `${w.Minutes} minutos. O trabalho pode ter parado de andar.`),
    line((w) => `${w.Minutes} minutos sem pausa. Vá até a janela.`),
    line(() => 'Uma sentada longa. Beba água.'),
    line((w) => `${w.Minutes} minutos. Diga numa linha o que esta página quer.`),
    line(() => 'Olho cansado revisa mal. Cinco minutos longe.'),
    line((w) => `Ainda aqui depois de ${w.minutes} minutos. Uma caminhada ajudaria.`),
    line((w) => `${w.Minutes} minutos. Anote o que vem depois, e respire.`)
  ],
  reopened: [
    line((w) => `Sem mexer há ${w.ago}. Pode já não ser verdade.`),
    line((w) => `${w.Ago} desde a última vez. Leia com olhos novos.`),
    line(() => 'Uma página antiga. Algo trouxe você de volta.'),
    line((w) => `Descansou por ${w.ago}. Pode ter melhorado.`),
    line((w) => `Deixada há ${w.ago}. Guarde, termine ou solte.`),
    line((w) => `${w.Ago} de poeira. Algo aqui ainda vive.`),
    line((w) => `Esta esperou ${w.ago} por uma resposta.`),
    line((w) => `De volta após ${w.ago}. Leia antes de mudar.`)
  ],
  morning: [
    line(() => 'Bom dia. Escolha a coisa de hoje.'),
    line(() => 'Dia novo. Deixe o de ontem para trás.'),
    line(() => 'Bom dia. Olhe o dia uma vez, devagar.'),
    line(() => 'De novo aqui. Decida o que faria hoje bastar.'),
    line(() => 'Bom dia. Escute o que importa.'),
    line(() => 'Antes que peçam algo, escolha o que quer de hoje.'),
    line(() => 'Mais uma manhã. Comece pequeno.'),
    line(() => 'Bom dia. Comece pelo que está na frente.')
  ],
  evening: [
    line(() => 'Chega por hoje. Guarde o que vale guardar.'),
    line(() => 'O dia está fechando. Vamos fechá-lo direito.'),
    line(() => 'Fim de tarde. O inacabado pode esperar até amanhã.'),
    line(() => 'Bom lugar para parar. Uma linha para as Meditações.'),
    line(() => 'Já é tarde. Deixe três coisas pequenas para amanhã.'),
    line(() => 'Feche o dia antes que ele feche você.'),
    line(() => 'Fim do dia. Escolha uma coisa que você repetiria.'),
    line(() => 'Você deu a hoje o que tinha. Feche com calma.')
  ],
  streak: [
    line((w) => `${w.N} feitas. Repare em como é.`),
    line((w) => `${w.N} em sequência. Pode ficar contente.`),
    line((w) => `${w.N} riscadas. Deixe a porta aberta.`),
    line((w) => `${w.N} feitas. Uma delas importou mais.`),
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
    /** The Inbox nudge's button: the refine mode. */
    refineNow: string
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
    refineNow: 'Refine now',
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
    refineNow: 'Refinar agora',
    ask: 'Perguntar ao Herman',
    notNow: 'Agora não',
    fewer: 'Menos como esta',
    greeting: 'Olá. Sou o Herman.',
    aiOff: 'A IA está desligada em Settings.',
    askFirst: 'O que devo fazer primeiro hoje?',
    askPage: 'Sobre o que é esta página, de verdade?'
  }
}

// ---- the effect line ------------------------------------------------------------------
//
// Under the observation, in mono: what the verb will change, with names. Written as the results
// the app already has (a screen opens, tasks move); it never promises more than the verb does.

/** What a verb does, as far as the effect line says it. */
export type EffectKind =
  | 'open-today'
  | 'open-today-overdue'
  | 'open-today-left'
  | 'open-task'
  | 'date-tasks'
  | 'refine'
  | 'ask'
  | 'close-day'

export interface EffectFacts {
  /** How many are meant (overdue tasks, tasks to go through). */
  count?: number
  /** The title a verb opens. */
  title?: string
  /** The tasks a verb changes, already tidied, in order. */
  names?: readonly string[]
}

/** How many names the effect line spells out before saying "and N more". */
export const EFFECT_NAMES = 3

/** "A, B and C", "A, B, C and 2 more". */
export function nameList(names: readonly string[], locale: HermanLocale): string {
  const pt = locale === 'pt-BR'
  const shown = names.slice(0, EFFECT_NAMES)
  const rest = names.length - shown.length
  const items = rest > 0 ? [...shown, pt ? `mais ${rest}` : `${rest} more`] : shown
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${pt ? 'e' : 'and'} ${items[items.length - 1]}`
}

/** The verb that dates tasks: "Date the 3" / "Datar as 3". */
export function dateVerb(count: number, locale: HermanLocale): string {
  if (locale === 'pt-BR') return count === 1 ? 'Datar' : `Datar as ${count}`
  return count === 1 ? 'Date it' : `Date the ${count}`
}

/** "→ 3 without a date" style line: what the verb changes, with names. */
export function effectOf(locale: HermanLocale, kind: EffectKind, facts: EffectFacts = {}): string {
  const pt = locale === 'pt-BR'
  const count = facts.count ?? 0
  switch (kind) {
    case 'open-today':
      return pt ? '→ abre Hoje, na ordem do prazo' : '→ opens Today, in order of deadline'
    case 'open-today-overdue':
      if (pt) return count === 1 ? '→ abre Hoje, a atrasada primeiro' : `→ abre Hoje, ${count} atrasadas primeiro`
      return count === 1 ? '→ opens Today, the overdue one first' : `→ opens Today, ${count} overdue first`
    case 'open-today-left':
      return pt ? '→ abre Hoje, para ver o que falta' : '→ opens Today, to see what is left'
    case 'open-task':
      return pt ? `→ abre “${facts.title ?? ''}”` : `→ opens “${facts.title ?? ''}”`
    case 'date-tasks': {
      const names = facts.names ?? []
      const list = nameList(names, locale)
      if (pt) return `→ ${list} ${names.length === 1 ? 'vai' : 'vão'} para amanhã`
      return `→ ${list} ${names.length === 1 ? 'moves' : 'move'} to tomorrow`
    }
    case 'refine':
      return pt ? `→ abre o modo de refino, ${count} para passar` : `→ opens the refine mode, ${count} to go through`
    case 'ask':
      return pt ? '→ escreve uma pergunta no chat, nada é enviado' : '→ writes a question in the chat, nothing is sent'
    case 'close-day':
      return pt ? '→ abre os passos de fechar o dia, poucos minutos' : '→ opens the steps that close the day, a few minutes'
  }
}

/** The phrases that name the persona, written for each: the rest of PHRASES serves both. */
const NAMED: Record<PersonaId, Record<HermanLocale, { ask: string; greeting: string }>> = {
  herman: {
    en: { ask: PHRASES.en.ask, greeting: PHRASES.en.greeting },
    'pt-BR': { ask: PHRASES['pt-BR'].ask, greeting: PHRASES['pt-BR'].greeting }
  },
  hermine: {
    en: { ask: 'Ask Hermine', greeting: 'Hello. I am Hermine.' },
    'pt-BR': { ask: 'Perguntar à Hermine', greeting: 'Olá. Sou a Hermine.' }
  }
}

/** The words around the lines of the chosen persona. The lines themselves never name or gender the one who says them. */
export function phrasesOf(locale: HermanLocale, persona: PersonaId = 'herman'): (typeof PHRASES)[HermanLocale] {
  return { ...PHRASES[locale], ...NAMED[persona][locale] }
}

// ---- words --------------------------------------------------------------------

const NUMBERS: Record<HermanLocale, readonly string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
  'pt-BR': ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze']
}
const TENS: Record<HermanLocale, Record<number, string>> = {
  en: { 15: 'fifteen', 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety' },
  'pt-BR': {
    15: 'quinze',
    20: 'vinte',
    30: 'trinta',
    40: 'quarenta',
    50: 'cinquenta',
    60: 'sessenta',
    70: 'setenta',
    80: 'oitenta',
    90: 'noventa'
  }
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

// ---- the Sky ------------------------------------------------------------------------
//
// What he says about the Sky (shared/sky): rarely, once a day at most, and only about something
// that happened there. Never about what is missing, never with a count. Outside the counsel: the
// Sky decides the moment and these lines say it.

export type SkyLineMoment =
  | { kind: 'named'; month: string; name: string; given: boolean }
  | { kind: 'meteors'; shower: string }
  | { kind: 'eclipse' }
  | { kind: 'comet' }
  | { kind: 'anniversary' }
  | { kind: 'longest-night' }
  | { kind: 'new-year'; year: number }

export const SKY_LINES: Record<HermanLocale, (moment: SkyLineMoment) => string> = {
  en: (m) => {
    switch (m.kind) {
      case 'named':
        return m.given ? `${m.month} became “${m.name}”.` : `${m.month} became ${m.name}.`
      case 'meteors':
        return `Tonight is the night of the ${m.shower}.`
      case 'eclipse':
        return 'An eclipse tonight. The moon turns copper.'
      case 'comet':
        return 'A comet is passing. It stays a few days.'
      case 'anniversary':
        return 'The first star has its birthday today.'
      case 'longest-night':
        return 'The longest night of the year.'
      case 'new-year':
        return `Happy new year. The sky of ${m.year} begins empty, like a page.`
    }
  },
  'pt-BR': (m) => {
    switch (m.kind) {
      case 'named':
        return m.given ? `${m.month} virou “${m.name}”.` : `${m.month} virou ${m.name}.`
      case 'meteors':
        return `Hoje é noite das ${m.shower}.`
      case 'eclipse':
        return 'Eclipse esta noite. A lua fica cor de cobre.'
      case 'comet':
        return 'Tem um cometa passando. Fica alguns dias.'
      case 'anniversary':
        return 'A primeira estrela faz aniversário hoje.'
      case 'longest-night':
        return 'A noite mais longa do ano.'
      case 'new-year':
        return `Feliz ano novo. O céu de ${m.year} começa vazio, como uma página.`
    }
  }
}
