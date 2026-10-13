import { useEffect } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Block, Op } from '@shared/types'
import { sourceIdOf } from '../../../shared/linked'
import { applyOpsToMap, type BlockMap } from './ops'

/*
 * The block cache.
 *
 * Eviction. `getBlock()` is a synchronous read that the editor, the database views and the
 * sidebar tree rely on for anything loaded earlier (ancestor walks, drag & drop, "is this
 * page gone?"), so a block may only leave the cache when nothing on screen can ask for it.
 * `sweepCache()` is a mark-and-sweep over what is provably in use:
 *   - every id a mounted component reads through `useBlock` / `useBlocks` (reference counted);
 *   - the whole tree of every page or database that is open (`pinTree`, `useTreePin`);
 *   - whatever other stores declare as roots (`addCacheRoots`: open tabs, the sidebar tree);
 *   - the trees of the pages viewed most recently, so that going back to them is instant;
 *   - the ancestors of all of the above;
 *   - the source database of every linked view kept for one of these reasons, with its rows
 *     when that view is on screen: a linked view shows another database's schema and rows;
 *   - anything written or fetched in the last `GRACE_MS`, and anything with a write in flight.
 * Everything else is dropped. A dropped block is simply fetched again by the next hook that
 * asks for it; nothing is lost, the database is the source of truth.
 *
 * Consistency. Three things write to the cache and can interleave:
 *   1. optimistic writes (`applyOps`), reconciled with what the backend returns;
 *   2. reads (`loadTree`, `refreshBlocks`, lazy loads, the sidebar lists…);
 *   3. refetches triggered by change events.
 * A read never overwrites a block that has an optimistic write in flight (`pending`), nor one
 * that was written locally after the read was issued (`lastWrite`), because its answer may
 * predate that write. A reconcile never overwrites a block that a later write touched.
 */

interface BlockState {
  blocks: BlockMap
  /** Ids that were requested and do not exist in the database. */
  missing: Record<string, true>
}

export const useBlockStore = create<BlockState>(() => ({ blocks: {}, missing: {} }))

/** How long after a write its own change event may still arrive (and needs no refetch). */
const OWN_ECHO_MS = 2000

export function newId(): string {
  return crypto.randomUUID()
}

/** Own-property lookup: ids come from settings and urls too, and `constructor` is not a block. */
function lookup<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined
}

export function getBlock(id: string | null | undefined): Block | undefined {
  return id ? lookup(useBlockStore.getState().blocks, id) : undefined
}

/** Merge blocks fetched from the backend into the cache. */
export function putBlocks(list: Block[]): void {
  if (!list.length) return
  touch(list.map((block) => block.id))
  noteGrowth(list.length)
  useBlockStore.setState((state) => {
    const blocks = { ...state.blocks }
    let missing = state.missing
    for (const block of list) {
      blocks[block.id] = block
      if (lookup(missing, block.id)) {
        if (missing === state.missing) missing = { ...missing }
        delete missing[block.id]
      }
    }
    return { blocks, missing }
  })
}

function dropBlocks(ids: string[]): void {
  if (!ids.length) return
  for (const id of ids) touched.delete(id)
  useBlockStore.setState((state) => {
    const blocks = { ...state.blocks }
    const missing = { ...state.missing }
    for (const id of ids) {
      delete blocks[id]
      missing[id] = true
    }
    return { blocks, missing }
  })
}

// ---- bookkeeping for writes and reads in flight ----

/** Number of optimistic writes in flight per block id. */
const pending = new Map<string, number>()
/** Ids recently written through applyOps; their own-origin change events need no refetch. */
const recentOwn = new Map<string, number>()
/** Sequence number of the latest applyOps that touched each id. */
const lastWrite = new Map<string, number>()
let writeSeq = 0
let openReads = 0

function bump(counter: Map<string, number>, ids: string[], delta: number): void {
  for (const id of ids) {
    const value = (counter.get(id) ?? 0) + delta
    if (value <= 0) counter.delete(id)
    else counter.set(id, value)
  }
}

/** Forgets write sequence numbers nobody can still be compared against. */
function pruneWrites(): void {
  if (openReads > 0) return
  for (const id of lastWrite.keys()) {
    if (!pending.has(id)) lastWrite.delete(id)
  }
}

interface ReadGuard {
  /** False for a block whose fetched copy may be older than what the cache holds. */
  accepts(id: string): boolean
  done(): void
}

