import { createHash, randomUUID } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import { sourceIdOf } from '../../shared/linked'
import { plainText } from '../../shared/richtext'
import type { Block, BlockProps, PropertyValue, RichText } from '../../shared/types'
import {
  canonicalJson,
  cleanHistorySetting,
  HISTORY_DEFAULTS,
  MAX_VERSION_LABEL,
  type HistorySettings,
  type SnapshotBlock,
  type SnapshotContent,
  type SnapshotRef,
  type SnapshotRow,
  type VersionInfo,
  type VersionKind,
  type VersionSnapshot,
  type VersionStats
} from '../../shared/versions'
import { isBlockType, isPageLike, isValidId, serializeProps } from './blocks'
import type { SqlStatement } from './driver'

/**
 * Version history: what a snapshot of a page is, how it is stored (deflated canonical
 * JSON, deduplicated by hash), when one is taken (the capture policy), and which ones
 * are kept (retention). Restoring a version lives in the repository, next to the
 * mutations it is made of.
 */

const KINDS: readonly VersionKind[] = ['auto', 'manual', 'restore', 'daily']
const FORMAT = 1
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** A snapshot larger than this once inflated is not one this app wrote. */
const MAX_INFLATED_BYTES = 256 * 1024 * 1024
const MAX_SNAPSHOT_BLOCKS = 200_000
const MAX_TITLE_CHARS = 2000
/** An `apply` that removes this many blocks of a page is preceded by a snapshot. */
export const BULK_DELETED_BLOCKS = 20
/** ...and so is one that replaces more than this share of the page's text, */
export const BULK_TEXT_SHARE = 0.5
/** ...as long as that is a meaningful amount of text (retyping one short line is not a bulk edit). */
export const BULK_TEXT_MIN = 200
export const RESTORE_LABEL_PREFIX = 'Before restoring '
const DAMAGED = 'This version is damaged and cannot be read'
/** What the `hash` of a row becomes once its data failed to decode: it is then left out of listings. */
const DAMAGED_HASH = 'damaged'

/** Unprotected rows: everything but saved versions and versions the user gave a name. */
const PRUNABLE_SQL = `kind <> 'manual' AND (label IS NULL OR (kind = 'restore' AND label LIKE '${RESTORE_LABEL_PREFIX}%'))`

const INFO_COLS = 'id, page_id, created_at, kind, label, block_count, text_size'

interface InfoRow {
  id: string
  page_id: string
  created_at: number
  kind: string
  label: string | null
  block_count: number | null
  text_size: number | null
}

function toInfo(r: InfoRow): VersionInfo {
  return {
    id: r.id,
    pageId: r.page_id,
    createdAt: Number(r.created_at),
    kind: (KINDS as readonly string[]).includes(r.kind) ? (r.kind as VersionKind) : 'auto',
    label: typeof r.label === 'string' ? r.label : null,
    blockCount: Number(r.block_count ?? 0),
    textSize: Number(r.text_size ?? 0)
  }
}

/** Raised inside a write transaction that turned out to be a bulk change of pages not snapshotted yet. */
export class BulkChange extends Error {
  constructor(readonly pages: string[]) {
    super('Bulk change')
  }
}

// ------------------------------------------------------------------ snapshots

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Props of the root as far as its history is concerned: `favorite` describes the sidebar, not the page. */
function rootProps(props: BlockProps): BlockProps {
  if (props.favorite === undefined) return props
  const rest = { ...props }
  delete rest.favorite
  return rest
}

/**
 * The snapshot of a page from its tree (`getTree`: the root, then its descendants in
 * document order, nested pages and databases included but not descended into).
 */
