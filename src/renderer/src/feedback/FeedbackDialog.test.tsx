// @vitest-environment happy-dom
// The feedback dialog: what it saves, the log lines it attaches only when asked (and shows before
// saving), and what it lists. window.api is a fake that records what was sent.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackInput, FeedbackItem } from '@shared/feedback'
import { cleanup, render, seriousViolations, settle } from '@/a11y/testing'
import { closeFeedback, openFeedback, useFeedbackGate } from './gate'

vi.mock('@/store/tabs', () => ({ activeTab: () => null, tabPage: () => null }))

const LOG = ['2026-10-22T10:00:00.000Z error [data] the backup was not made Error ENOSPC: no space']

function item(over: Partial<FeedbackItem>): FeedbackItem {
  return {
    schema: 1,
    id: 'fb-20261022-100000-abcd',
    kind: 'bug',
    title: 'Table breaks',
    description: '',
    status: 'open',
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
    context: { appVersion: '0.7.0', platform: 'win32', screen: 'page' },
    resolution: null,
    log: null,
    ...over
  }
}

let created: FeedbackInput[]
let listed: FeedbackItem[]

beforeEach(() => {
  created = []
  listed = []
  ;(window as unknown as { api: unknown }).api = {
    feedback: {
      list: () => Promise.resolve(listed),
      create: (input: FeedbackInput) => {
        created.push(input)
        listed = [item({ title: input.title, log: input.attachLog ? LOG : null })]
        return Promise.resolve(listed[0])
      },
      withdraw: () => Promise.resolve(),
      openFolder: () => Promise.resolve(),
      logTail: () => Promise.resolve(LOG)
    },
    app: { log: () => undefined, openExternal: () => Promise.resolve() }
  }
})

afterEach(async () => {
  closeFeedback()
  await cleanup()
})

async function open(): Promise<HTMLElement> {
  const { FeedbackDialog } = await import('./FeedbackDialog')
  openFeedback('bug')
  await render(<FeedbackDialog />)
  await settle()
  return document.body
}

async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    ;(element as HTMLElement).click()
  })
  await settle()
}

const button = (root: HTMLElement, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement

describe('the feedback dialog', () => {
  it('saves a report without the log unless asked', async () => {
    const root = await open()
    await type(root.querySelector('input.ui-input')!, 'Table breaks')
    await click(button(root, 'Report bug'))
    expect(created).toEqual([{ kind: 'bug', title: 'Table breaks', description: '', screen: 'none', attachLog: false }])
  })

  it('shows the log lines before they go, and attaches them when asked', async () => {
    const root = await open()
    const see = button(root, 'See what goes')
    await click(see)
    expect(see.getAttribute('aria-expanded')).toBe('true')
    expect(root.querySelector('.fb-log-lines')?.textContent).toBe(LOG[0])

    await type(root.querySelector('input.ui-input')!, 'Backup fails')
    await click(root.querySelector('.fb-check input')!)
    await click(button(root, 'Report bug'))
    expect(created[0]).toMatchObject({ title: 'Backup fails', attachLog: true })
    // Saved, the dialog moves to what was sent.
    expect(root.textContent).toContain('Backup fails')
    expect(useFeedbackGate.getState().open).toBe(true)
  })

  it('has nothing serious for a screen reader', async () => {
    const root = await open()
    await click(button(root, 'See what goes'))
    expect(await seriousViolations(root)).toEqual([])
  })
})
