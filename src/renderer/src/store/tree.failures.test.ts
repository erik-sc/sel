/**
 * The sidebar tree: what it lists, what it keeps when a read fails, and when it reloads.
 * `window.api` is replaced by a fake whose page lists the tests set.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, BlockProps, ChangeEvent } from '../../../shared/types'

type Tree = typeof import('./tree')
type Blocks = typeof import('./blocks')
type Toasts = typeof import('../ui/toast')

function page(id: string, parentId: string | null = null, props: BlockProps = {}): Block {
  return { id, type: 'page', parentId, content: [], props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

let onChange: (event: ChangeEvent) => void = () => undefined

const api = {
  clientId: 'this-window',
  pages: {
    listRoot: vi.fn<() => Promise<Block[]>>(),
    listChildren: vi.fn<(id: string) => Promise<Block[]>>(),
    listFavorites: vi.fn<() => Promise<Block[]>>()
  },
  blocks: {
    getMany: vi.fn<(ids: string[]) => Promise<Block[]>>(async () => [])
  },
  onChange: (listener: (event: ChangeEvent) => void) => {
    onChange = listener
    return () => undefined
  }
}

let tree: Tree
let blocks: Blocks
let toasts: Toasts

const projects = page('projects')
const notes = page('notes')
const tasks = { ...page('tasks-db', null, { system: 'tasks' }), type: 'database' as const }
const launch = page('launch', 'projects')
const ideas = page('ideas', 'projects')

beforeAll(async () => {
  vi.stubGlobal('window', { api })
  blocks = await import('./blocks')
  tree = await import('./tree')
  toasts = await import('../ui/toast')
})

beforeEach(() => {
  for (const mock of Object.values(api.pages)) mock.mockReset()
  api.pages.listRoot.mockResolvedValue([projects, notes, tasks])
  api.pages.listFavorites.mockResolvedValue([notes])
  api.pages.listChildren.mockImplementation(async (id) => (id === 'projects' ? [launch, ideas] : []))
  tree.useTree.setState({ children: {}, favorites: [], loaded: false })
  blocks.useBlockStore.setState({ blocks: {}, missing: {} })
  toasts.useToasts.setState({ toasts: [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the page tree', () => {
  it('lists the root without the built-in blocks, and the favourites, and caches what it read', async () => {
    await tree.initTree()
    const state = tree.useTree.getState()
    expect(state.loaded).toBe(true)
    expect(state.children[tree.ROOT]).toEqual(['projects', 'notes'])
    expect(state.favorites).toEqual(['notes'])
    expect(blocks.getBlock('projects')).toEqual(projects)
    expect(blocks.getBlock('tasks-db')).toEqual(tasks)
  })

  it('loads a page’s children on demand and reloads them with the root', async () => {
    await tree.refreshTree()
    await tree.loadTreeChildren('projects')
    expect(tree.useTree.getState().children['projects']).toEqual(['launch', 'ideas'])

    api.pages.listChildren.mockImplementation(async (id) => (id === 'projects' ? [ideas] : []))
    await tree.refreshTree()
    expect(api.pages.listChildren).toHaveBeenLastCalledWith('projects')
    expect(tree.useTree.getState().children['projects']).toEqual(['ideas'])
  })

  it('keeps what a list showed when reading it again fails, instead of showing it empty', async () => {
    await tree.refreshTree()
    await tree.loadTreeChildren('projects')
    api.pages.listChildren.mockRejectedValue(new Error('disk'))
    api.pages.listRoot.mockRejectedValue(new Error('disk'))
    await tree.refreshTree()
    expect(tree.useTree.getState().children[tree.ROOT]).toEqual(['projects', 'notes'])
    expect(tree.useTree.getState().children['projects']).toEqual(['launch', 'ideas'])
  })

  it('forgets the children of a page that was deleted for good', async () => {
    await tree.refreshTree()
    await tree.loadTreeChildren('projects')
    blocks.useBlockStore.setState({ blocks: {}, missing: {} })
    api.pages.listRoot.mockResolvedValue([notes])
    await tree.refreshTree()
    expect(tree.useTree.getState().children).toEqual({ [tree.ROOT]: ['notes'] })
  })

  it('says so when the favourites cannot be read, and leaves the tree as it was', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await tree.refreshTree()
    const before = tree.useTree.getState()
    api.pages.listFavorites.mockRejectedValue(new Error('disk'))
    await tree.refreshTree()
    expect(tree.useTree.getState()).toBe(before)
    expect(toasts.useToasts.getState().toasts).toEqual([
      expect.objectContaining({ kind: 'error', message: 'The page list could not be loaded.' })
    ])
  })

  it('runs one more refresh for any number of calls made while one is running', async () => {
    let release!: (blocks: Block[]) => void
    api.pages.listRoot.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    const first = tree.refreshTree()
    const second = tree.refreshTree()
    const third = tree.refreshTree()
    expect(second).toBe(first)
    expect(third).toBe(first)
    release([projects])
    await first
    expect(api.pages.listRoot).toHaveBeenCalledTimes(2)
    expect(tree.useTree.getState().children[tree.ROOT]).toEqual(['projects', 'notes'])
  })
})

describe('keeping the tree fresh', () => {
  it('reloads once per burst of changes, but not for this window’s own typing', async () => {
    await tree.initTree()
    // Nothing more to read when the tree is the same: the refresh only reads.
    blocks.useBlockStore.setState({ blocks: { ...blocks.useBlockStore.getState().blocks, t: { ...page('t', 'notes'), type: 'text' } } })
    api.pages.listRoot.mockClear()
    vi.useFakeTimers()

    onChange({ ids: ['t'], origin: api.clientId } as ChangeEvent)
    await vi.advanceTimersByTimeAsync(500)
    expect(api.pages.listRoot).not.toHaveBeenCalled()

    onChange({ ids: ['t'], origin: 'another-window' } as ChangeEvent)
    onChange({ ids: ['t'], origin: 'another-window' } as ChangeEvent)
    await vi.advanceTimersByTimeAsync(500)
    expect(api.pages.listRoot).toHaveBeenCalledTimes(1)

    // This window's own edit of a page (a rename, a move) can change the tree.
    onChange({ ids: ['projects'], origin: api.clientId } as ChangeEvent)
    await vi.advanceTimersByTimeAsync(500)
    expect(api.pages.listRoot).toHaveBeenCalledTimes(2)
  })
})
