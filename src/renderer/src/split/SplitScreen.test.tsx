// @vitest-environment happy-dom
// The household screen before it is set up, with a month between two people, and what its
// buttons and forms ask of the block's tools.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntryView, HouseholdView } from '@shared/finance/api'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'
import { useHome } from '@/home/store'

const { SplitScreen } = await import('./SplitScreen')

const NOW = new Date(2026, 10, 10, 12)

const entry = (over: Partial<EntryView>): EntryView => ({
  id: 'e1',
  date: '2026-11-09',
  description: 'Mercado',
  amount: 300,
  kind: 'expense',
  category: 'Supermercado',
  account: null,
  to: null,
  instalment: null,
  invoice: null,
  planned: false,
  paidByMe: true,
  paidBy: 'Eu',
  mine: 150,
  theirs: 150,
  ...over
})

const UNSET: HouseholdView = {
  household: { partner: '', myShare: 50, group: 'Casa' },
  month: '2026-11',
  today: '2026-11-10',
  balance: 0,
  total: 0,
  mine: { share: 0, paid: 0 },
  theirs: { share: 0, paid: 0 },
  byCategory: [],
  expenses: [],
  bills: [],
  settlements: [],
  categories: [],
  accountNames: []
}

const FULL: HouseholdView = {
  ...UNSET,
  household: { partner: 'Alice', myShare: 50, group: 'Casa' },
  balance: 1448,
  total: 3430,
  mine: { share: 1715, paid: 3300 },
  theirs: { share: 1715, paid: 130 },
  byCategory: [
    { category: 'Aluguel', amount: 3000 },
    { category: 'Supermercado', amount: 300 }
  ],
  expenses: [
    entry({}),
    entry({ id: 'e2', description: 'Internet', amount: 130, paidByMe: false, paidBy: 'Alice', mine: 65, theirs: 65, category: 'Internet' })
  ],
  bills: [
    {
      id: 'b1',
      name: 'Aluguel',
      amount: 3000,
      day: 5,
      category: 'Aluguel',
      paidByMe: true,
      myShare: 50,
      launched: entry({ id: 'e3', description: 'Aluguel', amount: 3000, date: '2026-11-05' })
    },
    { id: 'b2', name: 'Luz', amount: 180, day: 12, category: 'Luz', paidByMe: false, myShare: 50, launched: null }
  ],
  settlements: [
    entry({
      id: 's1',
      kind: 'settlement',
      description: 'Acerto: Alice pagou',
      amount: 200,
      paidByMe: false,
      paidBy: 'Alice',
      mine: null,
      theirs: null,
      category: null
    })
  ],
  categories: ['Supermercado', 'Aluguel'],
  accountNames: ['Nubank']
}

let household: ReturnType<typeof vi.fn>
let run: ReturnType<typeof vi.fn>

function install(view: HouseholdView): void {
  household = vi.fn(async (asked: string) => ({ ...view, month: asked }))
  run = vi.fn(async () => 'ok')
  const base = fakeApi() as Record<string, unknown>
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) => (prop === 'finance' ? { household, run } : target[prop as string])
  })
}

const text = (): string => document.body.textContent ?? ''
const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label
  ) as HTMLButtonElement
const click = async (el: Element): Promise<void> => {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  await settle()
}
const type = async (label: string, value: string, within: ParentNode = document): Promise<void> => {
  const field = [...within.querySelectorAll('label')].find((l) => l.querySelector('.fin-field-label')?.textContent === label)
  const input = field?.querySelector('input, select') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
const submit = async (form: Element): Promise<void> => {
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await settle()
}

beforeEach(() => {
  useHome.setState({ locale: 'pt-BR' })
})

afterEach(cleanup)

describe('the household screen', () => {
  it('asks who the household is shared with, and asks the month again once told', async () => {
    install(UNSET)
    await render(<SplitScreen now={NOW} />)
    await settle()
    expect(text()).toContain('Com quem você divide a casa?')
    expect(document.querySelector('.fin-month')).toBeNull()
    await type('Nome dela ou dele', 'Alice')
    const before = household.mock.calls.length
    await submit(document.querySelector('.fin-form') as Element)
    expect(run).toHaveBeenLastCalledWith('split_config', { partner: 'Alice', my_share: 50 })
    // A setting is no change of the workspace: the screen asks again by itself.
    expect(household.mock.calls.length).toBeGreaterThan(before)
    expect(await seriousViolations()).toEqual([])
  })

  it('says who owes whom, the month in numbers, the fixed bills and the expenses', async () => {
    install(FULL)
    await render(<SplitScreen now={NOW} />)
    await settle()
    const page = text()
    expect(page).toContain('Você e Alice')
    expect(page).toContain('Alice deve para você')
    expect(page).toContain('R$ 1.448,00')
    expect(page).toContain('O mês: novembro de 2026')
    expect(page).toContain('R$ 3.430,00')
    expect(page).toContain('2 gastos')
    expect(page).toContain('Alice: parte')
    expect(page).toContain('pagou R$ 130,00')
    expect(page).toContain('Você paga · 50/50 · dia 5 · lançada em 05/11')
    expect(page).toContain('Alice paga · 50/50 · dia 12')
    expect(page).toContain('Alice pagou · você R$ 65,00 · Alice R$ 65,00')
    expect(page).toContain('Alice → Você')
    expect(page).toContain('Padrão: 50/50')
    expect(page).toContain('Só de Alice (você pagou)')
    expect(await seriousViolations()).toEqual([])
  })

  it('settles up, launches a bill and enters an expense through the block’s tools', async () => {
    install(FULL)
    await render(<SplitScreen now={NOW} />)
    await settle()
    await click(button('Registrar acerto de R$ 1.448,00'))
    expect(run).toHaveBeenLastCalledWith('split_settle', {})
    await click(button('Lançar'))
    expect(run).toHaveBeenLastCalledWith('split_launch', { name: 'b2', month: '2026-11' })

    const form = document.querySelector('.fin-section .fin-form') as HTMLFormElement
    await type('O quê', 'Farmácia', form)
    await type('Total', '80', form)
    await type('Quem pagou', 'partner', form)
    await type('Como dividir', 'mine', form)
    await submit(form)
    expect(run).toHaveBeenLastCalledWith('split_add', { description: 'Farmácia', amount: '80', paid_by: 'partner', how: 'mine' })

    await click(button('Mover Mercado para a lixeira'))
    expect(run).toHaveBeenLastCalledWith('finance_delete', { id: 'e1' })
  })

  it('says you are even, and when you owe', async () => {
    install({ ...FULL, balance: 0 })
    await render(<SplitScreen now={NOW} />)
    await settle()
    expect(text()).toContain('Vocês estão quites')
    expect(button('Registrar acerto de R$ 0,00')).toBeUndefined()
    await cleanup()
    install({ ...FULL, balance: -75.5 })
    useHome.setState({ locale: 'en' })
    await render(<SplitScreen now={NOW} />)
    await settle()
    expect(text()).toContain('You owe Alice')
    expect(text()).toContain('R$ 75,50')
    expect(button('Record a payment of R$ 75,50')).toBeDefined()
  })
})
