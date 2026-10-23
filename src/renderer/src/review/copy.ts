// The words of the weekly review (0.8.0 E1), in English and in Brazilian Portuguese, in the
// language of the home (home/copy.ts). Calm and plain: no praise, no score, no streak.
import type { WeekSpan } from '@shared/tasks/week'
import type { HomeLocale } from '../home/copy'
import type { ReviewStep } from './steps'

export interface ReviewCopy {
  title: string
  /** The week as a heading: "Oct 19 – 25". */
  range: (week: WeekSpan) => string
  steps: Record<ReviewStep, string>
  /** The heading of each step. */
  heads: Record<ReviewStep, string>
  stepOf: (at: number, of: number) => string
  goTo: (name: string) => string
  back: string
  next: string
  loading: string

  doneHelp: string
  doneEmpty: string
  noProject: string
  edited: (count: number) => string
  editedNone: string
  editedMore: (count: number) => string
  activity: (days: number, focus: number) => string
  flows: string

  leftHelp: string
  leftEmpty: string
  leftHandled: string
  due: (label: string) => string
  nextWeek: string
  pickDate: string
  dropDate: string
  remove: string
  taskActions: (title: string) => string

  inboxHelp: string
  inboxCount: (count: number) => string
  inboxEmpty: string
  inboxStart: string

  projectsHelp: string
  projectsEmpty: string
  nextAction: string
  chooseNext: string
  noOpenTasks: string
  openProject: string
  late: string
  milestoneDate: (title: string) => string
  milestoneDone: string

  nextHelp: (range: string) => string
  find: string
  chosen: (count: number, max: number) => string
  full: string
  noCandidates: string
  note: string
  notePlaceholder: string

  closeHelp: string
  doneCount: (count: number) => string
  editedCount: (count: number) => string
  leftCount: (count: number) => string
  inboxLeft: (count: number) => string
  inboxZero: string
  withoutNext: (count: number) => string
  focusFor: (range: string) => string
  noFocus: string
  summarize: string
  finish: string
  closed: string
  closedHelp: string
  openToday: string
  saveFailed: string

  /** Today's quiet line, Friday to Sunday. */
  todayLine: string
  todayLink: string
  /** Today's line while a week has a focus. */
  todayFocus: string
}

