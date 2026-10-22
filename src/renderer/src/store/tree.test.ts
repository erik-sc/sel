/** When a change event reloads the sidebar tree. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, BlockType, ChangeEvent } from '../../../shared/types'

function block(id: string, type: BlockType, parentId: string | null, content: string[] = []): Block {
  return { id, type, parentId, content, props: {}, createdAt: 1, updatedAt: 1, trashedAt: null }
}

const listeners: ((event: ChangeEvent) => void)[] = []
const api = {
  clientId: 'this-window',
  blocks: { getMany: vi.fn(async () => []) },
  pages: {
    listRoot: vi.fn(async (): Promise<Block[]> => []),
    listChildren: vi.fn(async (): Promise<Block[]> => []),
    listFavorites: vi.fn(async (): Promise<Block[]> => [])
  },
  onChange: (listener: (event: ChangeEvent) => void) => {
    listeners.push(listener)
    return () => undefined
  }
}

let blocks: typeof import('./blocks')
let tree: typeof import('./tree')

const emit = (ids: string[], origin = 'this-window'): void => {
  for (const listener of listeners) listener({ ids, origin } as ChangeEvent)
}

beforeAll(async () => {
  vi.stubGlobal('window', { api })
  blocks = await import('./blocks')
  tree = await import('./tree')
  await tree.initTree()
})

beforeEach(() => {
  vi.useFakeTimers()
  api.pages.listRoot.mockClear()
  blocks.useBlockStore.setState({
    blocks: {
      page: block('page', 'page', null, ['text', 'db']),
      text: block('text', 'text', 'page'),
      db: block('db', 'database', 'page', ['row']),
      row: block('row', 'page', 'db')
    },
    missing: {}
  })
})

async function reloads(ids: string[], origin?: string): Promise<boolean> {
  emit(ids, origin)
  await vi.advanceTimersByTimeAsync(500)
  const called = api.pages.listRoot.mock.calls.length > 0
  api.pages.listRoot.mockClear()
  return called
}

describe('tree refresh on change events', () => {
  it('skips own edits to text blocks and to the rows of a database', async () => {
    expect(await reloads(['text'])).toBe(false)
    expect(await reloads(['row'])).toBe(false)
  })

  it('reloads for own changes to pages, databases and unknown blocks', async () => {
    expect(await reloads(['page'])).toBe(true)
    expect(await reloads(['db'])).toBe(true)
    expect(await reloads(['row', 'db'])).toBe(true)
    expect(await reloads(['gone'])).toBe(true)
  })

  it('reloads for a row whose database is not loaded, and for any change from another window', async () => {
    blocks.useBlockStore.setState({ blocks: { orphan: block('orphan', 'page', 'elsewhere') }, missing: {} })
    expect(await reloads(['orphan'])).toBe(true)
    blocks.useBlockStore.setState({ blocks: { row: block('row', 'page', 'db'), db: block('db', 'database', null) }, missing: {} })
    expect(await reloads(['row'], 'another-window')).toBe(true)
  })
})
