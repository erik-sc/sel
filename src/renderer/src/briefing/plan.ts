// The day's plan on the Today screen (0.8.0 E2): the calendar's events and the tasks' time blocks
// on the same hours. Pure: the briefing in, minutes of the day out. The block math itself is
// shared/tasks/blocks.ts; this file reads the briefing for it.
import type { BriefingEvent, BriefingTask, BriefingTasks } from '@shared/briefing'
import { DEFAULT_BLOCK_MINUTES, dayLoad, minutesOf, type DayLoad, type Span } from '@shared/tasks/blocks'
import { fillsDay } from './format'

/** The hours the plan always shows; it grows to take in whatever is earlier or later. */
export const PLAN_FROM = 8 * 60
export const PLAN_TO = 20 * 60

/** An event on the day's hours, in minutes since midnight (cut to the day). */
export interface PlanEvent extends Span {
  event: BriefingEvent
}

/** A task on the day's hours: a block, or a task due at a time (drawn half an hour long). */
export interface PlanBlock extends Span {
  task: BriefingTask
  /** False for a task due at a time without an end: it has no length of its own yet. */
  sized: boolean
}

function minuteOf(ms: number, from: number, to: number): number {
  if (ms <= from) return 0
  if (ms >= to) return 1440
  const date = new Date(ms)
  return date.getHours() * 60 + date.getMinutes()
}

/** The day's timed events (not those that fill it, not those shown as free) in minutes, by start. */
export function planEvents(events: readonly BriefingEvent[], from: number, to: number): PlanEvent[] {
  return events
    .filter((event) => !fillsDay(event, from, to) && event.end > from && event.start < to)
    .map((event) => {
      const start = minuteOf(event.start, from, to)
      return { event, start, end: Math.max(minuteOf(event.end, from, to), start + 15) }
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)
}

/** The tasks of `day` that have a time: their blocks, by start. */
export function planBlocks(tasks: readonly BriefingTask[], day: string): PlanBlock[] {
  const out: PlanBlock[] = []
  for (const task of tasks) {
    if (task.due !== day) continue
    const start = minutesOf(task.time)
    if (start === null) continue
    const sized = typeof task.minutes === 'number' && task.minutes > 0
    out.push({ task, start, end: Math.min(1440, start + (sized ? (task.minutes as number) : DEFAULT_BLOCK_MINUTES)), sized })
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** The tasks that could go on the plan but have no time yet: today's, the overdue and the undated ones. */
export function unplannedTasks(tasks: BriefingTasks, day: string): BriefingTask[] {
  return [...tasks.overdue, ...tasks.today, ...(tasks.noDate ?? [])].filter((task) => !(task.due === day && task.time))
}

/** The hours the plan shows: the usual ones, widened to whole hours around anything outside them. */
export function planWindow(spans: readonly Span[]): Span {
  let start = PLAN_FROM
  let end = PLAN_TO
  for (const span of spans) {
    start = Math.min(start, Math.floor(span.start / 60) * 60)
    end = Math.max(end, Math.ceil(span.end / 60) * 60)
  }
  return { start: Math.max(0, start), end: Math.min(1440, end) }
}

/**
 * How the day stands. Only what is left of the day counts when it is today (`now`, minutes since
 * midnight); the tasks counted are today's, not the overdue nor the undated ones.
 */
export function planLoad(
  events: readonly PlanEvent[],
  blocks: readonly PlanBlock[],
  tasks: BriefingTasks,
  day: string,
  now?: number
): DayLoad {
  const unplaced = tasks.today.filter((task) => !(task.due === day && task.time)).length
  const window = planWindow([...events, ...blocks])
  return dayLoad({ events, blocks, unplaced, from: window.start, to: window.end, now })
}

/** "1 h 30", "45 min": a length of time, in the plan's words. */
export function lengthLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`
}

/**
 * The briefing's tasks with one changed in place (`due`, `time`, `minutes`), until the next load
 * says the same: a block shows where it was put at once. A task given today moves to today's list.
 */
export function patchTasks(
  tasks: BriefingTasks,
  id: string,
  change: { due: string; time?: string | null; minutes?: number | null },
  today: string
): BriefingTasks {
  let found: BriefingTask | undefined
  const without = (list: readonly BriefingTask[] | undefined): BriefingTask[] =>
    (list ?? []).filter((task) => {
      if (task.id !== id) return true
      found = task
      return false
    })
  const overdue = without(tasks.overdue)
  const current = without(tasks.today)
  const noDate = tasks.noDate ? without(tasks.noDate) : undefined
  if (!found) return tasks
  const next: BriefingTask = { ...found, due: change.due }
  if (change.time) next.time = change.time
  else delete next.time
  if (change.minutes) next.minutes = change.minutes
  else delete next.minutes
  const out: BriefingTasks = { ...tasks, overdue, today: current }
  if (noDate) out.noDate = noDate
  if (change.due < today) out.overdue = [...overdue, next]
  else if (change.due === today) out.today = [...current, next]
  else return out
  return out
}

/** Each span with the lane it takes among those it overlaps, and how many lanes its run has. */
export function withLanes<T extends Span>(items: readonly T[]): (T & { lane: number; lanes: number })[] {
  const placed = [...items].sort((a, b) => a.start - b.start || b.end - a.end).map((item) => ({ ...item, lane: 0, lanes: 1 }))
  let run: typeof placed = []
  let runEnd = 0
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
