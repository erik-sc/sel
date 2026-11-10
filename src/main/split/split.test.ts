import { beforeEach, describe, expect, it } from 'vitest'
import { AI_PRIVATE_MESSAGE } from '../../shared/aiPrivate'
import { FINANCE_PAGE_ID } from '../../shared/finance'
import { cleanHousehold, splitByShare } from '../../shared/finance/household'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { asUser, financeExists } from '../finance/store'
import { callFinanceTool } from '../finance/tools'
import { financeMonthView, householdView } from '../finance/views'
import * as markdown from '../markdown'
import { callSplitTool } from './tools'
import { SPLIT_PACK } from './toolspecs'

const NOW = new Date(2026, 10, 10, 12) // 10 November 2026, local

describe('the household as it is stored', () => {
  it('cleans what it is given', () => {
    expect(cleanHousehold(null)).toEqual({ partner: '', myShare: 50, group: 'Casa' })
    expect(cleanHousehold({ partner: '  Alice \n', myShare: 62.4, group: '' })).toEqual({ partner: 'Alice', myShare: 62, group: 'Casa' })
    expect(cleanHousehold({ partner: 'eu', myShare: 400 })).toEqual({ partner: '', myShare: 100, group: 'Casa' })
  })

  it('divides to the cent', () => {
    expect(splitByShare(1001, 50)).toEqual({ mine: 501, theirs: 500 })
    expect(splitByShare(1000, 60)).toEqual({ mine: 600, theirs: 400 })
  })
})

