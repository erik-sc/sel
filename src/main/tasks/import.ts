import { randomUUID } from 'node:crypto'
import type { TodoistImportResult } from '../../shared/tasks/api'
import { TASK_PROPS } from '../../shared/tasks'
import type { Op, PropertySchema, PropertyValue, SelectOption } from '../../shared/types'
import { ensureTasksDatabase } from '../db/tasks'
import type { Repository } from '../db/repository'
import { projectNameOf, readTodoistCsv } from './todoist'

const COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow', 'red']

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim()

/** The option named `name` (case and accents aside), added to `property` when there is none. */
function optionFor(property: PropertySchema, name: string): string {
  const options: SelectOption[] = property.options ?? []
  const existing = options.find((option) => fold(option.name) === fold(name))
  if (existing) return existing.id
  const option = { id: randomUUID(), name, color: COLORS[options.length % COLORS.length] }
  property.options = [...options, option]
  return option.id
}

/**
 * Adds the tasks of Todoist exports to the Tasks database, each file as a project, in one
 * transaction: new projects and labels become options, subtasks keep their parent, descriptions
 * and comments become the text of the task's page.
 */
export function importTodoistFiles(repo: Repository, files: readonly { name: string; text: string }[], now: Date = new Date()): TodoistImportResult {
  const databaseId = ensureTasksDatabase(repo)
  const database = repo.get(databaseId)
  if (!database?.props.schema) throw new Error('The Tasks database could not be opened.')
  const schema: Record<string, PropertySchema> = structuredClone(database.props.schema)
  const projectProperty = schema[TASK_PROPS.project]
  const labelProperty = schema[TASK_PROPS.labels]
  const ops: Op[] = []
  const projects: string[] = []
  let count = 0
  let skipped = 0

  for (const file of files) {
    const { tasks, skipped: left } = readTodoistCsv(file.text, now)
    skipped += left
    if (!tasks.length) continue
    const projectName = projectNameOf(file.name)
    const projectId = optionFor(projectProperty, projectName)
    if (!projects.includes(projectName)) projects.push(projectName)
    const ids = tasks.map(() => randomUUID())
    tasks.forEach((task, index) => {
      const values: Record<string, PropertyValue> = { [TASK_PROPS.project]: projectId }
      if (task.due) values[TASK_PROPS.due] = { start: task.due }
      if (task.priority) values[TASK_PROPS.priority] = `tasks.p${task.priority}`
      if (task.recurrence) values[TASK_PROPS.recurrence] = JSON.stringify(task.recurrence)
      if (task.labels.length) values[TASK_PROPS.labels] = task.labels.map((label) => optionFor(labelProperty, label))
      if (task.parent !== null) values[TASK_PROPS.parent] = [ids[task.parent]]
      ops.push({ op: 'create', input: { id: ids[index], type: 'page', parentId: databaseId, props: { title: [[task.title]], values } } })
      const notes = task.unreadDate ? [`Due in Todoist: ${task.unreadDate}`, ...task.notes] : task.notes
      for (const note of notes) {
        for (const line of note.split(/\r?\n/u).slice(0, 200)) {
          if (line.trim()) ops.push({ op: 'create', input: { type: 'text', parentId: ids[index], props: { title: [[line]] } } })
        }
      }
    })
    count += tasks.length
  }

  if (count) repo.apply([{ op: 'update', id: databaseId, patch: { props: { schema } } }, ...ops])
  return { imported: true, tasks: count, projects, skipped }
}
