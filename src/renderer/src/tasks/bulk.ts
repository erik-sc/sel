// One change to every task of a selection (Tasks lists): a date, a priority, a project, done. Each
// goes through `editCells` (database/actions.ts), so it is one write: a repeating task moves on to
// its next date, a completion is dated, and nothing is written for a task the change does not
// touch. One toast says what was done and offers one Undo, which puts every task's values back.
import type { Op } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { quickDate, type QuickDate } from '@shared/tasks/dates'
import { getBlock } from '@/store/blocks'
import { useHome } from '@/home/store'
import { notifyError, toast } from '@/ui/toast'
import * as L from '@/database/logic'
import * as actions from '@/database/actions'
import { TASK_COPY, type TaskCopy } from './copy'
import { priorityValue, type Priority } from './model'

function copy(): TaskCopy {
  return TASK_COPY[useHome.getState().locale]
}

/** The tasks of `ids` that are still in the store and not in the trash. */
function present(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((id) => {
    const row = getBlock(id)
    return !!row && !row.trashedAt
  })
}

function valuesOf(id: string): L.Values {
  const row = getBlock(id)
  return row && L.isPlainObject(row.props.values) ? (row.props.values as L.Values) : {}
}

/** What one change did to a task: for each property it touched, the value before and the value it wrote. */
type Touched = Record<string, { before: unknown; after: unknown }>

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype'])

function touched(before: L.Values, after: L.Values): Touched {
  const result: Touched = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (UNSAFE.has(key)) continue
    const was = Object.hasOwn(before, key) ? before[key] : undefined
    const now = Object.hasOwn(after, key) ? after[key] : undefined
    if (!same(was, now)) result[key] = { before: was, after: now }
  }
  return result
}

/**
 * Takes the change back: only the properties it touched, merged over the values the task has now,
 * and a property edited since (it no longer holds what the change wrote) is left as it is.
 */
function restore(changes: ReadonlyMap<string, Touched>): void {
  const ops: Op[] = []
  for (const [id, keys] of changes) {
    const row = getBlock(id)
    if (!row || row.trashedAt) continue
    const values = { ...valuesOf(id) }
    let changed = false
    for (const [key, { before, after }] of Object.entries(keys)) {
      if (!same(values[key], after)) continue
      if (before === undefined) delete values[key]
      else values[key] = before as L.Values[string]
      changed = true
    }
    if (changed) ops.push({ op: 'update', id, patch: { props: { values } } })
  }
  actions.runOps(ops)
  toast(copy().undone, { kind: 'info', duration: 3000 })
}

/**
 * Applies `change` to one property of the tasks as one batch and says so with one Undo.
 * `message` is read once the tasks are known: it gets how many there were.
 */
function applyMany(ids: readonly string[], property: string, change: L.BulkChange, message: (count: number) => string): void {
  const rows = present(ids)
  const prop = L.propOf(actions.snapshot(TASKS_DATABASE_ID).schema, property)
  if (!rows.length || !prop) {
    notifyError(copy().gone)
    return
  }
  const before = new Map(rows.map((id) => [id, valuesOf(id)]))
  actions.editCells(rows, prop, change)
  const changes = new Map(rows.map((id) => [id, touched(before.get(id) ?? {}, valuesOf(id))]))
  toast(message(rows.length), { action: { label: copy().undo, run: () => restore(changes) } })
}

/** Every task's date to a quick choice (the day, each keeping its time of day), or none. */
export function setDateMany(ids: readonly string[], choice: QuickDate | null, now: Date = new Date()): void {
  const words = copy()
  applyMany(ids, TASK_PROPS.due, choice ? { kind: 'day', day: quickDate(choice, now) } : { kind: 'clear' }, (count) =>
    words.manyChanged('date', count)
  )
}

/** Every task's priority; when they all have it already, it is taken away from all (as the key does on one row). */
export function setPriorityMany(ids: readonly string[], level: Priority | null): void {
  const words = copy()
  const rows = present(ids)
  const value = priorityValue(level)
  const same = level !== null && rows.length > 0 && rows.every((id) => valuesOf(id)[TASK_PROPS.priority] === value)
  applyMany(ids, TASK_PROPS.priority, level === null || same ? { kind: 'clear' } : { kind: 'set', value }, (count) =>
    words.manyChanged('priority', count)
  )
}

/** Every task to the project (an option id), or to none. */
export function setProjectMany(ids: readonly string[], optionId: string | null): void {
  const words = copy()
  applyMany(ids, TASK_PROPS.project, optionId ? { kind: 'set', value: optionId } : { kind: 'clear' }, (count) =>
    words.manyChanged('project', count)
  )
}

/** Done for all; when every one is done already, back to open for all. */
export function toggleDoneMany(ids: readonly string[]): void {
  const words = copy()
  const rows = present(ids)
  const reopen = rows.length > 0 && rows.every((id) => valuesOf(id)[TASK_PROPS.done] === true)
  applyMany(ids, TASK_PROPS.done, reopen ? { kind: 'clear' } : { kind: 'set', value: true }, (count) =>
    reopen ? words.manyReopened(count) : words.manyCompleted(count)
  )
}
