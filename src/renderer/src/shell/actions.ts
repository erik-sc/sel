import type { Block } from '@shared/types'
import { plainText, toRichText } from '@shared/richtext'
import { applyOps, getBlock, newId, putBlocks, refreshBlocks } from '@/store/blocks'
import { notifyError, toast } from '@/ui/toast'
import { openPage } from '@/store/tabs'
import { ROOT, loadTreeChildren, refreshTree, useTree } from '@/store/tree'
import { setExpanded } from '@/store/ui'

export function pageTitle(block: Block | undefined | null): string {
  return plainText(block?.props.title) || 'Untitled'
}

/**
 * Handler for a failure the user should hear about: logs the detail and shows
 * "Could not <action>." as a notification.
 */
export function reportError(action: string) {
  return (error: unknown): void => notifyError(`Could not ${action}.`, error)
}

/** Handler for a failed background refresh: the next change event retries, so the console is enough. */
export function logError(action: string) {
  return (error: unknown): void => console.error(`${action} failed`, error)
}

/** Creates an empty page (at the workspace root when parentId is null) and opens it. */
export async function createPage(
  parentId: string | null,
  opts: { open?: boolean; newTab?: boolean } = {}
): Promise<string> {
  const id = newId()
  const done = applyOps([{ op: 'create', input: { id, type: 'page', parentId, props: {} } }])
  if (parentId) setExpanded(parentId, true)
  if (opts.open !== false) openPage(id, { newTab: opts.newTab })
  try {
    await done
  } finally {
    await (parentId ? loadTreeChildren(parentId) : refreshTree()).catch(logError('tree refresh'))
  }
  return id
}

export async function renamePage(id: string, title: string): Promise<void> {
  const block = getBlock(id)
  if (!block || plainText(block.props.title) === title) return
  await applyOps([{ op: 'update', id, patch: { props: { title: toRichText(title) } } }])
}

export async function toggleFavorite(id: string): Promise<void> {
  const block = getBlock(id)
  if (!block) return
  await applyOps([{ op: 'update', id, patch: { props: { favorite: block.props.favorite ? null : true } } }])
  await refreshTree()
}

export async function toggleFullWidth(id: string): Promise<void> {
  const block = getBlock(id)
  if (!block) return
  await applyOps([{ op: 'update', id, patch: { props: { fullWidth: block.props.fullWidth ? null : true } } }])
}

export async function trashPage(id: string): Promise<void> {
  await applyOps([{ op: 'delete', id }])
  // The backend decides what happens to the parent's content; pick that up.
  const parentId = getBlock(id)?.parentId
  await refreshBlocks(parentId ? [id, parentId] : [id]).catch(logError('refresh'))
  await refreshTree()
}

export async function restorePage(id: string): Promise<void> {
  await window.api.pages.restore(id)
  await refreshBlocks([id])
  const parentId = getBlock(id)?.parentId
  if (parentId) await refreshBlocks([parentId]).catch(logError('refresh'))
  await refreshTree()
}

export async function deletePageForever(id: string): Promise<void> {
  const parentId = getBlock(id)?.parentId
  await window.api.pages.deleteForever(id)
  await refreshBlocks(parentId ? [id, parentId] : [id]).catch(logError('refresh'))
  await refreshTree()
}

export async function duplicatePage(id: string, opts: { open?: boolean } = {}): Promise<Block> {
  const copy = await window.api.pages.duplicate(id)
  putBlocks([copy])
  if (copy.parentId) await refreshBlocks([copy.parentId]).catch(logError('refresh'))
  await refreshTree()
  if (opts.open) openPage(copy.id)
  return copy
}

export async function exportMarkdown(id: string): Promise<void> {
  const result = await window.api.pages.exportMarkdown(id)
  if (result.saved) toast(result.path ? `Exported to ${result.path}` : 'Page exported.', { kind: 'success' })
}

export async function importMarkdown(parentId: string | null): Promise<Block | null> {
  const page = await window.api.pages.importMarkdown(parentId)
  if (!page) return null
  putBlocks([page])
  if (parentId) await refreshBlocks([parentId]).catch(logError('refresh'))
  await refreshTree()
  openPage(page.id)
  return page
}

export function isAncestorOrSelf(ancestorId: string, id: string | null): boolean {
  const seen = new Set<string>()
  let cursor = id
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = getBlock(cursor)?.parentId ?? null
  }
  return false
}

export type DropPosition = 'before' | 'after' | 'inside'

/** Sidebar drag & drop: re-parent or reorder `dragId` relative to `targetId`. */
export async function dropPage(dragId: string, targetId: string, position: DropPosition): Promise<void> {
  const target = getBlock(targetId)
  if (!target || !getBlock(dragId) || isAncestorOrSelf(dragId, targetId)) return
  let parentId: string | null
  let afterId: string | null | undefined
  if (position === 'inside') {
    if (target.type !== 'page') return
    parentId = targetId
    afterId = undefined
  } else {
    parentId = target.parentId
    if (position === 'after') {
      afterId = targetId
    } else {
      const parent = getBlock(parentId)
      const siblings = parent?.content.includes(targetId)
        ? parent.content
        : (useTree.getState().children[parentId ?? ROOT] ?? [])
      const withoutDragged = siblings.filter((s) => s !== dragId)
      const index = withoutDragged.indexOf(targetId)
      afterId = index > 0 ? withoutDragged[index - 1] : null
    }
  }
  await applyOps([{ op: 'move', id: dragId, parentId, afterId }])
  if (position === 'inside') setExpanded(targetId, true)
  await refreshTree()
}

/** Moves a page to the end of the workspace root. */
export async function movePageToRoot(dragId: string): Promise<void> {
  if (!getBlock(dragId)) return
  await applyOps([{ op: 'move', id: dragId, parentId: null }])
  await refreshTree()
}
