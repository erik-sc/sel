// The words of the notifications, in English and in Brazilian Portuguese: the two languages
// Herman's own lines are written in, chosen the same way, by the main process (an announcement
// carries its locale; Settings asks Herman's state). Pure: no React, no DOM.
import type { AskRecord, EventLead } from '@shared/alarms'

export type AlarmsLocale = 'en' | 'pt-BR'

export interface AlarmsCopy {
  // The buttons of an announcement.
  openToday: string
  openTask: string
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
    snooze: 'Snooze 10 min',
    record: 'Record',
    justNotes: 'Just notes',
    notNow: 'Not now',
    snoozedUntil: (time) => `Snoozed until ${time}.`,
    section: 'Notifications',
    tasksGroup: 'Tasks',
    reminders: 'Reminders of tasks',
    remindersHelp: 'A task with a reminder, or due at a time of day, is announced when it comes.',
    eventsGroup: 'Calendar',
    events: 'Events',
    eventsHelp: 'Events of your calendars with a time are announced before they start. All-day events, declined ones and those shown as free are not.',
    lead: 'How long before',
    leadHelp: 'The calendars are read again every 15 minutes while sel is open.',
    leadOption: (minutes) => (minutes === 0 ? 'At the start' : `${minutes} min`),
    askRecord: 'Ask whether to record',
    askRecordHelp: 'A meeting is an event with someone else invited or a link to a Meet, Teams or Zoom call. Record opens its page and starts recording; Just notes opens the page.',
    askRecordOption: { meetings: 'Meetings', all: 'Every event', never: 'Never' },
    soundGroup: 'Sound and background',
    sound: 'Chime',
    soundHelp: 'Before every notification and briefing. Nothing sounds while a meeting is being recorded.',
    tray: 'Keep running in the notification area',
    trayHelp: 'Closing the last window leaves sel running there, so notifications still come. Quit from its icon.',
    trayOff: 'With the window closed nothing rings: turn on “Keep running in the notification area”.',
    openAtLogin: 'Start with the computer',
    openAtLoginHelp: (tray) => `${tray ? 'sel starts in the notification area when you sign in.' : 'sel opens when you sign in.'} Only in the installed app.`,
    note: 'These settings stay on this device. The briefing times are under Herman.',
    on: 'On',
    off: 'Off',
    saveFailed: 'The setting could not be saved.'
  },
  'pt-BR': {
    openToday: 'Abrir Hoje',
    openTask: 'Abrir tarefa',
    snooze: 'Adiar 10 min',
    record: 'Gravar',
    justNotes: 'Só notas',
    notNow: 'Agora não',
    snoozedUntil: (time) => `Adiado até ${time}.`,
    section: 'Notificações',
    tasksGroup: 'Tarefas',
    reminders: 'Lembretes de tarefas',
    remindersHelp: 'Uma tarefa com lembrete, ou com prazo numa hora do dia, é avisada quando chega a hora.',
    eventsGroup: 'Calendário',
    events: 'Eventos',
    eventsHelp: 'Eventos com horário dos seus calendários são avisados antes de começar. Eventos de dia inteiro, recusados e marcados como livre, não.',
    lead: 'Com quanto tempo',
    leadHelp: 'Os calendários são lidos de novo a cada 15 minutos enquanto o sel está aberto.',
    leadOption: (minutes) => (minutes === 0 ? 'Na hora' : `${minutes} min`),
    askRecord: 'Perguntar se grava',
    askRecordHelp: 'Reunião é um evento com outra pessoa convidada ou com link de Meet, Teams ou Zoom. Gravar abre a página e começa a gravar; Só notas abre a página.',
    askRecordOption: { meetings: 'Reuniões', all: 'Todos os eventos', never: 'Nunca' },
    soundGroup: 'Som e segundo plano',
    sound: 'Som',
    soundHelp: 'Antes de cada notificação e do briefing. Nada toca enquanto uma reunião é gravada.',
    tray: 'Manter na bandeja',
    trayHelp: 'Fechar a última janela deixa o sel rodando na área de notificação, e os avisos continuam. Para sair, use o ícone.',
    trayOff: 'Com a janela fechada nada toca — ative “Manter na bandeja”.',
    openAtLogin: 'Iniciar com o computador',
    openAtLoginHelp: (tray) => `${tray ? 'O sel inicia na bandeja quando você entra.' : 'O sel abre quando você entra.'} Só no app instalado.`,
    note: 'Estas configurações ficam neste dispositivo. Os horários do briefing ficam no Herman.',
    on: 'Ligado',
    off: 'Desligado',
    saveFailed: 'Não foi possível salvar a configuração.'
  }
}

export function alarmsCopy(locale: string | null | undefined): AlarmsCopy {
  return locale === 'pt-BR' ? ALARMS_COPY['pt-BR'] : ALARMS_COPY.en
}
