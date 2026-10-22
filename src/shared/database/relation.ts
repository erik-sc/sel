// Relation properties: which rows a relation cell shows, which rows it may link to, and the
// writes that keep a two-way relation in step with its partner in the other database.
// The stored rules (ids, configuration) are shared with the main process: shared/relation.ts.
import type { Block, PropertySchema, RelationConfig } from '../types'
import { MAX_RELATION_LINKS, partnerOf, relationIds } from '../relation'
import { sourceIdOf } from '../linked'
import { TYPE_LABELS, cleanName, getCellValue, makeId, propOf, setValue, titleOf, valuesOf, type Schema, type Values } from './values'
import { uniqueName } from './views'

export { MAX_RELATION_LINKS, partnerOf, relationIds, sanitizeRelationConfig } from '../relation'

/**
 * What a cell may read beyond its own row: other blocks, and the normalised schema of a
 * database. Relations and rollups need it; the renderer builds one from the block store
 * (`cellContext` in ./resolve.ts) and the Markdown export from the repository. A new
 * context object stands for new data: views recompute what depends on it.
 */
export interface CellContext {
  get(id: string): Block | undefined
  /** The normalised schema of a database; undefined when it is not loaded or not a database. */
  schemaOf(databaseId: string): Schema | undefined
  /** True once a block is known not to exist (as opposed to not being loaded yet). */
  isMissing?(id: string): boolean
}

export type RelatedDatabaseState = 'ok' | 'loading' | 'missing' | 'trashed'

/** The configuration of a relation property that points somewhere, else undefined. */
export function relationOf(prop: PropertySchema | undefined): RelationConfig | undefined {
  return prop?.type === 'relation' ? prop.relation : undefined
}

/** The databases the relations of a schema point at, each once, in schema order. */
export function relationTargets(schema: Schema): string[] {
  const out: string[] = []
  for (const id of Object.keys(schema)) {
    const target = relationOf(schema[id])?.databaseId
    if (target && !out.includes(target)) out.push(target)
  }
  return out
}

/** Ancestor walks stop here: deeper than any real workspace, and corrupt parent cycles end. */
const MAX_DEPTH = 100
const stateCache = new WeakMap<CellContext, Map<string, RelatedDatabaseState>>()

/**
 * Whether a related database can be shown: `missing` when it was deleted (or is not a
 * database a relation can point at), `trashed` when it or a page above it is in the trash,
 * as far as the context knows its ancestors.
 */
export function relatedDatabaseState(databaseId: string, ctx: CellContext): RelatedDatabaseState {
  let known = stateCache.get(ctx)
  const hit = known?.get(databaseId)
  if (hit) return hit
  let state: RelatedDatabaseState = 'ok'
  const db = ctx.get(databaseId)
  if (!db) state = ctx.isMissing?.(databaseId) ? 'missing' : 'loading'
  else if (db.type !== 'database' || sourceIdOf(db) !== null) state = 'missing'
  else {
    const seen = new Set<string>()
    let cursor: Block | undefined = db
    while (cursor && !seen.has(cursor.id) && seen.size < MAX_DEPTH) {
      if (cursor.trashedAt) {
        state = 'trashed'
        break
      }
      seen.add(cursor.id)
      cursor = cursor.parentId ? ctx.get(cursor.parentId) : undefined
    }
  }
  if (!known) stateCache.set(ctx, (known = new Map()))
  known.set(databaseId, state)
  return state
}

/** A row of `databaseId` that is not in the trash: what a relation to that database may show. */
export function isRowOf(block: Block | undefined, databaseId: string): block is Block {
  return !!block && block.type === 'page' && block.parentId === databaseId && !block.trashedAt
}

/**
 * The rows a relation cell shows, in the order they were linked. Links to rows that were
 * deleted, are in the trash, moved out of the related database or are not loaded yet are
 * left out (and come back with their row); nothing shows while the database itself is gone.
 */
export function linkedRows(row: Block, prop: PropertySchema, ctx: CellContext): Block[] {
  const config = relationOf(prop)
  if (!config || relatedDatabaseState(config.databaseId, ctx) !== 'ok') return []
  const ids = getCellValue(row, prop)
  if (!Array.isArray(ids)) return []
  const out: Block[] = []
  for (const id of ids) {
    const linked = ctx.get(id)
    if (isRowOf(linked, config.databaseId)) out.push(linked)
  }
  return out
}

/** Ids of `linkedRows`. */
export function linkedIds(row: Block, prop: PropertySchema, ctx: CellContext): string[] {
  return linkedRows(row, prop, ctx).map((linked) => linked.id)
}

/** Titles of the linked rows, for plain-text output ("Untitled" for rows without one). */
export function linkedTitles(row: Block, prop: PropertySchema, ctx: CellContext): string[] {
  return linkedRows(row, prop, ctx).map((linked) => titleOf(linked) || 'Untitled')
}

/** The rows a relation can link to: the live rows of its database, in database order. */
export function linkableRows(config: RelationConfig | undefined, ctx: CellContext): Block[] {
  if (!config || relatedDatabaseState(config.databaseId, ctx) !== 'ok') return []
  const db = ctx.get(config.databaseId)
  const out: Block[] = []
  const content: unknown = db?.content
  for (const id of Array.isArray(content) ? (content as unknown[]) : []) {
    if (typeof id !== 'string') continue
    const linked = ctx.get(id)
    if (isRowOf(linked, config.databaseId)) out.push(linked)
  }
  return out
}

/** The ids a cell holds after toggling `id`: added at the end, or removed. Under `limit: 'one'` it replaces. */
export function toggleLink(current: readonly string[], id: string, limit?: RelationConfig['limit']): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id)
  if (limit === 'one') return [id]
  return current.length >= MAX_RELATION_LINKS ? [...current] : [...current, id]
}

