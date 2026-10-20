import type { BriefingTask } from '../../shared/briefing'
import { plainText } from '../../shared/richtext'
import { TASK_PROPS } from '../../shared/tasks'
import type { Block, BlockProps, PropertySchema, PropertyValue } from '../../shared/types'

/**
 * Today's open tasks, drawn from the workspace. Pure: it is handed blocks and answers with
 * lists, in one pass over what it was given.
 *
 * A database is a source of tasks when it says, somehow, when a row is done:
 *   - a select property named like "status" whose options include a done-like one, and / or
 *   - a checkbox property named like "done" (or the database's only checkbox, unless its name
 *     says it means something else, like "favourite").
 * A row is open while neither says it is done. Its due date is the database's date property
 * (one named like "due" first), its priority a select named like "priority".
 *
 * Schemas are user data and can be malformed in any way: nothing here trusts their shape.
 */

/** The fields of a block this module reads. */
export type TaskBlock = Pick<Block, 'id' | 'type' | 'parentId' | 'props' | 'updatedAt' | 'trashedAt'>

export interface TaskOptions {
  /** The local day, `YYYY-MM-DD`. */
  today: string
  /** Database ids to draw from; null or undefined = every database that has a done signal. */
  databases?: readonly string[] | null
  /** Database ids never drawn from (the phrases collection). */
  exclude?: readonly string[]
  /** Unchecked to-do blocks of pages edited at or after `todoSince` (ms). */
  includeTodos?: boolean
  todoSince?: number
  /** Stops collecting after this many tasks per group. */
  cap?: number
  /** Also collect, as `dated`, the open rows due from `from` to `to` (`YYYY-MM-DD`, both included). */
  range?: { from: string; to: string }
}

export interface TaskSelection {
  overdue: BriefingTask[]
  today: BriefingTask[]
  noDate: BriefingTask[]
  /** Present only when a range was asked for: its open rows, earliest due first. */
  dated?: BriefingTask[]
}

