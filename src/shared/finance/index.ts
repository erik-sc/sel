import type { BlockProps, DatabaseView, PropertySchema, PropertyType } from '../types'

/**
 * The Finance block ("Finanças", docs/plans/release-0.12.0.md): a page with five databases the
 * app creates the first time something is entered. Like the built-in Tasks database, their ids,
 * property ids and built-in option ids are constants: two devices that create them before they
 * first sync write the same blocks, and the tools find a property by its id whatever it was
 * renamed to.
 *
 * Unlike Tasks they are ordinary pages and databases (no `props.system`): they can be moved,
 * archived or kept private from the AI as any other, and what the tools need is put back when it
 * is missing (main/finance/store.ts). Like Tasks, the page stays out of the sidebar's tree
 * (renderer store/tree.ts): the Finances and Shared bills screens stand for it, and the Finances
 * screen has the way to the databases themselves.
 *
 *   Ledger      every expense, income, transfer and settlement, one row each
 *   Recurring   what comes every month: fixed bills and expected income
 *   Budget      a monthly limit by category
 *   Accounts    checking accounts, cash and credit cards
 *   Boxes       money set aside ("Caixinhas")
 *
 * Amounts are stored as plain numbers in the currency's unit (12.5), shown as currency by the
 * database views; the arithmetic is done in cents (./calc.ts). Pure: no Electron, Node or React.
 */

export const FINANCE_PAGE_ID = 'f17a2ce0-f17a-4f17-8f17-f17a2ce00001'

export const FINANCE_DB = {
  ledger: 'f17a2ce0-f17a-4f17-8f17-f17a2ce00002',
  recurring: 'f17a2ce0-f17a-4f17-8f17-f17a2ce00003',
  budget: 'f17a2ce0-f17a-4f17-8f17-f17a2ce00004',
  accounts: 'f17a2ce0-f17a-4f17-8f17-f17a2ce00005',
  boxes: 'f17a2ce0-f17a-4f17-8f17-f17a2ce00006'
} as const

export type FinanceDb = keyof typeof FINANCE_DB

/** The user, among the people a shared expense names. */
export const ME = 'Eu'
export const ME_OPTION = 'fin.person.me'

export const LEDGER = {
  title: 'title',
  amount: 'fin.amount',
  kind: 'fin.kind',
  date: 'fin.date',
  category: 'fin.category',
  account: 'fin.account',
  status: 'fin.status',
  /** Who paid: a person. */
  paidBy: 'fin.paidBy',
  /** A shared expense's parts, JSON `{"Ana": 2500, "Eu": 2500}` in cents by person; empty when it is not shared. */
  split: 'fin.split',
  /** What a shared expense belongs to: a trip, the house. */
  group: 'fin.group',
  /** A transfer's destination: the name of an account or a box. A settlement's: the person paid. */
  to: 'fin.to',
  /** A card purchase: the invoice it falls on, `YYYY-MM` of the invoice's due date. */
  invoice: 'fin.invoice',
  /** "3/10": which instalment of how many. */
  instalment: 'fin.instalment',
  /** The same on every instalment of one purchase. */
  series: 'fin.series',
  /** The Recurring row this pays or receives, by id. */
  recurring: 'fin.recurring',
  /** The month a recurring entry or an invoice payment counts for, `YYYY-MM`. */
  ref: 'fin.ref',
  /** A receipt's lines, JSON `[{"name", "qty", "cents", "people"?}]`. */
  items: 'fin.items'
} as const

export const KINDS = [
  { id: 'fin.kind.expense', name: 'Gasto', color: 'red' },
  { id: 'fin.kind.income', name: 'Receita', color: 'green' },
  { id: 'fin.kind.transfer', name: 'Transferência', color: 'blue' },
  { id: 'fin.kind.settlement', name: 'Acerto', color: 'purple' }
] as const

export type EntryKind = 'expense' | 'income' | 'transfer' | 'settlement'
export const KIND_ID: Readonly<Record<EntryKind, string>> = {
  expense: 'fin.kind.expense',
  income: 'fin.kind.income',
  transfer: 'fin.kind.transfer',
  settlement: 'fin.kind.settlement'
}

