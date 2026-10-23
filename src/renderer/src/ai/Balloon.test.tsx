// @vitest-environment happy-dom
// The conversation balloon in a DOM: a dialog named for who it talks with, the keyboard in its
// field, suggestions that send the right question, an answer that streams in with its proposal
// (Apply / Dismiss), Esc to stop and to close, "Earlier" that brings a conversation back, and
// nothing serious for axe.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiEvent, AiRequest } from '@shared/ai'
import { AI_CONVERSATIONS_KEY, cleanConversations, type StoredConversation } from '@shared/aiHistory'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from '@/a11y/testing'

const api = vi.hoisted(() => ({
  runs: [] as unknown[],
  cancels: [] as string[],
  listener: null as ((event: unknown) => void) | null,
  settings: {} as Record<string, unknown>,
  overdue: 2
}))

{
  // Before the modules below load: some read window.api at import.
  const base = fakeApi() as Record<string, unknown>
  const ai = {
    status: () => Promise.resolve({ available: true, version: '2.1.0' }),
    run: (request: unknown) => {
      api.runs.push(request)
      return Promise.resolve({ id: `r${api.runs.length}` })
    },
    cancel: (id: string) => {
      api.cancels.push(id)
      return Promise.resolve(true)
    },
    onEvent: (listener: (event: unknown) => void) => {
      api.listener = listener
      return () => undefined
    }
  }
  const app = {
    ...(base.app as object),
    getSetting: (key: string) => Promise.resolve(api.settings[key] ?? null),
    setSetting: (key: string, value: unknown) => {
      api.settings[key] = key === AI_CONVERSATIONS_KEY && value !== null ? cleanConversations(value) : value
      return Promise.resolve()
    }
  }
  const briefing = { get: () => Promise.resolve({ tasks: { overdue: Array.from({ length: api.overdue }, () => ({})) } }) }
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) => (prop === 'ai' ? ai : prop === 'app' ? app : prop === 'briefing' ? briefing : Reflect.get(target, prop))
  })
}

const { useAiGate } = await import('./gate')
const { useHome } = await import('@/home/store')
const { useConversations } = await import('./conversations')
const { Balloon } = await import('./Balloon')
const gate = await import('./balloonGate')
const { useHerman } = await import('@/herman/gate')

const emit = async (event: AiEvent): Promise<void> => {
  await act(async () => api.listener?.(event))
}
const dialog = (): HTMLElement => document.querySelector('[role="dialog"]') as HTMLElement
const button = (name: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
  ) as HTMLButtonElement
const click = async (target: HTMLElement): Promise<void> => {
  await act(async () => target.click())
  await settle()
}

beforeEach(() => {
  api.runs = []
  api.cancels = []
  api.settings = {}
  api.overdue = 2
  // The morning: "Plan the day" is offered.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0))
  useHome.setState({ locale: 'en' })
  useAiGate.setState({ enabled: true, balloonOpen: true })
  useConversations.setState({ list: [], active: {}, loaded: false })
  useHerman.setState({ on: false })
})

afterEach(async () => {
  vi.useRealTimers()
  await cleanup()
})

