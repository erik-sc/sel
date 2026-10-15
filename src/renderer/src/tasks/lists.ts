// What each list of the Tasks screen holds, from the rows of the built-in Tasks database. Pure:
// rows and a day in, tasks out. Properties are found by their fixed ids (shared/tasks.ts), so
// renaming one changes nothing here.
import type { Block, SelectOption, ViewFilter } from '@shared/types'
import { TASK_PRIORITIES, TASK_PROPS } from '@shared/tasks'
import * as L from '@/database/logic'
import type { TaskListKey } from './gate'

export interface TaskItem {
  id: string
  title: string
  done: boolean
  /** The stored start of the due date: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
  due: string | null
  /** 1 (P1, most urgent) to 4 (P4, or no priority). */
  priority: 1 | 2 | 3 | 4
  project: SelectOption | null
  labels: SelectOption[]
  completedAt: string | null
  recurring: boolean
  row: Block
  /** Position in the database: the manual order. */
  order: number
}

export interface TaskGroup {
  /** A day (`YYYY-MM-DD`), `overdue`, or `all`. */
  id: string
  title: string | null
  items: TaskItem[]
}

function optionMap(schema: L.Schema, propertyId: string): Map<string, SelectOption> {
  return new Map(L.optionsOf(L.propOf(schema, propertyId)).map((option) => [option.id, option]))
}

/** The rows as tasks, in database order. */
export function readTasks(rows: readonly Block[], schema: L.Schema): TaskItem[] {
  const projects = optionMap(schema, TASK_PROPS.project)
  const labels = optionMap(schema, TASK_PROPS.labels)
  const ranks = new Map<string, 1 | 2 | 3 | 4>(TASK_PRIORITIES.map((option, index) => [option.id, (index + 1) as 1 | 2 | 3 | 4]))
  return rows.map((row, order) => {
    const values = L.isPlainObject(row.props.values) ? row.props.values : {}
    const get = (id: string): unknown => (Object.hasOwn(values, id) ? values[id] : undefined)
    const due = L.normalizeDateValue(get(TASK_PROPS.due))
    const completed = L.normalizeDateValue(get(TASK_PROPS.completedAt))
    const priority = get(TASK_PROPS.priority)
    const project = get(TASK_PROPS.project)
    const tagged = get(TASK_PROPS.labels)
    const recurrence = get(TASK_PROPS.recurrence)
    return {
      id: row.id,
      title: L.titleOf(row),
      done: get(TASK_PROPS.done) === true,
      due: due?.start ?? null,
      priority: (typeof priority === 'string' && ranks.get(priority)) || 4,
      project: (typeof project === 'string' && projects.get(project)) || null,
      labels: Array.isArray(tagged) ? tagged.map((id) => (typeof id === 'string' ? labels.get(id) : undefined)).filter((option): option is SelectOption => !!option) : [],
      completedAt: completed?.start ?? null,
      recurring: typeof recurrence === 'string' && recurrence.trim() !== '',
      row,
      order
    }
  })
}

/** Earliest due first (a day without a time before the timed ones), then priority, then the manual order. */
function byDue(a: TaskItem, b: TaskItem): number {
  const dueA = a.due ?? '9999'
  const dueB = b.due ?? '9999'
  if (dueA !== dueB) return dueA < dueB ? -1 : 1
  return a.priority - b.priority || a.order - b.order
}

const byOrder = (a: TaskItem, b: TaskItem): number => a.order - b.order

/** The rule the Today list is: due today or before (the same `date_is` rule a view can hold). */
const BY_TODAY: ViewFilter = { propertyId: TASK_PROPS.due, operator: 'date_is', value: 'by_today' }

/**
 * The tasks of one of the screen's lists, in groups. `today` is the local day; the Today list
 * reads it from the clock through the `date_is` rule, as views do.
 */
