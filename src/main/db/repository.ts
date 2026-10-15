import { randomUUID } from 'node:crypto'
import { sanitizeViewCharts } from '../../shared/chart'
import { sourceIdOf } from '../../shared/linked'
import { relinkDuplicate } from '../../shared/relation'
import { plainText } from '../../shared/richtext'
import { isSystemKind } from '../../shared/system'
import type { Block, BlockProps, CreateBlockInput, DatabaseLocation, Op, SearchResult, UpdateBlockInput } from '../../shared/types'
import {
  canonicalJson,
  MAX_VERSION_LABEL,
  type RestoreMode,
  type RestoreResult,
  type SnapshotBlock,
  type VersionInfo,
  type VersionSnapshot,
  type VersionStats
} from '../../shared/versions'
import {
  assertId,
  assertType,
  B_COLS,
  COLS,
  defaultDatabaseProps,
  isBlockType,
  isPageLike,
  isPlain,
  isValidId,
  MAX_SETTING_CHARS,
  mergeProps,
  parseContent,
  parseJson,
  parseProps,
  serializeProps,
  toBlock,
  type Row,
  type TreeInput
} from './blocks'
import type { SqlDriver, SqlStatement } from './driver'
import { configure, migrate } from './schema'
import { searchBlocks } from './search'
import { searchText } from './text'
import { buildSnapshot, BulkChange, formatStamp, RESTORE_LABEL_PREFIX, VersionStore } from './versions'
import { byIdsSql, LINEAGE_SQL, liveFilter, pagesAbove, pick, subtreeSql, walk, type Link, type TreeNode } from './tree'

export { BLOCK_TYPES, isBlockType, isPageLike, isValidId, MAX_SETTING_CHARS } from './blocks'
export type { TreeInput } from './blocks'
export { ftsQuery, likePattern, searchText } from './text'

const MAX_SETTING_KEY = 200
const ROOT_ORDER_KEY = 'rootOrder'
/** When the order of the workspace root last changed: sync needs to know which of two reorders is the later one. */
const ROOT_ORDER_AT_KEY = 'rootOrderAt'

/** What a sync writes in one transaction (see Repository.applySync). */
export interface SyncChange {
  /** Blocks to insert or to overwrite, exactly as given: the timestamps are theirs. */
  put: Block[]
  /** Blocks to remove for good; descendants that go with them are listed themselves. */
  remove: string[]
  /** The new order of the workspace root, when it changed. */
  root?: { order: string[]; at: number }
  /** Pages whose current state is stored as a version before anything is written. */
  snapshots: { pageId: string; label: string }[]
  /** Versions built from the state another device had (the tree of the page there, root first). */
  foreign: { pageId: string; label: string; tree: Block[] }[]
  /** Pages whose content changed as a whole: editors showing them drop their undo history. */
  resetPages: string[]
  /** Settings written with the blocks, so that a crash leaves both or neither. */
  settings: Record<string, unknown>
  /** Runs last, inside the transaction. */
  finish?: () => void
}

/** The columns of a row that structural checks need: no JSON, nothing to parse. */
interface Head {
  rid: number
  type: string
  parent_id: string | null
  trashed_at: number | null
}

/**
 * The check every props object passes before it is written, as far as chart views are
 * concerned: a chart configuration inside `views` only ever reaches the database in its
 * checked shape (known keys and enum members, clamped numbers; see shared/chart.ts).
 * Whether its property ids exist is not decided here: a linked view's schema belongs to
 * another block, and the renderer's normalisation layer repairs dangling references.
 */
function chartProps(props: BlockProps): BlockProps {
  const views: unknown = props.views
  const clean = sanitizeViewCharts(views)
  return clean === views ? props : { ...props, views: clean as BlockProps['views'] }
}

/** A child list changed inside the open transaction, not yet written back (see flushOrders). */
interface PendingOrder {
  ids: string[]
  at: number
  dirty: boolean
}

export interface RepositoryOptions {
  /** Wall clock in ms; injectable so tests can move time. */
  clock?: () => number
}

export class Repository {
  private readonly stmts = new Map<string, SqlStatement>()
  private depth = 0
  private lastNow = 0
  private readonly clock: () => number
  private readonly versions: VersionStore
  /** True while the open transaction may be refused as a bulk change and run again (see `write`). */
  private bulkCheck = false
  /** The page or database holding a block, as found earlier in the open transaction. */
  private containers = new Map<string, string | null>()
  /** Pages whose content was replaced by a restore: committed and not yet drained / in the open transaction. */
  private resets = new Set<string>()
  private pendingResets = new Set<string>()
  /** Ids changed by committed mutations and not yet drained. */
  private committed = new Set<string>()
  /** Ids changed inside the currently open transaction. */
  private pending = new Set<string>()
  private touched = new Set<string>()
  /** Child lists read or changed inside the currently open transaction, by parent id. */
  private orders = new Map<string, PendingOrder>()

  constructor(
    private readonly db: SqlDriver,
    options: RepositoryOptions = {}
  ) {
    this.clock = options.clock ?? Date.now
    configure(db)
    migrate(db)
    this.versions = new VersionStore({
      stmt: (sql) => this.stmt(sql),
      clock: () => this.clock(),
      now: () => this.now(),
      getSetting: (key) => this.getSetting(key),
      getTree: (rootId) => this.getTree(rootId),
      transaction: (fn) => this.transaction(fn),
      cleanProps: (props) => chartProps(mergeProps({}, props))
    })
  }

  /** Folds the WAL back into the main file and closes the database. */
  close(): void {
    this.stmts.clear()
    try {
      // Refreshes planner statistics only where they look stale, on a bounded sample.
      this.db.exec('PRAGMA analysis_limit = 400')
      this.db.exec('PRAGMA optimize')
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* best effort: the WAL is replayed on the next open anyway */
    }
    this.db.close()
  }

  // ---------------------------------------------------------------- plumbing

  /** Every statement is prepared once and reused: all SQL in this class is a constant string. */
  private stmt(sql: string): SqlStatement {
    let s = this.stmts.get(sql)
    if (!s) {
      s = this.db.prepare(sql)
      this.stmts.set(sql, s)
    }
    return s
  }

  private now(): number {
    // Strictly increasing so "most recently updated" ordering is deterministic.
    this.lastNow = Math.max(this.clock(), this.lastNow + 1)
    return this.lastNow
  }