describe('the conversation balloon', () => {
  it('is a dialog named for whom it talks with, with the keyboard in its field, and nothing serious for axe', async () => {
    await render(<Balloon />)
    await settle()
    const box = dialog()
    expect(box).toBeTruthy()
    const title = document.getElementById(box.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent).toBe('Assistant')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Message')
    expect(await seriousViolations()).toEqual([])
  })

  it('offers questions for the moment and sends the one chosen, about the day', async () => {
    await render(<Balloon />)
    await settle()
    const offered = [...document.querySelectorAll('[role="group"][aria-label="Suggestions"] button')].map((b) => b.textContent)
    expect(offered).toEqual(['Plan the day', 'Replan 2 overdue'])
    await click(button('Replan 2 overdue'))
    expect(api.runs).toHaveLength(1)
    expect(api.runs[0]).toMatchObject({ action: 'ask', today: true } satisfies Partial<AiRequest>)
    expect((api.runs[0] as AiRequest).instruction).toContain('2 overdue tasks')
  })

  it('streams the answer in, shows what it proposes with Apply and Dismiss, and keeps the conversation', async () => {
    await render(<Balloon />)
    await settle()
    const field = document.activeElement as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(field, 'Make me a trip page')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await press(field, 'Enter')
    await settle()
    expect(api.runs[0]).toMatchObject({ action: 'ask', instruction: 'Make me a trip page' })
    expect(document.querySelector('.ai-message.is-user')?.textContent).toBe('Make me a trip page')

    await emit({ type: 'delta', id: 'r1', text: 'Here is a plan.' })
    expect(document.querySelector('.ai-message.is-assistant')?.textContent).toContain('Here is a plan.')
    expect(button('Stop')).toBeTruthy()

    const answer = 'Here is a plan.\n\n```sel-actions\n[{"do":"create-page","title":"Trip"}]\n```'
    await emit({ type: 'done', id: 'r1', text: answer, truncated: false, durationMs: 5, sent: { context: true, pages: [], servers: [] } })
    await settle()
    expect(document.querySelector('.ai-proposal')?.textContent).toContain('Trip')
    expect(button('Apply')).toBeTruthy()
    expect(document.querySelector('.ai-sent')).toBeTruthy()

    await click(button('Dismiss'))
    expect(document.querySelector('.ai-proposal')).toBeNull()

    // Kept on disk with what became of the proposal.
    await act(async () => {
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 600))
    })
    const [kept] = api.settings[AI_CONVERSATIONS_KEY] as StoredConversation[]
    expect(kept.title).toBe('Make me a trip page')
    expect(kept.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(kept.messages[1].proposal).toEqual({ state: 'dismissed' })
    expect(await seriousViolations()).toEqual([])
  })

  it('stops an answer with Esc, and closes with Esc after that', async () => {
    await render(<Balloon />)
    await settle()
    await click(button('Plan the day'))
    await emit({ type: 'delta', id: 'r1', text: 'Three things' })
    await press(dialog(), 'Escape')
    await settle()
    expect(api.cancels).toEqual(['r1'])
    expect(useAiGate.getState().balloonOpen).toBe(true)
    await press(dialog(), 'Escape')
    expect(useAiGate.getState().balloonOpen).toBe(false)
  })

  it('brings back an earlier conversation, and deletes them all', async () => {
    api.settings[AI_CONVERSATIONS_KEY] = [
      {
        id: 'c1',
        title: 'What is overdue?',
        createdAt: 1,
        updatedAt: Date.now() - 3_600_000,
        pageId: null,
        messages: [
          { role: 'user', text: 'What is overdue?', at: 1 },
          { role: 'assistant', text: 'Two tasks.', at: 2, status: 'done' }
        ]
      }
    ]
    await render(<Balloon />)
    await settle()
    await click(button('Earlier conversations'))
    const item = document.querySelector<HTMLButtonElement>('.ai-earlier-item')
    expect(item?.textContent).toContain('What is overdue?')
    expect(item?.textContent).toContain('1 hour ago')
    expect(await seriousViolations()).toEqual([])
    await click(item as HTMLButtonElement)
    expect(document.querySelector('.ai-message.is-assistant')?.textContent).toContain('Two tasks.')

    await click(button('Earlier conversations'))
    await click(button('Delete all'))
    await click(button('Delete all'))
    expect(api.settings[AI_CONVERSATIONS_KEY]).toBeNull()
    expect(document.querySelector('.ai-earlier-item')).toBeNull()
  })

  it('opens on an answer delivered from outside, tells listeners when an answer ends, and shows their notes under it', async () => {
    useHerman.setState({ on: true })
    await render(<Balloon />)
    await settle()
    expect(document.getElementById(dialog().getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Herman')

    // A routine's answer: the balloon opens on it, proposal included, and nothing is applied.
    await act(async () =>
      gate.openInBalloon({
        title: 'Plan for today',
        request: 'Plan my day',
        answer: 'Three things first.\n\n```sel-actions\n[{"do":"create-page","title":"Today plan"}]\n```',
        source: 'routine:morning',
        today: true
      })
    )
    await settle()
    expect(document.querySelector('.ai-message.is-user')?.textContent).toBe('Plan my day')
    expect(document.querySelector('.ai-proposal')?.textContent).toContain('Today plan')
    expect(api.runs).toHaveLength(0)

    // The persona's memory listens for finished answers and puts a line with Undo under one.
    const heard: string[] = []
    const off = gate.onReplyDone((reply) => {
      heard.push(reply.answer)
      gate.addReplyNote({ text: 'Remembered: you plan in the morning.', action: { label: 'Undo', run: () => undefined } })
    })
    const field = dialog().querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, 'And after lunch?')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await press(field, 'Enter')
    await settle()
    expect(api.runs[0]).toMatchObject({ instruction: 'And after lunch?', history: [{ role: 'user' }, { role: 'assistant' }] })
    await emit({ type: 'done', id: 'r1', text: 'A walk, then the review.', truncated: false, durationMs: 3 })
    await settle()
    off()
    expect(heard).toEqual(['A walk, then the review.'])
    const note = document.querySelector('.ai-reply-note')
    expect(note?.textContent).toContain('Remembered: you plan in the morning.')
    expect(note?.querySelector('button')?.textContent).toBe('Undo')
    expect(await seriousViolations()).toEqual([])
  })

  it('speaks of Hermine when she is the persona', async () => {
    useHerman.setState({ on: true, persona: 'hermine' })
    try {
      await render(<Balloon />)
      await settle()
      expect(document.getElementById(dialog().getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Hermine')
      expect(dialog().querySelector('textarea')?.getAttribute('placeholder')).toBe('Ask Hermine…')
      expect(dialog().textContent).not.toMatch(/\bHerman\b/)
    } finally {
      useHerman.setState({ persona: 'herman' })
    }
  })

  it('keeps Tab inside the balloon', async () => {
    await render(<Balloon />)
    await settle()
    const focusable = [...dialog().querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"]')]
    const last = focusable[focusable.length - 1]
    await act(async () => last.focus())
    await press(last, 'Tab')
    expect(document.activeElement).toBe(focusable[0])
  })
})
