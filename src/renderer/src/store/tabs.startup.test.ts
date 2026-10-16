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
  blocks = new Map([page('p1'), page('p2'), page('home-page'), page('binned', true)].map((block) => [block.id, block]))
  vi.stubGlobal('window', {
    api: {
      clientId: 'this-window',
      onChange: () => () => {},
      app: {
        getSetting: async (key: string) => settings[key] ?? null,
        setSetting: async (key: string, value: unknown) => void (settings[key] = value)
      },
      blocks: { getMany: async (ids: string[]) => ids.flatMap((id) => (blocks.has(id) ? [blocks.get(id)!] : [])) }
    },
    addEventListener: () => {},
    location: { search: '' }
  })
  vi.resetModules()
})

afterEach(() => {
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

  it('an unknown start-up value restores the tabs', async () => {
    settings['home'] = { kind: 'page', id: 'home-page' }
    settings['shell.startup'] = 'sometimes'
    expect((await start()).tabs).toEqual(['p1', 'p2', '_today'])
  })
})
