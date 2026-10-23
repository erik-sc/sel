// Projects with a direction (0.8.0 E3). A project of the built-in Tasks database is one option of
// its Project property; what it is for is kept beside the options, on the database block itself,
// as `props.projects`: per option id, one sentence of objective, the next action (a task of the
// project) and milestones with dates. Progress is "N of M tasks done", never a percentage.
//
// Pure: blocks in, summaries out, so the Tasks screen, the weekly review (E1) and the day
// planning (C2) read projects the same way, in the renderer or the main process.
import { isPlainObject, optionsOf, propOf, titleOf } from '../database/values'
import type { Block, SelectOption } from '../types'
import { TASK_PROPS } from './index'

/** The objective is one sentence: longer text is cut here. */
export const OBJECTIVE_MAX = 200
/** A milestone's name. */
export const MILESTONE_MAX = 120
/** Milestones kept per project. */
export const MILESTONES_MAX = 50

export interface Milestone {
  id: string
  title: string
  /** `YYYY-MM-DD`, or null when it has no date yet. */
  date: string | null
  done: boolean
}

/** What a project is for, as stored (normalised). */
export interface ProjectPlan {
  /** One sentence; empty when none was written. */
  objective: string
  /** The task chosen as the next action (a row id), or null. */
  next: string | null
  /** In date order, undated last. */
  milestones: Milestone[]
}

export type ProjectPlans = Record<string, ProjectPlan>

const DAY = /^\d{4}-\d{2}-\d{2}$/

export const EMPTY_PLAN: ProjectPlan = Object.freeze({ objective: '', next: null, milestones: [] }) as ProjectPlan

/** One line, trimmed, at most OBJECTIVE_MAX characters. */
export function cleanObjective(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, OBJECTIVE_MAX) : ''
}

function cleanMilestone(raw: unknown): Milestone | null {
  if (!isPlainObject(raw)) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : null
  const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, MILESTONE_MAX) : ''
  if (!id || !title) return null
  const date = typeof raw.date === 'string' && DAY.test(raw.date) ? raw.date : null
  return { id, title, date, done: raw.done === true }
}

/** Date order, undated last; ties keep the order they were added in. */
export function sortMilestones(milestones: readonly Milestone[]): Milestone[] {
  return milestones
    .map((milestone, index) => ({ milestone, index }))
    .sort((a, b) => {
      const da = a.milestone.date ?? '9999-99-99'
      const db = b.milestone.date ?? '9999-99-99'
      return da < db ? -1 : da > db ? 1 : a.index - b.index
    })
    .map((item) => item.milestone)
}

/** One project's plan from whatever is stored; anything malformed reads as empty. */
export function readPlan(raw: unknown): ProjectPlan {
  if (!isPlainObject(raw)) return { ...EMPTY_PLAN, milestones: [] }
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.map(cleanMilestone).filter((item): item is Milestone => item !== null)
    : []
  const seen = new Set<string>()
  const unique = milestones.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
  return {
    objective: cleanObjective(raw.objective),
    next: typeof raw.next === 'string' && raw.next ? raw.next : null,
    milestones: sortMilestones(unique).slice(0, MILESTONES_MAX)
  }
}

/** Every project's plan, from the Tasks database's `props.projects`. */
export function readPlans(raw: unknown): ProjectPlans {
  const out: ProjectPlans = {}
  if (!isPlainObject(raw)) return out
  for (const [id, value] of Object.entries(raw)) out[id] = readPlan(value)
  return out
}

/** Whether a plan says nothing: it need not be stored. */
export function isEmptyPlan(plan: ProjectPlan): boolean {
  return !plan.objective && !plan.next && plan.milestones.length === 0
}

/**
 * The plans with one project's changed: what to store as `props.projects`. A plan left empty is
 * dropped. `known` (the project options' ids), when given, also drops the plans of projects that
 * are gone.
 */
