import { canonicalJson } from '../../shared/versions'

/**
 * The three-way merge of two copies of a workspace. Pure: plain data in, plain data out, no
 * clock, no randomness, no database. `base` is the state both sides last agreed on, `local`
 * what this device has now, `remote` what was downloaded.
 *
 * The rules, per block id:
 *  - unchanged on one side: the other side's block;
 *  - changed on both: field by field. `props` keys changed by one side only are both kept;
 *    `values`, `schema` (and each property's options) and `views` (and each view's chart)
 *    merge per id the same way, and a cell holding a list of ids (relation links, options of
 *    a multi-select) merges as a set. Where both sides changed the same thing differently, the
 *    side whose block has the later `updatedAt` wins and the loss is reported in `conflicts`;
 *  - deleted on one side: gone, unless the other side changed it since `base`, then it stays;
 *  - child lists: three-way, keeping the order of the side that reordered and inserting the
 *    other side's additions next to their neighbours;
 *  - afterwards the tree is repaired: every block ends with exactly one parent that exists.
 *
 * The same inputs always give the same output, swapping `local` and `remote` gives the same
 * workspace, and merging the result again changes nothing.
 */

export interface SyncBlock {
  id: string
  type: string
  /** null for workspace-root pages; for a page in the trash, where it was. */
  parentId: string | null
  content: string[]
  props: Record<string, unknown>
  createdAt: number
  updatedAt: number
  trashedAt: number | null
}

export interface Workspace {
  blocks: Map<string, SyncBlock>
  /** Ids of the pages and databases at the workspace root, in order. */
  root: string[]
  /** When that order last changed (0 when unknown): decides between two different reorders. */
  rootAt?: number
}

export interface MergeConflict {
  blockId: string
  /** What both sides changed: `type`, `trashed`, or a path into props (`props.title`, `props.values.<id>`). */
  field: string
  winner: 'local' | 'remote'
  /** The page holding the block on each side (the block itself when it is a page). */
  localPage: string | null
  remotePage: string | null
}

export interface MergeStats {
  blocks: number
  conflicts: number
  /** Blocks one side deleted that stayed because the other side had changed them. */
  kept: number
  /** Pages brought back because a block inside them was changed on the other side. */
  resurrected: number
  /** Blocks whose parent was gone and that were re-attached to a page. */
  reattached: number
  cyclesBroken: number
  /** Blocks that could not be attached anywhere (damaged input only). */
  dropped: number
}

export interface MergeOutput {
  result: Workspace
  conflicts: MergeConflict[]
  stats: MergeStats
}

export function emptyWorkspace(): Workspace {
  return { blocks: new Map(), root: [] }
}

export function isPageLike(type: string): boolean {
  return type === 'page' || type === 'database'
}

// ------------------------------------------------------------------ equality

const canonCache = new WeakMap<object, string>()

function canon(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return canonicalJson(value)
  let text = canonCache.get(value)
  if (text === undefined) {
    text = canonicalJson(value)
    canonCache.set(value, text)
  }
  return text
}

function eq(a: unknown, b: unknown): boolean {
  return a === b || canon(a) === canon(b)
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** The order of a database's properties is the key order of its schema, which canonical JSON does not see. */
function schemaOrder(props: Record<string, unknown>): string[] {
  const schema = props['schema']
  return isPlain(schema) ? Object.keys(schema) : []
}

function sameProps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return a === b || (canon(a) === canon(b) && sameList(schemaOrder(a), schemaOrder(b)))
}

/** True when two blocks are the same in everything that is stored. */
export function sameBlock(a: SyncBlock, b: SyncBlock): boolean {
  return (
    a.type === b.type &&
    a.parentId === b.parentId &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.trashedAt === b.trashedAt &&
    sameList(a.content, b.content) &&
    sameProps(a.props, b.props)
  )
}

export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  if (a.blocks.size !== b.blocks.size || !sameList(a.root, b.root) || (a.rootAt ?? 0) !== (b.rootAt ?? 0)) return false
  for (const [id, block] of a.blocks) {
    const other = b.blocks.get(id)
    if (!other || !sameBlock(block, other)) return false
  }
  return true
}

export interface WorkspaceDiff {
  /** Blocks of `to` that are new or different. */
  put: SyncBlock[]
  /** Ids `from` has and `to` does not. */
  remove: string[]
  rootChanged: boolean
}

