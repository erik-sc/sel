// Store-backed mutations. Every change goes through applyOps; schema and view
// edits are `update` ops on the database block, rows are create/update/move/delete.
//
// Lost-update rule: an `update` op replaces whole props (`schema`, `views`, a row's
// `values`), so every patch here is built from the store state *at commit time*
// (`getBlock` / `snapshot`), never from what a component rendered with. The store
// applies ops synchronously, so consecutive actions compose.
//
// Linked views: every action takes the id of the block that is on screen. For a
// linked view that block owns the views only; schema and rows belong to its source.
// `snapshot` resolves the two, and each write goes to the block that owns what it
// changes (views -> the linked block, schema / rows / cells -> the source). While
// the source is unavailable (loading, in the trash, deleted) nothing is written
// (`setSchema`, `setViews` and `createRow` are the gates every edit passes).
import type { Block, BlockProps, DatabaseView, Op, PropertySchema, PropertyType, PropertyValue, RichText, ViewType } from '../../../shared/types'
import { applyOps, getBlock, loadChildren, loadTree, newId } from '../store/blocks'
import * as L from './logic'
import { markFreshChart } from './chartFresh'

function run(ops: Op[]): void {
  if (!ops.length) return
  applyOps(ops).catch((error) => console.error('database: applyOps failed', error))
}

function toRichText(text: string): RichText {
  return text ? [[text]] : []
}

export interface DbSnapshot {
  /** The block the views belong to (the database itself, or a linked view of one). */
  block: Block | undefined
  /** The block schema and rows belong to: `block`, or the source of a linked view. */
  source: Block | undefined
  /** Id of `source` (the id asked about while nothing is resolved). */
  sourceId: string
  linked: boolean
  /** False for a linked view whose source cannot be used right now: nothing may be written. */
  ready: boolean
  schema: L.Schema
  views: DatabaseView[]
  changed: boolean
}

const storeLookup: L.BlockLookup = { get: (id) => getBlock(id) }

/** A database (or linked view) and its source as they are in the store right now. */
export function resolve(databaseId: string): L.ResolvedDatabase | undefined {
  const block = getBlock(databaseId)
  return block ? L.resolveDatabase(block, storeLookup) : undefined
}

/** Freshest normalised state of a database, straight from the store. */
export function snapshot(databaseId: string): DbSnapshot {
  const resolved = resolve(databaseId)
  if (!resolved) {
    return { block: undefined, source: undefined, sourceId: databaseId, linked: false, ready: true, ...L.normalizeDatabase(undefined) }
  }
  return {
    block: resolved.view,
    source: resolved.source ?? undefined,
    sourceId: resolved.source?.id ?? resolved.sourceId ?? databaseId,
    linked: resolved.linked,
    ready: resolved.status === 'ok',
    ...L.normalizeResolved(resolved)
  }
}

/** The id of the database that holds the rows shown by `databaseId` (itself, unless it is a linked view). */
export function rowsOwnerId(databaseId: string): string {
  return resolve(databaseId)?.sourceId ?? databaseId
}

/** Rows of a database that are loaded in the store, in database order. For a linked view: its source's. */
export function rowsOf(databaseId: string, options: { includeTrashed?: boolean } = {}): Block[] {
  const ownerId = rowsOwnerId(databaseId)
  const out: Block[] = []
  for (const id of L.contentOf(getBlock(ownerId))) {
    const row = getBlock(id)
    if (!row || row.type !== 'page' || row.parentId !== ownerId) continue
    if (row.trashedAt && !options.includeTrashed) continue
    out.push(row)
  }
  return out
}

/**
 * Runs `task` once every row of the database is in the store. Schema changes that
 * rewrite row values (type change, deleting an option or a property) must see all
 * rows, and a row page can be open without its siblings having been loaded.
 */
function withAllRows(databaseId: string, task: () => void): void {
  const ownerId = rowsOwnerId(databaseId)
  if (L.contentOf(getBlock(ownerId)).every((id) => getBlock(id))) {
    task()
    return
  }
  loadChildren(ownerId).then(task, (error) => console.error('database: loading rows failed', error))
}

