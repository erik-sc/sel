/**
 * The sidebar's layout: the order of its items and which of them are hidden. It is the same on
 * every device: the `sidebar` setting syncs (settings/sidebar.json, see main/sync/format.ts).
 * Null is the default layout. What each item looks like and does is the renderer's
 * (renderer/src/shell/sidebarItems.tsx); this module only knows the ids.
 * Shared by the main process, which validates and syncs it, and the renderer. Pure.
 */

export const SIDEBAR_SETTING = 'sidebar'

/**
 * Every item, in its default order. An id never changes once released: it is what the stored
 * layout and other devices refer to. `favorites` and `pages` are the scrolling middle; the
 * items before them are the top of the sidebar, the items after them its footer.
 */
export const SIDEBAR_ITEMS = [
  'search',
  'home',
  'today',
  'calendar',
  'tasks',
  'meditations',
  'sky',
  'close-day',
  'new-page',
  'new-meeting',
  'favorites',
  'pages',
  'trash',
  'archive',
  'feedback',
  'settings',
  'sync'
] as const
export type SidebarItemId = (typeof SIDEBAR_ITEMS)[number]

/** The items of the scrolling middle. They move among themselves, never to the top or the footer. */
export const SIDEBAR_MIDDLE: readonly SidebarItemId[] = ['favorites', 'pages']

export type SidebarZone = 'top' | 'middle' | 'footer'

export interface SidebarLayout {
  /** Item ids from top to bottom. Ids this version does not know are kept for the versions that do. */
  order: string[]
  hidden: string[]
}

/** The shape of an item id. One this version does not know is kept: a newer device may have it. */
const ITEM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/
/** More than any sidebar will have; bounds what a damaged or hostile value can make us keep. */
const MAX_IDS = 100

export function isSidebarItem(id: unknown): id is SidebarItemId {
  return (SIDEBAR_ITEMS as readonly unknown[]).includes(id)
}

export function isMiddleItem(id: string): boolean {
  return (SIDEBAR_MIDDLE as readonly string[]).includes(id)
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function cleanIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_IDS) return undefined
  const out: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !ITEM_ID_RE.test(id)) return undefined
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * The layout a stored or received value describes, null for the default, or undefined when it
 * is not a layout at all. Ids of items this version does not have are kept (and ignored when
 * the sidebar is drawn); repeated ids count once.
 */
export function cleanSidebar(value: unknown): SidebarLayout | null | undefined {
  if (value === null || value === undefined) return null
  if (!isPlain(value)) return undefined
  const order = cleanIds(value['order'] ?? [])
  const hidden = cleanIds(value['hidden'] ?? [])
  if (!order || !hidden) return undefined
  return { order, hidden }
}

/**
 * `order` with every id of `reference` it lacks put back where `reference` had it: right after
 * the nearest id that comes before it in `reference` and is in the result, or first.
 * This is how an item added in a later version lands at its default place, and how an item the
 * settings list does not show keeps its neighbour when the others move.
 */
export function placeMissing(order: readonly string[], reference: readonly string[]): string[] {
  const out = [...order]
  reference.forEach((id, index) => {
    if (out.includes(id)) return
    let at = 0
    for (let back = index - 1; back >= 0; back--) {
      const found = out.indexOf(reference[back])
      if (found >= 0) {
        at = found + 1
        break
      }
    }
    out.splice(at, 0, id)
  })
  return out
}

/**
 * Every item this version knows, top to bottom, as the layout puts them: unknown ids dropped,
 * missing ones at their default place, and in canonical form (the top, then the middle, then
 * the footer). An item between the two middle items counts as part of the footer.
 */
export function sidebarOrder(layout: SidebarLayout | null): SidebarItemId[] {
  const known = (layout?.order ?? []).filter(isSidebarItem)
  const full = placeMissing(known, SIDEBAR_ITEMS) as SidebarItemId[]
  const first = full.findIndex(isMiddleItem)
  const top = full.slice(0, first).filter((id) => !isMiddleItem(id))
  const middle = full.filter(isMiddleItem)
  const footer = full.slice(first).filter((id) => !isMiddleItem(id))
  return [...top, ...middle, ...footer]
}

/** Which zone an item is in, in an order as `sidebarOrder` gives it. */
export function zoneOf(order: readonly string[], id: string): SidebarZone {
  if (isMiddleItem(id)) return 'middle'
  const first = order.findIndex(isMiddleItem)
  return first >= 0 && order.indexOf(id) > first ? 'footer' : 'top'
}

