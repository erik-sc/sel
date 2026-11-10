import { randomUUID } from 'node:crypto'
import {
  type Account,
  addMonths,
  addMonthsToDate,
  type Books,
  dayOf,
  debts,
  type Entry,
  forecast,
  invoice,
  invoiceOf,
  isMe,
  key,
  type Kind,
  monthOf,
  monthPicture,
  parts,
  projection,
  same
} from '../../shared/finance/calc'
import { ACCOUNTS, BOXES, BUDGET, FINANCE_DB, type FinanceDb, KIND_ID, LEDGER, ME, RECURRING } from '../../shared/finance'
import type { Block, Op, PropertyValue } from '../../shared/types'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'
import { financeDatabase, financeExists, financeRow, Options, readBooks, readEntry, rowNamed, rowsOf, schemaOf, titleOf } from './store'
import { FINANCE_CAPS } from './toolspecs'
import { financeMonthView } from './views'

/**
 * The Finance block's tools (./toolspecs.ts): what you ask Claude on the phone about money ("how
 * is my month", "42,90 at the market on the card", "split this receipt with Ana"). They work on
 * the block's databases (shared/finance) through the repository, as an edit in the window does.
 *
 * Nothing here is deleted for good: `finance_delete` moves rows to the trash. What the user
 * keeps private from the AI is refused (./store.ts).
 */

/** What the tools need: the repository, and the Markdown importer a receipt's items are written with. */
export interface FinanceTarget {
  repo: Repository
  markdown?: Pick<typeof import('../markdown'), 'appendMarkdownText'>
}

type Args = Record<string, unknown>

// ---- arguments ---------------------------------------------------------------------

export const args = (raw: unknown): Args => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Args) : {})

export const oneLine = (text: string, max: number = FINANCE_CAPS.text): string =>
  text
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max)

export function text(value: unknown, what: string, required: true): string
export function text(value: unknown, what: string, required?: false): string | undefined
export function text(value: unknown, what: string, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new ToolError(`Give ${what}.`)
    return undefined
  }
  if (typeof value !== 'string') throw new ToolError(`${what} must be text.`)
  const clean = oneLine(value)
  if (!clean && required) throw new ToolError(`Give ${what}.`)
  return clean || undefined
}

/** A name that may be cleared: undefined when not given, null to clear. */
function clearable(a: Args, name: string): string | null | undefined {
  if (!Object.hasOwn(a, name)) return undefined
  if (a[name] === null) return null
  return text(a[name], name) ?? null
}

const MAX_CENTS = 100_000_000_000

/** An amount in cents from 42.9, "42,90", "1.234,56" or "R$ 1,234.56". */
export function parseAmount(value: unknown): number | null {
  let number: number
  if (typeof value === 'number') number = value
  else if (typeof value === 'string') {
    let digits = value.replace(/[^\d.,-]/gu, '')
    if (!/\d/u.test(digits)) return null
    const comma = digits.lastIndexOf(',')
    const dot = digits.lastIndexOf('.')
    if (comma >= 0 && dot >= 0) {
      // Both: the one written last is the decimal mark.
      digits = comma > dot ? digits.replace(/\./gu, '').replace(',', '.') : digits.replace(/,/gu, '')
    } else if (comma >= 0) {
      digits = /^-?\d{1,3}(,\d{3})+$/u.test(digits) ? digits.replace(/,/gu, '') : digits.replace(',', '.')
    } else if (/^-?\d{1,3}(\.\d{3})+$/u.test(digits)) {
      digits = digits.replace(/\./gu, '')
    }
    number = Number(digits)
  } else return null
  if (!Number.isFinite(number)) return null
  const cents = Math.round(number * 100)
  return Math.abs(cents) <= MAX_CENTS ? cents : null
}

export function amount(value: unknown, what = 'amount', allowZero = false): number {
  const cents = parseAmount(value)
  if (cents === null) throw new ToolError(`${what}: give a number such as 42.9, or text such as "R$ 42,90".`)
  if (cents < 0 || (cents === 0 && !allowZero))
    throw new ToolError(`${what} must be more than zero: what it is (expense, income) says the direction.`)
  return cents
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
export const localDay = (now: Date): string => `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

export function date(value: unknown, now: Date): string {
  if (value === undefined || value === null || value === '') return localDay(now)
  const day = typeof value === 'string' ? value.trim().slice(0, 10) : ''
  // dayOf holds a day to its month: a day the month does not have comes back as another.
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/u.test(day) || dayOf(day.slice(0, 7), Number(day.slice(8))) !== day)
    throw new ToolError('A date is "YYYY-MM-DD".')
  return day
}

export function month(value: unknown, now: Date): string {
  if (value === undefined || value === null || value === '') return localDay(now).slice(0, 7)
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(text)) throw new ToolError('A month is "YYYY-MM".')
  return text
}

function people(value: unknown, what: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > FINANCE_CAPS.people) throw new ToolError(`${what} is a list of names.`)
  const out: string[] = []
  for (const each of value) {
    const name = typeof each === 'string' ? oneLine(each, 80) : ''
    if (!name) throw new ToolError(`${what} is a list of names.`)
    const person = isMe(name) ? ME : name
    if (!out.some((other) => key(other) === key(person))) out.push(person)
  }
  return out
}

const person = (name: string | undefined): string => (!name || isMe(name) ? ME : name)

// ---- words -------------------------------------------------------------------------

/** "R$ 1.234,56". */
export function brl(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
  return `${cents < 0 ? '-' : ''}R$ ${whole},${pad(Math.abs(cents) % 100)}`
}

const KIND_WORD: Readonly<Record<Kind, string>> = { expense: 'gasto', income: 'receita', transfer: 'transferência', settlement: 'acerto' }

export function entryLine(entry: Entry): string {
  const out = [`- ${entry.date} · ${entry.title} [${entry.id}] · ${brl(entry.cents)} · ${KIND_WORD[entry.kind]}`]
  if (entry.category) out.push(`#${entry.category}`)
  if (entry.account) out.push(entry.account)
  if (entry.to) out.push(`→ ${entry.to}`)
  if (entry.invoice) out.push(`fatura ${entry.invoice}`)
  if (entry.instalment) out.push(`parcela ${entry.instalment}`)
  if (!isMe(entry.paidBy)) out.push(`pago por ${entry.paidBy}`)
  if (entry.shares)
    out.push(
      `dividido: ${Object.entries(entry.shares)
        .map(([name, cents]) => `${name} ${brl(cents)}`)
        .join(', ')}`
    )
  if (entry.group) out.push(`grupo ${entry.group}`)
  if (!entry.paid) out.push('previsto')
  return out.join(' · ')
}