export function withPlan(
  raw: unknown,
  projectId: string,
  change: (plan: ProjectPlan) => ProjectPlan,
  known?: readonly string[]
): ProjectPlans {
  const plans = readPlans(raw)
  const next = readPlan(change(plans[projectId] ?? readPlan(undefined)))
  if (isEmptyPlan(next)) delete plans[projectId]
  else plans[projectId] = next
  if (known) for (const id of Object.keys(plans)) if (!known.includes(id)) delete plans[id]
  return plans
}

/** A task as projects count it. */
export interface ProjectTask {
  id: string
  title: string
  done: boolean
  /** The project option id, or null. */
  project: string | null
  /** The task it is a subtask of, or null. */
  parent: string | null
}

/** The rows of the Tasks database as projects count them, in database order. Trashed rows are left out. */
export function readProjectTasks(rows: readonly Block[]): ProjectTask[] {
  const out: ProjectTask[] = []
  for (const row of rows) {
    if (!row || row.trashedAt) continue
    const values = isPlainObject(row.props?.values) ? (row.props.values as Record<string, unknown>) : {}
    const get = (id: string): unknown => (Object.hasOwn(values, id) ? values[id] : undefined)
    const project = get(TASK_PROPS.project)
    const parent = get(TASK_PROPS.parent)
    out.push({
      id: row.id,
      title: titleOf(row),
      done: get(TASK_PROPS.done) === true,
      project: typeof project === 'string' && project ? project : null,
      parent: Array.isArray(parent) && typeof parent[0] === 'string' && parent[0] !== row.id ? parent[0] : null
    })
  }
  return out
}

export interface ProjectSummary {
  id: string
  name: string
  color: string
  objective: string
  /** The next action, when the one chosen is still an open task of the project. */
  next: { id: string; title: string } | null
  /** Without a next action: the project's first open task, offered as one. */
  suggestion: { id: string; title: string } | null
  milestones: Milestone[]
  /** Tasks of the project, done and in all. */
  done: number
  total: number
  /** No next action: the weekly review and the day planning bring it up. */
  needsNext: boolean
}

/** Each project with what it is for and how far along it is, in the order of the options. */
export function projectSummaries(options: readonly SelectOption[], plans: ProjectPlans, tasks: readonly ProjectTask[]): ProjectSummary[] {
  const byProject = new Map<string, ProjectTask[]>()
  for (const task of tasks) {
    if (!task.project) continue
    const list = byProject.get(task.project)
    if (list) list.push(task)
    else byProject.set(task.project, [task])
  }
  return options.map((option) => {
    const plan = plans[option.id] ?? EMPTY_PLAN
    const own = byProject.get(option.id) ?? []
    const open = own.filter((task) => !task.done)
    const chosen = plan.next ? open.find((task) => task.id === plan.next) : undefined
    // A top-level task first: a subtask is rarely what a project's next step is called.
    const first = open.find((task) => !task.parent) ?? open[0]
    const next = chosen ? { id: chosen.id, title: chosen.title } : null
    return {
      id: option.id,
      name: option.name,
      color: option.color,
      objective: plan.objective,
      next,
      suggestion: next || !first ? null : { id: first.id, title: first.title },
      milestones: plan.milestones,
      done: own.length - open.length,
      total: own.length,
      needsNext: next === null
    }
  })
}

/** The projects of the Tasks database, read from its block and its rows. */
export function projectOverview(database: Block | null | undefined, rows: readonly Block[]): ProjectSummary[] {
  if (!database) return []
  const schema = isPlainObject(database.props?.schema) ? database.props.schema : undefined
  const options = optionsOf(propOf(schema, TASK_PROPS.project))
  return projectSummaries(options, readPlans(database.props?.projects), readProjectTasks(rows))
}

/** The projects without a next action: for the weekly review (E1) and the day planning (C2). */
export function projectsWithoutNext(summaries: readonly ProjectSummary[]): ProjectSummary[] {
  return summaries.filter((summary) => summary.needsNext)
}

/** The milestones still open whose date is before `today`. */
export function lateMilestones(plan: Pick<ProjectPlan, 'milestones'>, today: string): Milestone[] {
  return plan.milestones.filter((milestone) => !milestone.done && milestone.date !== null && milestone.date < today)
}
