// @vitest-environment happy-dom
// A list of task rows driven from the keyboard alone: one Tab stop, arrows, the keys of a focused
// row (rename with the parser, priority, a field's editor, complete, delete, the menu), and
// nothing serious for axe. The writes are stood in for: what is checked is what the row asks.
import { act } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from '@/a11y/testing'
import type { TaskView } from './model'

const calls = vi.hoisted(() => ({
  rename: [] as unknown[][],
  priority: [] as unknown[][],
  deleted: [] as string[],
  opened: [] as unknown[][],
  editor: [] as string[],
  next: [] as unknown[][]
}))

vi.mock('./edit', () => ({
  renameTask: (...args: unknown[]) => {
    calls.rename.push(args)
    return true
  },
  setPriority: (...args: unknown[]) => void calls.priority.push(args),
  deleteTask: (id: string) => void calls.deleted.push(id)
}))
vi.mock('./lazy', () => ({
  preloadTaskEditors: () => undefined,
  TaskFieldPopover: ({ field }: { field: string }) => {
    calls.editor.push(field)
    return <div data-editor={field} />
  }
}))
vi.mock('./projects', () => ({ setNextAction: (...args: unknown[]) => void calls.next.push(args) }))
vi.mock('@/store/tabs', () => ({ openPage: (...args: unknown[]) => void calls.opened.push(args) }))

const { TaskRow, useTaskRows } = await import('./TaskRow')

const task = (id: string, title: string, extra: Partial<TaskView> = {}): TaskView => ({
  id,
  title,
  done: false,
  due: null,
  priority: null,
  project: null,
  labels: [],
  recurrence: null,
  remind: null,
  parent: null,
  ...extra
})

const TASKS: TaskView[] = [
  task('a', 'Call mum', { due: '2026-10-16T09:30', priority: 1, project: { id: 'home', name: 'Home', color: 'green' } }),
  task('b', 'Pay rent', { recurrence: { rule: 'FREQ=MONTHLY;BYMONTHDAY=5', from: 'due', text: 'monthly' } }),
  task('c', 'Read', { labels: [{ id: 'calm', name: 'calm', color: 'blue' }] })
]

function List({ onToggle, onOpen }: { onToggle: (task: TaskView) => void; onOpen: (task: TaskView) => void }): JSX.Element {
  const rows = useTaskRows(TASKS.map((item) => item.id))
  return (
    <ul {...rows.listProps}>
      {TASKS.map((item) => (
        <TaskRow
          key={item.id}
          task={item}
          today="2026-10-15"
          tabStop={rows.stop === item.id}
          onToggle={onToggle}
          onOpen={onOpen}
          onLeave={rows.leave}
        />
      ))}
    </ul>
  )
}

const rowOf = (id: string): HTMLElement => document.querySelector(`[data-task-row][data-task-id="${id}"]`) as HTMLElement

async function focus(el: HTMLElement): Promise<void> {
  await act(async () => el.focus())
}

/** Types into a React-controlled input. */
async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'blocks.getMany': [] })
})

beforeEach(() => {
  calls.rename.length = 0
  calls.next.length = 0
  calls.priority.length = 0
  calls.deleted.length = 0
  calls.opened.length = 0
  calls.editor.length = 0
})

afterEach(cleanup)