/** What turns `from` into `to`. */
export function diffWorkspace(from: Workspace, to: Workspace): WorkspaceDiff {
  const put: SyncBlock[] = []
  const remove: string[] = []
  for (const [id, block] of to.blocks) {
    const before = from.blocks.get(id)
    if (!before || !sameBlock(before, block)) put.push(block)
  }
  for (const id of from.blocks.keys()) if (!to.blocks.has(id)) remove.push(id)
  return { put, remove, rootChanged: !sameList(from.root, to.root) || (from.rootAt ?? 0) !== (to.rootAt ?? 0) }
}

/** The page or database that holds `id` (or is `id`), following `parentId`. */
export function pageOf(ws: Workspace, id: string): string | null {
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const block = ws.blocks.get(cur)
    if (!block) return null
    if (isPageLike(block.type)) return cur
    cur = block.parentId
  }
  return null
}

// ------------------------------------------------------------- normalisation

/** A database holds rows (pages) unless it is a linked view, which holds nothing; the root holds pages and databases. */
function canHold(parent: SyncBlock, child: SyncBlock): boolean {
  if (parent.type !== 'database') return true
  return child.type === 'page' && typeof parent.props['sourceId'] !== 'string'
}

/**
 * A copy of `ws` in which the child lists are the truth: every block is listed by exactly one
 * parent that exists (or is at the root, or is a page in the trash), `parentId` says the same,
 * and nothing is listed twice. Blocks that nothing reaches are left out.
 */
export function normalizeWorkspace(ws: Workspace): Workspace {
  const blocks = new Map<string, SyncBlock>()
  const claimed = new Set<string>()
  const root: string[] = []
  const stack: string[] = []
  const trashed = (b: SyncBlock): boolean => b.trashedAt !== null && isPageLike(b.type)

  const adopt = (id: string, parentId: string | null): boolean => {
    const src = ws.blocks.get(id)
    if (!src || claimed.has(id) || trashed(src)) return false
    claimed.add(id)
    blocks.set(id, { ...src, parentId, trashedAt: null, content: src.content })
    stack.push(id)
    return true
  }
  const expand = (): void => {
    while (stack.length) {
      const block = blocks.get(stack.pop() as string) as SyncBlock
      const kids: string[] = []
      for (const child of block.content) if (adopt(child, block.id)) kids.push(child)
      block.content = kids
    }
  }

  for (const id of ws.root) {
    const src = ws.blocks.get(id)
    if (src && isPageLike(src.type) && adopt(id, null)) root.push(id)
  }
  expand()
  // Pages in the trash are roots of their own: listed by nobody, remembering where they were.
  const bin = [...ws.blocks.values()].filter(trashed).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const src of bin) {
    claimed.add(src.id)
    blocks.set(src.id, { ...src, content: src.content })
  }
  for (const src of bin) {
    stack.push(src.id)
    expand()
  }
  for (const src of bin) {
    const block = blocks.get(src.id) as SyncBlock
    if (block.parentId !== null && (!blocks.has(block.parentId) || block.parentId === block.id)) block.parentId = null
  }
  return { blocks, root, rootAt: ws.rootAt ?? 0 }
}

// --------------------------------------------------------------- list merge

/**
 * Three-way merge of an ordered list of ids. `keep` decides which ids belong in the result at
 * all (the caller knows which blocks survive and where); this only decides the order: that of
 * the side that reordered (`preferA` when both or neither did), with the other side's
 * additions placed after the neighbour they followed there. `preferA` null means the caller
 * cannot tell which side is later: `onTie` is told when that mattered (two different reorders),
 * and the choice then depends on the lists alone, not on which one is called `a`.
 */
