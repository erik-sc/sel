import { randomUUID } from 'node:crypto'
import { AI_PRIVATE_MESSAGE, isPrivateForAi, privacyChecker, privateProjects } from '../../shared/aiPrivate'
import { TASK_PRIORITIES, TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import { fold } from '../../shared/tasks/dates'
import { parseTask } from '../../shared/tasks/parse'
import { completeTaskValues, readRecurrence } from '../../shared/tasks/recur'
import type { Block, Op, PropertySchema, PropertyValue, SelectOption } from '../../shared/types'
import { ToolError } from '../ai/tools'
import { ensureTasksDatabase } from '../db/tasks'
import type { Repository } from '../db/repository'
import { TASK_TOOL_CAPS } from './toolspecs'

/**
 * The Tasks block's tools (./toolspecs.ts): what you ask Claude on the phone most ("what is on
 * today", "add pay the rent tomorrow 9am p1 #Home", "done"). They work on the built-in Tasks
 * database (shared/tasks), through the repository as an edit in the window does: the history
 * keeps the state before, and the caller tells the windows and sync.
 *
 * `add_task` reads the line as the quick add does (shared/tasks/parse.ts), Portuguese and English
 * alike. `delete_task` moves a task to the trash, where it can be restored; nothing is deleted
 * for good. What the user keeps private from the AI is left out of every list and refused by id.
 */

// ---- reading ----------------------------------------------------------------------

const args = (raw: unknown): Record<string, unknown> =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

const oneLine = (text: string): string =>
  text
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

const titleOf = (row: Block): string => oneLine((row.props.title ?? []).map((span) => span[0]).join('')) || 'Untitled'

const startOf = (value: unknown): string | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const start = (value as { start?: unknown }).start
  return typeof start === 'string' ? start : null
}

const localDay = (now: Date): string =>
  `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

interface Task {
  row: Block
  title: string
  done: boolean
  due: string | null
  priority: string | null
  project: string | null
  labels: string[]
  repeats: string | null
  /** When it was last completed, a wall-clock moment. */
  completedAt: string | null
}

function schemaOf(database: Block): Record<string, PropertySchema> {
  return (database.props.schema ?? {}) as Record<string, PropertySchema>
}

const optionsOf = (schema: Record<string, PropertySchema>, id: string): SelectOption[] => schema[id]?.options ?? []

function readTask(row: Block, schema: Record<string, PropertySchema>): Task {
  const values = (row.props.values ?? {}) as Record<string, PropertyValue>
  const own = (id: string): unknown => (Object.hasOwn(values, id) ? values[id] : undefined)
  const names = (id: string): Map<string, string> => new Map(optionsOf(schema, id).map((option) => [option.id, option.name]))
  const projects = names(TASK_PROPS.project)
  const labels = names(TASK_PROPS.labels)
  const project = own(TASK_PROPS.project)
  const tagged = own(TASK_PROPS.labels)
  const priority = own(TASK_PROPS.priority)
  return {
    row,
    title: titleOf(row),
    done: own(TASK_PROPS.done) === true,
    due: startOf(own(TASK_PROPS.due)),
    priority: TASK_PRIORITIES.find((each) => each.id === priority)?.name ?? null,
    project: typeof project === 'string' ? (projects.get(project) ?? null) : null,
    labels: Array.isArray(tagged)
      ? tagged.map((id) => (typeof id === 'string' ? labels.get(id) : undefined)).filter((n): n is string => !!n)
      : [],
    repeats: readRecurrence(own(TASK_PROPS.recurrence))?.text ?? null,
    completedAt: startOf(own(TASK_PROPS.completedAt))
  }
}

export function taskLine(task: Task): string {
  const parts = [`- [${task.done ? 'x' : ' '}] ${task.title} [${task.row.id}]`]
  if (task.due) parts.push(`due ${task.due.replace('T', ' ')}`)
  if (task.priority && task.priority !== 'P4') parts.push(task.priority)
  if (task.project) parts.push(`#${task.project}`)
  for (const label of task.labels) parts.push(`@${label}`)
  if (task.repeats) parts.push(`repeats ${oneLine(task.repeats)}`)
  if (task.done && task.completedAt) parts.push(`done ${task.completedAt.replace('T', ' ')}`)
  return parts.join(' · ')
}