/** Lower-case, without diacritics or punctuation: "Situação" and "situacao" are the same name. */
export function fold(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const STATUS_NAMES = new Set(['status', 'state', 'estado', 'situacao', 'stage', 'etapa', 'progress', 'progresso', 'andamento'])
const DONE_NAMES = new Set([
  'done',
  'complete',
  'completed',
  'finished',
  'closed',
  'concluido',
  'concluida',
  'feito',
  'feita',
  'pronto',
  'pronta',
  'finalizado',
  'finalizada',
  'terminado',
  'terminada',
  'resolved',
  'resolvido',
  'resolvida',
  'shipped',
  'entregue',
  'ok'
])
/** Not done, but not open either: nothing to do about them today. */
const DROPPED_NAMES = new Set([
  'cancelled',
  'canceled',
  'cancelado',
  'cancelada',
  'archived',
  'arquivado',
  'arquivada',
  'wont do',
  'won t do',
  'dropped',
  'abandoned',
  'descartado',
  'descartada'
])
const ACTIVE_NAMES = new Set([
  'in progress',
  'doing',
  'next',
  'today',
  'em andamento',
  'hoje',
  'fazendo',
  'now',
  'agora',
  'started',
  'ongoing',
  'wip',
  'working on it',
  'em progresso'
])
const CHECKBOX_DONE_NAMES = new Set([...DONE_NAMES, 'check', 'checked', 'completo', 'completa', 'is done', 'done?'.replace('?', '')])
/** Checkboxes that mean something other than "done", even when they are the only one. */
const CHECKBOX_OTHER =
  /\b(favou?rite|favorit[oa]|star(red)?|pinned|fixad[oa]|archived?|arquivad[oa]|private|privad[oa]|public[oa]?|important[e]?|urgent[e]?|read|lid[oa]|billable|recurring|recorrente|active|ativ[oa]|enabled|published|publicad[oa]|paid|pag[oa]|flag(ged)?)\b/
const DATE_NAMES = ['due', 'due date', 'deadline', 'prazo', 'vencimento', 'entrega', 'date', 'data', 'when', 'quando', 'dia', 'day']
const PRIORITY_NAMES = new Set(['priority', 'prioridade', 'importance', 'importancia', 'urgency', 'urgencia'])
const HIGH = /^(urgent[e]?|critical|critic[oa]|highest|high|alta|alto|p0|p1|1|now|asap)$/
const LOW = /^(low|lowest|baixa|baixo|p3|p4|3|4|someday|um dia|later|depois)$/

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The properties of a schema that are well-formed enough to read, in stored order. */
function propertiesOf(schema: unknown): PropertySchema[] {
  if (!isObject(schema)) return []
  const out: PropertySchema[] = []
  for (const [key, value] of Object.entries(schema)) {
    if (out.length >= 200) break
    if (!isObject(value) || typeof value['type'] !== 'string') continue
    const id = typeof value['id'] === 'string' && value['id'] ? value['id'] : key
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue
    out.push({ ...(value as unknown as PropertySchema), id, name: typeof value['name'] === 'string' ? value['name'] : '' })
  }
  return out
}

function optionsOf(property: PropertySchema): { id: string; name: string; color: string }[] {
  const options: unknown = property.options
  if (!Array.isArray(options)) return []
  const out: { id: string; name: string; color: string }[] = []
  for (const option of options.slice(0, 200) as unknown[]) {
    if (!isObject(option) || typeof option['id'] !== 'string' || typeof option['name'] !== 'string') continue
    out.push({ id: option['id'], name: option['name'], color: typeof option['color'] === 'string' ? option['color'] : 'gray' })
  }
  return out
}

/** How a database says a row is done, when it does. */
export interface TaskSignal {
  /** A checkbox that is true on done rows. */
  checkbox?: string
  /** A select: the option to move a row to when it is completed, and every option that is not open. */
  status?: { property: string; done: string; closed: ReadonlySet<string>; active: ReadonlySet<string> }
  /** The date property that says when a row is due. */
  date?: string
  priority?: { property: string; options: ReadonlyMap<string, { name: string; color: string; rank: number }> }
}

/** Reads a database's schema for a done signal. Null when it has none (it is not a task list). */
export function detectSignal(props: BlockProps | undefined | null): TaskSignal | null {
  const properties = propertiesOf(props?.schema)
  if (!properties.length) return null
  const signal: TaskSignal = {}
  // The built-in Tasks database is read by its property ids first: its properties may be renamed.
  const builtIn = (id: string, type: string): PropertySchema | undefined =>
    props?.system === 'tasks' ? properties.find((property) => property.id === id && property.type === type) : undefined

  for (const property of properties) {
    if (property.type !== 'select' || !STATUS_NAMES.has(fold(property.name))) continue
    const options = optionsOf(property)
    const done = options.find((option) => DONE_NAMES.has(fold(option.name)))
    if (!done) continue
    const closed = new Set<string>()
    const active = new Set<string>()
    for (const option of options) {
      const name = fold(option.name)
      if (DONE_NAMES.has(name) || DROPPED_NAMES.has(name)) closed.add(option.id)
      else if (ACTIVE_NAMES.has(name)) active.add(option.id)
    }
    signal.status = { property: property.id, done: done.id, closed, active }
    break
  }

  const checkboxes = properties.filter((property) => property.type === 'checkbox')
  const named = builtIn(TASK_PROPS.done, 'checkbox') ?? checkboxes.find((property) => CHECKBOX_DONE_NAMES.has(fold(property.name)))
  if (named) signal.checkbox = named.id
  else if (!signal.status && checkboxes.length === 1 && !CHECKBOX_OTHER.test(fold(checkboxes[0].name))) signal.checkbox = checkboxes[0].id

  if (!signal.checkbox && !signal.status) return null

  const dates = properties.filter((property) => property.type === 'date')
  if (dates.length) {
    const due = builtIn(TASK_PROPS.due, 'date')
    let best = due ?? dates[0]
    let bestRank = due ? -1 : DATE_NAMES.length
    for (const property of dates) {
      const rank = DATE_NAMES.indexOf(fold(property.name))
      if (rank >= 0 && rank < bestRank) {
        best = property
        bestRank = rank
      }
    }
    signal.date = best.id
  }

  const priority =
    builtIn(TASK_PROPS.priority, 'select') ??
    properties.find((property) => property.type === 'select' && PRIORITY_NAMES.has(fold(property.name)))
  if (priority) {
    const options = new Map<string, { name: string; color: string; rank: number }>()
    for (const option of optionsOf(priority)) {
      const name = fold(option.name)
      options.set(option.id, { name: option.name, color: option.color, rank: HIGH.test(name) ? 0 : LOW.test(name) ? 2 : 1 })
    }
    signal.priority = { property: priority.id, options }
  }
  return signal
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/

/** The `YYYY-MM-DD` at the start of a stored day or timestamp, when it is a real day. */
function dayOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = DAY_RE.exec(value)
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return match[0]
}

/** The wall-clock `HH:mm` a stored date carries (`YYYY-MM-DDTHH:mm`), or null. */
function timeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,9})?)?$/.exec(value)
  return match && Number(match[1]) <= 23 && Number(match[2]) <= 59 ? `${match[1]}:${match[2]}` : null
}

function valuesOf(props: BlockProps | undefined | null): Record<string, PropertyValue> {
  const values: unknown = props?.values
  return isObject(values) ? (values as Record<string, PropertyValue>) : {}
}

