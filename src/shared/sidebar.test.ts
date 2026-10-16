import { describe, expect, it } from 'vitest'
import {
  cleanSidebar,
  dropItem,
  editedSidebar,
  isDefaultSidebar,
  placeMissing,
  resolveSidebar,
  SIDEBAR_ITEMS,
  sidebarOrder,
  stepItem,
  zoneOf,
  type SidebarItemId
} from './sidebar'

const DEFAULT_TOP = ['search', 'home', 'today', 'calendar', 'tasks', 'meditations', 'sky', 'close-day', 'new-page', 'new-meeting']
const DEFAULT_FOOTER = ['trash', 'archive', 'feedback', 'settings', 'sync']

describe('the sidebar layout', () => {
  it('is the default one without a layout', () => {
    expect(sidebarOrder(null)).toEqual(SIDEBAR_ITEMS)
    expect(resolveSidebar(null)).toEqual({ top: DEFAULT_TOP, middle: ['favorites', 'pages'], footer: DEFAULT_FOOTER })
    expect(isDefaultSidebar(null)).toBe(true)
    expect(isDefaultSidebar({ order: [...SIDEBAR_ITEMS], hidden: [] })).toBe(true)
  })

  it('has the Sky right after the Meditations', () => {
    expect(SIDEBAR_ITEMS.indexOf('sky')).toBe(SIDEBAR_ITEMS.indexOf('meditations') + 1)
  })

  it('ignores ids it does not know and puts new items at their default place', () => {
    // A layout written before `sky` and `archive` existed, with an id of some later version.
    const layout = { order: ['meditations', 'search', 'pages', 'favorites', 'garden-2', 'settings', 'trash', 'sync'], hidden: ['garden-2'] }
    const order = sidebarOrder(layout)
    expect(order).not.toContain('garden-2')
    expect(order.length).toBe(SIDEBAR_ITEMS.length)
    // The sky follows the meditations wherever they went; the archive follows the trash.
    expect(order.indexOf('sky')).toBe(order.indexOf('meditations') + 1)
    expect(order.indexOf('archive')).toBe(order.indexOf('trash') + 1)
    expect(order.slice(0, 7)).toEqual(['meditations', 'sky', 'close-day', 'new-page', 'new-meeting', 'search', 'home'])
    expect(resolveSidebar(layout).middle).toEqual(['pages', 'favorites'])
    expect(resolveSidebar(layout).footer).toEqual(['settings', 'trash', 'archive', 'feedback', 'sync'])
  })

  it('leaves out hidden items and those whose feature is off', () => {
    const resolved = resolveSidebar({ order: [], hidden: ['search', 'settings', 'pages', 'nonsense'] }, (id) => id !== 'sky')
    expect(resolved.top).toEqual(DEFAULT_TOP.filter((id) => id !== 'search' && id !== 'sky'))
    expect(resolved.middle).toEqual(['favorites'])
    expect(resolved.footer).toEqual(['trash', 'archive', 'feedback', 'sync'])
  })

  it('can hide every item', () => {
    const resolved = resolveSidebar({ order: [], hidden: [...SIDEBAR_ITEMS] })
    expect([...resolved.top, ...resolved.middle, ...resolved.footer]).toEqual([])
  })

  it('splits the zones around the middle, keeping it together', () => {
    // Settings before the middle is at the top; an item between the two middle items is in the footer.
    const order = sidebarOrder({ order: ['settings', 'favorites', 'search', 'pages', 'trash'], hidden: [] })
    expect(zoneOf(order, 'settings')).toBe('top')
    expect(zoneOf(order, 'search')).toBe('footer')
    expect(zoneOf(order, 'pages')).toBe('middle')
    expect(order.indexOf('pages')).toBe(order.indexOf('favorites') + 1)
  })

  it('reads a stored or received value carefully', () => {
    expect(cleanSidebar(null)).toBeNull()
    expect(cleanSidebar({ order: ['a', 'a', 'b'] })).toEqual({ order: ['a', 'b'], hidden: [] })
    for (const bad of [[], 'x', { order: [3] }, { hidden: 'x' }, { order: ['UPPER'] }]) expect(cleanSidebar(bad)).toBeUndefined()
  })

  it('puts back what an order lacks next to where it was', () => {
    expect(placeMissing(['b', 'd'], ['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(placeMissing(['d', 'b'], ['a', 'b', 'c', 'd'])).toEqual(['a', 'd', 'b', 'c'])
  })

  it('stores an edit with what other versions said, and the default as nothing', () => {
    const previous = { order: ['garden-2', 'search', 'home'], hidden: ['garden-2'] }
    const order: string[] = sidebarOrder(previous).filter((id) => id !== 'search')
    order.push('search')
    const next = editedSidebar(previous, order, ['trash'])!
    expect(next.order[0]).toBe('garden-2')
    expect(next.order[next.order.length - 1]).toBe('search')
    expect(next.hidden).toEqual(['trash', 'garden-2'])
    expect(editedSidebar(null, [...SIDEBAR_ITEMS], [])).toBeNull()
  })

  it('moves an item a step with the keyboard, over the middle between top and footer', () => {
    const order = sidebarOrder(null)
    const all = [...SIDEBAR_ITEMS] as SidebarItemId[]
    expect(stepItem(order, all, 'home', -1)!.slice(0, 2)).toEqual(['home', 'search'])
    expect(stepItem(order, all, 'search', -1)).toBeNull()
    expect(stepItem(order, all, 'sync', 1)).toBeNull()
    // The last top item steps down to the first place in the footer, and back.
    const down = stepItem(order, all, 'new-meeting', 1)!
    expect(zoneOf(down, 'new-meeting')).toBe('footer')
    expect(down.indexOf('new-meeting')).toBe(down.indexOf('pages') + 1)
    expect(stepItem(down, all, 'new-meeting', -1)).toEqual(order)
    // The middle items only change places with each other.
    expect(stepItem(order, all, 'favorites', 1)!.slice(10, 12)).toEqual(['pages', 'favorites'])
    expect(stepItem(order, all, 'favorites', -1)).toBeNull()
    // An item the list does not show keeps its neighbour.
    const shown = all.filter((id) => id !== 'sky')
    const moved = stepItem(order, shown, 'meditations', -1)!
    expect(moved.indexOf('sky')).toBe(moved.indexOf('meditations') + 1)
    expect(moved.indexOf('meditations')).toBe(order.indexOf('tasks'))
  })

  it('drops an item into a zone, never a middle item outside the middle', () => {
    const order = sidebarOrder(null)
    const toFooter = dropItem(order, 'search', 'footer', null)!
    expect(toFooter[toFooter.length - 1]).toBe('search')
    const beforeTrash = dropItem(order, 'today', 'footer', 'trash')!
    expect(beforeTrash.indexOf('today')).toBe(beforeTrash.indexOf('trash') - 1)
    expect(zoneOf(beforeTrash, 'today')).toBe('footer')
    const toTop = dropItem(order, 'settings', 'top', null)!
    expect(toTop.indexOf('settings')).toBe(toTop.indexOf('favorites') - 1)
    expect(dropItem(order, 'pages', 'middle', 'favorites')!.slice(10, 12)).toEqual(['pages', 'favorites'])
    expect(dropItem(order, 'favorites', 'middle', null)!.slice(10, 12)).toEqual(['pages', 'favorites'])
    expect(dropItem(order, 'pages', 'top', null)).toBeNull()
    expect(dropItem(order, 'search', 'middle', null)).toBeNull()
    expect(dropItem(order, 'search', 'footer', 'home')).toBeNull()
  })
})
