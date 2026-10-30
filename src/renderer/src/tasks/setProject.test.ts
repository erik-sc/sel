// Giving a task a project: the toast says where it went, and its Undo puts the project it had back.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from '../../../shared/tasks'
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

const { setProject } = await import('./edit')
const { useHome } = await import('@/home/store')

function task(id: string, project?: string): Block {
  return {
    id,
    type: 'page',
    parentId: TASKS_DATABASE_ID,
    content: [],
    props: { title: [[id]], values: project ? { [TASK_PROPS.project]: project } : {} },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null
  }
}

function withProjects(): Block['props'] {
  const props = tasksDatabaseProps() as unknown as { schema: Record<string, { options?: unknown[] }> }
  props.schema[TASK_PROPS.project].options = [
    { id: 'sel', name: 'sel', color: 'blue' },
    { id: 'casa', name: 'casa', color: 'green' }
  ]
  return props as unknown as Block['props']
}

function seed(rows: Block[]): void {
  const db: Block = {
    id: TASKS_DATABASE_ID,
    type: 'database',
    parentId: null,
    content: rows.map((row) => row.id),
    props: withProjects(),
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
  useHome.setState({ locale: 'en' })
})

const projectOf = (id: string): unknown => ((store.blocks[id] as Block).props.values as Record<string, unknown>)[TASK_PROPS.project] ?? null

describe('giving a task a project', () => {
  it('writes it and says where the task went, with Undo', () => {
    seed([task('a')])
    setProject('a', 'sel')
    expect(projectOf('a')).toBe('sel')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('"a" went to #sel.')
    expect(toasts[0].action?.label).toBe('Undo')
  })

  it('Undo takes the project away again for a task from the Inbox', () => {
    seed([task('a')])
    setProject('a', 'sel')
    toasts[0].action?.run()
    expect(projectOf('a')).toBeNull()
  })

  it('Undo restores the project the task had before', () => {
    seed([task('a', 'casa')])
    setProject('a', 'sel')
    expect(projectOf('a')).toBe('sel')
    toasts[0].action?.run()
    expect(projectOf('a')).toBe('casa')
  })

  it('says it in Portuguese when the home is', () => {
    useHome.setState({ locale: 'pt-BR' })
    seed([task('a')])
    setProject('a', 'sel')
    expect(toasts[0].message).toBe('"a" foi para #sel.')
    expect(toasts[0].action?.label).toBe('Desfazer')
  })

  it('stays quiet when the project is cleared or does not change', () => {
    seed([task('a', 'sel')])
    setProject('a', 'sel')
    setProject('a', null)
    expect(toasts).toHaveLength(0)
    expect(projectOf('a')).toBeNull()
  })
})