/**
 * Every `values` write that setting the relation `prop` of `row` to `next` takes: the row's
 * own, and for a two-way relation the partner cells of the rows that gain or lose the link.
 * When the partner holds one link only, a row it is taken from loses its own link back.
 * Rows the context does not have are left alone (the caller loads both databases first).
 * Returns the complete new `values` per row id; empty when nothing changes.
 */
export function relationWrites(row: Block, prop: PropertySchema, next: unknown, ctx: CellContext): Map<string, Values> {
  const out = new Map<string, Values>()
  const config = relationOf(prop)
  if (!config) return out
  const current = (block: Block): Values => out.get(block.id) ?? valuesOf(block)
  const idsOf = (block: Block, propertyId: string, limit?: RelationConfig['limit']): string[] => {
    const values = current(block)
    return relationIds(Object.hasOwn(values, propertyId) ? values[propertyId] : undefined, limit)
  }
  const write = (block: Block, propertyId: string, ids: string[]): void => {
    const values = current(block)
    const before = Object.hasOwn(values, propertyId) ? values[propertyId] : undefined
    if (JSON.stringify(relationIds(before)) === JSON.stringify(ids)) return
    out.set(block.id, setValue(values, propertyId, ids.length ? ids : null))
  }

  const before = idsOf(row, prop.id, config.limit)
  let after = relationIds(Array.isArray(next) ? next : next === null || next === undefined ? [] : [next], config.limit).slice()
  const sourceId = row.parentId
  const partner = sourceId ? partnerOf(config, prop.id, sourceId, ctx.schemaOf(config.databaseId)) : undefined
  if (!partner || !sourceId) {
    write(row, prop.id, after)
    return out
  }
  const targetRow = (id: string): Block | undefined => {
    const block = ctx.get(id)
    return block && block.type === 'page' && block.parentId === config.databaseId ? block : undefined
  }

  for (const id of before) {
    if (after.includes(id)) continue
    const other = targetRow(id)
    if (!other) continue
    const ids = idsOf(other, partner.id, partner.config.limit)
    if (ids.includes(row.id))
      write(
        other,
        partner.id,
        ids.filter((x) => x !== row.id)
      )
  }
  write(row, prop.id, after)
  for (const id of after) {
    if (before.includes(id)) continue
    const other = targetRow(id)
    if (!other) continue
    const ids = idsOf(other, partner.id, partner.config.limit)
    if (ids.includes(row.id)) continue
    if (partner.config.limit === 'one') {
      // The row `other` linked back to until now loses its link to `other`.
      for (const previous of ids) {
        const block = ctx.get(previous)
        if (!block || block.id === row.id || block.type !== 'page' || block.parentId !== sourceId) continue
        const theirs = idsOf(block, prop.id, config.limit)
        if (theirs.includes(other.id))
          write(
            block,
            prop.id,
            theirs.filter((x) => x !== other.id)
          )
      }
      write(other, partner.id, [row.id])
    } else if (ids.length < MAX_RELATION_LINKS) {
      write(other, partner.id, [...ids, row.id])
    } else {
      // The other side is full: the link is not made on either side.
      after = after.filter((x) => x !== other.id)
      write(row, prop.id, after)
    }
  }
  return out
}

/**
 * For a relation that becomes two-way: the partner cells that give the existing links from
 * the other side. `rows` are the rows of the relation's own database.
 */
export function partnerBackfill(rows: readonly Block[], prop: PropertySchema, partnerId: string, ctx: CellContext): Map<string, Values> {
  const out = new Map<string, Values>()
  const config = relationOf(prop)
  if (!config) return out
  for (const row of rows) {
    const ids = getCellValue(row, prop)
    if (!Array.isArray(ids)) continue
    for (const id of ids) {
      const other = ctx.get(id)
      if (!other || other.type !== 'page' || other.parentId !== config.databaseId) continue
      const values = out.get(other.id) ?? valuesOf(other)
      const have = relationIds(Object.hasOwn(values, partnerId) ? values[partnerId] : undefined)
      if (have.includes(row.id) || have.length >= MAX_RELATION_LINKS) continue
      out.set(other.id, setValue(values, partnerId, [...have, row.id]))
    }
  }
  return out
}

/**
 * The partner property a relation gets in its target database when it becomes two-way:
 * named after the database it comes from, pointing back at it and synced with `propertyId`.
 * Returns the target schema with the partner added.
 */
export function addPartnerProperty(
  targetSchema: Schema,
  input: { partnerId?: string; sourceDatabaseId: string; sourceTitle: string; propertyId: string }
): { schema: Schema; partner: PropertySchema } {
  const id = input.partnerId && !Object.hasOwn(targetSchema, input.partnerId) ? input.partnerId : makeId()
  const names = Object.values(targetSchema).map((p) => p.name)
  const partner: PropertySchema = {
    id,
    name: uniqueName(names, cleanName(input.sourceTitle) || TYPE_LABELS.relation),
    type: 'relation',
    relation: { databaseId: input.sourceDatabaseId, syncedPropertyId: input.propertyId }
  }
  return { schema: { ...targetSchema, [id]: partner }, partner }
}

/** The schema with the relation `propertyId` made one-way (its partner link dropped). */
export function dropPartnerLink(schema: Schema, propertyId: string): Schema {
  const prop = propOf(schema, propertyId)
  const config = relationOf(prop)
  if (!prop || !config || config.syncedPropertyId === undefined) return schema
  const relation = { ...config }
  delete relation.syncedPropertyId
  return { ...schema, [propertyId]: { ...prop, relation } }
}
