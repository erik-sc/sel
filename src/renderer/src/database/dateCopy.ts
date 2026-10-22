// The words of the date and repeat pickers, in English and in Brazilian Portuguese, in the
// language of the home (the language set for AI answers when it is one of the two, else the
// system's). Pure: no React, no DOM.
import type { RepeatPreset } from '@shared/tasks/repeat'
import type { ReminderShortcut } from '@shared/tasks/remind'
import type { QuickDate } from '@shared/tasks/dates'
import { MONTH_NAMES, ordinalEn, weekdayName, type RuleLocale } from '@shared/rrule'
import type { RecurrenceRule } from '@shared/rrule'

export type DateLocale = RuleLocale

export interface DateCopy {
  fieldPlaceholder: string
  fieldLabel: string
  notUnderstood: string
  quick: Record<QuickDate | 'none', string>
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  endToggle: string
  timeToggle: string
  clear: string
  today: string
  previousMonth: string
  nextMonth: string
  /** The time field's own hint: what can be typed. */
  timeHint: string
  reminders: string
  reminder: Record<ReminderShortcut, string>
  reminderNeedsDue: string
  reminderNeedsTime: string

  repeat: string
  noRepeat: string
  preset: (preset: RepeatPreset, anchor: { weekday: number; date: number; month: number }) => string
  custom: string
  every: string
  unit: (freq: RecurrenceRule['freq'], count: number) => string
  onDays: string
  onDay: string
  lastDay: string
  ends: string
  never: string
  until: string
  after: string
  times: (count: number) => string
  fromLabel: string
  fromDue: string
  fromCompletion: string
  repeatPlaceholder: string
  repeatLabel: string
  repeatNotUnderstood: string
  /** "Repeats" in a cell: the rule in words, and how it counts. */
  fromCompletionNote: string
  done: string
}

export const DATE_COPY: Record<DateLocale, DateCopy> = {
  en: {
    fieldPlaceholder: 'fri 3pm, in 3 days, the 5th…',
    fieldLabel: 'Type a date',
    notUnderstood: 'Not a date I know',
    quick: { today: 'Today', tomorrow: 'Tomorrow', weekend: 'Weekend', nextWeek: 'Next week', none: 'No date' },
    startDate: 'Start date',
    endDate: 'End date',
    startTime: 'Start time',
    endTime: 'End time',
    endToggle: 'End date',
    timeToggle: 'Time',
    clear: 'Clear',
    today: 'Today',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    timeHint: '9:30, 2pm; ↑↓ in 15 minutes',
    reminders: 'Remind',
    reminder: { atTime: 'At the time', minutes15: '15 min before', hour1: '1 hour before', dayBefore: '1 day before at 9:00' },
    reminderNeedsDue: 'Give the task a due date to remind relative to it.',
    reminderNeedsTime: 'Minutes before need a due time.',

    repeat: 'Repeat',
    noRepeat: 'Does not repeat',
    preset: (preset, { weekday, date, month }) =>
      ({
        daily: 'Every day',
        weekdays: 'Every weekday',
        weekly: `Every week on ${weekdayName(weekday, 'en')}`,
        monthly: `Every month on the ${ordinalEn(date)}`,
        yearly: `Every year on ${MONTH_NAMES.en[month - 1]} ${date}`
      })[preset],
    custom: 'Custom',
    every: 'Every',
    unit: (freq, count) => {
      const [one, many] = { DAILY: ['day', 'days'], WEEKLY: ['week', 'weeks'], MONTHLY: ['month', 'months'], YEARLY: ['year', 'years'] }[
        freq
      ]
      return count === 1 ? one : many
    },
    onDays: 'On',
    onDay: 'On day',
    lastDay: 'Last day',
    ends: 'Ends',
    never: 'Never',
    until: 'On',
    after: 'After',
    times: (count) => (count === 1 ? 'time' : 'times'),
    fromLabel: 'Repeat from the',
    fromDue: 'due date',
    fromCompletion: 'completion',
    repeatPlaceholder: 'every mon and wed, biweekly…',
    repeatLabel: 'Type a repeat',
    repeatNotUnderstood: 'Not a repeat I know',
    fromCompletionNote: 'from completion',
    done: 'Done'
  },
  'pt-BR': {
    fieldPlaceholder: 'sex 15h, daqui 3 dias, dia 5…',
    fieldLabel: 'Digite uma data',
    notUnderstood: 'Não entendi essa data',
    quick: { today: 'Hoje', tomorrow: 'Amanhã', weekend: 'Fim de semana', nextWeek: 'Próxima semana', none: 'Sem data' },
    startDate: 'Data inicial',
    endDate: 'Data final',
    startTime: 'Hora inicial',
    endTime: 'Hora final',
    endToggle: 'Data final',
    timeToggle: 'Hora',
    clear: 'Limpar',
    today: 'Hoje',
    previousMonth: 'Mês anterior',
    nextMonth: 'Próximo mês',
    timeHint: '9:30, 14h; ↑↓ de 15 em 15 min',
    reminders: 'Lembrar',
    reminder: { atTime: 'Na hora', minutes15: '15 min antes', hour1: '1 h antes', dayBefore: '1 dia antes às 9h' },
    reminderNeedsDue: 'Dê um prazo à tarefa para lembrar em relação a ele.',
    reminderNeedsTime: 'Minutos antes precisam de um horário no prazo.',

    repeat: 'Repetir',
    noRepeat: 'Não repete',
    preset: (preset, { weekday, date, month }) =>
      ({
        daily: 'Todo dia',
        weekdays: 'Dias úteis',
        weekly: `Toda semana ${weekday >= 1 && weekday <= 5 ? 'na' : 'no'} ${weekdayName(weekday, 'pt-BR')}`,
        monthly: `Todo mês no dia ${date}`,
        yearly: `Todo ano em ${date} de ${MONTH_NAMES['pt-BR'][month - 1]}`
      })[preset],
    custom: 'Personalizado',
    every: 'A cada',
    unit: (freq, count) => {
      const [one, many] = { DAILY: ['dia', 'dias'], WEEKLY: ['semana', 'semanas'], MONTHLY: ['mês', 'meses'], YEARLY: ['ano', 'anos'] }[
        freq
      ]
      return count === 1 ? one : many
    },
    onDays: 'Em',
    onDay: 'No dia',
    lastDay: 'Último dia',
    ends: 'Termina',
    never: 'Nunca',
    until: 'Em',
    after: 'Depois de',
    times: (count) => (count === 1 ? 'vez' : 'vezes'),
    fromLabel: 'Repetir a partir da',
    fromDue: 'data',
    fromCompletion: 'conclusão',
    repeatPlaceholder: 'toda segunda e quarta, quinzenal…',
    repeatLabel: 'Digite uma repetição',
    repeatNotUnderstood: 'Não entendi essa repetição',
    fromCompletionNote: 'a partir da conclusão',
    done: 'Pronto'
  }
}