export function listTasks(tasks: readonly TaskItem[], schema: L.Schema, key: TaskListKey, today: string): TaskGroup[] {
  const open = tasks.filter((task) => !task.done)
  switch (key.kind) {
    case 'inbox':
      return [{ id: 'all', title: null, items: open.filter((task) => !task.project).sort(byOrder) }]
    case 'today': {
      const due = L.propOf(schema, TASK_PROPS.due)
      const matching = due ? open.filter((task) => L.matchesFilter(task.row, due, BY_TODAY)).sort(byDue) : []
      const overdue = matching.filter((task) => (L.dayKey(task.due) ?? today) < today)
      const groups: TaskGroup[] = []
      if (overdue.length) groups.push({ id: 'overdue', title: 'Overdue', items: overdue })
      groups.push({ id: today, title: overdue.length ? dayTitle(today, today) : null, items: matching.filter((task) => !overdue.includes(task)) })
      return groups
    }
    case 'upcoming': {
      const groups = new Map<string, TaskItem[]>()
      for (const task of open.filter((item) => (L.dayKey(item.due) ?? '') > today).sort(byDue)) {
        const day = L.dayKey(task.due) as string
        const list = groups.get(day)
        if (list) list.push(task)
        else groups.set(day, [task])
      }
      return [...groups].map(([day, items]) => ({ id: day, title: dayTitle(day, today), items }))
    }
    case 'completed': {
      const done = tasks.filter((task) => task.done)
      done.sort((a, b) => {
        const atA = a.completedAt ?? ''
        const atB = b.completedAt ?? ''
        if (atA !== atB) return atA > atB ? -1 : 1
        return b.row.updatedAt - a.row.updatedAt
      })
      return [{ id: 'all', title: null, items: done }]
    }
    case 'project':
      return [{ id: 'all', title: null, items: open.filter((task) => task.project?.id === key.id).sort(byOrder) }]
    case 'label':
      return [{ id: 'all', title: null, items: open.filter((task) => task.labels.some((label) => label.id === key.id)).sort(byDue) }]
    case 'view':
      return []
  }
}

/** How many open tasks each fixed list, project and label holds: the counts beside the names. */
export function listCounts(tasks: readonly TaskItem[], schema: L.Schema): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (key: string): void => void counts.set(key, (counts.get(key) ?? 0) + 1)
  const due = L.propOf(schema, TASK_PROPS.due)
  for (const task of tasks) {
    if (task.done) continue
    if (!task.project) add('inbox')
    else add(`project:${task.project.id}`)
    for (const label of task.labels) add(`label:${label.id}`)
    if (due && L.matchesFilter(task.row, due, BY_TODAY)) add('today')
  }
  return counts
}

function weekday(day: string, style: 'long' | 'short'): string {
  const [year, month, date] = day.split('-').map(Number)
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: 'UTC' }).format(Date.UTC(year, month - 1, date))
  } catch {
    return ''
  }
}

/** A day the way the lists name it: "Today", "Tomorrow", "Yesterday", a weekday this week, or the date. */
export function relativeDay(day: string, today: string): string {
  const diff = L.diffDays(today, day)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return weekday(day, 'long')
  return L.formatDay(day)
}

/** The heading of a day in the Upcoming list: "Tomorrow · Oct 16, 2026". */
function dayTitle(day: string, today: string): string {
  const relative = relativeDay(day, today)
  const date = L.formatDay(day)
  return relative === date ? `${weekday(day, 'short')} · ${date}` : `${relative} · ${date}`
}

/**
 * The due date of a task as a row shows it, and whether it is late. Under the heading of its own
 * day (`heading`) the day goes without saying: only the time is left.
 */
export function dueLabel(due: string, today: string, heading?: string): { text: string; overdue: boolean } {
  const day = L.dayKey(due)
  if (!day) return { text: '', overdue: false }
  const clock = L.timeOf(due)
  const time = clock ? L.formatTime(clock) : ''
  const text = day === heading ? '' : relativeDay(day, today)
  return { text: [text, time].filter(Boolean).join(' '), overdue: day < today }
}
