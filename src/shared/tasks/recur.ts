/**
 * Repeating tasks and completing a task of the built-in Tasks database. One place decides what
 * "done" means there, whoever ticks it: the Tasks screen, the Today screen (briefing:completeTask)
 * or the Done checkbox in one of the database's views.
 *
 * Completing a task that repeats does not mark it done: its due date moves to the next
 * occurrence (keeping its time of day), "Completed at" is set, and it stays open, as in Todoist.
 * The rule counts from the due date, or from the completion when it was typed with `!`
 * ("todo!", "every!").
 */
import type { Block, Op, PropertyValue } from '../types'
import { civil, dayNumber, readRule, ruleDays, type RecurrenceRule } from '../rrule'
import { localMoment, TASK_PROPS } from './index'
import type { TaskRecurrence } from './parse'

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/

/** The day number and time of a stored date (`YYYY-MM-DD` or `…THH:mm`). */
function split(value: string): { day: number; time: string | null } | null {
  const m = DAY_RE.exec(value)
  if (!m) return null
  const day = dayNumber(Number(m[1]), Number(m[2]), Number(m[3]))
  const back = civil(day)
  if (back.month !== Number(m[2]) || back.date !== Number(m[3])) return null
  return { day, time: m[4] ? `${m[4]}:${m[5]}` : null }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function isoOf(day: number, time: string | null): string {
  const { year, month, date } = civil(day)
  const iso = `${pad(year, 4)}-${pad(month)}-${pad(date)}`
  return time ? `${iso}T${time}` : iso
}

/** What `tasks.recurrence` holds: the JSON the quick add writes, or a bare RRULE someone typed. Null when it is neither. */
export function readRecurrence(value: unknown): TaskRecurrence | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null
  const text = value.trim()
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object') return null
      const { rule, from, text: words } = parsed as Record<string, unknown>
      if (typeof rule !== 'string' || !readRule(rule).rule) return null
      return { rule, from: from === 'completion' ? 'completion' : 'due', text: typeof words === 'string' ? words.slice(0, 200) : '' }
    } catch {
      return null
    }
  }
  const rule = text.replace(/^RRULE:/i, '')
  return readRule(rule).rule ? { rule, from: 'due', text: rule } : null
}

/** UNTIL as the last day it allows (a task only knows days). */
function untilDay(until: string | undefined): number | null {
  if (!until) return null
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(until)
  return m ? dayNumber(Number(m[1]), Number(m[2]), Number(m[3])) : null
}

/**
 * The next due date of a repeating task, keeping the due date's time of day, or null when the
 * rule cannot be read or has ended (UNTIL).
 *
 *  - from 'due': the first occurrence of the series that starts on the due date which comes
 *    after both the due date and the day it was completed (an overdue daily task moves to
 *    tomorrow, not to the day after the missed one);
 *  - from 'completion': the series starts on the day it was completed; the next one after it.
 *
 * COUNT is not read here: a task's series restarts at every completion, so completing it counts
 * down the COUNT it stores instead (`completeTaskValues`).
 */
export function nextOccurrence(rule: string, from: 'due' | 'completion', due: string | null, completedAt: string): string | null {
  const { rule: parsed, until } = readRule(rule)
  const done = split(completedAt)
  if (!parsed || !done) return null
  const current = due ? split(due) : null
  const series: RecurrenceRule = { ...parsed, count: undefined }
  const start = from === 'completion' || !current ? done.day : current.day
  const after = from === 'completion' || !current ? done.day : Math.max(current.day, done.day)
  const last = untilDay(until)
  // A window that holds the next occurrence: one more period than the interval, plus four years
  // for rules that skip (the 29th of February, the 31st of short months). At most 40 years.
  const unit = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[series.freq]
  const toDay = after + Math.min((series.interval + 1) * unit + 1500, 366 * 40)
  const days = ruleDays(series, start, after + 1, toDay, (day) => (day < start ? 'before' : last !== null && day > last ? 'after' : 'ok'))
  const next = days.find((day) => day > after)
  return next === undefined ? null : isoOf(next, current?.time ?? null)
}

/** A date value's start, from what a cell holds. */
function startOf(value: PropertyValue | undefined): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.start === 'string') return value.start
  return null
}

export interface TaskCompletion {
  /** The whole `values` object to store. */
  values: Record<string, PropertyValue>
  /** For each property touched, its value before (undefined when it had none): what undo puts back. */
  previous: Record<string, PropertyValue | undefined>
  /** The new due date when the task repeats (it stays open); absent when it is now done. */
  next?: string
}

/**
 * The values of a task of the Tasks database once completed `now`; null when it is already done.
 * A repeating task moves on (its reminder moves by as many days as its due date); any other is done.
 */
export function completeTaskValues(values: Readonly<Record<string, PropertyValue>> | undefined, now: Date): TaskCompletion | null {
  const current: Record<string, PropertyValue> = values && typeof values === 'object' && !Array.isArray(values) ? { ...values } : {}
  const own = (id: string): PropertyValue | undefined => (Object.hasOwn(current, id) ? current[id] : undefined)
  if (own(TASK_PROPS.done) === true) return null
  const completedAt = localMoment(now)
  const previous: Record<string, PropertyValue | undefined> = { [TASK_PROPS.completedAt]: own(TASK_PROPS.completedAt) }
  current[TASK_PROPS.completedAt] = { start: completedAt }

  const recurrence = readRecurrence(own(TASK_PROPS.recurrence))
  const due = startOf(own(TASK_PROPS.due))
  // "N times": the occurrences left, this one included. The last one is done like any task.
  const left = recurrence ? readRule(recurrence.rule).rule?.count : undefined
  const next = recurrence && (left === undefined || left > 1) ? nextOccurrence(recurrence.rule, recurrence.from, due, completedAt) : null
  if (recurrence && next) {
    previous[TASK_PROPS.due] = own(TASK_PROPS.due)
    current[TASK_PROPS.due] = { start: next }
    if (left !== undefined) {
      previous[TASK_PROPS.recurrence] = own(TASK_PROPS.recurrence)
      current[TASK_PROPS.recurrence] = JSON.stringify({ ...recurrence, rule: recurrence.rule.replace(/COUNT=\d+/i, `COUNT=${left - 1}`) })
    }
    const remind = startOf(own(TASK_PROPS.remind))
    const from = due ? split(due) : null
    const to = split(next)
    const at = remind ? split(remind) : null
    if (at && from && to) {
      previous[TASK_PROPS.remind] = own(TASK_PROPS.remind)
      current[TASK_PROPS.remind] = { start: isoOf(at.day + (to.day - from.day), at.time) }
    }
    return { values: current, previous, next }
  }
  previous[TASK_PROPS.done] = own(TASK_PROPS.done)
  current[TASK_PROPS.done] = true
  return { values: current, previous }
}

/** The op that completes a row of the Tasks database `now`; none when it is already done. */
export function completeTaskOps(row: Pick<Block, 'id' | 'props'>, now: Date): Op[] {
  const result = completeTaskValues(row.props.values as Record<string, PropertyValue> | undefined, now)
  return result ? [{ op: 'update', id: row.id, patch: { props: { values: result.values } } }] : []
}
