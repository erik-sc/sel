// @vitest-environment happy-dom
// The day's plan on Today: a task dragged from the list onto the hours becomes a block, a block is
// resized by its lower edge, moved and resized from the keyboard, taken off the plan, and Ctrl+Z
// puts the last change back. A day that holds more than fits says so. The writes are stood in for:
// what is checked is the block each gesture asks for.
import { act, useState } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Briefing, BriefingEvent, BriefingTask } from '@shared/briefing'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from '@/a11y/testing'

const calls = vi.hoisted(() => ({
  blocked: [] as unknown[][],
  unblocked: [] as unknown[][],
  undone: [] as unknown[]
}))

vi.mock('./reschedule', () => ({
  canMove: (task: { kind: string; dateProperty?: string }) => task.kind === 'row' && !!task.dateProperty,
  blockTask: async (task: { id: string }, block: unknown) => {
    calls.blocked.push([task.id, block])
    return { rowId: task.id, property: 'tasks.due', previous: null, next: block }
  },
  unblockTask: async (task: { id: string }, day: string) => {
    calls.unblocked.push([task.id, day])
    return { rowId: task.id, property: 'tasks.due', previous: 'before', next: { start: day } }
  },
  undoMove: async (move: unknown) => void calls.undone.push(move)
}))
vi.mock('@/ui/toast', () => ({ toast: () => 'toast', notifyError: () => undefined }))

const { DayPlan, planDragSource, usePlanDrag } = await import('./DayPlan')
const { patchTasks } = await import('./plan')
const { dayStart, shortClock } = await import('./format')

const DAY = '2026-10-22'
const FROM = dayStart(DAY) as number
const at = (hours: number, minutes = 0): number => FROM + (hours * 60 + minutes) * 60_000
/** A time as the plan writes it, in the locale's clock. */
const t = (hours: number, minutes = 0): string => shortClock(at(hours, minutes))
/** The plan opens at 08:00 and draws 0.8 px a minute; happy-dom puts its top at 0. */
const yOf = (hours: number, minutes = 0): number => (hours * 60 + minutes - 480) * 0.8

const task = (id: string, extra: Partial<BriefingTask> = {}): BriefingTask => ({
  id,
  kind: 'row',
  title: id,
  pageId: id,
  source: 'Tasks',
  due: DAY,
  dateProperty: 'tasks.due',
  ...extra
})

const event = (id: string, start: number, end: number): BriefingEvent => ({
  id,
  calendarId: 'cal',
  title: id,
  start,
  end,
  allDay: false,
  recurring: false
})

function briefing(tasks: BriefingTask[], events: BriefingEvent[] = []): Briefing {
  return {
    date: DAY,
    greeting: 'Hello',
    phrase: null,
    hasPhrases: false,
    events: { today: events, calendars: [{ id: 'cal', label: 'Work', color: 'blue', enabled: true, ok: true } as never] },
    tasks: { overdue: [], today: tasks, more: 0 },
    updatedAt: 0
  }
}

/** Today in small: the plan, and the open tasks as plain draggable items. */
function Harness({ initial }: { initial: Briefing }): JSX.Element {
  const [data, setData] = useState(initial)
  const drag = usePlanDrag()
  return (
    <>
      <DayPlan
        briefing={data}
        now={at(7)}
        drag={drag}
        onPatch={(id, change) => setData((current) => ({ ...current, tasks: patchTasks(current.tasks, id, change, DAY) }))}
        onOpen={() => undefined}
      />
      <ul>
        {data.tasks.today.map((each) => (
          <li key={each.id} data-item={each.id} {...planDragSource(drag, each)}>
            {each.title}
          </li>
        ))}
      </ul>
    </>
  )
}

function fire(target: Element, type: string, props: Record<string, unknown> = {}): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const dataTransfer = { setData: () => undefined, effectAllowed: '', dropEffect: '' }
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    ...Object.fromEntries(Object.entries(props).map(([key, value]) => [key, { value }]))
  })
  target.dispatchEvent(event)
}

const body = (): HTMLElement => document.querySelector('.plan-body') as HTMLElement
const blockOf = (title: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('.plan-block-main')].find((el) => el.textContent?.includes(title)) as HTMLElement

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi()
})

beforeEach(() => {
  calls.blocked.length = 0
  calls.unblocked.length = 0
  calls.undone.length = 0
})

afterEach(cleanup)

