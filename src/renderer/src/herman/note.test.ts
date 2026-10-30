import { describe, expect, it } from 'vitest'
import type { HermanCommand, HermanNudge } from '@shared/herman'
import { bracketed, datedTasks, offeredVerb } from './note'

const ask: HermanNudge['action'] = { label: 'Ask Herman', command: { type: 'ask', question: 'What?' } }
const today: HermanNudge['action'] = { label: 'Open Today', command: { type: 'open-today' } }

describe('the note’s buttons', () => {
  it('draws a verb in brackets', () => {
    expect(bracketed('Open Today')).toBe('[ Open Today ]')
  })

  it('offers a question for the conversation only while AI is on', () => {
    expect(offeredVerb(ask, true)).toBe(ask)
    expect(offeredVerb(ask, false)).toBeUndefined()
    expect(offeredVerb(today, false)).toBe(today)
    expect(offeredVerb(undefined, true)).toBeUndefined()
  })

  it('takes the tasks to date once each, and only those the store knows', () => {
    const command: HermanCommand = { type: 'date-tasks', pageIds: ['a', 'b', 'a', 'gone'], day: 'tomorrow' }
    expect(datedTasks(command, (id) => id !== 'gone')).toEqual(['a', 'b'])
    expect(datedTasks({ type: 'open-today' }, () => true)).toEqual([])
  })
})
