/**
 * Races between optimistic writes, their reconciliation, reads and change events.
 * `window.api` is replaced by a fake whose replies the tests release in the order they choose.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, BlockProps, BlockType, ChangeEvent } from '../../../shared/types'

type Store = typeof import('./blocks')

function block(id: string, type: BlockType, parentId: string | null, content: string[] = [], props: BlockProps = {}): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets promise callbacks that are already due run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let onChange: (event: ChangeEvent) => void = () => undefined

const api = {
  clientId: 'this-window',
  blocks: {
    getMany: vi.fn<(ids: string[]) => Promise<Block[]>>(),
    getTree: vi.fn<(id: string) => Promise<Block[]>>(),
    children: vi.fn<(id: string) => Promise<Block[]>>(),
    apply: vi.fn<(ops: unknown[]) => Promise<Block[]>>()
  },
  onChange: (listener: (event: ChangeEvent) => void) => {
    onChange = listener
    return () => undefined
  }
}

let store: Store

const page = block('p', 'page', null, ['a'])
const text = block('a', 'text', 'p')
const red: Block = { ...text, props: { color: 'red' }, updatedAt: 2 }
const blue: Block = { ...text, props: { color: 'blue' }, updatedAt: 3 }

const color = (id: string): unknown => store.getBlock(id)?.props.color

beforeAll(async () => {
  vi.stubGlobal('window', { api })
  store = await import('./blocks')
})

beforeEach(() => {
  for (const mock of Object.values(api.blocks)) mock.mockReset()
  store.useBlockStore.setState({ blocks: { p: page, a: text }, missing: {} })
})

describe('reads against optimistic writes', () => {
  it('a read issued before a write cannot overwrite it, even after the write has settled', async () => {
    const tree = deferred<Block[]>()
    api.blocks.getTree.mockReturnValueOnce(tree.promise)
    const loading = store.loadTree('p')

    api.blocks.apply.mockResolvedValueOnce([red])
    await store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'red' } } }])
    expect(color('a')).toBe('red')

    // The tree was read before the write: its copy of `a` is stale, its copy of `p` is fine.
    const freshPage = { ...page, updatedAt: 9 }
    tree.resolve([freshPage, text])
    await loading
    expect(color('a')).toBe('red')
    expect(store.getBlock('p')).toBe(freshPage)

    // A read issued afterwards is the truth again.
    api.blocks.getMany.mockResolvedValueOnce([blue])
    await store.refreshBlocks(['a'])
    expect(color('a')).toBe('blue')
  })

  it('a read cannot resurrect a block deleted while it was in flight', async () => {
    const tree = deferred<Block[]>()
    api.blocks.getTree.mockReturnValueOnce(tree.promise)
    const loading = store.loadTree('p')

    api.blocks.apply.mockResolvedValueOnce([{ ...page, content: [] }])
    await store.applyOps([{ op: 'delete', id: 'a' }])
    tree.resolve([page, text])
    await loading
    expect(store.getBlock('a')).toBeUndefined()
    expect(store.getBlock('p')?.content).toEqual([])
  })

  it('a read that returns while the write is in flight leaves the optimistic version alone', async () => {
    const write = deferred<Block[]>()
    api.blocks.apply.mockReturnValueOnce(write.promise)
    const saving = store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'red' } } }])

    api.blocks.getMany.mockResolvedValueOnce([text])
    await store.refreshBlocks(['a'])
    expect(color('a')).toBe('red')

    // …and does not drop it either, when the backend does not know it yet.
    api.blocks.getMany.mockResolvedValueOnce([])
    await store.refreshBlocks(['a'])
    expect(color('a')).toBe('red')

    write.resolve([red])
    await saving
    expect(store.getBlock('a')).toBe(red)
  })

  it('fetchBlocks merges what it reads and hands it back', async () => {
    const extra = block('x', 'page', null)
    await expect(store.fetchBlocks(() => Promise.resolve([extra]))).resolves.toEqual([extra])
    expect(store.getBlock('x')).toBe(extra)
    await expect(store.fetchBlocks(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline')
  })
})

describe('reconciling writes', () => {
  it('keeps the newer write when two touch the same block', async () => {
    const first = deferred<Block[]>()
    const second = deferred<Block[]>()
    api.blocks.apply.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const savingFirst = store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'red' } } }])
    const savingSecond = store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'blue' } } }])
    expect(color('a')).toBe('blue')

    first.resolve([red])
    await savingFirst
    // The first reply describes a state the second write has already replaced locally.
    expect(color('a')).toBe('blue')

    second.resolve([blue])
    await savingSecond
    expect(store.getBlock('a')).toBe(blue)
  })

  it('does not let a late reply to an older write win over a newer one', async () => {
    const first = deferred<Block[]>()
    const second = deferred<Block[]>()
    api.blocks.apply.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const savingFirst = store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'red' } } }])
    const savingSecond = store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'blue' } } }])

    // Replies arrive out of order.
    second.resolve([blue])
    await savingSecond
    api.blocks.getMany.mockResolvedValueOnce([blue])
    first.resolve([red])
    await savingFirst
    await settle()

    expect(store.getBlock('a')).toBe(blue)
    // The stale reply was not applied; the block was refetched instead.
    expect(api.blocks.getMany).toHaveBeenCalledWith(['a'])
  })
})

describe('failed writes', () => {
  it('rolls back to what the backend has and drops blocks that were never created', async () => {
    const serverPage = { ...page, updatedAt: 7 }
    api.blocks.apply.mockRejectedValueOnce(new Error('disk full'))
    api.blocks.getMany.mockResolvedValueOnce([serverPage, text])

    const saving = store.applyOps([
      { op: 'create', input: { id: 'n', type: 'text', parentId: 'p' } },
      { op: 'update', id: 'a', patch: { props: { color: 'red' } } }
    ])
    expect(store.getBlock('p')?.content).toEqual(['a', 'n'])
    await expect(saving).rejects.toThrow('disk full')

    expect(store.getBlock('n')).toBeUndefined()
    expect(store.getBlock('p')).toBe(serverPage)
    expect(store.getBlock('a')).toBe(text)
    expect(api.blocks.getMany.mock.calls[0][0].sort()).toEqual(['a', 'n', 'p'])
  })

  it('puts the previous blocks back when the refetch fails too', async () => {
    api.blocks.apply.mockRejectedValueOnce(new Error('ipc closed'))
    api.blocks.getMany.mockRejectedValueOnce(new Error('ipc closed'))

    await expect(
      store.applyOps([
        { op: 'create', input: { id: 'n', type: 'text', parentId: 'p' } },
        { op: 'delete', id: 'a' }
      ])
    ).rejects.toThrow('ipc closed')

    expect(store.getBlock('n')).toBeUndefined()
    expect(store.getBlock('p')).toBe(page)
    expect(store.getBlock('a')).toBe(text)
  })

  it('does not roll back a newer write that is still in flight on the same block', async () => {
    const first = deferred<Block[]>()
    const second = deferred<Block[]>()
    api.blocks.apply.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const savingFirst = store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'red' } } }])
    const savingSecond = store.applyOps([{ op: 'update', id: 'a', patch: { props: { checked: true } } }])

    api.blocks.getMany.mockResolvedValueOnce([text])
    first.reject(new Error('rejected'))
    await expect(savingFirst).rejects.toThrow('rejected')
    // Still the optimistic state of the second write, not the refetched original.
    expect(store.getBlock('a')?.props).toEqual({ color: 'red', checked: true })

    const checked: Block = { ...text, props: { checked: true }, updatedAt: 4 }
    second.resolve([checked])
    await savingSecond
    expect(store.getBlock('a')).toBe(checked)
  })

  it('leaves the cache untouched when the ops themselves are invalid', async () => {
    const before = store.useBlockStore.getState()
    await expect(store.applyOps([{ op: 'move', id: 'p', parentId: 'p' }])).rejects.toThrow()
    expect(store.useBlockStore.getState()).toBe(before)
    expect(api.blocks.apply).not.toHaveBeenCalled()
  })
})

describe('change events', () => {
  it('ignores the echo of its own writes and refetches everything else', async () => {
    api.blocks.apply.mockResolvedValueOnce([red])
    await store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'red' } } }])

    onChange({ ids: ['a'], origin: 'this-window' })
    await settle()
    expect(api.blocks.getMany).not.toHaveBeenCalled()

    // Another window changed the same block.
    api.blocks.getMany.mockResolvedValueOnce([blue])
    onChange({ ids: ['a'], origin: 'another-window' })
    await settle()
    expect(store.getBlock('a')).toBe(blue)

    // This window changed a block without going through applyOps (restore, duplicate…).
    // (A block no earlier test wrote to: recent writes are remembered for two seconds.)
    store.putBlocks([block('restored', 'page', null)])
    api.blocks.getMany.mockResolvedValueOnce([])
    onChange({ ids: ['restored'], origin: 'this-window' })
    await settle()
    expect(api.blocks.getMany).toHaveBeenLastCalledWith(['restored'])
    expect(store.getBlock('restored')).toBeUndefined()
  })

  it('does not refetch a block with a write in flight, whoever changed it', async () => {
    const write = deferred<Block[]>()
    api.blocks.apply.mockReturnValueOnce(write.promise)
    const saving = store.applyOps([{ op: 'update', id: 'a', patch: { props: { color: 'red' } } }])

    onChange({ ids: ['a'], origin: 'another-window' })
    await settle()
    expect(api.blocks.getMany).not.toHaveBeenCalled()

    write.resolve([red])
    await saving
  })

  it('ignores malformed events', async () => {
    onChange(null as unknown as ChangeEvent)
    onChange({ ids: 'a', origin: 'x' } as unknown as ChangeEvent)
    onChange({ ids: [1, null, {}], origin: 'x' } as unknown as ChangeEvent)
    await settle()
    expect(api.blocks.getMany).not.toHaveBeenCalled()
  })
})

describe('lookups', () => {
  it('a block created optimistically is no longer "missing"', async () => {
    store.useBlockStore.setState({ missing: { n: true } })
    api.blocks.apply.mockResolvedValueOnce([])
    const saving = store.applyOps([{ op: 'create', input: { id: 'n', type: 'text', parentId: 'p' } }])
    expect(store.useBlockStore.getState().missing).toEqual({})
    await saving
  })

  it('never resolves an id to something inherited from Object.prototype', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(store.getBlock(id)).toBeUndefined()
    }
    expect(store.getBlock(null)).toBeUndefined()
    expect(store.getBlock('a')).toBe(text)
  })
})
