// @vitest-environment happy-dom
// The editor of a project's or database's own context: it opens on what is stored, pins a page
// found by searching, refuses a page private from the AI, says when the project is private, and
// saves the text and the pages. The writes and the blocks are stood in for.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '@shared/types'
import { cleanup, render, seriousViolations } from '@/a11y/testing'

const state = vi.hoisted(() => ({
  saved: [] as unknown[][],
  private: new Set<string>(),
  isPrivate: false,
  toasts: [] as string[]
}))

function page(id: string, title: string): Block {
  return { id, type: 'page', parentId: null, content: [], props: { title: [[title]] }, createdAt: 0, updatedAt: 0, trashedAt: null }
}
const PAGES = [page('brief', 'Bank brief'), page('secret', 'Secret plan'), page('other', 'Other')]

vi.mock(import('@/store/blocks'), async (importOriginal) => ({
  ...(await importOriginal()),
  useBlock: (id: string | null | undefined) => PAGES.find((each) => each.id === id)
}))
vi.mock('./privacy', () => ({ useAiPrivacy: () => null }))
vi.mock('@/ui/toast', () => ({
  toast: (text: string) => {
    state.toasts.push(text)
    return 'toast'
  },
  notifyError: () => undefined
}))
vi.mock('./scopeContext', async () => {
  const { create } = await import('zustand')
  const useScopeEditor = create<{ target: { kind: 'project' | 'database'; id: string } | null }>(() => ({ target: null }))
  return {
    useScopeEditor,
    closeScopeContext: () => useScopeEditor.setState({ target: null }),
    scopeContextOf: () => ({ text: 'The bank.', pages: ['brief'] }),
    scopeName: () => 'Auxiliadora',
    scopePrivateNow: () => state.isPrivate,
    canPinToScope: async (id: string) => (state.private.has(id) ? 'private' : 'ok'),
    saveScopeContext: async (...args: unknown[]) => void state.saved.push(args)
  }
})

const { ScopeContextDialog } = await import('./ScopeContextDialog')
const { useScopeEditor } = await import('./scopeContext')

beforeEach(() => {
  state.saved.length = 0
  state.toasts.length = 0
  state.private = new Set(['secret'])
  state.isPrivate = false
  vi.stubGlobal('api', {
    pages: { listRecent: async () => PAGES },
    search: { query: async () => [] },
    blocks: { getMany: async () => [] }
  })
})

afterEach(async () => {
  await cleanup()
  useScopeEditor.setState({ target: null })
  vi.unstubAllGlobals()
})

const settle = (): Promise<void> => act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
const button = (label: string): HTMLButtonElement =>
  document.querySelector(`button[aria-label="${label}"]`) ??
  ([...document.querySelectorAll('button')].find((each) => each.textContent === label) as HTMLButtonElement)

describe('the editor of a project’s context', () => {
  it('opens on what is stored, pins a page, refuses a private one and saves', async () => {
    useScopeEditor.setState({ target: { kind: 'project', id: 'p-x' } })
    await render(<ScopeContextDialog />)
    await settle()
    expect(document.querySelector('h2')?.textContent).toBe('Context for the project “Auxiliadora”')
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('The bank.')
    expect(document.querySelectorAll('.ai-scope-page')).toHaveLength(1)
    // The pinned page is not offered again.
    expect(button('Pin “Bank brief”')).toBeUndefined()

    await act(async () => button('Pin “Secret plan”').click())
    await settle()
    expect(state.toasts.at(-1)).toMatch(/private from the AI/)
    expect(document.querySelectorAll('.ai-scope-page')).toHaveLength(1)

    await act(async () => button('Pin “Other”').click())
    await settle()
    expect(document.querySelectorAll('.ai-scope-page')).toHaveLength(2)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'The bank, Pelican.')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(await seriousViolations()).toEqual([])
    await act(async () => button('Save').click())
    await settle()
    expect(state.saved).toEqual([
      [
        { kind: 'project', id: 'p-x' },
        { text: 'The bank, Pelican.', pages: ['brief', 'other'] }
      ]
    ])
    expect(useScopeEditor.getState().target).toBeNull()
  })

  it('says when the project is private from the AI', async () => {
    state.isPrivate = true
    useScopeEditor.setState({ target: { kind: 'project', id: 'p-z' } })
    await render(<ScopeContextDialog />)
    await settle()
    expect(document.querySelector('.ai-scope-private')?.textContent).toContain('never sent')
  })
})
