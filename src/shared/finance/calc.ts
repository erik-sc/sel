import { ME } from './index'

/**
 * The arithmetic of the Finance block, on plain records: what a month looks like, what a card's
 * invoice holds, who owes whom, where the reserve is heading. The main process reads the
 * databases into these records (main/finance/store.ts) and the tools say the answers
 * (main/finance/tools.ts). Everything is in cents. Pure: no Electron, Node or React.
 */

export type Kind = 'expense' | 'income' | 'transfer' | 'settlement'

/** One row of the Ledger. */
export interface Entry {
  id: string
  title: string
  cents: number
  kind: Kind
  /** `YYYY-MM-DD`. */
  date: string
  category: string | null
  account: string | null
  paid: boolean
  paidBy: string
  /** A shared expense's parts in cents by person, or null when it is all the payer's. */
  shares: Record<string, number> | null
  group: string | null
  to: string | null
  invoice: string | null
  instalment: string | null
  series: string | null
  recurring: string | null
  ref: string | null
  createdAt: number
}

export interface Recurring {
  id: string
  title: string
  cents: number
  kind: 'expense' | 'income'
  day: number | null
  category: string | null
  account: string | null
  active: boolean
  /** Who pays it. */
  paidBy: string
  /** A bill shared with the household (./household.ts): its group, and the user's part of it in percent. */
  group: string | null
  share: number | null
}

export interface BudgetLine {
  id: string
  category: string
  cents: number
  group: string | null
}

export type AccountType = 'checking' | 'card' | 'cash'

/** An account or a box: what it held when last told, and since when entries move it. */
export interface Holder {
  id: string
  name: string
  cents: number
  asOf: number
}

export interface Account extends Holder {
  type: AccountType
  closingDay: number | null
  dueDay: number | null
}

export interface Box extends Holder {
  goal: number | null
  purpose: string
  /** Percent a month. */
  yield: number | null
}

export interface Books {
  entries: Entry[]
  recurring: Recurring[]
  budget: BudgetLine[]
  accounts: Account[]
  boxes: Box[]
}

// ---- words and dates -------------------------------------------------------------

/** Lower case, without accents or outer spaces: how names are compared. */
export function key(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .trim()
    .toLowerCase()
}

export const same = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && key(a) === key(b)

export const isMe = (name: string | null | undefined): boolean =>
  !name || ['eu', 'me', 'i', 'myself', 'mim'].includes(key(name)) || key(name) === key(ME)

const pad = (n: number): string => String(n).padStart(2, '0')

export const monthOf = (date: string): string => date.slice(0, 7)