export const STATUSES = [
  { id: 'fin.status.paid', name: 'Pago', color: 'green' },
  { id: 'fin.status.planned', name: 'Previsto', color: 'gray' }
] as const

export const RECURRING = {
  title: 'title',
  amount: 'fin.amount',
  kind: 'fin.kind',
  /** The day of the month it is due or expected. */
  day: 'fin.day',
  category: 'fin.category',
  account: 'fin.account',
  active: 'fin.active',
  /** Who pays it. Empty: the user. */
  paidBy: 'fin.paidBy',
  /** A bill shared with the household: the group it belongs to, and the user's part of it in percent. */
  group: 'fin.group',
  share: 'fin.share'
} as const

export const BUDGET = {
  /** The category's name, as the Ledger's Category option is called. */
  title: 'title',
  limit: 'fin.limit',
  group: 'fin.group'
} as const

export const ACCOUNT_TYPES = [
  { id: 'fin.account.checking', name: 'Conta', color: 'blue' },
  { id: 'fin.account.card', name: 'Cartão', color: 'purple' },
  { id: 'fin.account.cash', name: 'Dinheiro', color: 'green' }
] as const

export const ACCOUNTS = {
  title: 'title',
  type: 'fin.type',
  /** What it held when it was last told (`asOf`); entries made after that move it. */
  balance: 'fin.balance',
  /** When `balance` was told, in ms. Hidden. */
  asOf: 'fin.asOf',
  /** A card: the day its invoice closes, and the day it is due. */
  closingDay: 'fin.closingDay',
  dueDay: 'fin.dueDay'
} as const

export const BOXES = {
  title: 'title',
  balance: 'fin.balance',
  asOf: 'fin.asOf',
  goal: 'fin.goal',
  purpose: 'fin.purpose',
  /** What it yields a month, in percent (0.9). */
  yield: 'fin.yield'
} as const

const money = (id: string, name: string): PropertySchema => ({ id, name, type: 'number', numberFormat: 'currency' })
const select = (id: string, name: string, options: readonly { id: string; name: string; color: string }[] = []): PropertySchema => ({
  id,
  name,
  type: 'select',
  options: options.map((option) => ({ ...option }))
})
const text = (id: string, name: string): PropertySchema => ({ id, name, type: 'text' })
const number = (id: string, name: string): PropertySchema => ({ id, name, type: 'number' })

const table = (id: string, name: string, visible: readonly string[], extra: Partial<DatabaseView> = {}): DatabaseView => ({
  id,
  name,
  type: 'table',
  visibleProperties: [...visible],
  filters: [],
  sorts: [],
  ...extra
})

const record = (properties: readonly PropertySchema[]): Record<string, PropertySchema> =>
  Object.fromEntries(properties.map((property) => [property.id, property]))

