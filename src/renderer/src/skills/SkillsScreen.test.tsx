// @vitest-environment happy-dom
// The Skills screen: the user's skills and sel's own, making one, describing it, deleting it.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillView } from '@shared/skills/api'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'
import { useHome } from '@/home/store'

const opened: string[] = []
vi.mock('@/store/tabs', () => ({ openPage: (id: string) => void opened.push(id) }))

const { SkillsScreen } = await import('./SkillsScreen')

const OWN: SkillView = {
  name: 'fechar-o-mes',
  description: 'Fecha o mês nas Finanças.',
  builtIn: false,
  id: 'p1',
  updatedAt: Date.UTC(2026, 10, 14, 12)
}
const BARE: SkillView = { name: 'revisao-semanal', description: '', builtIn: false, id: 'p2', updatedAt: Date.UTC(2026, 10, 15, 12) }
const BUILT_IN: SkillView = {
  name: 'skill-creator',
  description: 'Makes or improves a skill kept in sel.',
  builtIn: true,
  id: null,
  updatedAt: null
}

let skills: SkillView[]
const calls = {
  create: vi.fn(async (_name: string, _description: string) => 'p9'),
  describe: vi.fn(async (_name: string, _description: string) => undefined),
  remove: vi.fn(async (_name: string) => undefined),
  file: vi.fn(async (name: string) => `---\nname: ${name}\n---\n\n# Body of ${name}\n`)
}

function install(list: SkillView[]): void {
  skills = list
  const base = fakeApi() as Record<string, unknown>
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) => (prop === 'skills' ? { list: async () => skills, ...calls } : target[prop as string])
  })
}

const text = (): string => document.body.textContent ?? ''
const button = (label: string, within: ParentNode = document): HTMLButtonElement =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label) as HTMLButtonElement
const click = async (el: Element): Promise<void> => {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  await settle()
}
const field = (label: string, within: ParentNode = document): HTMLInputElement | HTMLTextAreaElement =>
  [...within.querySelectorAll('label')]
    .find((each) => each.querySelector('span')?.textContent === label)
    ?.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = async (form: Element): Promise<void> => {
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await settle()
}
const rowOf = (name: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('.skl-skill')].find(
    (row) => row.querySelector('.skl-name')?.textContent === name
  ) as HTMLElement

describe('the Skills screen', () => {
  beforeEach(() => {
    opened.length = 0
    for (const call of Object.values(calls)) call.mockClear()
    useHome.setState({ locale: 'en' })
  })
  afterEach(cleanup)

  it('lists the user’s skills and sel’s own, and opens a skill as the page it is', async () => {
    install([BARE, OWN, BUILT_IN])
    await render(<SkillsScreen />)
    await settle()
    expect([...document.querySelectorAll('.skl-name')].map((el) => el.textContent)).toEqual([
      'revisao-semanal',
      'fechar-o-mes',
      'skill-creator'
    ])
    expect(rowOf('fechar-o-mes').textContent).toContain('Fecha o mês nas Finanças.')
    // A skill with no description says what that costs.
    expect(rowOf('revisao-semanal').textContent).toContain('Claude cannot tell when to use it')
    await click(button('Open', rowOf('fechar-o-mes')))
    expect(opened).toEqual(['p1'])
    // One of sel's own is read here: it has no page, and cannot be changed.
    expect(button('Delete', rowOf('skill-creator'))).toBeUndefined()
    const details = rowOf('skill-creator').querySelector('details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    await settle()
    expect(calls.file).toHaveBeenCalledWith('skill-creator')
    expect(rowOf('skill-creator').textContent).toContain('# Body of skill-creator')
    expect(await seriousViolations()).toEqual([])
  })

  it('makes a skill from whatever was typed as its name, and opens it to be written', async () => {
    install([OWN, BUILT_IN])
    await render(<SkillsScreen />)
    await settle()
    const form = document.querySelector('form.skl-new') as HTMLFormElement
    expect(button('Create and write it').disabled).toBe(true)
    await type(field('Name'), 'Revisão semanal!')
    expect(text()).toContain('It will be called revisao-semanal.')
    await type(field('What it does, and when to use it'), 'Reviews the week.')
    await submit(form)
    expect(calls.create).toHaveBeenCalledWith('revisao-semanal', 'Reviews the week.')
    expect(opened).toEqual(['p9'])
    // A name there already is, the user's or sel's own, is said and not sent.
    for (const taken of ['Fechar o mês', 'skill creator']) {
      await type(field('Name'), taken)
      expect(document.querySelector('form.skl-new [role="alert"]')?.textContent).toBe('There is already a skill with that name.')
      expect(button('Create and write it').disabled).toBe(true)
    }
    await submit(form)
    expect(calls.create).toHaveBeenCalledTimes(1)
  })

  it('changes a description and deletes a skill', async () => {
    install([OWN, BUILT_IN])
    await render(<SkillsScreen />)
    await settle()
    await click(button('Description', rowOf('fechar-o-mes')))
    const row = rowOf('fechar-o-mes')
    await type(field('What it does, and when to use it', row), 'Closes the month. Use when I say “close the month”.')
    await submit(row.querySelector('form') as HTMLFormElement)
    expect(calls.describe).toHaveBeenCalledWith('fechar-o-mes', 'Closes the month. Use when I say “close the month”.')
    await click(button('Delete', rowOf('fechar-o-mes')))
    expect(calls.remove).toHaveBeenCalledWith('fechar-o-mes')
  })

  it('says so in Portuguese when there is none yet', async () => {
    useHome.setState({ locale: 'pt-BR' })
    install([BUILT_IN])
    await render(<SkillsScreen />)
    await settle()
    expect(text()).toContain('Nenhuma skill sua ainda.')
    expect(text()).toContain('Do sel')
  })
})
