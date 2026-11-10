import type { ToolSpec } from '../ai/toolspecs'
import { definePack, scoped } from '../tools/pack'

/**
 * The Tasks block's tools as the MCP servers list them (see ./tools.ts for what they do).
 * Plain data: the server script bundles this file.
 */

export const TASK_TOOL_CAPS = { list: 100, text: 2000, notes: 8000 } as const

const ID = { type: 'string', description: 'A task id, as shown in square brackets after its title.' }

export const TASK_READ_SPECS: readonly ToolSpec[] = [
  {
    name: 'list_tasks',
    description:
      'The tasks of a list of the Tasks screen. today: due today or overdue. upcoming: due in the next days. inbox: without a project. all: every open task. completed: the ones done lately. Each with its id, due date, priority, project and labels. "project" and "label" keep only the tasks of one.',
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', enum: ['today', 'upcoming', 'inbox', 'all', 'completed'] },
        project: { type: 'string', description: 'Only the tasks of this project, by name.' },
        label: { type: 'string', description: 'Only the tasks with this label, by name.' },
        limit: { type: 'integer', minimum: 1, maximum: TASK_TOOL_CAPS.list }
      },
      additionalProperties: false
    }
  },
  {
    name: 'list_projects',
    description: 'The projects and labels of the Tasks database, with how many open tasks each has.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
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
  },
  {
    name: 'update_task',
    description:
      'Changes a task: only what is given. Its title, priority (1 to 4; null for none), project and labels by name (new names are added; null or an empty list clears), how it repeats ("toda segunda", "every month"; null stops it), and notes added to the end of its page. Its date is changed with reschedule_task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        title: { type: 'string' },
        priority: { type: ['integer', 'null'], minimum: 1, maximum: 4 },
        project: { type: ['string', 'null'] },
        labels: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        repeat: { type: ['string', 'null'] },
        notes: { type: 'string', description: "Added to the end of the task's page, one paragraph per line." }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'reopen_task',
    description: 'Opens a task that was marked done again.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'delete_task',
    description: 'Moves a task to the trash. It can be restored in sel (Trash), or with restore_page.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false }
  }
]

export const TASKS_PACK = definePack({
  id: 'tasks',
  title: 'Tasks',
  summary: 'The built-in Tasks database: lists (today, upcoming, inbox), quick add, completing, dates, projects and labels.',
  tools: [...scoped('read', TASK_READ_SPECS), ...scoped('tasks', TASK_WRITE_SPECS)]
})

export const TASK_TOOL_NAMES: ReadonlySet<string> = new Set(TASKS_PACK.tools.map((tool) => tool.spec.name))
