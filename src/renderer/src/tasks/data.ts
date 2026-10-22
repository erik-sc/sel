// The built-in Tasks database as the Tasks screen and the task panel read it: its schema, its
// views and its rows, kept current while the caller is mounted (database/resolved.ts loads the
// rows and keeps them in the cache).
import { useMemo } from 'react'
import type { Block, DatabaseView } from '@shared/types'
import { TASKS_DATABASE_ID } from '@shared/tasks'
import { useBlocks } from '@/store/blocks'
import * as L from '@/database/logic'
import { useResolvedDatabase } from '@/database/resolved'

const EMPTY: string[] = []

export function useTasksDatabase(): {
  resolved: L.ResolvedDatabase | undefined
  schema: L.Schema
  views: DatabaseView[]
  rows: Block[]
} {
  const resolved = useResolvedDatabase(TASKS_DATABASE_ID, false)
  const db = resolved?.view
  const { schema, views } = useMemo(() => L.normalizeResolved(resolved), [resolved])
  const rawContent: unknown = db?.content
  const rowIds = useMemo(() => {
    const ids = Array.isArray(rawContent) ? rawContent.filter((id): id is string => typeof id === 'string') : EMPTY
    return ids.length ? ids : EMPTY
  }, [rawContent])
  const rowBlocks = useBlocks(rowIds)
  const rows = useMemo(
    () => rowBlocks.filter((b): b is Block => !!b && b.type === 'page' && !b.trashedAt && b.parentId === TASKS_DATABASE_ID),
    [rowBlocks]
  )
  return { resolved, schema, views, rows }
}
