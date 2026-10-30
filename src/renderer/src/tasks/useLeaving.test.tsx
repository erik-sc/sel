// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskGroup, TaskItem } from './lists'
import { useLeaving } from './useLeaving'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
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
  }) as unknown as TaskItem
const group = (...items: TaskItem[]): TaskGroup => ({ id: 'all', title: null, items, depth: new Map() })
const sel = { id: 'sel', name: 'sel', color: 'blue' } as never
let seen: string[][] = []
function H({ groups, tasks }: { groups: TaskGroup[]; tasks: TaskItem[] }) {
  const r = useLeaving(groups, tasks, 'inbox:', true)
  seen.push(r.groups.flatMap((g) => g.items.map((t) => t.id)))
  return null
}
afterEach(() => vi.useRealTimers())
describe('useLeaving', () => {
  it('keeps the row for the fade, then lets it go for good', () => {
    vi.useFakeTimers()
    seen = []
    const el = document.createElement('div')
    const root = createRoot(el)
    const a = item('a'),
      b = item('b')
    act(() => root.render(<H groups={[group(a, b)]} tasks={[a, b]} />))
    const b2 = item('b', { project: sel })
    act(() => root.render(<H groups={[group(a)]} tasks={[a, b2]} />))
    expect(seen.at(-1)).toEqual(['a', 'b'])
    for (let i = 0; i < 5; i++)
      act(() => {
        vi.advanceTimersByTime(350)
      })
    act(() => root.unmount())
    expect(seen.at(-1)).toEqual(['a'])
  })
})
