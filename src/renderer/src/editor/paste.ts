// Getting content in and out of the editor: copy, paste, duplicate and file drops.
import type { Block } from '@shared/types'
import { isTrashable } from '../../../shared/linked'
import { getBlock, loadTree, newId } from '@/store/blocks'
import type { EditorController } from './controller'
import {
  MIME_BLOCKS,
  MIME_RICHTEXT,
  buildCreateOps,
  nodesToText,
  parseClipboardBlocks,
  parseClipboardRichText,
  serializeBlocks,
  type ClipNode
} from './clipboard'
import { isPlainTextType, isTextType } from './blockTypes'
import { parseMarkdownBlocks } from './markdown'
import { rtLength, textOf } from './richtext-dom'
import { imageExtension, isUrl } from './sanitize'
import { isEditable, liveChildren, placeForDrop, topLevel } from './structure'
import { END, textSel, type DropTarget, type Place } from './types'

/** Sub-pages and databases, which the backend copies. A linked database view is copied like any block. */
function isContainer(b: Block | undefined): b is Block {
  return isTrashable(b)
}

function isImageFile(file: File): boolean {
  return imageExtension(file.name, file.type) !== null
}

/** Where pasted blocks go: after the target (or the block selection), replacing an empty text block. */
function placeFor(ctrl: EditorController, targetId: string | null): Place {
  const { pageId } = ctrl
  const sel = topLevel(ctrl.tree, ctrl.ui.getState().selected)
  const tid = targetId ?? sel[sel.length - 1] ?? null
  if (tid === pageId) return { parentId: pageId, afterId: null }
  const b = tid ? getBlock(tid) : undefined
  if (!b || !b.parentId) {
    const kids = liveChildren(ctrl.tree, getBlock(pageId))
    return { parentId: pageId, afterId: kids[kids.length - 1] ?? null }
  }
  const replace = b.type === 'text' && rtLength(b.props.title) === 0 && b.content.length === 0
  return { parentId: b.parentId, afterId: b.id, replace: replace ? b.id : undefined }
}

export function insertNodes(ctrl: EditorController, nodes: readonly ClipNode[], place: Place): void {
  if (!nodes.length) return
  ctrl.flushAll()
  const { ops, ids } = buildCreateOps(nodes, place.parentId, place.afterId, newId)
  if (place.replace) ops.push({ op: 'delete', id: place.replace })
  const last = nodes[nodes.length - 1]
  const caret = isTextType(last.type) || isPlainTextType(last.type)
  ctrl.commit(ops, { after: caret ? textSel(ids[ids.length - 1], END) : { kind: 'blocks', ids } })
}

/** Stores image bytes through the main process (which validates them); null when refused. */
async function saveImage(file: File): Promise<string | null> {
  const ext = imageExtension(file.name, file.type)
  if (!ext) return null
  try {
    return await window.api.files.saveImage(await file.arrayBuffer(), ext)
  } catch (err) {
    console.error('[editor] saveImage failed', err)
    return null
  }
}

function imageNode(url: string): ClipNode {
  return { type: 'image', props: { url }, children: [] }
}

/** Clipboard payload for the given blocks: Markdown-ish plain text plus internal JSON. */
export function copyPayload(ctrl: EditorController, ids: readonly string[]): { text: string; json: string } {
  ctrl.flushAll()
  const tops = topLevel(ctrl.tree, ids)
  const nodes = serializeBlocks(getBlock, tops)
  const pages = tops.map((id) => getBlock(id)).filter(isContainer)
  const text = [...nodesToText(nodes), ...pages.map((b) => textOf(b.props.title))].join('\n')
  return { text, json: JSON.stringify(nodes) }
}

export function duplicate(ctrl: EditorController, ids: readonly string[]): void {
  ctrl.flushAll()
  const tops = topLevel(ctrl.tree, ids)
  if (!tops.length) return
  const pages = tops.filter((id) => isContainer(getBlock(id)))
  if (pages.length) {
    // Sub-pages are copied by the backend (with their own content); not part of the undo history.
    void Promise.all(pages.map((id) => window.api.pages.duplicate(id)))
      .then(() => loadTree(ctrl.pageId))
      .catch((err) => console.error('[editor] duplicate failed', err))
  }
  const last = getBlock(tops[tops.length - 1])
  if (!last?.parentId) return
  const { ops, ids: created } = buildCreateOps(serializeBlocks(getBlock, tops), last.parentId, last.id, newId)
  if (!created.length) return
  const single = created.length === 1 ? getBlock(tops[0]) : undefined
  ctrl.commit(ops, { after: single && isEditable(single) ? textSel(created[0], END) : { kind: 'blocks', ids: created } })
}

/**
 * Handles a paste. `targetId` is the focused text block (null in block-selection
 * mode). Returns false when the caller should insert `text/plain` inline itself.
 * `text/html` is never read: rich content only arrives through the validated
 * internal formats, everything else is treated as plain text / Markdown.
 */
export function handlePaste(ctrl: EditorController, dt: DataTransfer, targetId: string | null): boolean {
  const nodes = parseClipboardBlocks(dt.getData(MIME_BLOCKS))
  if (nodes.length) {
    insertNodes(ctrl, nodes, placeFor(ctrl, targetId))
    return true
  }
  const image = Array.from(dt.files).find(isImageFile)
  if (image) {
    void saveImage(image).then((url) => {
      if (url) insertNodes(ctrl, [imageNode(url)], placeFor(ctrl, targetId))
    })
    return true
  }
  const text = dt.getData('text/plain').replace(/\r\n?/g, '\n')
  const o = targetId ? ctrl.focusable(targetId)?.getSel() : null
  if (targetId && o && targetId !== ctrl.pageId) {
    const spans = parseClipboardRichText(dt.getData(MIME_RICHTEXT))
    if (spans.length) {
      ctrl.replaceText(targetId, o.start, o.end, spans)
      return true
    }
    if (!text) return true
    if (isUrl(text) && o.end > o.start && ctrl.setLink({ id: targetId, start: o.start, end: o.end }, text.trim())) return true
    if (!text.replace(/\n+$/, '').includes('\n')) return false
  }
  if (!text.trim()) return true
  const parsed = parseMarkdownBlocks(text).map((p): ClipNode => ({ type: p.type, props: { ...p.props, title: p.title }, children: [] }))
  insertNodes(ctrl, parsed, placeFor(ctrl, targetId))
  return true
}

export async function dropFiles(ctrl: EditorController, files: readonly File[], drop: DropTarget | null): Promise<void> {
  const nodes: ClipNode[] = []
  for (const file of files.filter(isImageFile)) {
    const url = await saveImage(file)
    if (url) nodes.push(imageNode(url))
  }
  if (!nodes.length) return
  // Resolved after the uploads: the drop target may have changed meanwhile.
  const place = (drop && placeForDrop(ctrl.tree, drop)) || placeFor(ctrl, null)
  insertNodes(ctrl, nodes, place)
}
