import { TASKS_DATABASE_ID } from '../../shared/tasks'
import { NOTHING_TO_REFINE, refineSummary, type RefineSummary } from '../../shared/tasks/refine'
import type { Block } from '../../shared/types'

/**
 * What there is to refine, from what is stored (the rule is shared/tasks/refine.ts): the
 * sidebar's mark and the Today line ask through `tasks:refining`, Herman reads the Inbox's
 * waiting tasks from it. The alarms read the rows themselves (alarms/service.ts).
 */

/** The part of the repository this needs. */
export interface TaskRows {
  get(id: string): Block | null | undefined
  children(id: string): Block[]
}

/** The built-in Tasks database and its rows, when it exists. */
export function storedTasks(repo: TaskRows): { database: Block; rows: Block[] } | null {
  const database = repo.get(TASKS_DATABASE_ID)
  if (!database || database.type !== 'database' || database.trashedAt !== null) return null
  return { database, rows: repo.children(database.id) }
}

export function refineFacts(repo: TaskRows, now: number): RefineSummary {
  const found = storedTasks(repo)
  return found ? refineSummary(found.database, found.rows, now) : NOTHING_TO_REFINE
}
