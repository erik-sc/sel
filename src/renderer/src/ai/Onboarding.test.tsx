// @vitest-environment happy-dom
// The persona's introduction (0.8.0 A1) in a DOM: it comes by itself the first time the balloon is
// opened (and never for a profile that used the AI before), says who it is, walks five steps that
// can each be skipped, saves the drafted context after what was there, offers pages without the
// private ones, turns tools on read only, and, skipped whole, leaves every setting as it was.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_ONBOARDED_KEY } from '@shared/ai'
import { AI_CONTEXT_KEY, AI_CONTEXT_PAGES_KEY, AI_MCP_SERVERS_KEY } from '@shared/aiContext'
import { AI_CONVERSATIONS_KEY } from '@shared/aiHistory'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import type { Block } from '@shared/types'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'

const block = (id: string, title: string, extra: Partial<Block> = {}): Block =>
  ({
    id,
    type: 'page',
    parentId: null,
    props: { title: [[title]] },
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra
  }) as unknown as Block

const api = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  writes: [] as [string, unknown][],
  blocks: new Map<string, unknown>()
}))

{
  const base = fakeApi() as Record<string, unknown>
  const app = {
    ...(base.app as object),
    getSetting: (key: string) => Promise.resolve(api.settings[key] ?? null),
    setSetting: (key: string, value: unknown) => {
      api.writes.push([key, value])
      api.settings[key] = value
      return Promise.resolve()
    }
  }
  const ai = {
    status: () => Promise.resolve({ available: true, version: '2.1.296', path: 'claude' }),
    servers: () =>
      Promise.resolve({
        servers: [{ id: 'claudeai:Veleiro', scope: 'claudeai', name: 'claude.ai Veleiro', detail: 'veleiro.example' }],
        connectorsAt: 1
      }),
    onEvent: () => () => undefined
  }
  const get = (ids: string[]): Promise<unknown[]> => Promise.resolve(ids.map((id) => api.blocks.get(id)).filter(Boolean))
  const blocks = { ...(base.blocks as object), getMany: get, get: (id: string) => Promise.resolve(api.blocks.get(id) ?? null) }
  const pages = {
    ...(base.pages as object),
    listRecent: () => Promise.resolve(['recent', 'secret'].map((id) => api.blocks.get(id))),
    ancestors: () => Promise.resolve([])
  }
  const activity = { summary: () => Promise.resolve({ returning: [{ pageId: 'often', days: 9, opens: 20 }] }) }
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) =>
      prop === 'app'
        ? app
        : prop === 'ai'
          ? ai
          : prop === 'blocks'
            ? blocks
            : prop === 'pages'
              ? pages
              : prop === 'activity'
                ? activity
                : Reflect.get(target, prop)
  })
}

const { useAiGate, initAi, toggleAssistant, closeOnboarding } = await import('./gate')
const { OnboardingHost } = await import('./Host')
// Fetched before the tests, so that the host's lazy chunk is there at once.
await import('./Onboarding')
const { useHome } = await import('@/home/store')
const { useHerman } = await import('@/herman/gate')

