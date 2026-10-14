import { describe, expect, it, vi } from 'vitest'
import { createFlusherRegistry } from './unload'

describe('createFlusherRegistry', () => {
  it('runs every flusher in the order they were added', () => {
    const calls: string[] = []
    const reg = createFlusherRegistry(() => undefined)
    reg.add(() => calls.push('editor'))
    reg.add(() => calls.push('cell'))
    reg.run()
    expect(calls).toEqual(['editor', 'cell'])
  })

  it('stops running a flusher once it is removed', () => {
    const flush = vi.fn()
    const reg = createFlusherRegistry(() => undefined)
    const remove = reg.add(flush)
    remove()
    remove()
    reg.run()
    expect(flush).not.toHaveBeenCalled()
    expect(reg.size).toBe(0)
  })

  it('keeps the same function added twice as two entries', () => {
    const flush = vi.fn()
    const reg = createFlusherRegistry(() => undefined)
    const first = reg.add(flush)
    reg.add(flush)
    first()
    reg.run()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('runs the rest when one flusher throws, and reports the error', () => {
    const onError = vi.fn()
    const later = vi.fn()
    const reg = createFlusherRegistry(onError)
    reg.add(() => {
      throw new Error('write failed')
    })
    reg.add(later)
    reg.run()
    expect(later).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'write failed' }))
  })

  it('skips a flusher removed by an earlier one during the same run', () => {
    const reg = createFlusherRegistry(() => undefined)
    const second = vi.fn()
    let removeSecond = (): void => undefined
    reg.add(() => removeSecond())
    removeSecond = reg.add(second)
    reg.run()
    expect(second).not.toHaveBeenCalled()
  })

  it('does not run a flusher added during the run until the next one', () => {
    const reg = createFlusherRegistry(() => undefined)
    const added = vi.fn()
    reg.add(() => {
      reg.add(added)
    })
    reg.run()
    expect(added).not.toHaveBeenCalled()
    reg.run()
    expect(added).toHaveBeenCalledTimes(1)
  })
})