export function mergeLists(
  base0: readonly string[],
  a0: readonly string[],
  b0: readonly string[],
  preferA: boolean | null,
  keep: (id: string) => boolean,
  onTie?: () => void
): string[] {
  // Only what stays takes part: an id that leaves the list cannot make a side count as having reordered it.
  const kept = new Map<string, boolean>()
  const stays = (id: string): boolean => {
    let answer = kept.get(id)
    if (answer === undefined) {
      answer = keep(id)
      kept.set(id, answer)
    }
    return answer
  }
  const base = base0.filter(stays)
  const a = a0.filter(stays)
  const b = b0.filter(stays)
  const inBase = new Set(base)
  const reordered = (side: readonly string[]): boolean => {
    const inSide = new Set(side)
    const common = side.filter((id) => inBase.has(id))
    const before = base.filter((id) => inSide.has(id))
    return !sameList([...new Set(common)], [...new Set(before)])
  }
  const ra = reordered(a)
  const rb = reordered(b)
  let aFirst: boolean
  if (ra !== rb) aFirst = ra
  else if (preferA !== null) aFirst = preferA
  else {
    aFirst = a.join(' ') > b.join(' ')
    if (ra && onTie) {
      // Only a real disagreement about the order of what both have is a tie worth reporting.
      const inA = new Set(a)
      const inB = new Set(b)
      if (!sameList([...new Set(a.filter((id) => inB.has(id)))], [...new Set(b.filter((id) => inA.has(id)))])) onTie()
    }
  }
  const primary = aFirst ? a : b
  const secondary = aFirst ? b : a

  const out: string[] = []
  const present = new Set<string>()
  for (const id of primary) {
    if (present.has(id)) continue
    present.add(id)
    out.push(id)
  }
  for (let i = 0; i < secondary.length; i++) {
    const id = secondary[i]
    if (present.has(id)) continue
    present.add(id)
    let j = i - 1
    while (j >= 0 && !present.has(secondary[j])) j--
    if (j >= 0) {
      out.splice(out.indexOf(secondary[j]) + 1, 0, id)
      continue
    }
    let k = i + 1
    while (k < secondary.length && (!present.has(secondary[k]) || secondary[k] === id)) k++
    if (k < secondary.length) out.splice(out.indexOf(secondary[k]), 0, id)
    else out.push(id)
  }
  return out
}

// -------------------------------------------------------------- field merge

/** How a value inside props merges when both sides changed it. */
type Spec =
  | { kind: 'atom' }
  /** An object merged key by key; `ordered` also merges the order of its keys. */
  | { kind: 'record'; of: (key: string) => Spec; ordered?: boolean; editWins?: boolean }
  /** An array of objects with an `id`, merged per id. */
  | { kind: 'keyed'; item: Spec }
  /**
   * An ordered list of ids. With `optional`, a missing value counts as an empty list (a cell
   * that was cleared), and a list that ends up empty is removed again.
   */
  | { kind: 'ids'; optional?: boolean }

const ATOM: Spec = { kind: 'atom' }
const atom = (): Spec => ATOM
const OPTION: Spec = { kind: 'record', of: atom }
const PROPERTY: Spec = { kind: 'record', of: (key) => (key === 'options' ? { kind: 'keyed', item: OPTION } : ATOM) }
const CHART: Spec = { kind: 'record', of: (key) => (key === 'y' ? { kind: 'record', of: atom } : ATOM) }
const VIEW: Spec = {
  kind: 'record',
  of: (key) => (key === 'chart' ? CHART : key === 'propertyWidths' ? { kind: 'record', of: atom } : key === 'visibleProperties' ? { kind: 'ids' } : ATOM)
}
/**
 * A row's cell. Lists of ids (relation links, multi-select options) merge as sets: links one
 * side added and the other removed both count, so the two halves of a two-way relation that
 * were edited on different devices still agree afterwards. Anything else is an atom (the
 * `ids` merge falls back to that when a side is not a list of strings).
 */
const CELL: Spec = { kind: 'ids', optional: true }
const PROPS: Spec = {
  kind: 'record',
  of: (key) =>
    key === 'values'
      ? { kind: 'record', of: () => CELL }
      : key === 'schema'
        ? { kind: 'record', of: () => PROPERTY, ordered: true, editWins: true }
        : key === 'views'
          ? { kind: 'keyed', item: VIEW }
          : ATOM
}

interface FieldContext {
  /** True when the local block has the later `updatedAt`; null when the clocks say the same. */
  localLater: boolean | null
  conflict(field: string, winner: 'local' | 'remote'): void
  /** Set when equal clocks made the content decide. */
  tie: boolean
}

/** Which side wins a real conflict: the later block, and for equal clocks a rule that does not depend on which side is called local. */
function localWins(ctx: FieldContext, l: unknown, r: unknown): boolean {
  if (ctx.localLater !== null) return ctx.localLater
  ctx.tie = true
  return canon(l) > canon(r)
}

function keyedById(value: unknown): Map<string, Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null
  const map = new Map<string, Record<string, unknown>>()
  for (const item of value) {
    if (!isPlain(item) || typeof item['id'] !== 'string' || map.has(item['id'])) return null
    map.set(item['id'], item)
  }
  return map
}

function idList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null
}

