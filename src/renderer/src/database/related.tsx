// The store side of relations, rollups and formulas: the databases a schema relates to are
// loaded, pinned and watched while a view of it is on screen, and handed to the cells below
// as a `CellContext` that changes whenever any of them (or their rows) does. Formulas read
// their own database's schema through it too.
import { createContext, useContext, useEffect, useMemo } from 'react'
import type { Block } from '@shared/types'
import { type BlockState, fetchBlocks, getBlock, pinTree, refreshBlocks, loadChildren, useBlockStore, watchSelector } from '@/store/blocks'
import * as L from './logic'

export interface RelatedValue {
  /** What relation, rollup and formula cells read; undefined when the schema has none of them. */
  cells: L.CellContext | undefined
  /** Opens a linked row (as a page). */
  openPage?: (id: string, opts?: { newTab?: boolean }) => void
}

export const RelatedContext = createContext<RelatedValue>({ cells: undefined })

export function useRelated(): RelatedValue {
  return useContext(RelatedContext)
}

function own<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined
}

/** Ancestor walks stop here, like the ones of the relation logic. */
const MAX_DEPTH = 100

/**
 * A store selector whose result changes whenever something the cell context of `targets`
 * reads does: a related database, its rows, the pages above it, or whether it is missing.
 */
export function relatedWatcher(targets: readonly string[]): (state: BlockState) => unknown {
  return watchSelector((read) => {
    const out: unknown[] = []
    for (const id of targets) {
      const db = read.get(id)
      out.push(db, read.isMissing(id))
      for (const rowId of L.contentOf(db)) out.push(read.get(rowId))
      let cursor: Block | undefined = read.get(db?.parentId)
      for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
        out.push(cursor)
        cursor = read.get(cursor.parentId)
      }
    }
    return out
  })
}

/**
 * The cell context of a schema's relations. While the caller is mounted, every related
 * database is loaded with its rows and the pages above it (to tell when it is in the
 * trash), and kept in the cache. The returned object is new whenever one of those blocks
 * changes, in this window or another, so memoised queries and cells recompute.
 */
export function useRelatedCells(schema: L.Schema): L.CellContext | undefined {
  const targets = useMemo(() => L.relationTargets(schema), [schema])
  const formulas = useMemo(() => L.hasFormulas(schema), [schema])
  const key = targets.join(' ')

  useEffect(() => {
    if (!key) return
    const ids = key.split(' ')
    const unpin = ids.map((id) => pinTree(id, false))
    // `refreshBlocks` also marks the ones that no longer exist as missing.
    refreshBlocks(ids).catch((error) => console.error('database: loading related databases failed', error))
    for (const id of ids) {
      loadChildren(id).catch((error) => console.error('database: loading related rows failed', error))
      fetchBlocks(() => window.api.pages.ancestors(id)).catch((error) => console.error('database: loading a related path failed', error))
    }
    return () => unpin.forEach((release) => release())
  }, [key])

  const watched = useBlockStore(useMemo(() => relatedWatcher(targets), [targets]))

  return useMemo(
    () =>
      targets.length || formulas
        ? L.cellContext({ get: (id) => getBlock(id), isMissing: (id) => own(useBlockStore.getState().missing, id) === true })
        : undefined,
    // `watched` is what the context reads: a new one stands for new data.
    [targets, formulas, watched]
  )
}
