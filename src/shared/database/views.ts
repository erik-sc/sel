// Pure helpers on views (visibility, order, widths, sorts) and list ordering.
import type { DatabaseView, PropertySchema, PropertyType, ViewSort, ViewType } from '../types'
import { defaultCalcs } from './calcConfig'
import { defaultChartConfig } from './chartConfig'
import { VIEW_LABELS, cleanName, getTitleProperty, isSafeKey, makeId, orderedProperties, propOf, type Schema } from './values'

// ---------------------------------------------------------------------------
// Ordering helpers
// ---------------------------------------------------------------------------

/** Moves the item at `from` so that it ends up at index `to` of the result. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice()
  if (from < 0 || from >= out.length) return out
  const [item] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item)
  return out
}

/** Moves `item` so it sits right before `before` (or at the end when `before` is null). */
export function moveBefore<T>(list: readonly T[], item: T, before: T | null): T[] {
  const out = list.filter((x) => x !== item)
  const i = before === null ? -1 : out.indexOf(before)
  if (i < 0) out.push(item)
  else out.splice(i, 0, item)
  return out
}

/**
 * `afterId` for a `move` op that places `movingId` right before `beforeId`
 * in `order` (the parent's content). `beforeId` null = append.
 * Returns null for "first".
 */
export function afterIdForInsert(order: readonly string[], movingId: string, beforeId: string | null): string | null {
  const rest = order.filter((id) => id !== movingId)
  if (beforeId === null || beforeId === movingId) {
    if (beforeId === movingId) {
      const i = order.indexOf(movingId)
      return i > 0 ? order[i - 1] : null
    }
    return rest.length ? rest[rest.length - 1] : null
  }
  const i = rest.indexOf(beforeId)
  if (i < 0) return rest.length ? rest[rest.length - 1] : null
  return i === 0 ? null : rest[i - 1]
}

/**
 * Where a row dropped on a visible row must go in the database order.
 * `visible` is the (filtered) order on screen; the result is the `beforeId`
 * for `afterIdForInsert`, `{ afterId }` when the row goes right after the last
 * visible row (which need not be the last row of the database), or null for a no-op.
 */
export function rowDropTarget(
  visible: readonly string[],
  movingId: string,
  targetId: string,
  edge: 'before' | 'after'
): { beforeId: string } | { afterId: string } | null {
  // Dropped on itself: stays where it is (also relative to the rows the filter hides).
  if (targetId === movingId) return null
  if (edge === 'before') return { beforeId: targetId }
  const index = visible.indexOf(targetId)
  const next = index >= 0 ? visible[index + 1] : undefined
  if (next === movingId) return null
  if (next !== undefined) return { beforeId: next }
  return { afterId: targetId }
}

/**
 * The moves that put restored rows back where they were. `order` is the database order
 * before they left, `content` the order now (restoring appends). Each row goes right after
 * the nearest row before it in `order` that is still there (null = first); rows already in
 * place, and rows that did not come back, are left alone. Apply the moves in the order given.
 */
export function restoreMoves(
  order: readonly string[],
  restored: readonly string[],
  content: readonly string[]
): { id: string; afterId: string | null }[] {
  // Moves change positions, never which rows are there.
  const present = new Set(content)
  const back = new Set(restored.filter((id) => present.has(id)))
  const current = content.slice()
  const moves: { id: string; afterId: string | null }[] = []
  order.forEach((id, index) => {
    if (!back.has(id)) return
    let afterId: string | null = null
    for (let i = index - 1; i >= 0; i--) {
      if (present.has(order[i])) {
        afterId = order[i]
        break
      }
    }
    const at = current.indexOf(id)
    if (afterId === null ? at === 0 : at === current.indexOf(afterId) + 1) return
    current.splice(at, 1)
    current.splice(afterId === null ? 0 : current.indexOf(afterId) + 1, 0, id)
    moves.push({ id, afterId })
  })
  return moves
}

