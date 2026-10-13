// How the Today screen words dates and times. Pure: everything takes the moment and the locale
// it should speak for, so it can be tested without a clock. Dates and times go through `Intl`
// in the system locale, which also decides between a 12 and a 24 hour clock.
import { CALENDAR_ERROR_TEXT, type BriefingCalendar, type BriefingEvent, type BriefingPhrase, type BriefingTask, type BriefingTasks } from '../../../shared/briefing'

const DAY_MS = 86_400_000

/** Local midnight of a `YYYY-MM-DD` day; null when it is not one. */
export function dayStart(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const date = new Date(0)
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setHours(0, 0, 0, 0)
  return Number.isFinite(date.getTime()) ? date.getTime() : null
}

/** "Tuesday, 13 October", in the words and order of the locale. */
export function longDate(day: string, locale?: string): string {
  const start = dayStart(day)
  if (start === null) return day
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(start)
}

export function clock(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(ms)
}

/**
 * When an event happens, within the day `[from, to)` it is listed under: "All day",
 * "09:00 – 09:30", just "09:00" for a moment, and "until 10:00" / "from 22:00" for one that
 * began before the day or ends after it.
 */
export function eventTime(event: Pick<BriefingEvent, 'start' | 'end' | 'allDay'>, from: number, to: number, locale?: string): string {
  if (event.allDay) return 'All day'
  const startsBefore = event.start < from
  const endsAfter = event.end > to
  if (startsBefore && endsAfter) return 'All day'
  if (startsBefore) return `until ${clock(event.end, locale)}`
  if (endsAfter) return `from ${clock(event.start, locale)}`
  if (event.end <= event.start) return clock(event.start, locale)
  return `${clock(event.start, locale)} – ${clock(event.end, locale)}`
}

export type EventMoment = 'past' | 'now' | 'next' | 'later' | 'day'

/**
 * Where each event stands at `now`: over, going on, the next one to start, or later. All-day
 * events are just "day". At most one event is "next", and only when nothing is going on.
 */
export function eventMoments(events: readonly Pick<BriefingEvent, 'start' | 'end' | 'allDay'>[], now: number): EventMoment[] {
  const moments: EventMoment[] = events.map((event) => {
    if (event.allDay) return 'day'
    if (event.end > event.start ? event.end <= now : event.start < now) return 'past'
    return event.start <= now ? 'now' : 'later'
  })
  if (!moments.includes('now')) {
    let next = -1
    events.forEach((event, index) => {
      if (moments[index] === 'later' && (next < 0 || event.start < events[next].start)) next = index
    })
    if (next >= 0) moments[next] = 'next'
  }
  return moments
}

/** A due day next to today: "Yesterday", "3 days ago", "Today", or the date ("10 Oct"). */
export function dueLabel(due: string, today: string, locale?: string): string {
  const at = dayStart(due)
  const base = dayStart(today)
  if (at === null || base === null) return due
  const days = Math.round((at - base) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === -1) return 'Yesterday'
  if (days === 1) return 'Tomorrow'
  if (days < 0 && days >= -6) return `${-days} days ago`
  const sameYear = due.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(at)
}

/** "Updated 08:05", or with the day when it was not today. */
export function updatedLabel(at: number, now: number, locale?: string): string {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString()
  if (sameDay) return `Updated ${clock(at, locale)}`
  return `Updated ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at)}, ${clock(at, locale)}`
}

/**
 * What to say about calendars that could not be read: one line per reason, naming the
 * calendars it applies to, and when what is on screen was last read.
 */
export function calendarNotes(failing: readonly Pick<BriefingCalendar, 'label' | 'error' | 'updatedAt'>[], now: number, locale?: string): string[] {
  const groups = new Map<string, { labels: string[]; oldest: number | null }>()
  for (const calendar of failing) {
    const reason = calendar.error ?? 'failed'
    const group = groups.get(reason) ?? { labels: [], oldest: null }
    group.labels.push(calendar.label)
    if (calendar.updatedAt !== undefined) group.oldest = group.oldest === null ? calendar.updatedAt : Math.min(group.oldest, calendar.updatedAt)
    groups.set(reason, group)
  }
  return [...groups].map(([reason, group]) => {
    const text = CALENDAR_ERROR_TEXT[reason as keyof typeof CALENDAR_ERROR_TEXT] ?? CALENDAR_ERROR_TEXT.failed
    const last = group.oldest === null ? '' : ` Last updated ${updatedLabel(group.oldest, now, locale).replace(/^Updated /, '')}.`
    return `${group.labels.join(', ')}: ${text}${last}`
  })
}

/** "Marcus Aurelius" and "Meditations, Book IV, 3": who said it, and where. */
export function phraseSource(phrase: Pick<BriefingPhrase, 'author' | 'work' | 'locator' | 'translator'>): { author: string; work: string; translator: string } {
  const work = phrase.work ?? ''
  const locator = phrase.locator ?? ''
  // A locator that already names the work ("Enchiridion, 5") stands alone.
  const where = !locator ? work : !work || locator.startsWith(work) ? locator : `${work}, ${locator}`
  return { author: phrase.author, work: where, translator: phrase.translator && phrase.translator !== phrase.author ? `translated by ${phrase.translator}` : '' }
}

/** The phrase as plain text for the clipboard: the passage, then who and where. */
export function phraseText(phrase: Pick<BriefingPhrase, 'text' | 'author' | 'work' | 'locator' | 'translator'>): string {
  const source = phraseSource(phrase)
  const line = [source.author, source.work].filter(Boolean).join(', ')
  return line ? `${phrase.text}\n— ${line}` : phrase.text
}

export interface TaskGroup {
  key: 'overdue' | 'today' | 'noDate'
  label: string
  tasks: BriefingTask[]
}

/**
 * The task groups as shown: all of them when expanded, otherwise cut after the first
 * `total - more` tasks, counted across the groups in order. `hidden` is what was left out.
 */
export function taskGroups(tasks: BriefingTasks, expanded: boolean, done: ReadonlySet<string> = new Set()): { groups: TaskGroup[]; hidden: number } {
  const all: TaskGroup[] = [
    { key: 'overdue', label: 'Overdue', tasks: tasks.overdue },
    { key: 'today', label: 'Today', tasks: tasks.today },
    { key: 'noDate', label: 'No date', tasks: tasks.noDate ?? [] }
  ]
  const total = all.reduce((sum, group) => sum + group.tasks.length, 0)
  let room = expanded ? Infinity : Math.max(0, total - Math.max(0, tasks.more))
  let hidden = 0
  const groups: TaskGroup[] = []
  for (const group of all) {
    const open = group.tasks.filter((task) => !done.has(task.id))
    const shown = open.slice(0, room)
    room -= shown.length
    hidden += open.length - shown.length
    if (shown.length) groups.push({ ...group, tasks: shown })
  }
  return { groups, hidden }
}

/** Milliseconds from `now` to the next local midnight (never less than a second). */
export function untilMidnight(now: number): number {
  const date = new Date(now)
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  return Math.max(1000, next - now)
}
