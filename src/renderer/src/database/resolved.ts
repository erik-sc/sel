// The store side of linked views: loading, pinning and subscribing to the source of
// whatever database is on screen. The rules themselves live in logic/resolve.ts.
import { useEffect, useMemo } from 'react'
import { shallow } from 'zustand/shallow'
import type { Block } from '@shared/types'
import { type BlockState, fetchBlocks, loadChildren, useBlock, useBlockStore, useTreePin } from '@/store/blocks'
import * as L from './logic'

interface SourceState {
  source: Block | null
  status: L.DatabaseStatus
  trashedId: string | null
}

const UNRESOLVED: SourceState = { source: null, status: 'loading', trashedId: null }

function own<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined
}

/** A store selector for what `block` (a database or a linked view) shows: the same object while that stays the same. */
export function sourceSelector(block: Block | undefined): (store: BlockState) => SourceState {
  let prev: SourceState | undefined
  return (store) => {
    if (!block) return UNRESOLVED
    const resolved = L.resolveDatabase(block, {
      get: (id) => own(store.blocks, id),
      isMissing: (id) => own(store.missing, id) === true
    })
    const next = { source: resolved.source, status: resolved.status, trashedId: resolved.trashedId }
    return prev && shallow(prev, next) ? prev : (prev = next)
  }
}

/**
 * The database shown by `databaseId`, resolved against the store and kept current:
 * a change to the view block, to its source, or to the trash state of anything above
 * the source (from this window or another) re-renders the caller.
 *
 * While the calling component is mounted, the view block, its source and the source's
 * rows are loaded and cannot be evicted from the block cache. `remember` keeps the tree
 * among the recently viewed ones afterwards (full-page databases, not inline ones).
 *
 * Returns undefined until the block itself is loaded.
 */
export function useResolvedDatabase(databaseId: string, remember: boolean): L.ResolvedDatabase | undefined {
  const block = useBlock(databaseId)
  const sourceId = L.sourceIdOf(block)
  // Requests the source when it is not cached and holds it for as long as this view is mounted.
  useBlock(sourceId)
  // The actions read the database and its rows synchronously: keep both trees while shown.
  useTreePin(databaseId, remember)
  useTreePin(sourceId, false)

  const rowsOwnerId = sourceId ?? databaseId
  useEffect(() => {
    loadChildren(rowsOwnerId).catch((error) => console.error('database: loading rows failed', error))
  }, [rowsOwnerId])

  // A source inside a trashed page is in the trash too: its ancestors must be known to tell.
  useEffect(() => {
    if (!sourceId) return
    fetchBlocks(() => window.api.pages.ancestors(sourceId)).catch((error) =>
      console.error('database: loading the source path failed', error)
    )
  }, [sourceId])

  const state = useBlockStore(useMemo(() => sourceSelector(block), [block]))

  return useMemo(
    () =>
      block
        ? {
            view: block,
            source: state.source,
            status: state.status,
            linked: sourceId !== null,
            sourceId,
            trashedId: state.trashedId
          }
        : undefined,
    [block, sourceId, state.source, state.status, state.trashedId]
  )
}
