// What a task row shows, wherever it is drawn (the Tasks screen, Today, the calendar), and the
// keys a focused row answers to. Pure: no React, no DOM, no store.
import type { BriefingTask } from '@shared/briefing'
import { TASK_PRIORITIES } from '@shared/tasks'
import type { TaskRecurrence } from '@shared/tasks/parse'
import type { SelectOption } from '@shared/types'
import type { TaskField } from './copy'

export type Priority = 1 | 2 | 3 | 4

/** A task of the built-in Tasks database, as a row draws it. */
export interface TaskView {
  /** The row page. */
  id: string
  title: string
  done: boolean
  /** The stored start of the due date: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
  due: string | null
  /** P1 (most urgent) to P4; null when none was chosen, which is not P4. */
  priority: Priority | null
  project: SelectOption | null
  labels: SelectOption[]
  recurrence: TaskRecurrence | null
  /** When to remind, a wall-clock moment. */
  remind: string | null
  /** The task this is a subtask of, when there is one. */
  parent: string | null
}

/** The priority a stored option id stands for; null for none (or an option that is not one of the four). */
export function priorityOf(value: unknown): Priority | null {
  const index = TASK_PRIORITIES.findIndex((option) => option.id === value)
  return index < 0 ? null : ((index + 1) as Priority)
}

/** The option id stored for a priority; null clears it. */
export function priorityValue(level: Priority | null): string | null {
  return level === null ? null : TASK_PRIORITIES[level - 1].id
}

/**
 * A task of the Today screen or the calendar, as a row of the built-in Tasks database draws it.
 * Null for any other task (another database's row, a to-do): those keep their plain row.
 */
export function viewOfBriefing(task: BriefingTask): TaskView | null {
  if (task.kind !== 'row' || !task.labels) return null
  return {
    id: task.id,
    title: task.title,
    done: false,
    due: task.due ? (task.time ? `${task.due}T${task.time}` : task.due) : null,
    priority: priorityOf(task.priority?.id),
    project: task.project ?? null,
    labels: task.labels,
    recurrence: task.recurrence ?? null,
    remind: null,
    parent: null
  }
}

/** What a key does to the focused row. */
export type RowAction =
  | { kind: 'open'; newTab: boolean }
  | { kind: 'rename' }
  | { kind: 'edit'; field: TaskField }
  | { kind: 'priority'; level: Priority }
  | { kind: 'toggle' }
  | { kind: 'delete' }

interface Keyed {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

const LETTERS: Readonly<Record<string, TaskField>> = { d: 'date', r: 'repeat', l: 'remind' }

/**
 * The key's action on a focused task row, or null when the row lets it go (arrows, Tab, keys
 * with Ctrl or Alt: the list and the app have those). `#` and `@` are read as typed, whatever the
 * layout puts them under.
 */
export function rowKeyAction(event: Keyed): RowAction | null {
  const { key } = event
  if (event.altKey) return null
  if (key === 'Enter') return event.shiftKey ? null : { kind: 'open', newTab: event.ctrlKey || event.metaKey }
  if (event.ctrlKey || event.metaKey) return null
  if (key === 'F2' && !event.shiftKey) return { kind: 'rename' }
  if (key === ' ' || key === 'Spacebar') return { kind: 'toggle' }
  if (key === 'Delete') return { kind: 'delete' }
  if (key === '#') return { kind: 'edit', field: 'project' }
  if (key === '@') return { kind: 'edit', field: 'labels' }
  if (event.shiftKey) return null
  if (key >= '1' && key <= '4' && key.length === 1) return { kind: 'priority', level: Number(key) as Priority }
  const field = LETTERS[key.toLowerCase()]
  return field ? { kind: 'edit', field } : null
}

/** A priority picked from the keyboard: the one the task already has takes it away. */
export function nextPriority(current: Priority | null, picked: Priority): Priority | null {
  return current === picked ? null : picked
}
