// Changing a task of the built-in Tasks database from a list or the task panel: one field at a
// time, a rename read by the quick-add parser, a delete that can be taken back. Every change is
// built from the row as the store has it when it lands (database/actions.ts), so two quick edits
// never undo each other. On the Today screen and the calendar the row may not be in the store
// yet: it is fetched first.
import type { Block, PropertySchema, PropertyValue, SelectOption } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import type { TaskRecurrence } from '@shared/tasks/parse'
import { firstOccurrence } from '@shared/tasks/repeat'
import { fetchBlocks, getBlock } from '@/store/blocks'
import { useHome } from '@/home/store'
import { notifyError, toast } from '@/ui/toast'
import * as L from '@/database/logic'
import * as actions from '@/database/actions'
import { findOption, readName, renamedValues, taskValues, type IgnoredSpan } from './addTask'
import { TASK_COPY, type TaskCopy } from './copy'
import { priorityValue, type Priority } from './model'

function copy(): TaskCopy {
  return TASK_COPY[useHome.getState().locale]
}

function valuesOf(row: Block): L.Values {
  return L.isPlainObject(row.props.values) ? (row.props.values as L.Values) : {}
}

/** The row and the Tasks database, fetched when the store does not have them. Undefined when the row is gone. */
export async function taskRow(id: string): Promise<Block | undefined> {
  const missing = [id, TASKS_DATABASE_ID].filter((each) => !getBlock(each))
  if (missing.length) await fetchBlocks(() => window.api.blocks.getMany(missing))
  const row = getBlock(id)
  return row && !row.trashedAt && row.parentId === TASKS_DATABASE_ID && getBlock(TASKS_DATABASE_ID) ? row : undefined
}

/** Runs `change` once the row is at hand; says so when it cannot be. */
function withRow(id: string, change: (row: Block) => void): void {
  const run = (row: Block | undefined): void => {
    if (!row) {
      notifyError(copy().gone)
      return
    }
    change(row)
  }
  const row = getBlock(id)
  if (row && getBlock(TASKS_DATABASE_ID)) run(row.trashedAt ? undefined : row)
  else taskRow(id).then(run, (error: unknown) => notifyError(copy().saveFailed, error))
}

function propOf(id: string): PropertySchema | undefined {
  return L.propOf(actions.snapshot(TASKS_DATABASE_ID).schema, id)
}

/** Writes one property of the task; null clears it. */
function setValue(id: string, propertyId: string, value: PropertyValue): void {
  withRow(id, (row) => {
    const prop = propOf(propertyId)
    if (prop) actions.setCell(row.id, prop, value)
  })
}

export function setDue(id: string, value: L.DateValue | null): void {
  setValue(id, TASK_PROPS.due, value)
}

export function setRemind(id: string, value: L.DateValue | null): void {
  setValue(id, TASK_PROPS.remind, value)
}

export function setPriority(id: string, level: Priority | null): void {
  setValue(id, TASK_PROPS.priority, priorityValue(level))
}

/**
 * Writes the task's project. Giving it one says where it went, with "Undo" to put the project it
 * had back (none, for a task from the Inbox).
 */
export function setProject(id: string, optionId: string | null): void {
  withRow(id, (row) => {
    const prop = propOf(TASK_PROPS.project)
    if (!prop) return
    const before = projectBefore(row, prop)
    actions.setCell(row.id, prop, optionId)
    const name = optionId ? L.optionsOf(prop).find((option) => option.id === optionId)?.name : undefined
    if (!name || optionId === before) return
    const words = copy()
    toast(words.movedTo(L.titleOf(row) || words.untitled, name), {
      action: {
        label: words.undo,
        // Only while the project is still the one this toast set: a later change is not this Undo's to revert.
        run: () => {
          const prop = propOf(TASK_PROPS.project)
          const now = getBlock(id)
          if (prop && now && projectBefore(now, prop) !== optionId) return
          setValue(id, TASK_PROPS.project, before)
        }
      }
    })
  })
}

/** The project option the row has now, or null. */
function projectBefore(row: Block, prop: PropertySchema): string | null {
  const value = L.getCellValue(row, prop)
  return typeof value === 'string' ? value : null
}

/** Changes the labels from what the store has when the change lands. */
export function updateLabels(id: string, update: (ids: string[]) => string[]): void {
  withRow(id, (row) => {
    const prop = propOf(TASK_PROPS.labels)
    if (prop) actions.updateCell(row.id, prop, (current) => update(Array.isArray(current) ? current : []))
  })
}

/**
 * Writes how the task repeats. A task that starts repeating without a due date gets the first
 * day of the repeat, as the quick add and the table give it.
 */
