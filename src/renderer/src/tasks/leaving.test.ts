import { describe, expect, it } from 'vitest'
import type { TaskGroup, TaskItem } from './lists'
import { leftWithProject, withFading } from './leaving'

const item = (id: string, extra: Partial<TaskItem> = {}): TaskItem =>
  ({
    id,
    title: id,
    done: false,
    due: null,
    priority: null,
    project: null,
    labels: [],
    recurrence: null,
    remind: null,
    parent: null,
    ...extra
  }) as TaskItem
const group = (...items: TaskItem[]): TaskGroup => ({ id: 'all', title: null, items, depth: new Map() })
const sel = { id: 'sel', name: 'sel', color: 'blue' }

describe('a task that leaves the Inbox with a project', () => {
  const a = item('a')
  const b = item('b')
  const c = item('c')

  it('is found when it is gone from the list yet open and in a project', () => {
    const b2 = item('b', { project: sel })
    expect(leftWithProject([group(a, b, c)], [group(a, c)], [a, b2, c]).map((task) => task.id)).toEqual(['b'])
  })

  it('is not found when it was completed, deleted, or still has no project', () => {
    const done = item('b', { project: sel, done: true })
    expect(leftWithProject([group(a, b, c)], [group(a, c)], [a, done, c])).toEqual([])
    expect(leftWithProject([group(a, b, c)], [group(a, c)], [a, c])).toEqual([])
    expect(leftWithProject([group(a, b, c)], [group(a, c)], [a, b, c])).toEqual([])
  })

  it('goes back in its old place, as it is now, while it fades', () => {
    const b2 = item('b', { project: sel })
    const out = withFading([group(a, b, c)], [group(a, c)], new Map([['b', b2]]))
    expect(out[0].items.map((task) => task.id)).toEqual(['a', 'b', 'c'])
    expect(out[0].items[1].project).toEqual(sel)
  })

  it('is not put back twice, nor when nothing fades', () => {
    const b2 = item('b', { project: sel })
    const now = [group(a, b2, c)]
    expect(withFading([group(a, b, c)], now, new Map([['b', b2]]))).toBe(now)
    expect(withFading([group(a, b, c)], now, new Map())).toBe(now)
  })

  it('keeps its place when the list got shorter than before', () => {
    const c2 = item('c', { project: sel })
    const out = withFading([group(a, b, c)], [group(a)], new Map([['c', c2]]))
    expect(out[0].items.map((task) => task.id)).toEqual(['a', 'c'])
  })
})
