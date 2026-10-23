/**
 * What the assistant may propose to build or put in order: pages, databases, rows, content
 * added to a page; pages moved, renamed or put in the Trash; rows changed; properties added.
 * The model has no tools. It writes its proposal as JSON in one fenced block at the end of an
 * answer; this file reads that block, strictly, and the window shows it as a proposal. Nothing
 * is created until the user presses Apply (see renderer/ai/actions.ts).
 */

export const ACTIONS_FENCE = 'sel-actions'

export const ACTION_LIMITS = {
  /** Putting a workspace in order takes many small steps: one proposal may hold this many. */
  actions: 80,
  rows: 200,
  properties: 24,
  options: 40,
  title: 200,
  name: 100,
  markdown: 60_000,
  cell: 2000,
  json: 400_000
} as const

export const ACTION_PROPERTY_TYPES = ['title', 'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url'] as const
export type ActionPropertyType = (typeof ACTION_PROPERTY_TYPES)[number]

export const ACTION_VIEWS = ['table', 'board', 'list', 'gallery', 'calendar'] as const
export type ActionView = (typeof ACTION_VIEWS)[number]

export type ActionCell = string | number | boolean | string[] | null
/** Property name → value. `Name` (or the name of the title property) is the row's title. */
export type ActionRow = Record<string, ActionCell>

export interface ActionProperty {
  name: string
  type: ActionPropertyType
  options?: string[]
}

/**
 * Where something goes, or what it is about: `current` (the page in front), the id of a page
 * or database, or `@name` for something an earlier action of the same proposal creates.
 */
export type ActionTarget = string

export type HermanAction =
  | { do: 'create-page'; title: string; icon?: string; parent?: ActionTarget; markdown?: string; ref?: string }
  | { do: 'append'; page: ActionTarget; markdown: string }
  | {
      do: 'create-database'
      title: string
      icon?: string
      parent?: ActionTarget
      view?: ActionView
      properties: ActionProperty[]
      rows: ActionRow[]
      ref?: string
    }
  | { do: 'add-rows'; database: ActionTarget; rows: ActionRow[] }
  /** Puts a page or database inside another page, or at the top level (`parent` null). At the end of what is there. */
  | { do: 'move'; page: ActionTarget; parent: ActionTarget | null }
  /** A new title or icon for a page or database. */
  | { do: 'update-page'; page: ActionTarget; title?: string; icon?: string }
  /** New values for rows that exist, each named by its id. `Name` renames the row. */
  | { do: 'update-rows'; database: ActionTarget; rows: (ActionRow & { id: string })[] }
  /** New properties for a database that exists. */
  | { do: 'add-properties'; database: ActionTarget; properties: ActionProperty[] }
  /** Puts a page or database in the Trash, from where it can be restored. */
  | { do: 'trash'; page: ActionTarget }
  /**
   * Tasks of the built-in Tasks database changed by what the app knows of them (the routines, C2
   * and C3): a due day (null clears it), a priority (null clears it), a time block (today, or on
   * the due day given with it) and a new title. Each task is named by its id.
   */
  | { do: 'update-tasks'; tasks: TaskChange[] }
  /** Steps under a task of the Tasks database: subtasks, in its project (C3). */
  | { do: 'add-subtasks'; task: string; titles: string[] }
  /**
   * Today's line in Meditations (added after what is written there, if anything) and what is set
   * aside for tomorrow (up to three, kept with those already set): the close of the day (C4).
   */
  | { do: 'close-day'; line?: string; plans?: string[] }

/** One task's change in an `update-tasks`. */
export interface TaskChange {
  id: string
  /** `YYYY-MM-DD`, or null to take the date away. */
  due?: string | null
  priority?: TaskPriorityName | null
  /** A time block, `HH:mm` to `HH:mm`: on the `due` given here, else today. */
  block?: { start: string; end: string }
  title?: string
}

export const TASK_PRIORITY_NAMES = ['P1', 'P2', 'P3', 'P4'] as const
export type TaskPriorityName = (typeof TASK_PRIORITY_NAMES)[number]

/** Limits of the actions on tasks and on the close of the day. */
export const TASK_ACTION_LIMITS = { tasks: 40, subtasks: 12, line: 600, plans: 3, plan: 160 } as const

export interface ParsedAnswer {
  /** The answer without the proposal block. */
  text: string
  actions: HermanAction[]
  /** A block was opened and is not closed yet: the answer is still streaming. */
  pending: boolean
  /** Entries of the block that were not understood and are left out. */
  rejected: number
}

