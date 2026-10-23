import { modernizeUrls } from '../../shared/legacy'
import { sourceIdOf } from '../../shared/linked'
import type { Block } from '../../shared/types'
import { B_COLS, isPageLike, toBlock, type Row } from '../db/blocks'
import type { SqlDriver } from '../db/driver'
import type { BackupPage } from '../db/repository'
import { subtreeSql, walk } from '../db/tree'
import { buildSnapshot, withRows } from '../db/versions'

/**
 * One page out of a backup, for `Repository.restoreFromBackup`: what the page was in the backup,
 * in the shape of a version (see db/versions.ts buildSnapshot), and where it was. Read with plain
 * SQL on the backup's `blocks` table, opened read-only, so that a backup made by an earlier sel
 * is read without being migrated. Free of Electron.
 */

/** Thrown when the page is not in the backup, or is in the backup's Trash. */
export class NotInBackup extends Error {
  constructor() {
    super('That page is not in the backup')
  }
}

/**
 * The pages to restore, the chosen one first and the others below their parents:
 * - `withSubpages`: every page and database below it too, each made equal to the backup.
 * - otherwise the page alone; for a database, also its rows that no longer exist (they are what
 *   the database is made of), which come back only when they are missing.
 */
export function readBackupPages(backup: SqlDriver, pageId: string, withSubpages: boolean): BackupPage[] {
  const nodes = new Map<string, Block>()
  for (const row of backup.prepare(subtreeSql(B_COLS)).all(pageId, 0) as Row[]) {
    nodes.set(row.id, toBlock({ ...row, props: modernizeUrls(String(row.props)) }))
  }
  const root = nodes.get(pageId)
  if (!root || !isPageLike(root.type) || sourceIdOf(root) !== null || !isLive(backup, root)) throw new NotInBackup()
  const load = (ids: string[]): Block[] => ids.flatMap((id) => nodes.get(id) ?? [])

  const pages: BackupPage[] = []
  const queue: { block: Block; mode: BackupPage['mode'] }[] = [{ block: root, mode: 'replace' }]
  const seen = new Set<string>()
  while (queue.length) {
    const { block, mode } = queue.shift() as { block: Block; mode: BackupPage['mode'] }
    if (seen.has(block.id)) continue
    seen.add(block.id)
    const tree = walk(block, nodes, load)
    const snapshot = buildSnapshot(tree)
    if (!snapshot) continue
    pages.push({ snapshot: withRows(snapshot, load), parentId: block.parentId, mode })
    const ownsRows = block.type === 'database' && sourceIdOf(block) === null
    for (const below of tree.slice(1)) {
      if (!isPageLike(below.type) || sourceIdOf(below) !== null) continue
      if (withSubpages && mode === 'replace') queue.push({ block: below, mode: 'replace' })
      // The rows of the chosen database come back when they are gone; their content is theirs.
      else if (ownsRows && block.id === pageId && below.parentId === block.id) queue.push({ block: below, mode: 'missing' })
    }
  }
  return pages
}

/** False when the block, or one of the blocks above it, is in the backup's Trash. */
function isLive(db: SqlDriver, block: Block): boolean {
  if (block.trashedAt !== null) return false
  const seen = new Set<string>([block.id])
  let parent = block.parentId
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent)
    const row = db.prepare('SELECT parent_id, trashed_at FROM blocks WHERE id = ?').get(parent) as
      | { parent_id: string | null; trashed_at: number | null }
      | undefined
    if (!row || row.trashed_at !== null) return false
    parent = row.parent_id
  }
  return true
}
