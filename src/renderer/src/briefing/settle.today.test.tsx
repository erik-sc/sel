// @vitest-environment happy-dom
// The calm completion on Today against the real data path: the store has the row done and the
// briefing reloads without the task, and the row still shows, done, until its wait and fold end.
import { act } from 'react'
import { useState, type JSX } from 'react'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import type { BriefingTask, BriefingTasks } from '@shared/briefing'
import type { Block } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fakeApi, render } from '@/a11y/testing'
import { putBlocks } from '@/store/blocks'
import { useHome } from '@/home/store'
import { useToasts } from '@/ui/toast'
import { useTaskRows } from '@/tasks/TaskRow'
import { BriefingTaskItem, useTodayTasks } from './parts'
import { tickedKey } from './format'
import { FOLD_MS, READ_MS } from './settle'

const task: BriefingTask = { id: 't1', kind: 'row', title: 'Revisar PR', pageId: 't1', source: 'Tasks', labels: [] }
const other: BriefingTask = { id: 't2', kind: 'row', title: 'Ligar', pageId: 't2', source: 'Tasks', labels: [] }
const tasks = (...list: BriefingTask[]): BriefingTasks => ({ overdue: [], today: list, noDate: [], more: 0 }) as BriefingTasks

const block = (id: string, extra: Partial<Block>): Block =>
  ({ id, type: 'page', parentId: null, props: {}, content: [], createdAt: 0, updatedAt: 0, trashedAt: null, ...extra }) as Block
const row = (id: string, done: boolean): Block =>
  block(id, {
    parentId: TASKS_DATABASE_ID,
    props: { title: [[id === 't1' ? 'Revisar PR' : 'Ligar']], values: done ? { [TASK_PROPS.done]: true } : {} }
  })

let latest: ReturnType<typeof useTodayTasks>
let reload: (list: BriefingTasks) => void
function Screen({ first }: { first: BriefingTasks }): JSX.Element {
  const [list, setList] = useState(first)
  reload = setList
  return <List list={list} />
}
function List({ list }: { list: BriefingTasks }): JSX.Element {
  latest = useTodayTasks(list, false)
  const rows = useTaskRows(latest.shown.map((item) => item.id))
  return (
    <ul>
      {latest.groups.flatMap((group) =>
        group.tasks.map((item) => (
          <BriefingTaskItem
            key={item.id}
            task={item}
            view={latest.views.get(item.id)}
            day="2026-10-30"
            today="2026-10-30"
            rows={rows}
            panel={null}
            onComplete={latest.complete}
            onReopen={latest.reopen}
            settling={latest.settling.get(tickedKey(item))}
            onOpen={() => undefined}
          />
        ))
      )}
    </ul>
  )
}

const flush = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
const undoCompleteTask = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  undoCompleteTask.mockReset().mockResolvedValue(undefined)
  ;(window as unknown as { api: unknown }).api = fakeApi({
    'blocks.getMany': [],
    'briefing.completeTask': { token: 'tok', next: null },
    'briefing.undoCompleteTask': undoCompleteTask
  })
  useToasts.setState({ toasts: [] })
  useHome.setState({ locale: 'en' })
})
afterEach(async () => {
  vi.useRealTimers()
  await cleanup()
})

describe('a ticked task on Today, with the store and the briefing moving on', () => {
  it('stays as a done row through the store refresh and the briefing reload, then goes', async () => {
    await act(async () => putBlocks([block(TASKS_DATABASE_ID, { type: 'database' }), row('t1', false), row('t2', false)]))
    const host = await render(<Screen first={tasks(task, other)} />)
    expect(host.querySelectorAll('li').length).toBe(2)
    await act(async () => latest.complete(task))
    // main wrote it: the store's row is done, then the briefing reloads without the task
    await act(async () => putBlocks([row('t1', true)]))
    await flush(600)
    await act(async () => void 0)
    await act(async () => reload(tasks(other)))
    expect(host.textContent).toContain('Revisar PR')
    expect(host.querySelectorAll('li').length).toBe(2)
    await flush(READ_MS - 700)
    expect(host.textContent).toContain('Revisar PR')
    await flush(100 + FOLD_MS)
    expect(host.textContent).not.toContain('Revisar PR')
    expect(host.textContent).toContain('Ligar')
  })
})