function merge3(spec: Spec, b: unknown, l: unknown, r: unknown, path: string, ctx: FieldContext): unknown {
  // The same data; for an ordered record the order of its keys is data too.
  const ordered = spec.kind === 'record' && spec.ordered === true
  const same = (x: unknown, y: unknown): boolean => {
    if (!eq(x, y)) return false
    if (!isPlain(x) || !isPlain(y)) return true
    if (ordered) return sameList(Object.keys(x), Object.keys(y))
    return path !== 'props' || sameList(schemaOrder(x), schemaOrder(y))
  }
  if (same(l, r)) return l
  if (same(l, b)) return r
  if (same(r, b)) return l
  const tie = (): void => {
    ctx.tie = true
  }

  if (spec.kind === 'record' && isPlain(l) && isPlain(r)) {
    const base = isPlain(b) ? b : {}
    const merged = new Map<string, unknown>()
    for (const key of [...new Set([...Object.keys(l), ...Object.keys(r)])].sort()) {
      if (key === '__proto__') continue
      const lv = Object.hasOwn(l, key) ? l[key] : undefined
      const rv = Object.hasOwn(r, key) ? r[key] : undefined
      const bv = Object.hasOwn(base, key) ? base[key] : undefined
      let value: unknown
      if (spec.editWins && bv !== undefined && (lv === undefined) !== (rv === undefined)) {
        // Removed on one side: gone unless the other side changed it since.
        const other = lv === undefined ? rv : lv
        value = eq(other, bv) ? undefined : other
      } else value = merge3(spec.of(key), bv, lv, rv, `${path}.${key}`, ctx)
      if (value !== undefined) merged.set(key, value)
    }
    const order = spec.ordered
      ? mergeLists(Object.keys(base), Object.keys(l), Object.keys(r), ctx.localLater, (key) => merged.has(key), tie)
      : [...merged.keys()]
    const out: Record<string, unknown> = {}
    for (const key of order) out[key] = merged.get(key)
    return out
  }

  if (spec.kind === 'keyed') {
    const lm = keyedById(l)
    const rm = keyedById(r)
    if (lm && rm) {
      const bm = keyedById(b) ?? new Map<string, Record<string, unknown>>()
      const merged = new Map<string, unknown>()
      for (const id of [...new Set([...lm.keys(), ...rm.keys()])].sort()) {
        const lv = lm.get(id)
        const rv = rm.get(id)
        const bv = bm.get(id)
        let value: unknown
        if (lv && rv) value = merge3(spec.item, bv, lv, rv, `${path}[${id}]`, ctx)
        else {
          const only = lv ?? rv
          // Added by one side, or removed by the other: removal wins unless this side changed it.
          value = bv === undefined || !eq(only, bv) ? only : undefined
        }
        if (value !== undefined) merged.set(id, value)
      }
      const order = mergeLists([...bm.keys()], [...lm.keys()], [...rm.keys()], ctx.localLater, (id) => merged.has(id), tie)
      return order.map((id) => merged.get(id))
    }
  }

  if (spec.kind === 'ids') {
    const absent = (value: unknown): unknown => (spec.optional && value === undefined ? [] : value)
    const ll = idList(absent(l))
    const rl = idList(absent(r))
    if (ll && rl) {
      const bl = idList(absent(b)) ?? []
      const inB = new Set(bl)
      const inL = new Set(ll)
      const inR = new Set(rl)
      const merged = mergeLists(bl, ll, rl, ctx.localLater, (id) => (inL.has(id) && inR.has(id)) || (!inB.has(id) && (inL.has(id) || inR.has(id))), tie)
      return spec.optional && merged.length === 0 ? undefined : merged
    }
  }

  const preferLocal = localWins(ctx, l, r)
  ctx.conflict(path, preferLocal ? 'local' : 'remote')
  return preferLocal ? l : r
}

// ---------------------------------------------------------------- the merge

interface Draft {
  id: string
  type: string
  props: Record<string, unknown>
  createdAt: number
  trashedAt: number | null
  l: SyncBlock | undefined
  r: SyncBlock | undefined
}

const UNKNOWN = Symbol('unknown')
type Parent = string | null | typeof UNKNOWN

function laterLocal(l: SyncBlock, r: SyncBlock): boolean | null {
  return l.updatedAt === r.updatedAt ? null : l.updatedAt > r.updatedAt
}

/** Changed since base in what the block itself says (not where it is, nor what it holds). */
function modified(base: SyncBlock, now: SyncBlock): boolean {
  return now.type !== base.type || (now.trashedAt === null) !== (base.trashedAt === null) || !sameProps(now.props, base.props)
}

