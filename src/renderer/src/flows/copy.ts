// The words of the Fluxos screen, in English and in Brazilian Portuguese (the language of the
// Home, see home/copy.ts). Pure: no React, no DOM. No word here keeps score: no streak, no
// record, no "best"; a count is said only where it helps to read a square.
import type { ActivityArea, ActivityKind } from '@shared/activity'
import type { HomeLocale } from '@/home/copy'

/** The kinds the screen filters by, each standing for one or more kinds of the log. */
export const FLOW_FILTERS = ['all', 'writing', 'done', 'focus', 'opened'] as const
export type FlowFilter = (typeof FLOW_FILTERS)[number]

export const FILTER_KINDS: Readonly<Record<FlowFilter, ActivityKind[] | undefined>> = {
  all: undefined,
  writing: ['edit'],
  done: ['task.completed'],
  focus: ['focus.start'],
  opened: ['open']
}

export interface FlowsCopy {
  title: string
  kicker: string
  lede: string
  filters: Record<FlowFilter, string>
  filterLabel: string
  project: string
  allProjects: string
  year: string
  yearLabel: (from: string, to: string) => string
  week: string
  weekLabel: string
  hour: string
  asTable: string
  month: string
  daysWith: string
  entries: string
  /** One square, for its tooltip. */
  cell: (when: string, count: number) => string
  less: string
  more: string
  where: string
  whereLede: string
  noMoves: string
  moves: (count: number) => string
  time: string
  timeLede: string
  weekOf: (monday: string) => string
  area: string
  noTime: string
  back: string
  backLede: string
  noBack: string
  days: (days: number) => string
  /** Every area of the activity log has a name (a missing one would show its raw id). */
  areas: Record<ActivityArea, string>
  untitled: string
  emptyTitle: string
  empty: string
  offTitle: string
  off: string
  openSettings: string
  loadFailed: string
  tryAgain: string
  weekdays: readonly string[]
  weekdaysShort: readonly string[]
  months: readonly string[]
}

export const FLOWS_COPY: Record<HomeLocale, FlowsCopy> = {
  en: {
    title: 'Flows',
    kicker: 'Rhythm',
    lede: 'From the activity history on this computer. Never synced, never sent to AI.',
    filters: { all: 'Everything', writing: 'Writing', done: 'Tasks done', focus: 'Focus', opened: 'Opened' },
    filterLabel: 'Show',
    project: 'Project',
    allProjects: 'All projects',
    year: 'The year',
    yearLabel: (from, to) => `Activity per day, from ${from} to ${to}`,
    week: 'The week, hour by hour',
    weekLabel: 'Activity per weekday and hour',
    hour: 'Hour',
    asTable: 'As a table',
    month: 'Month',
    daysWith: 'Days with something',
    entries: 'Entries',
    cell: (when, count) => (count ? `${when}: ${count} ${count === 1 ? 'entry' : 'entries'}` : `${when}: nothing`),
    less: 'less',
    more: 'more',
    where: 'Where you go',
    whereLede: 'The most common moves between screens and pages this week.',
    noMoves: 'No moves this week yet.',
    moves: (count) => `${count}×`,
    time: 'Time per area',
    timeLede: 'The last six weeks; a visit counts until the next one, and never past half an hour away.',
    weekOf: (monday) => `Week of ${monday}`,
    area: 'Area',
    noTime: 'Nothing yet.',
    back: 'What pulls you back',
    backLede: 'Pages you returned to on the most different days, lately.',
    noBack: 'No page has called you back yet.',
    days: (days) => `on ${days} ${days === 1 ? 'day' : 'days'}`,
    areas: {
      today: 'Today',
      calendar: 'Calendar',
      tasks: 'Tasks',
      meditations: 'Meditations',
      'close-day': 'Close the day',
      'week-review': 'Weekly review',
      sky: 'Sky',
      page: 'Pages'
    },
    untitled: 'Untitled',
    emptyTitle: 'Nothing here yet',
    empty: 'As you write, finish tasks and focus, the year fills in, square by square.',
    offTitle: 'The activity history is off',
    off: 'Turn it on in Settings → General → Data to see your rhythm here. It stays on this computer.',
    openSettings: 'Open settings',
    loadFailed: 'The flows could not be read.',
    tryAgain: 'Try again',
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  },
  'pt-BR': {
    title: 'Fluxos',
    kicker: 'Ritmo',
    lede: 'Do histórico de atividade deste computador. Nunca sincroniza, nunca vai para a AI.',
    filters: { all: 'Tudo', writing: 'Escrita', done: 'Tarefas concluídas', focus: 'Foco', opened: 'Aberturas' },
    filterLabel: 'Mostrar',
    project: 'Projeto',
    allProjects: 'Todos os projetos',
    year: 'O ano',
    yearLabel: (from, to) => `Atividade por dia, de ${from} a ${to}`,
    week: 'A semana, hora a hora',
    weekLabel: 'Atividade por dia da semana e hora',
    hour: 'Hora',
    asTable: 'Como tabela',
    month: 'Mês',
    daysWith: 'Dias com algo',
    entries: 'Registros',
    cell: (when, count) => (count ? `${when}: ${count} ${count === 1 ? 'registro' : 'registros'}` : `${when}: nada`),
    less: 'menos',
    more: 'mais',
    where: 'Para onde você vai',
    whereLede: 'As passagens mais comuns entre telas e páginas nesta semana.',
    noMoves: 'Nenhuma passagem nesta semana ainda.',
    moves: (count) => `${count}×`,
    time: 'Tempo por área',
    timeLede: 'As últimas seis semanas; uma visita conta até a próxima, e nunca mais de meia hora longe.',
    weekOf: (monday) => `Semana de ${monday}`,
    area: 'Área',
    noTime: 'Nada ainda.',
    back: 'O que puxa você de volta',
    backLede: 'Páginas a que você voltou no maior número de dias diferentes, ultimamente.',
    noBack: 'Nenhuma página chamou você de volta ainda.',
    days: (days) => `em ${days} ${days === 1 ? 'dia' : 'dias'}`,
    areas: {
      today: 'Hoje',
      calendar: 'Agenda',
      tasks: 'Tarefas',
      meditations: 'Meditações',
      'close-day': 'Fechar o dia',
      'week-review': 'Revisão da semana',
      sky: 'Céu',
      page: 'Páginas'
    },
    untitled: 'Sem título',
    emptyTitle: 'Nada aqui ainda',
    empty: 'Conforme você escreve, conclui tarefas e faz foco, o ano vai se preenchendo, quadradinho a quadradinho.',
    offTitle: 'O histórico de atividade está desligado',
    off: 'Ligue em Configurações → Geral → Dados para ver o seu ritmo aqui. Ele fica neste computador.',
    openSettings: 'Abrir configurações',
    loadFailed: 'Não deu para ler os fluxos.',
    tryAgain: 'Tentar de novo',
    weekdays: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
    weekdaysShort: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
    months: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  }
}

/** A day as a tooltip names it: "Tue 3 Mar 2026" / "ter 3 mar 2026". */
export function dayName(day: string, copy: FlowsCopy): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return day
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return `${copy.weekdaysShort[date.getDay()]} ${date.getDate()} ${copy.months[date.getMonth()]} ${date.getFullYear()}`
}
