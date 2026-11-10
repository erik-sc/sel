import { randomUUID } from 'node:crypto'
import { AI_PRIVATE_MESSAGE, isPrivateForAi, privacyChecker } from '../../shared/aiPrivate'
import type { Account, AccountType, Books, Box, BudgetLine, Entry, Kind, Recurring } from '../../shared/finance/calc'
import { key } from '../../shared/finance/calc'
import {
  ACCOUNTS,
  BOXES,
  BUDGET,
  FINANCE_DB,
  FINANCE_ORDER,
  FINANCE_PAGE_ID,
  FINANCE_PROPS,
  type FinanceDb,
  financePageProps,
  KIND_ID,
  LEDGER,
  ME,
  RECURRING
} from '../../shared/finance'
import { plainText } from '../../shared/richtext'
import type { Block, Op, PropertySchema, PropertyValue } from '../../shared/types'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'

/**
 * The Finance block's data in the workspace: makes sure its page and databases are there
 * (shared/finance), reads them into the plain records the arithmetic works on
 * (shared/finance/calc.ts), and finds or adds the options a row names. Everything is written
 * through the repository as an edit in the window is: history keeps the state before, and the
 * caller tells the windows and sync.
 */

type Schema = Record<string, PropertySchema>

/**
 * Makes sure the Finance page and its five databases exist, the first time something is entered.
 * What is in the trash comes back; a core property that went missing or changed type is put
 * back, and nothing the user added is touched.
 */
export function ensureFinance(repo: Repository): void {
  repo.transaction(() => {
    const page = repo.get(FINANCE_PAGE_ID)
    if (!page) repo.create({ id: FINANCE_PAGE_ID, type: 'page', parentId: null, props: financePageProps() })
    else if (page.trashedAt !== null) repo.restore(FINANCE_PAGE_ID)
    for (const db of FINANCE_ORDER) {
      const id = FINANCE_DB[db]
      const existing = repo.get(id)
      if (!existing) {
        repo.create({ id, type: 'database', parentId: FINANCE_PAGE_ID, props: FINANCE_PROPS[db]() })
        continue
      }
      if (existing.trashedAt !== null) repo.restore(id)
      if (existing.type !== 'database') continue
      const wanted = FINANCE_PROPS[db]().schema as Schema
      const current = existing.props.schema ?? {}
      const missing = Object.values(wanted).filter(
        (property) => !Object.hasOwn(current, property.id) || current[property.id]?.type !== property.type
      )
      if (missing.length) repo.update(id, { props: { schema: { ...current, ...Object.fromEntries(missing.map((p) => [p.id, p])) } } })
    }
  })
}

/** True once the block has been set up and none of it was thrown away. */
export function financeExists(repo: Repository): boolean {
  return FINANCE_ORDER.every((db) => {
    const block = repo.get(FINANCE_DB[db])
    return !!block && block.type === 'database' && block.trashedAt === null
  })
}

/** A Finance database the AI may read, with what it needs put back when it is missing. */
export function financeDatabase(repo: Repository, db: FinanceDb): Block {
  if (!financeExists(repo)) ensureFinance(repo)
  const block = repo.get(FINANCE_DB[db])
  if (!block || block.type !== 'database') throw new ToolError('The Finance block could not be set up.')
  if (isPrivateForAi(repo, block.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  return block
}

export const schemaOf = (database: Block): Schema => (database.props.schema ?? {}) as Schema

// ---- reading -----------------------------------------------------------------------

const valuesOf = (row: Block): Record<string, PropertyValue> => (row.props.values ?? {}) as Record<string, PropertyValue>

const own = (row: Block, id: string): unknown => {
  const values = valuesOf(row)
  return Object.hasOwn(values, id) ? values[id] : undefined
}

export const titleOf = (row: Block): string =>
  plainText(row.props.title)
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim() || 'Sem nome'

const cents = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : 0)
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

function optionName(schema: Schema, propertyId: string, value: unknown): string | null {
  if (typeof value !== 'string') return null
  return schema[propertyId]?.options?.find((option) => option.id === value)?.name ?? null
}

const dayOf = (value: unknown): string | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const start = (value as { start?: unknown }).start
  return typeof start === 'string' && /^\d{4}-\d{2}-\d{2}/u.test(start) ? start.slice(0, 10) : null
}

