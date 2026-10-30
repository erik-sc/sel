import { randomUUID } from 'node:crypto'
import { AI_PRIVATE_MESSAGE, isPrivateForAi, privacyChecker, privateProjects } from '../../shared/aiPrivate'
import { TASK_PRIORITIES, TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import { fold } from '../../shared/tasks/dates'
import { parseTask } from '../../shared/tasks/parse'
import { completeTaskValues, readRecurrence } from '../../shared/tasks/recur'
import type { Block, Op, PropertySchema, PropertyValue, SelectOption } from '../../shared/types'
import type { ToolSpec } from '../ai/toolspecs'
import { ToolError } from '../ai/tools'
import { ensureTasksDatabase } from '../db/tasks'
import type { Repository } from '../db/repository'

/**
 * The task tools of the remote connector: what you ask Claude on the phone most ("what is on
 * today", "add pay the rent tomorrow 9am p1 #Home", "done"). They work on the built-in Tasks
 * database (shared/tasks), through the repository as an edit in the window does: the history
 * keeps the state before, and the caller tells the windows and sync.
 *
 * `add_task` reads the line as the quick add does (shared/tasks/parse.ts), Portuguese and English
 * alike. What the user keeps private from the AI is left out of every list and refused by id.
 */

export const TASK_TOOL_CAPS = { list: 100, text: 2000, notes: 8000 } as const

const ID = { type: 'string', description: 'A task id, as shown in square brackets after its title.' }

export const TASK_READ_SPECS: readonly ToolSpec[] = [
  {
    name: 'list_tasks',
    description:
      'The open tasks of a list of the Tasks screen. today: due today or overdue. upcoming: due in the next days. inbox: without a project. all: every open task. Each with its id, due date, priority, project and labels.',
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', enum: ['today', 'upcoming', 'inbox', 'all'] },
        limit: { type: 'integer', minimum: 1, maximum: TASK_TOOL_CAPS.list }
      },
      additionalProperties: false
    }
  }
]

export const TASK_WRITE_SPECS: readonly ToolSpec[] = [
  {
    name: 'add_task',
    description:
      'Adds a task from one line, read like sel\'s quick add (Portuguese or English): dates and times ("amanhã 9h", "friday", "em 3 dias"), repeats ("toda segunda", "every month"), priority (p1–p4), #project and @label. Returns the task as stored.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The task line, e.g. "Pagar aluguel amanhã 9h p1 #Casa @contas".' },
        notes: { type: 'string', description: "Text for the task's page, one paragraph per line." }
      },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'complete_task',
    description: 'Marks a task done. A repeating task moves on to its next date instead and stays open.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'reschedule_task',
    description:
      'Moves a task to another day: "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" (local time) or words such as "tomorrow" or "sexta 14h". null removes the date.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, when: { type: ['string', 'null'] } },
      required: ['id', 'when'],
      additionalProperties: false
    }
  }
]

export const TASK_TOOL_NAMES = new Set([...TASK_READ_SPECS, ...TASK_WRITE_SPECS].map((spec) => spec.name))

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
    repeats: readRecurrence(own(TASK_PROPS.recurrence))?.text ?? null
  }
}

export function taskLine(task: Task): string {
  const parts = [`- [${task.done ? 'x' : ' '}] ${task.title} [${task.row.id}]`]
  if (task.due) parts.push(`due ${task.due.replace('T', ' ')}`)
  if (task.priority && task.priority !== 'P4') parts.push(task.priority)
  if (task.project) parts.push(`#${task.project}`)
  for (const label of task.labels) parts.push(`@${label}`)
  if (task.repeats) parts.push(`repeats ${oneLine(task.repeats)}`)
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

function openTasks(repo: Repository, database: Block): Task[] {
  const hidden = privacyChecker(repo)
  const schema = schemaOf(database)
  return repo
    .children(database.id)
    .filter((row) => row.type === 'page' && row.trashedAt === null && !hidden(row.id))
    .map((row) => readTask(row, schema))
    .filter((task) => !task.done)
}

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
  const tasks = openTasks(repo, tasksDatabase(repo))
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
    default:
      throw new ToolError('list is one of today, upcoming, inbox, all.')
  }
  if (!picked.length) return `${head}: nothing open.`
  const shown = picked.slice(0, limit)
  const more = picked.length > shown.length ? `\n…and ${picked.length - shown.length} more.` : ''
  return `${head}: ${picked.length} open.\n${shown.map(taskLine).join('\n')}${more}`
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

/** Runs one task tool. */
export function callTaskTool(repo: Repository, name: string, raw: unknown, now: Date = new Date()): string {
  switch (name) {
    case 'list_tasks':
      return listTasks(repo, raw, now)
    case 'add_task':
      return addTask(repo, raw, now)
    case 'complete_task':
      return completeTask(repo, raw, now)
    case 'reschedule_task':
      return rescheduleTask(repo, raw, now)
    default:
      throw new ToolError('No such tool.')
  }
}
