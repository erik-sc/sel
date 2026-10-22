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
  /** Open tasks still to refine, when that reminder is on (shared/tasks/refine.ts). */
  refine?: number
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
    hello: (hour: number, name: string) =>
      `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}.`,
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
    reminderDue: (title: string, time: string) => `Reminder: ${title}, due at ${time}.`,
    reminderTitle: 'Reminder',
    // Events. `in` is the heading of the notification as well.
    meetingIn: (minutes: number) => `Meeting in ${minutes} min`,
    eventIn: (minutes: number) => `In ${minutes} min`,
    meetingNow: 'Meeting now',
    eventNow: 'Starting now',
    started: (minutes: number) => `Started ${minutes} min ago`,
    minutesSpoken: (minutes: number) => (minutes === 1 ? 'one minute' : `${minutes} minutes`),
    also: (titles: string) => `Also: ${titles}.`,
    untitled: 'Untitled event',
    refine: (count: number) =>
      count === 1 ? 'There is one task waiting to be refined.' : `There are ${count} tasks waiting to be refined.`,
    refineTitle: 'Time to refine',
    refineNow: (count: number) =>
      count === 1 ? 'Time to refine: one task is waiting.' : `Time to refine: ${count} tasks are waiting.`
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
      return today === 0
        ? `${overdue === 1 ? 'Uma tarefa atrasada' : `${overdue} tarefas atrasadas`}.`
        : `${due[0].toUpperCase()}${due.slice(1)}${late}.`
    },
    start: (title: string) => `Eu começaria por ${title}.`,
    end: 'É isso.',
    reminder: (title: string) => `Lembrete: ${title}.`,
    reminderNow: (title: string, time: string) => `${title}: são ${time}, a hora que você marcou.`,
    reminderDue: (title: string, time: string) => `Lembrete: ${title}, para as ${time}.`,
    reminderTitle: 'Lembrete',
    meetingIn: (minutes: number) => `Reunião em ${minutes} min`,
    eventIn: (minutes: number) => `Em ${minutes} min`,
    meetingNow: 'Reunião agora',
    eventNow: 'Começando agora',
    started: (minutes: number) => `Começou há ${minutes} min`,
    minutesSpoken: (minutes: number) => (minutes === 1 ? 'um minuto' : `${minutes} minutos`),
    also: (titles: string) => `Também: ${titles}.`,
    untitled: 'Evento sem título',
    refine: (count: number) => (count === 1 ? 'Há uma tarefa esperando refino.' : `Há ${count} tarefas esperando refino.`),
    refineTitle: 'Hora de refinar',
    refineNow: (count: number) =>
      count === 1 ? 'Hora de refinar: uma tarefa está esperando.' : `Hora de refinar: ${count} tarefas estão esperando.`
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
  if (facts.refine && facts.refine > 0) lines.push(w.refine(facts.refine))
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

export const reminderTitle = (locale: AlarmLocale): string => WORDS[locale].reminderTitle

/**
 * Events about to start: "Meeting in 5 min: Standup." The first is the one announced (and the
 * one a meeting page is made from); the others due with it are named after it. `title` heads the
 * system's notification.
 */
export function composeEvents(
  events: readonly { title: string; start: number; meeting: boolean }[],
  now: number,
  locale: AlarmLocale
): Spoken & { title: string } {
  const w = WORDS[locale]
  const [first, ...rest] = events
  const name = tidy(first.title) || w.untitled
  const minutes = Math.round((first.start - now) / 60_000)
  let head: string
  let spoken: string
  if (minutes >= 1) {
    head = first.meeting ? w.meetingIn(minutes) : w.eventIn(minutes)
    spoken = head.replace(/\d+ min$/, w.minutesSpoken(minutes))
  } else if (minutes > -1) {
    head = first.meeting ? w.meetingNow : w.eventNow
    spoken = head
  } else {
    head = w.started(-minutes)
    spoken = head.replace(/\d+ min/, w.minutesSpoken(-minutes))
  }
  const others = rest.map((event) => tidy(event.title)).filter(Boolean)
  const tail = others.length ? ` ${w.also(others.join('; '))}` : ''
  return { title: head, text: `${head}: ${name}.${tail}`, speech: `${spoken}: ${name}.${tail}`.replace(/…/g, '') }
}

/** The line the briefing gains when tasks wait to be refined; the AI's briefing gets it too. */
export function composeRefineLine(count: number, locale: AlarmLocale): string {
  return WORDS[locale].refine(count)
}

/** The refine time: "Time to refine: 4 tasks are waiting." `title` heads the system's notification. */
export function composeRefine(count: number, locale: AlarmLocale): Spoken & { title: string } {
  const w = WORDS[locale]
  const text = w.refineNow(count)
  return { title: w.refineTitle, text, speech: text }
}
