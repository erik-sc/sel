import { isPageLike, isValidId } from './blocks'

/**
 * Reading the block tree: the statements that load a subtree or a set of
 * ancestor chains at once, and the pure functions that walk what they return.
 */

/** What a tree walk needs to know about a node. `Block` satisfies it. */
export interface TreeNode {
  id: string
  type: string
  content: string[]
  trashedAt: number | null
}

/** One block of an ancestor chain. `props` is the raw JSON, and only present for pages/databases. */
export interface Link {
  id: string
  type: string
  parent_id: string | null
  trashed_at: number | null
  props: string | null
}

/**
 * A block and everything below it, found through `parent_id` in one statement
 * instead of one query per level. Parameters: the root id, then 1 to stop at
 * nested pages/databases (they are returned, their content is not) or 0 to
 * descend into them. Trashed blocks and what hangs below them are left out;
 * the root itself is returned whatever its state.
 *
 * Blocks with an empty child list are not probed for children (most blocks are
 * leaves). A block has one parent, so the only cycle corrupt rows could form
 * below the root runs through the root itself: refusing to revisit it is what
 * makes the walk terminate.
 */
export const subtreeSql = (columns: string): string => `
  WITH RECURSIVE tree(rid, id, open, root) AS (
    SELECT rid, id, 1, rid FROM blocks WHERE id = ?
    UNION ALL
    SELECT c.rid, c.id, (c.content <> '[]' AND (? = 0 OR c.type NOT IN ('page', 'database'))), tree.root
    FROM tree CROSS JOIN blocks c ON c.parent_id = tree.id
    WHERE tree.open AND c.trashed_at IS NULL AND c.rid <> tree.root
  )
  SELECT ${columns} FROM tree CROSS JOIN blocks b ON b.rid = tree.rid`

/** Rows for a JSON array of ids (one cached statement whatever the number of ids). */
export const byIdsSql = (columns: string): string =>
  `SELECT ${columns} FROM json_each(?) j CROSS JOIN blocks b ON b.id = j.value`

/** The given blocks and all their ancestors, each once, in one statement. */
export const LINEAGE_SQL = `
  WITH RECURSIVE up(rid, id, type, parent_id, trashed_at) AS (
    SELECT b.rid, b.id, b.type, b.parent_id, b.trashed_at
    FROM json_each(?) j CROSS JOIN blocks b ON b.id = j.value
    UNION
    SELECT p.rid, p.id, p.type, p.parent_id, p.trashed_at
    FROM up CROSS JOIN blocks p ON p.id = up.parent_id
  )
  SELECT id, type, parent_id, trashed_at,
         CASE WHEN type IN ('page', 'database') THEN (SELECT props FROM blocks WHERE rid = up.rid) END AS props
  FROM up`

/**
 * The nodes listed in `ids`, in that order and each once. Document order is
 * what `content` says, so a child that the `parent_id` walk did not return
 * (rows that disagree) is loaded on demand instead of being dropped.
 */
export function pick<N extends TreeNode>(ids: string[], nodes: Map<string, N>, load: (ids: string[]) => N[]): N[] {
  let missing: string[] | null = null
  for (const id of ids) if (!nodes.has(id) && isValidId(id)) (missing ??= []).push(id)
  if (missing) for (const n of load(missing)) nodes.set(n.id, n)
  const out: N[] = []
  const emitted = new Set<string>()
  for (const id of ids) {
    const n = nodes.get(id)
    if (n && !emitted.has(id)) {
      emitted.add(id)
      out.push(n)
    }
  }
  return out
}

/** Pre-order walk from `root` following `content`, not descending into nested pages/databases. */
export function walk<N extends TreeNode>(root: N, nodes: Map<string, N>, load: (ids: string[]) => N[]): N[] {
  const out: N[] = [root]
  const seen = new Set<string>([root.id])
  // Explicit stack so very deep documents cannot overflow the call stack.
  const stack: { list: N[]; next: number }[] = [{ list: pick(root.content, nodes, load), next: 0 }]
  while (stack.length) {
    const level = stack[stack.length - 1]
    if (level.next >= level.list.length) {
      stack.pop()
      continue
    }
    const b = level.list[level.next++]
    if (seen.has(b.id) || b.trashedAt !== null) continue
    seen.add(b.id)
    out.push(b)
    if (!isPageLike(b.type) && b.content.length) stack.push({ list: pick(b.content, nodes, load), next: 0 })
  }
  return out
}

/**
 * A test for "not in the trash" over the blocks in `links` (see LINEAGE_SQL):
 * false when the block, or any ancestor, is trashed or missing.
 */
export function liveFilter(links: Map<string, Link>): (id: string) => boolean {
  const cache = new Map<string, boolean>()
  return (id) => {
    const chain = new Set<string>()
    let cur: string | null = id
    let live = true
    while (cur !== null) {
      const known = cache.get(cur)
      if (known !== undefined) {
        live = known
        break
      }
      const link = links.get(cur)
      // A block met twice on the way up is a cycle: treated as unreachable.
      if (!link || link.trashed_at != null || chain.has(cur)) {
        live = false
        break
      }
      chain.add(cur)
      cur = link.parent_id
    }
    for (const c of chain) cache.set(c, live)
    return live
  }
}

/** The pages/databases above `id`, root first, excluding `id` itself. */
export function pagesAbove(id: string, links: Map<string, Link>): Link[] {
  const out: Link[] = []
  const seen = new Set<string>()
  let cur = links.get(id)?.parent_id ?? null
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const link = links.get(cur)
    if (!link) break
    if (isPageLike(link.type)) out.push(link)
    cur = link.parent_id
  }
  return out.reverse()
}
