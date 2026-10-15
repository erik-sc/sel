import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, BlockProps, PropertyValue } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from '@shared/tasks'
import * as L from '@/database/logic'
import { dueLabel, listCounts, listTasks, readTasks, relativeDay } from './lists'

const TODAY = '2026-10-15'

const props = tasksDatabaseProps()
const schema: L.Schema = {
  ...(props.schema as L.Schema),
  [TASK_PROPS.project]: { id: TASK_PROPS.project, name: 'Project', type: 'select', options: [{ id: 'home', name: 'Home', color: 'green' }] },
  [TASK_PROPS.labels]: { id: TASK_PROPS.labels, name: 'Labels', type: 'multi_select', options: [{ id: 'calls', name: 'calls', color: 'blue' }] }
}

let order = 0
function row(title: string, values: Record<string, PropertyValue> = {}, updatedAt = 0): Block {
  const block: Block = { id: `row-${order++}`, type: 'page', parentId: TASKS_DATABASE_ID, content: [], props: { title: [[title]], values } as BlockProps, createdAt: 0, updatedAt, trashedAt: null }
  return block
}

const titles = (groups: { items: { title: string }[] }[]): string[][] => groups.map((group) => group.items.map((item) => item.title))

beforeEach(() => {
  order = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the seeded database', () => {
  it('is already in the shape the database views keep: nothing to repair', () => {
    const block: Block = { id: TASKS_DATABASE_ID, type: 'database', parentId: null, content: [], props, createdAt: 0, updatedAt: 0, trashedAt: null }
    expect(L.normalizeDatabase(block).changed).toBe(false)
  })
})

describe('reading tasks', () => {
  it('by property id, with options resolved and unknown ones dropped', () => {
    const [task] = readTasks(
      [row('Call mum', { [TASK_PROPS.due]: { start: '2026-10-15T09:30' }, [TASK_PROPS.priority]: 'tasks.p1', [TASK_PROPS.project]: 'home', [TASK_PROPS.labels]: ['calls', 'gone'], [TASK_PROPS.recurrence]: 'FREQ=WEEKLY' })],
      schema
    )
    expect(task).toMatchObject({ title: 'Call mum', done: false, due: '2026-10-15T09:30', priority: 1, recurring: true })
    expect(task.project?.name).toBe('Home')
    expect(task.labels.map((label) => label.name)).toEqual(['calls'])
    expect(readTasks([row('Bare')], schema)[0]).toMatchObject({ priority: 4, project: null, labels: [], due: null, recurring: false })
  })
})

describe('the lists', () => {
  const rows = (): Block[] => [
    row('Late', { [TASK_PROPS.due]: { start: '2026-10-13' } }),
    row('This afternoon', { [TASK_PROPS.due]: { start: '2026-10-15T15:00' }, [TASK_PROPS.priority]: 'tasks.p2' }),
    row('This morning', { [TASK_PROPS.due]: { start: '2026-10-15T08:00' } }),
    row('Urgent today', { [TASK_PROPS.due]: { start: '2026-10-15' }, [TASK_PROPS.priority]: 'tasks.p1', [TASK_PROPS.project]: 'home' }),
    row('Tomorrow', { [TASK_PROPS.due]: { start: '2026-10-16' }, [TASK_PROPS.labels]: ['calls'] }),
    row('Next week', { [TASK_PROPS.due]: { start: '2026-10-22' }, [TASK_PROPS.project]: 'home' }),
    row('Someday'),
    row('Done earlier', { [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-14T18:00' } }, 5),
    row('Done just now', { [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-15T09:00' } }, 1),
    row('Done long ago', { [TASK_PROPS.done]: true, [TASK_PROPS.due]: { start: '2026-10-15' } }, 9)
  ]

  it('Today: overdue first, then today, earliest first', () => {
    const groups = listTasks(readTasks(rows(), schema), schema, { kind: 'today' }, TODAY)
    expect(groups.map((group) => group.id)).toEqual(['overdue', TODAY])
    expect(titles(groups)).toEqual([['Late'], ['Urgent today', 'This morning', 'This afternoon']])
    expect(groups[1].title).toMatch(/^Today · /)
  })

  it('Today without overdue tasks is a single untitled group', () => {
    const groups = listTasks(readTasks([row('Now', { [TASK_PROPS.due]: { start: TODAY } })], schema), schema, { kind: 'today' }, TODAY)
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBeNull()
  })

  it('Upcoming: the days after today, one group each', () => {
    const groups = listTasks(readTasks(rows(), schema), schema, { kind: 'upcoming' }, TODAY)
    expect(groups.map((group) => group.id)).toEqual(['2026-10-16', '2026-10-22'])
    expect(titles(groups)).toEqual([['Tomorrow'], ['Next week']])
    expect(groups[0].title).toMatch(/^Tomorrow · /)
  })

  it('Inbox: open tasks without a project, in the manual order', () => {
    expect(titles(listTasks(readTasks(rows(), schema), schema, { kind: 'inbox' }, TODAY))).toEqual([['Late', 'This afternoon', 'This morning', 'Tomorrow', 'Someday']])
  })

  it('Completed: the latest completion first, then the latest edit', () => {
    expect(titles(listTasks(readTasks(rows(), schema), schema, { kind: 'completed' }, TODAY))).toEqual([['Done just now', 'Done earlier', 'Done long ago']])
  })

  it('a project and a label', () => {
    const tasks = readTasks(rows(), schema)
    expect(titles(listTasks(tasks, schema, { kind: 'project', id: 'home' }, TODAY))).toEqual([['Urgent today', 'Next week']])
    expect(titles(listTasks(tasks, schema, { kind: 'label', id: 'calls' }, TODAY))).toEqual([['Tomorrow']])
  })

  it('counts open tasks per list', () => {
    const counts = listCounts(readTasks(rows(), schema), schema)
    expect(counts.get('today')).toBe(4)
    expect(counts.get('inbox')).toBe(5)
    expect(counts.get('project:home')).toBe(2)
    expect(counts.get('label:calls')).toBe(1)
  })
})

describe('naming days', () => {
  it('relative to today', () => {
    expect(relativeDay('2026-10-15', TODAY)).toBe('Today')
    expect(relativeDay('2026-10-16', TODAY)).toBe('Tomorrow')
    expect(relativeDay('2026-10-14', TODAY)).toBe('Yesterday')
    expect(relativeDay('2026-10-19', TODAY)).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 9, 19)))
    expect(relativeDay('2026-11-30', TODAY)).toBe(L.formatDay('2026-11-30'))
  })

  it('with the time, and late when the day has passed', () => {
    expect(dueLabel('2026-10-16T09:00', TODAY)).toEqual({ text: `Tomorrow ${L.formatTime('09:00')}`, overdue: false })
    expect(dueLabel('2026-10-14', TODAY)).toEqual({ text: 'Yesterday', overdue: true })
    expect(dueLabel('nonsense', TODAY)).toEqual({ text: '', overdue: false })
    // Under its own day's heading, only the time.
    expect(dueLabel('2026-10-16T09:00', TODAY, '2026-10-16')).toEqual({ text: L.formatTime('09:00'), overdue: false })
    expect(dueLabel('2026-10-16', TODAY, '2026-10-16').text).toBe('')
  })
})