const OPEN_RE = new RegExp('(^|\\n)[ \\t]*```+[ \\t]*' + ACTIONS_FENCE + '[ \\t]*\\r?\\n')
const CLOSE_RE = /\r?\n[ \t]*```+[ \t]*(?=\r?\n|$)/
const TARGET_RE = /^(?:current|@[A-Za-z0-9_-]{1,32}|[A-Za-z0-9_-]{8,64})$/
const REF_RE = /^[A-Za-z0-9_-]{1,32}$/

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

const oneLine = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

function target(value: unknown): ActionTarget | undefined {
  return typeof value === 'string' && TARGET_RE.test(value) ? value : undefined
}

function markdown(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, ACTION_LIMITS.markdown) : ''
}

/** One emoji, or nothing: the only kind of icon a proposal can set. */
function icon(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length <= 16 && /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*$/u.test(text) ? text : undefined
}

function cell(value: unknown): ActionCell | undefined {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.slice(0, ACTION_LIMITS.cell)
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === 'string')
      .slice(0, ACTION_LIMITS.options)
      .map((item) => item.slice(0, ACTION_LIMITS.name))
  return undefined
}

function rows(value: unknown, keepId = false): ActionRow[] {
  if (!Array.isArray(value)) return []
  const out: ActionRow[] = []
  for (const item of value.slice(0, ACTION_LIMITS.rows)) {
    if (!isObject(item)) continue
    const row: ActionRow = {}
    for (const [key, raw] of Object.entries(item).slice(0, ACTION_LIMITS.properties + 2)) {
      // The row an update is for: an id like any other target, never `current` or a reference.
      if (keepId && key === 'id') {
        const id = target(raw)
        if (id && id !== 'current' && !id.startsWith('@')) row['id'] = id
        continue
      }
      const name = oneLine(key, ACTION_LIMITS.name)
      const clean = cell(raw)
      // A plain object keyed by what the model wrote: names that would reach a prototype are dropped.
      if (name && clean !== undefined && name !== '__proto__' && name !== 'constructor' && name !== 'prototype') row[name] = clean
    }
    if (Object.keys(row).length) out.push(row)
  }
  return out
}

function properties(value: unknown): ActionProperty[] {
  if (!Array.isArray(value)) return []
  const out: ActionProperty[] = []
  for (const item of value.slice(0, ACTION_LIMITS.properties)) {
    if (!isObject(item)) continue
    const name = oneLine(item['name'], ACTION_LIMITS.name)
    const type = item['type']
    if (!name || typeof type !== 'string' || !(ACTION_PROPERTY_TYPES as readonly string[]).includes(type)) continue
    const property: ActionProperty = { name, type: type as ActionPropertyType }
    if ((type === 'select' || type === 'multi_select') && Array.isArray(item['options'])) {
      property.options = [...new Set(item['options'].map((option) => oneLine(option, ACTION_LIMITS.name)).filter(Boolean))].slice(
        0,
        ACTION_LIMITS.options
      )
    }
    out.push(property)
  }
  return out
}

/** The id of a row that exists: never `current` or a reference to something created in the same proposal. */
function rowId(value: unknown): string | undefined {
  const id = target(value)
  return id && id !== 'current' && !id.startsWith('@') ? id : undefined
}

const DUE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** One entry of an `update-tasks`, or null when it changes nothing that is understood. */
function taskChange(value: unknown): TaskChange | null {
  if (!isObject(value)) return null
  const id = rowId(value['id'])
  if (!id) return null
  const change: TaskChange = { id }
  if (value['due'] === null) change.due = null
  else if (typeof value['due'] === 'string' && DUE_RE.test(value['due'])) change.due = value['due']
  if (value['priority'] === null) change.priority = null
  else if (typeof value['priority'] === 'string') {
    const name = value['priority'].trim().toUpperCase()
    if ((TASK_PRIORITY_NAMES as readonly string[]).includes(name)) change.priority = name as TaskPriorityName
  }
  const block = value['block']
  if (isObject(block)) {
    const start = typeof block['start'] === 'string' ? block['start'] : ''
    const end = typeof block['end'] === 'string' ? block['end'] : ''
    if (CLOCK_RE.test(start) && CLOCK_RE.test(end) && end > start) change.block = { start, end }
  }
  const title = oneLine(value['title'], ACTION_LIMITS.title)
  if (title) change.title = title
  return Object.keys(change).length > 1 ? change : null
}

/** One entry of the block as an action, or null when it is not one. */
export function cleanAction(value: unknown): HermanAction | null {
  if (!isObject(value)) return null
  const ref = typeof value['ref'] === 'string' && REF_RE.test(value['ref']) ? value['ref'] : undefined
  switch (value['do']) {
    case 'create-page': {
      const title = oneLine(value['title'], ACTION_LIMITS.title)
      if (!title) return null
      const action: HermanAction = { do: 'create-page', title }
      const glyph = icon(value['icon'])
      if (glyph) action.icon = glyph
      if (value['parent'] !== undefined && value['parent'] !== null) {
        const parent = target(value['parent'])
        if (!parent) return null
        action.parent = parent
      }
      const body = markdown(value['markdown'])
      if (body.trim()) action.markdown = body
      if (ref) action.ref = ref
      return action
    }
    case 'append': {
      const page = target(value['page'])
      const body = markdown(value['markdown'])
      return page && body.trim() ? { do: 'append', page, markdown: body } : null
    }
    case 'create-database': {
      const title = oneLine(value['title'], ACTION_LIMITS.title)
      if (!title) return null
      const action: HermanAction = { do: 'create-database', title, properties: properties(value['properties']), rows: rows(value['rows']) }
      const glyph = icon(value['icon'])
      if (glyph) action.icon = glyph
      if (value['parent'] !== undefined && value['parent'] !== null) {
        const parent = target(value['parent'])
        if (!parent) return null
        action.parent = parent
      }
      if (typeof value['view'] === 'string' && (ACTION_VIEWS as readonly string[]).includes(value['view']))
        action.view = value['view'] as ActionView
      if (ref) action.ref = ref
      return action
    }
    case 'add-rows': {
      const database = target(value['database'])
      const list = rows(value['rows'])
      return database && list.length ? { do: 'add-rows', database, rows: list } : null
    }
    case 'move': {
      const page = target(value['page'])
      const raw = value['parent']
      // No parent, null or "top": the top level of the workspace.
      const parent = raw === undefined || raw === null || raw === 'top' ? null : target(raw)
      if (!page || parent === undefined || page === parent) return null
      return { do: 'move', page, parent }
    }
    case 'update-page': {
      const page = target(value['page'])
      if (!page) return null
      const action: HermanAction = { do: 'update-page', page }
      const title = oneLine(value['title'], ACTION_LIMITS.title)
      if (title) action.title = title
      const glyph = icon(value['icon'])
      if (glyph) action.icon = glyph
      return action.title || action.icon ? action : null
    }
    case 'update-rows': {
      const database = target(value['database'])
      const list = rows(value['rows'], true).filter(
        (row): row is ActionRow & { id: string } => typeof row['id'] === 'string' && Object.keys(row).length > 1
      )
      return database && list.length ? { do: 'update-rows', database, rows: list } : null
    }
    case 'add-properties': {
      const database = target(value['database'])
      const list = properties(value['properties']).filter((property) => property.type !== 'title')
      return database && list.length ? { do: 'add-properties', database, properties: list } : null
    }
    case 'trash': {
      const page = target(value['page'])
      return page && !page.startsWith('@') ? { do: 'trash', page } : null
    }
    case 'update-tasks': {
      if (!Array.isArray(value['tasks'])) return null
      const tasks: TaskChange[] = []
      for (const item of value['tasks'].slice(0, TASK_ACTION_LIMITS.tasks)) {
        const change = taskChange(item)
        if (change) tasks.push(change)
      }
      return tasks.length ? { do: 'update-tasks', tasks } : null
    }
    case 'add-subtasks': {
      const task = rowId(value['task'])
      const titles = Array.isArray(value['titles'])
        ? value['titles']
            .map((title) => oneLine(title, ACTION_LIMITS.title))
            .filter(Boolean)
            .slice(0, TASK_ACTION_LIMITS.subtasks)
        : []
      return task && titles.length ? { do: 'add-subtasks', task, titles } : null
    }
    case 'close-day': {
      const line = typeof value['line'] === 'string' ? oneLine(value['line'], TASK_ACTION_LIMITS.line) : ''
      const plans = Array.isArray(value['plans'])
        ? value['plans']
            .map((plan) => oneLine(plan, TASK_ACTION_LIMITS.plan))
            .filter(Boolean)
            .slice(0, TASK_ACTION_LIMITS.plans)
        : []
      if (!line && !plans.length) return null
      return { do: 'close-day', ...(line ? { line } : {}), ...(plans.length ? { plans } : {}) }
    }
    default:
      return null
  }
}

/**
 * Splits an answer into what is read and what is proposed. Only the first block counts; every
 * block is taken out of the text. A block that does not parse proposes nothing.
 */
export function splitActions(answer: string): ParsedAnswer {
  let text = answer
  let actions: HermanAction[] = []
  let rejected = 0
  let pending = false
  let first = true
  for (;;) {
    const open = OPEN_RE.exec(text)
    if (!open) break
    const start = open.index + open[1].length
    const bodyStart = open.index + open[0].length
    // The fence may close right away (an empty block) or after the JSON.
    const rest = text.slice(bodyStart - 1)
    const close = CLOSE_RE.exec(rest)
    if (!close) {
      pending = true
      text = text.slice(0, start)
      break
    }
    const body = rest.slice(1, close.index)
    text = text.slice(0, start) + rest.slice(close.index + close[0].length)
    if (!first) continue
    first = false
    if (body.length > ACTION_LIMITS.json) {
      rejected++
      continue
    }
    try {
      const parsed: unknown = JSON.parse(body)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of list.slice(0, ACTION_LIMITS.actions)) {
        const action = cleanAction(item)
        if (action) actions.push(action)
        else rejected++
      }
      rejected += Math.max(0, list.length - ACTION_LIMITS.actions)
    } catch {
      actions = []
      rejected++
    }
  }
  return { text: text.replace(/\n{3,}/g, '\n\n').trimEnd(), actions, pending, rejected }
}
