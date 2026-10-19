// How an accepted AI answer becomes part of the page: Markdown -> blocks -> one batch of ops.
// Pure (it reads blocks through a getter and returns the ops to commit), so the rules are
// unit tested without a DOM. The Markdown is parsed by the same code that handles a paste.
import type { Op, RichText } from '@shared/types'
import type { SnapshotBlock, SnapshotContent } from '@shared/versions'
import { isTextType } from '../editor/blockTypes'
import { buildCreateOps, type ClipNode } from '../editor/clipboard'
import { parseMarkdownBlocks } from '../editor/markdown'
import { replaceRange, rtLength, textOf } from '../editor/richtext-dom'
import { topLevel, type Tree } from '../editor/structure'
import { END, textSel, type Sel } from '../editor/types'

/** Where an answer goes. */
export type AiTarget =
  /** A text selection inside one block: the answer replaces it. */
  | { kind: 'range'; blockId: string; start: number; end: number }
  /** Selected blocks: the answer replaces them. */
  | { kind: 'blocks'; ids: string[] }
  /** The caret: the answer continues the text there. */
  | { kind: 'caret'; blockId: string; offset: number }
  /** Below a block; `null` puts it first in the page. */
  | { kind: 'after'; blockId: string | null }

export interface InsertPlan {
  ops: Op[]
  after: Sel
}

/** An answer as the blocks a paste of it would create. */
export function markdownToNodes(markdown: string): ClipNode[] {
  return parseMarkdownBlocks(markdown).map(
    (block): ClipNode => ({ type: block.type, props: { ...block.props, title: block.title }, children: [] })
  )
}

/** The same blocks in the shape the read-only renderer takes, for the preview. */
export function markdownToSnapshot(markdown: string): SnapshotContent {
  const nodes = markdownToNodes(markdown)
  const blocks: SnapshotBlock[] = nodes.map((node, index) => ({
    id: `ai-${index}`,
    type: node.type,
    parentId: 'ai-root',
    content: [],
    props: node.props,
    createdAt: 0
  }))
  const root: SnapshotBlock = {
    id: 'ai-root',
    type: 'page',
    parentId: null,
    content: blocks.map((block) => block.id),
    props: {},
    createdAt: 0
  }
  return { rootId: root.id, blocks: [root, ...blocks], refs: [] }
}

/** Selection after inserting `nodes` as blocks `ids`: the caret at the end of the last one, or the blocks. */
function afterBlocks(nodes: readonly ClipNode[], ids: string[]): Sel {
  const last = nodes[nodes.length - 1]
  return isTextType(last.type) || last.type === 'code' ? textSel(ids[ids.length - 1], END) : { kind: 'blocks', ids }
}

/** Blocks created after `blockId` (first in the page for null), replacing it when it is an empty paragraph. */
function below(tree: Tree, blockId: string | null, nodes: readonly ClipNode[], newId: () => string): InsertPlan | null {
  const block = blockId ? tree.get(blockId) : undefined
  if (blockId && (!block || !block.parentId)) return below(tree, null, nodes, newId)
  const { ops, ids } = block?.parentId
    ? buildCreateOps(nodes, block.parentId, block.id, newId)
    : buildCreateOps(nodes, tree.pageId, null, newId)
  if (block && block.type === 'text' && rtLength(block.props.title) === 0 && block.content.length === 0)
    ops.push({ op: 'delete', id: block.id })
  return { ops, after: afterBlocks(nodes, ids) }
}

/** Spaces to put around a continuation so that it does not run into the words on either side of the caret. */
function joiners(title: RichText | undefined, offset: number, insert: RichText): [string, string] {
  const all = textOf(title)
  const before = all.slice(0, offset)
  const after = all.slice(offset)
  const next = textOf(insert)
  if (!next) return ['', '']
  const lead = !before || /\s$/.test(before) || /^[\s.,;:!?)\]}]/.test(next) ? '' : ' '
  const trail = !after || /^[\s.,;:!?)\]}]/.test(after) || /\s$/.test(next) ? '' : ' '
  return [lead, trail]
}

/**
 * The ops that put `markdown` at `target`, as one batch (one undo step), and where the caret
 * goes afterwards. Null when there is nothing to insert. `replace: false` keeps what is
 * selected and puts the answer below it instead (an explanation of the selection).
 */
export function planAccept(tree: Tree, target: AiTarget, markdown: string, newId: () => string, replace = true): InsertPlan | null {
  const nodes = markdownToNodes(markdown)
  if (!nodes.length) return null
  /** A single paragraph can go into a line of text; anything else is blocks. */
  const inline = nodes.length === 1 && nodes[0].type === 'text' ? (nodes[0].props.title ?? []) : null

  switch (target.kind) {
    case 'after':
      return below(tree, target.blockId, nodes, newId)

    case 'caret': {
      const block = tree.get(target.blockId)
      if (!block || !block.parentId) return below(tree, null, nodes, newId)
      if (!inline || !isTextType(block.type)) return below(tree, block.id, nodes, newId)
      const offset = Math.min(target.offset, rtLength(block.props.title))
      const [lead, trail] = joiners(block.props.title, offset, inline)
      const insert: RichText = [...(lead ? ([[lead]] as RichText) : []), ...inline, ...(trail ? ([[trail]] as RichText) : [])]
      const title = replaceRange(block.props.title, offset, offset, insert)
      return { ops: [{ op: 'update', id: block.id, patch: { props: { title } } }], after: textSel(block.id, offset + rtLength(insert)) }
    }

    case 'range': {
      const block = tree.get(target.blockId)
      if (!block || !block.parentId) return below(tree, null, nodes, newId)
      if (!replace) return below(tree, block.id, nodes, newId)
      const length = rtLength(block.props.title)
      const start = Math.min(target.start, length)
      const end = Math.min(Math.max(target.end, start), length)
      if (inline) {
        const title = replaceRange(block.props.title, start, end, inline)
        return {
          ops: [{ op: 'update', id: block.id, patch: { props: { title } } }],
          after: textSel(block.id, start, start + rtLength(inline))
        }
      }
      // Several blocks cannot live inside a line: the selected text leaves the block and the
      // answer follows it as blocks. A block left empty by that (and childless) goes.
      const rest = replaceRange(block.props.title, start, end, [])
      const { ops, ids } = buildCreateOps(nodes, block.parentId, block.id, newId)
      if (rtLength(rest) === 0 && block.content.length === 0) ops.push({ op: 'delete', id: block.id })
      else ops.unshift({ op: 'update', id: block.id, patch: { props: { title: rest } } })
      return { ops, after: afterBlocks(nodes, ids) }
    }

    case 'blocks': {
      const tops = topLevel(tree, target.ids).filter((id) => {
        const block = tree.get(id)
        // Sub-pages and databases are not text the model rewrote: they stay where they are.
        return !!block && !!block.parentId && block.type !== 'page' && block.type !== 'database'
      })
      const last = tree.get(tops[tops.length - 1] ?? '')
      if (!last || !last.parentId) return below(tree, null, nodes, newId)
      const { ops, ids } = buildCreateOps(nodes, last.parentId, last.id, newId)
      if (replace) for (const id of tops) ops.push({ op: 'delete', id })
      return { ops, after: { kind: 'blocks', ids } }
    }
  }
}