describe('a list of task rows', () => {
  it('is one Tab stop, named rows with their chips, and axe finds nothing serious', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    expect(TASKS.map((item) => rowOf(item.id).tabIndex)).toEqual([0, -1, -1])
    const first = rowOf('a')
    expect(first.getAttribute('aria-label')).toContain('Call mum')
    expect(first.getAttribute('aria-label')).toContain('#Home')
    const chips = [...first.querySelectorAll('.task-chip')].map((chip) => chip.textContent)
    // The time is written the way the system's locale writes times.
    expect(chips).toEqual([expect.stringMatching(/^Tomorrow 0?9:30/), 'P1', '#Home'])
    expect(rowOf('b').querySelector('.task-chip.is-repeat')?.textContent).toBe('↻')
    // Every button inside a row is for the pointer: the row has keys for them.
    for (const button of document.querySelectorAll('[data-task-row] button')) expect((button as HTMLElement).tabIndex).toBe(-1)
    expect(await seriousViolations()).toEqual([])
  })

  it('moves along with the arrows, without wrapping, and keeps the stop on the row focused last', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    await focus(rowOf('a'))
    await press(rowOf('a'), 'ArrowDown')
    expect(document.activeElement).toBe(rowOf('b'))
    expect(rowOf('b').tabIndex).toBe(0)
    expect(rowOf('a').tabIndex).toBe(-1)
    await press(rowOf('b'), 'End')
    expect(document.activeElement).toBe(rowOf('c'))
    await press(rowOf('c'), 'ArrowDown')
    expect(document.activeElement).toBe(rowOf('c'))
    await press(rowOf('c'), 'Home')
    expect(document.activeElement).toBe(rowOf('a'))
  })

  it('renames with F2, reading the new name as the quick add does, and gives the focus back', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    await focus(rowOf('b'))
    await press(rowOf('b'), 'F2')
    const input = rowOf('b').querySelector('input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Pay rent')
    await type(input, 'Pay rent amanhã p1')
    // The words the parser read are marked, and what they will set is said.
    expect([...rowOf('b').querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['amanhã', 'p1'])
    expect(rowOf('b').querySelector('.task-title-hint')?.textContent).toContain('P1')
    await press(input, 'Enter')
    expect(calls.rename).toEqual([['b', 'Pay rent amanhã p1', []]])
    expect(rowOf('b').querySelector('input')).toBeNull()
    expect(document.activeElement).toBe(rowOf('b'))
  })

  it('puts the old name back on Escape', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    await focus(rowOf('c'))
    await press(rowOf('c'), 'F2')
    const input = rowOf('c').querySelector('input') as HTMLInputElement
    await type(input, 'Something else')
    await press(input, 'Escape')
    expect(calls.rename).toEqual([])
    expect(document.activeElement).toBe(rowOf('c'))
  })

  it('sets a priority with 1–4, and the same one again takes it away', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    await focus(rowOf('b'))
    await press(rowOf('b'), '3')
    await press(rowOf('a'), '1')
    expect(calls.priority).toEqual([
      ['b', 3],
      ['a', null]
    ])
  })

  it('opens the editor of a field with its key', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    for (const [key, field] of [
      ['d', 'date'],
      ['r', 'repeat'],
      ['#', 'project'],
      ['@', 'labels'],
      ['l', 'remind']
    ]) {
      await press(rowOf('a'), key)
      expect(document.querySelector('[data-editor]')?.getAttribute('data-editor')).toBe(field)
    }
  })

  it('opens the editor from a chip', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    await act(async () => (rowOf('a').querySelector('.task-chip.is-project') as HTMLElement).click())
    expect(document.querySelector('[data-editor]')?.getAttribute('data-editor')).toBe('project')
  })

  it('completes with Space and deletes with Delete, handing the focus to the next row', async () => {
    const toggled: string[] = []
    await render(<List onToggle={(item) => toggled.push(item.id)} onOpen={() => undefined} />)
    await focus(rowOf('a'))
    await press(rowOf('a'), ' ')
    expect(toggled).toEqual(['a'])
    expect(document.activeElement).toBe(rowOf('b'))
    await press(rowOf('b'), 'Delete')
    expect(calls.deleted).toEqual(['b'])
    expect(document.activeElement).toBe(rowOf('c'))
  })

  it('opens the panel with Enter, the page in a new tab with Ctrl+Enter or Ctrl+click', async () => {
    const opened: string[] = []
    await render(<List onToggle={() => undefined} onOpen={(item) => opened.push(item.id)} />)
    await press(rowOf('c'), 'Enter')
    expect(opened).toEqual(['c'])
    await press(rowOf('c'), 'Enter', { ctrlKey: true })
    await act(async () => rowOf('a').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })))
    expect(calls.opened).toEqual([
      ['c', { newTab: true }],
      ['a', { newTab: true }]
    ])
    await act(async () => rowOf('b').click())
    expect(opened).toEqual(['c', 'b'])
  })

  it('opens its menu with Shift+F10, with every action and its key', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    await focus(rowOf('a'))
    await press(rowOf('a'), 'F10', { shiftKey: true })
    await settle()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    expect(menu).not.toBeNull()
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.querySelector('.ui-menu-label')?.textContent)
    expect(items).toEqual([
      'Date',
      'Repeat',
      'Priority',
      'Project',
      'Labels',
      'Reminder',
      'Make next action',
      'Rename',
      'Open page',
      'Open in new tab',
      'Delete'
    ])
    expect(document.activeElement).toBe(menu)
    // Down to "Delete" (the last), and Enter.
    await press(menu, 'End')
    await press(menu, 'Enter')
    expect(calls.deleted).toEqual(['a'])
  })

  it('makes a task of a project its next action from the menu, and offers it only then', async () => {
    await render(<List onToggle={() => undefined} onOpen={() => undefined} />)
    await focus(rowOf('a'))
    await press(rowOf('a'), 'F10', { shiftKey: true })
    await settle()
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((each) =>
      each.textContent?.includes('Make next action')
    )
    await act(async () => item?.click())
    expect(calls.next).toEqual([['home', 'a']])
    await press(document.querySelector('[role="menu"]') ?? document.body, 'Escape')
    await focus(rowOf('b'))
    await press(rowOf('b'), 'F10', { shiftKey: true })
    await settle()
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent ?? '')
    expect(labels.some((label) => label.includes('Make next action'))).toBe(false)
  })
})
