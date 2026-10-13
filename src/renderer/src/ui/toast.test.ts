import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissToast, notifyError, toast, useToasts } from './toast'

const messages = (): string[] => useToasts.getState().toasts.map((item) => item.message)

beforeEach(() => {
  vi.useFakeTimers()
  useToasts.setState({ toasts: [] })
})

afterEach(() => {
  for (const item of useToasts.getState().toasts) dismissToast(item.id)
  vi.useRealTimers()
})

describe('toast', () => {
  it('shows a message and removes it after its duration', () => {
    toast('Saved')
    expect(useToasts.getState().toasts).toMatchObject([{ kind: 'info', message: 'Saved' }])
    vi.advanceTimersByTime(3999)
    expect(messages()).toEqual(['Saved'])
    vi.advanceTimersByTime(1)
    expect(messages()).toEqual([])
  })

  it('keeps errors longer, and a toast with duration 0 until dismissed', () => {
    toast('Failed', { kind: 'error' })
    const sticky = toast('Sticky', { duration: 0 })
    vi.advanceTimersByTime(6999)
    expect(messages()).toEqual(['Failed', 'Sticky'])
    vi.advanceTimersByTime(60_000)
    expect(messages()).toEqual(['Sticky'])
    dismissToast(sticky)
    expect(messages()).toEqual([])
  })

  it('does not stack a message that is already showing; it restarts its timer', () => {
    const first = toast('Could not save.', { kind: 'error' })
    vi.advanceTimersByTime(5000)
    expect(toast('Could not save.', { kind: 'error' })).toBe(first)
    expect(messages()).toEqual(['Could not save.'])
    vi.advanceTimersByTime(5000)
    expect(messages()).toEqual(['Could not save.'])
    vi.advanceTimersByTime(2000)
    expect(messages()).toEqual([])
    // The same words with another kind are another toast.
    toast('Done')
    toast('Done', { kind: 'success' })
    expect(messages()).toEqual(['Done', 'Done'])
  })

  it('shows at most four, dropping the oldest', () => {
    for (let i = 1; i <= 6; i++) toast(`m${i}`)
    expect(messages()).toEqual(['m3', 'm4', 'm5', 'm6'])
    vi.advanceTimersByTime(4000)
    expect(messages()).toEqual([])
  })

  it('carries an action, stays longer for it, and keeps the newest one for a repeated message', () => {
    const first = vi.fn()
    const second = vi.fn()
    const id = toast('Restored version from 14:32', { action: { label: 'Undo', run: first } })
    expect(useToasts.getState().toasts[0].action?.label).toBe('Undo')
    vi.advanceTimersByTime(9000)
    expect(messages()).toEqual(['Restored version from 14:32'])
    expect(toast('Restored version from 14:32', { action: { label: 'Undo', run: second } })).toBe(id)
    useToasts.getState().toasts[0].action?.run()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(messages()).toEqual([])
  })

  it('caps the length of a message', () => {
    toast('x'.repeat(5000))
    expect(messages()[0]).toHaveLength(300)
  })

  it('dismissing an unknown id changes nothing', () => {
    toast('Here')
    const before = useToasts.getState()
    dismissToast('nope')
    expect(useToasts.getState()).toBe(before)
  })

  it('notifyError logs the detail and shows only the message', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = new Error('SQLITE_FULL at /secret/path')
    notifyError('Could not save the page.', error)
    expect(log).toHaveBeenCalledWith('Could not save the page.', error)
    expect(useToasts.getState().toasts).toMatchObject([{ kind: 'error', message: 'Could not save the page.' }])
    log.mockRestore()
  })
})
