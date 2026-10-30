// How the Today screen words dates and times. Pure: everything takes the moment and the locale
// it should speak for, so it can be tested without a clock. Dates and times go through `Intl`
// in the system locale, which also decides between a 12 and a 24 hour clock.
import {
  CALENDAR_ERROR_TEXT,
  type BriefingCalendar,
  type BriefingEvent,
  type BriefingPhrase,
  type BriefingTask,
  type BriefingTasks
} from '../../../shared/briefing'

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
 * The time in as few characters as the locale allows, for the cells of a month: "9am" and
 * "6:30pm" where the clock has twelve hours, "09:00" where it has twenty-four.
 */
export function shortClock(ms: number, locale?: string): string {
  const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).formatToParts(ms)
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? ''
  const period = part('dayPeriod')
  if (!period) return clock(ms, locale)
  return `${part('hour')}${part('minute') === '00' ? '' : `:${part('minute')}`}${period.replace(/[\s.]/g, '').toLowerCase()}`
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

/** Local midnight of the day after the one that begins at `start` (a local day is 23 to 25 hours long). */
export function nextDayStart(start: number): number {
  const date = new Date(start)
  date.setDate(date.getDate() + 1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export interface DayAgenda {
  events: BriefingEvent[]
  tasks: BriefingTask[]
}

/**
 * What falls on each of `days` (`YYYY-MM-DD`): the events that overlap it, in the order they
 * came in, and the tasks due on it. An event of several days is on each of them.
 */
export function agendaByDay(
  days: readonly string[],
  events: readonly BriefingEvent[],
  tasks: readonly BriefingTask[]
): Map<string, DayAgenda> {
  const out = new Map<string, DayAgenda>()
  for (const day of days) {
    const from = dayStart(day)
    if (from === null) continue
    const to = nextDayStart(from)
    out.set(day, {
      events: events.filter((event) =>
        event.end > event.start ? event.start < to && event.end > from : event.start >= from && event.start < to
      ),
      tasks: []
    })
  }
  for (const task of tasks) if (task.due) out.get(task.due)?.tasks.push(task)
  return out
}

const DAY_MINUTES = 1440

/** Whether an event fills the whole of the day `[from, to)`: it is drawn as a band, not at an hour. */
export function fillsDay(event: Pick<BriefingEvent, 'start' | 'end' | 'allDay'>, from: number, to: number): boolean {
  return event.allDay || (event.start <= from && event.end >= to)
}

/** An event placed on the hours of a day: minutes from midnight, and its lane among those it overlaps. */
export interface TimedEvent<T> {
  event: T
  /** Minutes from midnight, on the clock of that day; cut to the day. */
  start: number
  end: number
  /** Which of the `lanes` side-by-side columns it takes, from 0. */
  lane: number
  lanes: number
}

/**
 * The events of the day `[from, to)` that have an hour, placed for a time grid. An event is
 * never shorter than `least` minutes, so that it can be read; those that overlap, as drawn,
 * share the width: each takes the first free lane, and a run of events that touch one another
 * is divided into as many lanes as the run needed.
 */
export function dayTimeline<T extends Pick<BriefingEvent, 'start' | 'end' | 'allDay'>>(
  events: readonly T[],
  from: number,
  to: number,
  least = 30
): TimedEvent<T>[] {
  const minute = (ms: number): number => {
    if (ms <= from) return 0
    if (ms >= to) return DAY_MINUTES
    const date = new Date(ms)
    return date.getHours() * 60 + date.getMinutes()
  }
  const placed = events
    .filter((event) => !fillsDay(event, from, to))
    .map((event) => {
      const start = Math.min(minute(event.start), DAY_MINUTES - least)
      return { event, start, end: Math.min(DAY_MINUTES, Math.max(minute(event.end), start + least)), lane: 0, lanes: 1 }
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)

  let run: TimedEvent<T>[] = []
  let runEnd = 0
  /** When each lane of the run is free again. */
  let free: number[] = []
  const close = (): void => {
    for (const item of run) item.lanes = free.length
  }
  for (const item of placed) {
    if (run.length && item.start >= runEnd) {
      close()
      run = []
      free = []
    }
    const lane = free.findIndex((end) => end <= item.start)
    item.lane = lane < 0 ? free.length : lane
    free[item.lane] = item.end
    run.push(item)
    runEnd = Math.max(runEnd, item.end)
  }
  close()
  return placed
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
  return new Intl.DateTimeFormat(
    locale,
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }
  ).format(at)
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
export function calendarNotes(
  failing: readonly Pick<BriefingCalendar, 'label' | 'error' | 'updatedAt'>[],
  now: number,
  locale?: string
): string[] {
  const groups = new Map<string, { labels: string[]; oldest: number | null }>()
  for (const calendar of failing) {
    const reason = calendar.error ?? 'failed'
    const group = groups.get(reason) ?? { labels: [], oldest: null }
    group.labels.push(calendar.label)
    if (calendar.updatedAt !== undefined)
      group.oldest = group.oldest === null ? calendar.updatedAt : Math.min(group.oldest, calendar.updatedAt)
    groups.set(reason, group)
  }
  return [...groups].map(([reason, group]) => {
    const text = CALENDAR_ERROR_TEXT[reason as keyof typeof CALENDAR_ERROR_TEXT] ?? CALENDAR_ERROR_TEXT.failed
    const last = group.oldest === null ? '' : ` Last updated ${updatedLabel(group.oldest, now, locale).replace(/^Updated /, '')}.`
    return `${group.labels.join(', ')}: ${text}${last}`
  })
}

/** "Marcus Aurelius" and "Meditations, Book IV, 3": who said it, and where. */
export function phraseSource(phrase: Pick<BriefingPhrase, 'author' | 'work' | 'locator' | 'translator'>): {
  author: string
  work: string
  translator: string
} {
  const work = phrase.work ?? ''
  const locator = phrase.locator ?? ''
  // A locator that already names the work ("Enchiridion, 5") stands alone.
  const where = !locator ? work : !work || locator.startsWith(work) ? locator : `${work}, ${locator}`
  return {
    author: phrase.author,
    work: where,
    translator: phrase.translator && phrase.translator !== phrase.author ? `translated by ${phrase.translator}` : ''
  }
}

/** The phrase as plain text for the clipboard: the passage, then who and where. */
export function phraseText(phrase: Pick<BriefingPhrase, 'text' | 'author' | 'work' | 'locator' | 'translator'>): string {
  const source = phraseSource(phrase)
  const line = [source.author, source.work].filter(Boolean).join(', ')
  return line ? `${phrase.text}\n— ${line}` : phrase.text
}

export interface TaskGroup {
  key: 'overdue' | 'today' | 'noDate'
  tasks: BriefingTask[]
}

/**
 * What a task ticked on the Today or the calendar screen is remembered by, to hide it at once:
 * its id and its due date. A repeating task stays open with a later date, and shows again there.
 */
export function tickedKey(task: Pick<BriefingTask, 'id' | 'due'>): string {
  return `${task.id} ${task.due ?? ''}`
}

/**
 * The task groups as shown: all of them when expanded, otherwise cut after the first
 * `total - more` tasks, counted across the groups in order. `hidden` is what was left out.
 * `done` holds the `tickedKey` of the tasks ticked here.
 */
export function taskGroups(
  tasks: BriefingTasks,
  expanded: boolean,
  done: ReadonlySet<string> = new Set()
): { groups: TaskGroup[]; hidden: number } {
  const all: TaskGroup[] = [
    { key: 'overdue', tasks: tasks.overdue },
    { key: 'today', tasks: tasks.today },
    { key: 'noDate', tasks: tasks.noDate ?? [] }
  ]
  const total = all.reduce((sum, group) => sum + group.tasks.length, 0)
  let room = expanded ? Infinity : Math.max(0, total - Math.max(0, tasks.more))
  let hidden = 0
  const groups: TaskGroup[] = []
  for (const group of all) {
    const open = group.tasks.filter((task) => !done.has(tickedKey(task)))
    const shown = open.slice(0, room)
    room -= shown.length
    hidden += open.length - shown.length
    if (shown.length) groups.push({ ...group, tasks: shown })
  }
  return { groups, hidden }
}

/** A task held in its list while it settles: where it was and the task as last loaded. */
export interface KeptTask {
  group: 'overdue' | 'today' | 'noDate'
  index: number
  task: BriefingTask
}

/**
 * `tasks` with the ticked tasks that are settling (keys of `settling`) kept in place. A reload of
 * the briefing no longer has a task once it is done; it stays until its fold ends. `kept` is the
 * memory between calls: it learns each settling task while the briefing still has it, and forgets
 * the ones that stopped settling.
 */
export function keepSettling(tasks: BriefingTasks, settling: ReadonlyMap<string, unknown>, kept: Map<string, KeptTask>): BriefingTasks {
  const groups = { overdue: tasks.overdue, today: tasks.today, noDate: tasks.noDate ?? [] }
  for (const key of kept.keys()) if (!settling.has(key)) kept.delete(key)
  for (const name of ['overdue', 'today', 'noDate'] as const) {
    groups[name].forEach((task, index) => {
      const key = tickedKey(task)
      if (settling.has(key)) kept.set(key, { group: name, index, task })
    })
  }
  const present = new Set(Object.values(groups).flatMap((list) => list.map(tickedKey)))
  const missing = [...kept].filter(([key]) => !present.has(key)).sort((a, b) => a[1].index - b[1].index)
  if (missing.length === 0) return tasks
  const merged = { ...groups }
  for (const [, entry] of missing) {
    const list = [...merged[entry.group]]
    list.splice(Math.min(entry.index, list.length), 0, entry.task)
    merged[entry.group] = list
  }
  return { ...tasks, ...merged }
}

/** Milliseconds from `now` to the next local midnight (never less than a second). */
export function untilMidnight(now: number): number {
  const date = new Date(now)
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  return Math.max(1000, next - now)
}