const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]')
const title = (): string => document.getElementById(dialog()?.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''
const button = (name: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
  ) as HTMLButtonElement
const click = async (target: HTMLElement): Promise<void> => {
  await act(async () => target.click())
  await settle()
}
const type = async (label: string, text: string): Promise<void> => {
  const field = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].find(
    (el) => el.labels?.[0]?.textContent === label
  )
  if (!field) throw new Error(`no field ${label}`)
  await act(async () => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const speech = (): string => document.querySelector('.ai-onboarding-speech')?.textContent ?? ''
const checkbox = (label: string): HTMLInputElement =>
  [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
    input.closest('label')?.textContent?.includes(label)
  ) as HTMLInputElement

beforeEach(async () => {
  api.settings = {}
  api.writes = []
  api.blocks = new Map<string, unknown>([
    ['often', block('often', 'Release plan')],
    ['recent', block('recent', 'Garden notes')],
    ['secret', block('secret', 'Diary', { props: { title: [['Diary']], aiPrivate: true } } as Partial<Block>)],
    [
      TASKS_DATABASE_ID,
      block(TASKS_DATABASE_ID, 'Tasks', {
        type: 'database',
        props: {
          title: [['Tasks']],
          schema: {
            [TASK_PROPS.project]: {
              id: TASK_PROPS.project,
              name: 'Project',
              type: 'select',
              options: [{ id: 'p1', name: 'Auxiliadora', color: 'blue' }]
            }
          }
        }
      } as Partial<Block>)
    ]
  ])
  useHome.setState({ locale: 'en' })
  useHerman.setState({ on: true, persona: 'herman', skin: 'classic', hermineSkin: 'classic' })
  useAiGate.setState({ enabled: false, balloonOpen: false, onboarding: null, onboarded: null, contextPages: [], status: null })
})

afterEach(async () => {
  await cleanup()
})

async function firstOpen(): Promise<void> {
  await act(async () => initAi())
  await settle()
  await render(<OnboardingHost />)
  await act(async () => toggleAssistant())
  await settle(8)
}

describe('the persona’s introduction', () => {
  it('comes the first time the balloon is opened, instead of it, and is a dialog with nothing serious for axe', async () => {
    await firstOpen()
    expect(useAiGate.getState().balloonOpen).toBe(false)
    expect(title()).toBe('Meet Herman')
    expect(speech()).toMatch(/^Hello, I am Herman\./)
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Claude Code 2.1.296 is ready.')
    expect(await seriousViolations()).toEqual([])
  })

  it('never comes by itself for a profile that already had conversations', async () => {
    api.settings[AI_CONVERSATIONS_KEY] = [{ id: 'c1' }]
    await firstOpen()
    expect(dialog()).toBeNull()
    expect(useAiGate.getState().balloonOpen).toBe(true)
    expect(api.settings[AI_ONBOARDED_KEY]).toBe(true)
  })

  it('skipped whole, changes nothing but that it was shown, and the balloon opens', async () => {
    await firstOpen()
    await click(button('Skip the introduction'))
    expect(dialog()).toBeNull()
    expect(api.writes).toEqual([[AI_ONBOARDED_KEY, true]])
    expect(useAiGate.getState()).toMatchObject({ onboarded: true, balloonOpen: true, onboarding: null })
    // Not again by itself.
    await act(async () => toggleAssistant())
    await act(async () => toggleAssistant())
    expect(dialog()).toBeNull()
  })

  it('walks the five steps: the persona, the context after what was there, pages, tools', async () => {
    api.settings[AI_CONTEXT_KEY] = 'I like tea.'
    await firstOpen()
    await click(button('Next'))

    // 2. The persona: Hermine, and she says the introduction from then on.
    expect(speech()).toMatch(/or to Hermine\?/)
    await click(button('Hermine'))
    expect(api.settings['herman.persona']).toBe('hermine')
    expect(title()).toBe('Meet Hermine')
    expect(speech()).toMatch(/or to Herman\?/)
    await click(button('Aviator'))
    expect(api.settings['herman.hermineSkin']).toBe('aviator')
    expect(useHerman.getState().hermineSkin).toBe('aviator')
    await click(button('Next'))

    // 3. About you: the draft follows the answers and goes after the context already there.
    await type('Who are you?', 'Ana, product designer')
    await act(async () => checkbox('Auxiliadora').click())
    await click(button('Short'))
    const draft = document.querySelector<HTMLTextAreaElement>('.ai-onboarding-draft')
    expect(draft?.value).toBe(
      ['About me: Ana, product designer.', 'My projects: Auxiliadora.', 'How I like answers: short and to the point.'].join('\n')
    )
    expect(document.body.textContent).toContain('It goes after the context you already have (11 characters)')
    await type('Your context, as it will be saved', 'About me: Ana, designer.')
    await click(button('Save and continue'))
    expect(api.settings[AI_CONTEXT_KEY]).toBe('I like tea.\n\nAbout me: Ana, designer.')

    // 4. Pages: the one you come back to and the one edited last; never the private one.
    await settle(8)
    const offered = [...document.querySelectorAll('.ai-onboarding-list label')].map((label) => label.textContent)
    expect(offered).toEqual(['Release plan', 'Garden notes'])
    await act(async () => checkbox('Release plan').click())
    await settle()
    expect(api.settings[AI_CONTEXT_PAGES_KEY]).toEqual(['often'])
    await click(button('Next'))

    // 5. Tools: on means read only.
    await settle(4)
    await act(async () => checkbox('Veleiro').click())
    await settle()
    expect(api.settings[AI_MCP_SERVERS_KEY]).toEqual({ 'claudeai:Veleiro': { access: 'read' } })
    // …and the routines, each off until ticked.
    expect(checkbox('Plan the day, in the morning').checked).toBe(false)
    await act(async () => checkbox('Plan the day, in the morning').click())
    await settle()
    const routines = api.settings['ai.routines'] as { routines: Record<string, { on: boolean }> }
    expect(routines.routines.morning.on).toBe(true)
    expect(routines.routines.evening.on).toBe(false)
    expect(await seriousViolations()).toEqual([])
    await click(button('Finish'))
    expect(dialog()).toBeNull()
    expect(api.settings[AI_ONBOARDED_KEY]).toBe(true)
  })

  it('skips a step without saving it, and goes back', async () => {
    await firstOpen()
    await click(button('Skip this step'))
    await click(button('Skip this step'))
    await type('Who are you?', 'Ana')
    await click(button('Skip this step'))
    expect(api.settings[AI_CONTEXT_KEY]).toBeUndefined()
    await click(button('Back'))
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('About you')
    await act(async () => closeOnboarding())
  })
})