function valuesOp(rowId: string, values: L.Values): Op {
  return { op: 'update', id: rowId, patch: { props: { values } } }
}

export function updateDatabase(databaseId: string, props: NonNullable<Extract<Op, { op: 'update' }>['patch']['props']>): void {
  run([{ op: 'update', id: databaseId, patch: { props } }])
}

/**
 * Renames a database. On a linked view this only sets (or, with an empty title or the
 * source's own, clears) the view's override: the source keeps its name.
 */
export function setTitle(databaseId: string, title: string): void {
  const resolved = resolve(databaseId)
  if (!resolved) return
  if (!resolved.linked) {
    if (L.titleOf(resolved.view) !== title) updateDatabase(databaseId, { title: toRichText(title) })
    return
  }
  if (L.displayTitle(resolved) === title) return
  const inherit = title === '' || (resolved.source !== null && title === L.titleOf(resolved.source))
  if (inherit) resetTitle(databaseId)
  else updateDatabase(databaseId, { title: toRichText(title) })
}

/** Drops the title override of a linked view, so that it shows its source's title again. */
export function resetTitle(databaseId: string): void {
  const block = getBlock(databaseId)
  if (!block || !L.isLinkedView(block) || block.props.title === undefined) return
  updateDatabase(databaseId, { title: null })
}

/**
 * Adds a linked view of a database (or of the source of a linked view) at the end of a
 * page. Resolves to the id of the new block, or undefined when there is no usable source.
 */
export async function insertLinkedView(pageId: string, databaseId: string): Promise<string | undefined> {
  const props = L.linkedViewProps(getBlock(databaseId), storeLookup, newId)
  if (!props) return undefined
  const id = newId()
  await applyOps([{ op: 'create', input: { id, type: 'database', parentId: pageId, props } }])
  return id
}

/** Removes a linked view. The backend deletes just that block: its source and rows are not touched. */
export function removeLinkedView(databaseId: string): void {
  const block = getBlock(databaseId)
  if (block && L.isLinkedView(block)) run([{ op: 'delete', id: databaseId }])
}

/**
 * Writes a schema, optionally with the views that go with it. On a linked view the
 * two belong to different blocks: the schema goes to the source, the views stay.
 */
function setSchema(databaseId: string, schema: L.Schema, views?: DatabaseView[], extra: Op[] = []): void {
  const snap = snapshot(databaseId)
  if (!snap.linked) {
    const props: BlockProps = { schema }
    if (views) props.views = views
    run([{ op: 'update', id: databaseId, patch: { props } }, ...extra])
    return
  }
  if (!snap.ready) return
  const ops: Op[] = []
  if (schema !== snap.schema) ops.push({ op: 'update', id: snap.sourceId, patch: { props: { schema } } })
  if (views) ops.push({ op: 'update', id: databaseId, patch: { props: { views } } })
  run([...ops, ...extra])
}

function setViews(databaseId: string, views: DatabaseView[]): void {
  if (!snapshot(databaseId).ready) return
  run([{ op: 'update', id: databaseId, patch: { props: { views } } }])
}

/** Persists the repaired schema / views of a database whose stored data was malformed. */
export function repairDatabase(databaseId: string): boolean {
  const { block, schema, views, changed, linked, ready } = snapshot(databaseId)
  if (!block || block.type !== 'database' || !changed || !ready) return false
  // A linked view only ever repairs its own views; its source is repaired where it is shown.
  if (linked) setViews(databaseId, views)
  else setSchema(databaseId, schema, views)
  return true
}

