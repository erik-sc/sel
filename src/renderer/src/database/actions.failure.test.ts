/**
 * A database write the main process refuses: the cell goes back to what is stored, and the user
 * is told once, not once per keystroke. Runs against the real block store, with `window.api`
 * replaced by a fake whose `apply` rejects.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, DatabaseView } from '../../../shared/types'

const errors = vi.hoisted(() => [] as string[])
vi.mock('../ui/toast', () => ({
  toast: () => 'toast',
  notifyError: (message: string) => {
    errors.push(message)
  }
}))

const stored = new Map<string, Block>()
const api = {
  clientId: 'this-window',
  blocks: {
    apply: vi.fn<(ops: unknown[]) => Promise<Block[]>>(),
    getMany: vi.fn(async (ids: string[]) => ids.flatMap((id) => (stored.has(id) ? [stored.get(id)!] : []))),
    getTree: vi.fn(async () => [] as Block[]),
    children: vi.fn(async () => [] as Block[])
  },
  onChange: () => () => undefined
}

type Store = typeof import('../store/blocks')
type Actions = typeof import('./actions')
let store: Store
let actions: Actions

const view: DatabaseView = { id: 'v1', name: 'Table', type: 'table', visibleProperties: ['t', 'n'], filters: [], sorts: [] }
const db: Block = {
  id: 'db',
  type: 'database',
  parentId: null,
  content: ['r1'],
  props: {
    title: [['Things']],
    schema: { t: { id: 't', name: 'Name', type: 'title' }, n: { id: 'n', name: 'Price', type: 'number' } },
    views: [view]
  },
  createdAt: 1,
  updatedAt: 1,
  trashedAt: null
}
const row: Block = {
  id: 'r1',
  type: 'page',
  parentId: 'db',
  content: [],
  props: { title: [['One']], values: { n: 1 } },
  createdAt: 1,
  updatedAt: 1,
  trashedAt: null
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const price = (): unknown => store.getBlock('r1')?.props.values?.n

beforeAll(async () => {
  vi.stubGlobal('window', { api })
  store = await import('../store/blocks')
  actions = await import('./actions')
  ;(await import('../failures/notify')).followLocale(() => 'en')
})

// The notice is limited in time: each test starts well after the last one shown.
let clock = Date.now()

beforeEach(() => {
  clock += 60_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  errors.length = 0
  stored.clear()
  stored.set('db', db)
  stored.set('r1', row)
  store.useBlockStore.setState({ blocks: { db, r1: row }, missing: {} })
  api.blocks.apply.mockReset()
})

describe('a refused database write', () => {
  it('shows the notice and puts the stored value back', async () => {
    api.blocks.apply.mockRejectedValue(new Error('SQLITE_FULL'))
    const prop = actions.snapshot('db').schema.n
    actions.setCell('r1', prop, 2)
    // Optimistic first: the cell shows what was typed.
    expect(price()).toEqual(2)
    await settle()
    await settle()
    expect(price()).toEqual(1)
    expect(errors).toEqual(["Couldn't save that change. It was undone."])
  })

  it('a burst of refused writes is one notice', async () => {
    api.blocks.apply.mockRejectedValue(new Error('SQLITE_FULL'))
    const prop = actions.snapshot('db').schema.n
    for (const price of [2, 3, 4]) actions.setCell('r1', prop, price)
    await settle()
    await settle()
    expect(price()).toEqual(1)
    expect(errors).toHaveLength(1)
  })
})