function own(values: Record<string, PropertyValue>, key: string): PropertyValue | undefined {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined
}

function titleOf(props: BlockProps | undefined | null): string {
  const title: unknown = props?.title
  if (!Array.isArray(title)) return ''
  try {
    return plainText(title as BlockProps['title'])
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
  } catch {
    return ''
  }
}

/** Whether a row is open, given its database's signal. */
export function isOpenRow(signal: TaskSignal, props: BlockProps | undefined | null): boolean {
  const values = valuesOf(props)
  if (signal.checkbox && own(values, signal.checkbox) === true) return false
  if (signal.status) {
    const status = own(values, signal.status.property)
    if (typeof status === 'string' && signal.status.closed.has(status)) return false
  }
  return true
}

interface Ranked {
  task: BriefingTask
  rank: number
  /** The order the block was met in: stable ties. */
  seen: number
}

function compare(a: Ranked, b: Ranked): number {
  const dueA = a.task.due ?? '9999'
  const dueB = b.task.due ?? '9999'
  if (a.rank !== b.rank) return a.rank - b.rank
  if (dueA !== dueB) return dueA < dueB ? -1 : 1
  return a.seen - b.seen
}

/**
 * The open tasks among `blocks`: rows of task databases and, when asked, unchecked to-dos.
 * Blocks may come in any order; trashed ones, linked views and anything inside either are
 * left out. Runs in one pass over the blocks plus one over the candidates it kept.
 */