/** The Tasks database, when the AI may see it. */
function tasksDatabase(repo: Repository): Block {
  const database = repo.get(TASKS_DATABASE_ID)
  if (!database || database.type !== 'database' || database.trashedAt !== null)
    throw new ToolError('This workspace has no Tasks database yet.')
  if (isPrivateForAi(repo, database.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  return database
}

function allTasks(repo: Repository, database: Block): Task[] {
  const hidden = privacyChecker(repo)
  const schema = schemaOf(database)
  return repo
    .children(database.id)
    .filter((row) => row.type === 'page' && row.trashedAt === null && !hidden(row.id))
    .map((row) => readTask(row, schema))
}

const openTasks = (repo: Repository, database: Block): Task[] => allTasks(repo, database).filter((task) => !task.done)

const PRIORITY_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3 }
const byDue = (a: Task, b: Task): number =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || (PRIORITY_RANK[a.priority ?? ''] ?? 4) - (PRIORITY_RANK[b.priority ?? ''] ?? 4)

export function listTasks(repo: Repository, raw: unknown, now: Date): string {
  const input = args(raw)
  const list = typeof input['list'] === 'string' ? input['list'] : 'today'
  const limit =
    typeof input['limit'] === 'number' && Number.isInteger(input['limit']) ? Math.min(Math.max(input['limit'], 1), TASK_TOOL_CAPS.list) : 50
  const today = localDay(now)
  const week = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))
  const project = typeof input['project'] === 'string' ? input['project'].trim() : ''
  const label = typeof input['label'] === 'string' ? input['label'].trim() : ''
  const wanted = (task: Task): boolean =>
    (!project || (task.project !== null && fold(task.project) === fold(project))) &&
    (!label || task.labels.some((name) => fold(name) === fold(label)))
  const database = tasksDatabase(repo)
  const tasks = (list === 'completed' ? allTasks(repo, database).filter((task) => task.done) : openTasks(repo, database)).filter(wanted)
  const day = (task: Task): string | null => task.due?.slice(0, 10) ?? null
  let picked: Task[]
  let head: string
  switch (list) {
    case 'today':
      picked = tasks.filter((task) => (day(task) ?? '9999') <= today).sort(byDue)
      head = `Today (${today}), overdue included`
      break
    case 'upcoming':
      picked = tasks
        .filter((task) => {
          const due = day(task)
          return due !== null && due > today && due <= week
        })
        .sort(byDue)
      head = `Upcoming, after today until ${week}`
      break
    case 'inbox':
      picked = tasks.filter((task) => !task.project)
      head = 'Inbox (no project)'
      break
    case 'all':
      picked = tasks.sort(byDue)
      head = 'Every open task'
      break
    case 'completed':
      picked = tasks.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      head = 'Done, the latest first'
      break
    default:
      throw new ToolError('list is one of today, upcoming, inbox, all, completed.')
  }
  if (project) head += `, project ${oneLine(project).slice(0, 60)}`
  if (label) head += `, label ${oneLine(label).slice(0, 60)}`
  const word = list === 'completed' ? 'done' : 'open'
  if (!picked.length) return `${head}: nothing ${word}.`
  const shown = picked.slice(0, limit)
  const more = picked.length > shown.length ? `\n…and ${picked.length - shown.length} more.` : ''
  return `${head}: ${picked.length} ${word}.\n${shown.map(taskLine).join('\n')}${more}`
}