function beginRead(): ReadGuard {
  const issuedAt = writeSeq
  let open = true
  openReads += 1
  return {
    accepts: (id) => !pending.has(id) && (lastWrite.get(id) ?? 0) <= issuedAt,
    done: () => {
      if (!open) return
      open = false
      openReads -= 1
      pruneWrites()
    }
  }
}

/**
 * Runs a backend read and merges the blocks it returns into the cache, leaving alone any
 * block that was written locally since the read was issued. Prefer this to `putBlocks` for
 * anything fetched asynchronously.
 */
export async function fetchBlocks(read: () => Promise<Block[]>): Promise<Block[]> {
  const guard = beginRead()
  try {
    const blocks = await read()
    putBlocks(blocks.filter((b) => guard.accepts(b.id)))
    return blocks
  } finally {
    guard.done()
  }
}

/** Refetch blocks from the backend; ids that no longer exist are dropped from the cache. */
export async function refreshBlocks(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)]
  if (!unique.length) return
  const guard = beginRead()
  try {
    const found = await window.api.blocks.getMany(unique)
    putBlocks(found.filter((b) => guard.accepts(b.id)))
    const foundIds = new Set(found.map((b) => b.id))
    dropBlocks(unique.filter((id) => !foundIds.has(id) && guard.accepts(id)))
  } finally {
    guard.done()
  }
}

// ---- lazy loading (batched per microtask) ----

const queued = new Set<string>()
const inflight = new Set<string>()
let flushScheduled = false

function requestBlock(id: string): void {
  const state = useBlockStore.getState()
  if (lookup(state.blocks, id) || lookup(state.missing, id) || inflight.has(id) || queued.has(id)) return
  queued.add(id)
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    const ids = [...queued]
    queued.clear()
    for (const q of ids) inflight.add(q)
    const guard = beginRead()
    window.api.blocks
      .getMany(ids)
      .then((found) => {
        const foundIds = new Set(found.map((b) => b.id))
        // Never overwrite something that arrived (or was written optimistically) meanwhile.
        const current = useBlockStore.getState().blocks
        putBlocks(found.filter((b) => !lookup(current, b.id) && guard.accepts(b.id)))
        dropBlocks(ids.filter((q) => !foundIds.has(q) && !lookup(current, q) && guard.accepts(q)))
      })
      // Not marked missing: the next component that asks for these ids retries.
      .catch((error) => console.error('blocks.getMany failed', error))
      .finally(() => {
        guard.done()
        for (const q of ids) inflight.delete(q)
      })
  })
}

export function useBlock(id: string | null | undefined): Block | undefined {
  const block = useBlockStore((state) => (id ? lookup(state.blocks, id) : undefined))
  useEffect(() => {
    if (id && !block) requestBlock(id)
  }, [id, block])
  // While this component is mounted the block cannot be evicted.
  useEffect(() => (id ? retainBlocks([id]) : undefined), [id])
  return block
}

export function useBlocks(ids: string[]): (Block | undefined)[] {
  const blocks = useBlockStore(useShallow((state) => ids.map((id) => lookup(state.blocks, id))))
  useEffect(() => {
    blocks.forEach((block, index) => {
      if (!block && ids[index]) requestBlock(ids[index])
    })
  }, [blocks, ids])
  useEffect(() => retainBlocks(ids), [ids])
  return blocks
}

/**
 * Keeps the whole tree under `rootId` in the cache while the calling component is mounted.
 * `remember: false` for trees embedded in another one (an inline database): they are not
 * worth a slot among the recently viewed pages.
 */
export function useTreePin(rootId: string | null | undefined, remember = true): void {
  useEffect(() => (rootId ? pinTree(rootId, remember) : undefined), [rootId, remember])
}

export type BlockStatus = 'loading' | 'ready' | 'missing'

/** Distinguishes "not loaded yet" from "does not exist". */
export function useBlockStatus(id: string | null | undefined): BlockStatus {
  return useBlockStore((state) => {
    if (!id) return 'missing'
    if (lookup(state.blocks, id)) return 'ready'
    return lookup(state.missing, id) ? 'missing' : 'loading'
  })
}

export async function loadTree(rootId: string): Promise<void> {
  await fetchBlocks(() => window.api.blocks.getTree(rootId))
}

/** A prefetched tree is handed to the view that asked for it only this long after it was requested. */
const PREFETCH_TTL_MS = 3_000
const prefetched = new Map<string, { at: number; load: Promise<void> }>()

/**
 * Starts loading a page's tree before the view that will show it exists (at start-up the
 * editor's code is still being fetched), so the two waits overlap instead of adding up.
 */
