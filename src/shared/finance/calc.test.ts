import { describe, expect, it } from 'vitest'
import {
  type Account,
  addMonths,
  addMonthsToDate,
  balanceOf,
  type Books,
  budget,
  dayOf,
  debts,
  type Entry,
  forecast,
  invoiceOf,
  mine,
  monthPicture,
  owedToMe,
  parts,
  projection
} from './calc'

let n = 0
const entry = (over: Partial<Entry>): Entry => ({
  id: `e${++n}`,
  title: 'x',
  cents: 1000,
  kind: 'expense',
  date: '2026-11-10',
  category: null,
  account: null,
  paid: true,
  paidBy: 'Eu',
  shares: null,
  group: null,
  to: null,
  invoice: null,
  instalment: null,
  series: null,
  recurring: null,
  ref: null,
  createdAt: 100,
  ...over
})

const card: Account = { id: 'c', name: 'Nubank', type: 'card', cents: 0, asOf: 0, closingDay: 26, dueDay: 3 }
const checking: Account = { id: 'a', name: 'Conta', type: 'checking', cents: 500_000, asOf: 50, closingDay: null, dueDay: null }
const books = (over: Partial<Books> = {}): Books => ({ entries: [], recurring: [], budget: [], accounts: [], boxes: [], ...over })

