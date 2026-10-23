// The words of the notifications, in English and in Brazilian Portuguese: the two languages
// Herman's own lines are written in, chosen the same way, by the main process (an announcement
// carries its locale; Settings asks Herman's state). Pure: no React, no DOM.
import type { AskRecord, EventLead } from '@shared/alarms'
import type { PersonaId } from '@shared/herman'
import { personifyCopy } from '@shared/persona'

export type AlarmsLocale = 'en' | 'pt-BR'

export interface AlarmsCopy {
  // The buttons of an announcement.
  openToday: string
  openTask: string
  /** The refine time's button: the refine mode. */
  refine: string
  snooze: string
  record: string
  justNotes: string
  notNow: string
  snoozedUntil: (time: string) => string
  // Settings → Notifications.
  section: string
  tasksGroup: string
  reminders: string
  remindersHelp: string
  /** Reminders to refine the tasks still without a date, a priority or a project. */
  refineGroup: string
  refineHelp: string
  refineBriefing: string
  refineBriefingHelp: string
  refineHerman: string
  refineHermanHelp: string
  refineTime: string
  refineTimeHelp: string
  refineMark: string
  refineMarkHelp: string
  time: string
  days: string
  /** Sunday first, as the stored days count. */
  dayLetters: readonly string[]
  dayNames: readonly string[]
  eventsGroup: string
  events: string
  eventsHelp: string
  lead: string
  leadHelp: string
  leadOption: (minutes: EventLead) => string
  askRecord: string
  askRecordHelp: string
  askRecordOption: Record<AskRecord, string>
  soundGroup: string
  sound: string
  soundHelp: string
  tray: string
  trayHelp: string
  trayOff: string
  openAtLogin: string
  openAtLoginHelp: (tray: boolean) => string
  note: string
  on: string
  off: string
  saveFailed: string
}

