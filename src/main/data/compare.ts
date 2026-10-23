import { createHash } from 'node:crypto'
import { MAX_LISTED_DIFFERENCES, type BackupComparison, type PageChange, type PageDifference } from '../../shared/data'
import { modernizeUrls } from '../../shared/legacy'
import { sourceIdOf } from '../../shared/linked'
import { plainText } from '../../shared/richtext'
import type { BlockType, RichText } from '../../shared/types'
import type { SqlDriver, SqlStatement } from '../db/driver'

/**
 * What differs between a backup and the workspace now, page by page: the first step of a guided
 * restore (Settings → General → Data). Both databases are read as they are stored, read-only,
 * with plain SQL on the `blocks` table (the same columns since the first schema), so that a
 * backup made by an earlier sel is compared without being migrated. Run apart from the main
 * process (./backupWorker.ts): it reads every row of both files. Free of Electron.
 *
 * The unit is a page or a database as the sidebar shows them. The rows of a database are part of
 * it (a changed row is a changed database); a linked view is a block of the page that holds it.
 * A unit is the same in both when every live block it is made of has the same type, parent,
 * child list and props: a page that was edited and edited back again reads as the same.
 * What is in the Trash (or below something that is) counts as not there.
 */

interface Node {
  type: string
  parent: string | null
  trashed: boolean
  /** A database that shows another one's rows. */
  linked: boolean
  /** For pages and databases only. */
  title: string
  icon: string | null
  /** Hash of what the block is: type, parent, child list and props. */
  digest: string
}

export interface Workspace {
  nodes: Map<string, Node>
}

const isPageLike = (type: string): boolean => type === 'page' || type === 'database'

function propsOf(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Every row once, without holding the whole result in memory when the driver can step through it. */
function eachRow<T>(stmt: SqlStatement, visit: (row: T) => void): void {
  const iterate = (stmt as { iterate?: () => Iterable<unknown> }).iterate
  const rows = typeof iterate === 'function' ? iterate.call(stmt) : stmt.all()
  for (const row of rows) visit(row as T)
}

/** Reads the blocks of a sel database (better-sqlite3 in the app, node:sqlite in tests). */
export function readWorkspace(db: SqlDriver): Workspace {
  const nodes = new Map<string, Node>()
  eachRow<{ id: string; type: string; parent_id: string | null; content: string; props: string; trashed_at: number | null }>(
    db.prepare('SELECT id, type, parent_id, content, props, trashed_at FROM blocks'),
    (row) => {
      // A backup from before the rename holds the old addresses: the same text, as sel reads it now.
      const props = modernizeUrls(String(row.props))
      const digest = createHash('sha1')
        .update(`${row.type}\u0000${row.parent_id ?? ''}\u0000${row.content}\u0000${props}`)
        .digest('base64')
      let title = ''
      let icon: string | null = null
      let linked = false
      if (isPageLike(row.type)) {
        const parsed = propsOf(props)
        title = plainText(parsed.title as RichText | undefined)
        icon = typeof parsed.icon === 'string' ? parsed.icon : null
        linked = sourceIdOf({ id: String(row.id), type: row.type as BlockType, props: parsed }) !== null
      }
      nodes.set(String(row.id), {
        type: String(row.type),
        parent: row.parent_id === null ? null : String(row.parent_id),
        trashed: row.trashed_at !== null,
        linked,
        title,
        icon,
        digest
      })
    }
  )
  return { nodes }
}

/** The pages of a workspace: which blocks are live, which unit each belongs to, and what each unit is. */
interface Units {
  /** Unit id → fingerprint of everything it is made of. */
  print: Map<string, string>
  /** Unit id → the unit above it (null at the root). */
  above: Map<string, string | null>
}

function unitsOf({ nodes }: Workspace): Units {
  const live = new Map<string, boolean>()
  const isLive = (id: string): boolean => {
    const chain: string[] = []
    let cur: string | null = id
    let result = false
    while (cur !== null) {
      const known = live.get(cur)
      if (known !== undefined) {
        result = known
        break
      }
      const node = nodes.get(cur)
      // A block met twice on the way up is a cycle (corrupt rows): treated as not there.
      if (!node || node.trashed || chain.includes(cur)) break
      chain.push(cur)
      if (node.parent === null) {
        result = true
        break
      }
      cur = node.parent
    }
    for (const c of chain) live.set(c, result)
    return result
  }
  const isUnit = (id: string): boolean => {
    const node = nodes.get(id)
    if (!node || !isPageLike(node.type) || node.linked) return false
    const parent = node.parent === null ? undefined : nodes.get(node.parent)
    // A row of a database belongs to its database.
    return !(parent && parent.type === 'database' && !parent.linked)
  }
  const container = new Map<string, string | null>()
  const containerOf = (id: string): string | null => {
    const chain: string[] = []
    let cur: string | null = id
    let result: string | null = null
    while (cur !== null) {
      const known = container.get(cur)
      if (known !== undefined) {
        result = known
        break
      }
      if (chain.includes(cur)) break
      chain.push(cur)
      if (isUnit(cur)) {
        result = cur
        break
      }
      cur = nodes.get(cur)?.parent ?? null
    }
    for (const c of chain) container.set(c, result)
    return result
  }

  const parts = new Map<string, string[]>()
  for (const [id, node] of nodes) {
    if (!isLive(id)) continue
    const unit = containerOf(id)
    if (unit === null) continue
    let list = parts.get(unit)
    if (!list) parts.set(unit, (list = []))
    list.push(`${id}\u0000${node.digest}`)
  }
  const print = new Map<string, string>()
  const above = new Map<string, string | null>()
  for (const [unit, list] of parts) {
    if (!isUnit(unit)) continue
    list.sort()
    print.set(unit, createHash('sha1').update(list.join('\n')).digest('base64'))
    const parent = nodes.get(unit)?.parent ?? null
    above.set(unit, parent === null ? null : containerOf(parent))
  }
  return { print, above }
}

const MAX_PATH = 4

function pathOf(id: string, units: Units, nodes: Map<string, Node>): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  let cur = units.above.get(id) ?? null
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    out.unshift(nodes.get(cur)?.title ?? '')
    cur = units.above.get(cur) ?? null
  }
  // The outermost pages say where it is; the ones in between are left out past a few.
  return out.length > MAX_PATH ? [out[0], '…', ...out.slice(-(MAX_PATH - 2))] : out
}

