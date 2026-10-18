import type { Block, Op } from '../../shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'

/**
 * Completions of the built-in Tasks database that a window writes as an ordinary edit: the Done
 * checkbox in one of its views, or Ctrl+Z there. Herman hears of them as he does of a task ticked
 * on the Today or the Tasks screen (`briefing:completeTask`). Read from `Completed at` before and
 * after the write; nothing is written here.
 */

type Lookup = (id: string) => Pick<Block, 'type' | 'parentId' | 'props'> | null

/** The `Completed at` moment of a row of the Tasks database, or null when it has none. */
function completedAtOf(block: Pick<Block, 'props'>): string | null {
  const values = block.props.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const value = (values as Record<string, unknown>)[TASK_PROPS.completedAt]
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const start = (value as { start?: unknown }).start
    return typeof start === 'string' && start ? start : null
  }
  return null
}

const isTaskRow = (block: Pick<Block, 'type' | 'parentId'> | null): boolean => !!block && block.type === 'page' && block.parentId === TASKS_DATABASE_ID

/** Before a write: the `Completed at` of each row of the Tasks database that `ops` update. */
export function completionsBefore(ops: readonly Op[], get: Lookup): Map<string, string | null> {
  const before = new Map<string, string | null>()
  for (const op of ops) {
    if (op.op !== 'update' || before.has(op.id)) continue
    const block = get(op.id)
    if (block && isTaskRow(block)) before.set(op.id, completedAtOf(block))
  }
  return before
}

/**
 * After it: how many of those rows were completed (a later `Completed at`: done, or a repeating
 * task moved on) and how many completions were taken back (none, or an earlier one again).
 */
export function completionChanges(before: ReadonlyMap<string, string | null>, get: Lookup): { completed: number; uncompleted: number } {
  let completed = 0
  let uncompleted = 0
  for (const [id, was] of before) {
    const block = get(id)
    const now = block && isTaskRow(block) ? completedAtOf(block) : null
    if (now !== null && (was === null || now > was)) completed++
    else if (was !== null && (now === null || now < was)) uncompleted++
  }
  return { completed, uncompleted }
}
