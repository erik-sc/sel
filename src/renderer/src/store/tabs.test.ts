import { beforeEach, describe, expect, it } from 'vitest'
import { NOTEBOOK_ID } from '@shared/notebook'
import { SKY_ID } from '@shared/sky'
import {
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  goBack,
  goForward,
  isBlockId,
  mergeEarlyTabs,
  moveTab,
  newTab,
  NOTEBOOK_ROUTE,
  openPage,
  openScreen,
  reopenTab,
  sanitizeTabs,
  SKY_ROUTE,
  tabKey,
  tabPage,
  TODAY_ROUTE,
  useTabs
} from './tabs'

describe('sanitizeTabs', () => {
  it('rejects anything that is not a tab set', () => {
    for (const junk of [null, undefined, 'x', 42, [], {}, { tabs: 'x' }, { tabs: { length: 1 } }]) {
      expect(sanitizeTabs(junk)).toBeNull()
    }
  })

  it('keeps well-formed tabs', () => {
    const stored = {
      tabs: [
        { id: 't1', history: ['a', 'b'], index: 1 },
        { id: 't2', history: [], index: 0 }
      ],
      activeId: 't2'
    }
    expect(sanitizeTabs(stored)).toEqual(stored)
  })

  it('drops malformed tabs, duplicate ids and ids that are not ids', () => {
    const result = sanitizeTabs({
      tabs: [
        null,
        'x',
        { id: 7, history: [] },
        { id: 't1', history: 'a' },
        { id: '__proto__', history: ['a'] },
        { id: 'has space', history: ['a'] },
        { id: 'x'.repeat(65), history: ['a'] },
        { id: 't1', history: ['a'], index: 0 },
        { id: 't1', history: ['b'], index: 0 }
      ],
      activeId: 't1'
    })
    expect(result).toEqual({ tabs: [{ id: 't1', history: ['a'], index: 0 }], activeId: 't1' })
  })

  it('filters histories and keeps the position on the same page', () => {
    const result = sanitizeTabs({
      tabs: [
        { id: 'a', history: [1, 'p1', null, 'p2', '../x', 'p3'], index: 3 },
        { id: 'b', history: ['b1', 'b2'], index: 99 },
        { id: 'c', history: ['c1', 'c2'], index: -5 },
        { id: 'd', history: ['d1', 'd2'], index: 'x' },
        { id: 'e', history: ['e1', 'e2'], index: 0.9 },
        { id: 'f', history: ['constructor', '__proto__'], index: 1 }
      ],
      activeId: 'gone'
    })!
    expect(result.tabs.map((tab) => [tab.history, tab.index])).toEqual([
      [['p1', 'p2', 'p3'], 1],
      [['b1', 'b2'], 1],
      [['c1', 'c2'], 0],
      [['d1', 'd2'], 0],
      [['e1', 'e2'], 0],
      // Shaped like ids, so they stay; the block store resolves them to nothing.
      [['constructor'], 0]
    ])
    expect(result.activeId).toBeNull()
    for (const tab of result.tabs) expect(tabPage(tab)).toBe(tab.history[tab.index])
  })

  it('caps the history and the number of tabs', () => {
    const history = Array.from({ length: 500 }, (_, i) => `p${i}`)
    const result = sanitizeTabs({
      tabs: [
        { id: 'last', history, index: 499 },
        { id: 'early', history, index: 3 },
        ...Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, history: [`q${i}`], index: 0 }))
      ],
      activeId: 't400'
    })!
    expect(result.tabs).toHaveLength(100)
    expect(result.tabs[0].history).toHaveLength(50)
    expect(tabPage(result.tabs[0])).toBe('p499')
    expect(result.tabs[1].index).toBe(0)
    // The active tab was cut off with the rest.
    expect(result.activeId).toBeNull()
  })

  it('keeps one tab per page from a set saved with duplicates, the first, and moves the active tab onto it', () => {
    const result = sanitizeTabs({
      tabs: [
        { id: 't1', history: ['a'], index: 0 },
        { id: 't2', history: ['b'], index: 0 },
        { id: 't3', history: ['x', 'a'], index: 1 },
        { id: 't4', history: ['a', 'b'], index: 0 },
        // Not a duplicate: it shows c, whatever it showed before.
        { id: 't5', history: ['a', 'c'], index: 1 },
        { id: 't6', history: [], index: 0 },
        { id: 't7', history: [], index: 0 }
      ],
      activeId: 't3'
    })!
    expect(result.tabs.map((tab) => tab.id)).toEqual(['t1', 't2', 't5', 't6', 't7'])
    expect(result.activeId).toBe('t1')
  })

  it('reads the notebook and the Sky pages as their screens, so their two spellings are one tab', () => {
    const result = sanitizeTabs({
      tabs: [
        { id: 't1', history: [NOTEBOOK_ID], index: 0 },
        { id: 't2', history: ['p', NOTEBOOK_ROUTE], index: 1 },
        { id: 't3', history: [SKY_ROUTE], index: 0 },
        { id: 't4', history: [SKY_ID], index: 0 }
      ],
      activeId: 't4'
    })!
    expect(result.tabs).toEqual([
      { id: 't1', history: [NOTEBOOK_ROUTE], index: 0 },
      { id: 't3', history: [SKY_ROUTE], index: 0 }
    ])
    expect(result.activeId).toBe('t3')
  })
})