const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A shared expense's parts, as stored: cents by person. Null for anything else. */
export function readShares(value: unknown): Record<string, number> | null {
  if (typeof value !== 'string' || !value.trim().startsWith('{') || value.length > 20_000) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const out: Record<string, number> = Object.create(null) as Record<string, number>
    for (const [person, amount] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && person.trim())
        out[person.trim().slice(0, 80)] = Math.round(amount)
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

const KIND_OF = new Map<string, Kind>(Object.entries(KIND_ID).map(([kind, id]) => [id, kind as Kind]))
const ACCOUNT_TYPE: Readonly<Record<string, AccountType>> = {
  'fin.account.checking': 'checking',
  'fin.account.card': 'card',
  'fin.account.cash': 'cash'
}

/** The rows of a Finance database the AI may see. */
export function rowsOf(repo: Repository, db: FinanceDb): Block[] {
  const hidden = privacyChecker(repo)
  return repo.children(FINANCE_DB[db]).filter((row) => row.type === 'page' && row.trashedAt === null && !hidden(row.id))
}

export function readEntry(row: Block, schema: Schema): Entry {
  return {
    id: row.id,
    title: titleOf(row),
    cents: Math.abs(cents(own(row, LEDGER.amount))),
    kind: KIND_OF.get(String(own(row, LEDGER.kind))) ?? 'expense',
    date: dayOf(own(row, LEDGER.date)) ?? localDay(row.createdAt),
    category: optionName(schema, LEDGER.category, own(row, LEDGER.category)),
    account: optionName(schema, LEDGER.account, own(row, LEDGER.account)),
    paid: own(row, LEDGER.status) !== 'fin.status.planned',
    paidBy: optionName(schema, LEDGER.paidBy, own(row, LEDGER.paidBy)) ?? ME,
    shares: readShares(own(row, LEDGER.split)),
    group: optionName(schema, LEDGER.group, own(row, LEDGER.group)),
    to: textOrNull(own(row, LEDGER.to)),
    invoice: textOrNull(own(row, LEDGER.invoice)),
    instalment: textOrNull(own(row, LEDGER.instalment)),
    series: textOrNull(own(row, LEDGER.series)),
    recurring: textOrNull(own(row, LEDGER.recurring)),
    ref: textOrNull(own(row, LEDGER.ref)),
    createdAt: row.createdAt
  }
}

/** Everything the arithmetic needs, read once. */
export function readBooks(repo: Repository): Books {
  // Each is checked as it is read: there, a database, and not private from the AI.
  const ledgerSchema = schemaOf(financeDatabase(repo, 'ledger'))
  const recurringSchema = schemaOf(financeDatabase(repo, 'recurring'))
  const budgetSchema = schemaOf(financeDatabase(repo, 'budget'))
  financeDatabase(repo, 'accounts')
  financeDatabase(repo, 'boxes')
  return {
    entries: rowsOf(repo, 'ledger').map((row) => readEntry(row, ledgerSchema)),
    recurring: rowsOf(repo, 'recurring').map(
      (row): Recurring => ({
        id: row.id,
        title: titleOf(row),
        cents: Math.abs(cents(own(row, RECURRING.amount))),
        kind: own(row, RECURRING.kind) === KIND_ID.income ? 'income' : 'expense',
        day: numberOrNull(own(row, RECURRING.day)),
        category: optionName(recurringSchema, RECURRING.category, own(row, RECURRING.category)),
        account: optionName(recurringSchema, RECURRING.account, own(row, RECURRING.account)),
        active: own(row, RECURRING.active) !== false
      })
    ),
    budget: rowsOf(repo, 'budget').map(
      (row): BudgetLine => ({
        id: row.id,
        category: titleOf(row),
        cents: Math.abs(cents(own(row, BUDGET.limit))),
        group: optionName(budgetSchema, BUDGET.group, own(row, BUDGET.group))
      })
    ),
    accounts: rowsOf(repo, 'accounts').map(
      (row): Account => ({
        id: row.id,
        name: titleOf(row),
        type: ACCOUNT_TYPE[String(own(row, ACCOUNTS.type))] ?? 'checking',
        cents: cents(own(row, ACCOUNTS.balance)),
        asOf: numberOrNull(own(row, ACCOUNTS.asOf)) ?? row.createdAt,
        closingDay: numberOrNull(own(row, ACCOUNTS.closingDay)),
        dueDay: numberOrNull(own(row, ACCOUNTS.dueDay))
      })
    ),
    boxes: rowsOf(repo, 'boxes').map(
      (row): Box => ({
        id: row.id,
        name: titleOf(row),
        cents: cents(own(row, BOXES.balance)),
        asOf: numberOrNull(own(row, BOXES.asOf)) ?? row.createdAt,
        goal: own(row, BOXES.goal) === undefined ? null : cents(own(row, BOXES.goal)),
        purpose: textOrNull(own(row, BOXES.purpose)) ?? '',
        yield: numberOrNull(own(row, BOXES.yield))
      })
    )
  }
}

// ---- writing -----------------------------------------------------------------------

const COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow', 'red']

/**
 * The schemas of the Finance databases while a tool works: an option a row names is found by its
 * name (case and accents aside) or added, and `ops` says which databases changed.
 */
export class Options {
  private readonly schemas = new Map<FinanceDb, { schema: Schema; before: string }>()

  constructor(private readonly repo: Repository) {}

  schema(db: FinanceDb): Schema {
    let held = this.schemas.get(db)
    if (!held) {
      const schema = structuredClone(schemaOf(financeDatabase(this.repo, db)))
      held = { schema, before: JSON.stringify(schema) }
      this.schemas.set(db, held)
    }
    return held.schema
  }

  /** The id of the option called `name`, added when the property has none. */
  id(db: FinanceDb, propertyId: string, name: string): string {
    const schema = this.schema(db)
    const property = schema[propertyId]
    if (!property) throw new ToolError('The Finance block is missing a property: open sel once to put it back.')
    const options = property.options ?? []
    const wanted = key(name)
    const existing = options.find((option) => key(option.name) === wanted)
    if (existing) return existing.id
    const option = { id: randomUUID(), name: name.trim().slice(0, 100), color: COLORS[options.length % COLORS.length] }
    schema[propertyId] = { ...property, options: [...options, option] }
    return option.id
  }

  /** The updates that store the options added, to run before the rows that use them. */
  ops(): Op[] {
    const ops: Op[] = []
    for (const [db, held] of this.schemas) {
      if (JSON.stringify(held.schema) !== held.before)
        ops.push({ op: 'update', id: FINANCE_DB[db], patch: { props: { schema: held.schema } } })
    }
    return ops
  }
}

/** A row of one of the Finance databases, by id, that the AI may change. */
export function financeRow(repo: Repository, raw: unknown): { row: Block; db: FinanceDb } {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if (!id) throw new ToolError('Say which one, by id.')
  const row = repo.get(id)
  const db = row ? FINANCE_ORDER.find((each) => FINANCE_DB[each] === row.parentId) : undefined
  if (!row || !db || row.type !== 'page' || row.trashedAt !== null) throw new ToolError('Nothing in Finance has that id.')
  if (isPrivateForAi(repo, row.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  return { row, db }
}

/** The row of `db` called `name` (case and accents aside), or null. */
export function rowNamed(repo: Repository, db: FinanceDb, name: string): Block | null {
  const wanted = key(name)
  return rowsOf(repo, db).find((row) => key(titleOf(row)) === wanted) ?? null
}