export function mergeWorkspace(base0: Workspace, local0: Workspace, remote0: Workspace): MergeOutput {
  const base = normalizeWorkspace(base0)
  const local = normalizeWorkspace(local0)
  const remote = normalizeWorkspace(remote0)
  const conflicts: MergeConflict[] = []
  const stats: MergeStats = { blocks: 0, conflicts: 0, kept: 0, resurrected: 0, reattached: 0, cyclesBroken: 0, dropped: 0 }

  /** Blocks (null: the root) where equal clocks left the content to decide: their result is stamped one tick later, so that it stays decided. */
  const tied = new Set<string | null>()

  // ---- A. which blocks exist, and what each says about itself
  const drafts = new Map<string, Draft>()
  const ids = [...new Set([...local.blocks.keys(), ...remote.blocks.keys()])].sort()
  for (const id of ids) {
    const l = local.blocks.get(id)
    const r = remote.blocks.get(id)
    const b = base.blocks.get(id)
    if (l && r) {
      const ctx: FieldContext = {
        localLater: laterLocal(l, r),
        conflict: (field, winner) => conflicts.push({ blockId: id, field, winner, localPage: pageOf(local, id), remotePage: pageOf(remote, id) }),
        tie: false
      }
      const type = merge3(ATOM, b?.type, l.type, r.type, 'type', ctx) as string
      const props = sameProps(l.props, r.props) ? l.props : (merge3(PROPS, b?.props, l.props, r.props, 'props', ctx) as Record<string, unknown>)
      let trashedAt: number | null
      if (l.trashedAt === r.trashedAt) trashedAt = l.trashedAt
      else if (b && l.trashedAt === b.trashedAt) trashedAt = r.trashedAt
      else if (b && r.trashedAt === b.trashedAt) trashedAt = l.trashedAt
      else if (l.trashedAt !== null && r.trashedAt !== null) trashedAt = Math.max(l.trashedAt, r.trashedAt)
      else {
        const preferLocal = localWins(ctx, l.trashedAt, r.trashedAt)
        ctx.conflict('trashed', preferLocal ? 'local' : 'remote')
        trashedAt = preferLocal ? l.trashedAt : r.trashedAt
      }
      if (!isPageLike(type)) trashedAt = null
      if (ctx.tie) tied.add(id)
      drafts.set(id, { id, type, props, createdAt: Math.min(l.createdAt, r.createdAt), trashedAt, l, r })
      continue
    }
    const only = (l ?? r) as SyncBlock
    if (b && !modified(b, only)) continue
    if (b) stats.kept++
    drafts.set(id, { id, type: only.type, props: only.props, createdAt: only.createdAt, trashedAt: isPageLike(only.type) ? only.trashedAt : null, l, r })
  }

  const live = (d: Draft | undefined): d is Draft => d !== undefined && d.trashedAt === null

  /** True when `parent` (null: the root) is there to hold the block. */
  const holds = (parent: string | null, d: Draft): boolean => {
    if (parent === null) return isPageLike(d.type)
    const p = drafts.get(parent)
    return p !== undefined && parent !== d.id && canHold(p as unknown as SyncBlock, d as unknown as SyncBlock)
  }
  /**
   * Where a block that is not in the trash belongs, from where each side has it. When the two
   * sides disagree and the place that would win is gone, the other side's place is used.
   */
  const intended = (d: Draft): string | null => {
    const l = d.l && d.l.trashedAt === null ? d.l : undefined
    const r = d.r && d.r.trashedAt === null ? d.r : undefined
    if (l && r) {
      if (l.parentId === r.parentId) return l.parentId
      const b = base.blocks.get(d.id)
      const pb: Parent = b && b.trashedAt === null ? b.parentId : UNKNOWN
      let first: string | null
      // Moved on one side only: there. Moved to two different places: the later move stands.
      if (pb !== UNKNOWN && l.parentId === pb) first = r.parentId
      else if (pb !== UNKNOWN && r.parentId === pb) first = l.parentId
      else first = (laterLocal(l, r) ?? String(l.parentId) > String(r.parentId)) ? l.parentId : r.parentId
      const second = first === l.parentId ? r.parentId : l.parentId
      return !holds(first, d) && holds(second, d) ? second : first
    }
    if (l) return l.parentId
    if (r) return r.parentId
    return (d.l ?? d.r)?.parentId ?? null
  }
  const intendedCache = new Map<string, string | null>()
  let settled = false
  const intendedOf = (d: Draft): string | null => {
    // Which blocks exist is still changing until the pages below are brought back.
    if (!settled) return intended(d)
    let parent = intendedCache.get(d.id)
    if (parent === undefined) {
      parent = intended(d)
      intendedCache.set(d.id, parent)
    }
    return parent
  }
  /** A block that did not survive, as the side that still had it knew it. */
  const ghost = (id: string): SyncBlock | undefined => local.blocks.get(id) ?? remote.blocks.get(id) ?? base.blocks.get(id)

  // ---- A2. a block that is not a page never leaves its page: if the page was deleted on the
  // other side, it comes back to hold what survived of it.
  for (const d of [...drafts.values()]) {
    if (isPageLike(d.type) || !live(d)) continue
    const seen = new Set<string>([d.id])
    let cur = intendedOf(d)
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      const alive = drafts.get(cur)
      if (alive) {
        if (isPageLike(alive.type)) break
        cur = alive.trashedAt === null ? intendedOf(alive) : null
        continue
      }
      const gone = ghost(cur)
      if (!gone) break
      if (isPageLike(gone.type)) {
        const l = local.blocks.get(cur)
        const r = remote.blocks.get(cur)
        drafts.set(cur, { id: cur, type: gone.type, props: gone.props, createdAt: gone.createdAt, trashedAt: gone.trashedAt, l, r })
        stats.resurrected++
        break
      }
      cur = gone.parentId
    }
  }

  settled = true

  // ---- A3. cycles (each side moved a block into the other's): the older move is undone, before
  // the lists are merged, so that the block keeps the position its other parent gave it.
  /** When a block was moved to where it is; one that was not moved at all is never the one put back. */
  const moveStamp = (id: string): number => {
    const d = drafts.get(id) as Draft
    const before = base.blocks.get(id)
    const was: Parent = before && before.trashedAt === null ? before.parentId : UNKNOWN
    const moves = [d.l, d.r].filter((side): side is SyncBlock => side !== undefined && side.trashedAt === null && side.parentId !== was).map((side) => side.updatedAt)
    return moves.length ? Math.max(...moves) : Infinity
  }
  const oldestMove = (cycle: string[]): Draft => drafts.get([...cycle].sort((a, b) => moveStamp(a) - moveStamp(b) || (a < b ? -1 : 1))[0]) as Draft
  /** Blocks taken out of a cycle that had no other parent to go back to. */
  const adrift = new Set<string>()
  const above = (id: string): string | null => {
    const d = drafts.get(id)
    return live(d) && !adrift.has(id) ? intendedOf(d) : null
  }
  for (let round = 0; round <= drafts.size; round++) {
    let cycle: string[] | null = null
    const cleared = new Set<string>()
    for (const d of drafts.values()) {
      if (!live(d) || cleared.has(d.id)) continue
      const path: string[] = []
      const onPath = new Set<string>()
      let cur: string | null = d.id
      while (cur !== null && !cleared.has(cur) && !onPath.has(cur)) {
        onPath.add(cur)
        path.push(cur)
        cur = above(cur)
      }
      if (cur !== null && onPath.has(cur)) {
        cycle = path.slice(path.indexOf(cur))
        break
      }
      for (const id of path) cleared.add(id)
    }
    if (!cycle) break
    stats.cyclesBroken++
    const victim = oldestMove(cycle)
    const current = intendedOf(victim)
    const before = base.blocks.get(victim.id)
    const reaches = (from: string | null): boolean => {
      const seen = new Set<string>()
      let cur = from
      while (cur !== null && !seen.has(cur)) {
        if (cur === victim.id) return true
        seen.add(cur)
        cur = above(cur)
      }
      return false
    }
    const places: (string | null)[] = []
    for (const side of [victim.l, victim.r, before]) {
      if (side && side.trashedAt === null && side.parentId !== current && !places.includes(side.parentId)) places.push(side.parentId)
    }
    const back = places.find((parent) => holds(parent, victim) && !reaches(parent))
    if (back !== undefined) intendedCache.set(victim.id, back)
    else adrift.add(victim.id)
  }

  // ---- B. child lists
  const lists = new Map<string | null, string[]>()
  const parentOf = new Map<string, string | null>()
  const belongs = (id: string, parent: Draft | null): boolean => {
    const d = drafts.get(id)
    if (!live(d) || d.id === parent?.id || adrift.has(id)) return false
    if (intendedOf(d) !== (parent ? parent.id : null)) return false
    return parent ? canHold(parent as unknown as SyncBlock, d as unknown as SyncBlock) : isPageLike(d.type)
  }
  const place = (parent: string | null, list: string[]): void => {
    lists.set(parent, list)
    for (const id of list) parentOf.set(id, parent)
  }
  const rootLater = (local.rootAt ?? 0) === (remote.rootAt ?? 0) ? null : (local.rootAt ?? 0) > (remote.rootAt ?? 0)
  place(
    null,
    mergeLists(base.root, local.root, remote.root, rootLater, (id) => belongs(id, null), () => tied.add(null))
  )
  for (const d of drafts.values()) {
    const b = base.blocks.get(d.id)
    const lc = d.l?.content ?? []
    const rc = d.r?.content ?? []
    if (!lc.length && !rc.length) {
      lists.set(d.id, [])
      continue
    }
    const later = d.l && d.r ? laterLocal(d.l, d.r) : null
    place(
      d.id,
      mergeLists(b?.content ?? [], lc, rc, later, (id) => belongs(id, d), () => tied.add(d.id))
    )
  }

  // ---- C. blocks whose parent is gone (or cannot hold them) go to the end of the nearest
  // surviving page above them; pages with none above go to the root.
  const append = (parent: string | null, id: string): void => {
    const list = lists.get(parent) ?? []
    if (!lists.has(parent)) lists.set(parent, list)
    list.push(id)
    parentOf.set(id, parent)
  }
  const isUnder = (id: string, ancestor: string): boolean => {
    const seen = new Set<string>()
    let cur: string | null | undefined = id
    while (cur != null && !seen.has(cur)) {
      if (cur === ancestor) return true
      seen.add(cur)
      cur = parentOf.has(cur) ? parentOf.get(cur) : (drafts.get(cur)?.trashedAt ?? null) !== null ? null : undefined
    }
    return false
  }
  const home = (d: Draft, from: string | null): string | null | undefined => {
    const seen = new Set<string>([d.id])
    let cur = from
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      const alive = drafts.get(cur)
      if (alive) {
        if (isPageLike(alive.type) && canHold(alive as unknown as SyncBlock, d as unknown as SyncBlock) && !isUnder(cur, d.id)) return cur
        cur = alive.trashedAt !== null ? null : parentOf.has(cur) ? (parentOf.get(cur) as string | null) : intendedOf(alive)
      } else cur = ghost(cur)?.parentId ?? null
    }
    return isPageLike(d.type) ? null : undefined
  }
  const orphans = [...drafts.values()].filter((d) => live(d) && !parentOf.has(d.id)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
  const lost = new Set<string>()
  for (const d of orphans) {
    const was = base.blocks.get(d.id)
    const target = home(d, adrift.has(d.id) ? (was && was.trashedAt === null ? was.parentId : null) : intendedOf(d))
    if (target === undefined) {
      lost.add(d.id)
      continue
    }
    append(target, d.id)
    stats.reattached++
  }

  // ---- D. a cycle that re-attaching created (damaged input only): cut at the oldest move.
  for (let round = 0; round <= drafts.size; round++) {
    let cycle: string[] | null = null
    const cleared = new Set<string>()
    for (const d of drafts.values()) {
      if (!live(d) || cleared.has(d.id)) continue
      const path: string[] = []
      const onPath = new Set<string>()
      let cur: string | null | undefined = d.id
      while (cur != null && !cleared.has(cur) && !onPath.has(cur)) {
        onPath.add(cur)
        path.push(cur)
        cur = parentOf.get(cur)
      }
      if (cur != null && onPath.has(cur)) {
        cycle = path.slice(path.indexOf(cur))
        break
      }
      for (const id of path) cleared.add(id)
    }
    if (!cycle) break
    stats.cyclesBroken++
    const victim = oldestMove(cycle)
    const from = parentOf.get(victim.id) as string
    lists.set(
      from,
      (lists.get(from) ?? []).filter((id) => id !== victim.id)
    )
    parentOf.delete(victim.id)
    const target = isPageLike(victim.type) ? null : home(victim, null)
    if (target === undefined) lost.add(victim.id)
    else append(target, victim.id)
  }

  // ---- E. the result
  const blocks = new Map<string, SyncBlock>()
  for (const d of drafts.values()) {
    if (lost.has(d.id)) continue
    let parentId: string | null
    if (d.trashedAt === null) parentId = parentOf.get(d.id) ?? null
    else {
      const b = base.blocks.get(d.id)
      const pl = d.l?.parentId
      const pr = d.r?.parentId
      if (d.l && d.r && pl !== pr) {
        if (b && pl === b.parentId) parentId = pr as string | null
        else if (b && pr === b.parentId) parentId = pl as string | null
        else parentId = ((laterLocal(d.l, d.r) ?? String(pl) > String(pr)) ? pl : pr) as string | null
      } else parentId = (d.l ?? d.r)?.parentId ?? null
      if (parentId !== null && (!drafts.has(parentId) || lost.has(parentId) || parentId === d.id)) parentId = null
    }
    const content = (lists.get(d.id) ?? []).filter((id) => !lost.has(id))
    const block: SyncBlock = { id: d.id, type: d.type, parentId, content, props: d.props, createdAt: d.createdAt, updatedAt: 0, trashedAt: d.trashedAt }
    const same = (side: SyncBlock | undefined): boolean =>
      side !== undefined &&
      side.type === block.type &&
      side.parentId === block.parentId &&
      side.trashedAt === block.trashedAt &&
      sameList(side.content, block.content) &&
      sameProps(side.props, block.props)
    const asLocal = same(d.l)
    const asRemote = same(d.r)
    const stamps = [d.l?.updatedAt, d.r?.updatedAt].filter((x): x is number => x !== undefined)
    if (tied.has(d.id)) block.updatedAt = Math.max(...stamps) + 1
    else block.updatedAt = asLocal && !asRemote ? (d.l as SyncBlock).updatedAt : asRemote && !asLocal ? (d.r as SyncBlock).updatedAt : Math.max(...stamps)
    blocks.set(d.id, block)
  }
  const root = (lists.get(null) ?? []).filter((id) => !lost.has(id))
  const rootAsLocal = sameList(root, local.root)
  const rootAsRemote = sameList(root, remote.root)
  const rootAt = tied.has(null)
    ? Math.max(local.rootAt ?? 0, remote.rootAt ?? 0) + 1
    : rootAsLocal && !rootAsRemote
      ? (local.rootAt ?? 0)
      : rootAsRemote && !rootAsLocal
        ? (remote.rootAt ?? 0)
        : Math.max(local.rootAt ?? 0, remote.rootAt ?? 0)
  const merged: Workspace = { blocks, root, rootAt }
  // A last pass that only ever matters for damaged input: whatever is still unreachable is left out.
  const result = normalizeWorkspace(merged)
  stats.dropped = drafts.size - result.blocks.size
  stats.blocks = result.blocks.size
  stats.conflicts = conflicts.length
  return { result, conflicts, stats }
}

