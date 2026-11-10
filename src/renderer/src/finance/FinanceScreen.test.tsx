// @vitest-environment happy-dom
// The Finance screen with a month of its own, with nothing entered yet, and what its buttons and
// its form ask of the block's tools.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinanceMonthView } from '@shared/finance/api'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'
import { useHome } from '@/home/store'
import { argsOf, filled, monthName, money, shiftMonth } from './kit'

const { FinanceScreen } = await import('./FinanceScreen')

const NOW = new Date(2026, 10, 10, 12)

const EMPTY: FinanceMonthView = {
  empty: true,
  month: '2026-11',
  today: '2026-11-10',
  currency: 'BRL',
  accounts: [],
  inAccounts: 0,
  income: { received: 0, expected: 0, lines: [] },
  bills: { paid: 0, pending: 0, lines: [] },
  cards: [],
  budget: { limit: 0, spent: 0, left: 0, daysLeft: 21, perWeek: 0, categories: [] },
  boxes: [],
  inBoxes: 0,
  owed: [],
  freeAtEndOfMonth: 0,
  nextMonth: { month: '2026-12', income: 0, bills: 0, budget: 0, invoices: 0, free: 0 },
  entries: [],
  categories: [],
  accountNames: [],
  boxNames: []
}

const FULL: FinanceMonthView = {
  ...EMPTY,
  empty: false,
  accounts: [{ name: 'Nubank', type: 'checking', balance: 5379.5 }],
  inAccounts: 5379.5,
  income: {
    received: 0,
    expected: 8000,
    lines: [{ id: 'r1', name: 'Salário', amount: 8000, due: '2026-11-30', done: false, doneOn: null, late: false, category: null }]
  },
  bills: {
    paid: 2000,
    pending: 120,
    lines: [
      { id: 'r2', name: 'Aluguel', amount: 2000, due: '2026-11-05', done: true, doneOn: '2026-11-05', late: false, category: 'Casa' },
      { id: 'r3', name: 'Internet', amount: 120, due: '2026-11-08', done: false, doneOn: null, late: true, category: 'Casa' }
    ]
  },
  cards: [
    {
      card: 'Roxinho',
      invoice: '2026-11',
      due: '2026-11-03',
      paid: false,
      total: 363.34,
      entries: [],
      next: { invoice: '2026-12', total: 333.33 }
    }
  ],
  budget: {
    limit: 1300,
    spent: 650,
    left: 750,
    daysLeft: 21,
    perWeek: 250,
    categories: [
      { category: 'Mercado', group: null, limit: 1000, spent: 250, left: 750 },
      { category: 'Lazer', group: null, limit: 300, spent: 400, left: -100 },
      { category: 'Saúde', group: null, limit: null, spent: 55, left: null }
    ]
  },
  boxes: [{ name: 'Reserva', balance: 10500, goal: 20000, purpose: 'emergência' }],
  inBoxes: 10500,
  owed: [{ person: 'Bia', amount: 30 }],
  freeAtEndOfMonth: 12146.16,
  nextMonth: { month: '2026-12', income: 8000, bills: 2120, budget: 1300, invoices: 333.33, free: 4246.67 },
  entries: [
    {
      id: 'e1',
      date: '2026-11-09',
      description: 'Feira',
      amount: 250,
      kind: 'expense',
      category: 'Mercado',
      account: 'Nubank',
      to: null,
      instalment: null,
      planned: false,
      paidByMe: true,
      paidBy: 'Eu',
      mine: null,
      theirs: null
    }
  ],
  categories: ['Mercado', 'Lazer'],
  accountNames: ['Nubank', 'Roxinho'],
  boxNames: ['Reserva']
}

let month: ReturnType<typeof vi.fn>
let run: ReturnType<typeof vi.fn>

function install(view: FinanceMonthView): void {
  month = vi.fn(async (asked: string) => ({ ...view, month: asked }))
  run = vi.fn(async () => 'ok')
  const base = fakeApi() as Record<string, unknown>
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) => (prop === 'finance' ? { month, run } : target[prop as string])
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
const type = async (label: string, value: string): Promise<void> => {
  const field = [...document.querySelectorAll('label')].find((l) => l.querySelector('.fin-field-label')?.textContent === label)
  const input = field?.querySelector('input, select') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}

beforeEach(() => {
  useHome.setState({ locale: 'pt-BR' })
})

afterEach(cleanup)

