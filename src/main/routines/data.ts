import { privateProjects } from '../../shared/aiPrivate'
import type { Briefing, BriefingEvent, BriefingTask } from '../../shared/briefing'
import type { DayReview } from '../../shared/notebook'
import { plainText } from '../../shared/richtext'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import { clockOf, freeSpans, type Span } from '../../shared/tasks/blocks'
import { projectOverview } from '../../shared/tasks/projects'
import type { Block } from '../../shared/types'
import type { StalledTask } from './stalled'

/**
 * What a routine's prompt is written from, read in this process from what is stored: the
 * briefing (agenda and open tasks), the Tasks database (projects and their next actions), the
 * close of the day (what was done and edited today). Pure: the sources come in, lines of text
 * go out. Anything private from the AI is left out here (`hidden`, shared/aiPrivate.ts).
 */

/** The part of the day a plan fills, in minutes since midnight. */
export const WORK_DAY = { from: 8 * 60, to: 19 * 60 } as const
/** Free stretches shorter than this are not offered for a block. */
export const MIN_FREE_MINUTES = 30
/** Tasks per list in a prompt. */
const TASKS_CAP = 30

/** A task as a routine's prompt lists it. `id` only for a task of the Tasks database: the only ones a proposal may change. */
export interface RoutineTask {
  id: string | null
  title: string
  due?: string
  time?: string
  minutes?: number
  priority?: string
  project?: string
}

export interface DayData {
  /** "Thursday, 22 October 2026". */
  date: string
  /** "08:30". */
  time: string
  /** `YYYY-MM-DD`. */
  today: string
  /** "09:00–09:30 Standup (Room 4)", "All day: Conference". */
  events: string[]
  /** Free stretches left today, "10:00–12:00". */
  free: string[]
  overdue: RoutineTask[]
  dueToday: RoutineTask[]
  undated: RoutineTask[]
  /** "Website — next: Write the brief [id]", "Garden — no next action". */
  projects: string[]
  tomorrow?: string
}

export interface CloseData extends DayData {
  /** Tasks completed today. */
  done: string[]
  /** Pages edited today. */
  edited: string[]
  /** Today's line in Meditations, when one is written. */
  line: string
  tomorrowPlans: string[]
}

export interface StalledData {
  date: string
  task: StalledTask & { projectName?: string; subtasks: string[] }
}

export interface DaySource {
  briefing: Briefing
  /** The Tasks database and its rows. */
  tasksDatabase: Block | null
  taskRows: readonly Block[]
  /** True for what is private from the AI. */
  hidden: (id: string) => boolean
  now: number
}

function minuteOf(ms: number): number {
  const date = new Date(ms)
  return date.getHours() * 60 + date.getMinutes()
}

const timeFormat = (ms: number): string => clockOf(minuteOf(ms))

function eventLine(event: BriefingEvent): string {
  const when = event.allDay
    ? 'All day'
    : event.end > event.start
      ? `${timeFormat(event.start)}–${timeFormat(event.end)}`
      : timeFormat(event.start)
  return `${when}: ${event.title || 'Untitled'}${event.location ? ` (${event.location})` : ''}`
}

function taskOf(task: BriefingTask, editable: (task: BriefingTask) => boolean): RoutineTask {
  const out: RoutineTask = { id: editable(task) ? task.id : null, title: task.title || 'Untitled' }
  if (task.due) out.due = task.due
  if (task.time) out.time = task.time
  if (task.minutes) out.minutes = task.minutes
  if (task.priority) out.priority = task.priority.name
  if (task.project) out.project = task.project.name
  return out
}