describe('tabKey', () => {
  it('spells each screen one way and leaves pages alone', () => {
    expect(tabKey(NOTEBOOK_ID)).toBe(NOTEBOOK_ROUTE)
    expect(tabKey(NOTEBOOK_ROUTE)).toBe(NOTEBOOK_ROUTE)
    expect(tabKey(SKY_ID)).toBe(SKY_ROUTE)
    expect(tabKey(SKY_ROUTE)).toBe(SKY_ROUTE)
    expect(tabKey(`${NOTEBOOK_ID}-2026-10-18`)).toBe(`${NOTEBOOK_ID}-2026-10-18`)
    expect(tabKey('page-1')).toBe('page-1')
  })
})

describe('mergeEarlyTabs', () => {
  it('adds the tabs opened while restoring after the restored ones, without a page twice', () => {
    const merged = mergeEarlyTabs(
      {
        tabs: [
          { id: 'r1', history: ['a'], index: 0 },
          { id: 'r2', history: ['b'], index: 0 }
        ],
        activeId: 'r1'
      },
      {
        tabs: [
          { id: 'e1', history: ['b'], index: 0 },
          { id: 'e2', history: ['c'], index: 0 },
          { id: 'e3', history: [], index: 0 }
        ],
        activeId: 'e1'
      }
    )
    expect(merged.tabs.map((tab) => tab.id)).toEqual(['r1', 'r2', 'e2', 'e3'])
    // The early tab was in front: the restored tab with its page is now.
    expect(merged.activeId).toBe('r2')
  })

  it('keeps the restored active tab when nothing was opened', () => {
    const restored = { tabs: [{ id: 'r1', history: ['a'], index: 0 }], activeId: 'r1' }
    expect(mergeEarlyTabs(restored, { tabs: [], activeId: null })).toEqual(restored)
  })
})

describe('isBlockId', () => {
  it('accepts ids and nothing else', () => {
    expect(isBlockId('0b9f6c1e-6f0e-4d0e-9d57-3c2f1f6a7b11')).toBe(true)
    for (const junk of ['', 'a b', '../a', 'a/b', '<a>', 'x'.repeat(65), null, undefined, 1, {}]) {
      expect(isBlockId(junk)).toBe(false)
    }
  })
})