  /** Runs `fn` in a transaction. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++
      try {
        return fn()
      } finally {
        this.depth--
      }
    }
    this.stmt('BEGIN IMMEDIATE').run()
    this.depth = 1
    this.pending = new Set()
    this.touched = new Set()
    this.orders = new Map()
    this.containers = new Map()
    this.pendingResets = new Set()
    this.versions.begin()
    try {
      const result = fn()
      this.versions.beforeCommit(this.bulkCheck)
      this.flushOrders()
      this.stmt('COMMIT').run()
      this.versions.commit()
      for (const id of this.pending) this.committed.add(id)
      for (const id of this.pendingResets) this.resets.add(id)
      return result
    } catch (err) {
      try {
        this.stmt('ROLLBACK').run()
      } catch {
        /* the original error is the interesting one */
      }
      this.versions.rollback()
      throw err
    } finally {
      this.depth = 0
      this.pending = new Set()
      this.touched = new Set()
      this.orders = new Map()
      this.containers = new Map()
      this.pendingResets = new Set()
    }
  }

  /**
   * A transaction for the mutations a user makes. One that turns out to remove many blocks
   * or most of the text of a page whose previous state is in no version yet is rolled back
   * and run again with a snapshot of that page taken first: the check costs nothing for
   * ordinary edits, and a bulk change is rare enough to be executed twice.
   */
  private write<T>(fn: () => T): T {
    if (this.depth > 0) return this.transaction(fn)
    this.bulkCheck = true
    try {
      return this.transaction(fn)
    } catch (err) {
      if (!(err instanceof BulkChange)) throw err
      this.versions.force(err.pages)
      return this.transaction(fn)
    } finally {
      this.bulkCheck = false
      this.versions.force(null)
    }
  }

  /** Ids of blocks affected by mutations committed since the last call. */
  drainChanges(): string[] {
    const ids = [...this.committed]
    this.committed = new Set()
    return ids
  }

  /** Pages whose content was replaced by a restore since the last call (editors drop their undo history). */
  drainResets(): string[] {
    const ids = [...this.resets]
    this.resets = new Set()
    return ids
  }

  private mark(id: string): void {
    this.pending.add(id)
  }

  private head(id: string): Head | undefined {
    return this.stmt('SELECT rid, type, parent_id, trashed_at FROM blocks WHERE id = ?').get(id) as Head | undefined
  }

  private row(id: string): Block | null {
    this.flushOrders()
    const r = this.stmt(`SELECT ${COLS} FROM blocks WHERE id = ?`).get(id) as Row | undefined
    return r ? toBlock(r) : null
  }

  private need(id: string): Block {
    const b = this.row(id)
    if (!b) throw new Error(`Block not found: ${id}`)
    return b
  }

  // ------------------------------------------------------------ linked views

  /**
   * The `sourceId` stored on the row `rid`, when it has one. Only meaningful for
   * `database` rows: callers check the type first.
   */
  private sourceOf(rid: number): string | null {
    const r = this.stmt("SELECT json_extract(props, '$.sourceId') AS source FROM blocks WHERE rid = ?").get(rid) as
      | { source: unknown }
      | undefined
    return typeof r?.source === 'string' ? r.source : null
  }

  // ---------------------------------------------------------- built-in blocks

  /** The `props.system` stored on the row `rid` when it names a built-in kind (shared/system.ts). */
  private systemOf(rid: number): string | null {
    const r = this.stmt("SELECT json_extract(props, '$.system') AS kind FROM blocks WHERE rid = ?").get(rid) as
      | { kind: unknown }
      | undefined
    return isSystemKind(r?.kind) ? r.kind : null
  }

  /** Refuses to let a built-in block go: it is part of the app, not of the user's notes. */
  private assertNotSystem(b: { rid: number }, action: string): void {
    if (this.systemOf(b.rid) !== null) throw new Error(`A built-in database cannot be ${action}`)
  }

  /**
   * Checks `props.system` as it will be written. A built-in block is born at the workspace
   * root as a page or database and keeps its kind for good; ordinary blocks never become one.
   */
  private checkSystem(props: BlockProps, type: string, parentId: string | null, before: string | null, isNew: boolean): void {
    const kind: unknown = props.system
    if (kind === undefined) {
      if (before !== null) throw new Error('A built-in database cannot stop being one')
      return
    }
    if (!isSystemKind(kind)) throw new Error('Invalid built-in kind')
    if (!isNew && before === null) throw new Error('An existing block cannot become a built-in database')
    if (!isNew && kind !== before) throw new Error('A built-in database cannot change its kind')
    if (!isPageLike(type)) throw new Error('A built-in block must be a page or database')
    if (parentId !== null) throw new Error('A built-in database lives at the workspace root')
  }

  /** True for a database row that is a linked view (it owns no rows and is never trashed). */
  private isLinked(b: { rid: number; type: string }): boolean {
    return b.type === 'database' && this.sourceOf(b.rid) !== null
  }

  /** Live linked views that point at `sourceId` (rows of pages and databases only, off the partial index). */
  private linkedViewsOf(sourceId: string): Row[] {
    return this.stmt(
      `SELECT ${COLS} FROM blocks
       WHERE type IN ('page', 'database') AND trashed_at IS NULL
         AND instr(props, '"sourceId":') > 0 AND json_extract(props, '$.sourceId') = ?
       ORDER BY created_at, rid`
    ).all(sourceId) as Row[]
  }

  /**
   * The checks every props object passes before it is written, as far as linked
   * views are concerned. `sourceId` only means something on a database; there it
   * must name an existing database that is not itself a linked view (linking to
   * a linked view links to its source), never the block itself. A linked view
   * carries no schema and no values: those always come from its source.
   *
   * The target is only looked up when the link is set or changed (`previous` is
   * the stored one), so a view whose source was deleted for good can still be
   * edited, moved and removed.
   */
  private linkProps(id: string, type: string, props: BlockProps, previous: string | null, isNew: boolean): BlockProps {
    const raw: unknown = (props as { sourceId?: unknown }).sourceId
    if (raw === undefined) return props
    if (type !== 'database') {
      const rest = { ...props }
      delete rest.sourceId
      return rest
    }
    if (!isValidId(raw)) throw new Error('Invalid sourceId')
    let sourceId: string = raw
    if (sourceId === id) throw new Error('A database cannot be a linked view of itself')
    if (sourceId !== previous) {
      const target = this.head(sourceId)
      if (!target || target.type !== 'database') throw new Error(`Source database not found: ${sourceId}`)
      const through = this.sourceOf(target.rid)
      if (through !== null) {
        // One level only: a view of a view is a view of the same source.
        const origin = isValidId(through) ? this.head(through) : undefined
        if (!origin || origin.type !== 'database' || through === id || this.sourceOf(origin.rid) !== null) {
          throw new Error('A linked view cannot point at another linked view')
        }
        sourceId = through
      }
      if (!isNew) {
        // An existing database only becomes a view while nothing depends on it being a source.
        if (this.stmt('SELECT 1 AS x FROM blocks WHERE parent_id = ? LIMIT 1').get(id)) {
          throw new Error('A database that has rows cannot become a linked view')
        }
        if (this.linkedViewsOf(id).length) throw new Error('A database that has linked views cannot become a linked view')
      }
    }
    const rest = { ...props, sourceId }
    delete rest.schema
    delete rest.values
    return rest
  }

  /** Rows live in the source: nothing may be created in, or moved into, a linked view. */
  private assertHoldsChildren(parent: Head): void {
    if (this.isLinked(parent)) throw new Error('A linked view has no rows of its own: add them to its source database')
  }

  private insertRow(b: Block): void {
    const r = this.stmt(
      `INSERT INTO blocks (id, type, parent_id, content, props, created_at, updated_at, trashed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(b.id, b.type, b.parentId, JSON.stringify(b.content), serializeProps(b.props), b.createdAt, b.updatedAt, b.trashedAt)
    // `rid` is the rowid, which both drivers report for the row just inserted.
    const rid = Number((r as { lastInsertRowid: number | bigint }).lastInsertRowid)
    // A new row has no index entry to replace.
    this.insertFts(rid, b.id, searchText(b.props))
    this.containers.delete(b.id)
    this.mark(b.id)
  }

  private insertFts(rid: number, id: string, text: string): void {
    if (text.trim()) this.stmt('INSERT INTO blocks_fts (rowid, id, text) VALUES (?, ?, ?)').run(rid, id, text)
  }

  private deleteRow(id: string, rid: number): void {
    this.stmt('DELETE FROM blocks_fts WHERE rowid = ?').run(rid)
    this.stmt('DELETE FROM blocks WHERE rid = ?').run(rid)
    this.orders.delete(id)
    this.containers.delete(id)
    this.mark(id)
  }

  // ---------------------------------------------------------- child ordering

  /** Ordered ids of the children of `parentId` (null = workspace root). */
  private order(parentId: string | null): string[] {
    if (parentId !== null) {
      const known = this.orders.get(parentId)
      if (known) return known.ids
      const r = this.stmt('SELECT content FROM blocks WHERE id = ?').get(parentId) as { content: string } | undefined
      const ids = r ? parseContent(r.content) : []
      // A batch that adds many blocks to one parent parses its child list once, not once per block.
      if (this.depth > 0) this.orders.set(parentId, { ids, at: 0, dirty: false })
      return ids
    }
    const stored = this.getSetting<unknown>(ROOT_ORDER_KEY)
    const rows = this.stmt(
      `SELECT id FROM blocks WHERE parent_id IS NULL AND trashed_at IS NULL
       AND type IN ('page', 'database') ORDER BY created_at, rid`
    ).all() as { id: string }[]
    const live = new Set(rows.map((r) => r.id))
    const out: string[] = []
    if (Array.isArray(stored)) {
      for (const id of stored) {
        if (typeof id === 'string' && live.delete(id)) out.push(id)
      }
    }
    // Self-heal: anything at the root that the stored order does not know about.
    for (const r of rows) if (live.has(r.id)) out.push(r.id)
    return out
  }

  /**
   * Records the new child list of `parentId`. The row itself is written once,
   * by flushOrders: a batch that adds or removes n children of one block would
   * otherwise rewrite that block's whole child list n times.
   */
  private setOrder(parentId: string | null, ids: string[]): void {
    if (parentId === null) {
      this.setSetting(ROOT_ORDER_KEY, ids)
      this.setSetting(ROOT_ORDER_AT_KEY, this.now())
      return
    }
    this.orders.set(parentId, { ids, at: this.now(), dirty: true })
    this.mark(parentId)
  }

  /**
   * Writes the pending child lists. Runs before anything reads a whole row and
   * before the commit. `updated_at` ends up as the latest timestamp the block
   * received in the transaction, exactly as if every list had been written at once.
   */
  private flushOrders(): void {
    if (!this.orders.size) return
    for (const [id, order] of this.orders) {
      if (!order.dirty) continue
      order.dirty = false
      this.stmt('UPDATE blocks SET content = ?, updated_at = MAX(updated_at, ?) WHERE id = ?').run(
        JSON.stringify(order.ids),
        order.at,
        id
      )
    }
  }

  private attach(parentId: string | null, id: string, afterId: string | null | undefined): void {
    const list = this.order(parentId).filter((x) => x !== id)
    let index = list.length
    if (afterId === null) index = 0
    else if (afterId !== undefined) {
      const i = list.indexOf(afterId)
      if (i >= 0) index = i + 1
    }
    list.splice(index, 0, id)
    this.setOrder(parentId, list)
  }

  private detach(parentId: string | null, id: string): void {
    if (parentId !== null && !this.head(parentId)) return
    const list = this.order(parentId)
    if (list.includes(id)) {
      this.setOrder(
        parentId,
        list.filter((x) => x !== id)
      )
    } else if (parentId === null) {
      // order() already filtered it out; persist so the stored list stays tidy.
      this.setSetting(ROOT_ORDER_KEY, list)
    }
  }

  /**
   * The page or database that holds `id` (or is `id`), null when there is none. Looked up
   * once per transaction: every edit of a block asks for it at least twice.
   */
  private containerOf(id: string | null): string | null {
    if (id === null) return null
    const known = this.containers.get(id)
    if (known !== undefined) return known
    const seen = new Set<string>()
    let cur: string | null = id
    let found: string | null = null
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const r = this.head(cur)
      if (!r) break
      if (isPageLike(r.type)) {
        found = cur
        break
      }
      cur = r.parent_id
    }
    if (this.depth > 0) this.containers.set(id, found)
    return found
  }

  /**
   * Announces a change to the page that holds `id` before it is made, so that its history
   * can keep the state it is in now (see VersionStore.beforeWrite). Returns that page.
   */
  private dirty(id: string | null): string | null {
    const page = this.containerOf(id)
    if (page !== null) this.versions.beforeWrite(page)
    return page
  }

  /**
   * Bumps updated_at of the page/database that contains `id` (or is `id`), once
   * per transaction. Only the timestamp is written: SQLite overwrites the row in
   * place, so a page with a long child list is not rewritten for it.
   */
  private touchPage(id: string | null): void {
    const page = this.containerOf(id)
    if (page === null || this.touched.has(page)) return
    this.touched.add(page)
    this.stmt('UPDATE blocks SET updated_at = ? WHERE id = ?').run(this.now(), page)
  }

  // ------------------------------------------------------------------ reads

  get(id: string): Block | null {
    return isValidId(id) ? this.row(id) : null
  }

  /** Existing blocks in the order requested; unknown ids are skipped. */
  getMany(ids: string[]): Block[] {
    const wanted = ids.filter(isValidId)
    if (!wanted.length) return []
    this.flushOrders()
    const found = new Map<string, Block>()
    for (const r of this.stmt(byIdsSql(B_COLS)).all(JSON.stringify(wanted)) as Row[]) found.set(r.id, toBlock(r))
    const out: Block[] = []
    for (const id of wanted) {
      const b = found.get(id)
      // Deleting on emit keeps repeated ids from being returned twice.
      if (b && found.delete(id)) out.push(b)
    }
    return out
  }

  /** `rootId` and its descendants by id, loaded in one statement (see subtreeSql). */
  private subtree(rootId: string, stopAtPages: boolean): Map<string, Block> {
    this.flushOrders()
    const nodes = new Map<string, Block>()
    for (const r of this.stmt(subtreeSql(B_COLS)).all(rootId, stopAtPages ? 1 : 0) as Row[]) nodes.set(r.id, toBlock(r))
    return nodes
  }

  getTree(rootId: string): Block[] {
    if (!isValidId(rootId)) return []
    const nodes = this.subtree(rootId, true)
    const root = nodes.get(rootId)
    return root ? walk(root, nodes, (ids) => this.getMany(ids)) : []
  }

  children(id: string): Block[] {
    const b = this.get(id)
    return b ? this.getMany(b.content) : []
  }

  // -------------------------------------------------------------- mutations
  //
  // Each mutation has a private form that only writes (used by `apply`, which
  // reads the affected blocks back once at the end) and a public one that wraps
  // it in a transaction and returns the resulting block.

  create(input: CreateBlockInput): Block {
    return this.write(() => this.need(this.createOne(input)))
  }

  private createOne(input: CreateBlockInput): string {
    if (!isPlain(input)) throw new Error('Invalid create input')
    assertType(input.type)
    const id = input.id ?? randomUUID()
    assertId(id)
    const parentId = input.parentId ?? null
    if (parentId !== null) assertId(parentId, 'parentId')
    if (input.afterId != null) assertId(input.afterId, 'afterId')
    if (this.head(id)) throw new Error(`Block already exists: ${id}`)
    if (parentId === null) {
      if (!isPageLike(input.type)) throw new Error('Only pages and databases can live at the workspace root')
    } else {
      const parent = this.head(parentId)
      if (!parent) throw new Error(`Block not found: ${parentId}`)
      this.assertHoldsChildren(parent)
    }
    let props = chartProps(this.linkProps(id, input.type, mergeProps({}, input.props ?? {}), null, true))
    this.checkSystem(props, input.type, parentId, null, true)
    if (input.type === 'database' && props.sourceId === undefined) props = defaultDatabaseProps(props)
    const page = this.dirty(parentId)
    if (page !== null && !isPageLike(input.type)) this.versions.noteText(page, '', searchText(props))
    const now = this.now()
    this.insertRow({ id, type: input.type, parentId, content: [], props, createdAt: now, updatedAt: now, trashedAt: null })
    this.attach(parentId, id, input.afterId)
    this.touchPage(parentId)
    return id
  }

  update(id: string, patch: UpdateBlockInput): Block {
    return this.write(() => {
      this.updateOne(id, patch)
      return this.need(id)
    })
  }

  private updateOne(id: string, patch: UpdateBlockInput): void {
    assertId(id)
    if (!isPlain(patch)) throw new Error('Invalid update patch')
    if (patch.type !== undefined) assertType(patch.type)
    // `content` is not needed here and can be the largest column of a page: it is neither read nor written.
    const r = this.stmt('SELECT rid, type, parent_id, props FROM blocks WHERE id = ?').get(id) as
      | { rid: number; type: string; parent_id: string | null; props: string }
      | undefined
    if (!r) throw new Error(`Block not found: ${id}`)
    const before = parseProps(r.props)
    const oldType = isBlockType(r.type) ? r.type : 'text'
    const type = patch.type ?? oldType
    if (r.parent_id === null && !isPageLike(type)) {
      throw new Error('A workspace-root block must stay a page or database')
    }
    const linkedBefore = oldType === 'database' && typeof before.sourceId === 'string' ? before.sourceId : null
    let props = chartProps(this.linkProps(id, type, mergeProps(before, patch.props), linkedBefore, false))
    const systemBefore = isPageLike(oldType) && isSystemKind(before.system) ? before.system : null
    if (systemBefore !== null && type !== oldType) throw new Error('A built-in database cannot change its type')
    this.checkSystem(props, type, r.parent_id, systemBefore, false)
    // A block that becomes a database, or stops being a linked view, needs a schema of its own.
    if (type === 'database' && props.sourceId === undefined && (oldType !== 'database' || linkedBefore !== null)) {
      props = defaultDatabaseProps(props)
    }
    // History: a page's own props belong to its snapshot; a row's title and values, and a
    // linked view as a whole, also belong to the snapshot of what holds them.
    let page: string | null = null
    if (isPageLike(r.type)) {
      this.versions.beforeWrite(id)
      if (r.parent_id !== null && (linkedBefore !== null || this.head(r.parent_id)?.type === 'database')) this.dirty(r.parent_id)
    } else page = this.dirty(r.parent_id)
    if (type === r.type) {
      this.stmt('UPDATE blocks SET props = ?, updated_at = ? WHERE rid = ?').run(serializeProps(props), this.now(), r.rid)
    } else {
      this.stmt('UPDATE blocks SET type = ?, props = ?, updated_at = ? WHERE rid = ?').run(
        type,
        serializeProps(props),
        this.now(),
        r.rid
      )
    }
    // The search index is only touched when the indexed text itself changed.
    const text = searchText(props)
    const textBefore = searchText(before)
    if (text !== textBefore) {
      this.stmt('DELETE FROM blocks_fts WHERE rowid = ?').run(r.rid)
      this.insertFts(r.rid, id, text)
      if (page !== null) this.versions.noteText(page, textBefore, text)
    }
    this.mark(id)
    // The block's own updated_at was just bumped; only non-pages bubble up to their page.
    this.touched.add(id)
    if (!isPageLike(type)) this.touchPage(r.parent_id)
  }

  move(id: string, parentId: string | null, afterId?: string | null): Block {
    return this.write(() => {
      this.moveOne(id, parentId, afterId)
      return this.need(id)
    })
  }

  private moveOne(id: string, parentId: string | null, afterId?: string | null): void {
    assertId(id)
    if (parentId !== null) assertId(parentId, 'parentId')
    if (afterId != null) assertId(afterId, 'afterId')
    const b = this.head(id)
    if (!b) throw new Error(`Block not found: ${id}`)
    if (b.trashed_at != null) throw new Error('Cannot move a block that is in the trash')
    // Reordering among the root pages is fine; leaving the root is not.
    if (parentId !== null && isPageLike(b.type)) this.assertNotSystem(b, 'moved into a page')
    if (parentId === null) {
      if (!isPageLike(b.type)) throw new Error('Only pages and databases can live at the workspace root')
    } else {
      const parent = this.head(parentId)
      if (!parent) throw new Error(`Block not found: ${parentId}`)
      if (parentId !== b.parent_id) this.assertHoldsChildren(parent)
      // Walk up from the target: reaching `id` means the move would create a cycle.
      const seen = new Set<string>()
      let cur: string | null = parentId
      while (cur !== null && !seen.has(cur)) {
        if (cur === id) throw new Error('Cannot move a block into itself or one of its descendants')
        seen.add(cur)
        cur = this.head(cur)?.parent_id ?? null
      }
    }
    if (afterId === id && parentId === b.parent_id) return
    this.dirty(b.parent_id)
    this.dirty(parentId)
    this.touchPage(b.parent_id)
    this.detach(b.parent_id, id)
    this.stmt('UPDATE blocks SET parent_id = ?, updated_at = ? WHERE rid = ?').run(parentId, this.now(), b.rid)
    // What was known about the blocks below the moved one no longer holds.
    this.containers = new Map()
    this.attach(parentId, id, afterId === id ? undefined : afterId)
    this.mark(id)
    this.touchPage(parentId)
  }

  delete(id: string): void {
    this.write(() => this.deleteOne(id))
  }

  private deleteOne(id: string): void {
    assertId(id)
    const b = this.head(id)
    if (!b) return
    if (isPageLike(b.type)) this.assertNotSystem(b, 'deleted')
    const page = this.dirty(b.parent_id)
    // A linked view holds no data: it is removed like an ordinary block, and its source is not touched.
    if (isPageLike(b.type) && !this.isLinked(b)) {
      if (b.trashed_at != null) return
      this.touchPage(b.parent_id)
      // parent_id is kept so `restore` can put the page back where it was.
      this.detach(b.parent_id, id)
      const now = this.now()
      this.stmt('UPDATE blocks SET trashed_at = ?, updated_at = ? WHERE rid = ?').run(now, now, b.rid)
      this.mark(id)
    } else {
      this.touchPage(b.parent_id)
      if (b.trashed_at == null) this.detach(b.parent_id, id)
      const removed = this.purge(id, true)
      if (page !== null) this.versions.noteDeleted(page, removed)
    }
  }

  /**
   * Removes a block and its descendants for good. With `keepPages`, nested
   * pages/databases are moved to the trash instead (their parent disappears,
   * so restoring them later lands at the workspace root); nested linked views
   * have nothing to keep and go with their holder. Returns how many blocks left
   * the document.
   */
  private purge(id: string, keepPages: boolean): number {
    const root = this.head(id)
    const stack: { id: string; rid: number | undefined; type: string }[] = [{ id, rid: root?.rid, type: root?.type ?? '' }]
    const seen = new Set<string>()
    let removed = 0
    while (stack.length) {
      const cur = stack.pop() as { id: string; rid: number | undefined; type: string }
      if (seen.has(cur.id)) continue
      seen.add(cur.id)
      const kids = this.stmt('SELECT rid, id, type, trashed_at FROM blocks WHERE parent_id = ?').all(cur.id) as {
        rid: number
        id: string
        type: string
        trashed_at: number | null
      }[]
      for (const k of kids) {
        if (isPageLike(k.type) && k.trashed_at != null) {
          // Trashed on its own earlier: it stays in the trash as a separate entry.
          continue
        }
        if (keepPages && isPageLike(k.type) && !this.isLinked(k)) {
          const now = this.now()
          this.stmt('UPDATE blocks SET trashed_at = ?, updated_at = ? WHERE rid = ?').run(now, now, k.rid)
          this.mark(k.id)
          removed++
        } else {
          stack.push({ id: k.id, rid: k.rid, type: k.type })
        }
      }
      if (cur.rid !== undefined) {
        this.deleteRow(cur.id, cur.rid)
        removed++
        // A page that is gone for good takes its history with it.
        if (isPageLike(cur.type)) this.versions.dropPage(cur.id)
      }
    }
    return removed
  }

  /**
   * Inserts a whole block tree under `parentId` in one transaction and returns
   * its root. Unlike a batch of `create` ops this writes every row exactly once
   * (no rewrite of the parent's content per child), so large imports stay linear.
   */
  createTree(root: TreeInput, parentId: string | null, afterId?: string | null): Block {
    if (parentId !== null) assertId(parentId, 'parentId')
    if (afterId != null) assertId(afterId, 'afterId')
    interface Frame {
      id: string
      node: TreeInput
      parentId: string | null
      content: string[]
      next: number
    }
    return this.transaction(() => {
      if (parentId === null) {
        if (!isPageLike(root.type)) throw new Error('Only pages and databases can live at the workspace root')
      } else {
        const parent = this.head(parentId)
        if (!parent) throw new Error(`Block not found: ${parentId}`)
        this.assertHoldsChildren(parent)
      }
      this.dirty(parentId)
      const rootId = randomUUID()
      // Explicit stack (post-order): a row is written once the ids of its children are known.
      const stack: Frame[] = [{ id: rootId, node: root, parentId, content: [], next: 0 }]
      while (stack.length) {
        const frame = stack[stack.length - 1]
        const kids = frame.node.children ?? []
        if (frame.next < kids.length) {
          const id = randomUUID()
          frame.content.push(id)
          stack.push({ id, node: kids[frame.next++], parentId: frame.id, content: [], next: 0 })
          continue
        }
        stack.pop()
        assertType(frame.node.type)
        let props = chartProps(this.linkProps(frame.id, frame.node.type, mergeProps({}, frame.node.props ?? {}), null, true))
        // Trees are imports, AI proposals and restored copies: none of them is the built-in block itself.
        if (props.system !== undefined) {
          props = { ...props }
          delete props.system
        }
        if (frame.node.type === 'database' && props.sourceId === undefined) props = defaultDatabaseProps(props)
        const now = this.now()
        this.insertRow({
          id: frame.id,
          type: frame.node.type,
          parentId: frame.parentId,
          content: frame.content,
          props,
          createdAt: now,
          updatedAt: now,
          trashedAt: null
        })
      }
      this.attach(parentId, rootId, afterId)
      this.touchPage(parentId)
      return this.need(rootId)
    })
  }

  /** Atomic batch. Returns the affected blocks (deleted ones omitted), each read once. */
  apply(ops: Op[]): Block[] {
    if (!Array.isArray(ops)) throw new Error('ops must be an array')
    return this.write(() => {
      for (const op of ops) {
        if (!isPlain(op)) throw new Error('Invalid op')
        switch (op.op) {
          case 'create':
            this.createOne(op.input)
            break
          case 'update':
            this.updateOne(op.id, op.patch)
            break
          case 'move':
            this.moveOne(op.id, op.parentId, op.afterId)
            break
          case 'delete':
            this.deleteOne(op.id)
            break
          default:
            throw new Error(`Unknown op: ${String((op as { op?: unknown }).op)}`)
        }
      }
      return this.getMany([...this.pending])
    })
  }

  restore(id: string): void {
    assertId(id)
    this.transaction(() => {
      const b = this.head(id)
      if (!b) throw new Error(`Block not found: ${id}`)
      if (b.trashed_at == null) return
      const parentAlive = b.parent_id !== null && liveFilter(this.lineage([b.parent_id]))(b.parent_id)
      const parentId = parentAlive ? b.parent_id : null
      if (parentId === null && !isPageLike(b.type)) throw new Error('Only pages and databases can be restored to the root')
      this.dirty(parentId)
      this.stmt('UPDATE blocks SET trashed_at = NULL, parent_id = ?, updated_at = ? WHERE rid = ?').run(
        parentId,
        this.now(),
        b.rid
      )
      this.attach(parentId, id, undefined)
      this.mark(id)
    })
  }

  deleteForever(id: string): void {
    assertId(id)
    this.transaction(() => {
      const b = this.head(id)
      if (!b) return
      if (isPageLike(b.type)) this.assertNotSystem(b, 'deleted')
      if (b.trashed_at == null) {
        this.dirty(b.parent_id)
        this.detach(b.parent_id, id)
      }
      this.purge(id, false)
    })
  }

  duplicate(id: string): Block {
    assertId(id)
    interface Frame {
      src: Block
      id: string
      parentId: string | null
      kids: Block[]
      content: string[]
      next: number
    }
    return this.transaction(() => {
      const src = this.need(id)
      if (src.trashedAt !== null) throw new Error('Cannot duplicate a block that is in the trash')
      // The copy starts a history of its own: versions of the source are not copied.
      this.dirty(src.parentId)
      // The whole source (nested pages included) is read in one statement, then copied bottom-up.
      const nodes = this.subtree(id, false)
      const load = (ids: string[]): Block[] => this.getMany(ids)
      const kidsOf = (b: Block): Block[] => pick(b.content, nodes, load).filter((k) => k.trashedAt === null)
      const rootId = randomUUID()
      // Copies in the order they are written, and which copy stands for which source block.
      const copies: Block[] = []
      const copyOf = new Map<string, string>([[src.id, rootId]])
      // Source ids on the path being copied: corrupt rows that form a cycle are copied once, not forever.
      const path = new Set<string>([src.id])
      const stack: Frame[] = [{ src, id: rootId, parentId: src.parentId, kids: kidsOf(src), content: [], next: 0 }]
      while (stack.length) {
        const frame = stack[stack.length - 1]
        if (frame.next < frame.kids.length) {
          const kid = frame.kids[frame.next++]
          if (path.has(kid.id)) continue
          path.add(kid.id)
          const kidId = randomUUID()
          frame.content.push(kidId)
          copyOf.set(kid.id, kidId)
          stack.push({ src: kid, id: kidId, parentId: frame.id, kids: kidsOf(kid), content: [], next: 0 })
          continue
        }
        stack.pop()
        path.delete(frame.src.id)
        const props: BlockProps = JSON.parse(JSON.stringify(frame.src.props))
        if (frame.id === rootId && isPageLike(frame.src.type)) {
          const title = Array.isArray(props.title) ? props.title : []
          // A linked view without a title of its own keeps showing its source's.
          if (title.length || typeof props.sourceId !== 'string') props.title = [...title, [' (copy)']]
          delete props.favorite
        }
        // A copy of a built-in database is an ordinary one: there is only ever one of each.
        delete props.system
        const now = this.now()
        copies.push({
          id: frame.id,
          type: frame.src.type,
          parentId: frame.parentId,
          content: frame.content,
          props,
          createdAt: now,
          updatedAt: now,
          trashedAt: null
        })
      }
      // Relations follow the copy where their database was copied too, and a duplicated row
      // shows up on the other side of its two-way relations (shared/relation.ts).
      const relinked = relinkDuplicate(copies, copyOf, { get: (blockId) => this.get(blockId) })
      for (const copy of copies) {
        // A linked view copied together with its source follows the copy; any other keeps its source.
        const source = copy.type === 'database' && typeof copy.props.sourceId === 'string' ? copyOf.get(copy.props.sourceId) : undefined
        if (source !== undefined && source !== copy.id) copy.props.sourceId = source
        this.insertRow(copy)
      }
      for (const [rowId, values] of relinked) this.updateOne(rowId, { props: { values } })
      this.attach(src.parentId, rootId, src.id)
      this.touchPage(src.parentId)
      return this.need(rootId)
    })
  }

  // ------------------------------------------------------------------- pages

  listRoot(): Block[] {
    return this.getMany(this.order(null))
  }

  /** Sub-pages and databases shown under `pageId` in the sidebar, in document order. */
  listChildren(pageId: string): Block[] {
    if (!isValidId(pageId)) return []
    // The walk needs every block's child list but nobody's props: only the pages found are loaded in full.
    const columns = 'b.id, b.type, b.content, b.trashed_at'
    type Outline = { id: string; type: string; content: string; trashed_at: number | null }
    const node = (r: Outline): TreeNode => ({ id: r.id, type: r.type, content: parseContent(r.content), trashedAt: r.trashed_at })
    this.flushOrders()
    const nodes = new Map<string, TreeNode>()
    for (const r of this.stmt(subtreeSql(columns)).all(pageId, 1) as Outline[]) nodes.set(r.id, node(r))
    const root = nodes.get(pageId)
    if (!root) return []
    const load = (ids: string[]): TreeNode[] =>
      (this.stmt(byIdsSql(columns)).all(JSON.stringify(ids)) as Outline[]).map(node)
    const pages = walk(root, nodes, load).filter((b) => b.id !== pageId && isPageLike(b.type))
    return this.getMany(pages.map((b) => b.id))
  }

  listFavorites(): Block[] {
    // The substring test skips the JSON parser for every page that is not a favourite.
    const rows = this.stmt(
      `SELECT ${COLS} FROM blocks
       WHERE type IN ('page', 'database') AND trashed_at IS NULL
         AND instr(props, '"favorite":') > 0 AND json_extract(props, '$.favorite') = 1
       ORDER BY created_at, rid`
    ).all() as Row[]
    const live = liveFilter(this.lineage(rows.map((r) => r.id)))
    return rows.filter((r) => live(r.id)).map(toBlock)
  }

  listRecent(limit = 20): Block[] {
    const n = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 20))
    const out: Block[] = []
    const s = this.stmt(
      `SELECT ${COLS} FROM blocks
       WHERE type IN ('page', 'database') AND trashed_at IS NULL
       ORDER BY updated_at DESC, rid DESC LIMIT ? OFFSET ?`
    )
    // Page through so pages hidden inside trashed subtrees cannot starve the result.
    for (let offset = 0; out.length < n; offset += n * 2) {
      const rows = s.all(n * 2, offset) as Row[]
      const live = liveFilter(this.lineage(rows.map((r) => r.id)))
      for (const r of rows) {
        if (out.length < n && live(r.id)) out.push(toBlock(r))
      }
      if (rows.length < n * 2) break
    }
    return out
  }

  listTrash(): Block[] {
    const rows = this.stmt(
      `SELECT ${COLS} FROM blocks WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC, rid DESC`
    ).all() as Row[]
    return rows.map(toBlock)
  }

  // --------------------------------------------------------------- databases

  /**
   * Databases a linked view can point at: not in the trash (nor inside something
   * that is), not themselves linked views; most recently edited first.
   */
  listDatabases(): Block[] {
    const rows = this.stmt(
      `SELECT ${COLS} FROM blocks
       WHERE type IN ('page', 'database') AND trashed_at IS NULL
         AND type = 'database' AND json_extract(props, '$.sourceId') IS NULL
       ORDER BY updated_at DESC, rid DESC`
    ).all() as Row[]
    const live = liveFilter(this.lineage(rows.map((r) => r.id)))
    return rows.filter((r) => live(r.id)).map(toBlock)
  }

  /**
   * Every live linked view of a source database with the page that contains it
   * (null at the workspace root), oldest first. Asked about a linked view, it
   * answers for that view's source.
   */
  databaseLocations(sourceId: string): DatabaseLocation[] {
    if (!isValidId(sourceId)) return []
    const asked = this.head(sourceId)
    const through = asked && asked.type === 'database' ? this.sourceOf(asked.rid) : null
    const source = through !== null && isValidId(through) ? through : sourceId
    const rows = this.linkedViewsOf(source).filter((r) => r.type === 'database' && r.id !== source)
    if (!rows.length) return []
    const links = this.lineage(rows.map((r) => r.id))
    const live = liveFilter(links)
    const found: { block: Block; pageId: string | null }[] = []
    for (const r of rows) {
      if (!live(r.id)) continue
      const above = pagesAbove(r.id, links)
      found.push({ block: toBlock(r), pageId: above.length ? above[above.length - 1].id : null })
    }
    const pages = new Map(this.getMany(found.flatMap((f) => (f.pageId ? [f.pageId] : []))).map((b) => [b.id, b]))
    return found.map((f) => ({ block: f.block, page: (f.pageId && pages.get(f.pageId)) || null }))
  }

  // --------------------------------------------------------------- ancestry

  /** The given blocks and all their ancestors by id, without content (one statement). */
  private lineage(ids: string[]): Map<string, Link> {
    const links = new Map<string, Link>()
    if (!ids.length) return links
    for (const l of this.stmt(LINEAGE_SQL).all(JSON.stringify(ids)) as Link[]) links.set(l.id, l)
    return links
  }

  ancestors(id: string): Block[] {
    if (!isValidId(id)) return []
    return this.getMany(pagesAbove(id, this.lineage([id])).map((l) => l.id))
  }

  // ------------------------------------------------------------------ search

  search(text: string, limit = 20): SearchResult[] {
    return searchBlocks(
      {
        all: (sql, ...params) => this.stmt(sql).all(...params),
        lineage: (ids) => this.lineage(ids),
        getMany: (ids) => this.getMany(ids)
      },
      text,
      limit
    )
  }

  // ---------------------------------------------------------------- versions

  /** Versions of a page, newest first, without their content. */
  listVersions(pageId: string): VersionInfo[] {
    return isValidId(pageId) ? this.versions.list(pageId) : []
  }

  getVersion(id: string): VersionSnapshot {
    assertId(id, 'version id')
    return this.versions.read(id)
  }

  /** The page as it is now, in the shape of a version. */
  currentVersion(pageId: string): VersionSnapshot {
    assertId(pageId)
    const snapshot = this.versions.current(pageId)
    if (!snapshot) throw new Error('Page not found')
    return snapshot
  }

  /** Stores the current state of a page as a saved version, optionally named. */
  saveVersion(pageId: string, label?: string | null): VersionInfo {
    assertId(pageId)
    if (label != null && typeof label !== 'string') throw new Error('Invalid version name')
    const b = this.head(pageId)
    if (!b || !isPageLike(b.type)) throw new Error('Page not found')
    return this.versions.save(pageId, label?.trim().slice(0, MAX_VERSION_LABEL) || null)
  }

  renameVersion(id: string, label: string | null): VersionInfo {
    assertId(id, 'version id')
    if (label !== null && typeof label !== 'string') throw new Error('Invalid version name')
    return this.versions.rename(id, label)
  }

  deleteVersion(id: string): void {
    assertId(id, 'version id')
    this.versions.remove(id)
  }

  versionStats(pageId?: string): VersionStats {
    if (pageId !== undefined) assertId(pageId)
    return this.versions.stats(pageId)
  }

  /** Deletes the history of one page, or of every page. */
  clearVersions(pageId?: string): void {
    if (pageId !== undefined) assertId(pageId)
    this.versions.clear(pageId)
  }

  /** Stores the latest state of every page edited since its last version (run when the app quits). */
  flushVersions(): number {
    return this.versions.flush()
  }

  /** One bounded slice of history housekeeping; true once everything has been visited. */
  maintainVersions(maxPages?: number): boolean {
    return this.versions.maintain(maxPages)
  }

  /**
   * Brings a version back. `replace` first stores the current state (a `restore` version),
   * then makes the page equal to the snapshot; `copy` builds a new sibling page from it.
   * Either way nothing that lives outside the snapshot is destroyed: see restoreReplace.
   */
  restoreVersion(versionId: string, mode: RestoreMode): RestoreResult {
    assertId(versionId, 'version id')
    if (mode !== 'replace' && mode !== 'copy') throw new Error('Invalid restore mode')
    return this.transaction(() => {
      const version = this.versions.read(versionId)
      const root = this.row(version.rootId)
      if (!root || !isPageLike(root.type)) throw new Error('The page of this version no longer exists')
      if (root.trashedAt !== null) throw new Error('This page is in the Trash. Restore it first.')
      const was = version.blocks[0]
      if (was.type !== root.type || (sourceIdOf(was) === null) !== (sourceIdOf(root) === null)) {
        throw new Error('This version was saved when the page was a different kind of block')
      }
      return mode === 'copy' ? this.restoreCopy(version, root) : this.restoreReplace(version, root)
    })
  }

  /** True when `ancestorId` is `id` or one of the blocks above it. */
  private isInside(id: string, ancestorId: string): boolean {
    const seen = new Set<string>()
    let cur: string | null = id
    while (cur !== null && !seen.has(cur)) {
      if (cur === ancestorId) return true
      seen.add(cur)
      cur = this.head(cur)?.parent_id ?? null
    }
    return false
  }

  /** Writes `next` over the stored block `cur` (or inserts it), touching nothing when they are equal. */
  private putBlock(next: Omit<Block, 'updatedAt' | 'trashedAt'>, cur: Block | null, now: number): void {
    if (!cur) {
      this.insertRow({ ...next, createdAt: next.createdAt || now, updatedAt: now, trashedAt: null })
      return
    }
    const content = JSON.stringify(next.content)
    const same =
      cur.type === next.type &&
      cur.parentId === next.parentId &&
      JSON.stringify(cur.content) === content &&
      canonicalJson(cur.props) === canonicalJson(next.props)
    if (same) return
    const h = this.head(cur.id)
    if (!h) return
    this.stmt('UPDATE blocks SET type = ?, parent_id = ?, content = ?, props = ?, updated_at = ? WHERE rid = ?').run(
      next.type,
      next.parentId,
      content,
      serializeProps(next.props),
      now,
      h.rid
    )
    const text = searchText(next.props)
    if (text !== searchText(cur.props)) {
      this.stmt('DELETE FROM blocks_fts WHERE rowid = ?').run(h.rid)
      this.insertFts(h.rid, cur.id, text)
    }
    // The child list was written here, not through the pending orders.
    this.orders.delete(cur.id)
    this.mark(cur.id)
  }

  /**
   * Makes a page's own content equal to a snapshot, in the open transaction.
   * - Blocks that still belong to the page keep their ids and are updated or moved; missing
   *   ones come back under their original id when it is free, a new one otherwise; blocks the
   *   snapshot does not have are removed.
   * - Nested pages and databases (and the rows of a database) named by the snapshot are put
   *   back where they were: taken out of the trash, or moved back; one that was deleted
   *   forever is reported. Rows also get their title, icon and values back.
   * - Nested pages and rows created after the snapshot are never removed: they are kept at
   *   the end of the page.
   */
  private restoreReplace(version: VersionSnapshot, root: Block): RestoreResult {
    const pageId = root.id
    const notes: string[] = []
    const stamp = formatStamp(version.info?.createdAt ?? this.clock())
    const backup = this.versions.capture(pageId, 'restore', `${RESTORE_LABEL_PREFIX}${stamp}`, true)
    const now = this.now()
    const current = this.getTree(pageId)
    const curById = new Map(current.map((b) => [b.id, b]))
    const isNested = (b: Block): boolean => isPageLike(b.type) && sourceIdOf(b) === null
    const snapRoot = version.blocks[0]
    const snapBlocks = version.blocks.slice(1)

    // Which id each snapshot block gets.
    const idOf = new Map<string, string>([[snapRoot.id, pageId]])
    const reused = new Set<string>()
    for (const b of snapBlocks) {
      const cur = curById.get(b.id)
      if (cur && cur.id !== pageId && !isNested(cur)) {
        idOf.set(b.id, b.id)
        reused.add(b.id)
      } else idOf.set(b.id, this.head(b.id) ? randomUUID() : b.id)
    }
    const parentOf = new Map<string, string>()
    for (const b of version.blocks) for (const child of b.content) parentOf.set(child, b.id)

    // Nested pages, databases and rows the snapshot names: back to where they were.
    const kept = new Set<string>()
    const gone: string[] = []
    const adopt = (id: string, title: string): void => {
      const h = this.head(id)
      if (!h || !isPageLike(h.type) || this.isLinked(h)) {
        gone.push(title)
        return
      }
      if (this.isInside(pageId, id)) {
        notes.push(`"${title}" now contains this page and was left where it is.`)
        return
      }
      const parent = idOf.get(parentOf.get(id) ?? snapRoot.id) ?? pageId
      if (h.trashed_at != null) {
        this.stmt('UPDATE blocks SET trashed_at = NULL, parent_id = ?, updated_at = ? WHERE rid = ?').run(parent, now, h.rid)
        this.mark(id)
      } else if (h.parent_id !== parent) {
        // Held by a block of this page: that block is rewritten or removed below. Elsewhere: taken out of there.
        if (h.parent_id === null || !curById.has(h.parent_id)) {
          this.dirty(h.parent_id)
          this.touchPage(h.parent_id)
          this.detach(h.parent_id, id)
        }
        this.stmt('UPDATE blocks SET parent_id = ?, updated_at = ? WHERE rid = ?').run(parent, now, h.rid)
        this.mark(id)
      }
      kept.add(id)
    }
    for (const ref of version.refs) adopt(ref.id, ref.title || 'Untitled')
    for (const row of version.rows ?? []) adopt(row.id, plainText(row.title) || 'Untitled')
    if (gone.length) {
      const names = gone
        .slice(0, 5)
        .map((title) => `"${title}"`)
        .join(', ')
      const one = gone.length === 1
      const what = version.rows ? (one ? 'row was' : 'rows were') : one ? 'sub-page was' : 'sub-pages were'
      notes.push(`${gone.length} ${what} deleted forever and could not be brought back: ${names}${gone.length > 5 ? '…' : ''}.`)
    }

    // Nested pages and rows made since: kept, at the end of the page.
    const extras: string[] = []
    for (const cur of current) {
      if (cur.id === pageId || !isNested(cur) || kept.has(cur.id)) continue
      extras.push(cur.id)
      if (cur.parentId !== pageId) {
        this.stmt('UPDATE blocks SET parent_id = ?, updated_at = ? WHERE id = ?').run(pageId, now, cur.id)
        this.mark(cur.id)
      }
    }

    const contentFor = (b: SnapshotBlock): string[] => {
      const out: string[] = []
      for (const child of b.content) {
        if (kept.has(child)) out.push(child)
        else if (child !== snapRoot.id && idOf.has(child)) out.push(idOf.get(child) as string)
      }
      return out
    }

    for (const b of snapBlocks) {
      const id = idOf.get(b.id) as string
      const parentId = idOf.get(b.parentId ?? snapRoot.id) ?? pageId
      this.putBlock(
        { id, type: b.type, parentId, content: contentFor(b), props: b.props, createdAt: b.createdAt },
        reused.has(b.id) ? (curById.get(b.id) as Block) : null,
        now
      )
    }
    for (const cur of current) {
      if (cur.id === pageId || isNested(cur) || reused.has(cur.id)) continue
      const h = this.head(cur.id)
      if (h) this.deleteRow(cur.id, h.rid)
    }

    // Rows show their title, icon and values as the snapshot had them; the rest of a row is its own.
    for (const row of version.rows ?? []) {
      if (!kept.has(row.id)) continue
      const cur = this.row(row.id)
      if (!cur) continue
      const props: BlockProps = { ...cur.props, title: row.title, values: row.values }
      if (row.icon !== undefined) props.icon = row.icon
      else delete props.icon
      this.putBlock({ id: cur.id, type: cur.type, parentId: pageId, content: cur.content, props, createdAt: cur.createdAt }, cur, now)
    }

    const props: BlockProps = { ...snapRoot.props }
    if (root.props.favorite !== undefined) props.favorite = root.props.favorite
    const rootNow = this.need(pageId)
    this.putBlock(
      {
        id: pageId,
        type: root.type,
        parentId: rootNow.parentId,
        content: [...contentFor(snapRoot), ...extras],
        props,
        createdAt: root.createdAt
      },
      rootNow,
      now
    )
    // Restoring is an edit of the page, even one that changed nothing.
    this.stmt('UPDATE blocks SET updated_at = ? WHERE id = ?').run(now, pageId)
    this.touched.add(pageId)
    this.mark(pageId)
    this.pendingResets.add(pageId)
    this.versions.noteRestored(pageId, version.info?.textSize ?? 0)
    return { pageId, backupId: backup.info?.id ?? null, notes }
  }

  /** A new page next to the original, built from the snapshot with fresh ids. */
  private restoreCopy(version: VersionSnapshot, root: Block): RestoreResult {
    const notes: string[] = []
    const byId = new Map(version.blocks.map((b) => [b.id, b]))
    const rows = new Map((version.rows ?? []).map((r) => [r.id, r]))
    let pages = 0
    let views = 0
    const build = (b: SnapshotBlock): TreeInput => {
      const children: TreeInput[] = []
      for (const id of b.content) {
        const row = rows.get(id)
        if (row) {
          const props: BlockProps = { title: row.title, values: row.values }
          if (row.icon !== undefined) props.icon = row.icon
          children.push({ type: 'page', props })
          continue
        }
        const child = byId.get(id)
        if (!child) {
          // A nested page or database: it exists once, in the original.
          pages++
          continue
        }
        const source = sourceIdOf(child)
        if (source !== null && this.head(source)?.type !== 'database') {
          views++
          continue
        }
        children.push(build(child))
      }
      return { type: b.type, props: b.props, children }
    }
    const tree = build(version.blocks[0])
    const props: BlockProps = { ...tree.props }
    const title = Array.isArray(props.title) ? props.title : []
    const stamp = formatStamp(version.info?.createdAt ?? this.clock())
    // A linked view without a title of its own keeps showing its source's.
    if (title.length || sourceIdOf(root) === null) props.title = [...title, [` (restored ${stamp})`]]
    delete props.favorite
    tree.props = props
    const copy = this.createTree(tree, root.parentId, root.id)
    if (pages) notes.push(`${pages} ${pages === 1 ? 'sub-page was not copied and stays' : 'sub-pages were not copied and stay'} in the original page.`)
    if (views) notes.push(`${views} linked ${views === 1 ? 'view was' : 'views were'} left out because the database no longer exists.`)
    return { pageId: copy.id, backupId: null, notes }
  }

  // -------------------------------------------------------------------- sync
  //
  // What ../sync needs from the database: the stored rows as they are, the order of the
  // root, the per-page export state, and one transaction that writes a merged workspace.

  /** Every stored block row, unparsed. */
  syncRows(): Row[] {
    this.flushOrders()
    return this.stmt(`SELECT ${COLS} FROM blocks`).all() as Row[]
  }

  /** Ids at the workspace root, in order, and when that order last changed. */
  rootOrder(): { order: string[]; at: number } {
    const at = this.getSetting<unknown>(ROOT_ORDER_AT_KEY)
    return { order: this.order(null), at: typeof at === 'number' && Number.isFinite(at) ? at : 0 }
  }

  /** The fingerprint each page had when it was last uploaded. */
  syncStates(): Map<string, string> {
    const out = new Map<string, string>()
    for (const r of this.stmt('SELECT page_id, hash FROM sync_state').all() as { page_id: string; hash: string }[]) out.set(r.page_id, r.hash)
    return out
  }

  /** Replaces the export state: `states` is everything that is uploaded now. */
  setSyncStates(states: ReadonlyMap<string, string>, settings: Record<string, unknown> = {}): void {
    this.transaction(() => {
      this.writeSyncStates(states)
      for (const [key, value] of Object.entries(settings)) this.setSetting(key, value)
    })
  }

  private writeSyncStates(states: ReadonlyMap<string, string>): void {
    const before = this.syncStates()
    const at = this.clock()
    for (const id of before.keys()) if (!states.has(id)) this.stmt('DELETE FROM sync_state WHERE page_id = ?').run(id)
    for (const [id, hash] of states) {
      if (before.get(id) === hash) continue
      this.stmt(
        'INSERT INTO sync_state (page_id, hash, exported_at) VALUES (?, ?, ?) ON CONFLICT(page_id) DO UPDATE SET hash = excluded.hash, exported_at = excluded.exported_at'
      ).run(id, hash, at)
    }
  }

  clearSyncStates(): void {
    this.stmt('DELETE FROM sync_state').run()
  }

  /**
   * Writes the outcome of a sync in one transaction: versions of what is about to be replaced
   * first, then the blocks exactly as merged (their timestamps included, which is what makes
   * the next merge see them as unchanged), the root order, and the settings that say which
   * commit this state corresponds to. The search index, the change feed and the version
   * history are kept up to date like for any other mutation. `states` is asked, once
   * everything is written, for the export state that goes with it.
   */
  applySync(change: SyncChange, states?: () => ReadonlyMap<string, string>): void {
    this.transaction(() => {
      for (const { pageId, label } of change.snapshots) {
        const h = this.head(pageId)
        if (h && isPageLike(h.type)) this.versions.capture(pageId, 'sync', label.slice(0, MAX_VERSION_LABEL), true)
      }
      for (const { pageId, label, tree } of change.foreign) {
        const h = this.head(pageId)
        if (!h || !isPageLike(h.type)) continue
        const snapshot = buildSnapshot(tree.map((b) => ({ ...b, props: chartProps(mergeProps({}, b.props)) })))
        if (snapshot) this.versions.storeSnapshot(pageId, snapshot, 'sync', label.slice(0, MAX_VERSION_LABEL))
      }
      // The ordinary capture policy applies to every page about to change.
      for (const pageId of change.resetPages) {
        const h = this.head(pageId)
        if (h && isPageLike(h.type)) this.versions.beforeWrite(pageId)
      }
      for (const id of change.remove) {
        assertId(id)
        const h = this.head(id)
        if (!h) continue
        this.deleteRow(id, h.rid)
        if (isPageLike(h.type)) this.versions.dropPage(id)
      }
      const stamp = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
      let latest = this.lastNow
      for (const b of change.put) {
        assertId(b.id)
        assertType(b.type)
        if (b.parentId !== null) assertId(b.parentId, 'parentId')
        const content = b.content.filter(isValidId)
        const props = chartProps(mergeProps({}, b.props))
        const trashedAt = b.trashedAt === null || !isPageLike(b.type) ? null : stamp(b.trashedAt)
        const updatedAt = stamp(b.updatedAt)
        latest = Math.max(latest, updatedAt)
        const r = this.stmt('SELECT rid, props FROM blocks WHERE id = ?').get(b.id) as { rid: number; props: string } | undefined
        if (!r) {
          this.insertRow({ id: b.id, type: b.type, parentId: b.parentId, content, props, createdAt: stamp(b.createdAt), updatedAt, trashedAt })
          continue
        }
        this.stmt(
          'UPDATE blocks SET type = ?, parent_id = ?, content = ?, props = ?, created_at = ?, updated_at = ?, trashed_at = ? WHERE rid = ?'
        ).run(b.type, b.parentId, JSON.stringify(content), serializeProps(props), stamp(b.createdAt), updatedAt, trashedAt, r.rid)
        const text = searchText(props)
        if (text !== searchText(parseProps(r.props))) {
          this.stmt('DELETE FROM blocks_fts WHERE rowid = ?').run(r.rid)
          this.insertFts(r.rid, b.id, text)
        }
        this.orders.delete(b.id)
        this.mark(b.id)
      }
      // Edits made here from now on are later than anything that was just received.
      this.lastNow = latest
      if (change.root) {
        this.setSetting(ROOT_ORDER_KEY, change.root.order.filter(isValidId))
        this.setSetting(ROOT_ORDER_AT_KEY, stamp(change.root.at))
      }
      for (const [key, value] of Object.entries(change.settings)) this.setSetting(key, value)
      for (const pageId of change.resetPages) {
        if (!this.head(pageId)) continue
        this.pendingResets.add(pageId)
        this.mark(pageId)
      }
      change.finish?.()
      if (states) this.writeSyncStates(states())
    })
  }

  // ---------------------------------------------------------------- settings

  getSetting<T = unknown>(key: string): T | null {
    if (typeof key !== 'string') return null
    const r = this.stmt('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!r) return null
    return parseJson<T | null>(r.value, null)
  }

  setSetting(key: string, value: unknown): void {
    if (typeof key !== 'string' || !key || key.length > MAX_SETTING_KEY) throw new Error('Invalid setting key')
    if (value === undefined || value === null) {
      if (key.startsWith('history.')) this.versions.settingsChanged()
      this.stmt('DELETE FROM settings WHERE key = ?').run(key)
      return
    }
    const text = JSON.stringify(value)
    if (typeof text !== 'string') throw new Error('Setting value is not serializable')
    if (text.length > MAX_SETTING_CHARS) throw new Error('Setting value is too large')
    if (key.startsWith('history.')) this.versions.settingsChanged()
    this.stmt('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      text
    )
  }

  isEmpty(): boolean {
    return !this.stmt('SELECT 1 AS x FROM blocks LIMIT 1').get()
  }
}
