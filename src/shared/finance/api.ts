import type { CommandSpec } from '../commands'
import type { InvokeChannels } from '../ipc'
import type { Household } from './household'

/**
 * What the Finance and household screens ask the main process (`api.finance`), and what they are
 * given: a month already added up (./calc.ts, ./household.ts), in the currency's unit. A screen
 * never reads the ledger's rows by itself, and writes through `run`, which calls the same tools
 * an app connected over MCP has (main/finance/tools.ts, main/split/tools.ts): one place checks
 * what is entered.
 *
 * Pure: no Electron, Node or React.
 */

export interface EntryView {
  id: string
  /** `YYYY-MM-DD`. */
  date: string
  description: string
  amount: number
  kind: 'expense' | 'income' | 'transfer' | 'settlement'
  category: string | null
  account: string | null
  to: string | null
  instalment: string | null
  /** A card purchase: the month its invoice is due, `YYYY-MM`. */
  invoice: string | null
  planned: boolean
  /** True when the user paid it. */
  paidByMe: boolean
  paidBy: string
  /** A shared expense: the user's part and the other people's together. */
  mine: number | null
  theirs: number | null
}

/** A recurring line in one month: a fixed bill, or expected income. */
export interface BillView {
  id: string
  name: string
  amount: number
  /** The day it is due or expected, `YYYY-MM-DD`. */
  due: string | null
  done: boolean
  doneOn: string | null
  late: boolean
  category: string | null
}

export interface CardView {
  card: string
  /** The month the invoice is due, `YYYY-MM`. */
  invoice: string
  due: string | null
  paid: boolean
  total: number
  entries: EntryView[]
  next: { invoice: string; total: number }
}

export interface BudgetCategoryView {
  category: string
  group: string | null
  /** Null: spending in a category that has no limit. */
  limit: number | null
  spent: number
  left: number | null
}

export interface FinanceMonthView {
  /** Nothing was ever entered: the block's page and databases do not exist yet. */
  empty: boolean
  month: string
  today: string
  currency: 'BRL'
  accounts: { name: string; type: 'checking' | 'card' | 'cash'; balance: number }[]
  inAccounts: number
  income: { received: number; expected: number; lines: BillView[] }
  bills: { paid: number; pending: number; lines: BillView[] }
  cards: CardView[]
  budget: { limit: number; spent: number; left: number; daysLeft: number; perWeek: number | null; categories: BudgetCategoryView[] }
  boxes: { name: string; balance: number; goal: number | null; purpose: string }[]
  inBoxes: number
  owed: { person: string; amount: number }[]
  freeAtEndOfMonth: number
  nextMonth: { month: string; income: number; bills: number; budget: number; invoices: number; free: number }
  /** The month's entries, the newest first. */
  entries: EntryView[]
  /** Names to offer when something is entered. */
  categories: string[]
  accountNames: string[]
  /** The accounts that are cards, among `accountNames`. */
  cardNames: string[]
  boxNames: string[]
}

export interface HouseholdBillView {
  id: string
  name: string
  amount: number
  day: number | null
  category: string | null
  paidByMe: boolean
  /** The user's part, in percent. */
  myShare: number
  /** Launched this month: the entry it made. */
  launched: EntryView | null
}

export interface HouseholdView {
  household: Household
  month: string
  today: string
  /** Positive: the other owes the user. Over every month. */
  balance: number
  total: number
  mine: { share: number; paid: number }
  theirs: { share: number; paid: number }
  byCategory: { category: string; amount: number }[]
  expenses: EntryView[]
  bills: HouseholdBillView[]
  settlements: EntryView[]
  categories: string[]
  accountNames: string[]
}

export interface FinanceApi {
  /** The user's own month. */
  month(month?: string): Promise<FinanceMonthView>
  /** The household's month. */
  household(month?: string): Promise<HouseholdView>
  /** Runs one of the Finance or household tools, as an app connected over MCP would. Returns what the tool says. */
  run(tool: string, args: Record<string, unknown>): Promise<string>
}

/** The invoke channels of `api.finance` (see `INVOKE` in ../api.ts). */
export const FINANCE_INVOKE = {
  'finance:month': true,
  'finance:household': true,
  'finance:run': true
} as const satisfies Record<InvokeChannels<{ finance: FinanceApi }>, true>

/** The ways to the two screens (see ../commands.ts). */
export const FINANCE_COMMANDS = [
  {
    id: 'open-finance',
    menu: { submenu: 'view', label: 'Finances', order: 252 },
    palette: { title: 'Finances', keywords: ['finanças', 'financas', 'money', 'dinheiro', 'budget', 'orçamento', 'meu mês'], order: 112 }
  },
  {
    id: 'open-split',
    menu: { submenu: 'view', label: 'Shared Bills', order: 254 },
    palette: {
      title: 'Shared bills',
      keywords: ['divisão de contas', 'divisao', 'split', 'household', 'casa', 'apê', 'contas do apê', 'acerto'],
      order: 113
    }
  }
] as const satisfies readonly CommandSpec[]