export function listProjects(repo: Repository): string {
  const database = tasksDatabase(repo)
  const schema = schemaOf(database)
  const hiddenProjects = new Set(privateProjects(database))
  const open = openTasks(repo, database)
  const lines = (title: string, propertyId: string, count: (name: string) => number): string => {
    const options = optionsOf(schema, propertyId).filter((option) => !hiddenProjects.has(option.id))
    return options.length
      ? `${title}:\n${options.map((option) => `- ${oneLine(option.name)}: ${count(option.name)} open`).join('\n')}`
      : `${title}: none yet.`
  }
  return [
    lines('Projects', TASK_PROPS.project, (name) => open.filter((task) => task.project === name).length),
    lines('Labels', TASK_PROPS.labels, (name) => open.filter((task) => task.labels.includes(name)).length),
    `Inbox (no project): ${open.filter((task) => !task.project).length} open.`
  ].join('\n\n')
}

// ---- writing ----------------------------------------------------------------------

const COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow', 'red']

/** The option named `name` (case and accents aside), added to the property when there is none. */
function optionFor(schema: Record<string, PropertySchema>, propertyId: string, name: string): string {
  const property = schema[propertyId]
  const options = property?.options ?? []
  const existing = options.find((option) => fold(option.name) === fold(name))
  if (existing) return existing.id
  const option = { id: randomUUID(), name: name.slice(0, 100), color: COLORS[options.length % COLORS.length] }
  schema[propertyId] = { ...property, options: [...options, option] }
  return option.id
}

