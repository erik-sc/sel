// Writing what a project is for (0.8.0 E3): its objective, next action and milestones, kept on the
// Tasks database block as `props.projects` (shared/tasks/projects.ts reads it). Every change is
// built from the block as the store has it when it lands, as tasks/edit.ts does for rows.
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { cleanObjective, MILESTONE_MAX, type Milestone, type ProjectPlan, withPlan } from '@shared/tasks/projects'
import { getBlock } from '@/store/blocks'
import * as L from '@/database/logic'
import * as actions from '@/database/actions'

/** Changes one project's plan; plans of projects that are gone are dropped on the way. */
export function updateProjectPlan(projectId: string, change: (plan: ProjectPlan) => ProjectPlan): void {
  const database = getBlock(TASKS_DATABASE_ID)
  if (!database) return
  const known = L.optionsOf(L.propOf(L.normalizeDatabase(database).schema, TASK_PROPS.project)).map((option) => option.id)
  const next = withPlan(database.props.projects, projectId, change, known)
  const before = JSON.stringify(database.props.projects ?? {})
  if (JSON.stringify(next) === before) return
  actions.runOps([{ op: 'update', id: TASKS_DATABASE_ID, patch: { props: { projects: Object.keys(next).length ? next : null } } }])
}

export function setObjective(projectId: string, text: string): void {
  updateProjectPlan(projectId, (plan) => ({ ...plan, objective: cleanObjective(text) }))
}

/** Makes `taskId` the project's next action; null clears it. */
export function setNextAction(projectId: string, taskId: string | null): void {
  updateProjectPlan(projectId, (plan) => ({ ...plan, next: taskId }))
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/** Adds a milestone; null when it has no name. */
export function addMilestone(projectId: string, title: string, date: string | null): string | null {
  const name = title.replace(/\s+/g, ' ').trim().slice(0, MILESTONE_MAX)
  if (!name) return null
  const id = newId()
  updateProjectPlan(projectId, (plan) => ({ ...plan, milestones: [...plan.milestones, { id, title: name, date, done: false }] }))
  return id
}

export function updateMilestone(projectId: string, id: string, change: Partial<Omit<Milestone, 'id'>>): void {
  updateProjectPlan(projectId, (plan) => ({
    ...plan,
    milestones: plan.milestones.map((milestone) => (milestone.id === id ? { ...milestone, ...change } : milestone))
  }))
}

export function removeMilestone(projectId: string, id: string): void {
  updateProjectPlan(projectId, (plan) => ({ ...plan, milestones: plan.milestones.filter((milestone) => milestone.id !== id) }))
}