/** Edits one view. The patch is applied to the view as it is in the store right now. */
export function patchView(
  databaseId: string,
  viewId: string,
  patch: Partial<Omit<DatabaseView, 'id'>> | ((view: DatabaseView, schema: L.Schema) => DatabaseView)
): void {
  const { block, views, schema, ready } = snapshot(databaseId)
  const current = views.find((v) => v.id === viewId)
  if (!block || !current || !ready) return
  const next = typeof patch === 'function' ? patch(current, schema) : { ...current, ...patch, id: current.id }
  if (next === current) return
  // Whatever the caller produced, only valid references reach the store.
  const replaced = views.map((v) => (v.id === viewId ? { ...next, id: current.id } : v))
  const sanitized = L.sanitizeViews(replaced, schema)
  if (L.sameValue(sanitized, views)) return
  setViews(databaseId, sanitized)
}

// ---- views ----

export function addView(databaseId: string, type: ViewType): string {
  const { schema, views } = snapshot(databaseId)
  const result = L.addView(schema, views, type)
  setSchema(databaseId, result.schema, result.views)
  if (type === 'chart') markFreshChart(result.view.id)
  return result.view.id
}

export function renameView(databaseId: string, viewId: string, name: string): void {
  const { views, ready } = snapshot(databaseId)
  if (!ready) return
  const next = L.renameView(views, viewId, name)
  if (next !== views) setViews(databaseId, next)
}

export function duplicateView(databaseId: string, viewId: string): string | undefined {
  const { views, ready } = snapshot(databaseId)
  if (!ready) return undefined
  const result = L.duplicateView(views, viewId)
  if (result.view) setViews(databaseId, result.views)
  return result.view?.id
}

export function deleteView(databaseId: string, viewId: string): void {
  const { views, ready } = snapshot(databaseId)
  if (!ready) return
  const next = L.deleteView(views, viewId)
  if (next !== views) setViews(databaseId, next)
}

// ---- properties ----

/**
 * Adds a property and shows it in the given view (other views keep it hidden).
 * With `groupView`, that view is also laid out by the new property (board / calendar).
 */
export function addProperty(
  databaseId: string,
  type: PropertyType,
  viewId?: string,
  name?: string,
  options: { groupView?: boolean } = {}
): string {
  const { schema, views } = snapshot(databaseId)
  const result = L.addProperty(schema, { id: newId(), type, name })
  const id = result.property.id
  const nextViews = views.map((v) => {
    if (!(v.id === viewId || (viewId === undefined && v.type === 'table'))) return v
    const next = { ...v, visibleProperties: [...v.visibleProperties, id] }
    if (options.groupView && viewId !== undefined) next.groupBy = id
    return next
  })
  setSchema(databaseId, result.schema, L.sanitizeViews(nextViews, result.schema))
  return id
}

export function renameProperty(databaseId: string, propertyId: string, name: string): void {
  const { schema } = snapshot(databaseId)
  const next = L.renameProperty(schema, propertyId, name)
  if (next !== schema) setSchema(databaseId, next)
}

export function updateProperty(
  databaseId: string,
  propertyId: string,
  patch: Partial<Omit<PropertySchema, 'id' | 'type'>>
): void {
  const { schema } = snapshot(databaseId)
  const next = L.updateProperty(schema, propertyId, patch)
  if (next !== schema) setSchema(databaseId, next)
}

export function changePropertyType(databaseId: string, propertyId: string, type: PropertyType): void {
  withAllRows(databaseId, () => {
    const { schema, views } = snapshot(databaseId)
    const result = L.changePropertyType(schema, propertyId, type, rowsOf(databaseId, { includeTrashed: true }))
    if (result.schema === schema) return
    const rowOps = Object.keys(result.rowValues).map((id) => valuesOp(id, result.rowValues[id]))
    setSchema(databaseId, result.schema, L.sanitizeViews(views, result.schema), rowOps)
  })
}

/** Deletes a property together with every view reference and every stored cell. */
export function deleteProperty(databaseId: string, propertyId: string): void {
  withAllRows(databaseId, () => {
    const { schema, views } = snapshot(databaseId)
    const result = L.deleteProperty(schema, views, propertyId)
    if (result.schema === schema) return
    const rowOps: Op[] = []
    for (const row of rowsOf(databaseId, { includeTrashed: true })) {
      const values = L.stripPropertyFromValues(row, propertyId)
      if (values) rowOps.push(valuesOp(row.id, values))
    }
    setSchema(databaseId, result.schema, result.views, rowOps)
  })
}

