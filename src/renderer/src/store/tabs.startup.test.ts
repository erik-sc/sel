/**
 * Start-up: the tabs restored, the home opened instead, or both (`shell.startup`), against a
 * fake `window.api`. Each test loads the tabs module afresh: it restores once per window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '@shared/types'

type TabsModule = typeof import('./tabs')

function page(id: string, trashed = false): Block {
  return { id, type: 'page', parentId: null, content: [], props: {}, createdAt: 1, updatedAt: 1, trashedAt: trashed ? 2 : null } as unknown as Block
}

let settings: Record<string, unknown>
let blocks: Map<string, Block>
let search: string
let writes: string[]

beforeEach(() => {
  settings = {
    'shell.tabs': {
      tabs: [
        { id: 't1', history: ['p1'], index: 0 },
        { id: 't2', history: ['p2'], index: 0 },
        { id: 't3', history: ['_today'], index: 0 }
      ],
      activeId: 't2'
    }
  }
  blocks = new Map(
    [page('p1'), page('p2'), page('p3'), page('home-page'), page('binned', true), page('sel-notebook')].map((block) => [block.id, block])
  )
  search = ''
  writes = []
  vi.stubGlobal('window', {
    api: {
      clientId: 'this-window',
      onChange: () => () => {},
      app: {
        getSetting: async (key: string) => settings[key] ?? null,
        setSetting: async (key: string, value: unknown) => {
          writes.push(key)
          settings[key] = value
        }
      },
      blocks: { getMany: async (ids: string[]) => ids.flatMap((id) => (blocks.has(id) ? [blocks.get(id)!] : [])) }
    },
    addEventListener: () => {},
    get location() {
      return { search }
    }
  })
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function start(initialPageId: string | null = null): Promise<{ tabs: string[]; active: string | null; module: TabsModule }> {
  const module = await import('./tabs')
  await module.initTabs(initialPageId)
  const state = module.useTabs.getState()
  return { tabs: state.tabs.map((tab) => module.tabPage(tab) ?? ''), active: module.tabPage(module.activeTab(state)), module }
}

describe('start-up', () => {
  it('restores the tabs by default, whatever the home', async () => {
    settings['home'] = { kind: 'page', id: 'home-page' }
    const { tabs, active } = await start()
    expect(tabs).toEqual(['p1', 'p2', '_today'])
    expect(active).toBe('p2')
  })

  it('restores the tabs when asked to', async () => {
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'tabs'
    expect((await start()).tabs).toEqual(['p1', 'p2', '_today'])
  })

  it('opens only the home when asked to', async () => {
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'home'
    const { tabs, active } = await start()
    expect(tabs).toEqual(['home-page'])
    expect(active).toBe('home-page')
  })

  it('opens a screen as the home', async () => {
    settings['home'] = { kind: 'screen', route: '_calendar' }
    settings['shell.startup'] = 'home'
    expect((await start()).tabs).toEqual(['_calendar'])
  })

  it('does both with the home first and in front', async () => {
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'both'
    const { tabs, active } = await start()
    expect(tabs).toEqual(['home-page', 'p1', 'p2', '_today'])
    expect(active).toBe('home-page')
  })

  it('moves a restored tab that already shows the home to the front instead of opening it twice', async () => {
    settings['home'] = { kind: 'screen', route: '_today' }
    settings['shell.startup'] = 'both'
    const { tabs, active, module } = await start()
    expect(tabs).toEqual(['_today', 'p1', 'p2'])
    expect(active).toBe('_today')
    expect(module.useTabs.getState().tabs[0].id).toBe('t3')
  })

  it('falls back to the tabs when the home is in the Trash, not on this device, or not chosen', async () => {
    for (const home of [{ kind: 'page', id: 'binned' }, { kind: 'page', id: 'not-here-yet' }, null, { kind: 'screen', route: '_nowhere' }]) {
      for (const mode of ['home', 'both']) {
        settings['home'] = home
        settings['shell.startup'] = mode
        vi.resetModules()
        const { tabs, active } = await start()
        expect(tabs, `${JSON.stringify(home)} ${mode}`).toEqual(['p1', 'p2', '_today'])
        expect(active).toBe('p2')
      }
    }
  })

  it('opens the home on a device with no tabs to restore', async () => {
    delete settings['shell.tabs']
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'both'
    expect((await start()).tabs).toEqual(['home-page'])
  })

  it('a window opened for one page (?page=) shows that page, not the home', async () => {
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'both'
    const { tabs, module } = await start('p2')
    expect(tabs).toEqual(['p2'])
    expect(module.useTabs.getState().ephemeral).toBe(true)
  })

  it('a set saved with a page twice comes back with one tab per page, and is saved that way', async () => {
    vi.useFakeTimers()
    settings['shell.tabs'] = {
      tabs: [
        { id: 't1', history: ['p1'], index: 0 },
        { id: 't2', history: ['p2'], index: 0 },
        { id: 't3', history: ['p2', 'p1'], index: 1 },
        { id: 't4', history: ['sel-notebook'], index: 0 },
        { id: 't5', history: ['_notebook'], index: 0 },
        { id: 't6', history: ['p2'], index: 0 }
      ],
      activeId: 't6'
    }
    const { tabs, active, module } = await start()
    expect(tabs).toEqual(['p1', 'p2', '_notebook'])
    // The active tab was a duplicate: the tab it duplicated is in front.
    expect(active).toBe('p2')
    expect(module.useTabs.getState().activeId).toBe('t2')
    await vi.advanceTimersByTimeAsync(1000)
    expect(settings['shell.tabs']).toEqual({
      tabs: [
        { id: 't1', history: ['p1'], index: 0 },
        { id: 't2', history: ['p2'], index: 0 },
        { id: 't4', history: ['_notebook'], index: 0 }
      ],
      activeId: 't2'
    })
  })

  it('a clean set is not written back just for starting', async () => {
    vi.useFakeTimers()
    await start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(writes).toEqual([])
  })

  it('tabs opened while restoring follow the same rule: a page already restored is not opened twice', async () => {
    const module = await import('./tabs')
    const done = module.initTabs(null)
    module.openPage('p2')
    module.openPage('p3', { newTab: true })
    module.openPage('p3', { newTab: true })
    await done
    const state = module.useTabs.getState()
    expect(state.tabs.map((tab) => module.tabPage(tab))).toEqual(['p1', 'p2', '_today', 'p3'])
    expect(module.tabPage(module.activeTab(state))).toBe('p3')
  })

  it('a page opened while restoring that a restored tab shows brings that tab to the front', async () => {
    const module = await import('./tabs')
    const done = module.initTabs(null)
    module.openPage('p1')
    await done
    const state = module.useTabs.getState()
    expect(state.tabs.map((tab) => module.tabPage(tab))).toEqual(['p1', 'p2', '_today'])
    expect(state.activeId).toBe('t1')
  })

  it('a window opened beside the main one (?extra) has one blank tab and never saves its tabs', async () => {
    vi.useFakeTimers()
    search = '?extra=1'
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'both'
    const { tabs, module } = await start()
    expect(tabs).toEqual([''])
    expect(module.useTabs.getState()).toMatchObject({ ephemeral: true, ready: true })
    module.openPage('p1')
    module.openPage('p2', { newTab: true })
    module.closeTab()
    await vi.advanceTimersByTimeAsync(1000)
    expect(writes).toEqual([])
    expect(settings['shell.tabs']).toMatchObject({ activeId: 't2' })
    // Dedupe holds in it too.
    module.openPage('p1', { newTab: true })
    expect(module.useTabs.getState().tabs).toHaveLength(1)
  })

  it('a window opened for one page never saves its tabs either', async () => {
    vi.useFakeTimers()
    search = '?page=p2'
    const { tabs, module } = await start((await import('./tabs')).initialPageId())
    expect(tabs).toEqual(['p2'])
    module.openPage('p1', { newTab: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(writes).toEqual([])
  })

  it('an unknown start-up value restores the tabs', async () => {
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'sometimes'
    expect((await start()).tabs).toEqual(['p1', 'p2', '_today'])
  })
})