export function prefetchTree(rootId: string): void {
  const load = loadTree(rootId)
  // The view reports a failure when it takes the load over; unclaimed, it only matters to the log.
  load.catch((error) => console.error('prefetch failed', error))
  prefetched.set(rootId, { at: Date.now(), load })
  setTimeout(() => {
    if (prefetched.get(rootId)?.load === load) prefetched.delete(rootId)
  }, PREFETCH_TTL_MS)
}

/** The load started by `prefetchTree` for this page, if it is recent enough to stand in for a new one. */
export function takePrefetchedTree(rootId: string): Promise<void> | null {
  const entry = prefetched.get(rootId)
  if (!entry) return null
  prefetched.delete(rootId)
  return Date.now() - entry.at <= PREFETCH_TTL_MS ? entry.load : null
}

export async function loadChildren(id: string): Promise<void> {
  await fetchBlocks(() => window.api.blocks.children(id))
}

/** Last resort after a failed write whose refetch failed too: put back what was there before. */
function restoreSnapshot(before: BlockMap, ids: string[]): void {
  useBlockStore.setState((state) => {
    const blocks = { ...state.blocks }
    for (const id of ids) {
      if (pending.has(id)) continue
      const previous = lookup(before, id)
      if (previous) blocks[id] = previous
      else delete blocks[id]
    }
    return { blocks }
  })
}

/**
 * Applies ops optimistically to the cache, persists them, then reconciles with the
 * blocks returned by the backend. On failure the affected blocks are refetched (or, when
 * even that fails, put back as they were) and the error is rethrown.
 */
export async function applyOps(ops: Op[]): Promise<Block[]> {
  if (!ops.length) return []
  const before = useBlockStore.getState().blocks
  const result = applyOpsToMap(before, ops)
  const written = [...result.affected, ...result.removed]
  const seq = ++writeSeq
  for (const id of written) lastWrite.set(id, seq)
  touch(result.affected)
  for (const id of result.removed) forget(id)
  noteGrowth(result.affected.length)
  useBlockStore.setState((state) => {
    // A block created here exists, whatever an earlier lookup concluded.
    let missing = state.missing
    for (const id of result.affected) {
      if (!lookup(missing, id)) continue
      if (missing === state.missing) missing = { ...missing }
      delete missing[id]
    }
    return { blocks: result.map, missing }
  })
  bump(pending, written, 1)
  bump(recentOwn, written, 1)
  try {
    const returned = await window.api.blocks.apply(ops)
    bump(pending, written, -1)
    // Blocks with newer optimistic writes keep their local version: still in flight, they
    // reconcile themselves; already settled (replies out of order), they are refetched.
    const superseded = returned.filter((b) => !pending.has(b.id) && (lastWrite.get(b.id) ?? 0) > seq)
    putBlocks(returned.filter((b) => !pending.has(b.id) && (lastWrite.get(b.id) ?? 0) <= seq))
    if (superseded.length) {
      refreshBlocks(superseded.map((b) => b.id)).catch((error) => console.error('refresh after write failed', error))
    }
    return returned
  } catch (error) {
    bump(pending, written, -1)
    await refreshBlocks(written).catch(() => restoreSnapshot(before, written))
    throw error
  } finally {
    pruneWrites()
    setTimeout(() => bump(recentOwn, written, -1), OWN_ECHO_MS)
  }
}

// ---- eviction (see the note at the top) ----

/** Blocks fetched or written this recently are never evicted: some async flow may be about to use them. */
export const GRACE_MS = 30_000
/** Trees of this many recently viewed pages are kept so that going back to them needs no fetch. */
export const RECENT_TREES = 8
/** Above this many cached blocks, only what is on screen keeps its tree (recent and background trees go). */
export const CACHE_SOFT_LIMIT = 20_000
/** A sweep is scheduled once the cache grew by this many blocks since the last one. */
const SWEEP_GROWTH = 2_000
/** Sweeps are batched: a burst of triggers (closing several tabs) costs one pass. */
const SWEEP_DELAY_MS = 4_000

/** When each cached block was last fetched or written. */
const touched = new Map<string, number>()
/** Number of mounted `useBlock` / `useBlocks` readers per id. */
const retained = new Map<string, number>()
/** Number of open views per tree root (`pinTree`). */
const pinnedTrees = new Map<string, number>()
/** Roots of recently viewed trees, most recent last. */
let recentTrees: string[] = []

