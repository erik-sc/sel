// Linked views: which database a block shows, and what it may show of it.
//
// A `database` block with `props.sourceId` is a linked view: schema and rows are
// the source's, `props.views` (and an optional title / icon override) are its own.
// Everything that renders or edits a database goes through `resolveDatabase` and
// `normalizeResolved`, so a view whose source is still loading, in the trash,
// deleted or not a database at all degrades to a state instead of to wrong data.
import type { Block, BlockProps, DatabaseView, ViewType } from '../../../../shared/types'
import { sourceIdOf } from '../../../../shared/linked'
import { ensureDatabaseProps, normalizeDatabase, sanitizeViews, type NormalizedDatabase } from './normalize'
import type { CellContext } from './relation'
import { DEFAULT_VIEW_ID, iconOf, makeId, titleOf, type Schema } from './values'
import { createDefaultView } from './views'

export { isLinkedView, sourceIdOf } from '../../../../shared/linked'

export type DatabaseStatus = 'ok' | 'trashed' | 'missing' | 'loading'

/** How blocks are looked up while resolving: the store, or anything that stands in for it. */
export interface BlockLookup {
  get(id: string): Block | undefined
  /** True once a block is known not to exist (as opposed to not being loaded yet). */
  isMissing?(id: string): boolean
}

export interface ResolvedDatabase {
  /** The block that was asked about: it owns the views (and, for a linked view, the title / icon override). */
  view: Block
  /** The database that owns schema and rows: `view` itself, or the source of a linked view. Null while unavailable. */
  source: Block | null
  status: DatabaseStatus
  linked: boolean
  /** The id `view` points at, whatever its state (null when `view` is not a linked view). */
  sourceId: string | null
  /** With status `trashed`: the block to restore (the source, or the page it sits in). */
  trashedId: string | null
}

/** Ancestor walks stop here: deeper than any real workspace, and corrupt parent cycles end. */
const MAX_DEPTH = 100

/** The nearest trashed block on the way up from `block` (itself included), as far as the lookup knows. */
function trashedAbove(block: Block, lookup: BlockLookup): string | null {
  const seen = new Set<string>()
  let cursor: Block | undefined = block
  while (cursor && !seen.has(cursor.id) && seen.size < MAX_DEPTH) {
    if (cursor.trashedAt) return cursor.id
    seen.add(cursor.id)
    cursor = cursor.parentId ? lookup.get(cursor.parentId) : undefined
  }
  return null
}

/**
 * Resolves the database a block shows. An ordinary database resolves to itself.
 * A linked view resolves to its source when that is a live database that is not
 * itself a linked view; otherwise `source` is null and `status` says why:
 * `loading` (not in the cache yet), `trashed` (it, or a page above it, is in the
 * trash) or `missing` (deleted, or not something a view can point at).
 */
export function resolveDatabase(view: Block, lookup: BlockLookup): ResolvedDatabase {
  const sourceId = sourceIdOf(view)
  if (sourceId === null) return { view, source: view, status: 'ok', linked: false, sourceId: null, trashedId: null }
  const base = { view, linked: true, sourceId, source: null, trashedId: null }
  const source = lookup.get(sourceId)
  if (!source) return { ...base, status: lookup.isMissing?.(sourceId) ? 'missing' : 'loading' }
  // A chain or a non-database is malformed data: never followed, never rendered as rows.
  if (source.type !== 'database' || sourceIdOf(source) !== null) return { ...base, status: 'missing' }
  const trashedId = trashedAbove(source, lookup)
  if (trashedId !== null) return { ...base, status: 'trashed', trashedId }
  return { ...base, source, status: 'ok' }
}

/**
 * The `CellContext` relations and rollups read through: the blocks of `lookup`, and the
 * normalised schema of any database in it (a linked view has none of its own).
 */
export function cellContext(lookup: BlockLookup): CellContext {
  return {
    get: (id) => lookup.get(id),
    isMissing: (id) => lookup.isMissing?.(id) === true,
    schemaOf: (id) => {
      const block = lookup.get(id)
      return block?.type === 'database' && sourceIdOf(block) === null ? normalizeDatabase(block).schema : undefined
    }
  }
}

/** Last result per raw `views` array of a linked view, for one schema object (both are immutable in the store). */
const linkedCache = new WeakMap<object, WeakMap<object, NormalizedDatabase>>()
/** The default views of a linked view that has none stored, per schema. */
const defaultCache = new WeakMap<object, NormalizedDatabase>()

/**
 * Schema and views to render `view` with. For an ordinary database this is
 * `normalizeDatabase`. For a linked view the schema is the source's and the
 * views are the linked block's own, validated against that schema; `changed`
 * then only speaks about the views (the source is repaired where it is shown).
 * Without a usable source there is nothing to validate against: the result is
 * an empty placeholder with `changed: false`, so nothing is ever written back.
 */
export function normalizeResolved(resolved: ResolvedDatabase | null | undefined): NormalizedDatabase {
  if (!resolved) return normalizeDatabase(undefined)
  if (!resolved.linked) return normalizeDatabase(resolved.view)
  if (!resolved.source) return { ...ensureDatabaseProps(undefined), changed: false }
  const schema: Schema = normalizeDatabase(resolved.source).schema
  const props: unknown = resolved.view.props
  const rawViews: unknown = props !== null && typeof props === 'object' ? (props as BlockProps).views : undefined

  if (!Array.isArray(rawViews)) {
    let hit = defaultCache.get(schema)
    if (!hit) {
      hit = { schema, views: [createDefaultView('table', schema, DEFAULT_VIEW_ID)], changed: true }
      defaultCache.set(schema, hit)
    }
    return hit
  }
  let perSchema = linkedCache.get(schema)
  if (!perSchema) linkedCache.set(schema, (perSchema = new WeakMap()))
  const cached = perSchema.get(rawViews)
  if (cached) return cached

  let views = sanitizeViews(rawViews as DatabaseView[], schema)
  if (!views.length) views = [createDefaultView('table', schema, DEFAULT_VIEW_ID)]
  const changed = rawViews.length !== views.length || views.some((v, i) => v !== rawViews[i])
  const result: NormalizedDatabase = { schema, views: changed ? views : (rawViews as DatabaseView[]), changed }
  perSchema.set(rawViews, result)
  return result
}

/** The title shown for a database: a linked view's own when it has one, otherwise its source's. */
export function displayTitle(resolved: ResolvedDatabase | null | undefined): string {
  if (!resolved) return ''
  return titleOf(resolved.view) || (resolved.linked ? titleOf(resolved.source) : '')
}

/** The icon shown for a database: a linked view's own when it has one, otherwise its source's. */
export function displayIcon(resolved: ResolvedDatabase | null | undefined): string | undefined {
  if (!resolved) return undefined
  return iconOf(resolved.view) ?? (resolved.linked ? iconOf(resolved.source) : undefined)
}

/**
 * Props of a new linked view of `target`: one view of the given type (a table showing
 * every property of the source, unless asked otherwise). `target` may itself be a linked view; the new view then points
 * at the same source (a view never points at a view). Null when there is no
 * usable source to link to.
 */
export function linkedViewProps(
  target: Block | undefined | null,
  lookup: BlockLookup,
  newId: () => string = makeId,
  type: ViewType = 'table'
): BlockProps | null {
  if (!target || target.type !== 'database') return null
  const resolved = resolveDatabase(target, lookup)
  if (!resolved.source || resolved.status !== 'ok') return null
  const schema = normalizeDatabase(resolved.source).schema
  return { sourceId: resolved.source.id, views: [createDefaultView(type, schema, newId())] }
}
