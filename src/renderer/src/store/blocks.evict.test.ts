/**
 * Eviction from the block cache: what a sweep may drop and, above all, what it may not.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, BlockProps, BlockType, ChangeEvent } from '../../../shared/types'

type Store = typeof import('./blocks')

function block(id: string, type: BlockType, parentId: string | null, content: string[] = [], props: BlockProps = {}): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const api = {
  clientId: 'this-window',
  blocks: {
    getMany: vi.fn<(ids: string[]) => Promise<Block[]>>(),
    getTree: vi.fn<(id: string) => Promise<Block[]>>(),
    children: vi.fn<(id: string) => Promise<Block[]>>(),
    apply: vi.fn<(ops: unknown[]) => Promise<Block[]>>()
  },
  onChange: (_listener: (event: ChangeEvent) => void) => () => undefined
}

let store: Store

/*
 * root ─ p1 ─ a ─ a1        p2 ─ c        orphan
 *          ├─ b
 *          ├─ sub (page) ─ s1
 *          └─ db (database) ─ r1 (page) ─ r1a
 */
const fixture: Block[] = [
  block('root', 'page', null, ['p1']),
  block('p1', 'page', 'root', ['a', 'b', 'sub', 'db']),
  block('a', 'toggle', 'p1', ['a1']),
  block('a1', 'text', 'a'),
  block('b', 'text', 'p1'),
  block('sub', 'page', 'p1', ['s1']),
  block('s1', 'text', 'sub'),
  block('db', 'database', 'p1', ['r1']),
  block('r1', 'page', 'db', ['r1a']),
  block('r1a', 'text', 'r1'),
  block('p2', 'page', null, ['c']),
  block('c', 'text', 'p2'),
  block('orphan', 'text', null)
]

const cached = (): string[] => Object.keys(store.useBlockStore.getState().blocks).sort()
/** A moment at which nothing loaded "now" is still inside the grace period. */
const later = (): number => Date.now() + store.GRACE_MS + 1

beforeAll(async () => {
  vi.stubGlobal('window', { api })
  store = await import('./blocks')
})

beforeEach(() => {
  for (const mock of Object.values(api.blocks)) mock.mockReset()
  store.resetCacheTracking()
  store.useBlockStore.setState({ blocks: Object.fromEntries(fixture.map((b) => [b.id, b])), missing: {} })
})