export interface CacheRoots {
  /** Blocks to keep, with their ancestors. */
  ids?: Iterable<string>
  /** Pages / databases to keep with their whole tree (subject to `CACHE_SOFT_LIMIT`). */
  trees?: Iterable<string>
}

const rootProviders = new Set<() => CacheRoots>()

/** Declares blocks that must survive eviction (open tabs, the sidebar tree…). Returns an unregister function. */
export function addCacheRoots(provider: () => CacheRoots): () => void {
  rootProviders.add(provider)
  return () => rootProviders.delete(provider)
}

function touch(ids: string[], now: number = Date.now()): void {
  for (const id of ids) touched.set(id, now)
}

function forget(id: string): void {
  touched.delete(id)
}

/**
 * Protects blocks from eviction until the returned function is called. This is what
 * `useBlock` / `useBlocks` do for as long as their component is mounted.
 */
export function retainBlocks(ids: readonly string[]): () => void {
  const held = [...ids]
  for (const id of held) retained.set(id, (retained.get(id) ?? 0) + 1)
  let active = true
  return () => {
    if (!active) return
    active = false
    for (const id of held) {
      const count = (retained.get(id) ?? 0) - 1
      if (count <= 0) retained.delete(id)
      else retained.set(id, count)
    }
  }
}

/**
 * Keeps `rootId` and everything under it in the cache until the returned function is called.
 * With `remember`, the tree stays among the recently viewed ones afterwards.
 */
export function pinTree(rootId: string, remember = true): () => void {
  pinnedTrees.set(rootId, (pinnedTrees.get(rootId) ?? 0) + 1)
  if (remember) recentTrees = [...recentTrees.filter((id) => id !== rootId), rootId].slice(-RECENT_TREES)
  let pinned = true
  return () => {
    if (!pinned) return
    pinned = false
    const count = (pinnedTrees.get(rootId) ?? 0) - 1
    if (count <= 0) pinnedTrees.delete(rootId)
    else pinnedTrees.set(rootId, count)
    scheduleSweep()
  }
}

/**
 * True when the page (or database) and every block under it are in the cache, i.e. when it can
 * be shown at once and merely refreshed in the background.
 */
export function isTreeCached(rootId: string): boolean {
  const { blocks } = useBlockStore.getState()
  const root = lookup(blocks, rootId)
  if (!root) return false
  const stack = [...root.content]
  const seen = new Set<string>([rootId])
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const block = lookup(blocks, id)
    if (!block) return false
    // Like `blocks.getTree`: nested pages and databases belong to the tree, their contents do not.
    if (block.type !== 'page' && block.type !== 'database') stack.push(...block.content)
  }
  return true
}

function collectKeep(blocks: BlockMap, now: number, withBackgroundTrees: boolean): Set<string> {
  const keep = new Set<string>()
  const addWithAncestors = (id: string): void => {
    let cursor: string | null = id
    while (cursor && !keep.has(cursor)) {
      keep.add(cursor)
      cursor = lookup(blocks, cursor)?.parentId ?? null
    }
  }
  // Tracked apart from `keep`: a block kept for another reason (as somebody's ancestor, say)
  // has not had its own children visited yet.
  const walkedRoots = new Set<string>()
  const walked = new Set<string>()
  // Linked views that are on screen: read by a mounted component, or part of an open tree.
  const shown = new Set<string>()
  const addTree = (rootId: string, onScreen = false): void => {
    if (onScreen) shown.add(rootId)
    addWithAncestors(rootId)
    const root = lookup(blocks, rootId)
    if (!root || walkedRoots.has(rootId)) return
    walkedRoots.add(rootId)
    const stack = [...root.content]
    while (stack.length) {
      const id = stack.pop()!
      if (walked.has(id)) continue
      walked.add(id)
      keep.add(id)
      if (onScreen) shown.add(id)
      const block = lookup(blocks, id)
      // Like `blocks.getTree`: nested pages and databases belong to the tree, their contents do not.
      if (block && block.type !== 'page' && block.type !== 'database') stack.push(...block.content)
    }
  }

  for (const id of pinnedTrees.keys()) addTree(id, true)
  for (const provider of rootProviders) {
    const roots = provider()
    for (const id of roots.trees ?? []) {
      if (withBackgroundTrees) addTree(id)
      else addWithAncestors(id)
    }
    for (const id of roots.ids ?? []) addWithAncestors(id)
  }
  if (withBackgroundTrees) for (const id of recentTrees) addTree(id)
  for (const id of retained.keys()) {
    shown.add(id)
    addWithAncestors(id)
  }
  for (const id of pending.keys()) addWithAncestors(id)
  for (const id of recentOwn.keys()) addWithAncestors(id)
  for (const id of lastWrite.keys()) addWithAncestors(id)
  for (const id of queued) keep.add(id)
  for (const id of inflight) keep.add(id)
  for (const [id, at] of touched) {
    if (now - at < GRACE_MS) addWithAncestors(id)
  }
  // Last, so that it sees everything kept above. A linked view is useless without its source,
  // and one that is on screen reads the source's rows synchronously (cells, drag & drop).
  // One level is enough: a source is never itself a linked view.
  for (const id of [...keep]) {
    const sourceId = sourceIdOf(lookup(blocks, id))
    if (!sourceId) continue
    if (withBackgroundTrees || shown.has(id)) addTree(sourceId)
    else addWithAncestors(sourceId)
  }
  return keep
}