describe('the household tools', () => {
  let repo: Repository
  const split = (name: string, args: Record<string, unknown> = {}): string => callSplitTool({ repo, markdown }, name, args, NOW)
  const finance = (name: string, args: Record<string, unknown> = {}): string => callFinanceTool({ repo, markdown }, name, args, NOW)
  const idOf = (text: string): string => /\[([0-9a-f-]{36})\]/u.exec(text)?.[1] as string

  beforeEach(() => {
    repo = openTestRepository()
  })

  it('asks who the household is shared with before anything else', () => {
    expect(split('split_summary')).toContain('not set up yet')
    expect(() => split('split_add', { description: 'Mercado', amount: 100 })).toThrow(/split_config/)
    expect(split('split_config')).toContain('not set up yet')
    expect(() => split('split_config', { partner: 'eu' })).toThrow(/other person/)
    expect(split('split_config', { partner: 'Alice' })).toBe('Set: shared with Alice, 50% yours and 50% theirs.')
    expect(split('split_config', { my_share: 60 })).toBe('Set: shared with Alice, 60% yours and 40% theirs.')
    expect(split('split_config')).toBe('The household: shared with Alice, 60% yours and 40% theirs.')
    // Setting it up enters nothing.
    expect(financeExists(repo)).toBe(false)
  })

  it('divides an expense by the household, or as told, and says who owes whom', () => {
    split('split_config', { partner: 'Alice' })
    const market = split('split_add', { description: 'Mercado', amount: '300,00', category: 'Supermercado' })
    expect(market).toContain('dividido: Eu R$ 150,00, Alice R$ 150,00')
    expect(market).toContain('grupo Casa')
    expect(market).toContain('Alice owes you R$ 150,00.')
    // She paid the power bill, half each.
    expect(split('split_add', { description: 'Luz', amount: 200, paid_by: 'partner' })).toContain('Alice owes you R$ 50,00.')
    // She paid something that was all mine.
    expect(split('split_add', { description: 'Meu remédio', amount: 80, paid_by: 'partner', how: 'mine' })).toContain(
      'You owe Alice R$ 30,00.'
    )
    // I paid something that was all hers.
    expect(split('split_add', { description: 'Shampoo dela', amount: 30, how: 'theirs' })).toContain('You and Alice are even.')
    // Exact parts.
    expect(split('split_add', { description: 'Sofá', amount: 1000, how: 'custom', my_part: 700 })).toContain(
      'dividido: Eu R$ 700,00, Alice R$ 300,00'
    )
    expect(() => split('split_add', { description: 'x', amount: 10, how: 'custom', my_part: 20 })).toThrow(/more than the amount/)
    // Nothing to share: all of whoever paid it.
    expect(() => split('split_add', { description: 'x', amount: 10, how: 'mine' })).toThrow(/your own expense/)
    expect(() => split('split_add', { description: 'x', amount: 10, paid_by: 'partner', how: 'theirs' })).toThrow(/nothing to share/)
    expect(() => split('split_add', { description: 'x', amount: 10, paid_by: 'partner', account: 'Conta' })).toThrow(
      /left none of your accounts/
    )
  })

  it('divides a receipt line by line', () => {
    split('split_config', { partner: 'Alice' })
    const text = split('split_add', {
      description: 'Zaffari',
      items: [
        { name: 'Arroz', amount: 20 },
        { name: 'Vinho', amount: 60, owner: 'me' },
        { name: 'Ração', amount: 20, owner: 'partner' }
      ],
      total: 110
    })
    // Mine: 10 + 60 of 100, scaled to the 110 paid.
    expect(text).toContain('R$ 110,00')
    expect(text).toContain('dividido: Eu R$ 77,00, Alice R$ 33,00')
    expect(markdown.pageToMarkdown(repo, idOf(text)).markdown).toContain('Vinho')
    expect(() => split('split_add', { description: 'x', items: [{ name: 'a', amount: 1 }], how: 'mine' })).toThrow(/leave "how" out/)
  })

  it('keeps fixed bills, launches them for a month and settles up', () => {
    split('split_config', { partner: 'Alice' })
    expect(() => split('split_bill', { name: 'Aluguel' })).toThrow(/give its amount/)
    expect(split('split_bill', { name: 'Aluguel', amount: 3000, day: 5, category: 'Aluguel', account: 'Conta' })).toContain(
      'paid by you · 50% yours · day 5'
    )
    expect(split('split_bill', { name: 'Internet', amount: 120, day: 15, paid_by: 'partner', my_share: 40 })).toContain(
      'paid by Alice · 40% yours'
    )
    let summary = split('split_summary')
    expect(summary).toContain('Aluguel')
    expect(summary).toContain('you pay · pending, day 5')
    expect(summary).toContain('Alice pays · pending, day 15')

    expect(split('split_launch', { name: 'aluguel' })).toContain('Alice owes you R$ 1.500,00.')
    expect(split('split_launch', { name: 'Aluguel' })).toContain('already launched for 2026-11')
    // This month's amount differs; hers to pay, 40% mine.
    expect(split('split_launch', { name: 'Internet', amount: 130 })).toContain('dividido: Eu R$ 52,00, Alice R$ 78,00')
    expect(() => split('split_launch', { name: 'Luz' })).toThrow(/There are: “Aluguel”, “Internet”/)

    summary = split('split_summary')
    expect(summary).toContain('Alice owes you R$ 1.448,00.')
    expect(summary).toContain('2026-11: R$ 3.130,00 in 2 expenses.')
    expect(summary).toContain('Your part R$ 1.552,00; you paid R$ 3.000,00.')
    expect(summary).toContain("Alice's part R$ 1.578,00; they paid R$ 130,00.")
    expect(summary).toContain('launched 2026-11-10')

    // The whole balance, from whoever owes.
    const settled = split('split_settle')
    expect(settled).toContain('Acerto: Alice pagou')
    expect(settled).toContain('R$ 1.448,00')
    expect(settled).toContain('You and Alice are even.')
    expect(() => split('split_settle')).toThrow(/are even: give the amount/)
    expect(split('split_settle', { amount: 100, paid_by: 'me' })).toContain('Alice owes you R$ 100,00.')
    expect(split('split_summary')).toContain('Payments between you')
    // The name stays once entries carry it.
    expect(() => split('split_config', { partner: 'Bia' })).toThrow(/that name stays/)
  })

  it('is one ledger with Finanças: my part is in my own month, and only what I pay leaves my accounts', () => {
    split('split_config', { partner: 'Alice' })
    finance('finance_account', { name: 'Conta', balance: 5000 })
    finance('finance_budget', { category: 'Supermercado', limit: 800 })
    split('split_add', { description: 'Mercado', amount: 300, category: 'Supermercado', account: 'Conta' })
    split('split_add', { description: 'Feira', amount: 100, category: 'Supermercado', paid_by: 'partner' })
    split('split_bill', { name: 'Aluguel', amount: 3000, day: 5, account: 'Conta' })
    split('split_bill', { name: 'Internet', amount: 120, day: 15, paid_by: 'partner' })
    const month = finance('finance_month')
    // 300 left my account; my half of both is my spending.
    expect(month).toContain('In the accounts: R$ 4.700,00')
    expect(month).toContain('Supermercado: R$ 200,00 of R$ 800,00')
    expect(month).toContain('Alice owes you R$ 100,00')
    // The bill I pay is mine to pay in full; the one she pays is not among my bills.
    expect(month).toContain('Fixed bills: R$ 0,00 paid, R$ 3.000,00 pending')
    expect(month).not.toContain('Internet')
    // Next month costs me my part of both.
    expect(month).toContain('bills R$ 1.560,00')
    split('split_launch', { name: 'Aluguel' })
    expect(finance('finance_month')).toContain('Fixed bills: R$ 3.000,00 paid, R$ 0,00 pending')
  })

  it('gives the screens their month, and keeps showing it when the block is private from the AI', () => {
    split('split_config', { partner: 'Alice', my_share: 60 })
    expect(householdView(repo, '2026-11', '2026-11-10')).toMatchObject({
      household: { partner: 'Alice', myShare: 60 },
      balance: 0,
      total: 0,
      expenses: []
    })
    expect(financeMonthView(repo, '2026-11', '2026-11-10')).toMatchObject({ empty: true, inAccounts: 0, entries: [] })
    split('split_add', { description: 'Mercado', amount: 200, category: 'Supermercado' })
    split('split_bill', { name: 'Aluguel', amount: 3000, day: 5 })
    const view = householdView(repo, '2026-11', '2026-11-10')
    expect(view).toMatchObject({
      balance: 80,
      total: 200,
      mine: { share: 120, paid: 200 },
      theirs: { share: 80, paid: 0 },
      byCategory: [{ category: 'Supermercado', amount: 200 }],
      expenses: [{ description: 'Mercado', amount: 200, paidByMe: true, mine: 120, theirs: 80 }],
      bills: [{ name: 'Aluguel', amount: 3000, day: 5, paidByMe: true, myShare: 60, launched: null }],
      categories: ['Supermercado']
    })
    expect(JSON.parse(split('split_summary', { format: 'json' }))).toMatchObject({ balance: 80, total: 200 })
    expect(financeMonthView(repo, '2026-11', '2026-11-10')).toMatchObject({ empty: false, owed: [{ person: 'Alice', amount: 80 }] })

    repo.update(FINANCE_PAGE_ID, { props: { aiPrivate: true } })
    expect(() => split('split_summary')).toThrow(new ToolError(AI_PRIVATE_MESSAGE))
    expect(() => split('split_add', { description: 'Mais', amount: 10 })).toThrow(new ToolError(AI_PRIVATE_MESSAGE))
    // The window is the user's own.
    expect(asUser(() => householdView(repo, '2026-11', '2026-11-10')).total).toBe(200)
    expect(asUser(() => split('split_add', { description: 'Pão', amount: 10 }))).toContain('Pão')
    expect(() => split('split_summary')).toThrow(ToolError)
  })

  it('lists every tool with a closed schema', () => {
    for (const { spec, scope } of SPLIT_PACK.tools) {
      expect(scope).toBe('finance')
      expect(spec.name).toMatch(/^split_[a-z_]+$/)
      expect(spec.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    }
    expect(() => split('nope')).toThrow(/No such tool/)
  })
})
