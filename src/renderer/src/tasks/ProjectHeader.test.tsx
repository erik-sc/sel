// @vitest-environment happy-dom
// The head of a project's list: a project without a next action is flagged and offered its first
// open task; one can be chosen; the objective is saved on Enter; milestones are added, reached and
// removed; progress is a count, never a percentage. The writes are stood in for.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '@shared/tasks/projects'
import { cleanup, press, render, seriousViolations } from '@/a11y/testing'

const calls = vi.hoisted(() => ({
  next: [] as unknown[][],
  objective: [] as unknown[][],
  added: [] as unknown[][],
  updated: [] as unknown[][],
  removed: [] as unknown[][]
}))

vi.mock('./projects', () => ({
  setNextAction: (...args: unknown[]) => void calls.next.push(args),
  setObjective: (...args: unknown[]) => void calls.objective.push(args),
  addMilestone: (...args: unknown[]) => {
    calls.added.push(args)
    return 'new'
  },
  updateMilestone: (...args: unknown[]) => void calls.updated.push(args),
  removeMilestone: (...args: unknown[]) => void calls.removed.push(args),
  updateProjectPlan: () => undefined
}))
vi.mock('@/ui/toast', () => ({ toast: () => 'toast', notifyError: () => undefined }))

const { ProjectHeader } = await import('./ProjectHeader')

const summary = (extra: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'home',
  name: 'Home',
  color: 'green',
  objective: '',
  next: null,
  suggestion: { id: 't2', title: 'Call movers' },
  milestones: [
    { id: 'm1', title: 'Contract signed', date: '2026-10-01', done: false },
    { id: 'm2', title: 'Keys', date: '2026-12-01', done: false }
  ],
  done: 1,
  total: 3,
  needsNext: true,
  ...extra
})

const OPEN = [
  { id: 't2', title: 'Call movers' },
  { id: 't3', title: 'Label boxes' }
]

beforeEach(() => {
  for (const list of Object.values(calls)) list.length = 0
})

afterEach(cleanup)

describe('a project’s head', () => {
  it('flags a project without a next action and offers its first open task', async () => {
    await render(<ProjectHeader summary={summary()} open={OPEN} today="2026-10-22" onOpenTask={() => undefined} />)
    expect(document.querySelector('[data-flag="no-next"]')?.textContent).toBe('No next action')
    const use = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Use "Call movers"') as HTMLButtonElement
    await act(async () => use.click())
    expect(calls.next).toEqual([['home', 't2']])
    const select = document.querySelector('.project-choose') as HTMLSelectElement
    await act(async () => {
      select.value = 't3'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(calls.next.at(-1)).toEqual(['home', 't3'])
  })

  it('shows the next action, and progress as a count', async () => {
    const opened: string[] = []
    await render(
      <ProjectHeader
        summary={summary({ next: { id: 't3', title: 'Label boxes' }, needsNext: false, suggestion: null })}
        open={OPEN}
        today="2026-10-22"
        onOpenTask={(id) => opened.push(id)}
      />
    )
    expect(document.querySelector('[data-flag]')).toBeNull()
    await act(async () => (document.querySelector('.project-next') as HTMLButtonElement).click())
    expect(opened).toEqual(['t3'])
    const count = document.querySelector('.project-count')?.textContent ?? ''
    expect(count).toBe('1 of 3 tasks done')
    expect(document.querySelector('.project-head')?.textContent).not.toContain('%')
  })

  it('saves the objective on Enter', async () => {
    await render(<ProjectHeader summary={summary()} open={OPEN} today="2026-10-22" onOpenTask={() => undefined} />)
    const input = document.querySelector('.project-objective') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'A calm new home by December')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await press(input, 'Enter')
    expect(calls.objective).toEqual([['home', 'A calm new home by December']])
  })

  it('adds, reaches and removes milestones, and marks the late one', async () => {
    await render(<ProjectHeader summary={summary()} open={OPEN} today="2026-10-22" onOpenTask={() => undefined} />)
    const items = document.querySelectorAll('.project-milestone')
    expect(items[0].classList.contains('is-late')).toBe(true)
    expect(items[1].classList.contains('is-late')).toBe(false)
    await act(async () => (items[1].querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    expect(calls.updated).toEqual([['home', 'm2', { done: true }]])
    await act(async () => (items[0].querySelector('.project-remove') as HTMLButtonElement).click())
    expect(calls.removed).toEqual([['home', 'm1']])

    const form = document.querySelector('.project-add') as HTMLFormElement
    const [name, date] = form.querySelectorAll('input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(name, 'Move day')
      name.dispatchEvent(new Event('input', { bubbles: true }))
      setter?.call(date, '2026-12-15')
      date.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => form.requestSubmit())
    expect(calls.added).toEqual([['home', 'Move day', '2026-12-15']])
    expect(await seriousViolations()).toEqual([])
  })
})