/** The stretches of today nobody has taken yet, from now (or the start of the work day) to its end. */
export function freeToday(events: readonly BriefingEvent[], tasks: readonly BriefingTask[], today: string, now: number): Span[] {
  const busy: Span[] = []
  for (const event of events) {
    if (event.allDay || event.transparent) continue
    const start = new Date(event.start)
    const end = new Date(event.end)
    // An event that started yesterday or ends tomorrow takes the day from (or to) midnight.
    const from = event.start < new Date(now).setHours(0, 0, 0, 0) ? 0 : start.getHours() * 60 + start.getMinutes()
    const to = event.end > new Date(now).setHours(24, 0, 0, 0) ? 24 * 60 : end.getHours() * 60 + end.getMinutes()
    if (to > from) busy.push({ start: from, end: to })
  }
  for (const task of tasks) {
    if (task.due !== today || !task.time || !task.minutes) continue
    const [hours, minutes] = task.time.split(':').map(Number)
    const start = hours * 60 + minutes
    busy.push({ start, end: start + task.minutes })
  }
  const from = Math.max(WORK_DAY.from, Math.ceil(minuteOf(now) / 15) * 15)
  return freeSpans(busy, from, WORK_DAY.to).filter((span) => span.end - span.start >= MIN_FREE_MINUTES)
}

/** The day as a routine sees it: agenda, free stretches, open tasks and projects. */
export function dayData(source: DaySource): DayData {
  const { briefing, hidden, now } = source
  const nowDate = new Date(now)
  const isTasksRow = new Set(source.taskRows.filter((row) => !row.trashedAt).map((row) => row.id))
  const editable = (task: BriefingTask): boolean => task.kind === 'row' && isTasksRow.has(task.id)
  const shared = (tasks: readonly BriefingTask[] | undefined): RoutineTask[] =>
    (tasks ?? [])
      .filter((task) => !hidden(task.id))
      .slice(0, TASKS_CAP)
      .map((task) => taskOf(task, editable))
  const all = [...briefing.tasks.overdue, ...briefing.tasks.today, ...(briefing.tasks.noDate ?? [])].filter((task) => !hidden(task.id))
  // A project kept from the AI is left out with its tasks.
  const secret = new Set(privateProjects(source.tasksDatabase))
  const projects = hidden(TASKS_DATABASE_ID)
    ? []
    : projectOverview(source.tasksDatabase, source.taskRows)
        .filter((project) => !secret.has(project.id) && project.total > project.done)
        .slice(0, 20)
        .map((project) =>
          project.next
            ? `${project.name} — next: ${project.next.title} [${project.next.id}]`
            : project.suggestion
              ? `${project.name} — no next action chosen; first open task: ${project.suggestion.title} [${project.suggestion.id}]`
              : `${project.name} — no next action`
        )
  const data: DayData = {
    date: new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(nowDate),
    time: timeFormat(now),
    today: briefing.date,
    events: briefing.events.today.map(eventLine),
    free: freeToday(briefing.events.today, all, briefing.date, now).map((span) => `${clockOf(span.start)}–${clockOf(span.end)}`),
    overdue: shared(briefing.tasks.overdue),
    dueToday: shared(briefing.tasks.today),
    undated: shared(briefing.tasks.noDate),
    projects
  }
  if (briefing.events.tomorrowFirst) data.tomorrow = eventLine(briefing.events.tomorrowFirst)
  return data
}

/** The close of the day: the day as above, with what was done and edited today and what tomorrow already holds. */
export function closeData(source: DaySource, review: DayReview): CloseData {
  const { hidden } = source
  return {
    ...dayData(source),
    done: review.completed.filter((item) => !hidden(item.id) && !hidden(item.pageId)).map((item) => item.title || 'Untitled'),
    edited: review.edited.filter((item) => !hidden(item.id) && !hidden(item.pageId)).map((item) => item.title || 'Untitled'),
    line: review.line,
    tomorrowPlans: review.tomorrowPlans
  }
}

/** A stuck task with what is known around it: its project's name and its subtasks. */
export function stalledData(task: StalledTask, source: Pick<DaySource, 'tasksDatabase' | 'taskRows' | 'now'>): StalledData {
  const options = source.tasksDatabase?.props.schema?.[TASK_PROPS.project]?.options
  const projectName = task.project && Array.isArray(options) ? options.find((option) => option?.id === task.project)?.name : undefined
  const subtasks = source.taskRows
    .filter((row) => {
      const parent = row.props.values?.[TASK_PROPS.parent]
      return !row.trashedAt && Array.isArray(parent) && parent[0] === task.id
    })
    .map((row) => plainText(row.props.title).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12)
  return {
    date: new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(source.now)),
    task: { ...task, ...(projectName ? { projectName } : {}), subtasks }
  }
}