describe('what the screens share', () => {
  it('writes amounts in reais and months in the window’s language', () => {
    expect(money(1234.5)).toBe('R$ 1.234,50')
    expect(money(-10)).toBe('-R$ 10,00')
    expect(monthName('2026-11', 'pt-BR')).toBe('novembro de 2026')
    expect(monthName('2026-11', 'en')).toBe('November 2026')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('sends a form as a tool’s arguments: empty fields left out, days as numbers', () => {
    const fields = [
      { name: 'name', label: '', kind: 'text' as const },
      { name: 'amount', label: '', kind: 'amount' as const },
      { name: 'day', label: '', kind: 'day' as const },
      { name: 'category', label: '', kind: 'text' as const }
    ]
    expect(argsOf(fields, { name: ' Aluguel ', amount: '2.000,00', day: '5', category: '' })).toEqual({
      name: 'Aluguel',
      amount: '2.000,00',
      day: 5
    })
    expect(filled({ a: '', b: 0, c: null, d: 'x' })).toEqual({ b: 0, d: 'x' })
  })
})

describe('the Finance screen', () => {
  it('says what should be left, then where it comes from', async () => {
    install(FULL)
    await render(<FinanceScreen now={NOW} />)
    await settle()
    expect(month).toHaveBeenCalledWith('2026-11')
    const page = text()
    expect(page).toContain('Sobra prevista no fim do mês')
    expect(page).toContain('R$ 12.146,16')
    expect(page).toContain('Nubank')
    expect(page).toContain('Salário')
    expect(page).toContain('prevista para 30/11')
    expect(page).toContain('paga em 05/11')
    expect(page).toContain('vence em 08/11 · atrasada')
    expect(page).toContain('Fatura de novembro de 2026')
    expect(page).toContain('restam R$ 750,00')
    expect(page).toContain('R$ 100,00 acima')
    expect(page).toContain('sem limite definido')
    expect(page).toContain('Restam R$ 750,00 para 21 dias: R$ 250,00 por semana.')
    expect(page).toContain('Reserva')
    expect(page).toContain('Bia te deve R$ 30,00')
    expect(page).toContain('R$ 4.246,67 livres')
    expect(page).toContain('Feira')
    // The meters say in words what they draw.
    expect(document.querySelector('[aria-label="Lazer: R$ 400,00 de R$ 300,00"]')?.className).toContain('is-over')
    expect(await seriousViolations()).toEqual([])
  })

  it('pays a bill, enters an expense and moves an entry to the trash through the block’s tools', async () => {
    install(FULL)
    await render(<FinanceScreen now={NOW} />)
    await settle()
    await click(button('Paguei'))
    expect(run).toHaveBeenLastCalledWith('finance_pay', { name: 'r3', month: '2026-11' })
    await click(button('Recebi'))
    expect(run).toHaveBeenLastCalledWith('finance_pay', { name: 'r1', month: '2026-11' })

    await type('O quê', 'Padaria')
    await type('Valor', '12,50')
    await type('Categoria', 'Mercado')
    const form = document.querySelector('.fin-form') as HTMLFormElement
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()
    expect(run).toHaveBeenLastCalledWith('finance_add', { description: 'Padaria', amount: '12,50', kind: 'expense', category: 'Mercado' })
    // Sent: the form is empty again, the kind kept.
    expect((document.querySelector('.fin-form input') as HTMLInputElement).value).toBe('')

    await click(button('Mover Feira para a lixeira'))
    expect(run).toHaveBeenLastCalledWith('finance_delete', { id: 'e1' })
  })

  it('goes to another month and back', async () => {
    install(FULL)
    await render(<FinanceScreen now={NOW} />)
    await settle()
    await click(button('Próximo mês'))
    expect(month).toHaveBeenLastCalledWith('2026-12')
    expect(text()).toContain('dezembro de 2026')
    await click(button('Este mês'))
    expect(month).toHaveBeenLastCalledWith('2026-11')
    expect(button('Este mês')).toBeUndefined()
  })

  it('with nothing entered, says how to start and opens the set-up', async () => {
    install(EMPTY)
    useHome.setState({ locale: 'en' })
    await render(<FinanceScreen now={NOW} />)
    await settle()
    expect(text()).toContain('Nothing here yet')
    expect(text()).not.toContain('Left at the end of the month')
    expect((document.querySelector('details.fin-setup') as HTMLDetailsElement).open).toBe(true)
    await type('Name', 'Nubank')
    await type('Balance now', '5.000,00')
    const forms = document.querySelectorAll('.fin-form')
    await act(async () => forms[forms.length - 1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()
    expect(run).toHaveBeenLastCalledWith('finance_account', { name: 'Nubank', type: 'checking', balance: '5.000,00' })
    expect(await seriousViolations()).toEqual([])
  })

  it('says so when the month cannot be read', async () => {
    install(FULL)
    month.mockRejectedValue(new Error('no'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await render(<FinanceScreen now={NOW} />)
    await settle()
    expect(text()).toContain('Não deu para ler o mês.')
    quiet.mockRestore()
  })
})