export const reais = (cents: number): number => cents / 100

// ---- sharing -----------------------------------------------------------------------

/** `total` among people in the proportions of `weights`, to the cent: the largest parts take what rounding leaves. */
export function proportional(total: number, weights: readonly (readonly [string, number])[]): Record<string, number> {
  const sum = weights.reduce((all, [, weight]) => all + weight, 0)
  const out: Record<string, number> = Object.create(null) as Record<string, number>
  if (sum <= 0) return out
  let given = 0
  for (const [name, weight] of weights) {
    out[name] = Math.floor((total * weight) / sum)
    given += out[name]
  }
  const byWeight = [...weights].sort((a, b) => b[1] - a[1])
  for (let i = 0; given < total; i++, given++) out[byWeight[i % byWeight.length][0]] += 1
  return out
}

/** Equal parts of `total` among `names`. */
function equally(total: number, names: readonly string[]): Record<string, number> {
  const each = parts(total, names.length)
  const out: Record<string, number> = Object.create(null) as Record<string, number>
  names.forEach((name, i) => {
    out[name] = each[i]
  })
  return out
}

/** The parts of an expense from what was given: exact `shares`, or equal parts with `split_with`. Null: not shared. */
function sharesFrom(a: Args, total: number, payer: string): Record<string, number> | null | undefined {
  if (a['shares'] !== undefined && a['shares'] !== null) {
    const raw = a['shares']
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new ToolError('shares is an object of amounts by person.')
    const out: Record<string, number> = Object.create(null) as Record<string, number>
    for (const [name, value] of Object.entries(raw as Args)) {
      const who = person(oneLine(name, 80))
      out[who] = (out[who] ?? 0) + amount(value, `The part of ${who}`, true)
    }
    const sum = Object.values(out).reduce((all, cents) => all + cents, 0)
    if (sum !== total) throw new ToolError(`The parts add up to ${brl(sum)}, and the amount is ${brl(total)}.`)
    return Object.keys(out).length ? out : null
  }
  const others = people(a['split_with'], 'split_with')
  if (others === undefined) return undefined
  if (!others.length) return null
  const names = [payer, ME, ...others].filter((name, i, all) => all.findIndex((other) => key(other) === key(name)) === i)
  return names.length > 1 ? equally(total, names) : null
}

// ---- writing entries ------------------------------------------------------------------

export interface Draft {
  title: string
  cents: number
  kind: Kind
  date: string
  category?: string | null
  account?: string | null
  to?: string | null
  planned?: boolean
  paidBy: string
  shares?: Record<string, number> | null
  group?: string | null
  instalments?: number
  recurring?: string
  ref?: string
  items?: string
  note?: string
}

export const cardNamed = (books: Books, name: string | null | undefined): Account | null =>
  books.accounts.find((account) => account.type === 'card' && same(account.name, name)) ?? null

/** The stored values of one ledger row. */
function ledgerValues(options: Options, draft: Draft, extra: Record<string, PropertyValue> = {}): Record<string, PropertyValue> {
  const values: Record<string, PropertyValue> = {
    [LEDGER.amount]: reais(draft.cents),
    [LEDGER.kind]: KIND_ID[draft.kind],
    [LEDGER.date]: { start: draft.date },
    [LEDGER.status]: draft.planned ? 'fin.status.planned' : 'fin.status.paid',
    [LEDGER.paidBy]: options.id('ledger', LEDGER.paidBy, draft.paidBy),
    ...extra
  }
  if (draft.category) values[LEDGER.category] = options.id('ledger', LEDGER.category, draft.category)
  if (draft.account) values[LEDGER.account] = options.id('ledger', LEDGER.account, draft.account)
  if (draft.group) values[LEDGER.group] = options.id('ledger', LEDGER.group, draft.group)
  if (draft.to) values[LEDGER.to] = draft.to
  if (draft.shares) values[LEDGER.split] = JSON.stringify(draft.shares)
  if (draft.recurring) values[LEDGER.recurring] = draft.recurring
  if (draft.ref) values[LEDGER.ref] = draft.ref
  return values
}