// --------------------------------------------------------------- invariants

/** Everything that would make a workspace inconsistent; empty when it is sound. Used by tests and before a merge is applied. */
export function checkWorkspace(ws: Workspace): string[] {
  const problems: string[] = []
  const listedBy = new Map<string, string | null>()
  const list = (parent: string | null, ids: readonly string[]): void => {
    const seen = new Set<string>()
    for (const id of ids) {
      const child = ws.blocks.get(id)
      if (!child) problems.push(`${parent ?? 'root'} lists the missing block ${id}`)
      else if (seen.has(id) || listedBy.has(id)) problems.push(`${id} is listed more than once`)
      else if (child.trashedAt !== null) problems.push(`${id} is in the trash and still listed`)
      else if (child.parentId !== parent) problems.push(`${id} is listed by ${parent ?? 'root'} but says its parent is ${child.parentId ?? 'root'}`)
      seen.add(id)
      listedBy.set(id, parent)
    }
  }
  list(null, ws.root)
  for (const id of ws.root) if (!isPageLike(ws.blocks.get(id)?.type ?? '')) problems.push(`${id} is at the root and is not a page`)
  for (const block of ws.blocks.values()) list(block.id, block.content)
  for (const block of ws.blocks.values()) {
    if (block.trashedAt !== null) {
      if (!isPageLike(block.type)) problems.push(`${block.id} is in the trash and is not a page`)
      if (block.parentId !== null && !ws.blocks.has(block.parentId)) problems.push(`${block.id} remembers a parent that is missing`)
    } else if (!listedBy.has(block.id)) problems.push(`${block.id} is not listed by anything`)
    // Up to the root or to a page in the trash, without meeting a block twice.
    const seen = new Set<string>()
    let cur: string | null = block.id
    while (cur !== null) {
      if (seen.has(cur)) {
        problems.push(`${block.id} is inside a cycle`)
        break
      }
      seen.add(cur)
      const at = ws.blocks.get(cur)
      if (!at || at.trashedAt !== null) break
      cur = at.parentId
    }
  }
  return problems
}
