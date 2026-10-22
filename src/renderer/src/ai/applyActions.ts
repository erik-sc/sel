// Carrying out a proposal the user accepted: the blocks it names are fetched, the ops are
// planned (./actions.ts) and committed as one batch, and the sidebar is told. What it did can
// be undone: the inverse of the batch is kept for the "Undo" of the toast, and every page it
// touches gets a saved version first, a way back that outlives the toast (page history).
import type { HermanAction } from '@shared/actions'
import { sourceIdOf } from '@shared/linked'
import type { Op } from '@shared/types'
import { invertOps } from '@/editor/ops'
import { logError } from '@/shell/actions'
import { applyOps, getBlock, newId, refreshBlocks } from '@/store/blocks'
import { refreshTree } from '@/store/tree'
import { setExpanded } from '@/store/ui'
import { actionTargets, planActions, type ActionPlan } from './actions'

/** The label of the version saved before Herman changes a page. */
export const BEFORE_HERMAN = 'Before Herman'
/** A proposal that touches more pages than this keeps versions of the first ones only. */
const MAX_VERSIONS = 20

/** What it takes to put things back as they were before an Apply. */
export interface AppliedUndo {
  /** Pages and databases the batch sent to the trash: restored first. */
  restore: string[]
  /** The inverse of the batch, in the order it is applied. */
  inverse: Op[]
}

export interface Applied extends ActionPlan {
  undo: AppliedUndo | null
}

async function saveVersions(ids: readonly string[]): Promise<void> {
  const pages = ids.filter((id) => {
    const type = getBlock(id)?.type
    return type === 'page' || type === 'database'
  })
  for (const id of pages.slice(0, MAX_VERSIONS)) {
    // Without the version the change can still be undone from the toast: it is not a reason to stop.
    await window.api.versions.save(id, BEFORE_HERMAN).catch(logError('save a version before applying'))
  }
}

export async function applyActions(actions: readonly HermanAction[], currentPageId: string | null): Promise<Applied> {
  const targets = actionTargets(actions, currentPageId)
  await refreshBlocks(targets)
  // Rows asked for through a linked view go to its source, which may not be loaded yet.
  const sources = targets.flatMap((id) => {
    const block = getBlock(id)
    const source = block ? sourceIdOf(block) : null
    return source ? [source] : []
  })
  await refreshBlocks(sources)
  const plan = planActions(actions, { currentPageId, get: getBlock, newId })
  if (!plan.ops.length) return { ...plan, undo: null }
  await saveVersions([...targets, ...sources])
  // Taken from the blocks as they are right before the batch, like the editor's history.
  const undo = invertOps(plan.ops, getBlock)
  await applyOps(plan.ops)
  // Where pages were moved from or trashed out of: the backend decided what those pages now hold.
  if (plan.refresh.length) await refreshBlocks(plan.refresh).catch(logError('refresh'))
  for (const parent of plan.parents) if (parent) setExpanded(parent, true)
  await refreshTree().catch(logError('tree refresh'))
  return { ...plan, undo }
}

/** Puts back what an Apply changed: trashed pages come back, then the batch is reversed. */
export async function undoApplied(undo: AppliedUndo): Promise<void> {
  for (const id of undo.restore) await window.api.pages.restore(id)
  if (undo.restore.length) await refreshBlocks(undo.restore)
  if (undo.inverse.length) await applyOps(undo.inverse)
  await refreshTree().catch(logError('tree refresh'))
}