/** Adds a draft to the ledger: one row, or one a month for a purchase in instalments. Returns the rows as stored. */
export function addEntries({ repo, markdown }: FinanceTarget, books: Books, draft: Draft, body?: string): Entry[] {
  const options = new Options(repo)
  const card = draft.kind === 'expense' && isMe(draft.paidBy) ? cardNamed(books, draft.account) : null
  const count = draft.instalments && draft.instalments > 1 ? draft.instalments : 1
  if (count > 1 && draft.kind !== 'expense') throw new ToolError('Only an expense is paid in instalments.')
  const amounts = parts(draft.cents, count)
  const shareParts = draft.shares ? Object.entries(draft.shares).map(([name, cents]) => [name, parts(cents, count)] as const) : null
  const series = count > 1 ? randomUUID() : null
  const first = card ? invoiceOf(draft.date, card) : null
  const ids: string[] = []
  const creates: Op[] = []
  for (let i = 0; i < count; i++) {
    const id = randomUUID()
    ids.push(id)
    const extra: Record<string, PropertyValue> = {}
    if (first) extra[LEDGER.invoice] = addMonths(first, i)
    if (series) {
      extra[LEDGER.series] = series
      extra[LEDGER.instalment] = `${i + 1}/${count}`
    }
    if (i === 0 && draft.items) extra[LEDGER.items] = draft.items
    const shares = shareParts ? Object.fromEntries(shareParts.map(([name, each]) => [name, each[i]])) : null
    // The parts of an instalment add up to it: rounding each person's part by itself may be a cent off.
    if (shares) {
      const off = amounts[i] - Object.values(shares).reduce((all, cents) => all + cents, 0)
      const payer = Object.keys(shares).find((name) => key(name) === key(draft.paidBy)) ?? Object.keys(shares)[0]
      shares[payer] += off
    }
    const values = ledgerValues(options, { ...draft, cents: amounts[i], date: addMonthsToDate(draft.date, i), shares }, extra)
    creates.push({ op: 'create', input: { id, type: 'page', parentId: FINANCE_DB.ledger, props: { title: [[draft.title]], values } } })
    if (i === 0 && draft.note) {
      for (const line of draft.note.split(/\r?\n/u).slice(0, 100)) {
        if (line.trim()) creates.push({ op: 'create', input: { type: 'text', parentId: id, props: { title: [[line.slice(0, 2000)]] } } })
      }
    }
  }
  repo.apply([...options.ops(), ...creates])
  if (body && markdown) markdown.appendMarkdownText(repo, ids[0], body)
  const schema = schemaOf(financeDatabase(repo, 'ledger'))
  return ids.map((id) => readEntry(repo.get(id) as Block, schema))
}

const added = (entries: Entry[]): string =>
  entries.length === 1
    ? `Added:\n${entryLine(entries[0])}`
    : `Added ${entries.length} instalments, ${brl(entries.reduce((all, entry) => all + entry.cents, 0))} in all:\n${entries.map(entryLine).join('\n')}`

function add(target: FinanceTarget, a: Args, now: Date): string {
  const kind = a['kind'] === undefined ? 'expense' : a['kind']
  if (kind !== 'expense' && kind !== 'income' && kind !== 'transfer') throw new ToolError('kind is expense, income or transfer.')
  const cents = amount(a['amount'])
  const paidBy = person(text(a['paid_by'], 'paid_by'))
  const to = text(a['to'], 'to')
  const account = text(a['account'], 'account')
  if (kind === 'transfer' && (!account || !to))
    throw new ToolError('A transfer needs where it left from ("account") and where it went ("to").')
  const shares = kind === 'expense' ? sharesFrom(a, cents, paidBy) : undefined
  if (!isMe(paidBy) && !shares)
    throw new ToolError(`Paid by ${paidBy}: say who it is split with ("split_with") or the parts ("shares"), or it is not the user's.`)
  const instalments = a['instalments']
  if (
    instalments !== undefined &&
    (typeof instalments !== 'number' || !Number.isInteger(instalments) || instalments < 1 || instalments > FINANCE_CAPS.instalments)
  )
    throw new ToolError(`instalments is a whole number up to ${FINANCE_CAPS.instalments}.`)
  if (typeof instalments === 'number' && instalments > 1 && kind !== 'expense')
    throw new ToolError('Only an expense is paid in instalments.')
  const note = a['note']
  if (note !== undefined && note !== null && typeof note !== 'string') throw new ToolError('note must be text.')
  // Everything is read before the block is touched: a call that cannot be made sets nothing up.
  const draft: Draft = {
    title: text(a['description'], 'the description', true),
    cents,
    kind,
    date: date(a['date'], now),
    category: text(a['category'], 'category'),
    account,
    to: kind === 'transfer' ? to : undefined,
    planned: a['planned'] === true,
    paidBy,
    shares,
    group: text(a['group'], 'group'),
    instalments: typeof instalments === 'number' ? instalments : undefined,
    note: typeof note === 'string' ? note.slice(0, FINANCE_CAPS.note) : undefined
  }
  return added(addEntries(target, readBooks(target.repo), draft))
}

function receipt(target: FinanceTarget, a: Args, now: Date): string {
  const store = text(a['store'], 'the store', true)
  const raw = a['items']
  if (!Array.isArray(raw) || !raw.length || raw.length > FINANCE_CAPS.items)
    throw new ToolError(`items is a list of 1 to ${FINANCE_CAPS.items} lines.`)
  const paidBy = person(text(a['paid_by'], 'paid_by'))
  const others = people(a['split_with'], 'split_with')
  const everyone = others?.length
    ? [paidBy, ME, ...others].filter((name, i, all) => all.findIndex((other) => key(other) === key(name)) === i)
    : [ME]
  const lines: { name: string; qty: number | null; cents: number; people: string[] }[] = []
  const weights = new Map<string, number>()
  for (const each of raw) {
    const item = args(each)
    const name = text(item['name'], "an item's name", true)
    const cents = amount(item['amount'], `The amount of ${name}`, true)
    const sharing = people(item['people'], `The people of ${name}`)
    const among = sharing?.length ? sharing : everyone
    const qty = typeof item['qty'] === 'number' && Number.isFinite(item['qty']) ? item['qty'] : null
    lines.push({ name, qty, cents, people: among })
    for (const [who, part] of Object.entries(equally(cents, among))) weights.set(who, (weights.get(who) ?? 0) + part)
  }
  const sum = lines.reduce((all, line) => all + line.cents, 0)
  const total = a['total'] === undefined || a['total'] === null ? sum : amount(a['total'], 'total')
  if (total <= 0) throw new ToolError('The items add up to nothing.')
  const split = proportional(total, [...weights.entries()])
  const names = Object.keys(split)
  // All the payer's: not a shared expense.
  const shares = names.length === 1 && key(names[0]) === key(paidBy) ? null : split
  const instalments = a['instalments']
  if (
    instalments !== undefined &&
    (typeof instalments !== 'number' || !Number.isInteger(instalments) || instalments < 1 || instalments > FINANCE_CAPS.instalments)
  )
    throw new ToolError(`instalments is a whole number up to ${FINANCE_CAPS.instalments}.`)
  const cell = (value: string): string => value.replace(/\|/gu, '/')
  const body = [
    '| Item | Qtd | Valor | Quem |',
    '| --- | --- | --- | --- |',
    ...lines.map((line) => `| ${cell(line.name)} | ${line.qty ?? ''} | ${brl(line.cents)} | ${cell(line.people.join(', '))} |`),
    ...(total !== sum ? [`| Total pago (serviço, desconto) |  | ${brl(total)} |  |`] : [])
  ].join('\n')
  const itemsJson = JSON.stringify(lines.map((line) => ({ name: line.name, qty: line.qty, cents: line.cents, people: line.people })))
  const draft: Draft = {
    title: store,
    cents: total,
    kind: 'expense',
    date: date(a['date'], now),
    category: text(a['category'], 'category'),
    account: text(a['account'], 'account'),
    paidBy,
    shares,
    group: text(a['group'], 'group'),
    instalments: typeof instalments === 'number' ? instalments : undefined,
    // Kept as data when it fits; the page has the lines either way.
    items: itemsJson.length <= 60_000 ? itemsJson : undefined
  }
  const entries = addEntries(target, readBooks(target.repo), draft, body)
  const adjusted = total !== sum ? ` The items add up to ${brl(sum)}; every part was scaled to the ${brl(total)} paid.` : ''
  return `${added(entries)}\n${lines.length} item${lines.length === 1 ? '' : 's'} kept on the entry's page.${adjusted}`
}

