import { describe, expect, it } from 'vitest'
import type { Block, BlockProps } from '../types'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from './index'
import {
  cleanRefineSetting,
  daysBetween,
  isRefined,
  missingFields,
  needsRefining,
  readRefineSettings,
  REFINE_DEFAULTS,
  REFINE_SETTING,
  refineList,
  refineSummary
} from './refine'

const at = (day: number, hour = 12): number => new Date(2026, 9, day, hour).getTime()

describe('the refined rule', () => {
  const full = { done: false, due: '2026-10-23T15:00', priority: 2, project: 'casa' }

  it('asks for a date, a priority and a project, and nothing else', () => {
    expect(isRefined(full)).toBe(true)
    expect(missingFields(full)).toEqual([])
    expect(missingFields({ done: false, due: null, priority: null, project: null })).toEqual(['date', 'priority', 'project'])
    expect(missingFields({ ...full, priority: null })).toEqual(['priority'])
    expect(missingFields({ ...full, due: '', project: undefined })).toEqual(['date', 'project'])
  })

  it('counts P4 as a priority, unlike no priority at all', () => {
    expect(isRefined({ ...full, priority: 4 })).toBe(true)
    expect(isRefined({ ...full, priority: null })).toBe(false)
  })

  it('leaves done tasks and subtasks out of what is to refine', () => {
    const bare = { done: false, due: null, priority: null, project: null }
    expect(needsRefining(bare)).toBe(true)
    expect(needsRefining({ ...bare, done: true })).toBe(false)
    expect(needsRefining({ ...bare, parent: 'p' })).toBe(false)
    expect(needsRefining(full)).toBe(false)
  })

  it('lists the oldest first, the database order between equals', () => {
    const task = (id: string, createdAt: number, order: number, refined = false) => ({
      id,
      createdAt,
      order,
      done: false,
      due: refined ? '2026-10-20' : null,
      priority: refined ? 1 : null,
      project: refined ? 'casa' : null
    })
    const list = refineList([
      task('new', 30, 0),
      task('old', 10, 1),
      task('done', 5, 2, true),
      task('twin-b', 20, 4),
      task('twin-a', 20, 3)
    ])
    expect(list.map((item) => item.id)).toEqual(['old', 'twin-a', 'twin-b', 'new'])
  })

  it('counts whole local days', () => {
    expect(daysBetween(at(20, 23), at(21, 1))).toBe(1)
    expect(daysBetween(at(20, 1), at(20, 23))).toBe(0)
    expect(daysBetween(at(18), at(21))).toBe(3)
  })
})

describe('what is stored', () => {
  const props = tasksDatabaseProps()
  const schema = props.schema as Record<string, { options?: unknown[] }>
  schema[TASK_PROPS.project] = { ...schema[TASK_PROPS.project], options: [{ id: 'casa', name: 'Casa', color: 'green' }] }
  const database: Block = {
    id: TASKS_DATABASE_ID,
    type: 'database',
    parentId: null,
    content: [],
    props,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
  const row = (id: string, values: Record<string, unknown>, createdAt: number, extra: Partial<Block> = {}): Block => ({
    id,
    type: 'page',
    parentId: TASKS_DATABASE_ID,
    content: [],
    props: { title: [[id]], values } as BlockProps,
    createdAt,
    updatedAt: createdAt,
    trashedAt: null,
    ...extra
  })
  const refined = { [TASK_PROPS.due]: { start: '2026-10-23' }, [TASK_PROPS.priority]: 'tasks.p2', [TASK_PROPS.project]: 'casa' }

  it('counts the open tasks to refine and the Inbox tasks that waited two days', () => {
    const rows = [
      row('fresh', {}, at(21, 9)),
      row('yesterday', {}, at(20, 9)),
      row('oldest', {}, at(17, 9)),
      row('waiting', { [TASK_PROPS.priority]: 'tasks.p1' }, at(18, 9)),
      // In a project but without a date: to refine, not in the Inbox.
      row('in a project', { [TASK_PROPS.project]: 'casa' }, at(10)),
      row('refined', refined, at(1)),
      row('done', { [TASK_PROPS.done]: true }, at(1)),
      row('subtask', { [TASK_PROPS.parent]: ['oldest'] }, at(1)),
      row('trashed', {}, at(1), { trashedAt: at(2) }),
      // A project whose option is gone, a priority that is not one: neither counts.
      row('stale', { ...refined, [TASK_PROPS.project]: 'gone', [TASK_PROPS.priority]: 'nonsense' }, at(21, 8))
    ]
    expect(refineSummary(database, rows, at(21, 10))).toEqual({
      count: 6,
      waiting: 2,
      oldest: { id: 'oldest', title: 'oldest', days: 4 }
    })
    expect(refineSummary(database, [row('refined', refined, at(1))], at(21))).toEqual({ count: 0, waiting: 0, oldest: null })
  })
})

describe('the settings', () => {
  it('are on by default, the refine time on weekdays at 17:00', () => {
    expect(readRefineSettings(() => null)).toEqual(REFINE_DEFAULTS)
    expect(REFINE_DEFAULTS).toEqual({
      briefing: true,
      herman: true,
      time: { enabled: true, time: '17:00', days: [1, 2, 3, 4, 5] },
      mark: true
    })
  })

  it('take only what fits, and fall back to the default otherwise', () => {
    expect(cleanRefineSetting(REFINE_SETTING.mark, false)).toBe(false)
    expect(cleanRefineSetting(REFINE_SETTING.mark, 'no')).toBeUndefined()
    expect(cleanRefineSetting(REFINE_SETTING.time, { enabled: false, time: '09:30', days: [3, 1, 1] })).toEqual({
      enabled: false,
      time: '09:30',
      days: [1, 3]
    })
    expect(cleanRefineSetting(REFINE_SETTING.time, { enabled: true, time: '9:30', days: [] })).toBeUndefined()
    expect(cleanRefineSetting(REFINE_SETTING.time, { enabled: true, time: '09:30', days: [7] })).toBeUndefined()
    expect(cleanRefineSetting(REFINE_SETTING.time, { enabled: true, time: '09:30', days: [], extra: 1 })).toBeUndefined()
    expect(cleanRefineSetting('tasks.other', true)).toBeUndefined()
    const stored: Record<string, unknown> = { [REFINE_SETTING.herman]: false, [REFINE_SETTING.time]: 'junk' }
    expect(readRefineSettings((key) => stored[key])).toMatchObject({ herman: false, time: REFINE_DEFAULTS.time })
  })
})
