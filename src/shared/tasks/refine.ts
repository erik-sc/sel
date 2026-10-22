import { plainText } from '../richtext'
import type { SettingsSpec } from '../settings'
import type { Block } from '../types'
import { TASK_PRIORITIES, TASK_PROPS } from './index'

/**
 * Refining (docs/plans/tasks-refine.md, 9c): a task is captured with whatever the moment gave
 * (often just a name, in the Inbox) and pointed later. It is **refined** once it has a date, a
 * priority and a project; none of them is needed for it to exist. What it still lacks shows on its
 * row as an empty chip, the "A refinar" list holds the open ones that lack something, and the app
 * reminds of them in four ways, each with its own switch (the settings below).
 *
 * A subtask is refined with its parent: it is left out of the list, the counts and the reminders.
 *
 * Pure: no Electron, React or store. The renderer hands in its tasks as the lists read them; the
 * main process hands in the rows of the Tasks database as stored.
 */

/** What a task needs to be refined, in the order its chips are drawn. */
export const REFINE_FIELDS = ['date', 'priority', 'project'] as const
export type RefineField = (typeof REFINE_FIELDS)[number]

/** A task in the Inbox this many local days (or more) is worth a word from Herman. */
export const INBOX_WAIT_DAYS = 2

/** A task as the rule reads it. A field is there when it is not null, undefined or empty. */
export interface Refinable {
  done: boolean
  due: unknown
  priority: unknown
  project: unknown
  /** The task this one is a subtask of. */
  parent?: string | null
}

const present = (value: unknown): boolean => value !== null && value !== undefined && value !== ''

/** The fields the task still lacks, in the order of `REFINE_FIELDS`. */
export function missingFields(task: Refinable): RefineField[] {
  const out: RefineField[] = []
  if (!present(task.due)) out.push('date')
  if (!present(task.priority)) out.push('priority')
  if (!present(task.project)) out.push('project')
  return out
}

/** Has a date, a priority and a project. */
export function isRefined(task: Refinable): boolean {
  return missingFields(task).length === 0
}

/** Open, not a subtask, and lacking something: what the "A refinar" list holds. */
export function needsRefining(task: Refinable): boolean {
  return !task.done && !task.parent && !isRefined(task)
}

/** Oldest first; two made in the same moment keep the database's order. */
export function byAge(a: { createdAt: number; order: number }, b: { createdAt: number; order: number }): number {
  return a.createdAt - b.createdAt || a.order - b.order
}

/** The tasks to refine, oldest first. */
export function refineList<T extends Refinable & { createdAt: number; order: number }>(tasks: readonly T[]): T[] {
  return tasks.filter(needsRefining).sort(byAge)
}

/** Whole local days from the day of `from` to the day of `now`. */
export function daysBetween(from: number, now: number): number {
  const a = new Date(from)
  const b = new Date(now)
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000
  )
}

// ---- rows as stored (the main process) ------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}/
const PRIORITY_IDS: ReadonlySet<string> = new Set(TASK_PRIORITIES.map((option) => option.id))

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The option ids of the database's project property: a project whose option is gone is no project. */
function projectIds(database: Block): Set<string> {
  const project = record(record(database.props.schema)[TASK_PROPS.project])
  const options = Array.isArray(project['options']) ? project['options'] : []
  return new Set(options.map((option) => record(option)['id']).filter((id): id is string => typeof id === 'string'))
}

/** A stored row as the rule reads it. Values are user data and are not trusted. */
export function refinableRow(row: Block, projects: ReadonlySet<string>): Refinable {
  const values = record(row.props.values)
  const get = (id: string): unknown => (Object.hasOwn(values, id) ? values[id] : undefined)
  const due = record(get(TASK_PROPS.due))['start']
  const priority = get(TASK_PROPS.priority)
  const project = get(TASK_PROPS.project)
  const parent = get(TASK_PROPS.parent)
  return {
    done: get(TASK_PROPS.done) === true,
    due: typeof due === 'string' && DAY_RE.test(due) ? due : null,
    priority: typeof priority === 'string' && PRIORITY_IDS.has(priority) ? priority : null,
    project: typeof project === 'string' && projects.has(project) ? project : null,
    parent: Array.isArray(parent) && typeof parent[0] === 'string' && parent[0] !== row.id ? parent[0] : null
  }
}