/** The databases as they are created. Functions: callers may change what they are given. */
export const FINANCE_PROPS: Readonly<Record<FinanceDb, () => BlockProps>> = {
  ledger: () => ({
    title: [['Lançamentos']],
    icon: '🧾',
    schema: record([
      { id: LEDGER.title, name: 'Descrição', type: 'title' },
      money(LEDGER.amount, 'Valor'),
      select(LEDGER.kind, 'Tipo', KINDS),
      { id: LEDGER.date, name: 'Data', type: 'date' },
      select(LEDGER.category, 'Categoria'),
      select(LEDGER.account, 'Conta'),
      select(LEDGER.status, 'Situação', STATUSES),
      select(LEDGER.paidBy, 'Pago por', [{ id: ME_OPTION, name: ME, color: 'blue' }]),
      text(LEDGER.split, 'Divisão'),
      select(LEDGER.group, 'Grupo'),
      text(LEDGER.to, 'Para'),
      text(LEDGER.invoice, 'Fatura'),
      text(LEDGER.instalment, 'Parcela'),
      text(LEDGER.series, 'Compra'),
      text(LEDGER.recurring, 'Recorrente'),
      text(LEDGER.ref, 'Referente a'),
      text(LEDGER.items, 'Itens')
    ]),
    views: [
      table(
        'fin.ledger.all',
        'Tudo',
        [LEDGER.title, LEDGER.amount, LEDGER.kind, LEDGER.date, LEDGER.category, LEDGER.account, LEDGER.status, LEDGER.paidBy],
        { sorts: [{ propertyId: LEDGER.date, direction: 'desc' }] }
      ),
      {
        id: 'fin.ledger.byCategory',
        name: 'Por categoria',
        type: 'board',
        visibleProperties: [LEDGER.title, LEDGER.amount, LEDGER.date],
        filters: [],
        sorts: [],
        groupBy: LEDGER.category
      }
    ]
  }),
  recurring: () => ({
    title: [['Recorrentes']],
    icon: '🔁',
    schema: record([
      { id: RECURRING.title, name: 'Nome', type: 'title' },
      money(RECURRING.amount, 'Valor'),
      select(RECURRING.kind, 'Tipo', KINDS.slice(0, 2)),
      number(RECURRING.day, 'Dia'),
      select(RECURRING.category, 'Categoria'),
      select(RECURRING.account, 'Conta'),
      { id: RECURRING.active, name: 'Ativa', type: 'checkbox' },
      select(RECURRING.paidBy, 'Pago por', [{ id: ME_OPTION, name: ME, color: 'blue' }]),
      select(RECURRING.group, 'Grupo'),
      { id: RECURRING.share, name: 'Minha parte (%)', type: 'number' }
    ]),
    views: [
      table('fin.recurring.all', 'Todas', [
        RECURRING.title,
        RECURRING.amount,
        RECURRING.kind,
        RECURRING.day,
        RECURRING.category,
        RECURRING.account,
        RECURRING.active,
        RECURRING.paidBy,
        RECURRING.group,
        RECURRING.share
      ])
    ]
  }),
  budget: () => ({
    title: [['Orçamento']],
    icon: '🎯',
    schema: record([
      { id: BUDGET.title, name: 'Categoria', type: 'title' },
      money(BUDGET.limit, 'Limite por mês'),
      select(BUDGET.group, 'Grupo')
    ]),
    views: [table('fin.budget.all', 'Categorias', [BUDGET.title, BUDGET.limit, BUDGET.group])]
  }),
  accounts: () => ({
    title: [['Contas e cartões']],
    icon: '🏦',
    schema: record([
      { id: ACCOUNTS.title, name: 'Nome', type: 'title' },
      select(ACCOUNTS.type, 'Tipo', ACCOUNT_TYPES),
      money(ACCOUNTS.balance, 'Saldo informado'),
      number(ACCOUNTS.asOf, 'Saldo informado em'),
      number(ACCOUNTS.closingDay, 'Dia do fechamento'),
      number(ACCOUNTS.dueDay, 'Dia do vencimento')
    ]),
    views: [table('fin.accounts.all', 'Todas', [ACCOUNTS.title, ACCOUNTS.type, ACCOUNTS.balance, ACCOUNTS.closingDay, ACCOUNTS.dueDay])]
  }),
  boxes: () => ({
    title: [['Caixinhas']],
    icon: '🫙',
    schema: record([
      { id: BOXES.title, name: 'Nome', type: 'title' },
      money(BOXES.balance, 'Saldo informado'),
      number(BOXES.asOf, 'Saldo informado em'),
      money(BOXES.goal, 'Meta'),
      text(BOXES.purpose, 'Para'),
      number(BOXES.yield, 'Rende ao mês (%)')
    ]),
    views: [table('fin.boxes.all', 'Todas', [BOXES.title, BOXES.balance, BOXES.goal, BOXES.purpose, BOXES.yield])]
  })
}

/** The page the databases sit in. */
export function financePageProps(): BlockProps {
  return { title: [['Finanças']], icon: '💰' }
}

/** The order the databases are created and shown in. */
export const FINANCE_ORDER: readonly FinanceDb[] = ['ledger', 'recurring', 'budget', 'accounts', 'boxes']

/** The properties the tools rely on, with their types: `ensureFinance` puts back the ones that went missing. */
export function financeCoreTypes(db: FinanceDb): Record<string, PropertyType> {
  const schema = FINANCE_PROPS[db]().schema ?? {}
  return Object.fromEntries(Object.values(schema).map((property) => [property.id, property.type]))
}
