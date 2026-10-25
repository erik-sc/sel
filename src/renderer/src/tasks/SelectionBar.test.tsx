// @vitest-environment happy-dom
// The strip of a selection: absent for one row, present for two, its buttons ask for what the
// keys do, and Let go asks once with the count before it lets go (in English and in pt-BR).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'

const calls = vi.hoisted(() => ({ letGo: [] as string[][] }))
vi.mock('./edit', () => ({ letGoTasks: (ids: string[]) => void calls.letGo.push(ids) }))

const { SelectionBar } = await import('./SelectionBar')
const { useHome } = await import('@/home/store')

beforeAll(() => {
  Object.defineProperty(window, 'api', { value: fakeApi(), configurable: true })
})
afterEach(async () => {
  await cleanup()
  calls.letGo.length = 0
  useHome.setState({ locale: 'en' })
})

const handlers = () => ({ onMenu: vi.fn(), onToggle: vi.fn(), onClear: vi.fn(), onLetGo: vi.fn() })
const button = (name: RegExp, root: ParentNode = document): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((each) => name.test(each.textContent ?? '')) as HTMLButtonElement
const click = async (el: Element): Promise<void> => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await settle()
}

describe('SelectionBar', () => {
  it('is absent with one row selected and present with two', async () => {
    await render(<SelectionBar ids={['a']} {...handlers()} />)
    expect(document.querySelector('.task-bar')).toBeNull()
    await cleanup()
    await render(<SelectionBar ids={['a', 'b']} {...handlers()} />)
    expect(document.querySelector('.task-bar')?.textContent).toContain('2 selected')
  })

  it('asks for the same changes as the keys', async () => {
    const on = handlers()
    await render(<SelectionBar ids={['a', 'b', 'c']} {...on} />)
    await click(button(/^Date$/))
    await click(button(/^Priority$/))
    await click(button(/^Project$/))
    await click(button(/^Done$/))
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Deselect"]')!)
    expect(on.onMenu.mock.calls.map((call) => call[0])).toEqual(['date', 'priority', 'project'])
    expect(on.onToggle).toHaveBeenCalledOnce()
    expect(on.onClear).toHaveBeenCalledOnce()
    expect(calls.letGo).toEqual([])
  })

  it('asks once, naming the count, and lets go only on the second press', async () => {
    const on = handlers()
    await render(<SelectionBar ids={['a', 'b', 'c']} {...on} />)
    await click(button(/^Let go$/))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Let go of 3 tasks?')
    expect(calls.letGo).toEqual([])
    expect(await seriousViolations()).toEqual([])
    await click(button(/^Let go$/, dialog))
    expect(calls.letGo).toEqual([['a', 'b', 'c']])
    expect(on.onLetGo).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('lets nothing go when the question is cancelled', async () => {
    await render(<SelectionBar ids={['a', 'b']} {...handlers()} />)
    await click(button(/^Let go$/))
    await click(button(/^Cancel$/))
    expect(calls.letGo).toEqual([])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('speaks Portuguese, field by field', async () => {
    useHome.setState({ locale: 'pt-BR' })
    await render(<SelectionBar ids={['a', 'b', 'c']} {...handlers()} />)
    expect(document.querySelector('.task-bar')?.textContent).toContain('3 selecionadas')
    expect(document.querySelector('button[aria-label="Desmarcar"]')).toBeTruthy()
    for (const name of [/^Data$/, /^Prioridade$/, /^Projeto$/, /^Concluir$/, /^Deixar ir$/]) expect(button(name)).toBeTruthy()
    await click(button(/^Deixar ir$/))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Deixar ir 3 tarefas?')
  })

  it('is a group named for what it holds, with no aria-selected', async () => {
    await render(<SelectionBar ids={['a', 'b']} {...handlers()} />)
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Selected tasks')
    expect(document.querySelector('.task-bar [aria-selected]')).toBeNull()
  })
})
