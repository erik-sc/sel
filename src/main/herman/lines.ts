import type { HermanLocale, HermanNudgeKind } from '../../shared/herman'

/**
 * What Herman says unasked: a small bank of lines per kind of nudge, in English and in
 * Brazilian Portuguese. Every line was written for this app; none is a quotation. They are
 * chosen and filled in locally (see ./counsel.ts): no model writes or sees them.
 *
 * His voice: observant, kind, a little dry. One or two short sentences; a question more often
 * than an instruction; never a scolding.
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
    line((w) => `${w.N} overdue. ${s(w, 'It does', 'They do')} not get lighter by being carried. ${s(w, 'Do it, or put it down.', 'Pick one, or let one go.')}`),
    titled((w) => `“${w.title}” has been waiting ${w.since}. Do it, or decide not to. Both are allowed.`),
    line((w) => `Something has been waiting ${w.since}. What is the smallest honest step on it?`),
    line((w) => `${w.N} late ${s(w, 'task', 'tasks')}. Lateness is only information. What is it telling you?`),
    titled((w) => `You keep walking past “${w.title}”. What is it you do not want to find there?`),
    line((w) => `${w.N} ${s(w, 'thing', 'things')} overdue. ${s(w, 'Does it still deserve you?', 'Not all of them deserve you. Which one does?')}`),
    line((w) => `The oldest thing on your list has been there ${w.since}. Is it still true?`),
    line((w) => `${w.N} waiting ${w.since}. Ten quiet minutes on ${s(w, 'it', 'one of them')} would change the day.`),
    line(() => 'Old tasks grow heavier in the mind than on the page. Open the list and look at them plainly.')
  ],
  today: [
    line((w) => `${w.N} ${s(w, 'thing', 'things')} for today. ${s(w, 'When will you give it its hour?', 'Which one, if done, would make the rest easier?')}`),
    line((w) => `${w.N} on the list today. ${s(w, 'Start before you have decided how you feel about it.', 'Start with the one you would rather not.')}`),
    line((w) => `Today asks ${w.n} ${s(w, 'thing', 'things')} of you. That is a number a person can hold.`),
    titled((w) => `“${w.title}” is for today. Is now a bad time, or only an uncomfortable one?`),
    line((w) => `${w.N} ${s(w, 'task', 'tasks')} today. ${s(w, 'Do it completely, then stop.', 'Do one completely before you touch the next.')}`),
    line(() => 'Today’s list can be finished. That is rarer than it sounds.'),
    line((w) => `${w.N} for today. You do not need a better plan. You need the first ten minutes.`),
    line(() => 'Before the next thing arrives: what did you promise yourself for today?')
  ],
  'event-soon': [
    titled((w) => `“${w.title}” in ${w.minutes} minutes. Close this thought first, so it does not follow you in.`),
    titled((w) => `${w.Minutes} minutes until “${w.title}”. What do you want to have said by the end of it?`),
    titled((w) => `“${w.title}” starts in ${w.minutes} minutes. Water, a breath, then go.`),
    titled((w) => `Nearly time for “${w.title}”. One line now on what you need from it will save ten later.`),
    line((w) => `${w.Minutes} minutes until the next thing. Enough to write down where you stopped.`),
    titled((w) => `“${w.title}” is close. Arrive a minute early and say nothing for that minute.`),
    titled((w) => `You have ${w.minutes} minutes before “${w.title}”. Do not start anything you cannot put down.`),
    titled((w) => `Soon: “${w.title}”. Shall I open a page for the notes?`)
  ],
  'free-block': [
    line((w) => `Nothing on the calendar ${w.until}. What deserves the quiet?`),
    line((w) => `You have ${w.span} with no one asking for you. Give it to the work that needs a whole mind.`),
    line((w) => `A clear stretch ${w.until}. Choose one thing for it before it chooses for you.`),
    line((w) => `No meetings ${w.until}. This is what the busy days were for.`),
    line((w) => `${w.Span} without interruption is rare. Close what you do not need.`),
    line((w) => `The calendar is quiet ${w.until}. Which page have you been meaning to return to?`),
    line(() => 'Empty time fills itself if you let it. What do you want this stretch to hold?'),
    line((w) => `Nothing scheduled ${w.until}. Slow work is allowed now.`)
  ],
  'long-session': [
    line((w) => `${w.Minutes} minutes. The page will keep. Stand up.`),
    line((w) => `${w.Minutes} minutes on this page. Look at something far away for a moment.`),
    line((w) => `You have been here ${w.minutes} minutes. Is the work still moving, or only you?`),
    line((w) => `${w.Minutes} minutes without a pause. The next good sentence is probably by the window.`),
    line(() => 'A long sitting. Drink some water, then read the last paragraph as a stranger would.'),
    line((w) => `${w.Minutes} minutes. What is this page trying to become? Say it in one line, then rest.`),
    line(() => 'Tired eyes edit badly. Five minutes away will cost you nothing.'),
    line((w) => `Still here after ${w.minutes} minutes. That is devotion or avoidance. A short walk will tell you which.`),
    line((w) => `${w.Minutes} minutes in. Mark your place with a sentence about what comes next, and breathe.`)
  ],
  reopened: [
    line((w) => `You have not touched this page in ${w.ago}. Does it still say what you think?`),
    line((w) => `${w.Ago} since you were last here. Read it as if someone else wrote it.`),
    line(() => 'An old page. Before you change anything: what made you come back?'),
    line((w) => `This one has been resting for ${w.ago}. Some things improve that way. Has this?`),
    line((w) => `You left this ${w.ago} ago. What would you tell the person who wrote it?`),
    line((w) => `Back after ${w.ago}. Keep it, finish it, or let it go. All three are honest.`),
    line((w) => `Old notes are letters from yourself. This one waited ${w.ago} for a reply.`),
    line((w) => `${w.Ago} of dust on this page. What is still alive in it?`)
  ],
  morning: [
    line(() => 'Morning. Before the day starts choosing for you: what is the one thing?'),
    line(() => 'A new day. You do not have to carry yesterday into it.'),
    line(() => 'Good morning. Look at the day once, slowly, before you step into it.'),
    line(() => 'Here again. What would make tonight feel like enough?'),
    line(() => 'Morning. The list will say many things. Listen for the one that matters.'),
    line(() => 'Before anything asks for you: what do you want from today?'),
    line(() => 'Another morning, as plain as the last. Begin small.'),
    line(() => 'Good morning. Start with what is in front of you. The rest is weather.')
  ],
  evening: [
    line(() => 'Enough for one day. What is worth remembering from it?'),
    line(() => 'The day is closing. Write one line about where you stopped, and stop.'),
    line(() => 'Evening. What you did not finish will still be unfinished tomorrow. Let it wait there.'),
    line(() => 'A good place to end. What went better than you expected?'),
    line(() => 'Late enough. Leave tomorrow a note, then leave.'),
    line(() => 'The work does not need you tired. What is the last small thing?'),
    line(() => 'Day’s end. Name one thing you would do again, exactly the same.'),
    line(() => 'You gave today what you had. Close the page gently.')
  ],
  streak: [
    line((w) => `${w.N} done. Notice how that feels before you reach for the next.`),
    line((w) => `${w.N} finished in a row. You are allowed to be pleased.`),
    line((w) => `That is ${w.n} crossed off. Momentum is a guest. Do not chase it; just keep the door open.`),
    line((w) => `${w.N} things done. Which of them mattered? Do more like that one.`),
    line((w) => `${w.N} in a row. A good time for the one you have been avoiding.`),
    line(() => 'Done, done, done. Rest a minute. Finishing is also work.'),
    line((w) => `${w.N} tasks closed. The list is shorter, and so is the worry.`),
    line((w) => `Steady hands today. ${w.N} done, and none of them in a hurry.`)
  ]
}

const PT: Record<HermanNudgeKind, Line[]> = {
  overdue: [
    line((w) => `${w.N} ${s(w, 'coisa espera', 'coisas esperam')} ${w.since}. ${s(w, 'Ela é mesmo sua?', 'Qual delas é mesmo sua?')}`),
    line((w) => `${w.N} ${s(w, 'atrasada', 'atrasadas')}. Carregar não deixa ${s(w, 'ela', 'nenhuma')} mais leve. ${s(w, 'Faça, ou solte.', 'Escolha uma, ou solte uma.')}`),
    titled((w) => `“${w.title}” espera ${w.since}. Faça, ou decida não fazer. As duas coisas valem.`),
    line((w) => `Tem algo esperando ${w.since}. Qual é o menor passo honesto?`),
    line((w) => `${w.N} ${s(w, 'tarefa atrasada', 'tarefas atrasadas')}. Atraso é só informação. O que ele está dizendo?`),
    titled((w) => `Você passa por “${w.title}” sem olhar. O que não quer encontrar ali?`),
    line((w) => `${w.N} ${s(w, 'pendência vencida', 'pendências vencidas')}. ${s(w, 'Ela ainda merece você?', 'Nem todas merecem você. Qual merece?')}`),
    line((w) => `A coisa mais antiga da lista está lá ${w.since}. Ainda é verdade?`),
    line((w) => `${w.N} esperando ${w.since}. Dez minutos quietos ${s(w, 'nela', 'em uma delas')} mudam o dia.`),
    line(() => 'Tarefa velha pesa mais na cabeça do que na página. Abra a lista e olhe para elas com calma.')
  ],
  today: [
    line((w) => `${w.N} ${s(w, 'coisa', 'coisas')} para hoje. ${s(w, 'Quando você vai dar a ela a sua hora?', 'Qual delas, feita, deixa o resto mais fácil?')}`),
    line((w) => `${w.N} na lista de hoje. ${s(w, 'Comece antes de decidir o que acha dela.', 'Comece pela que você menos quer.')}`),
    line((w) => `Hoje pede ${w.n} ${s(w, 'coisa', 'coisas')} de você. É um número que cabe numa pessoa.`),
    titled((w) => `“${w.title}” é para hoje. Agora é má hora, ou só uma hora incômoda?`),
    line((w) => `${w.N} ${s(w, 'tarefa', 'tarefas')} hoje. ${s(w, 'Termine inteira, e pare.', 'Termine uma inteira antes de tocar na próxima.')}`),
    line(() => 'A lista de hoje dá para terminar. Isso é mais raro do que parece.'),
    line((w) => `${w.N} para hoje. Você não precisa de um plano melhor. Precisa dos primeiros dez minutos.`),
    line(() => 'Antes que chegue a próxima coisa: o que você prometeu a si para hoje?')
  ],
  'event-soon': [
    titled((w) => `“${w.title}” em ${w.minutes} minutos. Feche este pensamento antes, para ele não entrar junto.`),
    titled((w) => `${w.Minutes} minutos até “${w.title}”. O que você quer ter dito quando acabar?`),
    titled((w) => `“${w.title}” começa em ${w.minutes} minutos. Água, um respiro, e vá.`),
    titled((w) => `Quase hora de “${w.title}”. Uma linha agora sobre o que você precisa de lá poupa dez depois.`),
    line((w) => `${w.Minutes} minutos até a próxima coisa. Dá para anotar onde você parou.`),
    titled((w) => `“${w.title}” está perto. Chegue um minuto antes e passe esse minuto em silêncio.`),
    titled((w) => `Você tem ${w.minutes} minutos antes de “${w.title}”. Não comece nada que não possa largar.`),
    titled((w) => `Daqui a pouco: “${w.title}”. Abro uma página para as notas?`)
  ],
  'free-block': [
    line((w) => `Nada na agenda ${w.until}. O que merece esse silêncio?`),
    line((w) => `Você tem ${w.span} sem ninguém pedindo nada. Dê esse tempo ao trabalho que precisa da cabeça inteira.`),
    line((w) => `Um trecho livre ${w.until}. Escolha uma coisa para ele antes que ele escolha por você.`),
    line((w) => `Sem reuniões ${w.until}. Era para isso que serviam os dias cheios.`),
    line((w) => `${w.Span} sem interrupção é coisa rara. Feche o que não precisa.`),
    line((w) => `A agenda está quieta ${w.until}. A qual página você anda querendo voltar?`),
    line(() => 'Tempo vazio se enche sozinho, se você deixar. O que você quer que caiba neste trecho?'),
    line((w) => `Nada marcado ${w.until}. Agora o trabalho lento é permitido.`)
  ],
  'long-session': [
    line((w) => `${w.Minutes} minutos. A página espera. Levante-se.`),
    line((w) => `${w.Minutes} minutos nesta página. Olhe para algo distante por um instante.`),
    line((w) => `Você está aqui há ${w.minutes} minutos. O trabalho ainda anda, ou só você?`),
    line((w) => `${w.Minutes} minutos sem pausa. A próxima frase boa deve estar perto da janela.`),
    line(() => 'Uma sentada longa. Beba água, depois leia o último parágrafo como alguém de fora leria.'),
    line((w) => `${w.Minutes} minutos. O que esta página quer virar? Diga numa linha, e descanse.`),
    line(() => 'Olho cansado revisa mal. Cinco minutos longe não custam nada.'),
    line((w) => `Ainda aqui depois de ${w.minutes} minutos. É dedicação ou fuga. Uma caminhada curta responde.`),
    line((w) => `${w.Minutes} minutos. Marque o lugar com uma frase sobre o que vem depois, e respire.`)
  ],
  reopened: [
    line((w) => `Você não mexe nesta página há ${w.ago}. Ela ainda diz o que você pensa?`),
    line((w) => `${w.Ago} desde a última vez aqui. Leia como se outra pessoa tivesse escrito.`),
    line(() => 'Uma página antiga. Antes de mudar qualquer coisa: o que trouxe você de volta?'),
    line((w) => `Esta aqui descansou por ${w.ago}. Algumas coisas melhoram assim. Esta melhorou?`),
    line((w) => `Você deixou isto há ${w.ago}. O que diria a quem escreveu?`),
    line((w) => `De volta depois de ${w.ago}. Guardar, terminar ou soltar. As três são honestas.`),
    line((w) => `Nota antiga é carta de você para você. Esta esperou ${w.ago} pela resposta.`),
    line((w) => `${w.Ago} de poeira nesta página. O que ainda está vivo nela?`)
  ],
  morning: [
    line(() => 'Bom dia. Antes que o dia escolha por você: qual é a coisa de hoje?'),
    line(() => 'Um dia novo. Não precisa carregar o de ontem para dentro dele.'),
    line(() => 'Bom dia. Olhe o dia uma vez, devagar, antes de entrar nele.'),
    line(() => 'Aqui de novo. O que faria a noite de hoje parecer suficiente?'),
    line(() => 'Bom dia. A lista vai dizer muita coisa. Escute a que importa.'),
    line(() => 'Antes que alguém peça alguma coisa: o que você quer de hoje?'),
    line(() => 'Mais uma manhã, simples como a anterior. Comece pequeno.'),
    line(() => 'Bom dia. Comece pelo que está na sua frente. O resto é tempo lá fora.')
  ],
  evening: [
    line(() => 'Chega por hoje. O que vale lembrar deste dia?'),
    line(() => 'O dia está fechando. Escreva uma linha sobre onde parou, e pare.'),
    line(() => 'Fim de tarde. O que não terminou continua sem terminar amanhã. Deixe esperar lá.'),
    line(() => 'Um bom lugar para encerrar. O que saiu melhor do que você esperava?'),
    line(() => 'Já é tarde o bastante. Deixe um bilhete para amanhã, e vá.'),
    line(() => 'O trabalho não precisa do seu cansaço. Qual é a última coisa pequena?'),
    line(() => 'Fim do dia. Diga uma coisa que você faria de novo, igualzinho.'),
    line(() => 'Você deu a hoje o que tinha. Feche a página com cuidado.')
  ],
  streak: [
    line((w) => `${w.N} feitas. Repare em como é, antes de pegar a próxima.`),
    line((w) => `${w.N} terminadas em sequência. Pode ficar contente.`),
    line((w) => `Já são ${w.n} riscadas. Embalo é visita. Não corra atrás; só deixe a porta aberta.`),
    line((w) => `${w.N} coisas feitas. Qual delas importava? Faça mais como aquela.`),
    line((w) => `${w.N} em sequência. Boa hora para aquela que você vem evitando.`),
    line(() => 'Feita, feita, feita. Descanse um minuto. Terminar também é trabalho.'),
    line((w) => `${w.N} tarefas fechadas. A lista ficou menor, e a preocupação também.`),
    line((w) => `Mão firme hoje. ${w.N} feitas, e nenhuma com pressa.`)
  ]
}

export const LINES: Record<HermanLocale, Record<HermanNudgeKind, Line[]>> = { en: EN, 'pt-BR': PT }

/** The words around his lines: what the buttons say, and what he says of himself. */
export const PHRASES: Record<
  HermanLocale,
  {
    openToday: string
    openTask: string
    takeNotes: string
    ask: string
    notNow: string
    fewer: string
    /** His introduction, said once. Two sentences: who he is, and how to quiet him or send him away. */
    greeting: string
    /** Said when he is asked to talk while AI is turned off. */
    aiOff: string
    /** Questions he writes into the conversation for the user to send or change. */
    askFirst: string
    askPage: string
    askDay: string
  }
