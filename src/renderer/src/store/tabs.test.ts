import { beforeEach, describe, expect, it } from 'vitest'
import { closeOtherTabs, closeTab, isBlockId, moveTab, openPage, reopenTab, sanitizeTabs, tabPage, useTabs } from './tabs'

describe('sanitizeTabs', () => {
  it('rejects anything that is not a tab set', () => {
    for (const junk of [null, undefined, 'x', 42, [], {}, { tabs: 'x' }, { tabs: { length: 1 } }]) {
      expect(sanitizeTabs(junk)).toBeNull()
    }
  })

  it('keeps well-formed tabs', () => {
    const stored = { tabs: [{ id: 't1', history: ['a', 'b'], index: 1 }, { id: 't2', history: [], index: 0 }], activeId: 't2' }
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
        { id: 'b', history: ['p1', 'p2'], index: 99 },
        { id: 'c', history: ['p1', 'p2'], index: -5 },
        { id: 'd', history: ['p1', 'p2'], index: 'x' },
        { id: 'e', history: ['p1', 'p2'], index: 0.9 },
        { id: 'f', history: ['constructor', '__proto__'], index: 1 }
      ],
      activeId: 'gone'
    })!
    expect(result.tabs.map((tab) => [tab.history, tab.index])).toEqual([
      [['p1', 'p2', 'p3'], 1],
      [['p1', 'p2'], 1],
      [['p1', 'p2'], 0],
      [['p1', 'p2'], 0],
      [['p1', 'p2'], 0],
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
        ...Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, history: ['p'], index: 0 }))
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
