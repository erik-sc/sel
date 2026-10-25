// One change to a selection of tasks against an in-memory store with the real op semantics: what
// reaches the store, in one batch, and what the one Undo puts back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from '../../../shared/tasks'
import type { Block, Op, PropertyValue } from '../../../shared/types'

const store = vi.hoisted(() => ({ blocks: {} as Record<string, unknown>, batches: [] as unknown[][] }))

vi.mock('../store/blocks', async (importOriginal) => {
  const { applyOpsToMap } = await import('../store/ops')
  type Map = Parameters<typeof applyOpsToMap>[0]
  return {
    // The home store (the locale) pulls in the rest of the module.
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
    refreshBlocks: () => Promise.resolve()
  }
})

const toasts = vi.hoisted(() => [] as { message: string; action?: { label: string; run: () => void } }[])
vi.mock('../ui/toast', () => ({
  toast: (message: string, options: { action?: { label: string; run: () => void } } = {}) => {
    toasts.push({ message, action: options.action })
    return 'toast'
  },
  notifyError: (message: string) => {
    throw new Error(message)
  }
}))

const { setDateMany, setPriorityMany, setProjectMany, toggleDoneMany } = await import('./bulk')

const props = tasksDatabaseProps() as { schema: Record<string, { options?: { id: string; name: string; color: string }[] }> }
props.schema[TASK_PROPS.project].options = [{ id: 'home', name: 'Home', color: 'green' }]
const project = 'home'
const WEEKLY = JSON.stringify({ rule: 'FREQ=WEEKLY', from: 'due', text: 'weekly' })

function task(id: string, values: Record<string, PropertyValue> = {}): Block {
  return {
    id,
    type: 'page',
    parentId: TASKS_DATABASE_ID,
    content: [],
    props: { title: [[id]], values },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null
  }
}

function seed(rows: Block[]): void {
  const db: Block = {
    id: TASKS_DATABASE_ID,
    type: 'database',
    parentId: null,
    content: rows.map((row) => row.id),
    props: props as unknown as Block['props'],
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null
  }
  store.blocks = { [db.id]: db, ...Object.fromEntries(rows.map((row) => [row.id, row])) }
}

const valuesOf = (id: string): Record<string, PropertyValue> => (store.blocks[id] as Block).props.values ?? {}
const NOW = new Date(2026, 9, 15, 18, 40)

beforeEach(() => {
  store.blocks = {}
  store.batches = []
  toasts.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())

describe('a change to several tasks', () => {
  it('sets the date of all of them in one batch, and one Undo puts every date back', () => {
    seed([
      task('a', { [TASK_PROPS.due]: { start: '2026-10-20T09:00' } }),
      task('b'),
      task('c', { [TASK_PROPS.due]: { start: '2026-10-01' } })
    ])
    setDateMany(['a', 'b', 'c'], 'tomorrow', NOW)
    expect(store.batches).toHaveLength(1)
    // Each keeps its time of day; a task without a date gets just the day.
    expect(valuesOf('a')[TASK_PROPS.due]).toEqual({ start: '2026-10-16T09:00' })
    expect(valuesOf('b')[TASK_PROPS.due]).toEqual({ start: '2026-10-16' })
    expect(valuesOf('c')[TASK_PROPS.due]).toEqual({ start: '2026-10-16' })
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Date changed on 3 tasks.')
    toasts[0].action?.run()
    expect(store.batches).toHaveLength(2)
    expect(valuesOf('a')[TASK_PROPS.due]).toEqual({ start: '2026-10-20T09:00' })
    expect(valuesOf('b')).toEqual({})
    expect(valuesOf('c')[TASK_PROPS.due]).toEqual({ start: '2026-10-01' })
  })

  it('takes the date away from all of them', () => {
    seed([task('a', { [TASK_PROPS.due]: { start: '2026-10-20' } }), task('b', { [TASK_PROPS.due]: { start: '2026-10-21' } })])
    setDateMany(['a', 'b'], null)
    expect([valuesOf('a')[TASK_PROPS.due], valuesOf('b')[TASK_PROPS.due]]).toEqual([undefined, undefined])
  })

  it('sets a priority on all, and the same one on all takes it away', () => {
    seed([task('a'), task('b', { [TASK_PROPS.priority]: 'tasks.p3' }), task('c')])
    setPriorityMany(['a', 'b', 'c'], 2)
    const level = valuesOf('a')[TASK_PROPS.priority]
    expect(valuesOf('b')[TASK_PROPS.priority]).toBe(level)
    expect(valuesOf('c')[TASK_PROPS.priority]).toBe(level)
    setPriorityMany(['a', 'b', 'c'], 2)
    expect([valuesOf('a'), valuesOf('b'), valuesOf('c')].map((values) => values[TASK_PROPS.priority])).toEqual([
      undefined,
      undefined,
      undefined
    ])
  })

  it('sets a project on all, or none', () => {
    seed([task('a'), task('b')])
    setProjectMany(['a', 'b'], project)
    expect([valuesOf('a')[TASK_PROPS.project], valuesOf('b')[TASK_PROPS.project]]).toEqual([project, project])
    setProjectMany(['a', 'b'], null)
    expect(valuesOf('a')[TASK_PROPS.project]).toBeUndefined()
  })

  it('completes all with dated completions, moves repeating tasks to their next date, and Undo reverses it', () => {
    seed([task('rep', { [TASK_PROPS.due]: { start: '2026-10-15T08:00' }, [TASK_PROPS.recurrence]: WEEKLY }), task('once')])
    toggleDoneMany(['rep', 'once'])
    expect(store.batches).toHaveLength(1)
    expect(valuesOf('rep')[TASK_PROPS.due]).toEqual({ start: '2026-10-22T08:00' })
    expect(valuesOf('rep')[TASK_PROPS.completedAt]).toEqual({ start: '2026-10-15T18:40' })
    expect(valuesOf('once')[TASK_PROPS.done]).toBe(true)
    expect(valuesOf('once')[TASK_PROPS.completedAt]).toEqual({ start: '2026-10-15T18:40' })
    expect(toasts[0].message).toBe('Completed 2 tasks.')
    toasts[0].action?.run()
    expect(valuesOf('rep')[TASK_PROPS.due]).toEqual({ start: '2026-10-15T08:00' })
    expect(valuesOf('rep')[TASK_PROPS.completedAt]).toBeUndefined()
    expect(valuesOf('once')).toEqual({})
  })

  it('reopens all when every one is done already', () => {
    const finished = { [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-14T09:00' } }
    seed([task('a', finished), task('b', finished)])
    toggleDoneMany(['a', 'b'])
    expect([valuesOf('a'), valuesOf('b')]).toEqual([{}, {}])
    expect(toasts[0].message).toBe('Reopened 2 tasks.')
  })

  it('leaves out tasks that are gone or in the Trash, and counts the rest', () => {
    seed([task('a'), { ...task('b'), trashedAt: 5 }])
    setPriorityMany(['a', 'b', 'missing'], 1)
    expect(toasts[0].message).toBe('Priority changed on 1 task.')
    expect(valuesOf('b')).toEqual({})
  })
})
