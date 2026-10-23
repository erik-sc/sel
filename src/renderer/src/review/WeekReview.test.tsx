// @vitest-environment happy-dom
// The weekly review walked as a person would: the step marks and Next/Back with the mouse, the
// keys on the refine walk inside it, the actions on what slid, three choices for the week to come,
// and the close. Every step is checked with axe.
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '@shared/tasks/projects'
import { cleanup, fakeApi, press, render, seriousViolations } from '@/a11y/testing'
import type { TaskItem } from '@/tasks/lists'

const calls = vi.hoisted(() => ({
  setDue: vi.fn(),
  deleteTask: vi.fn(),
  setPriority: vi.fn(),
  setNextAction: vi.fn(),
  updateMilestone: vi.fn(),
  saveWeekFocus: vi.fn()
}))

vi.mock('@/tasks/edit', () => ({
  setDue: calls.setDue,
  deleteTask: calls.deleteTask,
  setPriority: calls.setPriority,
  renameTask: () => true
}))
vi.mock('@/tasks/projects', () => ({ setNextAction: calls.setNextAction, updateMilestone: calls.updateMilestone }))
vi.mock('@/tasks/lazy', () => ({ preloadTaskEditors: () => undefined, TaskFieldPopover: () => null }))
vi.mock('./edit', () => ({ saveWeekFocus: calls.saveWeekFocus }))

const { WeekReview } = await import('./WeekReview')

const WORK = { id: 'p-work', name: 'Work', color: 'blue' }

let order = 0
const task = (id: string, extra: Partial<TaskItem> = {}): TaskItem =>
  ({
    id,
    title: id,
    done: false,
    due: null,
    priority: null,
    project: null,
    labels: [],
    recurrence: null,
    remind: null,
    parent: null,
    completedAt: null,
    recurring: false,
    row: {} as TaskItem['row'],
    order: order++,
    createdAt: order,
    ...extra
  }) as TaskItem

// Friday 23 October 2026: the week of the 19th is closed, the week of the 26th planned.
const TODAY = '2026-10-23'
const TASKS = [
  task('Shipped it', { done: true, project: WORK, completedAt: '2026-10-21T16:00' }),
  task('Pay rent', { due: '2026-10-20', project: WORK, priority: 2 }),
  task('Call mum'),
  task('Read'),
  task('Plan trip', { project: WORK, priority: 1 }),
  task('Garden', { priority: 3, project: WORK, due: '2026-10-29' })
]
const PROJECTS: ProjectSummary[] = [
  {
    id: WORK.id,
    name: WORK.name,
    color: WORK.color,
    objective: 'Ship the thing',
    next: null,
    suggestion: { id: 'Plan trip', title: 'Plan trip' },
    milestones: [{ id: 'm1', title: 'Beta', date: '2026-10-10', done: false }],
    done: 1,
    total: 4,
    needsNext: true
  }
]

const step = (): string => document.querySelector('.review-title')?.textContent ?? ''
const button = (text: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}
const click = async (el: HTMLElement): Promise<void> => act(async () => el.click())

const show = (): Promise<HTMLElement> =>
  render(
    <WeekReview
      today={TODAY}
      tasks={TASKS}
      projects={PROJECTS}
      edited={[{ id: 'page-1', title: 'Meeting notes' }]}
      activity={{ days: 4, focus: 2 }}
      storedWeek={undefined}
      onOpenPage={() => undefined}
      onOpenProject={() => undefined}
      onOpenToday={() => undefined}
    />
  )

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'blocks.getMany': [] })
})

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockClear()
})

afterEach(cleanup)