function update({ repo }: FinanceTarget, a: Args, now: Date): string {
  const { row, db } = financeRow(repo, a['id'])
  if (db !== 'ledger')
    throw new ToolError(
      'That is not an entry of the ledger: change it with the tool of what it is (finance_recurring, finance_budget, finance_account, finance_box).'
    )
  const options = new Options(repo)
  const before = readEntry(row, options.schema('ledger'))
  const values = { ...((row.props.values ?? {}) as Record<string, PropertyValue>) }
  const changed: string[] = []
  const set = (id: string, value: PropertyValue | null, name: string): void => {
    if (value === null) delete values[id]
    else values[id] = value
    changed.push(name)
  }
  const title = text(a['description'], 'description')
  const cents = a['amount'] === undefined ? before.cents : amount(a['amount'])
  if (a['amount'] !== undefined) set(LEDGER.amount, reais(cents), 'amount')
  const day = a['date'] === undefined ? before.date : date(a['date'], now)
  if (a['date'] !== undefined) set(LEDGER.date, { start: day }, 'date')
  for (const [name, id] of [
    ['category', LEDGER.category],
    ['account', LEDGER.account],
    ['group', LEDGER.group]
  ] as const) {
    const value = clearable(a, name)
    if (value !== undefined) set(id, value === null ? null : options.id('ledger', id, value), name)
  }
  const to = clearable(a, 'to')
  if (to !== undefined) set(LEDGER.to, to, 'to')
  if (typeof a['planned'] === 'boolean') set(LEDGER.status, a['planned'] ? 'fin.status.planned' : 'fin.status.paid', 'planned')
  const paidBy = a['paid_by'] === undefined ? before.paidBy : person(text(a['paid_by'], 'paid_by'))
  if (a['paid_by'] !== undefined) set(LEDGER.paidBy, options.id('ledger', LEDGER.paidBy, paidBy), 'paid_by')
  const shares = before.kind === 'expense' ? sharesFrom(a, cents, paidBy) : undefined
  if (shares !== undefined) set(LEDGER.split, shares ? JSON.stringify(shares) : null, 'split')
  else if (before.shares && cents !== before.cents) {
    // The amount changed and the split was not given again: every part keeps its proportion.
    set(LEDGER.split, JSON.stringify(proportional(cents, Object.entries(before.shares))), 'split (same proportions)')
  }
  // A card purchase that changed day or card falls on the invoice of what it is now; instalments keep theirs.
  if ((a['date'] !== undefined || Object.hasOwn(a, 'account')) && before.kind === 'expense' && !before.series) {
    const account = Object.hasOwn(a, 'account') ? clearable(a, 'account') : before.account
    const card = isMe(paidBy) ? cardNamed(readBooks(repo), account) : null
    if (card) values[LEDGER.invoice] = invoiceOf(day, card)
    else delete values[LEDGER.invoice]
  }
  if (!changed.length && title === undefined) throw new ToolError('Say what to change.')
  repo.apply([...options.ops(), { op: 'update', id: row.id, patch: { props: { ...(title ? { title: [[title]] } : {}), values } } }])
  const after = readEntry(repo.get(row.id) as Block, schemaOf(financeDatabase(repo, 'ledger')))
  return `Updated (${[...(title ? ['description'] : []), ...changed].join(', ')}):\n${entryLine(after)}`
}

function remove({ repo }: FinanceTarget, a: Args): string {
  const { row, db } = financeRow(repo, a['id'])
  let rows = [row]
  if (a['series'] === true && db === 'ledger') {
    const series = row.props.values?.[LEDGER.series]
    if (typeof series === 'string' && series) rows = rowsOf(repo, 'ledger').filter((each) => each.props.values?.[LEDGER.series] === series)
  }
  repo.apply(rows.map((each) => ({ op: 'delete', id: each.id })))
  return rows.length === 1
    ? `Moved to the trash: ${titleOf(row)} [${row.id}]. It can be restored in sel (Trash), or with restore_page.`
    : `Moved ${rows.length} instalments of ${titleOf(row)} to the trash. They can be restored in sel (Trash).`
}