export function setRecurrence(id: string, next: TaskRecurrence | null): void {
  withRow(id, (row) => {
    const prop = propOf(TASK_PROPS.recurrence)
    if (!prop) return
    actions.setCell(row.id, prop, next ? JSON.stringify(next) : null)
    const due = propOf(TASK_PROPS.due)
    const latest = getBlock(row.id) ?? row
    if (!next || !due || L.normalizeDateValue(L.getCellValue(latest, due))) return
    const first = firstOccurrence(next.rule, L.todayISO())
    if (first) actions.setCell(row.id, due, { start: first })
  })
}

/** Renames a task, applying what the words say (but those kept as text). False when there was nothing to write. */
export function renameTask(id: string, text: string, ignored: readonly IgnoredSpan[] = []): boolean {
  const row = getBlock(id)
  if (!row || !text.trim()) return false
  const schema = actions.snapshot(TASKS_DATABASE_ID).schema
  const options = (property: string): SelectOption[] => L.optionsOf(L.propOf(schema, property))
  const parsed = readName(
    text,
    {
      projects: options(TASK_PROPS.project).map((option) => option.name),
      labels: options(TASK_PROPS.labels).map((option) => option.name)
    },
    ignored
  )
  const optionId = (property: string, name: string): string | null =>
    findOption(options(property), name)?.id ?? actions.addOption(TASKS_DATABASE_ID, property, name) ?? null
  const project = parsed.project ? optionId(TASK_PROPS.project, parsed.project) : null
  const labels = parsed.labels.map((name) => optionId(TASK_PROPS.labels, name)).filter((each): each is string => !!each)
  // Read again: adding an option may have changed nothing about the row, but the store is the truth.
  const latest = getBlock(id) ?? row
  const title = L.titleOf(latest)
  const next = renamedValues(parsed, { project, labels }, { title, values: valuesOf(latest) })
  if (next.title === title && JSON.stringify(next.values) === JSON.stringify(valuesOf(latest))) return false
  actions.runOps([{ op: 'update', id, patch: { props: { title: next.title ? [[next.title]] : [], values: next.values } } }])
  return true
}

/** Moves a task to the trash, with "Undo" on the toast that says so. */
export function deleteTask(id: string): void {
  const row = getBlock(id)
  const words = copy()
  if (!row) {
    notifyError(words.gone)
    return
  }
  const owner = getBlock(TASKS_DATABASE_ID)
  const order = owner ? L.contentOf(owner) : []
  const title = L.titleOf(row) || words.untitled
  actions.deleteRows([id])
  toast(words.deleted(title), {
    action: {
      label: words.undo,
      run: () => void actions.restoreRows(TASKS_DATABASE_ID, [id], order)
    }
  })
}

/**
 * Lets go of several tasks: they move to the trash as one batch, with one "Undo" that brings back
 * exactly those, in their order. Tasks already gone or in the trash are not touched, so Undo never
 * restores anything this call did not put there. Returns how many were let go.
 */
export function letGoTasks(ids: readonly string[]): number {
  const words = copy()
  const gone = [...new Set(ids)].filter((id) => {
    const row = getBlock(id)
    return !!row && !row.trashedAt
  })
  if (!gone.length) {
    notifyError(words.gone)
    return 0
  }
  const owner = getBlock(TASKS_DATABASE_ID)
  const order = owner ? L.contentOf(owner) : []
  actions.deleteRows(gone)
  toast(words.letGone(gone.length), {
    action: { label: words.undo, run: () => void actions.restoreRows(TASKS_DATABASE_ID, gone, order) }
  })
  return gone.length
}

/** A new subtask under `parent`, from a typed line; it joins the parent's project unless the line names one. */
export function addSubtask(parent: Block, text: string): string | null {
  const schema = actions.snapshot(TASKS_DATABASE_ID).schema
  const options = (property: string): SelectOption[] => L.optionsOf(L.propOf(schema, property))
  const parsed = readName(text, {
    projects: options(TASK_PROPS.project).map((option) => option.name),
    labels: options(TASK_PROPS.labels).map((option) => option.name)
  })
  if (!parsed.title) return null
  const optionId = (property: string, name: string): string | null =>
    findOption(options(property), name)?.id ?? actions.addOption(TASKS_DATABASE_ID, property, name) ?? null
  const project = parsed.project ? optionId(TASK_PROPS.project, parsed.project) : null
  const labels = parsed.labels.map((name) => optionId(TASK_PROPS.labels, name)).filter((each): each is string => !!each)
  const inherited = valuesOf(parent)[TASK_PROPS.project]
  const defaults: L.Values = { [TASK_PROPS.parent]: [parent.id] }
  if (typeof inherited === 'string') defaults[TASK_PROPS.project] = inherited
  return actions.createRow(TASKS_DATABASE_ID, { title: parsed.title, values: taskValues(parsed, { project, labels }, defaults) })
}