export const ALARMS_COPY: Record<AlarmsLocale, AlarmsCopy> = {
  en: {
    openToday: 'Open Today',
    openTask: 'Open task',
    refine: 'Refine',
    snooze: 'Snooze 10 min',
    record: 'Record',
    justNotes: 'Just notes',
    notNow: 'Not now',
    snoozedUntil: (time) => `Snoozed until ${time}.`,
    section: 'Notifications',
    tasksGroup: 'Tasks',
    reminders: 'Reminders of tasks',
    remindersHelp: 'A task with a reminder, or due at a time of day, is announced when it comes.',
    refineGroup: 'Refining',
    refineHelp: 'A task is refined once it has a date, a priority and a project. Those still missing one are kept in “To refine”.',
    refineBriefing: 'In the briefing',
    refineBriefingHelp: 'The briefing at its times says how many tasks are waiting to be refined, when there are any.',
    refineHerman: 'From Herman',
    refineHermanHelp: 'Once a day at most, when a task has sat in the Inbox for two days, Herman offers to refine it.',
    refineTime: 'Refine time',
    refineTimeHelp: 'A notification at this time opens the refine mode. It comes only when there is something to refine.',
    refineMark: 'Mark on Tasks',
    refineMarkHelp: 'A small dot beside Tasks in the sidebar while there is something to refine.',
    time: 'Time',
    days: 'Days',
    dayLetters: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    eventsGroup: 'Calendar',
    events: 'Events',
    eventsHelp:
      'Events of your calendars with a time are announced before they start. All-day events, declined ones and those shown as free are not.',
    lead: 'How long before',
    leadHelp: 'The calendars are read again every 15 minutes while sel is open.',
    leadOption: (minutes) => (minutes === 0 ? 'At the start' : `${minutes} min`),
    askRecord: 'Ask whether to record',
    askRecordHelp:
      'A meeting is an event with someone else invited or a link to a Meet, Teams or Zoom call. Record opens its page and starts recording; Just notes opens the page.',
    askRecordOption: { meetings: 'Meetings', all: 'Every event', never: 'Never' },
    soundGroup: 'Sound and background',
    sound: 'Chime',
    soundHelp: 'Before every notification and briefing. Nothing sounds while a meeting is being recorded.',
    tray: 'Keep running in the notification area',
    trayHelp: 'Closing the last window leaves sel running there, so notifications still come. Quit from its icon.',
    trayOff: 'With the window closed nothing rings: turn on “Keep running in the notification area”.',
    openAtLogin: 'Start with the computer',
    openAtLoginHelp: (tray) =>
      `${tray ? 'sel starts in the notification area when you sign in.' : 'sel opens when you sign in.'} Only in the installed app.`,
    note: 'These settings stay on this device. The briefing times are under Herman.',
    on: 'On',
    off: 'Off',
    saveFailed: 'The setting could not be saved.'
  },
  'pt-BR': {
    openToday: 'Abrir Hoje',
    openTask: 'Abrir tarefa',
    refine: 'Refinar',
    snooze: 'Adiar 10 min',
    record: 'Gravar',
    justNotes: 'Só notas',
    notNow: 'Agora não',
    snoozedUntil: (time) => `Adiado até ${time}.`,
    section: 'Notificações',
    tasksGroup: 'Tarefas',
    reminders: 'Lembretes de tarefas',
    remindersHelp: 'Uma tarefa com lembrete, ou com prazo numa hora do dia, é avisada quando chega a hora.',
    refineGroup: 'Refino',
    refineHelp: 'Uma tarefa está refinada quando tem data, prioridade e projeto. As que ainda não têm ficam em “A refinar”.',
    refineBriefing: 'No briefing',
    refineBriefingHelp: 'O briefing, nos horários dele, diz quantas tarefas esperam refino, quando houver.',
    refineHerman: 'Pelo Herman',
    refineHermanHelp: 'No máximo uma vez por dia, quando uma tarefa está no Inbox há dois dias, o Herman oferece refinar.',
    refineTime: 'Hora de refinar',
    refineTimeHelp: 'Uma notificação neste horário abre o modo Refinar. Só vem quando há o que refinar.',
    refineMark: 'Marca em Tarefas',
    refineMarkHelp: 'Um pontinho ao lado de Tarefas na barra lateral enquanto houver o que refinar.',
    time: 'Horário',
    days: 'Dias',
    dayLetters: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'],
    dayNames: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
    eventsGroup: 'Calendário',
    events: 'Eventos',
    eventsHelp:
      'Eventos com horário dos seus calendários são avisados antes de começar. Eventos de dia inteiro, recusados e marcados como livre, não.',
    lead: 'Com quanto tempo',
    leadHelp: 'Os calendários são lidos de novo a cada 15 minutos enquanto o sel está aberto.',
    leadOption: (minutes) => (minutes === 0 ? 'Na hora' : `${minutes} min`),
    askRecord: 'Perguntar se grava',
    askRecordHelp:
      'Reunião é um evento com outra pessoa convidada ou com link de Meet, Teams ou Zoom. Gravar abre a página e começa a gravar; Só notas abre a página.',
    askRecordOption: { meetings: 'Reuniões', all: 'Todos os eventos', never: 'Nunca' },
    soundGroup: 'Som e segundo plano',
    sound: 'Som',
    soundHelp: 'Antes de cada notificação e do briefing. Nada toca enquanto uma reunião é gravada.',
    tray: 'Manter na bandeja',
    trayHelp: 'Fechar a última janela deixa o sel rodando na área de notificação, e os avisos continuam. Para sair, use o ícone.',
    trayOff: 'Com a janela fechada nada toca — ative “Manter na bandeja”.',
    openAtLogin: 'Iniciar com o computador',
    openAtLoginHelp: (tray) =>
      `${tray ? 'O sel inicia na bandeja quando você entra.' : 'O sel abre quando você entra.'} Só no app instalado.`,
    note: 'Estas configurações ficam neste dispositivo. Os horários do briefing ficam no Herman.',
    on: 'Ligado',
    off: 'Desligado',
    saveFailed: 'Não foi possível salvar a configuração.'
  }
}

export function alarmsCopy(locale: string | null | undefined, persona: PersonaId = 'herman'): AlarmsCopy {
  const chosen: AlarmsLocale = locale === 'pt-BR' ? 'pt-BR' : 'en'
  return personifyCopy(ALARMS_COPY[chosen], persona, chosen)
}
