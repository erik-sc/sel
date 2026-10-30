// @vitest-environment happy-dom
// Ticking a task on Today: it stays, done, for a second and a half, then folds and goes; taking it
// back within that time cancels the fold; the toast names the task. The briefing calls are stood in for.
import { act } from 'react'
import type { JSX } from 'react'
import type { BriefingTask } from '@shared/briefing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@/a11y/testing'
import { useHome } from '@/home/store'
import { useToasts } from '@/ui/toast'
import { useCompleteTask, type Completing } from './complete'
import { tickedKey } from './format'
import { FOLD_MS, READ_MS } from './settle'

const task: BriefingTask = { id: 't1', kind: 'row', title: 'Revisar PR', pageId: 't1', source: 'Tasks' }
const key = tickedKey(task)

let latest: Completing
function Probe({ calm }: { calm: boolean }): JSX.Element {
  latest = useCompleteTask({ calm })
  return <p />
}

const completeTask = vi.fn()
const undoCompleteTask = vi.fn()
const flush = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  completeTask.mockReset().mockResolvedValue({ token: 'tok', next: null })
  undoCompleteTask.mockReset().mockResolvedValue(undefined)
  ;(window as unknown as { api: unknown }).api = { briefing: { completeTask, undoCompleteTask } }
  useToasts.setState({ toasts: [] })
  useHome.setState({ locale: 'en' })
})

afterEach(async () => {
  vi.useRealTimers()
  await cleanup()
})

describe('ticking a task on Today', () => {
  it('keeps it in place as done, folds it after 1.5 s, and then lets it go', async () => {
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    expect(latest.settling.get(key)).toBe('done')
    expect(latest.done.has(key)).toBe(false)
    await flush(READ_MS - 1)
    expect(latest.settling.get(key)).toBe('done')
    await flush(1)
    expect(latest.settling.get(key)).toBe('folding')
    await flush(FOLD_MS)
    expect(latest.settling.has(key)).toBe(false)
    expect(latest.done.has(key)).toBe(true)
  })

  it('names the task in the toast, in the language of the home', async () => {
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    await flush()
    expect(useToasts.getState().toasts.map((t) => [t.message, t.action?.label])).toEqual([['Done: Revisar PR', 'Undo']])
    useToasts.setState({ toasts: [] })
    await act(async () => useHome.setState({ locale: 'pt-BR' }))
    await act(async () => latest.complete({ ...task, id: 't2' }))
    await flush()
    expect(useToasts.getState().toasts.map((t) => [t.message, t.action?.label])).toEqual([['Feita: Revisar PR', 'Desfazer']])
  })

  it('cancels the fold when Undo comes within the wait', async () => {
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    await flush(1000)
    await act(async () => useToasts.getState().toasts[0].action?.run())
    await flush(0)
    expect(undoCompleteTask).toHaveBeenCalledWith('tok')
    expect(latest.settling.has(key)).toBe(false)
    await flush(10_000)
    expect(latest.done.has(key)).toBe(false)
    expect(latest.settling.has(key)).toBe(false)
  })

  it('cancels the fold when the done row is ticked again, and drops the toast', async () => {
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    await flush(1000)
    await act(async () => latest.reopen(task))
    await flush(0)
    expect(undoCompleteTask).toHaveBeenCalledWith('tok')
    expect(useToasts.getState().toasts).toEqual([])
    await flush(10_000)
    expect(latest.done.has(key)).toBe(false)
    expect(latest.settling.size).toBe(0)
  })

  it('starts the wait over when taking it back fails', async () => {
    undoCompleteTask.mockRejectedValue(new Error('no'))
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    await flush(500)
    await act(async () => useToasts.getState().toasts[0].action?.run())
    await flush(READ_MS + FOLD_MS)
    expect(latest.done.has(key)).toBe(true)
  })

  it('takes it back once when ticked twice, and the row does not vanish later', async () => {
    let fail = false
    undoCompleteTask.mockImplementation(() => (fail ? Promise.reject(new Error('used')) : Promise.resolve()))
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    await flush(0)
    await act(async () => {
      latest.reopen(task)
      latest.reopen(task)
    })
    fail = true
    await flush(0)
    expect(undoCompleteTask).toHaveBeenCalledTimes(1)
    await flush(10_000)
    expect(latest.done.has(key)).toBe(false)
    expect(latest.settling.size).toBe(0)
  })

  it('takes it back once when the checkbox and the toast Undo both fire', async () => {
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    await flush(0)
    const undo = useToasts.getState().toasts[0].action
    await act(async () => {
      latest.reopen(task)
      undo?.run()
    })
    await flush(10_000)
    expect(undoCompleteTask).toHaveBeenCalledTimes(1)
    expect(latest.done.has(key)).toBe(false)
    expect(latest.settling.size).toBe(0)
  })

  it('puts the row back when the task could not be done', async () => {
    completeTask.mockRejectedValue(new Error('no'))
    await render(<Probe calm />)
    await act(async () => latest.complete(task))
    await flush(0)
    expect(latest.settling.size).toBe(0)
    await flush(10_000)
    expect(latest.done.size).toBe(0)
  })

  it('lets it go at once where it is not calm (the calendar)', async () => {
    await render(<Probe calm={false} />)
    await act(async () => latest.complete(task))
    expect(latest.done.has(key)).toBe(true)
    expect(latest.settling.size).toBe(0)
  })
})
