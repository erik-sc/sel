import type { Block } from '@shared/types'
import { sourceIdOf } from '@shared/linked'
import { isSystemBlock } from '@shared/system'
import { applyOps, getBlock } from '@/store/blocks'
import { refreshTree } from '@/store/tree'
import { notifyError, toast } from '@/ui/toast'
import { archiveCopy } from './locale'

/** True for a page or database that is archived by itself (see BlockProps.archivedAt). */
export function isArchived(block: Block | null | undefined): boolean {
  return typeof block?.props.archivedAt === 'number'
}

/**
 * Whether the menus offer to archive `block`: a page or database of the tree, outside the
 * Trash. Database rows, linked views and built-in blocks are not archived (the repository
 * refuses them too).
 */
export function canArchive(block: Block | null | undefined): block is Block {
  if (!block || block.trashedAt || (block.type !== 'page' && block.type !== 'database')) return false
  if (isSystemBlock(block) || sourceIdOf(block) !== null) return false
  return !(block.parentId && getBlock(block.parentId)?.type === 'database')
}

async function setArchived(id: string, archivedAt: number | null): Promise<void> {
  await applyOps([{ op: 'update', id, patch: { props: { archivedAt } } }])
  await refreshTree()
}

/** Archives a page where it is: it leaves the sidebar and comes back to the same place when unarchived. */
export async function archivePage(id: string): Promise<void> {
  const copy = archiveCopy()
  try {
    await setArchived(id, Date.now())
  } catch (error) {
    notifyError(copy.couldNotArchive, error)
    return
  }
  toast(copy.archived, { kind: 'success', action: { label: copy.undo, run: () => void unarchivePage(id, { quiet: true }) } })
}

export async function unarchivePage(id: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const copy = archiveCopy()
  try {
    await setArchived(id, null)
  } catch (error) {
    notifyError(copy.couldNotUnarchive, error)
    return
  }
  if (!opts.quiet) toast(copy.unarchived, { kind: 'success' })
}
