import {
  type Account,
  addMonths,
  type BillState,
  type Books,
  type Entry,
  forecast,
  invoice,
  isMe,
  monthOf,
  monthPicture,
  same
} from '../../shared/finance/calc'
import type { BillView, EntryView, FinanceMonthView, HouseholdView } from '../../shared/finance/api'
import { type Household, householdMonth, partsOf } from '../../shared/finance/household'
import { FINANCE_DB, LEDGER } from '../../shared/finance'
import type { Repository } from '../db/repository'
import { financeExists, readBooks, readHousehold } from './store'

/**
 * A month as the screens and a dashboard are given it (shared/finance/api.ts): added up by the
 * arithmetic, in the currency's unit. Reading never sets the block up.
 */

const reais = (cents: number): number => cents / 100

export function entryView(entry: Entry, household?: Household): EntryView {
  let mine: number | null = null
  let theirs: number | null = null
  if (entry.shares) {
    mine = 0
    theirs = 0
    for (const [person, cents] of Object.entries(entry.shares)) {
      if (isMe(person)) mine += cents
      else theirs += cents
    }
    if (household) ({ mine, theirs } = partsOf(entry, household))
  }
  return {
    id: entry.id,
    date: entry.date,
    description: entry.title,
    amount: reais(entry.cents),
    kind: entry.kind,
    category: entry.category,
    account: entry.account,
    to: entry.to,
    instalment: entry.instalment,
    invoice: entry.invoice,
    planned: !entry.paid,
    paidByMe: isMe(entry.paidBy),
    paidBy: entry.paidBy,
    mine: mine === null ? null : reais(mine),
    theirs: theirs === null ? null : reais(theirs)
  }
}

const NO_BOOKS: Books = { entries: [], recurring: [], budget: [], accounts: [], boxes: [] }

const newest = (a: Entry, b: Entry): number => b.date.localeCompare(a.date) || b.createdAt - a.createdAt

/** The names a property's options have, for the forms to offer. */
function optionNames(repo: Repository, propertyId: string): string[] {
  return (repo.get(FINANCE_DB.ledger)?.props.schema?.[propertyId]?.options ?? []).map((option) => option.name)
}

export function financeMonthView(repo: Repository, month: string, today: string): FinanceMonthView {
  const exists = financeExists(repo)
  const books = exists ? readBooks(repo) : NO_BOOKS
  const p = monthPicture(books, month, today)
  const next = forecast(books, addMonths(month, 1))
  const bill = (line: BillState): BillView => ({
    id: line.recurring.id,
    name: line.recurring.title,
    amount: reais(line.entry?.cents ?? line.recurring.cents),
    due: line.due,
    done: line.entry !== null,
    doneOn: line.entry?.date ?? null,
    late: line.entry === null && line.due !== null && line.due < today,
    category: line.recurring.category
  })
  return {
    empty: !exists,
    month,
    today,
    currency: 'BRL',
    accounts: p.accounts
      .filter((account) => account.type !== 'card')
      .map((account) => ({ name: account.name, type: account.type, balance: reais(account.cents) })),
    inAccounts: reais(p.inAccounts),
    income: { received: reais(p.income.received + p.otherIncome), expected: reais(p.income.expected), lines: p.income.lines.map(bill) },
    bills: { paid: reais(p.bills.paid), pending: reais(p.bills.pending), lines: p.bills.lines.map(bill) },
    cards: p.invoices.map((each) => {
      const card = books.accounts.find((account) => same(account.name, each.card)) as Account
      const upcoming = invoice(books, card, addMonths(month, 1))
      return {
        card: each.card,
        invoice: each.month,
        due: each.due,
        paid: each.paid,
        total: reais(each.cents),
        entries: [...each.entries]
          .sort(newest)
          .slice(0, 300)
          .map((entry) => entryView(entry)),
        next: { invoice: upcoming.month, total: reais(upcoming.cents) }
      }
    }),
    budget: {
      limit: reais(p.budget.limit),
      spent: reais(p.budget.spent),
      left: reais(p.budget.left),
      daysLeft: p.budget.daysLeft,
      perWeek: p.budget.perWeek === null ? null : reais(p.budget.perWeek),
      categories: p.budget.lines.map((line) => ({
        category: line.category,
        group: line.group,
        limit: line.limit === null ? null : reais(line.limit),
        spent: reais(line.spent),
        left: line.left === null ? null : reais(line.left)
      }))
    },
    boxes: p.boxes.map((box) => ({
      name: box.name,
      balance: reais(box.cents),
      goal: box.goal === null ? null : reais(box.goal),
      purpose: box.purpose
    })),
    inBoxes: reais(p.inBoxes),
    owed: p.owed.map((each) => ({ person: each.person, amount: reais(each.cents) })),
    freeAtEndOfMonth: reais(p.free),
    nextMonth: {
      month: next.month,
      income: reais(next.income),
      bills: reais(next.bills),
      budget: reais(next.budget),
      invoices: reais(next.invoices),
      free: reais(next.free)
    },
    entries: books.entries
      .filter((entry) => monthOf(entry.date) === month)
      .sort(newest)
      .slice(0, 1000)
      .map((entry) => entryView(entry)),
    categories: exists ? optionNames(repo, LEDGER.category) : [],
    accountNames: books.accounts.map((account) => account.name),
    cardNames: books.accounts.filter((account) => account.type === 'card').map((account) => account.name),
    boxNames: books.boxes.map((box) => box.name)
  }
}

export function householdView(repo: Repository, month: string, today: string): HouseholdView {
  const household = readHousehold(repo)
  const exists = financeExists(repo)
  const books = exists ? readBooks(repo) : NO_BOOKS
  const m = householdMonth(books, household, month)
  return {
    household,
    month,
    today,
    balance: reais(m.balance),
    total: reais(m.total),
    mine: { share: reais(m.mine.share), paid: reais(m.mine.paid) },
    theirs: { share: reais(m.theirs.share), paid: reais(m.theirs.paid) },
    byCategory: m.byCategory.map((line) => ({ category: line.category, amount: reais(line.cents) })),
    expenses: m.expenses.slice(0, 200).map((entry) => entryView(entry, household)),
    bills: m.bills.map((bill) => ({
      id: bill.recurring.id,
      name: bill.recurring.title,
      amount: reais(bill.recurring.cents),
      day: bill.recurring.day,
      category: bill.recurring.category,
      paidByMe: isMe(bill.recurring.paidBy),
      myShare: bill.recurring.share ?? household.myShare,
      launched: bill.entry ? entryView(bill.entry, household) : null
    })),
    settlements: m.settlements.slice(0, 50).map((entry) => entryView(entry, household)),
    categories: exists ? optionNames(repo, LEDGER.category) : [],
    accountNames: books.accounts.map((account) => account.name)
  }
}
