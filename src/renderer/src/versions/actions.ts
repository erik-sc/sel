// What the version history does to the workspace: restoring, with the notifications that
// report it and the "Undo" that takes it back. Kept apart from the dialog so that the undo
// offered by a toast keeps working after the dialog has closed.
import type { RestoreResult, VersionInfo } from '@shared/versions'
import { getBlock, loadTree, refreshBlocks } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import { refreshTree } from '@/store/tree'
import { notifyError, toast } from '@/ui/toast'
import { stampLabel } from './format'

/** Brings every view of the page up to date after its content was replaced. */
async function reloadPage(pageId: string): Promise<void> {
  await loadTree(pageId)
  await refreshTree().catch((error) => console.error('tree refresh failed', error))
}

function showNotes(result: RestoreResult): void {
  // Two at most: the rest would push the result itself off the screen.
  for (const note of result.notes.slice(0, 2)) toast(note, { duration: 9000 })
}

/** Puts back the state saved just before a restore. */
async function undoRestore(pageId: string, backupId: string): Promise<void> {
  try {
    const result = await window.api.versions.restore(backupId, 'replace')
    await reloadPage(pageId)
    toast('Restore undone.', { kind: 'success' })
    showNotes(result)
  } catch (error) {
    notifyError('Could not undo the restore.', error)
  }
}

/** Replaces the page with a version. Resolves once the page shows it; rejects when the restore failed. */
export async function restoreVersion(version: VersionInfo): Promise<RestoreResult> {
  const result = await window.api.versions.restore(version.id, 'replace')
  await reloadPage(result.pageId).catch((error) => console.error('reload after restore failed', error))
  const { backupId } = result
  toast(`Restored version from ${stampLabel(version.createdAt, Date.now())}`, {
    kind: 'success',
    action: backupId ? { label: 'Undo', run: () => void undoRestore(result.pageId, backupId) } : undefined
  })
  showNotes(result)
  return result
}

/** Creates a page from a version next to the original and opens it. */
export async function restoreVersionAsCopy(version: VersionInfo): Promise<RestoreResult> {
  const result = await window.api.versions.restore(version.id, 'copy')
  await refreshBlocks([result.pageId]).catch((error) => console.error('refresh failed', error))
  const parentId = getBlock(result.pageId)?.parentId
  if (parentId) await refreshBlocks([parentId]).catch((error) => console.error('refresh failed', error))
  await refreshTree().catch((error) => console.error('tree refresh failed', error))
  openPage(result.pageId)
  toast('Restored as a copy.', { kind: 'success' })
  showNotes(result)
  return result
}