/** How many units sit below each one. */
function countBelow(units: Units): Map<string, number> {
  const below = new Map<string, number>()
  for (const id of units.print.keys()) {
    const seen = new Set<string>([id])
    let cur = units.above.get(id) ?? null
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      below.set(cur, (below.get(cur) ?? 0) + 1)
      cur = units.above.get(cur) ?? null
    }
  }
  return below
}

const ORDER: Record<PageChange, number> = { 'only-backup': 0, changed: 1, 'only-now': 2 }

/** The comparison of a backup (`then`) with the workspace now. */
export function compareWorkspaces(then: Workspace, now: Workspace): Omit<BackupComparison, 'source' | 'at'> {
  const before = unitsOf(then)
  const after = unitsOf(now)
  const below = countBelow(before)
  const counts: BackupComparison['counts'] = { 'only-backup': 0, 'only-now': 0, changed: 0, same: 0 }
  const found: PageDifference[] = []
  const add = (id: string, change: PageChange, side: Workspace, units: Units): void => {
    counts[change] += 1
    const node = side.nodes.get(id) as Node
    found.push({
      id,
      title: node.title,
      icon: node.icon,
      kind: node.type === 'database' ? 'database' : 'page',
      path: pathOf(id, units, side.nodes),
      change,
      subpages: change === 'only-now' ? 0 : (below.get(id) ?? 0)
    })
  }
  for (const [id, print] of before.print) {
    const current = after.print.get(id)
    if (current === undefined) add(id, 'only-backup', then, before)
    else if (current !== print) add(id, 'changed', now, after)
    else counts.same += 1
  }
  for (const id of after.print.keys()) if (!before.print.has(id)) add(id, 'only-now', now, after)

  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  found.sort((a, b) => ORDER[a.change] - ORDER[b.change] || collator.compare(a.title, b.title) || a.id.localeCompare(b.id))
  const listed = new Map<PageChange, number>()
  const differences = found.filter((d) => {
    const n = (listed.get(d.change) ?? 0) + 1
    listed.set(d.change, n)
    return n <= MAX_LISTED_DIFFERENCES
  })
  return { pages: before.print.size, counts, differences }
}

/** Opens a database file read-only: better-sqlite3 in the app, node:sqlite in tests. */
type Opener = (file: string) => SqlDriver

function readFile(open: Opener, file: string): Workspace {
  const db = open(file)
  try {
    return readWorkspace(db)
  } finally {
    try {
      db.close()
    } catch {
      /* closing a read-only handle cannot lose anything */
    }
  }
}

/** `compareWorkspaces` of two files: what ./backupWorker.ts runs. */
export function compareFiles(open: Opener, backup: string, live: string): Omit<BackupComparison, 'source' | 'at'> {
  return compareWorkspaces(readFile(open, backup), readFile(open, live))
}
