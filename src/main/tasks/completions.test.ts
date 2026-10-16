import { beforeEach, describe, expect, it } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import { completeTaskOps } from '../../shared/tasks/recur'
import type { Op, PropertyValue } from '../../shared/types'
import type { Repository } from '../db/repository'
import { ensureTasksDatabase } from '../db/tasks'
import { openTestRepository } from '../db/testing'
import { completionChanges, completionsBefore } from './completions'

const NOW = new Date(2026, 9, 15, 10, 0)

describe('completions written as edits', () => {
  let repo: Repository
  const get = (id: string): ReturnType<Repository['get']> => repo.get(id)

  /** Applies `ops` as `blocks:apply` does, and says what Herman would hear. */
  const apply = (ops: Op[]): { completed: number; uncompleted: number } => {
    const before = completionsBefore(ops, get)
    repo.apply(ops)
    return completionChanges(before, get)
  }

  const task = (values: Record<string, PropertyValue> = {}, parentId = TASKS_DATABASE_ID): string =>
    repo.create({ type: 'page', parentId, props: { title: [['A task']], values } }).id

  const valuesOf = (id: string): Record<string, PropertyValue> => ({ ...(repo.get(id)?.props.values as Record<string, PropertyValue>) })

  beforeEach(() => {
    repo = openTestRepository()
    ensureTasksDatabase(repo)
  })

  it('counts Done ticked in a view of the Tasks database', () => {
    const id = task({ [TASK_PROPS.due]: { start: '2026-10-15' } })
    expect(apply(completeTaskOps(repo.get(id)!, NOW))).toEqual({ completed: 1, uncompleted: 0 })
    expect(valuesOf(id)[TASK_PROPS.done]).toBe(true)
  })

  it('counts a repeating task that moved on, though it stays open', () => {
    const id = task({ [TASK_PROPS.due]: { start: '2026-10-15' }, [TASK_PROPS.recurrence]: 'FREQ=WEEKLY' })
    expect(apply(completeTaskOps(repo.get(id)!, NOW))).toEqual({ completed: 1, uncompleted: 0 })
    // Ticked again the next week: a later completion is another one.
    expect(apply(completeTaskOps(repo.get(id)!, new Date(2026, 9, 22, 9, 0)))).toEqual({ completed: 1, uncompleted: 0 })
  })

  it('hears a completion taken back: reopened, or undone to the one before', () => {
    const id = task({ [TASK_PROPS.recurrence]: 'FREQ=DAILY', [TASK_PROPS.due]: { start: '2026-10-15' } })
    apply(completeTaskOps(repo.get(id)!, NOW))
    const first = valuesOf(id)
    apply(completeTaskOps(repo.get(id)!, new Date(2026, 9, 16, 9, 0)))
    // Ctrl+Z puts the values of the first completion back.
    expect(apply([{ op: 'update', id, patch: { props: { values: first } } }])).toEqual({ completed: 0, uncompleted: 1 })
    const open = valuesOf(id)
    delete open[TASK_PROPS.completedAt]
    expect(apply([{ op: 'update', id, patch: { props: { values: open } } }])).toEqual({ completed: 0, uncompleted: 1 })
  })

  it('ignores other edits, other databases and other ops', () => {
    const id = task({ [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-14T08:00' } })
    expect(apply([{ op: 'update', id, patch: { props: { title: [['Renamed']] } } }])).toEqual({ completed: 0, uncompleted: 0 })

    const other = repo.create({ type: 'database', parentId: null, props: { title: [['Mine']], schema: {} } }).id
    const row = task({}, other)
    const ops: Op[] = [{ op: 'update', id: row, patch: { props: { values: { [TASK_PROPS.completedAt]: { start: '2026-10-15T10:00' } } } } }]
    expect(completionsBefore(ops, get).size).toBe(0)

    const created: Op[] = [{ op: 'create', input: { type: 'page', parentId: TASKS_DATABASE_ID, props: { values: { [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-15T10:00' } } } } }]
    expect(apply(created)).toEqual({ completed: 0, uncompleted: 0 })
  })

  it('counts several rows ticked in one write, each once', () => {
    const a = task()
    const b = task()
    const ops = [...completeTaskOps(repo.get(a)!, NOW), ...completeTaskOps(repo.get(b)!, NOW), { op: 'update', id: a, patch: { props: { title: [['Again']] } } } as Op]
    expect(apply(ops)).toEqual({ completed: 2, uncompleted: 0 })
  })
})