describe('the day’s plan', () => {
  it('makes a block of a task dragged from the list onto a free slot', async () => {
    await render(<Harness initial={briefing([task('Write')], [event('Standup', at(10), at(10, 20))])} />)
    expect(document.querySelectorAll('.plan-event')).toHaveLength(1)
    const item = document.querySelector('[data-item="Write"]') as HTMLElement
    expect(item.getAttribute('draggable')).toBe('true')
    await act(async () => fire(item, 'dragstart', { clientY: 0 }))
    await act(async () => fire(body(), 'dragover', { clientY: yOf(9, 50) }))
    expect(document.querySelector('.plan-guide-time')?.textContent).toBe(t(9, 45))
    await act(async () => fire(body(), 'drop', { clientY: yOf(9, 50) }))
    await settle()
    // Dropped at 09:50, it starts at 09:45 and stops where the standup starts.
    expect(calls.blocked).toEqual([['Write', { day: DAY, start: 585, minutes: 15 }]])
    expect(blockOf('Write').textContent).toContain(`${t(9, 45)}–${t(10)}`)
  })

  it('moves and resizes a block from the keyboard, takes it off the plan, and Ctrl+Z puts the last change back', async () => {
    await render(<Harness initial={briefing([task('Write', { time: '09:00', minutes: 30 })])} />)
    const block = blockOf('Write')
    expect(block.getAttribute('aria-label')).toBe(`Write, ${t(9)}–${t(9, 30)}`)
    await act(async () => block.focus())
    await press(block, 'ArrowDown')
    expect(calls.blocked.at(-1)).toEqual(['Write', { day: DAY, start: 555, minutes: 30 }])
    await press(blockOf('Write'), 'ArrowDown', { shiftKey: true })
    expect(calls.blocked.at(-1)).toEqual(['Write', { day: DAY, start: 555, minutes: 45 }])
    await settle()
    await press(blockOf('Write'), 'z', { ctrlKey: true })
    expect(calls.undone).toHaveLength(1)
    expect(calls.undone[0]).toMatchObject({ next: { day: DAY, start: 555, minutes: 45 } })
    await press(blockOf('Write'), 'Delete')
    await settle()
    expect(calls.unblocked).toEqual([['Write', DAY]])
    expect(blockOf('Write')).toBeUndefined()
  })

  it('makes a block longer by its lower edge', async () => {
    await render(<Harness initial={briefing([task('Write', { time: '09:00', minutes: 30 })])} />)
    const edge = document.querySelector('.plan-resize') as HTMLElement
    await act(async () => edge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: yOf(9, 30) })))
    await act(async () => edge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: yOf(10, 28) })))
    expect(blockOf('Write').textContent).toContain(`${t(9)}–${t(10, 30)}`)
    await act(async () => edge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: yOf(10, 28) })))
    await settle()
    expect(calls.blocked).toEqual([['Write', { day: DAY, start: 540, minutes: 90 }]])
  })

  it('puts a task on the plan from the keyboard, at a time and for a length', async () => {
    await render(<Harness initial={briefing([task('Write'), task('Call')])} />)
    const open = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Schedule…') as HTMLButtonElement
    await act(async () => open.click())
    const form = document.querySelector('.plan-form') as HTMLFormElement
    const [taskSelect, lengthSelect] = form.querySelectorAll('select')
    const time = form.querySelector('input[type="time"]') as HTMLInputElement
    // The first free slot of the day is offered.
    expect(time.value).toBe('08:00')
    await act(async () => {
      taskSelect.value = 'Call'
      taskSelect.dispatchEvent(new Event('change', { bubbles: true }))
      lengthSelect.value = '60'
      lengthSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => form.requestSubmit())
    await settle()
    expect(calls.blocked).toEqual([['Call', { day: DAY, start: 480, minutes: 60 }]])
    expect(await seriousViolations()).toEqual([])
  })

  it('says so, gently, when the day holds more than fits', async () => {
    const many = Array.from({ length: 4 }, (_, index) => task(`Task ${index}`))
    await render(<Harness initial={briefing(many, [event('Offsite', at(8), at(19))])} />)
    const note = document.querySelector('.plan-note')
    expect(note?.textContent).toContain('more than fits')
    expect(note?.getAttribute('role')).toBe('status')
  })

  it('stays quiet when it fits', async () => {
    await render(<Harness initial={briefing([task('Write')])} />)
    expect(document.querySelector('.plan-note')).toBeNull()
    expect(document.querySelector('.plan-hint')).not.toBeNull()
  })
})