function settle(target: FinanceTarget, a: Args, now: Date): string {
  const who = text(a['person'], 'the person', true)
  if (isMe(who)) throw new ToolError('Settle with someone else.')
  const direction = a['direction']
  if (direction !== 'received' && direction !== 'paid')
    throw new ToolError('direction is "received" (from the person) or "paid" (to them).')
  const cents = amount(a['amount'])
  const draft: Draft = {
    title: direction === 'received' ? `Acerto: ${who} pagou` : `Acerto: paguei ${who}`,
    cents,
    kind: 'settlement',
    date: date(a['date'], now),
    account: text(a['account'], 'account'),
    paidBy: direction === 'received' ? who : ME,
    to: direction === 'received' ? ME : who,
    group: text(a['group'], 'group')
  }
  const [entry] = addEntries(target, readBooks(target.repo), draft)
  const left = debts(readBooks(target.repo).entries).find(
    (debt) => (isMe(debt.from) && same(debt.to, who)) || (isMe(debt.to) && same(debt.from, who))
  )
  const now_ = !left
    ? `You and ${who} are even.`
    : isMe(left.to)
      ? `${who} still owes you ${brl(left.cents)}.`
      : `You still owe ${who} ${brl(left.cents)}.`
  return `Recorded:\n${entryLine(entry)}\n${now_}`
}

// ---- the lists entries lean on ---------------------------------------------------------

/** Creates or updates the row of `db` called `name`. `values` by property id; null clears. */
export function upsert(
  repo: Repository,
  db: FinanceDb,
  name: string,
  values: Record<string, PropertyValue | null>,
  options: Options
): { row: Block; created: boolean } {
  financeDatabase(repo, db)
  const existing = rowNamed(repo, db, name)
  const merged: Record<string, PropertyValue> = { ...((existing?.props.values ?? {}) as Record<string, PropertyValue>) }
  for (const [id, value] of Object.entries(values)) {
    if (value === null) delete merged[id]
    else merged[id] = value
  }
  const id = existing?.id ?? randomUUID()
  repo.apply([
    ...options.ops(),
    existing
      ? { op: 'update', id, patch: { props: { values: merged } } }
      : { op: 'create', input: { id, type: 'page', parentId: FINANCE_DB[db], props: { title: [[name]], values: merged } } }
  ])
  return { row: repo.get(id) as Block, created: !existing }
}

/** Says what a holder has now and since when: the row's own stamp, so it is on the clock the entries are on. */
function stampBalance(repo: Repository, row: Block, asOf: string): void {
  const stored = repo.get(row.id) as Block
  repo.update(row.id, {
    props: { values: { ...((stored.props.values ?? {}) as Record<string, PropertyValue>), [asOf]: stored.updatedAt } }
  })
}

function recurring({ repo }: FinanceTarget, a: Args): string {
  const name = text(a['name'], 'the name', true)
  const options = new Options(repo)
  const existing = rowNamed(repo, 'recurring', name)
  const kind = a['kind']
  if (kind !== undefined && kind !== 'expense' && kind !== 'income') throw new ToolError('kind is expense or income.')
  if (!existing && a['amount'] === undefined) throw new ToolError(`${name} is new: give its amount.`)
  const day = a['day']
  if (day !== undefined && (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31))
    throw new ToolError('day is a day of the month, 1 to 31.')
  const values: Record<string, PropertyValue | null> = {}
  if (a['amount'] !== undefined) values[RECURRING.amount] = reais(amount(a['amount']))
  if (kind !== undefined || !existing) values[RECURRING.kind] = KIND_ID[kind === 'income' ? 'income' : 'expense']
  if (typeof day === 'number') values[RECURRING.day] = day
  const category = text(a['category'], 'category')
  if (category) values[RECURRING.category] = options.id('recurring', RECURRING.category, category)
  const account = text(a['account'], 'account')
  if (account) values[RECURRING.account] = options.id('recurring', RECURRING.account, account)
  if (typeof a['active'] === 'boolean' || !existing) values[RECURRING.active] = a['active'] !== false
  const { row, created } = upsert(repo, 'recurring', name, values, options)
  const line = readBooks(repo).recurring.find((each) => each.id === row.id)
  return `${created ? 'Added' : 'Updated'}: ${titleOf(row)} [${row.id}] · ${brl(line?.cents ?? 0)} a month · ${line?.kind === 'income' ? 'income' : 'bill'}${line?.day ? ` · day ${line.day}` : ''}${line?.active === false ? ' · stopped' : ''}.`
}

function pay(target: FinanceTarget, a: Args, now: Date): string {
  const { repo } = target
  const name = text(a['name'], 'the recurring line, by name or id', true)
  if (!financeExists(repo)) throw new ToolError('There are no recurring lines yet: add one with finance_recurring.')
  const books = readBooks(repo)
  const line = books.recurring.find((each) => each.id === name) ?? books.recurring.find((each) => same(each.title, name))
  if (!line) {
    const known = books.recurring.map((each) => `“${each.title}”`).slice(0, 30)
    throw new ToolError(
      known.length
        ? `No recurring line is called “${name}”. There are: ${known.join(', ')}.`
        : 'There are no recurring lines yet: add one with finance_recurring.'
    )
  }
  const ref = month(a['month'], now)
  const already = books.entries.find((entry) => entry.recurring === line.id && (entry.ref ?? monthOf(entry.date)) === ref && entry.paid)
  if (already) return `${line.title} was already ${line.kind === 'income' ? 'received' : 'paid'} for ${ref}:\n${entryLine(already)}`
  const today = localDay(now)
  const [entry] = addEntries(target, books, {
    title: line.title,
    cents: a['amount'] === undefined ? line.cents : amount(a['amount']),
    kind: line.kind,
    date: a['date'] !== undefined ? date(a['date'], now) : monthOf(today) === ref || !line.day ? today : dayOf(ref, line.day),
    category: line.category,
    account: text(a['account'], 'account') ?? line.account,
    paidBy: ME,
    recurring: line.id,
    ref
  })
  return `${line.kind === 'income' ? 'Received' : 'Paid'} for ${ref}:\n${entryLine(entry)}`
}