export interface ResolvedSidebar {
  top: SidebarItemId[]
  middle: SidebarItemId[]
  footer: SidebarItemId[]
}

/**
 * What the sidebar shows, zone by zone: the items in the layout's order, without the hidden
 * ones and without those `available` turns away (an item whose feature is off).
 */
export function resolveSidebar(layout: SidebarLayout | null, available: (id: SidebarItemId) => boolean = () => true): ResolvedSidebar {
  const order = sidebarOrder(layout)
  const hidden = new Set(layout?.hidden ?? [])
  const out: ResolvedSidebar = { top: [], middle: [], footer: [] }
  for (const id of order) if (!hidden.has(id) && available(id)) out[zoneOf(order, id)].push(id)
  return out
}

export function isHidden(layout: SidebarLayout | null, id: string): boolean {
  return !!layout?.hidden.includes(id)
}

/**
 * The layout to store after an edit: `order` (the known items, as the editor left them) and
 * `hidden`, carrying along what `previous` said about items this version does not know. Null
 * when the result is the default layout, which is stored as nothing.
 */
export function editedSidebar(previous: SidebarLayout | null, order: readonly string[], hidden: Iterable<string>): SidebarLayout | null {
  const known = sidebarOrder({ order: [...order], hidden: [] })
  const hiddenKnown = [...new Set(hidden)].filter(isSidebarItem)
  const unknownHidden = (previous?.hidden ?? []).filter((id) => !isSidebarItem(id))
  const next: SidebarLayout = {
    order: placeMissing(known, previous?.order ?? []),
    hidden: [...known.filter((id) => hiddenKnown.includes(id)), ...unknownHidden]
  }
  return isDefaultSidebar(next) ? null : next
}

/** Whether a layout draws the sidebar exactly as the default one does. */
export function isDefaultSidebar(layout: SidebarLayout | null): boolean {
  if (layout === null) return true
  if (layout.hidden.length) return false
  if (layout.order.some((id) => !isSidebarItem(id))) return false
  return sidebarOrder(layout).every((id, index) => id === SIDEBAR_ITEMS[index])
}

/**
 * The order after moving `id` one step up (-1) or down (+1), as Alt+↑/↓ does in the settings
 * list. `visible` are the items the list shows; the others keep their neighbours. A top item
 * stepping down past the last top item lands first in the footer, and back: the middle items
 * only change places with each other. Null when it cannot move that way.
 */
export function stepItem(order: readonly SidebarItemId[], visible: readonly SidebarItemId[], id: SidebarItemId, delta: -1 | 1): SidebarItemId[] | null {
  const shown = order.filter((other) => visible.includes(other))
  const at = shown.indexOf(id)
  const neighbour = shown[at + delta]
  if (at < 0 || neighbour === undefined) return null
  let next: SidebarItemId[]
  if (isMiddleItem(id) !== isMiddleItem(neighbour)) {
    if (isMiddleItem(id)) return null
    // Over the middle in one step: first in the footer, or last at the top.
    next = shown.filter((other) => other !== id)
    const middle = next.map((other, index) => (isMiddleItem(other) ? index : -1)).filter((index) => index >= 0)
    next.splice(delta > 0 ? middle[middle.length - 1] + 1 : middle[0], 0, id)
  } else {
    next = [...shown]
    next[at] = neighbour
    next[at + delta] = id
  }
  return placeMissing(next, order) as SidebarItemId[]
}

/**
 * The order after dropping `id` before `before` (or at the end of `zone` when `before` is
 * null). A middle item only lands in the middle and the others only outside it: null otherwise.
 */
export function dropItem(order: readonly SidebarItemId[], id: SidebarItemId, zone: SidebarZone, before: SidebarItemId | null): SidebarItemId[] | null {
  if (isMiddleItem(id) !== (zone === 'middle')) return null
  if (before === id) return [...order]
  if (before !== null && zoneOf(order, before) !== zone) return null
  const next = order.filter((other) => other !== id)
  let at: number
  if (before !== null) at = next.indexOf(before)
  else if (zone === 'top') at = next.findIndex(isMiddleItem)
  else if (zone === 'middle') at = next.length - [...next].reverse().findIndex(isMiddleItem)
  else at = next.length
  next.splice(at < 0 || at > next.length ? next.length : at, 0, id)
  return next
}
