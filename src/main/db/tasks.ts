import { TASKS_DATABASE_ID, taskSchemaProblem, tasksDatabaseProps } from '../../shared/tasks'
import type { PropertySchema } from '../../shared/types'
import type { Repository } from './repository'

/**
 * Makes sure the workspace has the built-in Tasks database (shared/tasks.ts). Run at every
 * start, after the welcome content: cheap when it is there (one read), and the same block on
 * every device when it is not, so a later sync merges the two instead of keeping both.
 *
 * A Tasks database that lost a core property some other way than through the repository (a
 * damaged sync, an old copy) gets the missing ones back; nothing the user made is touched.
 * Returns the database id.
 */
export function ensureTasksDatabase(repo: Repository): string {
  const existing = repo.get(TASKS_DATABASE_ID)
  if (!existing) {
    repo.create({ id: TASKS_DATABASE_ID, type: 'database', parentId: null, props: tasksDatabaseProps() })
    return TASKS_DATABASE_ID
  }
  if (existing.type !== 'database' || existing.props.system !== 'tasks') return TASKS_DATABASE_ID
  if (taskSchemaProblem(existing.props.schema) === null) return TASKS_DATABASE_ID
  const wanted = tasksDatabaseProps().schema as Record<string, PropertySchema>
  const current = existing.props.schema ?? {}
  const schema: Record<string, PropertySchema> = { ...current }
  for (const [id, property] of Object.entries(wanted)) {
    if (!Object.hasOwn(current, id) || current[id]?.type !== property.type) schema[id] = property
  }
  repo.update(TASKS_DATABASE_ID, { props: { schema } })
  return TASKS_DATABASE_ID
}
