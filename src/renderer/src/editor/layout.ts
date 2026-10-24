// How blocks share the width of a page: rows of columns, and the repair that keeps a row whole
// when its blocks move. Pure: no React, no DOM, no store.
import type { Block, Op } from '@shared/types'
import { Overlay, type GetBlock } from './ops'

/** Blocks one row holds before the next one starts a new row. */
export const MAX_BESIDE = 4

type Placed = Pick<Block, 'type' | 'props'>

/** Where a list of blocks sits: `top` when its parent is the page itself (or a database row's page). */
export interface Level {
  top?: boolean
}

/**
 * Whether `block` may sit in a row with others. A database block (a chart, a table,
 * calculations) may at any level; any other block only at the top of a page (`top`), and never a
 * sub-page block.
 */
export function canShareRow(block: Placed | undefined | null, top = false): boolean {
  if (!block) return false
  return block.type === 'database' || (top && block.type !== 'page')
}

/** Whether `block` is drawn beside `previous`, the block before it: both may share a row and it asks to. */
export function sitsBeside(block: Placed | undefined | null, previous: Placed | undefined | null, top = false): boolean {
  return canShareRow(block, top) && canShareRow(previous, top) && block?.props.beside === true
}

/**
 * The blocks of a list in the rows they are drawn in: a block on its own, or a run of blocks
 * that may share a row, of which every one after the first is marked `beside`. Each block of a
 * row is the head of a column, which also holds the head's children.
 */
export function rowsOf<T extends Placed>(blocks: readonly T[], level: Level = {}): T[][] {
  const top = level.top === true
  const rows: T[][] = []
  for (const block of blocks) {
    const row = rows[rows.length - 1]
    if (row && row.length < MAX_BESIDE && sitsBeside(block, row[row.length - 1], top)) row.push(block)
    else rows.push([block])
  }
  return rows
}

/**
 * How wide a row is drawn: a row of 2 blocks keeps the page's text width ('text'); a row of 3
 * or 4, or any row holding a database, takes the database width ('wide'), so its columns fit.
 */
export function rowWidth(row: readonly Placed[]): 'text' | 'wide' {
  return row.length >= 3 || row.some((block) => block.type === 'database') ? 'wide' : 'text'
}

/**
 * What the block menu offers the block `id` among its siblings `blocks`: to leave the row it
 * sits in ('below'), to join the row of the block before it ('beside'), or nothing when it
 * cannot share a row there (not allowed at that level, nothing to sit beside, or that row is full).
 */
export function besideChoice<T extends Placed & { id: string }>(
  blocks: readonly T[],
  id: string,
  level: Level = {}
): 'beside' | 'below' | null {
  const joined = (list: readonly T[]): boolean => {
    const row = rowsOf(list, level).find((candidate) => candidate.some((block) => block.id === id))
    return !!row && row[0].id !== id
  }
  if (joined(blocks)) return 'below'
  const asked = blocks.map((block) => (block.id === id ? { ...block, props: { ...block.props, beside: true } } : block))
  return joined(asked) ? 'beside' : null
}

const isLive = (block: Block | undefined): block is Block => !!block && !block.trashedAt

function liveKids(get: GetBlock, parentId: string): Block[] {
  return (get(parentId)?.content ?? []).map(get).filter(isLive)
}

/**
 * The ops that keep rows whole after `ops`, read against the blocks before them (`get`): each
 * clears `beside` on a block that would otherwise join a row it was not in. A block keeps its
 * `beside` unless the batch moved it or what stood before it, so a flag the batch sets itself
 * (the block menu, a paste, a new row) is never undone here. After the batch, a block marked
 * `beside` loses the mark when
 * - it may no longer share a row where it now is (no longer at the top of the page), or
 * - the block before it changed and the new one was not in its row before (its row's head was
 *   deleted, moved or indented, so it becomes the head; or it was itself moved elsewhere).
 * Batches that only edit text or props return at once, so typing pays nothing.
 */
export function rowRepairOps(ops: readonly Op[], get: GetBlock): Op[] {
  if (ops.every((op) => op.op === 'update' && !op.patch.type)) return []
  const after = new Overlay(get)
  for (const op of ops) after.apply(op)
  const read: GetBlock = (id) => after.get(id)

  // Blocks whose `beside` the batch decides itself, and the lists the batch touches.
  const decided = new Set<string>()
  const parents = new Set<string>()
  const touch = (id: string | null | undefined): void => {
    if (id) parents.add(id)
  }
  for (const op of ops) {
    if (op.op === 'create') {
      if (op.input.id) decided.add(op.input.id)
      touch(op.input.parentId)
    } else if (op.op === 'update') {
      if (op.patch.props && 'beside' in op.patch.props) decided.add(op.id)
      touch(get(op.id)?.parentId)
      touch(read(op.id)?.parentId)
    } else {
      touch(get(op.id)?.parentId)
      if (op.op === 'move') touch(op.parentId)
    }
  }

  // The row each block of a touched list was in before the batch.
  const rowBefore = new Map<string, Block[]>()
  for (const parentId of parents) {
    for (const row of rowsOf(liveKids(get, parentId), { top: get(parentId)?.type === 'page' })) {
      for (const block of row) rowBefore.set(block.id, row)
    }
  }

  const repair: Op[] = []
  for (const parentId of parents) {
    const top = read(parentId)?.type === 'page'
    const kids = liveKids(read, parentId)
    const was = liveKids(get, parentId)
    kids.forEach((block, i) => {
      if (block.props.beside !== true || decided.has(block.id)) return
      let keep: boolean
      if (!canShareRow(block, top)) keep = false
      else {
        const previous = kids[i - 1]?.id ?? null
        const old = get(block.id)
        const at = old?.parentId === parentId ? was.findIndex((b) => b.id === block.id) : -1
        const previousBefore = at < 0 ? undefined : (was[at - 1]?.id ?? null)
        if (previous === previousBefore) keep = true
        else {
          const row = rowBefore.get(block.id)
          keep = !!row && previous !== null && row === rowBefore.get(previous)
        }
      }
      if (!keep) repair.push({ op: 'update', id: block.id, patch: { props: { beside: null } } })
    })
  }
  return repair
}
