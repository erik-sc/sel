// Relation properties: the rules both processes need. A relation cell stores the ids of
// the rows (pages) it links to; a two-way relation has a partner property in the target
// database that holds the same links seen from the other side. The renderer reads and
// edits them (database/logic/relation.ts); the main process keeps them right when a
// subtree is duplicated (db/repository.ts). Pure: no Electron, no React, no store.
import type { BlockProps, PropertyValue, RelationConfig } from './types'

/** Block ids, as the repository accepts them. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** Property ids are schema keys: bounded and never a member of Object.prototype. */
const MAX_KEY_LENGTH = 200

/** Most links one cell keeps; anything beyond is dropped when the cell is read or written. */
export const MAX_RELATION_LINKS = 500

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** A string that can be the id of a linked row or of a related database. */
export function isRelationId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id) && !(id in Object.prototype)
}

function isPropertyKey(id: unknown): id is string {
  return typeof id === 'string' && id !== '' && id.length <= MAX_KEY_LENGTH && !(id in Object.prototype)
}

/**
 * The configuration of a relation property, repaired: a related database id, a partner
 * property id (two-way) and a limit, each kept only when well-formed. Undefined when there
 * is no usable database id (a relation that has not been pointed anywhere yet). Returns
 * `raw` itself when it needs no change, so memoisation holds.
 */
export function sanitizeRelationConfig(raw: unknown): RelationConfig | undefined {
  if (!isPlain(raw) || !isRelationId(raw.databaseId)) return undefined
  const badSynced = raw.syncedPropertyId !== undefined && !isPropertyKey(raw.syncedPropertyId)
  const badLimit = raw.limit !== undefined && raw.limit !== 'one'
  if (!badSynced && !badLimit) return raw as unknown as RelationConfig
  const out = { ...raw } as unknown as RelationConfig
  if (badSynced) delete out.syncedPropertyId
  if (badLimit) delete out.limit
  return out
}

/**
 * The linked row ids a stored cell holds: well-formed ids only, each once, in their stored
 * order, at most `MAX_RELATION_LINKS` (one under `limit: 'one'`). A lone id counts as a list
 * of one. Returns the stored array itself when it is already clean.
 */
export function relationIds(raw: unknown, limit?: RelationConfig['limit']): string[] {
  const max = limit === 'one' ? 1 : MAX_RELATION_LINKS
  if (typeof raw === 'string') return isRelationId(raw) ? [raw] : []
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw as unknown[]) {
    if (out.length >= max) break
    if (isRelationId(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out.length === raw.length ? (raw as string[]) : out
}

/** The relation properties of a stored schema, with their repaired configuration. */
function relationsOf(schema: unknown): { id: string; config: RelationConfig }[] {
  const out: { id: string; config: RelationConfig }[] = []
  if (!isPlain(schema)) return out
  for (const id of Object.keys(schema)) {
    const prop = schema[id]
    if (!isPropertyKey(id) || !isPlain(prop) || prop.type !== 'relation') continue
    const config = sanitizeRelationConfig(prop.relation)
    if (config) out.push({ id, config })
  }
  return out
}

/** The partner of a two-way relation, when the target database really has it pointing back. */
export function partnerOf(
  config: RelationConfig,
  propertyId: string,
  ownDatabaseId: string,
  targetSchema: unknown
): { id: string; config: RelationConfig } | undefined {
  const syncedId = config.syncedPropertyId
  if (!syncedId) return undefined
  const partner = relationsOf(targetSchema).find((p) => p.id === syncedId)
  if (!partner || partner.config.databaseId !== ownDatabaseId || partner.config.syncedPropertyId !== propertyId) return undefined
  return partner
}

/** One block of a duplicated subtree, as the repository is about to insert it. Its props are a fresh copy. */
export interface DuplicateCopy {
  id: string
  type: string
  parentId: string | null
  props: BlockProps
}

/** What the duplicate needs to know about blocks outside the copy. */
export interface DuplicateSource {
  get(id: string): { id: string; type: string; parentId: string | null; props: BlockProps } | null | undefined
}

type Values = Record<string, PropertyValue>

/**
 * Keeps relations meaningful in a duplicated subtree. `copyOf` maps each copied block to
 * its copy. Edits the copies' props in place and returns the new `values` of rows outside
 * the copy that must change:
 *  - a relation of a copied database to a database copied with it points at that copy;
 *    a two-way relation to a database that was not copied becomes one-way in the copy
 *    (the partner keeps pointing at the original);
 *  - a copied row links to the copies of the rows it linked to when its relation targets
 *    a copied database, and to the same rows otherwise;
 *  - a row copied into its original database (a duplicated row) is also added to the
 *    partner cells of the rows it links to, so the two sides stay in step. Under a partner
 *    that holds one link only, the copy gives that link up instead of stealing it.
 */
export function relinkDuplicate(copies: DuplicateCopy[], copyOf: ReadonlyMap<string, string>, source: DuplicateSource): Map<string, Values> {
  const byId = new Map(copies.map((copy) => [copy.id, copy]))
  const copied = new Set(copyOf.values())

  for (const copy of copies) {
    if (copy.type !== 'database' || !isPlain(copy.props.schema)) continue
    const schema = copy.props.schema as Record<string, unknown>
    for (const { id, config } of relationsOf(schema)) {
      const mapped = copyOf.get(config.databaseId)
      const prop = schema[id] as Record<string, unknown>
      if (mapped !== undefined) prop.relation = { ...config, databaseId: mapped }
      else if (config.syncedPropertyId !== undefined) {
        const oneWay = { ...config }
        delete oneWay.syncedPropertyId
        prop.relation = oneWay
      }
    }
  }

  const updates = new Map<string, Values>()
  const valuesOf = (row: { id: string; props: BlockProps }): Values => {
    const pending = updates.get(row.id)
    if (pending) return pending
    return isPlain(row.props.values) ? (row.props.values as Values) : {}
  }

  for (const copy of copies) {
    if (copy.type !== 'page' || copy.parentId === null || !isPlain(copy.props.values)) continue
    const parentCopy = byId.get(copy.parentId)
    const parent = parentCopy ?? source.get(copy.parentId)
    if (!parent || parent.type !== 'database') continue
    const values = copy.props.values as Values
    for (const { id, config } of relationsOf(parent.props.schema)) {
      if (!Object.hasOwn(values, id)) continue
      let ids = relationIds(values[id], config.limit)
      if (copied.has(config.databaseId)) {
        ids = ids.map((linked) => copyOf.get(linked)).filter((linked): linked is string => linked !== undefined)
      } else if (!parentCopy) {
        const target = source.get(config.databaseId)
        const partner = target?.type === 'database' ? partnerOf(config, id, parent.id, target.props.schema) : undefined
        if (partner) {
          const kept: string[] = []
          for (const linked of ids) {
            const row = source.get(linked)
            if (!row || row.type !== 'page' || row.parentId !== config.databaseId) {
              kept.push(linked)
              continue
            }
            const current = relationIds(valuesOf(row)[partner.id], partner.config.limit)
            if (!current.includes(copy.id)) {
              // A full partner cell (one link under `limit: 'one'`) is not taken over.
              if (current.length >= (partner.config.limit === 'one' ? 1 : MAX_RELATION_LINKS)) continue
              updates.set(row.id, { ...valuesOf(row), [partner.id]: [...current, copy.id] })
            }
            kept.push(linked)
          }
          ids = kept
        }
      }
      if (ids.length) values[id] = ids
      else delete values[id]
    }
  }
  return updates
}
