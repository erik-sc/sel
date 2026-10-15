import type { BlockProps, DatabaseView, PropertySchema, PropertyType } from '../types'

/**
 * The built-in Tasks database (docs/plans/tasks.md). One per workspace, always the same block:
 * its id, its property ids, option ids and view ids are constants, so two devices that create it
 * before they first sync write the same block, and the sync merge has nothing to disagree about.
 *
 * Code finds a property by its id, never by its name: names may be renamed. They are chosen so
 * that the Today screen's task detection (main/briefing/tasks.ts) reads the database like any
 * other task list.
 */

export const TASKS_DATABASE_ID = '7a5c5e1d-7a5c-4a5c-8a5c-7a5c5e1d0001'

export const TASK_PROPS = {
  title: 'title',
  done: 'tasks.done',
  due: 'tasks.due',
  priority: 'tasks.priority',
  project: 'tasks.project',
  labels: 'tasks.labels',
  /** Hidden; filled in by phase 3 (recurrence). */
  recurrence: 'tasks.recurrence',
  /** Hidden: when the task was last completed, a `YYYY-MM-DDTHH:mm` wall-clock moment. */
  completedAt: 'tasks.completedAt',
  /** When to remind about the task, a wall-clock moment (the reminders fire from the briefing side). */
  remind: 'tasks.remind',
  /** The task this one is a subtask of: a relation to one row of the same database. */
  parent: 'tasks.parent'
} as const

/** P1 (most urgent) to P4 (no priority), in that order. */
export const TASK_PRIORITIES = [
  { id: 'tasks.p1', name: 'P1', color: 'red' },
  { id: 'tasks.p2', name: 'P2', color: 'orange' },
  { id: 'tasks.p3', name: 'P3', color: 'blue' },
  { id: 'tasks.p4', name: 'P4', color: 'gray' }
] as const

/** The properties the app relies on: they cannot be deleted or change type. */
export const TASK_CORE_TYPES: Readonly<Record<string, PropertyType>> = {
  [TASK_PROPS.title]: 'title',
  [TASK_PROPS.done]: 'checkbox',
  [TASK_PROPS.due]: 'date',
  [TASK_PROPS.priority]: 'select',
  [TASK_PROPS.project]: 'select',
  [TASK_PROPS.labels]: 'multi_select',
  [TASK_PROPS.recurrence]: 'text',
  [TASK_PROPS.completedAt]: 'date',
  [TASK_PROPS.remind]: 'date',
  [TASK_PROPS.parent]: 'relation'
}

export function isTaskCoreProperty(id: string): boolean {
  return Object.hasOwn(TASK_CORE_TYPES, id)
}

/**
 * Why a schema cannot be the Tasks database's, or null when it can: every core property is
 * there, with its type. Other properties are the user's own and may be anything.
 */
export function taskSchemaProblem(schema: unknown): string | null {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return 'The Tasks database needs its properties'
  const record = schema as Record<string, unknown>
  for (const [id, type] of Object.entries(TASK_CORE_TYPES)) {
    const property = Object.hasOwn(record, id) ? record[id] : undefined
    if (property === null || typeof property !== 'object') return 'A property of the Tasks database cannot be deleted'
    if ((property as { type?: unknown }).type !== type) return 'A property of the Tasks database cannot change its type'
  }
  return null
}

/** Visible in the database's own views; the recurrence rule and completion time stay hidden. */
const VISIBLE = [TASK_PROPS.title, TASK_PROPS.done, TASK_PROPS.due, TASK_PROPS.priority, TASK_PROPS.project, TASK_PROPS.labels]

/** The block the seed creates. A function: callers may change what they are given. */
export function tasksDatabaseProps(): BlockProps {
  const schema: Record<string, PropertySchema> = {
    [TASK_PROPS.title]: { id: TASK_PROPS.title, name: 'Task', type: 'title' },
    [TASK_PROPS.done]: { id: TASK_PROPS.done, name: 'Done', type: 'checkbox' },
    [TASK_PROPS.due]: { id: TASK_PROPS.due, name: 'Due', type: 'date' },
    [TASK_PROPS.priority]: { id: TASK_PROPS.priority, name: 'Priority', type: 'select', options: TASK_PRIORITIES.map((option) => ({ ...option })) },
    [TASK_PROPS.project]: { id: TASK_PROPS.project, name: 'Project', type: 'select', options: [] },
    [TASK_PROPS.labels]: { id: TASK_PROPS.labels, name: 'Labels', type: 'multi_select', options: [] },
    [TASK_PROPS.recurrence]: { id: TASK_PROPS.recurrence, name: 'Recurrence', type: 'text' },
    [TASK_PROPS.completedAt]: { id: TASK_PROPS.completedAt, name: 'Completed at', type: 'date' },
    [TASK_PROPS.remind]: { id: TASK_PROPS.remind, name: 'Remind', type: 'date' },
    [TASK_PROPS.parent]: { id: TASK_PROPS.parent, name: 'Parent task', type: 'relation', relation: { databaseId: TASKS_DATABASE_ID, limit: 'one' } }
  }
  const views: DatabaseView[] = [
    { id: 'tasks.view.table', name: 'All tasks', type: 'table', visibleProperties: [...VISIBLE], filters: [], sorts: [] },
    {
      id: 'tasks.view.board',
      name: 'By project',
      type: 'board',
      visibleProperties: [...VISIBLE],
      filters: [{ propertyId: TASK_PROPS.done, operator: 'unchecked' }],
      sorts: [],
      groupBy: TASK_PROPS.project
    }
  ]
  return { title: [['Tasks']], icon: '✅', system: 'tasks', schema, views }
}

/** A local wall-clock moment, `YYYY-MM-DDTHH:mm`: how dates with a time are stored. */
export function localMoment(now: Date | number = new Date()): string {
  const d = typeof now === 'number' ? new Date(now) : now
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
