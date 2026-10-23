import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '../../shared/activity'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import type { Block } from '../../shared/types'
import { findStalled, postponements } from './stalled'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 22, 10, 30).getTime()

function task(id: string, title: string, options: { values?: Record<string, unknown>; created?: number; updated?: number } = {}): Block {
  return {
    id,
    type: 'page',
    parentId: TASKS_DATABASE_ID,
    content: [],
    props: { title: [[title]], values: options.values ?? {} },
    createdAt: options.created ?? NOW - 40 * DAY,
    updatedAt: options.updated ?? NOW - DAY,
    trashedAt: null
  } as Block
}

const postponed = (id: string, times: number, at = NOW - 2 * DAY): ActivityRow[] =>
  Array.from({ length: times }, () => ({ at, kind: 'task.postponed', area: null, pageId: id, project: null, count: 1, minutes: null }))

describe('a stalled task', () => {
  it('is one put off three times or more', () => {
    const rows = [task('task-aaaa-01', 'Write the report'), task('task-bbbb-01', 'File the taxes')]
    const log = [...postponed('task-aaaa-01', 2), ...postponed('task-bbbb-01', 3)]
    expect(postponements(log).get('task-bbbb-01')).toBe(3)
    expect(findStalled(rows, log, NOW)).toMatchObject({ id: 'task-bbbb-01', title: 'File the taxes', postponed: 3 })
    expect(findStalled(rows, postponed('task-aaaa-01', 2), NOW)).toBeNull()
  })

  it('is one open and untouched for two weeks', () => {
    const rows = [
      task('task-cccc-01', 'Call the bank', { updated: NOW - 15 * DAY }),
      task('task-dddd-01', 'Brand new', { created: NOW - 2 * DAY, updated: NOW - 2 * DAY })
    ]
    expect(findStalled(rows, [], NOW)).toMatchObject({ id: 'task-cccc-01', untouchedDays: 15, postponed: 0 })
  })

  it('puts the most postponed first, then the longest untouched', () => {
    const rows = [
      task('task-eeee-01', 'Untouched a month', { updated: NOW - 30 * DAY }),
      task('task-ffff-01', 'Postponed four times'),
      task('task-gggg-01', 'Postponed three times', { updated: NOW - 20 * DAY })
    ]
    const log = [...postponed('task-ffff-01', 4), ...postponed('task-gggg-01', 3)]
    expect(findStalled(rows, log, NOW)?.id).toBe('task-ffff-01')
  })

  it('leaves out what is done, repeating, a subtask, private, trashed or offered lately', () => {
    const old = { updated: NOW - 30 * DAY }
    const rows = [
      task('task-done-001', 'Done', { ...old, values: { [TASK_PROPS.done]: true } }),
      task('task-rep-0001', 'Repeats', { ...old, values: { [TASK_PROPS.recurrence]: 'FREQ=WEEKLY' } }),
      task('task-sub-0001', 'A step', { ...old, values: { [TASK_PROPS.parent]: ['task-rep-0001'] } }),
      task('task-priv-001', 'Private', old),
      { ...task('task-trash-01', 'Trashed', old), trashedAt: NOW } as Block,
      task('task-seen-001', 'Offered yesterday', old)
    ]
    expect(findStalled(rows, [], NOW, { hidden: (id) => id === 'task-priv-001', skip: new Set(['task-seen-001']) })).toBeNull()
  })
})