let cachedAtLastSweep = 0
let grownSinceSweep = 0
let sweepTimer: ReturnType<typeof setTimeout> | null = null

function noteGrowth(count: number): void {
  grownSinceSweep += count
  if (grownSinceSweep >= SWEEP_GROWTH) scheduleSweep()
}

/** Asks for a sweep soon; the pass itself runs once, after the triggers settle. */
export function scheduleSweep(): void {
  if (sweepTimer !== null) return
  sweepTimer = setTimeout(() => {
    sweepTimer = null
    sweepCache()
  }, SWEEP_DELAY_MS)
}

/**
 * Drops every cached block that nothing on screen, no open tab, no recent page and no write
 * or read in flight can still need. Returns how many were dropped.
 */
export function sweepCache(now: number = Date.now()): number {
  const state = useBlockStore.getState()
  const ids = Object.keys(state.blocks)
  let keep = collectKeep(state.blocks, now, true)
  // Too much is being kept alive by pages that are not on screen: let those trees go.
  if (ids.length > CACHE_SOFT_LIMIT && keep.size > CACHE_SOFT_LIMIT) keep = collectKeep(state.blocks, now, false)

  const dropped = ids.filter((id) => !keep.has(id))
  const staleMissing = Object.keys(state.missing).filter((id) => !keep.has(id))
  grownSinceSweep = 0
  cachedAtLastSweep = ids.length - dropped.length
  for (const id of touched.keys()) {
    if (!keep.has(id) || !Object.hasOwn(state.blocks, id)) touched.delete(id)
  }
  if (!dropped.length && !staleMissing.length) return 0

  useBlockStore.setState((current) => {
    // Re-checked against the current map: nothing written since `state` was read is lost.
    const blocks = { ...current.blocks }
    for (const id of dropped) {
      if (current.blocks[id] === state.blocks[id]) delete blocks[id]
    }
    const missing = { ...current.missing }
    for (const id of staleMissing) delete missing[id]
    return { blocks, missing }
  })
  return dropped.length
}

/** Numbers for diagnostics and tests. */
export function cacheStats(): { cached: number; retained: number; pinnedTrees: number; recentTrees: number; afterLastSweep: number } {
  return {
    cached: Object.keys(useBlockStore.getState().blocks).length,
    retained: retained.size,
    pinnedTrees: pinnedTrees.size,
    recentTrees: recentTrees.length,
    afterLastSweep: cachedAtLastSweep
  }
}

/** Test hook: forgets all eviction bookkeeping (not the cache itself). */
export function resetCacheTracking(): void {
  touched.clear()
  retained.clear()
  pinnedTrees.clear()
  rootProviders.clear()
  pending.clear()
  recentOwn.clear()
  lastWrite.clear()
  recentTrees = []
  grownSinceSweep = 0
  cachedAtLastSweep = 0
  if (sweepTimer !== null) clearTimeout(sweepTimer)
  sweepTimer = null
}

// ---- cross-window sync ----

let subscribed = false

function subscribe(): void {
  if (subscribed || typeof window === 'undefined' || !window.api) return
  subscribed = true
  window.api.onChange((event) => {
    if (!event || !Array.isArray(event.ids)) return
    const own = event.origin === window.api.clientId
    const ids = event.ids.filter(
      (id) => typeof id === 'string' && !pending.has(id) && !(own && recentOwn.has(id))
    )
    if (!ids.length) return
    // Foreign changes: refetch everything. Own changes that bypassed applyOps
    // (duplicate, restore, import, direct api calls): same treatment.
    refreshBlocks(ids).catch((error) => console.error('refresh after change failed', error))
  })
}

subscribe()