export function buildSnapshot(tree: Block[]): SnapshotContent | null {
  const root = tree[0]
  if (!root || !isPageLike(root.type)) return null
  const linkedRoot = sourceIdOf(root) !== null
  const ownsRows = root.type === 'database' && !linkedRoot
  const blocks: SnapshotBlock[] = [
    { id: root.id, type: root.type, parentId: null, content: linkedRoot ? [] : root.content, props: rootProps(root.props), createdAt: root.createdAt }
  ]
  const refs: SnapshotRef[] = []
  const rows: SnapshotRow[] = []
  const known = new Set<string>([root.id])
  for (let i = 1; i < tree.length && !linkedRoot; i++) {
    const b = tree[i]
    known.add(b.id)
    if (isPageLike(b.type) && sourceIdOf(b) === null) {
      if (ownsRows && b.type === 'page' && b.parentId === root.id) {
        const row: SnapshotRow = {
          id: b.id,
          title: Array.isArray(b.props.title) ? b.props.title : [],
          values: isPlain(b.props.values) ? (b.props.values as Record<string, PropertyValue>) : {},
          createdAt: b.createdAt
        }
        if (typeof b.props.icon === 'string') row.icon = b.props.icon
        rows.push(row)
      } else {
        const ref: SnapshotRef = { id: b.id, type: b.type as 'page' | 'database', title: plainText(b.props.title).slice(0, MAX_TITLE_CHARS) }
        if (typeof b.props.icon === 'string') ref.icon = b.props.icon
        refs.push(ref)
      }
      continue
    }
    // A linked view holds nothing below it.
    blocks.push({ id: b.id, type: b.type, parentId: b.parentId, content: b.type === 'database' ? [] : b.content, props: b.props, createdAt: b.createdAt })
  }
  // Child lists only name what the snapshot holds (trashed or unreadable children are not part of the page).
  for (const b of blocks) {
    if (b.content.some((id) => !known.has(id))) b.content = b.content.filter((id) => known.has(id))
  }
  const out: SnapshotContent = { rootId: root.id, blocks, refs }
  if (ownsRows) out.rows = rows
  return out
}

export function snapshotTextSize(snapshot: SnapshotContent): number {
  let size = 0
  for (const b of snapshot.blocks) size += plainText(b.props.title).length + plainText(b.props.caption).length
  for (const r of snapshot.rows ?? []) size += plainText(r.title).length
  return size
}

/** Blocks below the root, plus rows and nested pages: what the timeline shows as the size of a version. */
export function snapshotBlockCount(snapshot: SnapshotContent): number {
  return snapshot.blocks.length - 1 + (snapshot.rows?.length ?? 0) + snapshot.refs.length
}

/** The stored form: canonical JSON, with the key order of a database schema kept on the side. */
export function serializeSnapshot(snapshot: SnapshotContent): { json: string; hash: string } {
  const schema = snapshot.blocks[0]?.props.schema
  const schemaOrder = isPlain(schema) ? Object.keys(schema) : undefined
  const content = { rootId: snapshot.rootId, blocks: snapshot.blocks, rows: snapshot.rows, schemaOrder }
  // The titles of nested pages are shown in previews but are not part of this page's state.
  const hash = createHash('sha256').update(canonicalJson(content)).digest('hex')
  return { json: canonicalJson({ v: FORMAT, ...content, refs: snapshot.refs }), hash }
}

export function encodeSnapshot(json: string): Buffer {
  return deflateSync(Buffer.from(json, 'utf8'))
}