function payInvoice(target: FinanceTarget, a: Args, now: Date): string {
  const { repo } = target
  const name = text(a['card'], 'the card', true)
  const from = text(a['account'], 'the account it is paid from', true)
  if (!financeExists(repo)) throw new ToolError('There are no cards yet: add one with finance_account (type "card").')
  const books = readBooks(repo)
  const card = cardNamed(books, name)
  if (!card) {
    const cards = books.accounts.filter((account) => account.type === 'card').map((account) => `“${account.name}”`)
    throw new ToolError(
      cards.length
        ? `No card is called “${name}”. There are: ${cards.join(', ')}.`
        : 'There are no cards yet: add one with finance_account (type "card").'
    )
  }
  const ref = month(a['month'], now)
  const due = invoice(books, card, ref)
  if (due.paid) return `The ${ref} invoice of ${card.name} was already paid.`
  const cents = a['amount'] === undefined ? due.cents : amount(a['amount'])
  if (!cents) throw new ToolError(`The ${ref} invoice of ${card.name} has nothing on it.`)
  const [entry] = addEntries(target, books, {
    title: `Fatura ${card.name} ${ref}`,
    cents,
    kind: 'transfer',
    date: date(a['date'], now),
    account: from,
    to: card.name,
    paidBy: ME,
    ref
  })
  return `Paid:\n${entryLine(entry)}`
}

function setBudget({ repo }: FinanceTarget, a: Args): string {
  const category = text(a['category'], 'the category', true)
  const options = new Options(repo)
  // The ledger knows the category by the same name, so entries and limits meet.
  options.id('ledger', LEDGER.category, category)
  const values: Record<string, PropertyValue | null> = { [BUDGET.limit]: reais(amount(a['limit'], 'limit', true)) }
  const group = text(a['group'], 'group')
  if (group) values[BUDGET.group] = options.id('budget', BUDGET.group, group)
  const { row, created } = upsert(repo, 'budget', category, values, options)
  return `${created ? 'Added' : 'Updated'}: ${titleOf(row)} [${row.id}] · ${brl(Math.round(Number(row.props.values?.[BUDGET.limit] ?? 0) * 100))} a month.`
}

const TYPE_ID = { checking: 'fin.account.checking', card: 'fin.account.card', cash: 'fin.account.cash' } as const

function setAccount({ repo }: FinanceTarget, a: Args): string {
  const name = text(a['name'], 'the name', true)
  const options = new Options(repo)
  const existing = rowNamed(repo, 'accounts', name)
  const type = a['type']
  if (type !== undefined && type !== 'checking' && type !== 'card' && type !== 'cash')
    throw new ToolError('type is checking, card or cash.')
  const values: Record<string, PropertyValue | null> = {}
  if (type !== undefined || !existing) values[ACCOUNTS.type] = TYPE_ID[type ?? 'checking']
  const balance = a['balance'] === undefined ? undefined : parseAmount(a['balance'])
  if (balance === null) throw new ToolError('balance: give a number such as 1234.56.')
  if (balance !== undefined) values[ACCOUNTS.balance] = reais(balance)
  for (const [key_, id] of [
    ['closing_day', ACCOUNTS.closingDay],
    ['due_day', ACCOUNTS.dueDay]
  ] as const) {
    const day = a[key_]
    if (day === undefined) continue
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31)
      throw new ToolError(`${key_} is a day of the month, 1 to 31.`)
    values[id] = day
  }
  // Entries name the account by the same word.
  options.id('ledger', LEDGER.account, name)
  const { row, created } = upsert(repo, 'accounts', name, values, options)
  if (balance !== undefined) stampBalance(repo, row, ACCOUNTS.asOf)
  const account = readBooks(repo).accounts.find((each) => each.id === row.id)
  const days = account?.type === 'card' ? ` · closes on day ${account.closingDay ?? '?'}, due on day ${account.dueDay ?? '?'}` : ''
  return `${created ? 'Added' : 'Updated'}: ${titleOf(row)} [${row.id}] · ${account?.type ?? 'checking'}${account && account.type !== 'card' ? ` · ${brl(account.cents)}` : ''}${days}.`
}

function setBox({ repo }: FinanceTarget, a: Args): string {
  const name = text(a['name'], 'the name', true)
  const options = new Options(repo)
  const values: Record<string, PropertyValue | null> = {}
  const balance = a['balance'] === undefined ? undefined : amount(a['balance'], 'balance', true)
  if (balance !== undefined) values[BOXES.balance] = reais(balance)
  if (a['goal'] !== undefined) values[BOXES.goal] = a['goal'] === null ? null : reais(amount(a['goal'], 'goal', true))
  const purpose = text(a['purpose'], 'purpose')
  if (purpose) values[BOXES.purpose] = purpose
  const rate = a['yield']
  if (rate !== undefined) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100)
      throw new ToolError('yield is a percentage a month, such as 0.9.')
    values[BOXES.yield] = rate
  }
  const { row, created } = upsert(repo, 'boxes', name, values, options)
  if (balance !== undefined) stampBalance(repo, row, BOXES.asOf)
  const box = readBooks(repo).boxes.find((each) => each.id === row.id)
  return `${created ? 'Added' : 'Updated'}: ${titleOf(row)} [${row.id}] · ${brl(box?.cents ?? 0)}${box?.goal ? ` of ${brl(box.goal)}` : ''}${box?.purpose ? ` · for ${box.purpose}` : ''}.`
}

// ---- reading -----------------------------------------------------------------------

