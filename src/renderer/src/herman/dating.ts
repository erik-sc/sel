// "Date the N": Herman's one verb that changes data. It can be used before the Tasks rows are in
// the renderer store, so the rows and the database are fetched first, and a task that meanwhile got
// a date, was completed or is gone is left alone: nothing already dated is overwritten.
import type { Block } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import type { QuickDate } from '@shared/tasks/dates'
import { fetchBlocks, getBlock } from '@/store/blocks'
import { useHome } from '@/home/store'
import { notifyError, toast } from '@/ui/toast'
import { TASK_COPY } from '@/tasks/copy'

/** The tasks that are still open, undated and in the Tasks database, in order. */
export function undatedTasks(ids: readonly string[], rowOf: (id: string) => Block | undefined): string[] {
  return ids.filter((id) => {
    const row = rowOf(id)
    if (!row || row.trashedAt || row.parentId !== TASKS_DATABASE_ID) return false
    const values = (row.props.values ?? {}) as Record<string, unknown>
    const due = values[TASK_PROPS.due]
    return values[TASK_PROPS.done] !== true && (due === undefined || due === null || due === '')
  })
}

export async function dateTasks(ids: readonly string[], day: QuickDate): Promise<void> {
  try {
    await fetchBlocks(() => window.api.blocks.getMany([TASKS_DATABASE_ID, ...ids]))
  } catch (error) {
    notifyError(TASK_COPY[useHome.getState().locale].saveFailed, error)
    return
  }
  const open = getBlock(TASKS_DATABASE_ID) ? undatedTasks(ids, getBlock) : []
  if (!open.length) {
    toast(TASK_COPY[useHome.getState().locale].nothingToDate, { kind: 'info' })
    return
  }
  const { setDateMany } = await import('@/tasks/bulk')
  setDateMany(open, day)
}