export function uniqueName(existing: string[], base: string): string {
  const taken = new Set(existing.map((n) => String(n).toLocaleLowerCase()))
  if (!taken.has(base.toLocaleLowerCase())) return base
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function firstPropertyOfType(schema: Schema, type: PropertyType): PropertySchema | undefined {
  return orderedProperties(schema).find((p) => p.type === type)
}

/** The property type a view groups by, if its layout needs one. */
export function groupTypeOf(type: ViewType): 'select' | 'date' | null {
  return type === 'board' ? 'select' : type === 'calendar' ? 'date' : null
}

/** The property a board / calendar view is laid out by, when it exists and has the right type. */
export function groupProperty(view: DatabaseView | undefined, schema: Schema): PropertySchema | undefined {
  if (!view) return undefined
  const prop = propOf(schema, view.groupBy)
  return prop && prop.type === groupTypeOf(view.type) ? prop : undefined
}

export function createDefaultView(type: ViewType, schema: Schema, id: string = makeId(), name?: string): DatabaseView {
  const props = orderedProperties(schema)
  const title = getTitleProperty(schema)
  const view: DatabaseView = {
    id,
    name: name ?? VIEW_LABELS[type] ?? 'View',
    type,
    visibleProperties: type === 'table' ? props.map((p) => p.id) : title ? [title.id] : [],
    filters: [],
    sorts: []
  }
  const groupType = groupTypeOf(type)
  const group = groupType ? firstPropertyOfType(schema, groupType) : undefined
  if (group) view.groupBy = group.id
  if (type === 'chart') view.chart = defaultChartConfig(schema)
  if (type === 'calc') view.calcs = defaultCalcs(schema)
  return view
}

export function updateView(views: DatabaseView[], viewId: string, patch: Partial<Omit<DatabaseView, 'id'>>): DatabaseView[] {
  return views.map((v) => (v.id === viewId ? { ...v, ...patch, id: v.id } : v))
}

export function renameView(views: DatabaseView[], viewId: string, name: string): DatabaseView[] {
  const cleaned = cleanName(name)
  const current = views.find((v) => v.id === viewId)
  if (!cleaned || !current || current.name === cleaned) return views
  return updateView(views, viewId, { name: cleaned })
}

export function duplicateView(views: DatabaseView[], viewId: string): { views: DatabaseView[]; view: DatabaseView | undefined } {
  const index = views.findIndex((v) => v.id === viewId)
  if (index < 0) return { views, view: undefined }
  const source = views[index]
  const view: DatabaseView = {
    ...(JSON.parse(JSON.stringify(source)) as DatabaseView),
    id: makeId(),
    name: uniqueName(
      views.map((v) => v.name),
      cleanName(`${source.name.slice(0, 90)} copy`)
    )
  }
  const next = views.slice()
  next.splice(index + 1, 0, view)
  return { views: next, view }
}

/** The last remaining view cannot be deleted. */
export function deleteView(views: DatabaseView[], viewId: string): DatabaseView[] {
  if (views.length <= 1 || !views.some((v) => v.id === viewId)) return views
  return views.filter((v) => v.id !== viewId)
}

export function visibleProps(view: DatabaseView | undefined, schema: Schema): PropertySchema[] {
  const out: PropertySchema[] = []
  const seen = new Set<string>()
  for (const id of Array.isArray(view?.visibleProperties) ? view.visibleProperties : []) {
    const prop = propOf(schema, id)
    if (prop && !seen.has(prop.id)) {
      seen.add(prop.id)
      out.push(prop)
    }
  }
  if (!out.length) {
    const title = getTitleProperty(schema)
    if (title) out.push(title)
  }
  return out
}

export function hiddenProps(view: DatabaseView | undefined, schema: Schema): PropertySchema[] {
  const visible = new Set(Array.isArray(view?.visibleProperties) ? view.visibleProperties : [])
  return orderedProperties(schema).filter((p) => !visible.has(p.id) && p.type !== 'title')
}

/** Shows/hides a property in a view. The title property cannot be hidden. */
export function setPropertyVisible(view: DatabaseView, schema: Schema, propertyId: string, visible: boolean): DatabaseView {
  const prop = propOf(schema, propertyId)
  if (!prop) return view
  const has = view.visibleProperties.includes(propertyId)
  if (visible === has) return view
  if (!visible && prop.type === 'title') return view
  return {
    ...view,
    visibleProperties: visible ? [...view.visibleProperties, propertyId] : view.visibleProperties.filter((id) => id !== propertyId)
  }
}

/** Shows every property of the schema (already visible ones keep their order). */
export function showAllProperties(view: DatabaseView, schema: Schema): DatabaseView {
  const hidden = hiddenProps(view, schema)
  if (!hidden.length) return view
  return { ...view, visibleProperties: [...view.visibleProperties, ...hidden.map((p) => p.id)] }
}

/** Reorders a visible property so it sits before `beforeId` (null = last). */
export function moveVisibleProperty(view: DatabaseView, propertyId: string, beforeId: string | null): DatabaseView {
  if (!view.visibleProperties.includes(propertyId) || propertyId === beforeId) return view
  const next = moveBefore(view.visibleProperties, propertyId, beforeId)
  return next.every((id, i) => id === view.visibleProperties[i]) ? view : { ...view, visibleProperties: next }
}

export const MIN_COLUMN_WIDTH = 60
export const MAX_COLUMN_WIDTH = 1200

const DEFAULT_COLUMN_WIDTHS: Partial<Record<PropertyType, number>> = { title: 280, checkbox: 100, number: 130 }
const DEFAULT_COLUMN_WIDTH = 180

export function defaultColumnWidth(prop: PropertySchema): number {
  return DEFAULT_COLUMN_WIDTHS[prop.type] ?? DEFAULT_COLUMN_WIDTH
}

export function clampWidth(w: number): number {
  return Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, w)))
}