describe('sweepCache', () => {
  it('drops everything nothing refers to', () => {
    expect(store.sweepCache(later())).toBe(fixture.length)
    expect(cached()).toEqual([])
  })

  it('keeps the whole tree of an open page, down to nested pages but not into them', () => {
    const unpin = store.pinTree('p1')
    store.sweepCache(later())
    // `sub`, `db` are part of the page (they are shown as links); their contents are not.
    expect(cached()).toEqual(['a', 'a1', 'b', 'db', 'p1', 'root', 'sub'])
    for (const id of ['p1', 'a', 'a1', 'b']) expect(store.getBlock(id)).toBeDefined()
    unpin()
  })

  it('keeps a whole tree even when part of it was already kept for another reason', () => {
    // `a` is kept first as the ancestor of a held block; the tree walk must still go through it.
    const release = store.retainBlocks(['a1'])
    const remove = store.addCacheRoots(() => ({ ids: ['a'] }))
    const unpin = store.pinTree('p1', false)
    store.sweepCache(later())
    expect(cached()).toEqual(['a', 'a1', 'b', 'db', 'p1', 'root', 'sub'])
    unpin()
    // Now only a root provider asks for the tree, after `a` was added as a plain id.
    const removeTree = store.addCacheRoots(() => ({ trees: ['p1'] }))
    release()
    store.sweepCache(later())
    expect(cached()).toEqual(['a', 'a1', 'b', 'db', 'p1', 'root', 'sub'])
    remove()
    removeTree()
  })

  it('keeps the ancestors of whatever it keeps', () => {
    const release = store.retainBlocks(['r1a'])
    store.sweepCache(later())
    expect(cached()).toEqual(['db', 'p1', 'r1', 'r1a', 'root'])
    release()
  })

  it('never drops a block a mounted reader holds, however many readers there are', () => {
    const first = store.retainBlocks(['c'])
    const second = store.retainBlocks(['c', 'orphan'])
    first()
    first() // releasing twice must not steal the other reader's hold
    store.sweepCache(later())
    expect(cached()).toEqual(['c', 'orphan', 'p2'])
    second()
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('keeps a tree for as long as any of its views is open', () => {
    const one = store.pinTree('p2', false)
    const two = store.pinTree('p2', false)
    one()
    store.sweepCache(later())
    expect(cached()).toEqual(['c', 'p2'])
    two()
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('keeps what other stores declare as roots', () => {
    const remove = store.addCacheRoots(() => ({ trees: ['p2'], ids: ['b'] }))
    store.sweepCache(later())
    expect(cached()).toEqual(['b', 'c', 'p1', 'p2', 'root'])
    remove()
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('keeps recently fetched blocks until the grace period is over', async () => {
    const fresh = block('fresh', 'text', null)
    await store.fetchBlocks(() => Promise.resolve([fresh]))
    store.sweepCache(Date.now())
    expect(cached()).toEqual(['fresh'])
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('never drops a block with a write in flight', async () => {
    const write = deferred<Block[]>()
    api.blocks.apply.mockReturnValueOnce(write.promise)
    const saving = store.applyOps([{ op: 'update', id: 'c', patch: { props: { color: 'red' } } }])
    store.sweepCache(later())
    expect(store.getBlock('c')?.props.color).toBe('red')
    expect(store.getBlock('p2')).toBeDefined()
    write.resolve([])
    await saving
  })

  it('keeps the trees of recently viewed pages, most recent first, up to the limit', () => {
    store.pinTree('p2')()
    store.pinTree('p1')()
    store.sweepCache(later())
    expect(cached()).toEqual(['a', 'a1', 'b', 'c', 'db', 'p1', 'p2', 'root', 'sub'])

    // Enough other pages push the oldest ones out.
    for (let i = 0; i < store.RECENT_TREES; i++) store.pinTree(`other-${i}`)()
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('does not remember trees pinned without `remember` (inline databases)', () => {
    store.pinTree('db', false)()
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('lets background and recent trees go once the cache is over its soft limit', () => {
    const many: Record<string, Block> = {}
    const ids: string[] = []
    for (let i = 0; i <= store.CACHE_SOFT_LIMIT; i++) {
      const id = `bulk-${i}`
      ids.push(id)
      many[id] = block(id, 'text', 'big')
    }
    many.big = block('big', 'page', null, ids)
    store.useBlockStore.setState((state) => ({ blocks: { ...state.blocks, ...many } }))
    store.pinTree('big')() // viewed, then closed: only "recent" now
    const unpin = store.pinTree('p2') // on screen
    const remove = store.addCacheRoots(() => ({ trees: ['p1'] })) // a background tab

    store.sweepCache(later())
    // What is on screen keeps its tree; the background tab keeps its page, not the tree.
    expect(cached()).toEqual(['c', 'p1', 'p2', 'root'])
    unpin()
    remove()
  })

  it('forgets "missing" ids nobody is looking at, and keeps the others', () => {
    store.useBlockStore.setState({ missing: { gone: true, watched: true } })
    const release = store.retainBlocks(['watched'])
    store.sweepCache(later())
    expect(store.useBlockStore.getState().missing).toEqual({ watched: true })
    release()
  })

  it('leaves the store object alone when there is nothing to drop', () => {
    const unpinA = store.pinTree('p1')
    const unpinB = store.pinTree('p2')
    const release = store.retainBlocks(['orphan', 's1', 'r1a'])
    const before = store.useBlockStore.getState()
    expect(store.sweepCache(later())).toBe(0)
    expect(store.useBlockStore.getState()).toBe(before)
    unpinA()
    unpinB()
    release()
  })

  it('an evicted block is fetched again by the next reader', async () => {
    store.sweepCache(later())
    expect(store.getBlock('c')).toBeUndefined()
    api.blocks.getMany.mockResolvedValueOnce([fixture.find((b) => b.id === 'c')!])
    await store.refreshBlocks(['c'])
    expect(store.getBlock('c')).toBeDefined()
  })
})

/*
 * Linked views. `lv` (in page p2) and `lv2` (in page p3) show the rows of `db`, which lives in p1:
 *
 *   p2 ─ c, lv ··> db ─ r1 ─ r1a          p3 ─ lv2 ··> db
 */
describe('sweepCache and linked views', () => {
  const linked = (id: string, parentId: string, sourceId: unknown = 'db'): Block =>
    block(id, 'database', parentId, [], { sourceId, views: [] } as BlockProps)

  beforeEach(() => {
    store.useBlockStore.setState((state) => ({
      blocks: {
        ...state.blocks,
        p2: block('p2', 'page', null, ['c', 'lv']),
        lv: linked('lv', 'p2'),
        p3: block('p3', 'page', null, ['lv2']),
        lv2: linked('lv2', 'p3')
      }
    }))
  })

  it('keeps the source and its rows while the page holding a linked view is open', () => {
    const unpin = store.pinTree('p2')
    store.sweepCache(later())
    // The source comes with its ancestors (it is read for its title, schema and trash state)
    // and its rows; what is inside a row page is not part of the database.
    expect(cached()).toEqual(['c', 'db', 'lv', 'p1', 'p2', 'r1', 'root'])
    unpin()
  })

  it('keeps them for a linked view a mounted component reads, without the rest of its page', () => {
    const release = store.retainBlocks(['lv'])
    store.sweepCache(later())
    expect(cached()).toEqual(['db', 'lv', 'p1', 'p2', 'r1', 'root'])
    release()
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('lets the source go with the last linked view that referred to it', () => {
    const one = store.pinTree('p2', false)
    const two = store.pinTree('p3', false)
    one()
    store.sweepCache(later())
    expect(cached()).toEqual(['db', 'lv2', 'p1', 'p3', 'r1', 'root'])
    two()
    store.sweepCache(later())
    expect(cached()).toEqual([])
  })

  it('keeps rows that are only reachable through the link, not through an open page', () => {
    // Nothing pins p1 or db: without the link, `db` and `r1` would be swept.
    const release = store.retainBlocks(['lv2'])
    expect(store.sweepCache(later())).toBeGreaterThan(0)
    for (const id of ['db', 'r1']) expect(store.getBlock(id)).toBeDefined()
    expect(store.getBlock('r1a')).toBeUndefined()
    release()
  })

  it('follows the link of a view kept as a root of another store (the sidebar tree)', () => {
    const remove = store.addCacheRoots(() => ({ ids: ['lv'] }))
    store.sweepCache(later())
    expect(cached()).toEqual(['db', 'lv', 'p1', 'p2', 'r1', 'root'])
    remove()
  })

  it('follows the link of a view in a recently viewed page', () => {
    store.pinTree('p3')() // viewed, then closed: among the recent trees
    store.sweepCache(later())
    expect(cached()).toEqual(['db', 'lv2', 'p1', 'p3', 'r1', 'root'])
  })

  it('does not follow malformed links, chains or a link to itself', () => {
    store.useBlockStore.setState((state) => ({
      blocks: {
        ...state.blocks,
        p3: block('p3', 'page', null, ['bad', 'self', 'chain', 'gone']),
        bad: linked('bad', 'p3', 7),
        self: linked('self', 'p3', 'self'),
        // A view of a view (corrupt data): the first hop is kept, the second is not followed.
        chain: linked('chain', 'p3', 'lv'),
        gone: linked('gone', 'p3', 'missing-source')
      }
    }))
    const unpin = store.pinTree('p3')
    expect(() => store.sweepCache(later())).not.toThrow()
    expect(cached()).toEqual(['bad', 'chain', 'gone', 'lv', 'p2', 'p3', 'self'])
    unpin()
  })

  it('over the soft limit, keeps the rows for views on screen and only the source for background ones', () => {
    const many: Record<string, Block> = {}
    const ids: string[] = []
    for (let i = 0; i <= store.CACHE_SOFT_LIMIT; i++) {
      const id = `bulk-${i}`
      ids.push(id)
      many[id] = block(id, 'text', 'big')
    }
    many.big = block('big', 'page', null, ids)
    store.useBlockStore.setState((state) => ({ blocks: { ...state.blocks, ...many } }))
    store.pinTree('big')() // recent only
    const remove = store.addCacheRoots(() => ({ trees: ['p3'] })) // a background tab holding lv2

    store.sweepCache(later())
    // Not on screen: the tab keeps its page; nothing reaches lv2, so nothing reaches the source.
    expect(cached()).toEqual(['p3'])

    store.useBlockStore.setState((state) => ({ blocks: { ...state.blocks, ...Object.fromEntries(fixture.map((b) => [b.id, b])), ...many } }))
    store.useBlockStore.setState((state) => ({
      blocks: { ...state.blocks, p2: block('p2', 'page', null, ['c', 'lv']), lv: linked('lv', 'p2'), lv2: linked('lv2', 'p3') }
    }))
    const background = store.addCacheRoots(() => ({ ids: ['lv2'] })) // listed in the sidebar, not shown
    store.sweepCache(later())
    // The source survives for the sidebar's linked view (title, icon); its rows do not.
    expect(cached()).toEqual(['db', 'lv2', 'p1', 'p3', 'root'])

    store.useBlockStore.setState((state) => ({ blocks: { ...state.blocks, ...Object.fromEntries(fixture.map((b) => [b.id, b])), ...many } }))
    store.useBlockStore.setState((state) => ({ blocks: { ...state.blocks, lv2: linked('lv2', 'p3'), p3: block('p3', 'page', null, ['lv2']) } }))
    const unpin = store.pinTree('p3') // now on screen
    store.sweepCache(later())
    expect(cached()).toEqual(['db', 'lv2', 'p1', 'p3', 'r1', 'root'])
    unpin()
    remove()
    background()
  })
})

describe('isTreeCached', () => {
  it('is true only when the page and everything under it are present', () => {
    expect(store.isTreeCached('p1')).toBe(true)
    expect(store.isTreeCached('nope')).toBe(false)
    store.useBlockStore.setState((state) => {
      const blocks = { ...state.blocks }
      delete blocks.a1
      return { blocks }
    })
    expect(store.isTreeCached('p1')).toBe(false)
  })

  it('does not require the contents of nested pages and databases', () => {
    store.useBlockStore.setState((state) => {
      const blocks = { ...state.blocks }
      delete blocks.s1
      delete blocks.r1
      return { blocks }
    })
    expect(store.isTreeCached('p1')).toBe(true)
  })

  it('survives a cycle in corrupt data', () => {
    store.useBlockStore.setState({
      blocks: { x: block('x', 'page', null, ['y']), y: block('y', 'toggle', 'x', ['y', 'x']) },
      missing: {}
    })
    expect(store.isTreeCached('x')).toBe(true)
  })
})

describe('scheduleSweep', () => {
  it('runs one sweep for a burst of triggers', () => {
    vi.useFakeTimers()
    try {
      store.scheduleSweep()
      store.scheduleSweep()
      store.pinTree('p1')() // unpinning schedules one as well
      expect(cached().length).toBe(fixture.length)
      vi.advanceTimersByTime(store.GRACE_MS + 60_000)
      // p1 is a recent tree; the rest was untouched and unreferenced.
      expect(cached()).toEqual(['a', 'a1', 'b', 'db', 'p1', 'root', 'sub'])
    } finally {
      vi.useRealTimers()
    }
  })
})
