import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../../shared/tasks'
import type { Block } from '../../../shared/types'

const store = vi.hoisted(() => ({ blocks: {} as Record<string, unknown>, fetched: [] as string[][] }))
const calls = vi.hoisted(() => ({ dated: [] as string[][], toasts: [] as string[] }))

vi.mock('../store/blocks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlock: (id: string) => store.blocks[id],
  fetchBlocks: async (read: () => Promise<Block[]>) => {
    const blocks = await read()
    for (const b of blocks) store.blocks[b.id] = b
    return blocks
  }
}))
vi.mock('../ui/toast', () => ({
  toast: (message: string) => void calls.toasts.push(message),
  notifyError: (message: string) => void calls.toasts.push(message)
}))
vi.mock('../tasks/bulk', () => ({ setDateMany: (ids: string[]) => void calls.dated.push(ids) }))

const { dateTasks, undatedTasks } = await import('./dating')

const task = (id: string, values: Record<string, unknown> = {}, extra: Partial<Block> = {}): Block =>
  ({ id, parentId: TASKS_DATABASE_ID, trashedAt: null, props: { values }, ...extra }) as unknown as Block

describe('dating tasks from a note', () => {
  beforeEach(() => {
    store.blocks = {}
    calls.dated = []
    calls.toasts = []
  })

  it('keeps only open, undated tasks that are still there', () => {
    const rows: Record<string, Block> = {
      a: task('a'),
      b: task('b', { [TASK_PROPS.due]: '2026-11-01' }),
      c: task('c', { [TASK_PROPS.done]: true }),
      d: task('d', {}, { trashedAt: 1 } as Partial<Block>)
    }
    expect(undatedTasks(['a', 'b', 'c', 'd', 'gone'], (id) => rows[id])).toEqual(['a'])
  })

  it('fetches the database and the tasks before dating, then dates the ones left', async () => {
    const rows = [{ id: TASKS_DATABASE_ID, props: {} } as unknown as Block, task('a'), task('b', { [TASK_PROPS.due]: '2026-11-01' })]
    vi.stubGlobal('window', { api: { blocks: { getMany: (ids: string[]) => (store.fetched.push(ids), Promise.resolve(rows)) } } })
    await dateTasks(['a', 'b'], 'tomorrow')
    expect(store.fetched[0]).toEqual([TASKS_DATABASE_ID, 'a', 'b'])
    expect(calls.dated).toEqual([['a']])
  })

  it('says so instead of dating when nothing is left', async () => {
    const rows = [{ id: TASKS_DATABASE_ID, props: {} } as unknown as Block, task('b', { [TASK_PROPS.done]: true })]
    vi.stubGlobal('window', { api: { blocks: { getMany: () => Promise.resolve(rows) } } })
    await dateTasks(['b', 'x'], 'tomorrow')
    expect(calls.dated).toEqual([])
    expect(calls.toasts).toHaveLength(1)
  })
})