function range(week: WeekSpan, locale: string): string {
  const day = (text: string): Date => {
    const [y, m, d] = text.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const from = day(week.start)
  const to = day(week.end)
  const month = new Intl.DateTimeFormat(locale, { month: 'short' })
  const sameMonth = from.getMonth() === to.getMonth()
  const start =
    locale === 'pt-BR' ? `${from.getDate()}${sameMonth ? '' : ` de ${month.format(from)}`}` : `${month.format(from)} ${from.getDate()}`
  const end =
    locale === 'pt-BR' ? `${to.getDate()} de ${month.format(to)}` : sameMonth ? `${to.getDate()}` : `${month.format(to)} ${to.getDate()}`
  return `${start} – ${end}`
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

export const REVIEW_COPY: Record<HomeLocale, ReviewCopy> = {
  en: {
    title: 'Weekly review',
    range: (week) => range(week, 'en'),
    steps: { done: 'Done', left: 'Slid', inbox: 'Inbox', projects: 'Projects', next: 'Next week', close: 'Close' },
    heads: {
      done: 'What got done',
      left: 'What slid',
      inbox: 'The Inbox',
      projects: 'Projects',
      next: 'The week to come',
      close: 'The week, closed'
    },
    stepOf: (at, of) => `Step ${at} of ${of}`,
    goTo: (name) => `Go to ${name}`,
    back: '← Back',
    next: 'Next →',
    loading: 'Reading the week…',

    doneHelp: 'Tasks completed this week, by project, and the pages you worked on.',
    doneEmpty: 'No task was marked done this week.',
    noProject: 'No project',
    edited: (count) => `Pages edited (${count})`,
    editedNone: 'No page was edited this week.',
    editedMore: (count) => `and ${count} more`,
    activity: (days, focus) =>
      [`Something happened on ${plural(days, 'day', 'days')}`, focus ? plural(focus, 'focus session', 'focus sessions') : '']
        .filter(Boolean)
        .join(' · '),
    flows: 'See the flows',

    leftHelp: 'Due this week and still open. For each one, decide where it goes, or leave it as it is.',
    leftEmpty: 'Nothing slid this week.',
    leftHandled: 'Taken care of',
    due: (label) => `Due ${label}`,
    nextWeek: 'Move to next week',
    pickDate: 'Pick a date',
    dropDate: 'No date',
    remove: 'Delete',
    taskActions: (title) => `What to do with “${title}”`,

    inboxHelp: 'Give what is in the Inbox a date, a priority and a project. Skip what can wait.',
    inboxCount: (count) => `${plural(count, 'task', 'tasks')} in the Inbox to refine.`,
    inboxEmpty: 'The Inbox is up to date.',
    inboxStart: 'Refine them',

    projectsHelp: 'Projects without a next action, and milestones whose date has passed.',
    projectsEmpty: 'Every project has a next action, and no milestone is late.',
    nextAction: 'Next action',
    chooseNext: 'Choose a task…',
    noOpenTasks: 'No open tasks in this project.',
    openProject: 'Open in Tasks',
    late: 'Late milestones',
    milestoneDate: (title) => `New date for ${title}`,
    milestoneDone: 'Mark done',

    nextHelp: (range) =>
      `Choose up to three things for ${range}. They show on Today during that week; their dates and priorities stay as they are.`,
    find: 'Find a task',
    chosen: (count, max) => `${count} of ${max} chosen`,
    full: 'Three at most: take one out to choose another.',
    noCandidates: 'No open task to choose.',
    note: 'A note for the week',
    notePlaceholder: 'Optional: what matters, what to leave alone…',

    closeHelp: 'That is the week. Nothing else to do here.',
    doneCount: (count) => `${plural(count, 'task', 'tasks')} done`,
    editedCount: (count) => `${plural(count, 'page', 'pages')} edited`,
    leftCount: (count) => `${count} still slid`,
    inboxLeft: (count) => `${count} in the Inbox still to refine`,
    inboxZero: 'Inbox up to date',
    withoutNext: (count) => `${plural(count, 'project', 'projects')} without a next action`,
    focusFor: (range) => `For ${range}`,
    noFocus: 'No focus chosen for the week to come.',
    summarize: 'Summarise with the persona',
    finish: 'Finish the review',
    closed: 'Until next week.',
    closedHelp: 'The review is done. Its choices are on Today when the week begins.',
    openToday: 'Open Today',
    saveFailed: 'That could not be saved.',

    todayLine: 'The week is ending.',
    todayLink: 'Weekly review',
    todayFocus: 'This week'
  },
  'pt-BR': {
    title: 'Revisão da semana',
    range: (week) => range(week, 'pt-BR'),
    steps: { done: 'Concluído', left: 'Ficou', inbox: 'Inbox', projects: 'Projetos', next: 'A semana que vem', close: 'Fecho' },
    heads: {
      done: 'O que foi feito',
      left: 'O que ficou',
      inbox: 'A Inbox',
      projects: 'Projetos',
      next: 'A semana que vem',
      close: 'A semana, fechada'
    },
    stepOf: (at, of) => `Passo ${at} de ${of}`,
    goTo: (name) => `Ir para ${name}`,
    back: '← Voltar',
    next: 'Seguir →',
    loading: 'Lendo a semana…',

    doneHelp: 'As tarefas concluídas nesta semana, por projeto, e as páginas em que você mexeu.',
    doneEmpty: 'Nenhuma tarefa foi concluída nesta semana.',
    noProject: 'Sem projeto',
    edited: (count) => `Páginas editadas (${count})`,
    editedNone: 'Nenhuma página foi editada nesta semana.',
    editedMore: (count) => `e mais ${count}`,
    activity: (days, focus) =>
      [`Algo aconteceu em ${plural(days, 'dia', 'dias')}`, focus ? plural(focus, 'sessão de foco', 'sessões de foco') : '']
        .filter(Boolean)
        .join(' · '),
    flows: 'Ver os fluxos',

    leftHelp: 'Venciam nesta semana e seguem abertas. Para cada uma, decida para onde vai, ou deixe como está.',
    leftEmpty: 'Nada ficou para trás nesta semana.',
    leftHandled: 'Resolvida',
    due: (label) => `Vencia ${label}`,
    nextWeek: 'Passar para a semana que vem',
    pickDate: 'Escolher data',
    dropDate: 'Sem data',
    remove: 'Apagar',
    taskActions: (title) => `O que fazer com “${title}”`,

    inboxHelp: 'Dê ao que está na Inbox uma data, uma prioridade e um projeto. Pule o que pode esperar.',
    inboxCount: (count) => `${plural(count, 'tarefa', 'tarefas')} na Inbox a refinar.`,
    inboxEmpty: 'A Inbox está em dia.',
    inboxStart: 'Refinar',

    projectsHelp: 'Projetos sem próxima ação, e marcos cuja data já passou.',
    projectsEmpty: 'Todo projeto tem uma próxima ação, e nenhum marco está atrasado.',
    nextAction: 'Próxima ação',
    chooseNext: 'Escolher uma tarefa…',
    noOpenTasks: 'Nenhuma tarefa aberta neste projeto.',
    openProject: 'Abrir em Tarefas',
    late: 'Marcos atrasados',
    milestoneDate: (title) => `Nova data para ${title}`,
    milestoneDone: 'Marcar como feito',

    nextHelp: (range) =>
      `Escolha até três coisas para ${range}. Elas aparecem em Hoje durante essa semana; datas e prioridades ficam como estão.`,
    find: 'Buscar uma tarefa',
    chosen: (count, max) => `${count} de ${max} escolhidas`,
    full: 'No máximo três: tire uma para escolher outra.',
    noCandidates: 'Nenhuma tarefa aberta para escolher.',
    note: 'Uma nota para a semana',
    notePlaceholder: 'Opcional: o que importa, o que deixar de lado…',

    closeHelp: 'Essa foi a semana. Nada mais a fazer aqui.',
    doneCount: (count) => `${plural(count, 'tarefa concluída', 'tarefas concluídas')}`,
    editedCount: (count) => `${plural(count, 'página editada', 'páginas editadas')}`,
    leftCount: (count) => `${count} ainda para trás`,
    inboxLeft: (count) => `${count} na Inbox ainda a refinar`,
    inboxZero: 'Inbox em dia',
    withoutNext: (count) => `${plural(count, 'projeto', 'projetos')} sem próxima ação`,
    focusFor: (range) => `Para ${range}`,
    noFocus: 'Nada escolhido para a semana que vem.',
    summarize: 'Resumir com a persona',
    finish: 'Encerrar a revisão',
    closed: 'Até a semana que vem.',
    closedHelp: 'A revisão terminou. As escolhas aparecem em Hoje quando a semana começar.',
    openToday: 'Abrir Hoje',
    saveFailed: 'Não deu para salvar.',

    todayLine: 'A semana está acabando.',
    todayLink: 'Revisão da semana',
    todayFocus: 'Nesta semana'
  }
}
