import type { BriefingEvent, BriefingTask } from '../../shared/briefing'
import type { Reminder } from './reminders'

/**
 * What Herman says at a briefing time and at a reminder, in his own few words, written here in
 * advance in English and Portuguese and filled in from what the app already knows. No model is
 * asked for these (the AI briefing, when it is on, is written elsewhere and falls back to this).
 *
 * Pure: the clock and the locale come in as arguments.
 */

export type AlarmLocale = 'en' | 'pt-BR'

export interface BriefingFacts {
  now: number
  locale: AlarmLocale
  /** The name the user gave in the Today settings, or empty. */
  name: string
  events: readonly BriefingEvent[]
  tasks: { overdue: readonly BriefingTask[]; today: readonly BriefingTask[] }
}

export interface Spoken {
  text: string
  speech: string
}

function clock(ms: number, locale: AlarmLocale): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
}

/** `HH:mm` of a stored date string that has a time. */
function storedTime(value: string | null, locale: AlarmLocale): string | null {
  const m = value ? /T(\d{2}):(\d{2})$/.exec(value) : null
  return m ? clock(new Date(2000, 0, 1, Number(m[1]), Number(m[2])).getTime(), locale) : null
}

function tidy(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean
}

const WORDS = {
  en: {
    hello: (hour: number, name: string) => `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}.`,
    noEvents: 'Nothing on the calendar today.',
    oneEvent: (title: string, time: string) => `One thing on the calendar: ${title}, at ${time}.`,
    events: (count: number, title: string, time: string) => `${count} things on the calendar; the next is ${title}, at ${time}.`,
    eventsDone: (count: number) => `${count} things were on the calendar today; they are behind you.`,
    allDay: (count: number) => (count === 1 ? 'One all-day event.' : `${count} all-day events.`),
    noTasks: 'No tasks for today.',
    tasks: (today: number, overdue: number) => {
      const due = today === 1 ? 'one task for today' : `${today} tasks for today`
      const late = overdue === 0 ? '' : overdue === 1 ? ' and one overdue' : ` and ${overdue} overdue`
      return today === 0 ? `${overdue === 1 ? 'One task' : `${overdue} tasks`} overdue.` : `${due[0].toUpperCase()}${due.slice(1)}${late}.`
    },
    start: (title: string) => `I would begin with ${title}.`,
    end: 'That is all.',
    reminder: (title: string) => `Reminder: ${title}.`,
    reminderNow: (title: string, time: string) => `${title}: it is ${time}, the time you gave it.`,
    reminderDue: (title: string, time: string) => `Reminder: ${title}, due at ${time}.`
  },
  'pt-BR': {
    hello: (hour: number, name: string) => `${hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'}${name ? `, ${name}` : ''}.`,
    noEvents: 'Nada na agenda hoje.',
    oneEvent: (title: string, time: string) => `Um compromisso na agenda: ${title}, às ${time}.`,
    events: (count: number, title: string, time: string) => `${count} compromissos na agenda; o próximo é ${title}, às ${time}.`,
    eventsDone: (count: number) => `${count} compromissos estavam na agenda hoje; já passaram.`,
    allDay: (count: number) => (count === 1 ? 'Um evento de dia inteiro.' : `${count} eventos de dia inteiro.`),
    noTasks: 'Nenhuma tarefa para hoje.',
    tasks: (today: number, overdue: number) => {
      const due = today === 1 ? 'uma tarefa para hoje' : `${today} tarefas para hoje`
      const late = overdue === 0 ? '' : overdue === 1 ? ' e uma atrasada' : ` e ${overdue} atrasadas`
      return today === 0 ? `${overdue === 1 ? 'Uma tarefa atrasada' : `${overdue} tarefas atrasadas`}.` : `${due[0].toUpperCase()}${due.slice(1)}${late}.`
    },
    start: (title: string) => `Eu começaria por ${title}.`,
    end: 'É isso.',
    reminder: (title: string) => `Lembrete: ${title}.`,
    reminderNow: (title: string, time: string) => `${title}: são ${time}, a hora que você marcou.`,
    reminderDue: (title: string, time: string) => `Lembrete: ${title}, para as ${time}.`
  }
} as const

/** The briefing at one of its times. */
export function composeBriefing(facts: BriefingFacts): Spoken {
  const w = WORDS[facts.locale]
  const lines: string[] = [w.hello(new Date(facts.now).getHours(), facts.name.trim())]

  const timed = facts.events.filter((event) => !event.allDay).sort((a, b) => a.start - b.start)
  const allDay = facts.events.filter((event) => event.allDay)
  const next = timed.find((event) => event.start >= facts.now) ?? timed.find((event) => event.end > facts.now)
  if (timed.length === 0 && allDay.length === 0) lines.push(w.noEvents)
  else if (timed.length > 0) {
    if (!next) lines.push(w.eventsDone(timed.length))
    else if (timed.length === 1) lines.push(w.oneEvent(tidy(next.title), clock(next.start, facts.locale)))
    else lines.push(w.events(timed.length, tidy(next.title), clock(next.start, facts.locale)))
  }
  if (allDay.length > 0) lines.push(w.allDay(allDay.length))

  const { overdue, today } = facts.tasks
  if (overdue.length === 0 && today.length === 0) lines.push(w.noTasks)
  else {
    lines.push(w.tasks(today.length, overdue.length))
    // The briefing's order is already the order of importance: the first is the one to begin with.
    const first = overdue[0] ?? today[0]
    if (first) lines.push(w.start(tidy(first.title)))
  }
  lines.push(w.end)
  const text = lines.join(' ')
  return { text, speech: text.replace(/…/g, '') }
}

/** A task's reminder. */
export function composeReminder(reminder: Reminder, locale: AlarmLocale): Spoken {
  const w = WORDS[locale]
  const title = tidy(reminder.title)
  const time = storedTime(reminder.due, locale)
  const text = reminder.atDue && time ? w.reminderNow(title, time) : time ? w.reminderDue(title, time) : w.reminder(title)
  return { text, speech: text.replace(/…/g, '') }
}
