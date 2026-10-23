// "Private from AI" in the window: a private page is never pinned as context (and the menu says
// why), the marks are written on the blocks, and a project of Tasks is marked on its database.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, BlockProps, BlockType, Op } from '@shared/types'
import { TASKS_DATABASE_ID } from '@shared/tasks'

const store = vi.hoisted(() => ({
  blocks: {} as Record<string, unknown>,
  loaded: {} as Record<string, unknown>,
  batches: [] as unknown[][]
}))

vi.mock('@/store/blocks', async () => {
  const { applyOpsToMap } = await import('../store/ops')
  type Map = Parameters<typeof applyOpsToMap>[0]
  return {
    getBlock: (id: string | null | undefined) => (id && Object.hasOwn(store.blocks, id) ? (store.blocks[id] as Block) : undefined),
    // The pages above come from main: here, from `loaded`, which the window does not have yet.
    fetchBlocks: async (read: () => Promise<Block[]>) => {
      const list = await read()
      for (const block of list) store.blocks[block.id] = block
      return list
    },
    applyOps: (ops: Op[]) => {
      store.batches.push(ops)
      store.blocks = applyOpsToMap(store.blocks as Map, ops, 2_000).map
      return Promise.resolve([])
    },
    useBlockStore: () => undefined,
    watchSelector: () => () => undefined
  }
})

const settings = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
vi.stubGlobal('window', {
  api: {
    app: {
      setSetting: (key: string, value: unknown) => {
        settings.values[key] = value
        return Promise.resolve()
      }
    },
    pages: {
      ancestors: (id: string) => {
        const out: Block[] = []
        let parent = (store.loaded[id] as Block | undefined)?.parentId
        while (parent) {
          const block = store.loaded[parent] as Block
          out.unshift(block)
          parent = block.parentId
        }
        return Promise.resolve(out)
      }
    }
  }
})

import { toggleContextPage, useAiGate } from './gate'
import { aiPrivacyNow, toggleAiPrivate, toggleProjectPrivate } from './privacy'

function block(id: string, type: BlockType, parentId: string | null, props: BlockProps = {}): Block {
  return { id, type, parentId, content: [], props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

beforeEach(() => {
  store.batches = []
  settings.values = {}
  const all = [
    block('vault', 'page', null, { title: [['Vault']], aiPrivate: true }),
    block('inner', 'page', 'vault', { title: [['Inner']] }),
    block('open', 'page', null, { title: [['Open']] }),
    block(TASKS_DATABASE_ID, 'database', null, { title: [['Tasks']] })
  ]
  store.loaded = Object.fromEntries(all.map((b) => [b.id, b]))
  // The window has the page open but not the page above it.
  store.blocks = Object.fromEntries(all.filter((b) => b.id !== 'vault').map((b) => [b.id, b]))
  useAiGate.setState({ contextPages: [] })
})

describe('pinning a page as context', () => {
  it('refuses a page inside a private one, after reading the pages above it', async () => {
    expect(aiPrivacyNow('inner')).toBeNull()
    expect(await toggleContextPage('inner')).toBe('private')
    expect(useAiGate.getState().contextPages).toEqual([])
    expect(settings.values).toEqual({})
  })

  it('pins an open page, and unpins it', async () => {
    expect(await toggleContextPage('open')).toBe('pinned')
    expect(useAiGate.getState().contextPages).toEqual(['open'])
    expect(await toggleContextPage('open')).toBe('unpinned')
    expect(useAiGate.getState().contextPages).toEqual([])
  })

  it('refuses a page just marked private', async () => {
    expect(await toggleAiPrivate('open')).toBe(true)
    expect(store.batches.at(-1)).toEqual([{ op: 'update', id: 'open', patch: { props: { aiPrivate: true } } }])
    expect(await toggleContextPage('open')).toBe('private')
    expect(await toggleAiPrivate('open')).toBe(false)
    expect(await toggleContextPage('open')).toBe('pinned')
  })
})

describe('a project of Tasks', () => {
  it('is marked on the Tasks database, and unmarked', async () => {
    expect(await toggleProjectPrivate('p-health')).toBe(true)
    expect((store.blocks[TASKS_DATABASE_ID] as Block).props.aiPrivateProjects).toEqual(['p-health'])
    expect(await toggleProjectPrivate('p-health')).toBe(false)
    expect((store.blocks[TASKS_DATABASE_ID] as Block).props.aiPrivateProjects).toBeUndefined()
  })
})