describe('tab actions', () => {
  beforeEach(() => {
    useTabs.setState({
      tabs: [
        { id: 't1', history: ['a'], index: 0 },
        { id: 't2', history: ['b'], index: 0 },
        { id: 't3', history: ['c'], index: 0 }
      ],
      activeId: 't2',
      ready: true,
      ephemeral: true
    })
  })

  it('closing the active tab activates its neighbour, and reopening restores it in place', () => {
    closeTab()
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(['t1', 't3'])
    expect(useTabs.getState().activeId).toBe('t3')
    reopenTab()
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(['t1', 't2', 't3'])
    expect(useTabs.getState().activeId).toBe('t2')
  })

  it('closing the last tab leaves no active tab', () => {
    closeTab('t1')
    closeTab('t3')
    closeTab('t2')
    expect(useTabs.getState()).toMatchObject({ tabs: [], activeId: null })
  })

  it('closeOtherTabs ignores an unknown tab instead of closing everything', () => {
    const before = useTabs.getState()
    closeOtherTabs('nope')
    expect(useTabs.getState()).toBe(before)
    closeOtherTabs('t3')
    expect(useTabs.getState()).toMatchObject({ tabs: [{ id: 't3' }], activeId: 't3' })
  })

  it('opening a page drops the forward history and caps its length', () => {
    for (let i = 0; i < 80; i++) openPage(`p${i}`)
    const tab = useTabs.getState().tabs.find((entry) => entry.id === 't2')!
    expect(tab.history).toHaveLength(50)
    expect(tabPage(tab)).toBe('p79')
    openPage('p79')
    expect(useTabs.getState().tabs.find((entry) => entry.id === 't2')).toBe(tab)
  })

  const ids = (): string[] => useTabs.getState().tabs.map((tab) => tab.id)
  const pages = (): (string | null)[] => useTabs.getState().tabs.map(tabPage)
  const active = (): string | null => useTabs.getState().activeId

  it('opening a page that another tab shows goes to that tab and leaves this one as it was', () => {
    const before = useTabs.getState().tabs
    openPage('c')
    expect(active()).toBe('t3')
    expect(useTabs.getState().tabs).toBe(before)
    // Already in front: nothing moves.
    openPage('c')
    expect(active()).toBe('t3')
  })

  it('a Ctrl/middle click (newTab) on a page already open goes to its tab instead of a second one', () => {
    openPage('a', { newTab: true })
    expect(ids()).toEqual(['t1', 't2', 't3'])
    expect(active()).toBe('t1')
    newTab('c')
    expect(ids()).toEqual(['t1', 't2', 't3'])
    expect(active()).toBe('t3')
    // In the background: nothing at all.
    newTab('b', { background: true })
    expect(ids()).toEqual(['t1', 't2', 't3'])
    expect(active()).toBe('t3')
    // A page not open yet still gets its own tab, next to the active one.
    openPage('d', { newTab: true })
    expect(pages()).toEqual(['a', 'b', 'c', 'd'])
    expect(tabPage(useTabs.getState().tabs.find((tab) => tab.id === active()))).toBe('d')
  })

  it('the notebook and the Sky are one tab however they are reached', () => {
    openScreen(NOTEBOOK_ROUTE)
    const notebookTab = active()
    expect(pages()).toEqual(['a', 'b', NOTEBOOK_ROUTE, 'c'])
    openPage('a')
    openPage(NOTEBOOK_ID)
    expect(active()).toBe(notebookTab)
    openPage(NOTEBOOK_ID, { newTab: true })
    expect(pages()).toEqual(['a', 'b', NOTEBOOK_ROUTE, 'c'])
    // A link to the Sky's page, then its button: one tab.
    openPage(SKY_ID)
    expect(pages()).toEqual(['a', 'b', NOTEBOOK_ROUTE, 'c'].map((page) => (page === NOTEBOOK_ROUTE ? SKY_ROUTE : page)))
    const skyTab = active()
    openPage('b')
    openScreen(SKY_ROUTE)
    expect(active()).toBe(skyTab)
    expect(pages().filter((page) => page === SKY_ROUTE)).toHaveLength(1)
  })

  it('openScreen goes to the tab with the screen, else fills the blank tab in front, else opens one', () => {
    openScreen(TODAY_ROUTE)
    expect(pages()).toEqual(['a', 'b', TODAY_ROUTE, 'c'])
    openScreen(TODAY_ROUTE)
    expect(pages()).toEqual(['a', 'b', TODAY_ROUTE, 'c'])
    newTab()
    openScreen(SKY_ROUTE)
    expect(pages()).toEqual(['a', 'b', TODAY_ROUTE, SKY_ROUTE, 'c'])
  })

  it('back and forward onto a page that another tab shows keep it here and close the other tab', () => {
    useTabs.setState({
      tabs: [
        { id: 't1', history: ['a', 'b'], index: 1 },
        { id: 't2', history: ['a', 'c'], index: 1 },
        { id: 't3', history: ['d'], index: 0 }
      ],
      activeId: 't3'
    })
    // Back in t1: a is shown nowhere else, so nothing closes.
    useTabs.setState({ activeId: 't1' })
    goBack()
    expect(pages()).toEqual(['a', 'c', 'd'])
    useTabs.setState({ activeId: 't2' })
    goBack()
    expect(ids()).toEqual(['t2', 't3'])
    expect(pages()).toEqual(['a', 'd'])
    expect(active()).toBe('t2')
    // Forward onto a page that is open elsewhere, likewise.
    useTabs.setState({
      tabs: [
        { id: 't1', history: ['a', 'b'], index: 0 },
        { id: 't2', history: ['b'], index: 0 }
      ],
      activeId: 't1'
    })
    goForward()
    expect(useTabs.getState().tabs).toEqual([{ id: 't1', history: ['a', 'b'], index: 1 }])
    expect(active()).toBe('t1')
  })

  it('reopening a closed tab whose page is open by now goes to that tab', () => {
    closeTab('t1')
    openPage('a')
    expect(pages()).toEqual(['a', 'c'])
    reopenTab()
    expect(pages()).toEqual(['a', 'c'])
    expect(active()).toBe('t2')
  })

  it('closes the tabs to the right, and they reopen nearest first', () => {
    useTabs.setState({ activeId: 't3' })
    closeTabsToRight('t1')
    expect(ids()).toEqual(['t1'])
    expect(active()).toBe('t1')
    reopenTab()
    expect(ids()).toEqual(['t1', 't2'])
    reopenTab()
    expect(ids()).toEqual(['t1', 't2', 't3'])
    const before = useTabs.getState()
    closeTabsToRight('t3')
    closeTabsToRight('nope')
    expect(useTabs.getState()).toBe(before)
    useTabs.setState({ activeId: 't1' })
    closeTabsToRight('t2')
    expect(ids()).toEqual(['t1', 't2'])
    expect(active()).toBe('t1')
  })

  it('moveTab clamps the target and ignores unknown tabs', () => {
    moveTab('t1', 99)
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(['t2', 't3', 't1'])
    moveTab('t1', -4)
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(['t1', 't2', 't3'])
    const before = useTabs.getState()
    moveTab('nope', 0)
    expect(useTabs.getState()).toBe(before)
  })
})
