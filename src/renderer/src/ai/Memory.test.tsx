// @vitest-environment happy-dom
// The persona's memory in the window (0.8.0 A3): each finished answer goes to main with the pages it
// was about (the route too, which a private page leaves as the only trace); what was kept shows
// under the answer as "Remembered: …" with an "Undo" that forgets it. Settings → AI → Memory lists
// the facts, edits one in place, deletes one or all, and turns the memory off.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_MEMORY_ENABLED_KEY, AI_MEMORY_KEY, type MemoryFact } from '@shared/aiMemory'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from '@/a11y/testing'

const fact = (id: string, text: string): MemoryFact => ({ id, text, at: 1, source: 'c1', uses: 0 })

const api = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  remembered: [] as unknown[],
  ops: [] as unknown[],
  kept: [] as MemoryFact[],
  answer: [] as MemoryFact[]
}))

{
  const base = fakeApi() as Record<string, unknown>
  const app = {
    ...(base.app as object),
    getSetting: (key: string) => Promise.resolve(key === AI_MEMORY_KEY ? api.kept : (api.settings[key] ?? null)),
    setSetting: (key: string, value: unknown) => {
      api.settings[key] = value
      return Promise.resolve()
    }
  }
  const ai = {
    remember: (input: unknown) => {
      api.remembered.push(input)
      return Promise.resolve(api.answer)
    },
    memory: (op: { op: string; id?: string; ids?: string[]; text?: string }) => {
      api.ops.push(op)
      if (op.op === 'edit' && /password/i.test(op.text ?? '')) return Promise.resolve({ facts: api.kept, refused: 'secret' })
      if (op.op === 'edit') api.kept = api.kept.map((entry) => (entry.id === op.id ? { ...entry, text: op.text ?? '' } : entry))
      if (op.op === 'remove') api.kept = api.kept.filter((entry) => !op.ids?.includes(entry.id))
      if (op.op === 'clear') api.kept = []
      return Promise.resolve({ facts: api.kept })
    },
    onEvent: () => () => undefined
  }
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) => (prop === 'app' ? app : prop === 'ai' ? ai : Reflect.get(target, prop))
  })
}

const { useBalloon, emitReplyDone } = await import('./balloonGate')
const { startMemory, pagesOf } = await import('./memoryNotes')
const { MemorySettings } = await import('./MemorySettings')
const { useHome } = await import('@/home/store')
const { useHerman } = await import('@/herman/gate')

const REPLY = {
  conversationId: 'c1',
  messageId: 2,
  question: 'I prefer short answers',
  answer: 'Noted, and here is the summary.',
  history: [],
  pageId: null,
  route: 'page-7'
}

const button = (name: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
  ) as HTMLButtonElement
const click = async (target: HTMLElement): Promise<void> => {
  await act(async () => target.click())
  await settle()
}

beforeEach(() => {
  api.settings = {}
  api.remembered = []
  api.ops = []
  api.kept = []
  api.answer = []
  useHome.setState({ locale: 'en' })
  useHerman.setState({ persona: 'herman' })
  useBalloon.setState({ notes: {}, lastReply: null })
})

afterEach(async () => {
  await cleanup()
})

describe('remembering an answer', () => {
  it('sends each finished answer with the pages it was about, and notes what was kept, with Undo', async () => {
    startMemory()
    startMemory()
    api.answer = [fact('m1', 'Prefers short answers')]
    await act(async () => emitReplyDone(REPLY))
    await settle()
    expect(api.remembered).toEqual([
      {
        conversationId: 'c1',
        messageId: 2,
        question: 'I prefer short answers',
        answer: 'Noted, and here is the summary.',
        history: [],
        pageIds: ['page-7']
      }
    ])
    const notes = useBalloon.getState().notes['c1:2'] ?? []
    expect(notes.map((note) => note.text)).toEqual(['Remembered: Prefers short answers'])
    expect(notes[0].action?.label).toBe('Undo')
    await act(async () => notes[0].action?.run())
    expect(api.ops).toEqual([{ op: 'remove', ids: ['m1'] }])
    expect(useBalloon.getState().notes['c1:2']).toEqual([])
  })

  it('says it in Portuguese, and adds nothing when nothing was kept', async () => {
    useHome.setState({ locale: 'pt-BR' })
    api.answer = [fact('m2', 'Trabalha no banco X')]
    await act(async () => emitReplyDone({ ...REPLY, messageId: 4 }))
    await settle()
    expect(useBalloon.getState().notes['c1:4']?.map((note) => [note.text, note.action?.label])).toEqual([
      ['Lembrei: Trabalha no banco X', 'Desfazer']
    ])
    api.answer = []
    await act(async () => emitReplyDone({ ...REPLY, messageId: 6 }))
    await settle()
    expect(useBalloon.getState().notes['c1:6']).toBeUndefined()
  })

  it('names the page and the route, each once', () => {
    expect(pagesOf({ pageId: 'a', route: 'a' })).toEqual(['a'])
    expect(pagesOf({ pageId: 'a', route: 'b' })).toEqual(['a', 'b'])
    expect(pagesOf({ pageId: null, route: null })).toEqual([])
  })
})

describe('Settings → AI → Memory', () => {
  it('lists the facts, edits one in place, refuses a secret, deletes one and all, and nothing serious for axe', async () => {
    api.kept = [fact('m1', 'Prefers short answers'), fact('m2', 'Works for bank X')]
    await render(<MemorySettings enabled locale="en" />)
    await settle()
    const fields = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Remembered fact"]')]
    expect(fields().map((field) => field.value)).toEqual(['Prefers short answers', 'Works for bank X'])
    expect(document.body.textContent).toContain('2 of 50 facts')
    expect(await seriousViolations()).toEqual([])

    const edit = async (field: HTMLInputElement, text: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, text)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await press(field, 'Enter')
      await settle()
    }
    await edit(fields()[1], 'Works for bank X, in São Paulo')
    expect(api.ops.at(-1)).toEqual({ op: 'edit', id: 'm2', text: 'Works for bank X, in São Paulo' })
    expect(fields()[1].value).toBe('Works for bank X, in São Paulo')
    await edit(fields()[0], 'My password is tulip')
    expect(fields()[0].value).toBe('Prefers short answers')

    await click(button('Delete “Prefers short answers”'))
    expect(fields().map((field) => field.value)).toEqual(['Works for bank X, in São Paulo'])
    await click(button('Delete all'))
    await click(button('Delete all now'))
    expect(api.ops.at(-1)).toEqual({ op: 'clear' })
    expect(document.body.textContent).toContain('Nothing remembered yet.')
  })

  it('turns the memory off, and on again', async () => {
    await render(<MemorySettings enabled locale="pt-BR" />)
    await settle()
    expect(document.body.textContent).toContain('Refazer apresentação')
    await click(button('Desligada'))
    expect(api.settings[AI_MEMORY_ENABLED_KEY]).toBe(false)
    expect(document.body.textContent).toContain('nada novo é guardado')
    await click(button('Ligada'))
    expect(api.settings[AI_MEMORY_ENABLED_KEY]).toBeNull()
  })
})
