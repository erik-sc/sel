import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettler, FOLD_MS, foldDuration, READ_MS, type Phase } from './settle'

describe('a ticked task settling', () => {
  let heard: [string, Phase][]
  beforeEach(() => {
    vi.useFakeTimers()
    heard = []
  })
  afterEach(() => vi.useRealTimers())
  const settler = (fold = () => FOLD_MS) => createSettler((key, phase) => heard.push([key, phase]), fold)

  it('stays whole for a second and a half, folds, and is gone', () => {
    settler().start('a')
    vi.advanceTimersByTime(READ_MS - 1)
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1)
    expect(heard).toEqual([['a', 'folding']])
    vi.advanceTimersByTime(FOLD_MS - 1)
    expect(heard).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(heard).toEqual([
      ['a', 'folding'],
      ['a', 'gone']
    ])
  })

  it('is cancelled by taking the task back, before the fold or during it', () => {
    const s = settler()
    s.start('a')
    vi.advanceTimersByTime(READ_MS - 100)
    s.cancel('a')
    vi.advanceTimersByTime(10_000)
    expect(heard).toEqual([])
    s.start('a')
    vi.advanceTimersByTime(READ_MS + 10)
    s.cancel('a')
    vi.advanceTimersByTime(10_000)
    expect(heard).toEqual([['a', 'folding']])
  })

  it('keeps each task on its own clock, and starting again restarts the wait', () => {
    const s = settler()
    s.start('a')
    vi.advanceTimersByTime(1000)
    s.start('b')
    s.start('a')
    vi.advanceTimersByTime(READ_MS)
    expect(heard).toEqual([
      ['b', 'folding'],
      ['a', 'folding']
    ])
    s.cancel('b')
    s.dispose()
    vi.advanceTimersByTime(10_000)
    expect(heard).toHaveLength(2)
  })

  it('folds in no time when motion is reduced, after the same wait', () => {
    expect(foldDuration(true)).toBe(0)
    expect(foldDuration(false)).toBe(FOLD_MS)
    settler(() => foldDuration(true)).start('a')
    vi.advanceTimersByTime(READ_MS - 1)
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1)
    expect(heard).toEqual([['a', 'folding']])
    vi.advanceTimersByTime(1)
    expect(heard).toEqual([
      ['a', 'folding'],
      ['a', 'gone']
    ])
  })
})
