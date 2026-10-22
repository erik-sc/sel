import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, BlockProps, PropertyValue } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from '@shared/tasks'
import type * as L from '@/database/logic'
import { emptyChipsOf, listCounts, listTasks, readTasks } from './lists'
import { currentTask, refineKeyAction, refineQueue, refineStep, startRefineState, type RefineCommand } from './refineWalk'

const TODAY = '2026-10-21'
const props = tasksDatabaseProps()
const schema: L.Schema = {
  ...(props.schema as L.Schema),
  [TASK_PROPS.project]: { id: TASK_PROPS.project, name: 'Project', type: 'select', options: [{ id: 'casa', name: 'Casa', color: 'green' }] }
}

function row(id: string, createdAt: number, values: Record<string, PropertyValue> = {}): Block {
  return {
    id,
    type: 'page',
    parentId: TASKS_DATABASE_ID,
    content: [],
    props: { title: [[id]], values } as BlockProps,
    createdAt,
    updatedAt: createdAt,
    trashedAt: null
  }
}

const refined: Record<string, PropertyValue> = {
  [TASK_PROPS.due]: { start: '2026-10-23T15:00' },
  [TASK_PROPS.priority]: 'tasks.p2',
  [TASK_PROPS.project]: 'casa'
}

// In database order: the newest first, as a quick add puts it.
const rows = [
  row('pão', 30),
  row('dentista', 10, { [TASK_PROPS.project]: 'casa' }),
  row('feito', 5, refined),
  row('conta', 20, { [TASK_PROPS.priority]: 'tasks.p4' }),
  row('sub', 1, { [TASK_PROPS.parent]: ['pão'] }),
  row('fechada', 2, { [TASK_PROPS.done]: true })
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 21, 10, 0))
})
afterEach(() => vi.useRealTimers())

describe('"A refinar"', () => {
  const tasks = readTasks(rows, schema)

  it('holds the open tasks not yet refined, oldest first, without subtasks', () => {
    expect(listTasks(tasks, schema, { kind: 'refine' }, TODAY)[0].items.map((task) => task.id)).toEqual(['dentista', 'conta', 'pão'])
  })

  it('has its count beside it, like the other lists', () => {
    const counts = listCounts(tasks, schema)
    expect(counts.get('refine')).toBe(3)
    expect(counts.get('inbox')).toBe(3)
  })

  it('offers what a task lacks as empty chips, and nothing on a refined task or a subtask', () => {
    const byId = new Map(tasks.map((task) => [task.id, task]))
    expect(emptyChipsOf(byId.get('pão')!)).toEqual(['date', 'priority', 'project'])
    expect(emptyChipsOf(byId.get('conta')!)).toEqual(['date', 'project'])
    expect(emptyChipsOf(byId.get('feito')!)).toBeUndefined()
    expect(emptyChipsOf(byId.get('sub')!)).toBeUndefined()
  })

  it('is what the refine mode walks; from the Inbox, only its own', () => {
    expect(refineQueue(tasks, 'refine')).toEqual(['dentista', 'conta', 'pão'])
    expect(refineQueue(tasks, 'inbox')).toEqual(['conta', 'pão'])
  })
})

const key = (k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
  refineKeyAction({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods })

describe('the keys of the refine card', () => {
  it('move the walk', () => {
    expect(key('Enter')).toEqual({ kind: 'next' })
    expect(key('s')).toEqual({ kind: 'skip' })
    expect(key('S', { shiftKey: true })).toBeNull()
    expect(key('ArrowRight')).toEqual({ kind: 'skip' })
    expect(key('ArrowLeft')).toEqual({ kind: 'back' })
    expect(key('Delete')).toEqual({ kind: 'delete' })
    expect(key('Escape')).toEqual({ kind: 'exit' })
  })

  it('edit the task on the card', () => {
    expect(key('F2')).toEqual({ kind: 'rename' })
    expect(key('d')).toEqual({ kind: 'edit', field: 'date' })
    expect(key('R')).toEqual({ kind: 'edit', field: 'repeat' })
    expect(key('3')).toEqual({ kind: 'priority', level: 3 })
    expect(key('5')).toBeNull()
    expect(key('#', { shiftKey: true })).toEqual({ kind: 'edit', field: 'project' })
    expect(key('@', { shiftKey: true })).toEqual({ kind: 'edit', field: 'labels' })
  })

  it('leave the app its own keys', () => {
    expect(key('Enter', { ctrlKey: true })).toBeNull()
    expect(key('s', { altKey: true })).toBeNull()
    expect(key('Tab')).toBeNull()
    expect(key('x')).toBeNull()
  })
})

describe('the walk', () => {
  const run = (queue: string[], commands: RefineCommand['kind'][]) =>
    commands.reduce((state, kind) => refineStep(state, { kind } as RefineCommand), startRefineState(queue))

  it('goes one by one and ends past the last', () => {
    let state = startRefineState(['a', 'b'])
    expect(currentTask(state)).toBe('a')
    state = refineStep(state, { kind: 'next' })
    expect(currentTask(state)).toBe('b')
    state = refineStep(state, { kind: 'skip' })
    expect(state.done).toBe(true)
    expect(currentTask(state)).toBeNull()
    expect(state.skipped).toEqual(['b'])
    // Nothing moves once it is over, but ← goes back to the last.
    expect(refineStep(state, { kind: 'next' })).toBe(state)
    expect(currentTask(refineStep(state, { kind: 'back' }))).toBe('b')
  })

  it('is over at once when there is nothing to refine', () => {
    expect(startRefineState([]).done).toBe(true)
  })

  it('goes back, but not before the first', () => {
    expect(currentTask(run(['a', 'b', 'c'], ['next', 'next', 'back']))).toBe('b')
    expect(currentTask(run(['a', 'b'], ['back']))).toBe('a')
  })

  it('takes a deleted task out and shows the one after it', () => {
    const state = run(['a', 'b', 'c'], ['next', 'delete'])
    expect(state.queue).toEqual(['a', 'c'])
    expect(currentTask(state)).toBe('c')
    const last = run(['a', 'b'], ['next', 'delete'])
    expect(last.done).toBe(true)
    expect(run(['a'], ['delete'])).toMatchObject({ queue: [], done: true })
  })

  it('forgets a skip once the task is passed with Enter', () => {
    const state = run(['a', 'b'], ['skip', 'back', 'next'])
    expect(state.skipped).toEqual([])
  })

  it('leaves the walk alone for what is about the task', () => {
    const state = startRefineState(['a'])
    for (const command of [{ kind: 'rename' }, { kind: 'edit', field: 'date' }, { kind: 'priority', level: 1 }, { kind: 'exit' }] as const)
      expect(refineStep(state, command)).toBe(state)
  })
})