> = {
  en: {
    openToday: 'Open Today',
    openTask: 'Open it',
    takeNotes: 'Take notes',
    ask: 'Ask Herman',
    notNow: 'Not now',
    fewer: 'Fewer like this',
    greeting: 'I am Herman: I keep this corner, answer when you ask, and now and then say what I notice. If I talk too much, Settings → Herman will quiet me or send me away.',
    aiOff: 'AI is turned off in Settings, so I can only tell you what I notice myself.',
    askFirst: 'What should I do first today?',
    askPage: 'What is this page really about?',
    askDay: 'What is worth carrying over to tomorrow?'
  },
  'pt-BR': {
    openToday: 'Abrir Hoje',
    openTask: 'Abrir',
    takeNotes: 'Fazer anotações',
    ask: 'Perguntar ao Herman',
    notNow: 'Agora não',
    fewer: 'Menos como esta',
    greeting: 'Eu sou o Herman: fico neste canto, respondo quando você pergunta e, de vez em quando, digo o que reparo. Se eu falar demais, em Settings → Herman você me cala ou me manda embora.',
    aiOff: 'A IA está desligada em Settings, então só posso dizer o que eu mesmo reparo.',
    askFirst: 'O que devo fazer primeiro hoje?',
    askPage: 'Sobre o que é esta página, de verdade?',
    askDay: 'O que vale levar para amanhã?'
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
