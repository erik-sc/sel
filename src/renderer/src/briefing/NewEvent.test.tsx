// @vitest-environment happy-dom
// The calendar's new event: what is typed becomes Google Calendar's address, and nothing opens
// while something is missing.
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, seriousViolations, settle } from '@/a11y/testing'
import { NewEventForm, type NewEventCopy } from './NewEvent'

const COPY: NewEventCopy = {
  what: 'What',
  whatPlaceholder: 'Dentist',
  day: 'Day',
  allDay: 'All day',
  from: 'From',
  until: 'Until',
  where: 'Where',
  create: 'Create in Google Calendar',
  hint: 'Opens Google Calendar.',
  problems: { title: 'Say what the event is.', day: 'Choose a day.', time: 'Choose the hours.' }
}

const field = (label: string): HTMLInputElement =>
  [...document.querySelectorAll('label')]
    .find((each) => each.querySelector('span')?.textContent === label)
    ?.querySelector('input') as HTMLInputElement

async function type(label: string, value: string): Promise<void> {
  const input = field(label)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(): Promise<void> {
  await act(async () => document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await settle()
}

describe('the new event form', () => {
  afterEach(cleanup)

  it('opens Google Calendar with the hour clicked, an hour long', async () => {
    const onOpen = vi.fn()
    await render(<NewEventForm day="2026-11-12" time="14:00" copy={COPY} onOpen={onOpen} onCancel={() => undefined} />)
    expect(field('From').value).toBe('14:00')
    expect(field('Until').value).toBe('15:00')
    await submit()
    // Nothing opens without a title.
    expect(onOpen).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Say what the event is.')
    await type('What', 'Dentista')
    // Moving the start keeps the length.
    await type('From', '16:30')
    expect(field('Until').value).toBe('17:30')
    await submit()
    const query = new URL(onOpen.mock.calls[0][0] as string).searchParams
    expect(query.get('text')).toBe('Dentista')
    expect(query.get('dates')).toBe('20261112T163000/20261112T173000')
    expect(await seriousViolations()).toEqual([])
  })

  it('takes the whole day when a day was clicked', async () => {
    const onOpen = vi.fn()
    await render(<NewEventForm day="2026-11-12" time={null} copy={COPY} onOpen={onOpen} onCancel={() => undefined} />)
    expect(field('From')).toBeUndefined()
    await type('What', 'Feriado')
    await submit()
    expect(new URL(onOpen.mock.calls[0][0] as string).searchParams.get('dates')).toBe('20261112/20261113')
  })
})
