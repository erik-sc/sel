import { describe, expect, it } from 'vitest'
import { allCommands, availableCommands, getCommand, isAvailable, registerCommand, registerCommands } from './registry'

const noop = (): void => undefined

describe('command registry', () => {
  it('adds and removes a command', () => {
    const remove = registerCommand({ id: 'test-a', title: 'A', run: noop })
    expect(getCommand('test-a')?.title).toBe('A')
    remove()
    expect(getCommand('test-a')).toBeUndefined()
  })

  it('replaces a command with the same id, and the old remover leaves the new one alone', () => {
    const removeOld = registerCommand({ id: 'test-b', title: 'Old', run: noop })
    const removeNew = registerCommand({ id: 'test-b', title: 'New', run: noop })
    removeOld()
    expect(getCommand('test-b')?.title).toBe('New')
    removeNew()
    expect(getCommand('test-b')).toBeUndefined()
  })

  it('keeps registration order and filters by availability', () => {
    let on = false
    const remove = registerCommands([
      { id: 'test-c', title: 'C', run: noop },
      { id: 'test-d', title: 'D', when: () => on, run: noop },
      {
        id: 'test-e',
        title: 'E',
        when: () => {
          throw new Error('not ready')
        },
        run: noop
      }
    ])
    expect(allCommands().map((c) => c.id)).toEqual(['test-c', 'test-d', 'test-e'])
    expect(availableCommands().map((c) => c.id)).toEqual(['test-c'])
    on = true
    expect(availableCommands().map((c) => c.id)).toEqual(['test-c', 'test-d'])
    expect(isAvailable(getCommand('test-e')!)).toBe(false)
    remove()
    expect(allCommands()).toEqual([])
  })
})
