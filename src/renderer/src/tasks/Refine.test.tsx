// @vitest-environment happy-dom
// The refine walk moves on when the focus has left the card (a click beside it, a chip clicked),
// and with the mouse: its back, skip and next buttons.
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fakeApi, press, render } from '@/a11y/testing'
import type { TaskItem } from './lists'

vi.mock('./edit', () => ({ renameTask: () => true, setPriority: () => undefined, deleteTask: () => undefined }))
vi.mock('./lazy', () => ({ preloadTaskEditors: () => undefined, TaskFieldPopover: () => null }))

const { Refine } = await import('./Refine')

const task = (id: string, title: string, order: number): TaskItem =>
  ({
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
    completedAt: null,
    recurring: false,
    row: {} as TaskItem['row'],
    order,
    createdAt: order
  }) as TaskItem

const TASKS = [task('a', 'Call mum', 1), task('b', 'Pay rent', 2), task('c', 'Read', 3)]

const progress = (): string => document.querySelector('.refine-progress')?.textContent ?? ''
const button = (text: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('.refine-walk button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'blocks.getMany': [] })
})

afterEach(cleanup)

describe('the refine walk', () => {
  it('goes on with Enter and S after the focus has left the card', async () => {
    await render(<Refine tasks={TASKS} from="refine" today="2026-10-22" onExit={() => undefined} />)
    expect(progress()).toMatch(/^1 /)
    await act(async () => (document.activeElement as HTMLElement | null)?.blur())
    await press(document.body, 'Enter')
    expect(progress()).toMatch(/^2 /)
    await press(document.body, 's')
    expect(progress()).toMatch(/^3 /)
    await press(document.body, 'ArrowLeft')
    expect(progress()).toMatch(/^2 /)
  })

  it('goes on from a chip that took the focus with a click', async () => {
    await render(<Refine tasks={TASKS} from="refine" today="2026-10-22" onExit={() => undefined} />)
    const chip = document.querySelector<HTMLButtonElement>('.refine-card .task-chip') as HTMLButtonElement
    await act(async () => chip.focus())
    await press(chip, 'Enter')
    expect(progress()).toMatch(/^2 /)
  })

  it('leaves keys typed in a field outside the card alone', async () => {
    await render(<Refine tasks={TASKS} from="refine" today="2026-10-22" onExit={() => undefined} />)
    const input = document.createElement('input')
    document.body.append(input)
    await act(async () => input.focus())
    await press(input, 'Enter')
    await press(input, 's')
    expect(progress()).toMatch(/^1 /)
  })

  it('walks with the mouse: next, skip, back', async () => {
    await render(<Refine tasks={TASKS} from="refine" today="2026-10-22" onExit={() => undefined} />)
    const [back, skip, next] = [...document.querySelectorAll<HTMLButtonElement>('.refine-walk button')]
    expect(back.disabled).toBe(true)
    await act(async () => next.click())
    expect(progress()).toMatch(/^2 /)
    await act(async () => skip.click())
    expect(progress()).toMatch(/^3 /)
    await act(async () => button(back.textContent ?? '').click())
    expect(progress()).toMatch(/^2 /)
  })
})
