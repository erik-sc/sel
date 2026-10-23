import { randomUUID } from 'node:crypto'
import type { ImportCounts } from '../../shared/transfer'
import type { Block, BlockProps } from '../../shared/types'
import { parsePageLink } from '../../shared/pageLink'
import type { Repository, TreeInput } from '../db/repository'
import { MAX_IMPORT_BLOCKS, parseMarkdown } from '../markdown'
import { IMAGE_PLACEHOLDER, type ImportPlan, type PlanNode } from './plan'
import type { SourceFile } from './source'

/**
 * Makes an import (./plan.ts) in the workspace: first the page everything goes under, at the end
 * of the workspace, then the images, then each page and database in turn, one transaction
 * each, with a pause between them so that the windows keep being answered and the progress can
 * be told. A page's sub-pages land where its text linked to them (Notion and sel write a line
 * with a link to each sub-page where it sits) or else after its text. When anything fails, the
 * page everything went under goes to the trash, and the failure is passed on.
 */

export interface RunOptions {
  /** The title of the page everything goes under ("Imported on 22 Oct 2026"). */
  title: string
  /** Copies an image in and answers its `sel-file://` address; rejects what is not an image, or is too large. */
  storeImage(file: SourceFile): Promise<string>
  progress?(done: number, total: number): void
  /** Lets other work run; called between steps. */
  pause?(): Promise<void>
}

export interface RunResult {
  pageId: string
  counts: ImportCounts
}

const PLACEHOLDER_RE = new RegExp(`!\\[([^\\]]*)\\]\\(${IMAGE_PLACEHOLDER}(\\d+)\\)`, 'g')

/** How many pages and databases a plan makes. */
function countNodes(nodes: readonly PlanNode[]): number {
  let n = 0
  const stack = [...nodes]
  for (let node = stack.pop(); node; node = stack.pop()) {
    n += 1
    stack.push(...node.children)
  }
  return n
}

/** A top-level block that is only a link to `childIds`' page, and so marks where that sub-page goes. */
function linkedChild(node: TreeInput, childIds: ReadonlySet<string>, placed: ReadonlySet<string>): string | null {
  if (node.type !== 'text' || node.children?.length) return null
  const spans = node.props?.title ?? []
  if (!spans.length) return null
  let target: string | null = null
  for (const [text, marks] of spans) {
    const link = marks?.find((m) => m[0] === 'a')
    const page = link ? parsePageLink(link[1])?.pageId : undefined
    if (!page) {
      if (text.trim()) return null
      continue
    }
    if (target && target !== page) return null
    target = page
  }
  return target && childIds.has(target) && !placed.has(target) ? target : null
}

export async function runImport(repo: Repository, plan: ImportPlan, options: RunOptions): Promise<RunResult> {
  const pause = options.pause ?? (async () => undefined)
  const total = plan.images.length + countNodes(plan.nodes)
  let done = 0
  const step = async (): Promise<void> => {
    done += 1
    options.progress?.(done, total)
    await pause()
  }

  const root = repo.createTree({ type: 'page', props: { title: [[options.title]], icon: '📥' } }, null)
  try {
    // ---- the images, each copied in once; one that cannot be is left out of its page
    const urls: (string | null)[] = []
    for (const file of plan.images) {
      try {
        urls.push(await options.storeImage(file))
      } catch {
        urls.push(null)
      }
      await step()
    }
    let attachments = 0
    for (const url of urls) if (url) attachments += 1

    const contentOf = (markdown: string): TreeInput[] => {
      if (!markdown.trim()) return []
      const text = markdown.replace(PLACEHOLDER_RE, (_m, alt: string, n: string) => {
        const url = urls[Number(n)]
        return url ? `![${alt}](${url})` : alt
      })
      const { nodes } = parseMarkdown(text, { keepTitle: true })
      let count = 0
      const pending = [...nodes]
      for (let node = pending.pop(); node; node = pending.pop()) {
        if (++count > MAX_IMPORT_BLOCKS) throw new Error('A page has too many blocks to import')
        pending.push(...(node.children ?? []))
      }
      return nodes
    }

    const make = async (node: PlanNode, parentId: string, afterId?: string | null): Promise<void> => {
      if (node.kind === 'database') {
        const props: BlockProps = { title: [[node.title]], schema: node.database?.schema, views: node.database?.views }
        if (node.icon) props.icon = node.icon
        repo.createTree({ id: node.id, type: 'database', props }, parentId, afterId)
        await step()
        // Rows keep the table's order: each goes after the one before.
        for (const row of node.children) await make(row, node.id)
        return
      }
      const content = contentOf(node.markdown)
      // Where each sub-page goes: in place of the line that links to it, or at the end.
      const childIds = new Set(node.children.map((c) => c.id))
      const placed = new Set<string>()
      const kept: TreeInput[] = []
      const after = new Map<string, string | null>()
      let previous: string | null = null
      for (const block of content) {
        const child = linkedChild(block, childIds, placed)
        if (child) {
          // A Set keeps the order things were added in: the order the text links to them.
          placed.add(child)
          after.set(child, previous)
          previous = child
          continue
        }
        const id = randomUUID()
        kept.push({ ...block, id })
        previous = id
      }
      const props: BlockProps = { title: [[node.title]] }
      if (node.icon) props.icon = node.icon
      if (node.values) props.values = node.values
      repo.createTree({ id: node.id, type: 'page', props, children: kept }, parentId, afterId)
      await step()
      // The placed ones in their order, each after what came before it, then the rest at the end.
      const byId = new Map(node.children.map((c) => [c.id, c]))
      for (const id of placed) await make(byId.get(id) as PlanNode, node.id, after.get(id))
      for (const child of node.children) if (!placed.has(child.id)) await make(child, node.id)
    }

    for (const node of plan.nodes) await make(node, root.id)
    return { pageId: root.id, counts: { ...plan.counts, attachments } }
  } catch (err) {
    try {
      repo.delete(root.id)
    } catch {
      /* the failure below is the one to tell */
    }
    throw err
  }
}

/** Puts an import's page in the trash: everything it made goes with it, and the trash can bring it back. */
export function undoImport(repo: Repository, pageId: string): Block | null {
  const page = repo.get(pageId)
  if (!page || page.trashedAt !== null) return null
  repo.delete(pageId)
  return page
}
