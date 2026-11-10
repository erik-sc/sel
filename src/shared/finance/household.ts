import { type Books, type Entry, isMe, key, monthOf, owedToMe, type Recurring, same } from './calc'
import { ME } from './index'

/**
 * The household block ("Divisão de contas"): what the user shares with the one person they live
 * with. It is a view of the Finance ledger, not a second set of books: a shared expense is an
 * entry of the ledger with the household's group, who paid and each one's part, so the user's
 * part is in their own month without being entered twice (./calc.ts counts it there).
 *
 * Everything is in cents. Pure: no Electron, Node or React.
 */

export interface Household {
  /** Who the user shares with. Empty until it is set up. */
  partner: string
  /** The user's part of what is shared, in percent. */
  myShare: number
  /** The group the household's entries carry in the ledger. */
  group: string
}

export const HOUSEHOLD_KEY = 'finance.household'
export const DEFAULT_HOUSEHOLD: Household = { partner: '', myShare: 50, group: 'Casa' }

const name = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, max)
    : ''

/** The stored household, with the default for anything malformed. */
export function cleanHousehold(value: unknown): Household {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_HOUSEHOLD }
  const record = value as Record<string, unknown>
  const share = record['myShare']
  const partner = name(record['partner'], 40)
  return {
    partner: isMe(partner) ? '' : partner,
    myShare:
      typeof share === 'number' && Number.isFinite(share) ? Math.min(100, Math.max(0, Math.round(share))) : DEFAULT_HOUSEHOLD.myShare,
    group: name(record['group'], 40) || DEFAULT_HOUSEHOLD.group
  }
}

/** A shared amount in two parts that add up to it: the user's by their percentage, the rest the other's. */
export function splitByShare(cents: number, myShare: number): { mine: number; theirs: number } {
  const mine = Math.round((cents * myShare) / 100)
  return { mine, theirs: cents - mine }
}

/** The parts of an entry: the user's, and the other's. */
export function partsOf(entry: Entry, household: Household): { mine: number; theirs: number } {
  let mine = 0
  let theirs = 0
  for (const [person, cents] of Object.entries(entry.shares ?? {})) {
    if (isMe(person)) mine += cents
    else if (key(person) === key(household.partner)) theirs += cents
  }
  return { mine, theirs }
}

/** The household's entries: what was shared with its group, and the payments that settled it. */
export function householdEntries(books: Books, household: Household): Entry[] {
  return books.entries.filter(
    (entry) => same(entry.group, household.group) && ((entry.kind === 'expense' && entry.shares !== null) || entry.kind === 'settlement')
  )
}

/** What the other owes the user (positive) or the user owes them (negative), over every month. */
export function householdBalance(books: Books, household: Household): number {
  if (!household.partner) return 0
  const wanted = key(household.partner)
  return owedToMe(householdEntries(books, household), household.group).find((each) => key(each.person) === wanted)?.cents ?? 0
}

export interface HouseholdBill {
  recurring: Recurring
  /** The entry that launched it this month. */
  entry: Entry | null
}

export interface HouseholdMonth {
  month: string
  /** Positive: the other owes the user. Over every month, not this one alone. */
  balance: number
  total: number
  mine: { share: number; paid: number }
  theirs: { share: number; paid: number }
  byCategory: { category: string; cents: number }[]
  /** The expenses of the month, the newest first. */
  expenses: Entry[]
  bills: HouseholdBill[]
  /** Every payment between the two, the newest first. */
  settlements: Entry[]
}

const newest = (a: Entry, b: Entry): number => b.date.localeCompare(a.date) || b.createdAt - a.createdAt

export function householdMonth(books: Books, household: Household, month: string): HouseholdMonth {
  const all = householdEntries(books, household)
  const expenses = all.filter((entry) => entry.kind === 'expense' && monthOf(entry.date) === month).sort(newest)
  const mine = { share: 0, paid: 0 }
  const theirs = { share: 0, paid: 0 }
  const categories = new Map<string, { category: string; cents: number }>()
  for (const entry of expenses) {
    const each = partsOf(entry, household)
    mine.share += each.mine
    theirs.share += each.theirs
    if (isMe(entry.paidBy)) mine.paid += entry.cents
    else theirs.paid += entry.cents
    const category = entry.category ?? 'Sem categoria'
    const line = categories.get(key(category)) ?? { category, cents: 0 }
    line.cents += entry.cents
    categories.set(key(category), line)
  }
  return {
    month,
    balance: householdBalance(books, household),
    total: expenses.reduce((sum, entry) => sum + entry.cents, 0),
    mine,
    theirs,
    byCategory: [...categories.values()].sort((a, b) => b.cents - a.cents),
    expenses,
    bills: books.recurring
      .filter((line) => line.active && line.kind === 'expense' && same(line.group, household.group))
      .map((line) => ({
        recurring: line,
        entry:
          books.entries.find((entry) => entry.recurring === line.id && (entry.ref ?? monthOf(entry.date)) === month && entry.paid) ?? null
      }))
      .sort((a, b) => (a.recurring.day ?? 99) - (b.recurring.day ?? 99)),
    settlements: all.filter((entry) => entry.kind === 'settlement').sort(newest)
  }
}

/** The person an entry names, as the household knows them: the user, or the other. */
export const personOf = (household: Household, who: 'me' | 'partner'): string => (who === 'me' ? ME : household.partner)
