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
  next: [] as unknown[][],
  many: [] as unknown[][],
  popover: [] as unknown[][]
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
const { rowSelectionOf, useTaskSelection } = await import('./useTaskSelection')

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
  calls.many.length = 0
  calls.popover.length = 0
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

/** A list wired the way the Tasks screen wires its rows to a selection. */
function PickList({ onOpen }: { onOpen: (task: TaskView) => void }): JSX.Element {
  const order = TASKS.map((item) => item.id)
  const rows = useTaskRows(order)
  const picked = useTaskSelection(order)
  return (
    <ul
      {...rows.listProps}
      onKeyDown={(event) => {
        rows.listProps.onKeyDown(event)
        picked.onListKey(event)
      }}
    >
      {TASKS.map((item) => (
        <TaskRow
          key={item.id}
          task={item}
          today="2026-10-15"
          tabStop={rows.stop === item.id}
          onToggle={() => undefined}
          onOpen={onOpen}
          onLeave={rows.leave}
          selection={rowSelectionOf(picked, item.id, rows.stop, (action, anchor) => {
            if (action.kind === 'date' || action.kind === 'project')
              calls.popover.push([action.kind, picked.selection.ids, anchor.dataset.taskId])
            else if (action.kind === 'priority') calls.many.push(['priority', picked.selection.ids, action.level])
            else if (action.kind === 'toggle') calls.many.push(['done', picked.selection.ids])
          })}
        />
      ))}
      <li data-picked>{picked.count}</li>
    </ul>
  )
}

const selectedIds = (): string[] =>
  [...document.querySelectorAll('[data-task-row].is-selected')].map((el) => (el as HTMLElement).dataset.taskId ?? '')

async function pickThree(): Promise<void> {
  await focus(rowOf('a'))
  await press(rowOf('a'), 'ArrowDown', { shiftKey: true })
  await press(rowOf('b'), 'ArrowDown', { shiftKey: true })
}