export function addOption(databaseId: string, propertyId: string, name: string): string | undefined {
  const { schema } = snapshot(databaseId)
  const result = L.addOption(schema, propertyId, name)
  if (result.schema !== schema) setSchema(databaseId, result.schema)
  return result.option?.id
}

export function updateOption(
  databaseId: string,
  propertyId: string,
  optionId: string,
  patch: { name?: string; color?: string }
): void {
  const { schema } = snapshot(databaseId)
  const next = L.updateOption(schema, propertyId, optionId, patch)
  if (next !== schema) setSchema(databaseId, next)
}

/** Deletes an option and strips it from filter rules and from every row that uses it. */
export function deleteOption(databaseId: string, propertyId: string, optionId: string): void {
  withAllRows(databaseId, () => {
    const { schema, views } = snapshot(databaseId)
    const next = L.deleteOption(schema, propertyId, optionId)
    if (next === schema) return
    const rowOps: Op[] = []
    for (const row of rowsOf(databaseId, { includeTrashed: true })) {
      const values = L.stripOptionFromValues(row, propertyId, optionId)
      if (values) rowOps.push(valuesOp(row.id, values))
    }
    const nextViews = L.sanitizeViews(L.stripOptionFromViews(views, propertyId, optionId), next)
    const viewsChanged = nextViews.length !== views.length || nextViews.some((v, i) => v !== views[i])
    setSchema(databaseId, next, viewsChanged ? nextViews : undefined, rowOps)
  })
}

// ---- rows ----

function cellOp(row: Block, prop: PropertySchema, value: PropertyValue): Op | undefined {
  if (prop.type === 'title') {
    const text = typeof value === 'string' ? value : ''
    return text === L.titleOf(row) ? undefined : { op: 'update', id: row.id, patch: { props: { title: toRichText(text) } } }
  }
  if (L.isComputedType(prop.type)) return undefined
  const current = L.valuesOf(row)
  const values = L.setValue(current, prop.id, L.sanitizeValue(prop, value))
  if (L.sameValue(values[prop.id], Object.hasOwn(current, prop.id) ? current[prop.id] : null)) return undefined
  return valuesOp(row.id, values)
}

/** The property as it is in the store now (the caller's copy may predate a schema edit). */
function latestProp(row: Block, prop: PropertySchema): PropertySchema {
  const parent = getBlock(row.parentId)
  const latest = parent?.type === 'database' ? L.propOf(L.normalizeDatabase(parent).schema, prop.id) : undefined
  return latest && latest.type === prop.type ? latest : prop
}

/** The `update` op that sets one cell, built from the row as it is in the store now. */
export function cellUpdateOp(rowId: string, prop: PropertySchema, value: PropertyValue): Op | undefined {
  const row = getBlock(rowId)
  return row ? cellOp(row, latestProp(row, prop), value) : undefined
}

export function setCell(rowId: string, prop: PropertySchema, value: PropertyValue): void {
  const op = cellUpdateOp(rowId, prop, value)
  if (op) run([op])
}

/**
 * Read-modify-write of one cell against the latest store state: `update` receives
 * the current normalised value, so quick successive edits never drop each other.
 */
export function updateCell(rowId: string, prop: PropertySchema, update: (current: PropertyValue) => PropertyValue): void {
  const row = getBlock(rowId)
  if (!row) return
  const latest = latestProp(row, prop)
  const op = cellOp(row, latest, update(L.getCellValue(row, latest)))
  if (op) run([op])
}

export function toggleCheckbox(rowId: string, prop: PropertySchema): void {
  if (prop.type === 'checkbox') updateCell(rowId, prop, (current) => current !== true)
}