export interface RefineSummary {
  /** Open tasks to refine. */
  count: number
  /** Of those, the ones in the Inbox (no project) for `INBOX_WAIT_DAYS` days or more. */
  waiting: number
  /** The one of them that has waited longest. */
  oldest: { id: string; title: string; days: number } | null
}

export const NOTHING_TO_REFINE: RefineSummary = { count: 0, waiting: 0, oldest: null }

/** What there is to refine among the rows of the Tasks database, at `now`. */
export function refineSummary(database: Block, rows: readonly Block[], now: number): RefineSummary {
  const projects = projectIds(database)
  let count = 0
  let waiting = 0
  let oldest: { row: Block; days: number } | null = null
  for (const row of rows) {
    if (row.type !== 'page' || row.trashedAt !== null || row.parentId !== database.id) continue
    const task = refinableRow(row, projects)
    if (!needsRefining(task)) continue
    count++
    if (task.project !== null) continue
    const days = daysBetween(row.createdAt, now)
    if (days < INBOX_WAIT_DAYS) continue
    waiting++
    if (!oldest || row.createdAt < oldest.row.createdAt) oldest = { row, days }
  }
  return {
    count,
    waiting,
    oldest: oldest ? { id: oldest.row.id, title: plainText(oldest.row.props.title ?? []).trim(), days: oldest.days } : null
  }
}

// ---- settings: the four reminders --------------------------------------------------------

/** When the refine time rings: a time of day on some days of the week (0 = Sunday). */
export interface RefineTime {
  enabled: boolean
  /** `HH:mm`, local wall-clock time. */
  time: string
  days: number[]
}

export interface RefineSettings {
  /** A line in the scheduled briefing when there is something to refine. */
  briefing: boolean
  /** Herman, once a day at most, when a task has sat in the Inbox for two days or more. */
  herman: boolean
  /** A notification at a fixed time, when there is something to refine then. */
  time: RefineTime
  /** A quiet mark on the sidebar's Tasks item while there is something to refine. */
  mark: boolean
}

export const REFINE_DEFAULTS: RefineSettings = {
  briefing: true,
  herman: true,
  time: { enabled: true, time: '17:00', days: [1, 2, 3, 4, 5] },
  mark: true
}

export const REFINE_SETTING: Record<keyof RefineSettings, string> = {
  briefing: 'tasks.refineBriefing',
  herman: 'tasks.refineHerman',
  time: 'tasks.refineTime',
  mark: 'tasks.refineMark'
}

/** Not synced: like the alarms, reminders belong to the device they ring on. */
export const REFINE_KEYS = Object.values(REFINE_SETTING)

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** The value a refine setting accepts from a renderer, or undefined when it does not. */
export function cleanRefineSetting(key: string, value: unknown): unknown {
  switch (key) {
    case REFINE_SETTING.briefing:
    case REFINE_SETTING.herman:
    case REFINE_SETTING.mark:
      return typeof value === 'boolean' ? value : undefined
    case REFINE_SETTING.time: {
      const raw = record(value)
      if (Object.keys(raw).some((name) => name !== 'enabled' && name !== 'time' && name !== 'days')) return undefined
      const { enabled, time, days } = raw
      if (typeof enabled !== 'boolean' || typeof time !== 'string' || !TIME_RE.test(time) || !Array.isArray(days) || days.length > 7)
        return undefined
      if (!days.every((day) => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6)) return undefined
      return { enabled, time, days: [...new Set(days as number[])].sort((a, b) => a - b) }
    }
    default:
      return undefined
  }
}

/** The settings as stored, each one its default when nothing valid is stored. */
export function readRefineSettings(get: (key: string) => unknown): RefineSettings {
  const out: RefineSettings = { ...REFINE_DEFAULTS, time: { ...REFINE_DEFAULTS.time, days: [...REFINE_DEFAULTS.time.days] } }
  for (const name of Object.keys(REFINE_SETTING) as (keyof RefineSettings)[]) {
    let stored: unknown
    try {
      stored = get(REFINE_SETTING[name])
    } catch {
      stored = undefined
    }
    const clean = stored === null || stored === undefined ? undefined : cleanRefineSetting(REFINE_SETTING[name], stored)
    if (clean !== undefined) (out as unknown as Record<string, unknown>)[name] = clean
  }
  return out
}

export const REFINE_SETTINGS: SettingsSpec = { keys: REFINE_KEYS, clean: cleanRefineSetting }
