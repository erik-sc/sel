import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PRIVATE_MESSAGE } from '../../shared/aiPrivate'
import { FINANCE_DB, FINANCE_PAGE_ID, LEDGER } from '../../shared/finance'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import * as markdown from '../markdown'
import { financeExists, readBooks } from './store'
import { brl, callFinanceTool, parseAmount } from './tools'
import { FINANCE_PACK } from './toolspecs'

const NOW = new Date(2026, 10, 10, 12) // 10 November 2026, local

describe('amounts as people write them', () => {
  it('reads numbers and text, in either notation', () => {
    expect(parseAmount(42.9)).toBe(4290)
    expect(parseAmount('42,90')).toBe(4290)
    expect(parseAmount('R$ 1.234,56')).toBe(123456)
    expect(parseAmount('1,234.56')).toBe(123456)
    expect(parseAmount('1.234')).toBe(123400)
    expect(parseAmount('12.5')).toBe(1250)
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount(Number.NaN)).toBeNull()
  })

  it('writes them as reais', () => {
    expect(brl(123456)).toBe('R$ 1.234,56')
    expect(brl(5)).toBe('R$ 0,05')
    expect(brl(-1000)).toBe('-R$ 10,00')
  })
})

describe('the finance tools', () => {
  let repo: Repository
  const call = (name: string, args: Record<string, unknown> = {}): string => callFinanceTool({ repo, markdown }, name, args, NOW)
  const idOf = (text: string, title: string): string => new RegExp(`${title} \\[([^\\]]+)\\]`, 'u').exec(text)?.[1] as string

  beforeEach(() => {
    // The rows are stamped on the clock the entries are dated on.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    repo = openTestRepository()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads nothing, and creates nothing, before something is entered', () => {
    expect(call('finance_month')).toContain('has nothing yet')
    expect(call('finance_entries')).toContain('has nothing yet')
    expect(financeExists(repo)).toBe(false)
    expect(repo.get(FINANCE_PAGE_ID)).toBeNull()
  })

  it('sets the block up with the first thing entered: a page with five databases', () => {
    call('finance_account', { name: 'Conta', balance: 5000 })
    expect(financeExists(repo)).toBe(true)
    const page = repo.get(FINANCE_PAGE_ID)
    expect(page?.parentId).toBeNull()
    expect(page?.content).toEqual(Object.values(FINANCE_DB))
    // And again from the trash, with a property that went missing put back.
    const schema = { ...repo.get(FINANCE_DB.ledger)?.props.schema }
    delete schema[LEDGER.split]
    repo.update(FINANCE_DB.ledger, { props: { schema } })
    repo.delete(FINANCE_DB.boxes)
    expect(financeExists(repo)).toBe(false)
    call('finance_box', { name: 'Reserva', balance: 100 })
    expect(financeExists(repo)).toBe(true)
    expect(repo.get(FINANCE_DB.ledger)?.props.schema?.[LEDGER.split]?.type).toBe('text')
  })

  it('adds an expense, an income and a transfer, and the accounts follow', () => {
    call('finance_account', { name: 'Conta', balance: '5.000,00' })
    call('finance_box', { name: 'Reserva', balance: 10000, goal: 20000, purpose: 'emergência', yield: 0.9 })
    const added = call('finance_add', { description: 'Mercado', amount: '120,50', category: 'Mercado', account: 'conta' })
    expect(added).toContain('Mercado [')
    expect(added).toContain('R$ 120,50')
    expect(added).toContain('2026-11-10')
    call('finance_add', { description: 'Freela', amount: 1000, kind: 'income', account: 'Conta' })
    call('finance_add', { description: 'Guardar', amount: 500, kind: 'transfer', account: 'Conta', to: 'Reserva' })
    const month = call('finance_month')
    expect(month).toContain('In the accounts: R$ 5.379,50')
    expect(month).toContain('Reserva: R$ 10.500,00 of R$ 20.000,00')
    expect(month).toContain('Mercado: R$ 120,50 spent, no limit set')
    expect(month).toContain('other income: R$ 1.000,00')
    // The option was found by its name whatever its case: one account, not two.
    expect(repo.get(FINANCE_DB.ledger)?.props.schema?.[LEDGER.account]?.options).toHaveLength(1)
  })

  it('puts a card purchase on its invoice, and instalments on the ones after', () => {
    call('finance_account', { name: 'Nubank', type: 'card', closing_day: 26, due_day: 3 })
    const one = call('finance_add', { description: 'Uber', amount: 30, account: 'Nubank', category: 'Transporte' })
    expect(one).toContain('fatura 2026-12')
    const many = call('finance_add', { description: 'Sofá', amount: 1000, account: 'Nubank', instalments: 3 })
    expect(many).toContain('Added 3 instalments, R$ 1.000,00 in all')
    expect(many).toContain('2026-11-10 · Sofá')
    expect(many).toContain('R$ 333,34 · gasto · Nubank · fatura 2026-12 · parcela 1/3')
    expect(many).toContain('2026-12-10 · Sofá')
    expect(many).toContain('fatura 2027-01 · parcela 2/3')
    expect(many).toContain('fatura 2027-02 · parcela 3/3')
    const december = call('finance_month', { month: '2026-12' })
    expect(december).toContain('Card Nubank: the 2026-12 invoice is R$ 363,34, due 2026-12-03')
    // Paying it is a transfer, and then it is paid.
    call('finance_account', { name: 'Conta', balance: 1000 })
    expect(call('finance_pay_invoice', { card: 'nubank', month: '2026-12', account: 'Conta' })).toContain(
      'R$ 363,34 · transferência · Conta · → Nubank'
    )
    expect(call('finance_month', { month: '2026-12' })).toContain('(paid)')
    expect(call('finance_pay_invoice', { card: 'Nubank', month: '2026-12', account: 'Conta' })).toContain('already paid')
    expect(call('finance_month')).toContain('In the accounts: R$ 636,66')
    // Deleting one instalment with "series" takes the three, to the trash.
    const id = idOf(many, 'Sofá')
    expect(call('finance_delete', { id, series: true })).toContain('Moved 3 instalments')
    expect(repo.get(id)?.trashedAt).not.toBeNull()
    expect(call('finance_entries', { month: 'all', search: 'sofa' })).toContain('nothing')
  })

  it('keeps fixed bills and expected income, and marks them paid for a month', () => {
    call('finance_recurring', { name: 'Aluguel', amount: 2000, day: 5, category: 'Casa', account: 'Conta' })
    call('finance_recurring', { name: 'Salário', amount: 8000, kind: 'income', day: 1, account: 'Conta' })
    expect(() => call('finance_recurring', { name: 'Internet' })).toThrow(/give its amount/)
    let month = call('finance_month')
    expect(month).toContain('Fixed bills: R$ 0,00 paid, R$ 2.000,00 pending')
    expect(month).toContain('pending, due 2026-11-05 (late)')
    expect(month).toContain('R$ 8.000,00 still expected')
    expect(call('finance_pay', { name: 'aluguel' })).toContain('Paid for 2026-11')
    expect(call('finance_pay', { name: 'Aluguel' })).toContain('already paid for 2026-11')
    expect(call('finance_pay', { name: 'Salário', amount: 8100 })).toContain('Received for 2026-11')
    month = call('finance_month')
    expect(month).toContain('Fixed bills: R$ 2.000,00 paid, R$ 0,00 pending')
    expect(month).toContain('Income: R$ 8.100,00 received, R$ 0,00 still expected')
    // A bill paid is not day-to-day spending: it is not in the budget.
    expect(month).not.toContain('Casa: R$ 2.000,00 spent')
    expect(month).toContain('Forecast for 2026-12: income R$ 8.000,00 − bills R$ 2.000,00')
    expect(() => call('finance_pay', { name: 'Luz' })).toThrow(/There are: “Aluguel”, “Salário”/)
    // Changed by name, not added twice; stopping it keeps it out of the month.
    expect(call('finance_recurring', { name: 'ALUGUEL', amount: 2100 })).toContain('Updated')
    call('finance_recurring', { name: 'Aluguel', active: false })
    expect(readBooks(repo).recurring).toHaveLength(2)
    expect(call('finance_month', { month: '2026-12' })).not.toContain('Aluguel')
  })

  it('keeps a budget by category', () => {
    call('finance_budget', { category: 'Mercado', limit: 1000 })
    call('finance_budget', { category: 'Lazer', limit: 300 })
    call('finance_add', { description: 'Feira', amount: 250, category: 'mercado' })
    call('finance_add', { description: 'Show', amount: 400, category: 'Lazer' })
    const month = call('finance_month')
    expect(month).toContain('Day-to-day budget: R$ 650,00 spent of R$ 1.300,00; R$ 750,00 left for 21 days (R$ 250,00 a week)')
    expect(month).toContain('Mercado: R$ 250,00 of R$ 1.000,00 · R$ 750,00 left')
    expect(month).toContain('Lazer: R$ 400,00 of R$ 300,00 · R$ 100,00 over')
    expect(call('finance_budget', { category: 'mercado', limit: 1200 })).toContain('Updated')
    expect(readBooks(repo).budget).toHaveLength(2)
  })

  it('splits shared expenses and settles them up', () => {
    const dinner = call('finance_add', { description: 'Jantar', amount: 90, split_with: ['Ana', 'Bia'], group: 'Praia' })
    expect(dinner).toContain('dividido: Eu R$ 30,00, Ana R$ 30,00, Bia R$ 30,00')
    call('finance_add', { description: 'Gasolina', amount: 40, paid_by: 'Ana', shares: { eu: 25, Ana: 15 } })
    expect(() => call('finance_add', { description: 'X', amount: 40, shares: { Eu: 25, Ana: 10 } })).toThrow(/add up to R\$ 35,00/)
    expect(() => call('finance_add', { description: 'X', amount: 40, paid_by: 'Ana' })).toThrow(/split_with/)
    let balances = call('finance_balances')
    expect(balances).toContain('Bia owes you R$ 30,00')
    expect(balances).toContain('Ana owes you R$ 5,00')
    expect(call('finance_balances', { group: 'praia' })).toContain('Ana owes you R$ 30,00')
    // Only my part is my spending.
    expect(call('finance_month')).toContain('Sem categoria: R$ 55,00 spent')
    expect(call('finance_settle', { person: 'Bia', amount: 30, direction: 'received' })).toContain('You and Bia are even.')
    expect(call('finance_settle', { person: 'Ana', amount: 2, direction: 'received' })).toContain('Ana still owes you R$ 3,00.')
    balances = call('finance_balances')
    expect(balances).not.toContain('Bia owes')
    expect(call('finance_entries', { person: 'bia' })).toContain('Jantar')
    expect(call('finance_entries', { kind: 'settlement' })).toContain('2 entries')
  })

  it('reads a receipt line by line, and scales the parts to what was paid', () => {
    const text = call('finance_receipt', {
      store: 'Bar do Zé',
      items: [
        { name: 'Pizza', amount: 60, people: ['Eu', 'Ana'] },
        { name: 'Suco', amount: 10, people: ['Ana'] },
        { name: 'Água', amount: 30, qty: 3 }
      ],
      split_with: ['Ana', 'Bia'],
      total: 110,
      category: 'Lazer'
    })
    // Pizza 30/30, juice all Ana's, water in three: Eu 40, Ana 50, Bia 10; then scaled by 110/100.
    expect(text).toContain('R$ 110,00')
    expect(text).toContain('dividido: Eu R$ 44,00, Ana R$ 55,00, Bia R$ 11,00')
    expect(text).toContain('3 items kept')
    expect(text).toContain('scaled to the R$ 110,00 paid')
    const id = idOf(text, 'Bar do Zé')
    const row = repo.get(id)
    expect(JSON.parse(String(row?.props.values?.[LEDGER.items]))).toHaveLength(3)
    expect(markdown.pageToMarkdown(repo, id).markdown).toContain('Pizza')
    // All mine: not a shared expense.
    expect(call('finance_receipt', { store: 'Mercado', items: [{ name: 'Arroz', amount: '25,90' }] })).not.toContain('dividido')
  })

  it('changes an entry, keeping the proportions of a split and the invoice of a card', () => {
    call('finance_account', { name: 'Nubank', type: 'card', closing_day: 26, due_day: 3 })
    const added = call('finance_add', { description: 'Jantar', amount: 100, account: 'Nubank', split_with: ['Ana'] })
    const id = idOf(added, 'Jantar')
    const changed = call('finance_update', { id, amount: 150, date: '2026-11-28', category: 'Lazer', description: 'Jantar de sexta' })
    expect(changed).toContain('Jantar de sexta')
    expect(changed).toContain('R$ 150,00')
    expect(changed).toContain('dividido: Eu R$ 75,00, Ana R$ 75,00')
    expect(changed).toContain('fatura 2027-01')
    expect(call('finance_update', { id, split_with: [], account: null })).not.toContain('dividido')
    expect(repo.get(id)?.props.values?.[LEDGER.invoice]).toBeUndefined()
    expect(() => call('finance_update', { id })).toThrow(/what to change/)
    expect(() => call('finance_update', { id: 'nope', amount: 1 })).toThrow(/Nothing in Finance/)
  })

  it('sorts out a statement brought in whole: the card apart from the account', () => {
    // The account's balance is told today; the statement of the days before moves nothing.
    call('finance_account', { name: 'Conta', balance: 2000 })
    call('finance_add', { description: 'Mercado', amount: 300, account: 'Conta', category: 'Mercado', date: '2026-11-04' })
    call('finance_add', { description: 'Cinema', amount: 80, account: 'Nubank', date: '2026-10-20' })
    const payment = call('finance_add', { description: 'Pagamento de fatura Nubank', amount: 80, account: 'Conta', date: '2026-11-03' })
    call('finance_add', { description: 'Mercado', amount: 300, account: 'Conta', category: 'Mercado', date: '2026-11-04' })
    call('finance_add', { description: 'Sem conta', amount: 10, date: '2026-11-05' })
    expect(call('finance_month')).toContain('In the accounts: R$ 2.000,00')

    // The card is registered after its purchases were entered: they fall on its invoices all the same.
    call('finance_account', { name: 'Nubank', type: 'card', closing_day: 26, due_day: 3 })
    expect(call('finance_month')).toContain('Card Nubank: the 2026-11 invoice is R$ 80,00')

    const review = call('finance_review')
    expect(review).toContain('Invoice payments entered as expenses (1)')
    expect(review).toContain('Entries that look entered twice (2)')
    expect(review).toContain('Entries with no account (1)')
    expect(review).toContain('Expenses with no category (2)')

    // The payment becomes a transfer to the card: counted once, and the invoice is paid.
    const fixed = call('finance_update', { id: idOf(payment, 'Pagamento de fatura Nubank'), kind: 'transfer', to: 'Nubank' })
    expect(fixed).toContain('transferência')
    expect(fixed).toContain('→ Nubank')
    expect(call('finance_month')).toContain('the 2026-11 invoice is R$ 80,00, due 2026-11-03 (paid)')
    expect(call('finance_review')).not.toContain('Invoice payments entered as expenses')
    expect(() => call('finance_update', { id: idOf(payment, 'Pagamento de fatura Nubank'), kind: 'transfer', to: null })).toThrow(ToolError)
  })

  it('walks a balance forward from the day it is of', () => {
    call('finance_account', { name: 'Conta', balance: 1000, as_of: '2026-10-31' })
    call('finance_add', { description: 'Antes', amount: 50, account: 'Conta', date: '2026-10-30' })
    call('finance_add', { description: 'Depois', amount: 200, account: 'Conta', date: '2026-11-02' })
    expect(call('finance_month')).toContain('In the accounts: R$ 800,00')
    expect(() => call('finance_account', { name: 'Conta', as_of: '2026-10-31' })).toThrow(ToolError)
    expect(() => call('finance_account', { name: 'Conta', balance: 1, as_of: '2026-12-31' })).toThrow(ToolError)
  })

  it('moves a card purchase to the invoice said', () => {
    call('finance_account', { name: 'Nubank', type: 'card', closing_day: 26, due_day: 3 })
    const added = call('finance_add', { description: 'Livro', amount: 60, account: 'Nubank', date: '2026-10-26' })
    expect(added).toContain('fatura 2026-11')
    expect(call('finance_update', { id: idOf(added, 'Livro'), invoice: '2026-12' })).toContain('fatura 2026-12')
    expect(call('finance_update', { id: idOf(added, 'Livro'), invoice: null })).toContain('fatura 2026-11')
    expect(() => call('finance_update', { id: idOf(added, 'Livro'), invoice: 'dezembro' })).toThrow(ToolError)
  })

  it('gives the month as data for a dashboard', () => {
    call('finance_account', { name: 'Conta', balance: 1000 })
    call('finance_budget', { category: 'Mercado', limit: 500 })
    call('finance_add', { description: 'Feira', amount: 120, category: 'Mercado', account: 'Conta' })
    const data = JSON.parse(call('finance_month', { format: 'json' })) as Record<string, unknown>
    expect(data).toMatchObject({
      month: '2026-11',
      currency: 'BRL',
      inAccounts: 880,
      budget: { limit: 500, spent: 120, left: 380, categories: [{ category: 'Mercado', limit: 500, spent: 120, left: 380 }] },
      nextMonth: { month: '2026-12' }
    })
  })

  it('projects the reserve', () => {
    call('finance_box', { name: 'Reserva', balance: 10000, yield: 1 })
    const text = call('finance_projection', { months: 2, monthly: 1000 })
    expect(text).toContain('The reserve is R$ 10.000,00 today')
    expect(text).toContain('2026-12: R$ 11.100,00 (saved R$ 1.000,00, yielded R$ 100,00)')
    expect(text).toContain('2027-01: R$ 12.211,00')
  })

  it('refuses what cannot be read as asked', () => {
    expect(() => call('finance_add', { description: 'x', amount: 0 })).toThrow(ToolError)
    expect(() => call('finance_add', { description: 'x', amount: -5 })).toThrow(/more than zero/)
    expect(() => call('finance_add', { description: 'x', amount: 5, date: '2026-02-30' })).toThrow(/YYYY-MM-DD/)
    expect(() => call('finance_add', { description: 'x', amount: 5, kind: 'transfer', account: 'A' })).toThrow(/transfer needs/)
    expect(() => call('finance_add', { description: 'x', amount: 5, kind: 'income', instalments: 2 })).toThrow(/instalments/)
    // None of those set the block up.
    expect(financeExists(repo)).toBe(false)
    expect(call('finance_month', { month: '2026-13' })).toContain('has nothing yet')
    call('finance_box', { name: 'R', balance: 1 })
    expect(() => call('finance_month', { month: '2026-13' })).toThrow(/YYYY-MM/)
    expect(() => call('nope')).toThrow(/No such tool/)
  })

  it('stays closed when the user keeps it private from the AI', () => {
    call('finance_add', { description: 'Segredo', amount: 10 })
    repo.update(FINANCE_PAGE_ID, { props: { aiPrivate: true } })
    expect(() => call('finance_month')).toThrow(new ToolError(AI_PRIVATE_MESSAGE))
    expect(() => call('finance_add', { description: 'Mais', amount: 10 })).toThrow(new ToolError(AI_PRIVATE_MESSAGE))
  })

  it('lists every tool with a closed schema', () => {
    for (const { spec, scope } of FINANCE_PACK.tools) {
      expect(scope).toBe('finance')
      expect(spec.name).toMatch(/^finance_[a-z_]+$/)
      expect(spec.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      // Every tool listed runs: an unknown one says "No such tool".
      try {
        call(spec.name)
      } catch (err) {
        expect(err).toBeInstanceOf(ToolError)
        expect((err as Error).message).not.toBe('No such tool.')
      }
    }
  })
})