export interface NewRowInput {
  title?: string
  values?: L.Values
  /** Insert after this row; null = first; undefined = append. */
  afterId?: string | null
  /** Filters of the active view: the row gets values that satisfy them where possible. */
  view?: DatabaseView
}

export function createRow(databaseId: string, input: NewRowInput = {}): string {
  const { schema, sourceId, ready } = snapshot(databaseId)
  const defaults = L.defaultsFromFilters(schema, input.view?.filters)
  const id = newId()
  const values: L.Values = {}
  for (const [propertyId, value] of Object.entries({ ...defaults.values, ...(input.values ?? {}) })) {
    const prop = L.propOf(schema, propertyId)
    const clean = prop ? L.sanitizeValue(prop, value) : null
    if (prop && clean !== null && clean !== false) values[prop.id] = clean
  }
  const title = input.title ?? defaults.title ?? ''
  const props: BlockProps = { title: toRichText(title) }
  if (Object.keys(values).length) props.values = values
  // Rows always live in the source, whichever view they were added from.
  const create: Op = { op: 'create', input: { id, type: 'page', parentId: sourceId, props } }
  if (input.afterId !== undefined) create.input.afterId = input.afterId
  if (ready) run([create])
  return id
}

export function deleteRows(ids: string[]): void {
  run(ids.filter((id) => getBlock(id)).map((id) => ({ op: 'delete', id })))
}

/** A row nobody put anything into yet: no title and no body. */
export function isPristineRow(row: Block | undefined): boolean {
  return !!row && row.type === 'page' && L.titleOf(row) === '' && L.contentOf(row).length === 0
}

/**
 * Removes a just-created row when its creation is cancelled (Escape in the title
 * editor) and it is still pristine. Returns whether the row was removed.
 */
export function discardPristineRow(rowId: string): boolean {
  const row = getBlock(rowId)
  if (!isPristineRow(row)) return false
  run([{ op: 'delete', id: rowId }])
  return true
}

/** Places a row right before `beforeId` in the database order (null = last). */
export function moveRowBefore(databaseId: string, rowId: string, beforeId: string | null, extra: Op[] = []): void {
  const ownerId = rowsOwnerId(databaseId)
  const db = getBlock(ownerId)
  if (!db || !getBlock(rowId)) return
  const afterId = L.afterIdForInsert(L.contentOf(db), rowId, beforeId)
  run([...extra, { op: 'move', id: rowId, parentId: ownerId, afterId }])
}

/** Places a row right after `afterId` in the database order. */
export function moveRowAfter(databaseId: string, rowId: string, afterId: string, extra: Op[] = []): void {
  const ownerId = rowsOwnerId(databaseId)
  if (rowId === afterId || !getBlock(ownerId) || !getBlock(rowId) || !getBlock(afterId)) {
    run(extra)
    return
  }
  run([...extra, { op: 'move', id: rowId, parentId: ownerId, afterId }])
}

/** Deep copy through the backend (keeps the page body), then resync the database. */
export async function duplicateRow(databaseId: string, rowId: string): Promise<string | undefined> {
  try {
    const ownerId = rowsOwnerId(databaseId)
    const copy = await window.api.pages.duplicate(rowId)
    await loadTree(ownerId)
    const content = L.contentOf(getBlock(ownerId))
    if (copy && content.includes(copy.id)) {
      const index = content.indexOf(rowId)
      if (index >= 0 && content[index + 1] !== copy.id) {
        run([{ op: 'move', id: copy.id, parentId: ownerId, afterId: rowId }])
      }
    }
    return copy?.id
  } catch (error) {
    console.error('database: duplicate failed', error)
    return undefined
  }
}

export function setRowTitle(rowId: string, title: string): void {
  const row = getBlock(rowId)
  if (!row || L.titleOf(row) === title) return
  run([{ op: 'update', id: rowId, patch: { props: { title: toRichText(title) } } }])
}

/** Applies prepared ops (e.g. a cell update combined with a move) as one batch. */
export function runOps(ops: Op[]): void {
  run(ops)
}