describe('a selection in a list of task rows', () => {
  it('grows with Shift+Down from the focused row, marks the rows and keeps one Tab stop', async () => {
    await render(<PickList onOpen={() => undefined} />)
    await pickThree()
    expect(selectedIds()).toEqual(['a', 'b', 'c'])
    expect(document.activeElement).toBe(rowOf('c'))
    // More than colour: the tick, and the word for a screen reader.
    expect(rowOf('b').querySelector('.task-selected-mark')).not.toBeNull()
    expect(rowOf('b').getAttribute('aria-label')).toContain('selected')
    expect(document.querySelector('[data-announcer]')?.textContent).toBeDefined()
    expect(TASKS.map((item) => rowOf(item.id).tabIndex).filter((index) => index === 0)).toHaveLength(1)
    expect(await seriousViolations()).toEqual([])
  })

  it('selects a range on Shift+click, and a plain click clears it and opens the panel', async () => {
    const opened: string[] = []
    await render(<PickList onOpen={(item) => opened.push(item.id)} />)
    await focus(rowOf('a'))
    await act(async () => rowOf('c').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    expect(selectedIds()).toEqual(['a', 'b', 'c'])
    expect(opened).toEqual([])
    await act(async () => rowOf('b').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(opened).toEqual(['b'])
    expect(selectedIds()).toEqual([])
  })

  it('clears on Escape', async () => {
    await render(<PickList onOpen={() => undefined} />)
    await pickThree()
    await press(rowOf('c'), 'Escape')
    expect(selectedIds()).toEqual([])
  })

  it('lets go of the selection when the plain arrows move along', async () => {
    await render(<PickList onOpen={() => undefined} />)
    await pickThree()
    await press(rowOf('c'), 'ArrowUp')
    expect(document.activeElement).toBe(rowOf('b'))
    expect(selectedIds()).toEqual([])
  })

  it('sends D, # and 1–4 and Space to all the selected rows', async () => {
    await render(<PickList onOpen={() => undefined} />)
    await pickThree()
    await press(rowOf('c'), 'd')
    await press(rowOf('c'), '#', { shiftKey: true })
    await press(rowOf('c'), '2')
    await press(rowOf('c'), ' ')
    expect(calls.popover).toEqual([
      ['date', ['a', 'b', 'c'], 'c'],
      ['project', ['a', 'b', 'c'], 'c']
    ])
    expect(calls.many).toEqual([
      ['priority', ['a', 'b', 'c'], 2],
      ['done', ['a', 'b', 'c']]
    ])
    // Nothing of the single-task path ran.
    expect(calls.priority).toEqual([])
    expect(calls.editor).toEqual([])
  })

  it('does nothing for R, L, @, F2 and Delete with several selected', async () => {
    await render(<PickList onOpen={() => undefined} />)
    await pickThree()
    for (const [k, init] of [['r'], ['l'], ['@', { shiftKey: true }], ['F2'], ['Delete']] as [string, KeyboardEventInit?][]) {
      await press(rowOf('c'), k, init)
    }
    expect(calls.editor).toEqual([])
    expect(calls.deleted).toEqual([])
    expect(document.querySelector('input')).toBeNull()
    expect(selectedIds()).toEqual(['a', 'b', 'c'])
  })

  it('keeps the keys of one row when only one is selected, or the focus is outside the selection', async () => {
    await render(<PickList onOpen={() => undefined} />)
    await focus(rowOf('a'))
    await press(rowOf('a'), 'ArrowDown', { shiftKey: true })
    await focus(rowOf('c'))
    await press(rowOf('c'), '3')
    expect(calls.priority).toEqual([['c', 3]])
    expect(calls.many).toEqual([])
    await press(rowOf('c'), 'Delete')
    expect(calls.deleted).toEqual(['c'])
  })

  it('opens the focused row with Enter even with several selected', async () => {
    const opened: string[] = []
    await render(<PickList onOpen={(item) => opened.push(item.id)} />)
    await pickThree()
    await press(rowOf('c'), 'Enter')
    expect(opened).toEqual(['c'])
  })

  it('offers "Select all in this list" in the row menu', async () => {
    await render(<PickList onOpen={() => undefined} />)
    await focus(rowOf('b'))
    await press(rowOf('b'), 'F10', { shiftKey: true })
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('Select all in this list'))
    expect(item).toBeDefined()
    await act(async () => (item as HTMLElement).click())
    expect(selectedIds()).toEqual(['a', 'b', 'c'])
  })
})

describe('the empty chips of the Inbox', () => {
  const inbox = task('i', 'Book dentist')
  const row = (extra: { leaving?: boolean } = {}): JSX.Element => (
    <ul>
      <TaskRow
        task={inbox}
        today="2026-10-15"
        tabStop
        onToggle={() => undefined}
        onOpen={() => undefined}
        emptyChips={['date', 'priority', 'project']}
        {...extra}
      />
    </ul>
  )

  it('carry the key that works on the focused row, hidden from the screen reader', async () => {
    await render(row())
    const chips = [...rowOf('i').querySelectorAll('.task-chip.is-empty')]
    expect(chips.map((chip) => chip.querySelector('kbd')?.textContent)).toEqual(['D', '1–4', '#'])
    expect(chips.map((chip) => chip.textContent)).toEqual(['D+ date', '1–4+ priority', '#+ project'])
    for (const chip of chips) expect(chip.querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true')
    // The chip is still named by its field alone.
    expect(chips[2].getAttribute('aria-label')).toBe('Project: none')
  })

  it('open the editor with the very keys they show', async () => {
    await render(row())
    await press(rowOf('i'), '#')
    expect(document.querySelector('[data-editor]')?.getAttribute('data-editor')).toBe('project')
    await press(rowOf('i'), 'd')
    expect(document.querySelector('[data-editor]')?.getAttribute('data-editor')).toBe('date')
  })

  it('fade out of the list when the row is leaving', async () => {
    await render(row({ leaving: true }))
    expect(rowOf('i').classList.contains('is-leaving')).toBe(true)
  })
})