/** A row of the Tasks database the AI may change. */
function taskRow(repo: Repository, raw: unknown): Block {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if (!id) throw new ToolError('Say which task, by id.')
  const row = repo.get(id)
  if (!row || row.trashedAt !== null || row.parentId !== TASKS_DATABASE_ID) throw new ToolError('No task has that id.')
  tasksDatabase(repo)
  if (isPrivateForAi(repo, row.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  return row
}

export function addTask(repo: Repository, raw: unknown, now: Date): string {
  const input = args(raw)
  const text = typeof input['text'] === 'string' ? input['text'].slice(0, TASK_TOOL_CAPS.text) : ''
  if (!text.trim()) throw new ToolError('Give the task as text.')
  const notes = typeof input['notes'] === 'string' ? input['notes'].slice(0, TASK_TOOL_CAPS.notes) : ''
  ensureTasksDatabase(repo)
  const database = tasksDatabase(repo)
  const schema = structuredClone(schemaOf(database))
  const parsed = parseTask(text, {
    now,
    projects: optionsOf(schema, TASK_PROPS.project).map((option) => option.name),
    labels: optionsOf(schema, TASK_PROPS.labels).map((option) => option.name)
  })
  const title = parsed.title.trim() || oneLine(text)
  const values: Record<string, PropertyValue> = {}
  if (parsed.due) values[TASK_PROPS.due] = { start: parsed.due }
  if (parsed.priority) values[TASK_PROPS.priority] = `tasks.p${parsed.priority}`
  if (parsed.recurrence) values[TASK_PROPS.recurrence] = JSON.stringify(parsed.recurrence)
  if (parsed.remind) values[TASK_PROPS.remind] = { start: parsed.remind }
  const before = JSON.stringify(schema)
  if (parsed.project) {
    const projectId = optionFor(schema, TASK_PROPS.project, parsed.project)
    // A project kept private from the AI takes no task from it.
    if (privateProjects(database).includes(projectId)) throw new ToolError(AI_PRIVATE_MESSAGE)
    values[TASK_PROPS.project] = projectId
  }
  if (parsed.labels.length)
    values[TASK_PROPS.labels] = [...new Set(parsed.labels.map((name) => optionFor(schema, TASK_PROPS.labels, name)))]
  const id = randomUUID()
  const ops: Op[] = []
  if (JSON.stringify(schema) !== before) ops.push({ op: 'update', id: TASKS_DATABASE_ID, patch: { props: { schema } } })
  ops.push({ op: 'create', input: { id, type: 'page', parentId: TASKS_DATABASE_ID, props: { title: [[title]], values } } })
  for (const line of notes.split(/\r?\n/u).slice(0, 200)) {
    if (line.trim()) ops.push({ op: 'create', input: { type: 'text', parentId: id, props: { title: [[line]] } } })
  }
  repo.apply(ops)
  const row = repo.get(id)
  const stored = repo.get(TASKS_DATABASE_ID)
  if (!row || !stored) throw new ToolError('The task could not be added.')
  return `Added:\n${taskLine(readTask(row, schemaOf(stored)))}`
}

export function completeTask(repo: Repository, raw: unknown, now: Date): string {
  const row = taskRow(repo, args(raw)['id'])
  const result = completeTaskValues(row.props.values as Record<string, PropertyValue> | undefined, now)
  if (!result) return `${titleOf(row)} [${row.id}] was already done.`
  repo.apply([{ op: 'update', id: row.id, patch: { props: { values: result.values } } }])
  return result.next
    ? `Done for now: ${titleOf(row)} [${row.id}] repeats, next on ${result.next.replace('T', ' ')}.`
    : `Done: ${titleOf(row)} [${row.id}].`
}

const STORED_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/u

export function rescheduleTask(repo: Repository, raw: unknown, now: Date): string {
  const input = args(raw)
  const row = taskRow(repo, input['id'])
  const when = input['when']
  let due: string | null
  if (when === null || (typeof when === 'string' && !when.trim())) due = null
  else if (typeof when !== 'string') throw new ToolError('when is a date, words such as "tomorrow", or null.')
  else if (STORED_DATE.test(when.trim()) && !Number.isNaN(Date.parse(when.trim().slice(0, 10)))) due = when.trim()
  else {
    due = parseTask(when.slice(0, 200), { now }).due
    if (!due) throw new ToolError(`"${oneLine(when).slice(0, 60)}" is not a date sel can read. Try YYYY-MM-DD.`)
  }
  const values = { ...((row.props.values ?? {}) as Record<string, PropertyValue>) }
  if (due) values[TASK_PROPS.due] = { start: due }
  else delete values[TASK_PROPS.due]
  repo.apply([{ op: 'update', id: row.id, patch: { props: { values } } }])
  return due ? `${titleOf(row)} [${row.id}] is now due ${due.replace('T', ' ')}.` : `${titleOf(row)} [${row.id}] has no date now.`
}

export function updateTask(repo: Repository, raw: unknown, now: Date): string {
  const input = args(raw)
  const row = taskRow(repo, input['id'])
  const database = tasksDatabase(repo)
  const schema = structuredClone(schemaOf(database))
  const before = JSON.stringify(schema)
  const values = { ...((row.props.values ?? {}) as Record<string, PropertyValue>) }
  const changed: string[] = []
  let title: string | null = null
  if (input['title'] !== undefined) {
    if (typeof input['title'] !== 'string' || !input['title'].trim()) throw new ToolError('title must be text.')
    title = oneLine(input['title']).slice(0, TASK_TOOL_CAPS.text)
    changed.push('title')
  }
  if (Object.hasOwn(input, 'priority')) {
    const priority = input['priority']
    if (priority === null) delete values[TASK_PROPS.priority]
    else if (priority === 1 || priority === 2 || priority === 3 || priority === 4) values[TASK_PROPS.priority] = `tasks.p${priority}`
    else throw new ToolError('priority is 1 (most urgent) to 4, or null.')
    changed.push('priority')
  }
  if (Object.hasOwn(input, 'project')) {
    const project = input['project']
    if (project === null || (typeof project === 'string' && !project.trim())) delete values[TASK_PROPS.project]
    else if (typeof project === 'string') {
      const projectId = optionFor(schema, TASK_PROPS.project, oneLine(project))
      // A project kept private from the AI takes no task from it.
      if (privateProjects(database).includes(projectId)) throw new ToolError(AI_PRIVATE_MESSAGE)
      values[TASK_PROPS.project] = projectId
    } else throw new ToolError('project is a name, or null.')
    changed.push('project')
  }
  if (input['labels'] !== undefined) {
    const labels = input['labels']
    if (!Array.isArray(labels) || labels.length > 20 || !labels.every((name) => typeof name === 'string' && name.trim()))
      throw new ToolError('labels is a list of names.')
    const ids = [...new Set(labels.map((name) => optionFor(schema, TASK_PROPS.labels, oneLine(name as string))))]
    if (ids.length) values[TASK_PROPS.labels] = ids
    else delete values[TASK_PROPS.labels]
    changed.push('labels')
  }
  if (Object.hasOwn(input, 'repeat')) {
    const repeat = input['repeat']
    if (repeat === null || (typeof repeat === 'string' && !repeat.trim())) delete values[TASK_PROPS.recurrence]
    else if (typeof repeat === 'string') {
      const parsed = parseTask(repeat.slice(0, 200), { now })
      if (!parsed.recurrence)
        throw new ToolError(`"${oneLine(repeat).slice(0, 60)}" is not a repeat sel can read. Try "every week" or "todo dia 5".`)
      values[TASK_PROPS.recurrence] = JSON.stringify(parsed.recurrence)
      // A repeating task needs a day to count from: the one the words gave, when it had none.
      if (!values[TASK_PROPS.due] && parsed.due) values[TASK_PROPS.due] = { start: parsed.due }
    } else throw new ToolError('repeat is words such as "every week", or null.')
    changed.push('repeat')
  }
  const notes = typeof input['notes'] === 'string' ? input['notes'].slice(0, TASK_TOOL_CAPS.notes) : ''
  if (input['notes'] !== undefined && typeof input['notes'] !== 'string') throw new ToolError('notes must be text.')
  const lines = notes
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .slice(0, 200)
  if (lines.length) changed.push('notes')
  if (!changed.length) throw new ToolError('Say what to change.')
  const ops: Op[] = []
  if (JSON.stringify(schema) !== before) ops.push({ op: 'update', id: TASKS_DATABASE_ID, patch: { props: { schema } } })
  ops.push({ op: 'update', id: row.id, patch: { props: { ...(title !== null ? { title: [[title]] } : {}), values } } })
  for (const line of lines) ops.push({ op: 'create', input: { type: 'text', parentId: row.id, props: { title: [[line]] } } })
  repo.apply(ops)
  const stored = repo.get(row.id)
  const storedDatabase = repo.get(TASKS_DATABASE_ID)
  if (!stored || !storedDatabase) throw new ToolError('The task could not be changed.')
  return `Updated (${changed.join(', ')}):\n${taskLine(readTask(stored, schemaOf(storedDatabase)))}`
}

export function reopenTask(repo: Repository, raw: unknown): string {
  const row = taskRow(repo, args(raw)['id'])
  const values = { ...((row.props.values ?? {}) as Record<string, PropertyValue>) }
  if (values[TASK_PROPS.done] !== true) return `${titleOf(row)} [${row.id}] is already open.`
  delete values[TASK_PROPS.done]
  delete values[TASK_PROPS.completedAt]
  repo.apply([{ op: 'update', id: row.id, patch: { props: { values } } }])
  return `Open again: ${titleOf(row)} [${row.id}].`
}

export function deleteTask(repo: Repository, raw: unknown): string {
  const row = taskRow(repo, args(raw)['id'])
  repo.apply([{ op: 'delete', id: row.id }])
  return `Moved to the trash: ${titleOf(row)} [${row.id}]. It can be restored in sel (Trash), or with restore_page.`
}

/** Runs one task tool. */
export function callTaskTool(repo: Repository, name: string, raw: unknown, now: Date = new Date()): string {
  switch (name) {
    case 'list_tasks':
      return listTasks(repo, raw, now)
    case 'list_projects':
      return listProjects(repo)
    case 'add_task':
      return addTask(repo, raw, now)
    case 'complete_task':
      return completeTask(repo, raw, now)
    case 'reschedule_task':
      return rescheduleTask(repo, raw, now)
    case 'update_task':
      return updateTask(repo, raw, now)
    case 'reopen_task':
      return reopenTask(repo, raw)
    case 'delete_task':
      return deleteTask(repo, raw)
    default:
      throw new ToolError('No such tool.')
  }
}
