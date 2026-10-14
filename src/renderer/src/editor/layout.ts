// How blocks share the width of a page. Pure.
import type { Block } from '@shared/types'

/** Blocks one row holds before the next one starts a new row. */
export const MAX_BESIDE = 4

type Placed = Pick<Block, 'type' | 'props'>

/** A database block (a chart, a table, calculations) is the only kind that sits in a row with others. */
export function canShareRow(block: Placed | undefined | null): boolean {
  return !!block && block.type === 'database'
}

/** Whether `block` is drawn beside `previous`, the block before it: both may share a row and it asks to. */
export function sitsBeside(block: Placed | undefined | null, previous: Placed | undefined | null): boolean {
  return canShareRow(block) && canShareRow(previous) && block?.props.beside === true
}

/**
 * The blocks of a page in the rows they are drawn in: a block on its own, or a run of
 * database blocks of which every one after the first is marked `beside`.
 */
export function rowsOf<T extends Placed>(blocks: readonly T[]): T[][] {
  const rows: T[][] = []
  for (const block of blocks) {
    const row = rows[rows.length - 1]
    if (row && row.length < MAX_BESIDE && sitsBeside(block, row[row.length - 1])) row.push(block)
    else rows.push([block])
  }
  return rows
}
