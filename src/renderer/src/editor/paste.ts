// Getting content in and out of the editor: copy, paste, duplicate and file drops.
import type { Block, RichText } from '@shared/types'
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
  pastedNodes,
  serializeBlocks,
  type ClipNode
} from './clipboard'
import { isPlainTextType, isTextType } from './blockTypes'
import { MAX_HTML_LENGTH, htmlToNodes } from './html'
import { parseMarkdownNodes } from './markdown'
import { rtLength, textOf } from './richtext-dom'
import { parsePageLink } from '@shared/pageLink'
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
 * Blocks for the clipboard's `text/html` (from a web page, an e-mail, Google Docs), or null
 * when it adds nothing to the plain text. DOMParser makes an inert document: no script in it
 * runs and nothing it points to loads; html.ts keeps only our own block types and marks.
 */
function htmlBlocks(dt: DataTransfer, plain: string): ClipNode[] | null {
  const html = dt.getData('text/html')
  if (!html || html.length > MAX_HTML_LENGTH) return null
  try {
    return htmlToNodes(new DOMParser().parseFromString(html, 'text/html').body, plain)
  } catch (err) {
    console.error('[editor] reading pasted html failed', err)
    return null
  }
}

/** The text of a single pasted paragraph to put inline, when it carries marks or links. */
function inlineSpans(nodes: readonly ClipNode[]): RichText | null {
  if (nodes.length !== 1 || nodes[0].children.length) return null
  const title = nodes[0].props.title
  return title?.length && title.some((span) => span[1]?.length) ? title : null
}

/**
 * Handles a paste. `targetId` is the focused text block (null in block-selection
 * mode). Returns false when the caller should insert `text/plain` inline itself.
 * Rich content arrives through the validated internal formats, or as `text/html`
 * converted to our own blocks (html.ts); everything else is plain text / Markdown.
 */
export function handlePaste(ctrl: EditorController, dt: DataTransfer, targetId: string | null): boolean {
  const nodes = pastedNodes(parseClipboardBlocks(dt.getData(MIME_BLOCKS)))
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
  // A caret or selection inside a block's text (not the page title, not a block selection).
  const inline = targetId && o && targetId !== ctrl.pageId ? { id: targetId, start: o.start, end: o.end } : null
  const oneLine = !text.replace(/\n+$/, '').includes('\n')
  if (inline) {
    const spans = parseClipboardRichText(dt.getData(MIME_RICHTEXT))
    if (spans.length) {
      ctrl.replaceText(inline.id, inline.start, inline.end, spans)
      return true
    }
    const link = isUrl(text) || parsePageLink(text.trim()) !== null
    if (link && inline.end > inline.start && ctrl.setLink(inline, text.trim())) return true
  }
  const html = htmlBlocks(dt, text)
  if (html && inline && oneLine) {
    // A few words or a link from a page join the line, keeping their marks; without any,
    // the caller inserts the plain text as it always has.
    const spans = inlineSpans(html)
    if (spans) {
      ctrl.replaceText(inline.id, inline.start, inline.end, spans)
      return true
    }
  } else if (html) {
    insertNodes(ctrl, html, placeFor(ctrl, targetId))
    return true
  }
  if (inline) {
    if (!text) return true
    if (oneLine) return false
  }
  if (!text.trim()) return true
  insertNodes(ctrl, parseMarkdownNodes(text), placeFor(ctrl, targetId))
  return true
}

export async function dropFiles(ctrl: EditorController, files: readonly File[], drop: DropTarget | null): Promise<void> {
  const nodes: ClipNode[] = []
  for (const file of files.filter(isImageFile)) {
    const url = await saveImage(file)
    if (url) nodes.push(imageNode(url))
  }
  if (!nodes.length) return
  // Resolved after the uploads: the drop target may have changed meanwhile. Files dropped beside a
  // block go below it: images do not make columns by a drop.
  const at = drop && (drop.pos === 'left' || drop.pos === 'right') ? { id: drop.id, pos: 'after' as const } : drop
  const place = (at && placeForDrop(ctrl.tree, at)) || placeFor(ctrl, null)
  insertNodes(ctrl, nodes, place)
}