describe('the weekly review', () => {
  it('shows what got done and the pages edited, with the log’s line and no score', async () => {
    await show()
    expect(document.querySelector('.review-range')?.textContent).toBe('Oct 19 – 25')
    expect(step()).toBe('What got done')
    const text = document.body.textContent ?? ''
    expect(text).toContain('Shipped it')
    expect(text).toContain('Meeting notes')
    expect(text).toContain('Something happened on 4 days · 2 focus sessions')
    expect(text).not.toMatch(/streak|score|%/i)
    expect(await seriousViolations()).toEqual([])
  })

  it('walks every step with Next and Back, and jumps with the step marks', async () => {
    await show()
    const seen = [step()]
    for (let i = 0; i < 5; i++) {
      await click(button('Next →'))
      seen.push(step())
      expect(document.activeElement).toBe(document.querySelector('.review-title'))
      expect(await seriousViolations(), seen[seen.length - 1]).toEqual([])
    }
    expect(seen).toEqual(['What got done', 'What slid', 'The Inbox', 'Projects', 'The week to come', 'The week, closed'])
    await click(button('← Back'))
    expect(step()).toBe('The week to come')
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Step 2 of 6: Slid"]') as HTMLButtonElement)
    expect(step()).toBe('What slid')
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('Slid')
  })

  it('moves what slid to next week, drops its date, or deletes it', async () => {
    await show()
    await click(button('Next →'))
    const rows = [...document.querySelectorAll('.review-task')]
    expect(rows.map((row) => row.querySelector('.review-task-title')?.textContent)).toEqual(['Pay rent'])
    await click(button('Move to next week'))
    expect(calls.setDue).toHaveBeenCalledWith('Pay rent', { start: '2026-10-26' })
    await click(button('No date'))
    expect(calls.setDue).toHaveBeenLastCalledWith('Pay rent', null)
    await click(button('Delete'))
    expect(calls.deleteTask).toHaveBeenCalledWith('Pay rent')
  })

  it('refines the Inbox with the refine walk and its keys, then comes back to the step', async () => {
    await show()
    await click(button('Next →'))
    await click(button('Next →'))
    expect(document.body.textContent).toContain('2 tasks in the Inbox to refine.')
    await click(button('Refine them'))
    expect(document.querySelector('.refine-progress')?.textContent).toMatch(/^1 of 2/)
    await press(document.body, 'Enter')
    expect(document.querySelector('.refine-progress')?.textContent).toMatch(/^2 of 2/)
    await press(document.body, '1')
    expect(calls.setPriority).toHaveBeenCalledWith('Read', 1)
    await press(document.body, 'Escape')
    expect(document.querySelector('.refine')).toBeNull()
    expect(step()).toBe('The Inbox')
  })

  it('gives a project a next action and a late milestone a new date', async () => {
    await show()
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Step 4 of 6: Projects"]') as HTMLButtonElement)
    const select = document.querySelector<HTMLSelectElement>('.review-select') as HTMLSelectElement
    // The suggestion comes first.
    expect([...select.options].map((option) => option.value)).toEqual(['', 'Plan trip', 'Pay rent', 'Garden'])
    await act(async () => {
      select.value = 'Plan trip'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(calls.setNextAction).toHaveBeenCalledWith('p-work', 'Plan trip')
    await click(button('Mark done'))
    expect(calls.updateMilestone).toHaveBeenCalledWith('p-work', 'm1', { done: true })
  })

  it('chooses three things for the week to come, refuses a fourth, and keeps a note', async () => {
    await show()
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Step 5 of 6: Next week"]') as HTMLButtonElement)
    const box = (title: string): HTMLInputElement =>
      [...document.querySelectorAll('.review-candidate')]
        .find((item) => item.querySelector('.review-task-title')?.textContent === title)
        ?.querySelector('input') as HTMLInputElement
    for (const title of ['Garden', 'Plan trip', 'Read']) await click(box(title))
    expect(calls.saveWeekFocus).toHaveBeenLastCalledWith('2026-10-26', ['Garden', 'Plan trip', 'Read'], '', TODAY)
    expect(document.body.textContent).toContain('3 of 3 chosen')
    expect(box('Call mum').disabled).toBe(true)
    const note = document.querySelector<HTMLTextAreaElement>('.review-textarea') as HTMLTextAreaElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      set?.call(note, 'Fewer meetings')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Next →'))
    expect(calls.saveWeekFocus).toHaveBeenLastCalledWith('2026-10-26', ['Garden', 'Plan trip', 'Read'], 'Fewer meetings', TODAY)
    expect(step()).toBe('The week, closed')
    expect([...document.querySelectorAll('.review-list.is-focus li')].map((li) => li.textContent)).toEqual(['Garden', 'Plan trip', 'Read'])
    // No AI here: the persona's summary is only a hook, and nothing is registered.
    expect(document.body.textContent).not.toContain('Summarise with the persona')
    await click(button('Finish the review'))
    expect(document.body.textContent).toContain('Until next week.')
    expect(await seriousViolations()).toEqual([])
  })
})