function monthText(books: Books, ref: string, today: string): string {
  const p = monthPicture(books, ref, today)
  const next = forecast(books, addMonths(ref, 1))
  const out: string[] = [`Finanças, ${ref}${monthOf(today) === ref ? ` (today is ${today})` : ''}.`]
  const empty = !books.entries.length && !books.recurring.length && !books.accounts.length && !books.budget.length && !books.boxes.length
  if (empty)
    return `${out[0]}\nNothing has been entered yet. Start with the accounts and cards (finance_account), what comes every month (finance_recurring), the budget's limits (finance_budget) and the boxes (finance_box); then add what is spent as it happens (finance_add, finance_receipt).`

  out.push('', `In the accounts: ${brl(p.inAccounts)}`)
  for (const account of p.accounts) if (account.type !== 'card') out.push(`- ${account.name}: ${brl(account.cents)}`)

  if (p.income.lines.length || p.otherIncome) {
    out.push('', `Income: ${brl(p.income.received + p.otherIncome)} received, ${brl(p.income.expected)} still expected`)
    for (const line of p.income.lines)
      out.push(
        `- ${line.recurring.title} [${line.recurring.id}]: ${brl(line.entry?.cents ?? line.recurring.cents)} · ${line.entry ? `received ${line.entry.date}` : `expected${line.due ? ` ${line.due}` : ''}`}`
      )
    if (p.otherIncome) out.push(`- other income: ${brl(p.otherIncome)}`)
  }

  if (p.bills.lines.length) {
    out.push('', `Fixed bills: ${brl(p.bills.paid)} paid, ${brl(p.bills.pending)} pending`)
    for (const line of p.bills.lines)
      out.push(
        `- ${line.recurring.title} [${line.recurring.id}]: ${brl(line.entry?.cents ?? line.recurring.cents)} · ${line.entry ? `paid ${line.entry.date}` : `pending${line.due ? `, due ${line.due}` : ''}${line.due && line.due < today ? ' (late)' : ''}`}`
      )
  }

  for (const each of p.invoices) {
    const card = books.accounts.find((account) => same(account.name, each.card)) as Account
    const upcoming = invoice(books, card, addMonths(ref, 1))
    out.push(
      '',
      `Card ${each.card}: the ${ref} invoice is ${brl(each.cents)}${each.due ? `, due ${each.due}` : ''}${each.paid ? ' (paid)' : ''}; the ${upcoming.month} one already holds ${brl(upcoming.cents)}`
    )
    for (const entry of each.entries.slice(0, 40)) out.push(`  ${entryLine(entry)}`)
    if (each.entries.length > 40) out.push(`  - (and ${each.entries.length - 40} more: finance_entries with account "${each.card}")`)
  }

  if (p.budget.lines.length) {
    out.push(
      '',
      `Day-to-day budget: ${brl(p.budget.spent)} spent of ${brl(p.budget.limit)}; ${brl(p.budget.left)} left${p.budget.perWeek !== null && p.budget.daysLeft > 0 ? ` for ${p.budget.daysLeft} day${p.budget.daysLeft === 1 ? '' : 's'} (${brl(p.budget.perWeek)} a week)` : ''}`
    )
    for (const line of p.budget.lines)
      out.push(
        line.limit === null
          ? `- ${line.category}: ${brl(line.spent)} spent, no limit set`
          : `- ${line.category}: ${brl(line.spent)} of ${brl(line.limit)} · ${(line.left ?? 0) >= 0 ? `${brl(line.left ?? 0)} left` : `${brl(-(line.left ?? 0))} over`}`
      )
  }

  if (p.boxes.length) {
    out.push('', `Boxes: ${brl(p.inBoxes)}`)
    for (const box of p.boxes)
      out.push(`- ${box.name}: ${brl(box.cents)}${box.goal ? ` of ${brl(box.goal)}` : ''}${box.purpose ? ` · ${box.purpose}` : ''}`)
  }

  if (p.owed.length) {
    out.push('', 'Shared expenses:')
    for (const each of p.owed)
      out.push(each.cents > 0 ? `- ${each.person} owes you ${brl(each.cents)}` : `- you owe ${each.person} ${brl(-each.cents)}`)
  }

  out.push(
    '',
    `Left at the end of the month, if the rest goes as planned: ${brl(p.free)} (accounts + income expected − bills pending − invoices due − budget left).`,
    '',
    `Forecast for ${next.month}: income ${brl(next.income)} − bills ${brl(next.bills)} − budget ${brl(next.budget)} − invoices already known ${brl(next.invoices)} = ${brl(next.free)} free.`
  )
  return out.join('\n')
}

function entries(repo: Repository, a: Args, now: Date): string {
  const books = readBooks(repo)
  const limit = typeof a['limit'] === 'number' && Number.isInteger(a['limit']) ? Math.min(Math.max(a['limit'], 1), FINANCE_CAPS.list) : 50
  const from = a['from'] === undefined ? null : date(a['from'], now)
  const until = a['until'] === undefined ? null : date(a['until'], now)
  const ref =
    a['month'] === 'all' ? null : from || until ? (a['month'] === undefined ? null : month(a['month'], now)) : month(a['month'], now)
  const kind = a['kind']
  if (kind !== undefined && !['expense', 'income', 'transfer', 'settlement'].includes(String(kind)))
    throw new ToolError('kind is expense, income, transfer or settlement.')
  const category = text(a['category'], 'category')
  const account = text(a['account'], 'account')
  const who = text(a['person'], 'person')
  const group = text(a['group'], 'group')
  const words = text(a['search'], 'search')
  const picked = books.entries
    .filter((entry) => {
      if (ref && monthOf(entry.date) !== ref) return false
      if (from && entry.date < from) return false
      if (until && entry.date > until) return false
      if (kind && entry.kind !== kind) return false
      if (category && !same(entry.category, category)) return false
      if (account && !same(entry.account, account) && !same(entry.to, account)) return false
      if (group && !same(entry.group, group)) return false
      if (who) {
        const wanted = isMe(who) ? key(ME) : key(who)
        const names = [entry.paidBy, entry.to ?? '', ...Object.keys(entry.shares ?? {})].map((name) => (isMe(name) ? key(ME) : key(name)))
        if (!names.includes(wanted)) return false
      }
      if (words && !key(entry.title).includes(key(words))) return false
      return true
    })
    .sort((x, y) => y.date.localeCompare(x.date) || y.createdAt - x.createdAt)
  const head = `Ledger${ref ? `, ${ref}` : ''}${from ? `, from ${from}` : ''}${until ? `, until ${until}` : ''}`
  if (!picked.length) return `${head}: nothing.`
  const sum = (wanted: Kind): number => picked.filter((entry) => entry.kind === wanted).reduce((all, entry) => all + entry.cents, 0)
  const shown = picked.slice(0, limit)
  const more = picked.length > shown.length ? `\n…and ${picked.length - shown.length} more.` : ''
  return `${head}: ${picked.length} entr${picked.length === 1 ? 'y' : 'ies'}; expenses ${brl(sum('expense'))}, income ${brl(sum('income'))}.\n${shown.map(entryLine).join('\n')}${more}`
}

