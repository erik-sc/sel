// Carrying out a proposal the user accepted: the blocks it names are fetched, the ops are
// planned (./actions.ts) and committed as one batch, and the sidebar is told.
import type { HermanAction } from '@shared/actions'
import { sourceIdOf } from '@shared/linked'
import { logError } from '@/shell/actions'
import { applyOps, getBlock, newId, refreshBlocks } from '@/store/blocks'
import { refreshTree } from '@/store/tree'
import { setExpanded } from '@/store/ui'
import { actionTargets, planActions, type ActionPlan } from './actions'

export async function applyActions(actions: readonly HermanAction[], currentPageId: string | null): Promise<ActionPlan> {
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
  if (!plan.ops.length) return plan
  await applyOps(plan.ops)
  // Where pages were moved from or trashed out of: the backend decided what those pages now hold.
  if (plan.refresh.length) await refreshBlocks(plan.refresh).catch(logError('refresh'))
  for (const parent of plan.parents) if (parent) setExpanded(parent, true)
  await refreshTree().catch(logError('tree refresh'))
  return plan
}