function cleanRichText(value: unknown): RichText {
  if (!Array.isArray(value)) return []
  const out: RichText = []
  for (const span of value) {
    if (!Array.isArray(span) || typeof span[0] !== 'string') continue
    const marks: unknown = span[1]
    if (!Array.isArray(marks)) {
      out.push([span[0]])
      continue
    }
    const clean = marks.filter(
      (m): m is [string] | [string, string] =>
        Array.isArray(m) && m.length >= 1 && m.length <= 2 && m.every((part) => typeof part === 'string')
    )
    out.push(clean.length ? [span[0], clean as never] : [span[0]])
  }
  return out
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of value) {
    if (isValidId(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/**
 * Checks a decoded snapshot before anything is built from it: the same shape rules as any
 * block written to the database (ids, known types, plain props within the size cap, checked
 * chart views), and a tree that is one: every block reachable from the root exactly once,
 * `parentId` re-derived from the child lists. Throws on anything that is not a snapshot.
 */
export function parseSnapshot(raw: unknown, cleanProps: (props: Record<string, unknown>) => BlockProps): SnapshotContent {
  const bad = (): never => {
    throw new Error(DAMAGED)
  }
  if (!isPlain(raw) || raw['v'] !== FORMAT || !isValidId(raw['rootId']) || !Array.isArray(raw['blocks'])) return bad()
  const list = raw['blocks'] as unknown[]
  if (!list.length || list.length > MAX_SNAPSHOT_BLOCKS) return bad()
  const rootId = raw['rootId']

  const byId = new Map<string, SnapshotBlock>()
  for (const item of list) {
    if (!isPlain(item) || !isValidId(item['id']) || !isBlockType(item['type']) || byId.has(item['id'])) return bad()
    const props = item['props'] === undefined ? {} : item['props']
    if (!isPlain(props)) return bad()
    const clean = cleanProps(props)
    serializeProps(clean)
    byId.set(item['id'], {
      id: item['id'],
      type: item['type'],
      parentId: null,
      content: idList(item['content']),
      props: clean,
      createdAt: stamp(item['createdAt'])
    })
  }
  const root = byId.get(rootId)
  if (!root || !isPageLike(root.type) || list[0] !== undefined && (list[0] as { id?: unknown }).id !== rootId) return bad()

  const refs: SnapshotRef[] = []
  const refIds = new Set<string>()
  for (const item of Array.isArray(raw['refs']) ? (raw['refs'] as unknown[]) : []) {
    if (!isPlain(item) || !isValidId(item['id']) || byId.has(item['id']) || refIds.has(item['id'])) return bad()
    if (item['type'] !== 'page' && item['type'] !== 'database') return bad()
    refIds.add(item['id'])
    const ref: SnapshotRef = {
      id: item['id'],
      type: item['type'],
      title: typeof item['title'] === 'string' ? item['title'].slice(0, MAX_TITLE_CHARS) : ''
    }
    if (typeof item['icon'] === 'string') ref.icon = item['icon'].slice(0, 64)
    refs.push(ref)
  }

  let rows: SnapshotRow[] | undefined
  const rowIds = new Set<string>()
  if (raw['rows'] !== undefined) {
    if (!Array.isArray(raw['rows']) || root.type !== 'database') return bad()
    rows = []
    for (const item of raw['rows'] as unknown[]) {
      if (!isPlain(item) || !isValidId(item['id']) || byId.has(item['id']) || refIds.has(item['id']) || rowIds.has(item['id'])) return bad()
      const values = item['values'] === undefined ? {} : item['values']
      if (!isPlain(values)) return bad()
      rowIds.add(item['id'])
      const row: SnapshotRow = {
        id: item['id'],
        title: cleanRichText(item['title']),
        values: (cleanProps({ values }).values ?? {}) as Record<string, PropertyValue>,
        createdAt: stamp(item['createdAt'])
      }
      if (typeof item['icon'] === 'string') row.icon = item['icon'].slice(0, 64)
      rows.push(row)
    }
  }

  // Schema key order is the order of the properties; canonical JSON sorted it away.
  const schema = root.props.schema
  if (isPlain(schema) && Array.isArray(raw['schemaOrder'])) {
    const ordered: Record<string, unknown> = {}
    for (const key of raw['schemaOrder'] as unknown[]) {
      if (typeof key === 'string' && Object.hasOwn(schema, key)) ordered[key] = schema[key]
    }
    for (const key of Object.keys(schema)) if (!Object.hasOwn(ordered, key)) ordered[key] = schema[key]
    root.props = { ...root.props, schema: ordered as BlockProps['schema'] }
  }

  // The tree is what the child lists say, walked from the root; anything else is dropped.
  const blocks: SnapshotBlock[] = []
  const seen = new Set<string>([rootId])
  const stack: { block: SnapshotBlock; next: number }[] = [{ block: root, next: 0 }]
  blocks.push(root)
  const keep = new Map<string, string[]>([[rootId, []]])
  while (stack.length) {
    const frame = stack[stack.length - 1]
    if (frame.next >= frame.block.content.length) {
      stack.pop()
      continue
    }
    const id = frame.block.content[frame.next++]
    if (seen.has(id)) continue
    const kept = keep.get(frame.block.id) as string[]
    if (refIds.has(id) || rowIds.has(id)) {
      seen.add(id)
      kept.push(id)
      continue
    }
    const child = byId.get(id)
    if (!child) continue
    // Below the root there are only ordinary blocks and linked views: pages are references.
    if (child.type === 'page' || (child.type === 'database' && sourceIdOf(child) === null)) return bad()
    seen.add(id)
    kept.push(id)
    child.parentId = frame.block.id
    if (child.type === 'database') child.content = []
    blocks.push(child)
    keep.set(id, [])
    stack.push({ block: child, next: 0 })
  }
  for (const b of blocks) b.content = keep.get(b.id) ?? []
  const out: SnapshotContent = { rootId, blocks, refs: refs.filter((r) => seen.has(r.id)) }
  if (rows) {
    // Rows are listed in the order of the root's content; one the root does not name goes last.
    const order = new Map(root.content.map((id, index) => [id, index]))
    out.rows = [...rows].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
    const missing = out.rows.filter((r) => !order.has(r.id)).map((r) => r.id)
    if (missing.length) root.content = [...root.content, ...missing]
  }
  return out
}

export function decodeSnapshot(data: unknown, cleanProps: (props: Record<string, unknown>) => BlockProps): SnapshotContent {
  let raw: unknown
  try {
    if (!(data instanceof Uint8Array)) throw new Error('not a blob')
    const json = inflateSync(data, { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8')
    raw = JSON.parse(json)
  } catch {
    throw new Error(DAMAGED)
  }
  try {
    return parseSnapshot(raw, cleanProps)
  } catch {
    // Whatever the reason, the renderer hears one thing; nothing of the content leaks into the message.
    throw new Error(DAMAGED)
  }
}

// ------------------------------------------------------------------ retention

export interface RetentionRow {
  id: string
  createdAt: number
  kind: string
  label: string | null
}

export function isProtected(row: { kind: string; label: string | null }): boolean {
  if (row.kind === 'manual') return true
  if (row.label === null) return false
  return !(row.kind === 'restore' && row.label.startsWith(RESTORE_LABEL_PREFIX))
}

/**
 * Which versions of one page to drop, given all of them newest first: everything from the
 * last 24 hours stays, then one per hour for a week, one per day for 90 days and one per
 * week after that (the newest of each bucket). Saved and named versions are never dropped
 * and do not use up a bucket. Above `maxPerPage`, the oldest unprotected ones go first.
 * `daily` lists the automatic versions that now stand for a whole day or week.
 */
export function retentionPlan(rows: RetentionRow[], now: number, maxPerPage: number): { drop: string[]; daily: string[] } {
  const drop: string[] = []
  const daily: string[] = []
  const buckets = new Set<string>()
  const kept: RetentionRow[] = []
  for (const row of rows) {
    if (isProtected(row)) {
      kept.push(row)
      continue
    }
    const age = now - row.createdAt
    let bucket: string | null = null
    if (age >= 90 * DAY) bucket = `w${Math.floor(row.createdAt / (7 * DAY))}`
    else if (age >= 7 * DAY) bucket = `d${Math.floor(row.createdAt / DAY)}`
    else if (age >= DAY) bucket = `h${Math.floor(row.createdAt / HOUR)}`
    if (bucket !== null) {
      if (buckets.has(bucket)) {
        drop.push(row.id)
        continue
      }
      buckets.add(bucket)
      if (bucket[0] !== 'h' && row.kind === 'auto') daily.push(row.id)
    }
    kept.push(row)
  }
  let excess = kept.length - Math.max(1, maxPerPage)
  for (let i = kept.length - 1; i >= 0 && excess > 0; i--) {
    if (isProtected(kept[i])) continue
    drop.push(kept[i].id)
    excess--
  }
  const dropped = new Set(drop)
  return { drop, daily: daily.filter((id) => !dropped.has(id)) }
}

/** How much of `before` a change to `after` removed or replaced, in characters. */
export function replacedChars(before: string, after: string): number {
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++
  return before.length - start - end
}

const STAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/** "13 Oct 2026, 14:32", in local time. */
export function formatStamp(ms: number): string {
  return STAMP_FORMAT.format(new Date(ms))
}

// ---------------------------------------------------------------------- store

/** What the store needs from the repository it belongs to. */
export interface VersionHost {
  stmt(sql: string): SqlStatement
  /** Wall clock (injectable in tests). */
  clock(): number
  /** Strictly increasing timestamp, for rows whose order must be deterministic. */
  now(): number
  getSetting(key: string): unknown
  getTree(rootId: string): Block[]
  transaction<T>(fn: () => T): T
  cleanProps(props: Record<string, unknown>): BlockProps
}

interface Session {
  /** When the page's state was last captured (or found unchanged) in this run. */
  capturedAt: number
  /** Written since that capture. */
  dirty: boolean
  /** Text size at that capture: what "half of its text" is measured against. */
  textSize: number
}

interface Txn {
  seen: Set<string>
  sessions: Map<string, Session | null>
  stats: Map<string, { deleted: number; replaced: number; delta: number }>
  /** Pages that received a new version row in this transaction. */
  stored: Set<string>
  /** Pages whose state before this transaction's changes was captured (or found unchanged) in it. */
  captured: Set<string>
}

export interface CaptureResult {
  /** The version that holds the captured state: new, or the latest one when nothing changed. Null when nothing was stored. */
  info: VersionInfo | null
  stored: boolean
  textSize: number
}

export class VersionStore {
  /** Capture bookkeeping per page, for this run of the app only. */
  private readonly sessions = new Map<string, Session>()
  private txn: Txn | null = null
  private forced: ReadonlySet<string> | null = null
  private settings: HistorySettings | null = null
  /** Compressed bytes stored, once known; adjusted as rows come and go. */
  private bytes: number | null = null
  private maintainCursor = ''

  constructor(private readonly host: VersionHost) {}

  // ---- settings

  config(): HistorySettings {
    if (this.settings) return this.settings
    const read = <K extends keyof HistorySettings>(name: K): HistorySettings[K] => {
      const clean = cleanHistorySetting(`history.${name}`, this.host.getSetting(`history.${name}`))
      return (clean === undefined ? HISTORY_DEFAULTS[name] : clean) as HistorySettings[K]
    }
    this.settings = {
      enabled: read('enabled'),
      sessionMinutes: read('sessionMinutes'),
      maxPerPage: read('maxPerPage'),
      budgetMb: read('budgetMb')
    }
    return this.settings
  }

  settingsChanged(): void {
    this.settings = null
  }

  // ---- transaction lifecycle (driven by Repository.transaction)

  begin(): void {
    this.txn = { seen: new Set(), sessions: new Map(), stats: new Map(), stored: new Set(), captured: new Set() }
  }

  /**
   * Last step before the commit. With `checkBulk`, a transaction that removed many blocks or
   * most of the text of a page whose previous state is not in a version yet is refused with
   * `BulkChange`: the caller rolls back, forces a snapshot of those pages and runs it again.
   */
  beforeCommit(checkBulk: boolean): void {
    const txn = this.txn
    if (!txn) return
    if (checkBulk && txn.stats.size) {
      const bulk: string[] = []
      for (const [pageId, stats] of txn.stats) {
        // Captured in this very transaction: the state before the change is already safe.
        if (txn.captured.has(pageId)) continue
        const session = this.sessions.get(pageId)
        if (!session) continue
        const text = stats.replaced >= BULK_TEXT_MIN && stats.replaced > session.textSize * BULK_TEXT_SHARE
        if (stats.deleted >= BULK_DELETED_BLOCKS || text) bulk.push(pageId)
      }
      if (bulk.length) throw new BulkChange(bulk)
    }
    if (txn.stored.size) {
      const { maxPerPage } = this.config()
      const now = this.host.clock()
      for (const pageId of txn.stored) this.prunePage(pageId, now, maxPerPage)
      this.enforceBudget()
    }
  }

  commit(): void {
    const txn = this.txn
    this.txn = null
    if (!txn) return
    for (const [pageId, session] of txn.sessions) {
      if (session) this.sessions.set(pageId, session)
      else this.sessions.delete(pageId)
    }
    // Keeps the size "half of its text" is measured against roughly current between captures.
    for (const [pageId, stats] of txn.stats) {
      const session = this.sessions.get(pageId)
      if (session && stats.delta !== 0 && !txn.captured.has(pageId)) session.textSize = Math.max(0, session.textSize + stats.delta)
    }
  }

  rollback(): void {
    this.txn = null
    // Rows counted in the rolled-back transaction are gone again.
    this.bytes = null
  }

  /** Pages to snapshot at their next write whatever their session says (see `beforeCommit`). */
  force(pages: readonly string[] | null): void {
    this.forced = pages ? new Set(pages) : null
  }

  // ---- capture policy

  /**
   * Called inside a write transaction before the first change to `pageId`. Constant time
   * unless the page's last capture is older than the session gap: then, once, the state the
   * page is in right now (before the change) is stored as a version.
   */
  beforeWrite(pageId: string): void {
    const txn = this.txn
    if (!txn || txn.seen.has(pageId)) return
    txn.seen.add(pageId)
    const config = this.config()
    if (!config.enabled) return
    const session = this.sessions.get(pageId)
    const now = this.host.clock()
    if (session && !this.forced?.has(pageId) && now - session.capturedAt < config.sessionMinutes * 60_000) {
      if (!session.dirty) txn.sessions.set(pageId, { ...session, dirty: true })
      return
    }
    const result = this.capture(pageId, 'auto', null, false)
    txn.captured.add(pageId)
    txn.sessions.set(pageId, { capturedAt: now, dirty: true, textSize: result.textSize })
  }

  /** `count` blocks of `pageId` were removed in the open transaction. */
  noteDeleted(pageId: string, count: number): void {
    const txn = this.txn
    if (!txn || count <= 0) return
    const stats = txn.stats.get(pageId)
    if (stats) stats.deleted += count
    else txn.stats.set(pageId, { deleted: count, replaced: 0, delta: 0 })
  }

  /** The text of a block of `pageId` changed from `before` to `after` in the open transaction. */
  noteText(pageId: string, before: string, after: string): void {
    const txn = this.txn
    if (!txn) return
    const count = replacedChars(before, after)
    const delta = after.length - before.length
    const stats = txn.stats.get(pageId)
    if (stats) {
      stats.replaced += count
      stats.delta += delta
    } else txn.stats.set(pageId, { deleted: 0, replaced: count, delta })
  }

  /** The page's content was just replaced by a restore: its state is in a version, nothing is pending. */
  noteRestored(pageId: string, textSize: number): void {
    const session: Session = { capturedAt: this.host.clock(), dirty: false, textSize }
    if (this.txn) {
      this.txn.seen.add(pageId)
      this.txn.sessions.set(pageId, session)
    } else this.sessions.set(pageId, session)
  }

  /** Pages written since their last capture. */
  dirtyPages(): string[] {
    const out: string[] = []
    for (const [pageId, session] of this.sessions) if (session.dirty) out.push(pageId)
    return out
  }

  /**
   * Stores the current state of every page edited since its last capture, so that the
   * latest state is recoverable too (run when the app quits). Returns how many were stored.
   */
  flush(): number {
    const pages = this.dirtyPages()
    if (!pages.length || !this.config().enabled) return 0
    let stored = 0
    this.host.transaction(() => {
      const txn = this.txn as Txn
      const now = this.host.clock()
      for (const pageId of pages) {
        const result = this.capture(pageId, 'auto', null, false)
        if (result.stored) stored++
        txn.seen.add(pageId)
        txn.sessions.set(pageId, { capturedAt: now, dirty: false, textSize: result.textSize })
      }
    })
    return stored
  }

  // ---- storing

  private latest(pageId: string): (InfoRow & { hash: string }) | undefined {
    return this.host
      .stmt(`SELECT ${INFO_COLS}, hash FROM page_versions WHERE page_id = ? AND hash <> '${DAMAGED_HASH}' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(pageId) as (InfoRow & { hash: string }) | undefined
  }

  /**
   * Stores the current state of `pageId` unless it is the state of its latest version
   * already (then that version is returned), or - without `always` - an empty page.
   * Must run inside a transaction.
   */
  capture(pageId: string, kind: VersionKind, label: string | null, always: boolean): CaptureResult {
    const snapshot = buildSnapshot(this.host.getTree(pageId))
    if (!snapshot) return { info: null, stored: false, textSize: 0 }
    const textSize = snapshotTextSize(snapshot)
    const blockCount = snapshotBlockCount(snapshot)
    // A page or database with nothing in it yet is not a state worth keeping on its own
    // (a linked view never has anything in it: its views are what it is).
    if (!always && blockCount === 0 && sourceIdOf(snapshot.blocks[0]) === null) return { info: null, stored: false, textSize }
    const { json, hash } = serializeSnapshot(snapshot)
    const latest = this.latest(pageId)
    if (latest && latest.hash === hash) return { info: toInfo(latest), stored: false, textSize }
    if (kind === 'restore') {
      // The state about to be replaced only needs to be in some version: undoing a restore adds nothing.
      const same = this.host
        .stmt(`SELECT ${INFO_COLS} FROM page_versions WHERE page_id = ? AND hash = ? ORDER BY created_at DESC LIMIT 1`)
        .get(pageId, hash) as InfoRow | undefined
      if (same) return { info: toInfo(same), stored: false, textSize }
    }
    const data = encodeSnapshot(json)
    const info: VersionInfo = { id: randomUUID(), pageId, createdAt: this.host.now(), kind, label, blockCount, textSize }
    this.host
      .stmt(
        `INSERT INTO page_versions (id, page_id, created_at, kind, label, block_count, text_size, data, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(info.id, pageId, info.createdAt, kind, label, blockCount, textSize, data, hash)
    if (this.bytes !== null) this.bytes += data.byteLength
    this.txn?.stored.add(pageId)
    return { info, stored: true, textSize }
  }

  /** "Save version": the current state as a version that is never pruned, with an optional name. */
  save(pageId: string, label: string | null): VersionInfo {
    return this.host.transaction(() => {
      const result = this.capture(pageId, 'manual', label, true)
      if (!result.info) throw new Error('Page not found')
      let info = result.info
      if (!result.stored) {
        // Nothing changed since the latest version: that one becomes the saved version.
        info = { ...info, kind: 'manual', label: label ?? info.label }
        this.host.stmt("UPDATE page_versions SET kind = 'manual', label = ? WHERE id = ?").run(info.label, info.id)
      }
      const txn = this.txn as Txn
      txn.seen.add(pageId)
      txn.sessions.set(pageId, { capturedAt: this.host.clock(), dirty: false, textSize: result.textSize })
      return info
    })
  }

  // ---- reading

  /**
   * Versions of a page, newest first. Rows that cannot be a version, or whose data failed to
   * decode when it was read, are left out (and counted by `stats`). Listing never touches the
   * data itself: only its type and length, which SQLite reads from the row header.
   */
  list(pageId: string): VersionInfo[] {
    const rows = this.host
      .stmt(
        `SELECT ${INFO_COLS}, hash, typeof(data) AS dtype, length(data) AS bytes
         FROM page_versions WHERE page_id = ? ORDER BY created_at DESC, rowid DESC`
      )
      .all(pageId) as (InfoRow & Probe)[]
    return rows.filter((r) => !looksDamaged(r)).map(toInfo)
  }

  private infoRow(id: string): InfoRow | undefined {
    return this.host.stmt(`SELECT ${INFO_COLS} FROM page_versions WHERE id = ?`).get(id) as InfoRow | undefined
  }

  info(id: string): VersionInfo {
    const row = this.infoRow(id)
    if (!row) throw new Error('Version not found')
    return toInfo(row)
  }

  /** A stored version, decoded and checked. Throws when it does not exist or cannot be read. */
  read(id: string): VersionSnapshot {
    const row = this.host.stmt(`SELECT ${INFO_COLS}, data FROM page_versions WHERE id = ?`).get(id) as
      | (InfoRow & { data: unknown })
      | undefined
    if (!row) throw new Error('Version not found')
    let content: SnapshotContent
    try {
      content = decodeSnapshot(row.data, this.host.cleanProps)
      if (content.rootId !== row.page_id) throw new Error(DAMAGED)
    } catch (err) {
      // Remembered, so that the timeline stops offering a version nobody can open.
      this.host.stmt('UPDATE page_versions SET hash = ? WHERE id = ?').run(DAMAGED_HASH, id)
      throw err
    }
    return { info: toInfo(row), ...content }
  }

  /** The live state of a page in the shape of a version, for comparing against one. */
  current(pageId: string): VersionSnapshot | null {
    const snapshot = buildSnapshot(this.host.getTree(pageId))
    return snapshot ? { info: null, ...snapshot } : null
  }

  stats(pageId?: string): VersionStats {
    const probe = `SELECT kind, hash, typeof(data) AS dtype, length(data) AS bytes FROM page_versions`
    const rows = (
      pageId === undefined ? this.host.stmt(probe).all() : this.host.stmt(`${probe} WHERE page_id = ?`).all(pageId)
    ) as Probe[]
    let bytes = 0
    let damaged = 0
    for (const r of rows) {
      bytes += Number(r.bytes ?? 0)
      if (looksDamaged(r)) damaged++
    }
    if (pageId === undefined) this.bytes = bytes
    return { count: rows.length - damaged, bytes, damaged }
  }

  // ---- changing

  rename(id: string, label: string | null): VersionInfo {
    const clean = label === null ? null : label.trim().slice(0, MAX_VERSION_LABEL) || null
    return this.host.transaction(() => {
      const info = this.info(id)
      this.host.stmt('UPDATE page_versions SET label = ? WHERE id = ?').run(clean, id)
      return { ...info, label: clean }
    })
  }

  remove(id: string): void {
    this.host.transaction(() => {
      this.host.stmt('DELETE FROM page_versions WHERE id = ?').run(id)
      this.bytes = null
    })
  }

  /** Deletes the history of one page, or all of it. */
  clear(pageId?: string): void {
    this.host.transaction(() => {
      if (pageId === undefined) this.host.stmt('DELETE FROM page_versions').run()
      else this.host.stmt('DELETE FROM page_versions WHERE page_id = ?').run(pageId)
      this.bytes = null
    })
  }

  /** The page is gone for good: so is its history. Runs inside the deleting transaction. */
  dropPage(pageId: string): void {
    this.host.stmt('DELETE FROM page_versions WHERE page_id = ?').run(pageId)
    this.bytes = null
    if (this.txn) this.txn.sessions.set(pageId, null)
    else this.sessions.delete(pageId)
  }

  // ---- retention

  private prunePage(pageId: string, now: number, maxPerPage: number): void {
    const rows = this.host
      .stmt('SELECT id, created_at, kind, label FROM page_versions WHERE page_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(pageId) as { id: string; created_at: number; kind: string; label: string | null }[]
    if (rows.length <= 1) return
    const plan = retentionPlan(
      rows.map((r) => ({ id: r.id, createdAt: Number(r.created_at), kind: r.kind, label: r.label })),
      now,
      maxPerPage
    )
    for (const id of plan.daily) this.host.stmt("UPDATE page_versions SET kind = 'daily' WHERE id = ?").run(id)
    if (!plan.drop.length) return
    for (const id of plan.drop) this.host.stmt('DELETE FROM page_versions WHERE id = ?').run(id)
    this.bytes = null
  }

  private totalBytes(): number {
    if (this.bytes === null) {
      const r = this.host.stmt('SELECT COALESCE(SUM(length(data)), 0) AS bytes FROM page_versions').get() as { bytes: number }
      this.bytes = Number(r.bytes)
    }
    return this.bytes
  }

  /** Drops the oldest unprotected versions, whatever their page, until the stored bytes fit the budget. */
  private enforceBudget(): void {
    const budget = this.config().budgetMb * 1024 * 1024
    let total = this.totalBytes()
    // Bounded work per call; whatever is left is picked up by the next capture or start-up.
    for (let round = 0; round < 20 && total > budget; round++) {
      const rows = this.host
        .stmt(`SELECT id, length(data) AS bytes FROM page_versions WHERE ${PRUNABLE_SQL} ORDER BY created_at, rowid LIMIT 100`)
        .all() as { id: string; bytes: number }[]
      if (!rows.length) break
      for (const r of rows) {
        if (total <= budget) break
        this.host.stmt('DELETE FROM page_versions WHERE id = ?').run(r.id)
        total -= Number(r.bytes)
      }
    }
    this.bytes = total
  }

  /**
   * One slice of housekeeping: thins the history of up to `maxPages` pages (removing that of
   * pages that no longer exist) and enforces the size budget. Returns true once every page
   * has been visited; call again later otherwise.
   */
  maintain(maxPages = 50): boolean {
    return this.host.transaction(() => {
      const pages = this.host
        .stmt('SELECT DISTINCT page_id FROM page_versions WHERE page_id > ? ORDER BY page_id LIMIT ?')
        .all(this.maintainCursor, maxPages) as { page_id: string }[]
      const { maxPerPage } = this.config()
      const now = this.host.clock()
      for (const { page_id: pageId } of pages) {
        if (this.host.stmt('SELECT 1 AS x FROM blocks WHERE id = ?').get(pageId)) this.prunePage(pageId, now, maxPerPage)
        else this.dropPage(pageId)
        this.maintainCursor = pageId
      }
      const done = pages.length < maxPages
      if (done) {
        this.maintainCursor = ''
        this.enforceBudget()
      }
      return done
    })
  }
}

interface Probe {
  kind: string
  hash: string
  dtype: string
  bytes: number | null
}

/**
 * A test that needs no decoding: a version is a non-trivial blob of a known kind whose data
 * has not already failed to decode. Anything subtler shows when the version is opened.
 */
function looksDamaged(r: Probe): boolean {
  return r.dtype !== 'blob' || Number(r.bytes ?? 0) < 8 || r.hash === DAMAGED_HASH || !(KINDS as readonly string[]).includes(r.kind)
}
