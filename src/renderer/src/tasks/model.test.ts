import { describe, expect, it } from 'vitest'
import type { BriefingTask } from '@shared/briefing'
import { nextPriority, priorityOf, priorityValue, rowKeyAction, viewOfBriefing } from './model'

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta
})

describe('the keys of a focused task row', () => {
  it('open, rename, complete and delete', () => {
    expect(rowKeyAction(key('Enter'))).toEqual({ kind: 'open', newTab: false })
    expect(rowKeyAction(key('Enter', { ctrl: true }))).toEqual({ kind: 'open', newTab: true })
    expect(rowKeyAction(key('F2'))).toEqual({ kind: 'rename' })
    expect(rowKeyAction(key(' '))).toEqual({ kind: 'toggle' })
    expect(rowKeyAction(key('Delete'))).toEqual({ kind: 'delete' })
  })

  it('open the editor of a field', () => {
    expect(rowKeyAction(key('d'))).toEqual({ kind: 'edit', field: 'date' })
    expect(rowKeyAction(key('D'))).toEqual({ kind: 'edit', field: 'date' })
    expect(rowKeyAction(key('r'))).toEqual({ kind: 'edit', field: 'repeat' })
    expect(rowKeyAction(key('l'))).toEqual({ kind: 'edit', field: 'remind' })
    // Typed with Shift on most layouts: read as the sign, whatever key makes it.
    expect(rowKeyAction(key('#', { shift: true }))).toEqual({ kind: 'edit', field: 'project' })
    expect(rowKeyAction(key('@', { shift: true }))).toEqual({ kind: 'edit', field: 'labels' })
  })

  it('set a priority with 1 to 4', () => {
    for (const level of [1, 2, 3, 4] as const) expect(rowKeyAction(key(String(level)))).toEqual({ kind: 'priority', level })
    expect(rowKeyAction(key('5'))).toBeNull()
    expect(rowKeyAction(key('0'))).toBeNull()
  })

  it('leave the arrows, Tab and the app shortcuts alone', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab', 'Escape', 'q', 'x']) expect(rowKeyAction(key(k))).toBeNull()
    expect(rowKeyAction(key('d', { ctrl: true }))).toBeNull()
    expect(rowKeyAction(key('1', { ctrl: true }))).toBeNull()
    expect(rowKeyAction(key('d', { alt: true }))).toBeNull()
    expect(rowKeyAction(key('F2', { shift: true }))).toBeNull()
    expect(rowKeyAction(key('D', { shift: true }))).toBeNull()
  })
})

describe('priorities', () => {
  it('tell no priority from P4', () => {
    expect(priorityOf('tasks.p4')).toBe(4)
    expect(priorityOf(undefined)).toBeNull()
    expect(priorityOf('someday')).toBeNull()
    expect(priorityValue(4)).toBe('tasks.p4')
    expect(priorityValue(null)).toBeNull()
  })

  it('picked again from the keyboard, take it away', () => {
    expect(nextPriority(null, 2)).toBe(2)
    expect(nextPriority(1, 2)).toBe(2)
    expect(nextPriority(2, 2)).toBeNull()
  })
})

describe('a task of the Today screen as a row draws it', () => {
  const base: BriefingTask = { id: 't', kind: 'row', title: 'Call', pageId: 't', source: 'Tasks', due: '2026-10-15', time: '09:30' }

  it('only for the built-in Tasks database (its tasks carry labels)', () => {
    expect(viewOfBriefing(base)).toBeNull()
    expect(viewOfBriefing({ ...base, kind: 'todo', labels: [] })).toBeNull()
    expect(
      viewOfBriefing({
        ...base,
        labels: [{ id: 'calls', name: 'calls', color: 'blue' }],
        project: { id: 'home', name: 'Home', color: 'green' },
        priority: { id: 'tasks.p2', name: 'P2', color: 'orange' },
        recurrence: { rule: 'FREQ=DAILY', from: 'due', text: 'daily' }
      })
    ).toMatchObject({
      id: 't',
      due: '2026-10-15T09:30',
      priority: 2,
      project: { name: 'Home' },
      labels: [{ name: 'calls' }],
      recurrence: { rule: 'FREQ=DAILY' }
    })
  })

  it('with no priority when none was chosen', () => {
    expect(viewOfBriefing({ ...base, labels: [] })?.priority).toBeNull()
  })
})