describe('months and days', () => {
  it('moves months across years and holds a day to its month', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(dayOf('2026-02', 31)).toBe('2026-02-28')
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('splits an amount into parts that add up', () => {
    expect(parts(1000, 3)).toEqual([334, 333, 333])
    expect(parts(100, 1)).toEqual([100])
  })
})

describe('the invoice a card purchase falls on', () => {
  it('goes to the invoice due after the closing day', () => {
    // Closes on the 26th, due on the 3rd of the month after.
    expect(invoiceOf('2026-11-10', card)).toBe('2026-12')
    expect(invoiceOf('2026-11-26', card)).toBe('2026-12')
    expect(invoiceOf('2026-11-27', card)).toBe('2027-01')
  })

  it('stays in the month when the due day comes after the closing day', () => {
    const other = { closingDay: 5, dueDay: 12 }
    expect(invoiceOf('2026-11-03', other)).toBe('2026-11')
    expect(invoiceOf('2026-11-06', other)).toBe('2026-12')
  })

  it('is the month after the purchase when the card says nothing', () => {
    expect(invoiceOf('2026-11-10', { closingDay: null, dueDay: null })).toBe('2026-12')
  })
})

describe('balances', () => {
  it('moves an account by what was entered since its balance was told', () => {
    const entries = [
      entry({ cents: 10_000, account: 'Conta', createdAt: 10 }), // before: already in the balance told
      entry({ cents: 20_000, account: 'conta', createdAt: 60 }),
      entry({ kind: 'income', cents: 100_000, account: 'Conta', createdAt: 70 }),
      entry({ kind: 'transfer', cents: 30_000, account: 'Conta', to: 'Reserva', createdAt: 80 }),
      entry({ cents: 5_000, account: 'Conta', paid: false, createdAt: 90 }), // planned
      entry({ cents: 7_000, account: 'Conta', paidBy: 'Ana', shares: { Eu: 3500, Ana: 3500 }, createdAt: 95 }) // Ana paid
    ]
    expect(balanceOf(checking, entries)).toBe(500_000 - 20_000 + 100_000 - 30_000)
    expect(balanceOf({ id: 'b', name: 'Reserva', cents: 0, asOf: 0 }, entries)).toBe(30_000)
  })

  it('counts a settlement into the account it came to, and out of the one that paid', () => {
    const entries = [
      entry({ kind: 'settlement', cents: 4_000, paidBy: 'Ana', to: 'Eu', account: 'Conta', createdAt: 60 }),
      entry({ kind: 'settlement', cents: 1_000, paidBy: 'Eu', to: 'Bia', account: 'Conta', createdAt: 61 })
    ]
    expect(balanceOf(checking, entries)).toBe(500_000 + 4_000 - 1_000)
  })
})

describe('what is mine', () => {
  it('is my part of a shared expense, all of my own and none of someone else’s', () => {
    expect(mine(entry({ cents: 900 }))).toBe(900)
    expect(mine(entry({ cents: 900, shares: { Eu: 300, Ana: 600 } }))).toBe(300)
    expect(mine(entry({ cents: 900, paidBy: 'Ana', shares: { eu: 450, Ana: 450 } }))).toBe(450)
    expect(mine(entry({ cents: 900, shares: { Ana: 900 } }))).toBe(0)
    expect(mine(entry({ kind: 'transfer' }))).toBe(0)
  })
})

describe('who owes whom', () => {
  const shared = [
    entry({ cents: 9000, shares: { Eu: 3000, Ana: 3000, Bia: 3000 } }), // I paid 90 for three
    entry({ cents: 4000, paidBy: 'Ana', shares: { Eu: 2000, Ana: 2000 } }), // Ana paid 40 for two
    entry({ cents: 6000, paidBy: 'Bia', shares: { Ana: 6000 }, group: 'Praia' }) // Bia paid for Ana
  ]

  it('nets every pair', () => {
    expect(debts(shared)).toEqual([
      { from: 'Ana', to: 'Bia', cents: 6000 },
      { from: 'Bia', to: 'Eu', cents: 3000 },
      { from: 'Ana', to: 'Eu', cents: 1000 }
    ])
    expect(owedToMe(shared)).toEqual([
      { person: 'Bia', cents: 3000 },
      { person: 'Ana', cents: 1000 }
    ])
  })

  it('settles with a payment, and keeps to one group when asked', () => {
    const settled = [...shared, entry({ kind: 'settlement', cents: 1000, paidBy: 'ana', to: 'Eu' })]
    expect(owedToMe(settled)).toEqual([{ person: 'Bia', cents: 3000 }])
    expect(debts(shared, 'praia')).toEqual([{ from: 'Ana', to: 'Bia', cents: 6000 }])
  })

  it('says what I owe as a negative', () => {
    expect(owedToMe([entry({ cents: 5000, paidBy: 'Ana', shares: { Eu: 5000 } })])).toEqual([{ person: 'Ana', cents: -5000 }])
  })
})

describe('the month', () => {
  const all = books({
    accounts: [checking, card],
    boxes: [{ id: 'b', name: 'Reserva', cents: 1_000_000, asOf: 0, goal: 2_000_000, purpose: 'emergência', yield: 1 }],
    recurring: [
      {
        id: 'r1',
        title: 'Salário',
        cents: 800_000,
        kind: 'income',
        day: 1,
        category: null,
        account: 'Conta',
        active: true,
        paidBy: 'Eu',
        group: null,
        share: null
      },
      {
        id: 'r2',
        title: 'Aluguel',
        cents: 200_000,
        kind: 'expense',
        day: 5,
        category: 'Casa',
        account: 'Conta',
        active: true,
        paidBy: 'Eu',
        group: null,
        share: null
      },
      {
        id: 'r3',
        title: 'Internet',
        cents: 10_000,
        kind: 'expense',
        day: 20,
        category: 'Casa',
        account: 'Conta',
        active: true,
        paidBy: 'Eu',
        group: null,
        share: null
      },
      {
        id: 'r4',
        title: 'Academia',
        cents: 9_000,
        kind: 'expense',
        day: 10,
        category: null,
        account: null,
        active: false,
        paidBy: 'Eu',
        group: null,
        share: null
      }
    ],
    budget: [
      { id: 'g1', category: 'Mercado', cents: 100_000, group: null },
      { id: 'g2', category: 'Lazer', cents: 30_000, group: null }
    ],
    entries: [
      entry({ title: 'Aluguel', cents: 200_000, account: 'Conta', recurring: 'r2', ref: '2026-11', date: '2026-11-05', createdAt: 10 }),
      entry({ title: 'Mercado', cents: 40_000, category: 'Mercado', account: 'Nubank', invoice: '2026-12', date: '2026-11-08' }),
      entry({ title: 'Cinema', cents: 45_000, category: 'lazer', account: 'Conta', date: '2026-11-09', createdAt: 10 }),
      entry({ title: 'Farmácia', cents: 5_000, category: 'Saúde', account: 'Conta', date: '2026-11-09', createdAt: 10 }),
      entry({ title: 'Sofá 1/2', cents: 50_000, account: 'Nubank', invoice: '2026-11', date: '2026-10-20' }),
      entry({ title: 'Mês passado', cents: 99_000, category: 'Mercado', date: '2026-10-30' })
    ]
  })

  it('keeps the budget by category, spending without a limit included', () => {
    expect(budget(all, '2026-11')).toEqual([
      { category: 'Mercado', group: null, limit: 100_000, spent: 40_000, left: 60_000 },
      { category: 'Lazer', group: null, limit: 30_000, spent: 45_000, left: -15_000 },
      { category: 'Saúde', group: null, limit: null, spent: 5_000, left: null }
    ])
  })

  it('adds the picture up', () => {
    const p = monthPicture(all, '2026-11', '2026-11-10')
    expect(p.inAccounts).toBe(500_000)
    expect(p.income).toMatchObject({ received: 0, expected: 800_000 })
    expect(p.bills).toMatchObject({ paid: 200_000, pending: 10_000 })
    expect(p.bills.lines.map((line) => line.recurring.title)).toEqual(['Aluguel', 'Internet'])
    expect(p.invoices).toMatchObject([{ card: 'Nubank', month: '2026-11', cents: 50_000, paid: false, due: '2026-11-03' }])
    // Going over in one category does not give room back in another.
    expect(p.budget).toMatchObject({ limit: 130_000, spent: 90_000, left: 60_000, daysLeft: 21, perWeek: 20_000 })
    expect(p.inBoxes).toBe(1_000_000)
    expect(p.free).toBe(500_000 + 800_000 - 10_000 - 50_000 - 60_000)
  })

  it('counts an invoice as paid once a transfer to the card names its month', () => {
    const paid = {
      ...all,
      entries: [...all.entries, entry({ kind: 'transfer', cents: 50_000, account: 'Conta', to: 'Nubank', ref: '2026-11' })]
    }
    const p = monthPicture(paid, '2026-11', '2026-11-10')
    expect(p.invoices[0].paid).toBe(true)
    expect(p.free).toBe(450_000 + 800_000 - 10_000 - 60_000)
  })

  it('forecasts the month after from what repeats and the invoices already known', () => {
    expect(forecast(all, '2026-12')).toEqual({
      month: '2026-12',
      income: 800_000,
      bills: 210_000,
      budget: 130_000,
      invoices: 40_000,
      free: 420_000
    })
  })

  it('projects the reserve with what is saved and what it yields', () => {
    const points = projection(all, '2026-12', 2, { monthly: 100_000 })
    expect(points).toEqual([
      { month: '2026-12', cents: 1_110_000, saved: 100_000, yielded: 10_000 },
      { month: '2027-01', cents: 1_221_100, saved: 100_000, yielded: 11_100 }
    ])
    // By default: what the forecast leaves free.
    expect(projection(all, '2026-12', 1)[0].saved).toBe(420_000)
  })
})
