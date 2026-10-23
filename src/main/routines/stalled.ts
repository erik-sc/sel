import type { ActivityRow } from '../../shared/activity'
import { plainText } from '../../shared/richtext'
import { TASK_PROPS } from '../../shared/tasks'
import type { Block } from '../../shared/types'

/**
 * A task that is stuck (C3): put off again and again (the local activity log keeps a
 * `task.postponed` row, with the task's id, each time its due day moves later), or open and
 * untouched for long. Pure: rows of the Tasks database and of the log in, one task out.
 */

/** Put off this many times within `POSTPONE_SPAN_DAYS` days. */
export const POSTPONED_TIMES = 3
export const POSTPONE_SPAN_DAYS = 30
/** Open and unchanged for this many days (and at least that old). */
export const UNTOUCHED_DAYS = 14

const DAY = 86_400_000

export interface StalledTask {
  id: string
  title: string
  /** Times it was put off lately. */
  postponed: number
  /** Whole days since it last changed. */
  untouchedDays: number
  /** Days since it was made. */
  ageDays: number
  /** The project option id, or null. */
  project: string | null
  due: string | null
}

/** How often each task was put off, from the log's rows. */
export function postponements(rows: readonly ActivityRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) if (row.kind === 'task.postponed' && row.pageId) out.set(row.pageId, (out.get(row.pageId) ?? 0) + 1)
  return out
}

function values(row: Block): Record<string, unknown> {
  const raw = row.props.values
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function dueOf(value: unknown): string | null {
  if (typeof value === 'string' && value) return value.slice(0, 10)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const start = (value as { start?: unknown }).start
    return typeof start === 'string' && start ? start.slice(0, 10) : null
  }
  return null
}

/**
 * The most stuck task, or null. Left out: done, trashed or private tasks, subtasks (their parent
 * is the one to unstick), repeating tasks (they move on by themselves), and those in `skip`
 * (offered lately). The most postponed comes first; then the longest untouched.
 */
export function findStalled(
  rows: readonly Block[],
  log: readonly ActivityRow[],
  now: number,
  options: { skip?: ReadonlySet<string>; hidden?: (id: string) => boolean } = {}
): StalledTask | null {
  const counts = postponements(log)
  let best: StalledTask | null = null
  const rank = (task: StalledTask): number[] => [task.postponed >= POSTPONED_TIMES ? 1 : 0, task.postponed, task.untouchedDays]
  const better = (a: StalledTask, b: StalledTask): boolean => {
    const [x, y] = [rank(a), rank(b)]
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]
    return false
  }
  for (const row of rows) {
    if (row.trashedAt || row.type !== 'page') continue
    if (options.skip?.has(row.id) || options.hidden?.(row.id)) continue
    const own = values(row)
    if (own[TASK_PROPS.done] === true) continue
    if (typeof own[TASK_PROPS.recurrence] === 'string' && own[TASK_PROPS.recurrence]) continue
    const parent = own[TASK_PROPS.parent]
    if (Array.isArray(parent) && parent.length) continue
    const title = plainText(row.props.title).replace(/\s+/g, ' ').trim()
    if (!title) continue
    const postponed = counts.get(row.id) ?? 0
    const untouchedDays = Math.floor((now - row.updatedAt) / DAY)
    const ageDays = Math.floor((now - row.createdAt) / DAY)
    const stuck = postponed >= POSTPONED_TIMES || (untouchedDays >= UNTOUCHED_DAYS && ageDays >= UNTOUCHED_DAYS)
    if (!stuck) continue
    const project = own[TASK_PROPS.project]
    const task: StalledTask = {
      id: row.id,
      title: title.slice(0, 200),
      postponed,
      untouchedDays,
      ageDays,
      project: typeof project === 'string' && project ? project : null,
      due: dueOf(own[TASK_PROPS.due])
    }
    if (!best || better(task, best)) best = task
  }
  return best
}