export function selectTasks(blocks: Iterable<TaskBlock>, options: TaskOptions): TaskSelection {
  const today = dayOf(options.today) ?? ''
  const wanted = options.databases ? new Set(options.databases) : null
  const excluded = new Set(options.exclude ?? [])
  const cap = Math.max(1, options.cap ?? 500)
  const todoSince = options.includeTodos ? (options.todoSince ?? 0) : Infinity

  /** Everything met, for walking up to a page or a trashed ancestor. */
  const heads = new Map<string, { type: string; parentId: string | null; trashed: boolean; updatedAt: number; title?: string }>()
  const databases = new Map<string, { signal: TaskSignal | null; name: string }>()
  const rows: { block: TaskBlock; seen: number }[] = []
  const todos: { block: TaskBlock; seen: number }[] = []
  let seen = 0

  for (const block of blocks) {
    if (!block || typeof block.id !== 'string') continue
    seen++
    const props = isObject(block.props) ? (block.props as BlockProps) : {}
    const trashed = block.trashedAt !== null && block.trashedAt !== undefined
    const head: { type: string; parentId: string | null; trashed: boolean; updatedAt: number; title?: string } = {
      type: block.type,
      parentId: typeof block.parentId === 'string' ? block.parentId : null,
      trashed,
      updatedAt: typeof block.updatedAt === 'number' ? block.updatedAt : 0
    }
    if (block.type === 'database') {
      // A linked view shows another database's rows: its source is the task list, not the view.
      const linked = typeof props.sourceId === 'string'
      const usable = !trashed && !linked && !excluded.has(block.id) && (!wanted || wanted.has(block.id))
      databases.set(block.id, { signal: usable ? detectSignal(props) : null, name: titleOf(props) || 'Untitled' })
    } else if (block.type === 'page') {
      head.title = titleOf(props)
      if (!trashed && head.parentId !== null) rows.push({ block, seen })
    } else if (block.type === 'to_do') {
      if (todoSince !== Infinity && props.checked !== true) todos.push({ block, seen })
    }
    heads.set(block.id, head)
  }

  /** Whether a block sits in the trash, directly or through an ancestor. Answers are remembered. */
  const dead = new Map<string, boolean>()
  const isDead = (id: string | null): boolean => {
    const path: string[] = []
    let current = id
    let result = false
    for (let depth = 0; current !== null && depth < 200; depth++) {
      const known = dead.get(current)
      if (known !== undefined) {
        result = known
        break
      }
      const head = heads.get(current)
      // A parent that was not handed over is not known to be in the trash.
      if (!head) break
      path.push(current)
      if (head.trashed) {
        result = true
        break
      }
      current = head.parentId
    }
    for (const step of path) dead.set(step, result)
    return result
  }

  const overdue: Ranked[] = []
  const now: Ranked[] = []
  const noDate: Ranked[] = []
  const range = options.range ? { from: dayOf(options.range.from) ?? '', to: dayOf(options.range.to) ?? '' } : null
  const dated: Ranked[] = []

  for (const { block, seen: order } of rows) {
    const database = databases.get(block.parentId as string)
    const signal = database?.signal
    if (!database || !signal) continue
    const props = isObject(block.props) ? (block.props as BlockProps) : {}
    if (!isOpenRow(signal, props) || isDead(block.parentId)) continue
    const values = valuesOf(props)
    const task: BriefingTask = { id: block.id, kind: 'row', title: titleOf(props) || 'Untitled', pageId: block.id, source: database.name }
    // Without a priority a task sits between the medium and the low ones.
    let rank = 1.5
    if (signal.priority) {
      const picked = own(values, signal.priority.property)
      const option = typeof picked === 'string' ? signal.priority.options.get(picked) : undefined
      if (option) {
        task.priority = { name: option.name.slice(0, 60), color: option.color }
        rank = option.rank
      }
    }
    let start: string | null = null
    let end: string | null = null
    let startTime: string | null = null
    let endTime: string | null = null
    if (signal.date) {
      const value = own(values, signal.date)
      if (isObject(value)) {
        start = dayOf(value['start'])
        end = dayOf(value['end'])
        startTime = timeOf(value['start'])
        endTime = timeOf(value['end'])
      } else {
        start = dayOf(value)
        startTime = timeOf(value)
      }
      task.dateProperty = signal.date
    }
    const status = signal.status ? own(values, signal.status.property) : undefined
    const active = typeof status === 'string' && !!signal.status?.active.has(status)
    if (start) {
      const ranged = !!end && end > start
      task.due = ranged ? (end as string) : start
      // The hour it is due at, when it has one: the calendar's week puts it there.
      const time = ranged ? endTime : startTime
      if (time) task.time = time
    }
    const item: Ranked = { task, rank, seen: order }
    if (range && task.due && task.due >= range.from && task.due <= range.to && dated.length < cap) dated.push(item)
    if (start && (end && end >= start ? end : start) < today) {
      if (overdue.length < cap) overdue.push(item)
    } else if ((start && start <= today) || active) {
      if (now.length < cap) now.push(item)
    } else if (!start) {
      if (noDate.length < cap) noDate.push(item)
    }
    // A row due on a later day is nobody's business today.
  }

  for (const { block, seen: order } of todos) {
    if (now.length >= cap) break
    const props = isObject(block.props) ? (block.props as BlockProps) : {}
    const title = titleOf(props)
    if (!title) continue
    // The page a to-do is on: its nearest ancestor that is one.
    let pageId: string | null = null
    let current = block.parentId
    for (let depth = 0; current !== null && depth < 200; depth++) {
      const head = heads.get(current)
      if (!head) break
      if (head.type === 'page' || head.type === 'database') {
        pageId = current
        break
      }
      current = head.parentId
    }
    if (pageId === null) continue
    const page = heads.get(pageId)
    if (!page || page.type !== 'page' || page.updatedAt < todoSince) continue
    if (block.trashedAt != null || isDead(block.parentId)) continue
    now.push({ task: { id: block.id, kind: 'todo', title, pageId, source: page.title || 'Untitled' }, rank: 4, seen: order })
  }

  const byDue = (a: Ranked, b: Ranked): number =>
    (a.task.due ?? '') !== (b.task.due ?? '') ? ((a.task.due ?? '') < (b.task.due ?? '') ? -1 : 1) : a.rank - b.rank || a.seen - b.seen
  overdue.sort(byDue)
  now.sort(compare)
  noDate.sort(compare)
  const selection: TaskSelection = {
    overdue: overdue.map((item) => item.task),
    today: now.map((item) => item.task),
    noDate: noDate.map((item) => item.task)
  }
  if (range) selection.dated = dated.sort(byDue).map((item) => item.task)
  return selection
}

/** A change to a row's values, and what they were before: completing a task and undoing it. */
export interface CompletionPlan {
  /** The whole `values` object to store. */
  values: Record<string, PropertyValue>
  /** For each property touched: its previous value, or undefined when it had none. */
  previous: Record<string, PropertyValue | undefined>
}

/** The values of a row once it is done, by its database's signal. Null when it already is. */
export function planCompletion(signal: TaskSignal, props: BlockProps | undefined | null): CompletionPlan | null {
  if (!isOpenRow(signal, props)) return null
  const values = { ...valuesOf(props) }
  const previous: Record<string, PropertyValue | undefined> = {}
  if (signal.checkbox) {
    previous[signal.checkbox] = own(values, signal.checkbox)
    values[signal.checkbox] = true
  }
  if (signal.status) {
    previous[signal.status.property] = own(values, signal.status.property)
    values[signal.status.property] = signal.status.done
  }
  return { values, previous }
}

/** The values of a row with a completion taken back: only the properties it touched change. */
export function planUndo(
  props: BlockProps | undefined | null,
  previous: Record<string, PropertyValue | undefined>
): Record<string, PropertyValue> {
  const values = { ...valuesOf(props) }
  for (const [key, value] of Object.entries(previous)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (value === undefined) delete values[key]
    else values[key] = value
  }
  return values
}