export function columnWidth(view: DatabaseView | undefined, prop: PropertySchema): number {
  const widths = view?.propertyWidths
  const w = widths && Object.hasOwn(widths, prop.id) ? widths[prop.id] : undefined
  return typeof w === 'number' && isFinite(w) ? clampWidth(w) : defaultColumnWidth(prop)
}

export function setPropertyWidth(view: DatabaseView, propertyId: string, width: number): DatabaseView {
  if (!isSafeKey(propertyId) || !isFinite(width)) return view
  const next = clampWidth(width)
  if (view.propertyWidths?.[propertyId] === next) return view
  return { ...view, propertyWidths: { ...(view.propertyWidths ?? {}), [propertyId]: next } }
}

export function resetPropertyWidth(view: DatabaseView, propertyId: string): DatabaseView {
  if (!view.propertyWidths || !Object.hasOwn(view.propertyWidths, propertyId)) return view
  const next = { ...view.propertyWidths }
  delete next[propertyId]
  return { ...view, propertyWidths: next }
}

/** Sets (or replaces) the sort on a property as the primary sort. */
export function setSort(view: DatabaseView, propertyId: string, direction: ViewSort['direction']): DatabaseView {
  return {
    ...view,
    sorts: [{ propertyId, direction }, ...view.sorts.filter((s) => s.propertyId !== propertyId)]
  }
}

/** Range of rows to render for a fixed-row-height windowed list. */
export function windowRange(
  count: number,
  rowHeight: number,
  scrollOffset: number,
  viewportHeight: number,
  overscan = 10
): { start: number; end: number } {
  if (!(count > 0) || !(rowHeight > 0) || !isFinite(scrollOffset) || !isFinite(viewportHeight)) return { start: 0, end: 0 }
  const first = Math.floor(Math.max(0, scrollOffset) / rowHeight)
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1
  const start = Math.max(0, Math.min(count, first - overscan))
  const end = Math.max(start, Math.min(count, first + visible + overscan))
  return { start, end }
}
