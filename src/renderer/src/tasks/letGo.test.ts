// Letting go of several tasks: one batch to the trash, one Undo that brings back exactly those
// (never a task that was already in the trash), and nothing at all for tasks that are gone.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASKS_DATABASE_ID, tasksDatabaseProps } from '../../../shared/tasks'
import type { Block, Op } from '../../../shared/types'

const store = vi.hoisted(() => ({ blocks: {} as Record<string, unknown>, batches: [] as unknown[][], restored: [] as string[] }))

vi.mock('../store/blocks', async (importOriginal) => {
  const { applyOpsToMap } = await import('../store/ops')
  type Map = Parameters<typeof applyOpsToMap>[0]
  return {
    ...(await importOriginal<object>()),
    newId: () => 'new',
    getBlock: (id: string | null | undefined) => (id && Object.hasOwn(store.blocks, id) ? (store.blocks[id] as Block) : undefined),
    applyOps: (ops: Op[]) => {
      store.batches.push(ops)
      store.blocks = applyOpsToMap(store.blocks as Map, ops, 2_000).map
      return Promise.resolve([])
    },
    loadChildren: () => Promise.resolve(),
    loadTree: () => Promise.resolve(),
    refreshBlocks: () => Promise.resolve(),
    fetchBlocks: () => Promise.resolve()
  }
})

const toasts = vi.hoisted(() => [] as { message: string; action?: { label: string; run: () => void } }[])
const errors = vi.hoisted(() => [] as string[])
vi.mock('../ui/toast', () => ({
  toast: (message: string, options: { action?: { label: string; run: () => void } } = {}) => {
    toasts.push({ message, action: options.action })
    return 'toast'
  },
  notifyError: (message: string) => void errors.push(message)
}))

const { letGoTasks } = await import('./edit')

function task(id: string, trashedAt: number | null = null): Block {
  return {
    id,
    type: 'page',
    parentId: TASKS_DATABASE_ID,
    content: [],
    props: { title: [[id]], values: {} },
    createdAt: 1,
    updatedAt: 1,
    trashedAt
  }
}

function seed(rows: Block[]): void {
  const db: Block = {
    id: TASKS_DATABASE_ID,
    type: 'database',
    parentId: null,
    content: rows.map((row) => row.id),
    props: tasksDatabaseProps() as unknown as Block['props'],
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null
  }
  store.blocks = { [db.id]: db, ...Object.fromEntries(rows.map((row) => [row.id, row])) }
}

beforeEach(() => {
  store.batches = []
  store.restored = []
  toasts.length = 0
  errors.length = 0
  vi.stubGlobal('window', {
    api: {
      pages: {
        restore: (id: string) => {
          store.restored.push(id)
          // As the main process does: the page comes back out of the trash, at the end of its parent.
          const db = store.blocks[TASKS_DATABASE_ID] as Block
          store.blocks = { ...store.blocks, [id]: task(id), [db.id]: { ...db, content: [...db.content.filter((each) => each !== id), id] } }
          return Promise.resolve()
        }
      }
    }
  })
})

describe('letting go of several tasks', () => {
  it('moves them to the trash in one batch with one toast', () => {
    seed([task('a'), task('b'), task('c')])
    expect(letGoTasks(['a', 'b'])).toBe(2)
    expect(store.batches).toHaveLength(1)
    expect(store.batches[0]).toEqual([
      { op: 'delete', id: 'a' },
      { op: 'delete', id: 'b' }
    ])
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Let go of 2 tasks.')
    expect(toasts[0].action?.label).toBe('Undo')
  })

  it('brings back only the tasks it let go of, never one that was already in the trash', async () => {
    seed([task('a'), task('b'), task('old', 5)])
    letGoTasks(['a', 'b', 'old'])
    expect(store.batches[0]).toEqual([
      { op: 'delete', id: 'a' },
      { op: 'delete', id: 'b' }
    ])
    toasts[0].action?.run()
    await vi.waitFor(() => expect(store.restored).toEqual(['a', 'b']))
  })

  it('puts the tasks back in their order with the move batch of Undo', async () => {
    seed([task('a'), task('b'), task('c')])
    letGoTasks(['a', 'c'])
    toasts[0].action?.run()
    await vi.waitFor(() => expect(store.batches).toHaveLength(2))
    expect((store.blocks[TASKS_DATABASE_ID] as Block).content).toEqual(['a', 'b', 'c'])
  })

  it('says the task is gone and writes nothing when none is left', () => {
    seed([task('old', 5)])
    expect(letGoTasks(['old', 'missing'])).toBe(0)
    expect(store.batches).toHaveLength(0)
    expect(toasts).toHaveLength(0)
    expect(errors).toEqual(['This task is no longer here.'])
  })
})