function balances(repo: Repository, a: Args): string {
  const books = readBooks(repo)
  const group = text(a['group'], 'group')
  const all = debts(books.entries, group)
  const shared = books.entries
    .filter((entry) => (entry.shares || entry.kind === 'settlement') && (!group || same(entry.group, group)))
    .sort((x, y) => y.date.localeCompare(x.date) || y.createdAt - x.createdAt)
  const head = `Shared expenses${group ? ` of ${group}` : ''}`
  if (!shared.length) return `${head}: none yet. Add one with finance_add ("split_with" or "shares") or finance_receipt.`
  const lines = all.length
    ? all.map((debt) => `- ${isMe(debt.from) ? 'You owe' : `${debt.from} owes`} ${isMe(debt.to) ? 'you' : debt.to} ${brl(debt.cents)}`)
    : ['- Everyone is even.']
  const groups = [...new Set(books.entries.map((entry) => entry.group).filter((name): name is string => !!name))]
  return [
    `${head}:`,
    ...lines,
    ...(groups.length && !group ? [`Groups: ${groups.join(', ')}.`] : []),
    '',
    `The latest of ${shared.length}:`,
    ...shared.slice(0, 30).map(entryLine)
  ].join('\n')
}

function project(repo: Repository, a: Args, now: Date): string {
  const books = readBooks(repo)
  const months =
    typeof a['months'] === 'number' && Number.isInteger(a['months']) ? Math.min(Math.max(a['months'], 1), FINANCE_CAPS.months) : 12
  const monthly = a['monthly'] === undefined ? undefined : amount(a['monthly'], 'monthly', true)
  const rate = a['rate']
  if (rate !== undefined && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100))
    throw new ToolError('rate is a percentage a month, such as 0.9.')
  const start = addMonths(localDay(now).slice(0, 7), 1)
  const points = projection(books, start, months, { monthly, rate: typeof rate === 'number' ? rate : undefined })
  const reserve = monthPicture(books, localDay(now).slice(0, 7), localDay(now)).inBoxes
  return [
    `The reserve is ${brl(reserve)} today. ${monthly === undefined ? 'Saving what each month leaves free in its forecast' : `Saving ${brl(monthly)} a month`}${typeof rate === 'number' ? `, yielding ${rate}% a month` : ', yielding what the boxes say'}:`,
    ...points.map((point) => `- ${point.month}: ${brl(point.cents)} (saved ${brl(point.saved)}, yielded ${brl(point.yielded)})`),
    'An estimate: it repeats the recurring lines and the budget as they are today.'
  ].join('\n')
}

const READS = new Set(['finance_month', 'finance_entries', 'finance_balances', 'finance_projection'])
const NOT_YET =
  "Finanças has nothing yet. Start with the accounts and cards (finance_account), what comes every month (finance_recurring), the budget's limits (finance_budget) and the boxes (finance_box); then add what is spent as it happens (finance_add, finance_receipt). The first of them creates the Finanças page and its databases."

/** Runs one Finance tool. Reading never sets the block up: its page and databases appear with the first thing entered. */
export function callFinanceTool(target: FinanceTarget, name: string, raw: unknown, now: Date = new Date()): string {
  const a = args(raw)
  if (READS.has(name) && !financeExists(target.repo)) return NOT_YET
  switch (name) {
    case 'finance_month': {
      const format = a['format']
      if (format !== undefined && format !== 'text' && format !== 'json') throw new ToolError('format is text or json.')
      const books = readBooks(target.repo)
      const ref = month(a['month'], now)
      if (format === 'json') {
        // The same a screen is given, without what only its forms use.
        const {
          entries: _entries,
          categories: _categories,
          accountNames: _accounts,
          boxNames: _boxes,
          empty: _empty,
          ...data
        } = financeMonthView(target.repo, ref, localDay(now))
        return JSON.stringify(data, null, 1)
      }
      return monthText(books, ref, localDay(now))
    }
    case 'finance_entries':
      return entries(target.repo, a, now)
    case 'finance_balances':
      return balances(target.repo, a)
    case 'finance_projection':
      return project(target.repo, a, now)
    case 'finance_add':
      return add(target, a, now)
    case 'finance_receipt':
      return receipt(target, a, now)
    case 'finance_update':
      return update(target, a, now)
    case 'finance_delete':
      return remove(target, a)
    case 'finance_settle':
      return settle(target, a, now)
    case 'finance_recurring':
      return recurring(target, a)
    case 'finance_pay':
      return pay(target, a, now)
    case 'finance_pay_invoice':
      return payInvoice(target, a, now)
    case 'finance_budget':
      return setBudget(target, a)
    case 'finance_account':
      return setAccount(target, a)
    case 'finance_box':
      return setBox(target, a)
    default:
      throw new ToolError('No such tool.')
  }
}