/** `YYYY-MM` moved by `by` months. */
export function addMonths(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad((index % 12) + 1)}`
}

export function daysIn(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
}

/** The day `day` of `month`, held to the month's length (31 in February is its last day). */
export function dayOf(month: string, day: number): string {
  return `${month}-${pad(Math.min(Math.max(1, Math.floor(day)), daysIn(month)))}`
}

/** `date` moved by whole months, on the same day when the month has it. */
export function addMonthsToDate(date: string, by: number): string {
  return dayOf(addMonths(monthOf(date), by), Number(date.slice(8, 10)))
}

/**
 * The invoice a card purchase falls on, as the month of the invoice's due date. A purchase after
 * the closing day goes to the next cycle; a due day at or before the closing day is in the month
 * after the closing. Without the card's days, the month after the purchase.
 */
export function invoiceOf(date: string, card: Pick<Account, 'closingDay' | 'dueDay'>): string {
  const month = monthOf(date)
  if (!card.closingDay) return addMonths(month, 1)
  const day = Number(date.slice(8, 10))
  const closes = day <= Math.min(card.closingDay, daysIn(month)) ? month : addMonths(month, 1)
  return card.dueDay && card.dueDay > card.closingDay ? closes : addMonths(closes, 1)
}

/** `total` in `count` parts that add up to it: the first ones take the cents left over. */
export function parts(total: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count))
  const base = Math.floor(total / n)
  const left = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < left ? 1 : 0))
}

// ---- what is mine ------------------------------------------------------------------

/** What an expense or an income costs or brings the user: their part of a shared one, all of their own, none of someone else's. */
export function mine(entry: Entry): number {
  if (entry.kind !== 'expense' && entry.kind !== 'income') return 0
  if (entry.shares) {
    for (const [person, cents] of Object.entries(entry.shares)) if (isMe(person)) return cents
    return 0
  }
  return isMe(entry.paidBy) ? entry.cents : 0
}

/** What a recurring line costs or brings the user a month: their part of a shared bill, all of their own, none of what someone else pays alone. */
export function myPart(line: Recurring): number {
  if (line.share !== null) return Math.round((line.cents * Math.min(100, Math.max(0, line.share))) / 100)
  return isMe(line.paidBy) ? line.cents : 0
}

// ---- balances of accounts and boxes ---------------------------------------------------

/** How much an entry moves the holder called `name`: money in is positive. Card purchases and what others paid move nothing. */
function effect(entry: Entry, name: string): number {
  if (!entry.paid) return 0
  const from = same(entry.account, name)
  const into = same(entry.to, name)
  switch (entry.kind) {
    case 'expense':
      return from && isMe(entry.paidBy) ? -entry.cents : 0
    case 'income':
      return from ? entry.cents : 0
    case 'transfer':
      return (into ? entry.cents : 0) - (from ? entry.cents : 0)
    case 'settlement':
      // Paid by the user from this account, or received into it from someone else.
      return from ? (isMe(entry.paidBy) ? -entry.cents : entry.cents) : 0
  }
}

/** The local day of a moment, `YYYY-MM-DD`. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * True when `entry` happened after the holder's balance was told. The balance told is what the
 * bank shows, so everything dated before that day is already in it, whenever it was entered: a
 * statement of past months brought in later moves nothing. On the day itself, what was entered
 * after the balance counts.
 */
export function after(entry: Pick<Entry, 'date' | 'createdAt'>, asOf: number): boolean {
  const day = localDay(asOf)
  return entry.date > day || (entry.date === day && entry.createdAt >= asOf)
}

/** What a holder has now: what it held when last told, moved by what happened from then on. */
export function balanceOf(holder: Holder, entries: readonly Entry[]): number {
  let cents = holder.cents
  for (const entry of entries) if (after(entry, holder.asOf)) cents += effect(entry, holder.name)
  return cents
}

// ---- cards -------------------------------------------------------------------------

export interface Invoice {
  card: string
  /** The month it is due, `YYYY-MM`. */
  month: string
  cents: number
  entries: Entry[]
  paid: boolean
  /** The day it is due, when the card says. */
  due: string | null
}

/** True for what goes on a card's invoice: the user's purchases on it, and what the card gave back (a refund). */
const onCard = (entry: Entry, card: Account): boolean =>
  (entry.kind === 'expense' || entry.kind === 'income') && isMe(entry.paidBy) && same(entry.account, card.name)

/**
 * The entries with the invoice each card purchase falls on: the one stored, or, for a purchase
 * entered before its account was known to be a card (a statement brought in whole), the one its
 * date gives. Read once, so that every sum sees the same.
 */
export function withInvoices(entries: readonly Entry[], accounts: readonly Account[]): Entry[] {
  const cards = accounts.filter((account) => account.type === 'card')
  if (!cards.length) return [...entries]
  return entries.map((entry) => {
    if (entry.invoice) return entry
    const card = cards.find((each) => onCard(entry, each))
    return card ? { ...entry, invoice: invoiceOf(entry.date, card) } : entry
  })
}

/** True when `name` is one of the cards. */
export const isCard = (books: Pick<Books, 'accounts'>, name: string | null | undefined): boolean =>
  books.accounts.some((account) => account.type === 'card' && same(account.name, name))

/**
 * A card's invoice of one month: its purchases less what the card gave back, and whether a
 * transfer to the card paid it. A transfer that does not say which invoice it pays is taken as
 * paying the one of the month it was made in.
 */
export function invoice(books: Books, card: Account, month: string): Invoice {
  const entries = books.entries.filter((entry) => onCard(entry, card) && entry.invoice === month)
  const paid = books.entries.some(
    (entry) => entry.kind === 'transfer' && entry.paid && same(entry.to, card.name) && (entry.ref ?? monthOf(entry.date)) === month
  )
  return {
    card: card.name,
    month,
    cents: entries.reduce((sum, entry) => sum + (entry.kind === 'income' ? -entry.cents : entry.cents), 0),
    entries,
    paid,
    due: card.dueDay ? dayOf(month, card.dueDay) : null
  }
}

/** The invoice that is open on `today`: the one a purchase made today would fall on. */
export const openInvoice = (card: Account, today: string): string => invoiceOf(today, card)

// ---- the month ------------------------------------------------------------------------

export interface BillState {
  recurring: Recurring
  /** The entry that paid or received it this month. */
  entry: Entry | null
  due: string | null
}

/** Each active recurring line with what happened to it in `month`. */
export function bills(books: Books, month: string): BillState[] {
  return books.recurring
    .filter((line) => line.active)
    .map((line) => ({
      recurring: line,
      entry:
        books.entries.find((entry) => entry.recurring === line.id && (entry.ref ?? monthOf(entry.date)) === month && entry.paid) ?? null,
      due: line.day ? dayOf(month, line.day) : null
    }))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
}

export interface BudgetState {
  category: string
  group: string | null
  /** Null: spending in a category that has no limit. */
  limit: number | null
  spent: number
  /** limit − spent. */
  left: number | null
}

/**
 * The day-to-day budget of `month`: each category with a limit and what the user spent in it,
 * then the categories spent in without one. Entries that pay a recurring bill are not day-to-day
 * spending: the bill counts once, among the fixed ones.
 */
export function budget(books: Books, month: string): BudgetState[] {
  const spent = new Map<string, { name: string; cents: number }>()
  for (const entry of books.entries) {
    if (entry.recurring || monthOf(entry.date) !== month) continue
    // What a card gave back takes from what was spent in its category; it is not income.
    const refund = entry.kind === 'income' && isCard(books, entry.account)
    if (entry.kind !== 'expense' && !refund) continue
    const cents = mine(entry)
    if (!cents) continue
    const name = entry.category ?? 'Sem categoria'
    const line = spent.get(key(name)) ?? { name, cents: 0 }
    line.cents += refund ? -cents : cents
    spent.set(key(name), line)
  }
  for (const [id, line] of spent) {
    if (line.cents <= 0) spent.delete(id)
  }
  const lines: BudgetState[] = books.budget.map((line) => {
    const used = spent.get(key(line.category))?.cents ?? 0
    spent.delete(key(line.category))
    return { category: line.category, group: line.group, limit: line.cents, spent: used, left: line.cents - used }
  })
  for (const { name, cents } of spent.values()) lines.push({ category: name, group: null, limit: null, spent: cents, left: null })
  return lines
}

// ---- who owes whom ---------------------------------------------------------------------

export interface Debt {
  /** Who owes. */
  from: string
  /** Who is owed. */
  to: string
  cents: number
}

/**
 * What everyone owes everyone, netted pair by pair: in a shared expense each person owes the
 * payer their part; a settlement is the payer giving the other their money back. `group` keeps
 * only the entries of one group.
 */
export function debts(entries: readonly Entry[], group?: string | null): Debt[] {
  const names = new Map<string, string>()
  const name = (person: string): string => {
    const id = isMe(person) ? key(ME) : key(person)
    if (!names.has(id)) names.set(id, isMe(person) ? ME : person.trim())
    return id
  }
  const owed = new Map<string, number>()
  const add = (from: string, to: string, cents: number): void => {
    if (from === to || !cents) return
    const [a, b, sign] = from < to ? [from, to, 1] : [to, from, -1]
    const pair = `${a}\n${b}`
    owed.set(pair, (owed.get(pair) ?? 0) + sign * cents)
  }
  for (const entry of entries) {
    if (group && !same(entry.group, group)) continue
    const payer = name(entry.paidBy)
    if (entry.kind === 'expense' && entry.shares) {
      for (const [person, cents] of Object.entries(entry.shares)) add(name(person), payer, cents)
    } else if (entry.kind === 'settlement' && entry.to) {
      add(name(entry.to), payer, entry.cents)
    }
  }
  const out: Debt[] = []
  for (const [pair, cents] of owed) {
    if (!cents) continue
    const [a, b] = pair.split('\n')
    const [from, to] = cents > 0 ? [a, b] : [b, a]
    out.push({ from: names.get(from) as string, to: names.get(to) as string, cents: Math.abs(cents) })
  }
  return out.sort((x, y) => y.cents - x.cents)
}

/** What each person owes the user (positive) or is owed by them (negative). */
export function owedToMe(entries: readonly Entry[], group?: string | null): { person: string; cents: number }[] {
  return debts(entries, group)
    .filter((debt) => isMe(debt.from) || isMe(debt.to))
    .map((debt) => (isMe(debt.to) ? { person: debt.from, cents: debt.cents } : { person: debt.to, cents: -debt.cents }))
}

// ---- the whole picture ------------------------------------------------------------------

export interface MonthPicture {
  month: string
  today: string
  accounts: { name: string; type: AccountType; cents: number }[]
  /** What the checking and cash accounts hold together. */
  inAccounts: number
  income: { received: number; expected: number; lines: BillState[] }
  bills: { paid: number; pending: number; lines: BillState[] }
  invoices: Invoice[]
  budget: { lines: BudgetState[]; limit: number; spent: number; left: number; daysLeft: number; perWeek: number | null }
  boxes: { name: string; cents: number; goal: number | null; purpose: string }[]
  inBoxes: number
  owed: { person: string; cents: number }[]
  /** Other spending and income of the month that is neither recurring nor in the budget's sum: one-off income. */
  otherIncome: number
  /**
   * What should be left in the accounts at the end of the month: what they hold, plus the income
   * still expected, minus the bills still to pay, the invoices due this month not yet paid, and
   * what is left of the budget.
   */
  free: number
}

export function monthPicture(books: Books, month: string, today: string): MonthPicture {
  const accounts = books.accounts.map((account) => ({
    name: account.name,
    type: account.type,
    cents: account.type === 'card' ? 0 : balanceOf(account, books.entries)
  }))
  const inAccounts = accounts.reduce((sum, account) => sum + account.cents, 0)
  const all = bills(books, month)
  const incomeLines = all.filter((line) => line.recurring.kind === 'income')
  // The bills the user pays: what someone else of the household pays shows in what is owed, once it is launched.
  const billLines = all.filter((line) => line.recurring.kind === 'expense' && isMe(line.recurring.paidBy))
  const settled = (lines: BillState[]): number => lines.reduce((sum, line) => sum + (line.entry?.cents ?? 0), 0)
  const open = (lines: BillState[]): number => lines.reduce((sum, line) => sum + (line.entry ? 0 : line.recurring.cents), 0)
  const invoices = books.accounts.filter((account) => account.type === 'card').map((card) => invoice(books, card, month))
  const lines = budget(books, month)
  const limited = lines.filter((line) => line.limit !== null)
  const limit = limited.reduce((sum, line) => sum + (line.limit ?? 0), 0)
  const spent = lines.reduce((sum, line) => sum + line.spent, 0)
  // Overspending in one category does not give room back in another: only what is left counts.
  const left = limited.reduce((sum, line) => sum + Math.max(0, line.left ?? 0), 0)
  const current = monthOf(today) === month
  const daysLeft = current ? daysIn(month) - Number(today.slice(8, 10)) + 1 : month > monthOf(today) ? daysIn(month) : 0
  const boxes = books.boxes.map((box) => ({ name: box.name, cents: balanceOf(box, books.entries), goal: box.goal, purpose: box.purpose }))
  const otherIncome = books.entries
    .filter(
      (entry) => entry.kind === 'income' && !entry.recurring && monthOf(entry.date) === month && entry.paid && !isCard(books, entry.account)
    )
    .reduce((sum, entry) => sum + mine(entry), 0)
  const invoicesDue = invoices.filter((each) => !each.paid).reduce((sum, each) => sum + each.cents, 0)
  return {
    month,
    today,
    accounts,
    inAccounts,
    income: { received: settled(incomeLines), expected: open(incomeLines), lines: incomeLines },
    bills: { paid: settled(billLines), pending: open(billLines), lines: billLines },
    invoices,
    budget: { lines, limit, spent, left, daysLeft, perWeek: daysLeft > 0 ? Math.round((left / daysLeft) * 7) : null },
    boxes,
    inBoxes: boxes.reduce((sum, box) => sum + box.cents, 0),
    owed: owedToMe(books.entries),
    otherIncome,
    free: inAccounts + open(incomeLines) - open(billLines) - invoicesDue - left
  }
}

export interface Forecast {
  month: string
  income: number
  bills: number
  budget: number
  /** Card purchases already made that fall on this month's invoices (instalments among them). */
  invoices: number
  /** income − bills − budget − invoices. */
  free: number
}

/** A month ahead, from what repeats: the recurring income and bills, the budget's limits, and the invoices already known. */
export function forecast(books: Books, month: string): Forecast {
  const active = books.recurring.filter((line) => line.active)
  // What each line costs the user: their part of a bill shared with the household, whoever pays it.
  const sum = (kind: 'income' | 'expense'): number =>
    active.filter((line) => line.kind === kind).reduce((total, line) => total + (kind === 'expense' ? myPart(line) : line.cents), 0)
  const invoices = books.accounts
    .filter((account) => account.type === 'card')
    .reduce((total, card) => total + invoice(books, card, month).cents, 0)
  const limit = books.budget.reduce((total, line) => total + line.cents, 0)
  const income = sum('income')
  const bill = sum('expense')
  return { month, income, bills: bill, budget: limit, invoices, free: income - bill - limit - invoices }
}

export interface ProjectionPoint {
  month: string
  /** What the boxes hold at the end of the month. */
  cents: number
  saved: number
  yielded: number
}

/**
 * The reserve month by month: what the boxes hold, plus what is saved each month and what it
 * yields. `monthly` is what goes in each month (default: what the forecast leaves free, never
 * less than nothing); `rate` the yield in percent a month (default: the boxes' own, weighted).
 */
export function projection(
  books: Books,
  from: string,
  months: number,
  options: { monthly?: number; rate?: number; extra?: Record<string, number> } = {}
): ProjectionPoint[] {
  const boxes = books.boxes.map((box) => ({ cents: balanceOf(box, books.entries), rate: box.yield ?? 0 }))
  let cents = boxes.reduce((sum, box) => sum + box.cents, 0)
  const weighted = cents > 0 ? boxes.reduce((sum, box) => sum + box.cents * box.rate, 0) / cents : 0
  const rate = (options.rate ?? weighted) / 100
  const out: ProjectionPoint[] = []
  for (let i = 0; i < Math.min(Math.max(1, Math.floor(months)), 120); i++) {
    const month = addMonths(from, i)
    const saved = (options.monthly ?? Math.max(0, forecast(books, month).free)) + (options.extra?.[month] ?? 0)
    const yielded = Math.round(cents * rate)
    cents += yielded + saved
    out.push({ month, cents, saved, yielded })
  }
  return out
}
