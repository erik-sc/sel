import { type Entry, isMe, key, monthOf, same } from '../../shared/finance/calc'
import { type Household, householdBalance, householdMonth, splitByShare } from '../../shared/finance/household'
import { KIND_ID, ME, RECURRING } from '../../shared/finance'
import type { PropertyValue } from '../../shared/types'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'
import { financeExists, Options, readBooks, readHousehold, rowNamed, titleOf, writeHousehold } from '../finance/store'
import {
  addEntries,
  amount,
  args,
  brl,
  date,
  type Draft,
  entryLine,
  type FinanceTarget,
  localDay,
  month,
  proportional,
  reais,
  text,
  upsert
} from '../finance/tools'
import { householdView } from '../finance/views'
import { SPLIT_CAPS } from './toolspecs'

/**
 * The household block's tools (./toolspecs.ts): what is shared with the one person the user
 * lives with ("split the market with Alice", "launch the rent", "she paid me back"). They write
 * entries of the Finance ledger with the household's group (shared/finance/household.ts), so the
 * user's part of each is in their own month without being entered twice.
 */

type Args = Record<string, unknown>

/** The household, set up: with the name of the person it is shared with. */
function household(repo: Repository): Household {
  const stored = readHousehold(repo)
  if (!stored.partner) throw new ToolError('The household is not set up yet: say who it is shared with, with split_config ("partner").')
  return stored
}

const who = (value: unknown, what: string, fallback: 'me' | 'partner'): 'me' | 'partner' => {
  if (value === undefined || value === null) return fallback
  if (value === 'me' || value === 'partner') return value
  throw new ToolError(`${what} is "me" or "partner".`)
}

/** Who owes whom, in words. */
export function balanceLine(cents: number, partner: string): string {
  if (!cents) return `You and ${partner} are even.`
  return cents > 0 ? `${partner} owes you ${brl(cents)}.` : `You owe ${partner} ${brl(-cents)}.`
}

const balanceNow = (repo: Repository, stored: Household): string => balanceLine(householdBalance(readBooks(repo), stored), stored.partner)

/** An expense's parts, as the ledger keeps them: by person. Null when there is nothing to share. */
function sharesOf(stored: Household, mine: number, theirs: number): Record<string, number> {
  return { [ME]: mine, [stored.partner]: theirs }
}

function config({ repo }: FinanceTarget, a: Args): string {
  const stored = readHousehold(repo)
  const partner = text(a['partner'], 'partner')
  if (partner !== undefined && isMe(partner)) throw new ToolError('partner is the name of the other person.')
  const share = a['my_share']
  if (share !== undefined && (typeof share !== 'number' || !Number.isInteger(share) || share < 0 || share > 100))
    throw new ToolError('my_share is a percentage, 0 to 100.')
  const changed = partner !== undefined || share !== undefined
  // The entries already made name the other by their old name: a new name would leave them behind.
  if (partner !== undefined && stored.partner && key(partner) !== key(stored.partner) && financeExists(repo)) {
    const books = readBooks(repo)
    const used = books.entries.some((entry) => same(entry.group, stored.group) && (entry.shares !== null || entry.kind === 'settlement'))
    if (used) throw new ToolError(`The household already has entries shared with ${stored.partner}: that name stays.`)
  }
  const next = changed
    ? writeHousehold(repo, { ...stored, partner: partner ?? stored.partner, myShare: typeof share === 'number' ? share : stored.myShare })
    : stored
  if (!next.partner) return 'The household is not set up yet: give "partner", the name of the person it is shared with.'
  return `${changed ? 'Set' : 'The household'}: shared with ${next.partner}, ${next.myShare}% yours and ${100 - next.myShare}% theirs.`
}

function add(target: FinanceTarget, a: Args, now: Date): string {
  const { repo } = target
  const stored = household(repo)
  const paidBy = who(a['paid_by'], 'paid_by', 'me')
  const how = a['how'] === undefined ? 'default' : a['how']
  if (how !== 'default' && how !== 'mine' && how !== 'theirs' && how !== 'custom')
    throw new ToolError('how is default, mine, theirs or custom.')
  const title = text(a['description'], 'the description', true)
  let cents: number
  let mine: number
  let items: { name: string; cents: number; owner: 'both' | 'me' | 'partner' }[] | null = null
  if (a['items'] !== undefined && a['items'] !== null) {
    const raw = a['items']
    if (!Array.isArray(raw) || !raw.length || raw.length > SPLIT_CAPS.items)
      throw new ToolError(`items is a list of 1 to ${SPLIT_CAPS.items} lines.`)
    if (how !== 'default') throw new ToolError('With items, each line says whose it is: leave "how" out.')
    items = raw.map((each) => {
      const item = args(each)
      const name = text(item['name'], "an item's name", true)
      const owner = item['owner'] === undefined ? 'both' : item['owner']
      if (owner !== 'both' && owner !== 'me' && owner !== 'partner') throw new ToolError(`${name}: owner is both, me or partner.`)
      return { name, cents: amount(item['amount'], `The amount of ${name}`, true), owner }
    })
    const sum = items.reduce((all, item) => all + item.cents, 0)
    cents =
      a['total'] !== undefined && a['total'] !== null ? amount(a['total'], 'total') : a['amount'] !== undefined ? amount(a['amount']) : sum
    if (cents <= 0 || sum <= 0) throw new ToolError('The items add up to nothing.')
    let own = 0
    for (const item of items)
      own += item.owner === 'me' ? item.cents : item.owner === 'partner' ? 0 : splitByShare(item.cents, stored.myShare).mine
    // Service or a discount: every part keeps its proportion of what was paid.
    mine =
      cents === sum
        ? own
        : (proportional(cents, [
            ['mine', own],
            ['theirs', sum - own]
          ] as const)['mine'] ?? 0)
  } else {
    cents = amount(a['amount'])
    if (how === 'custom') {
      mine = amount(a['my_part'], 'my_part', true)
      if (mine > cents) throw new ToolError(`my_part (${brl(mine)}) is more than the amount (${brl(cents)}).`)
    } else mine = how === 'mine' ? cents : how === 'theirs' ? 0 : splitByShare(cents, stored.myShare).mine
  }
  const theirs = cents - mine
  // All of whoever paid it: nothing is owed, and it is not the household's.
  if (paidBy === 'me' && theirs === 0)
    throw new ToolError(`That is all yours and you paid it: it is your own expense (finance_add), not the household's.`)
  if (paidBy === 'partner' && mine === 0) throw new ToolError(`That is all ${stored.partner}'s and they paid it: nothing to share.`)
  const note = a['note']
  if (note !== undefined && note !== null && typeof note !== 'string') throw new ToolError('note must be text.')
  const account = text(a['account'], 'account')
  if (account && paidBy === 'partner') throw new ToolError(`${stored.partner} paid it: it left none of your accounts.`)
  const draft: Draft = {
    title,
    cents,
    kind: 'expense',
    date: date(a['date'], now),
    category: text(a['category'], 'category'),
    account,
    paidBy: paidBy === 'me' ? ME : stored.partner,
    shares: sharesOf(stored, mine, theirs),
    group: stored.group,
    note: typeof note === 'string' ? note.slice(0, 4000) : undefined,
    items: items ? JSON.stringify(items.map((item) => ({ name: item.name, cents: item.cents, owner: item.owner }))) : undefined
  }
  if (draft.items && draft.items.length > 60_000) draft.items = undefined
  const owners = { both: 'os dois', me: ME, partner: stored.partner }
  const cell = (value: string): string => value.replace(/\|/gu, '/')
  const body = items
    ? [
        '| Item | Valor | De quem |',
        '| --- | --- | --- |',
        ...items.map((item) => `| ${cell(item.name)} | ${brl(item.cents)} | ${cell(owners[item.owner])} |`)
      ].join('\n')
    : undefined
  const [entry] = addEntries(target, readBooks(repo), draft, body)
  return `Added:\n${entryLine(entry)}\n${balanceNow(repo, stored)}`
}

function bill({ repo }: FinanceTarget, a: Args): string {
  const stored = household(repo)
  const name = text(a['name'], 'the name', true)
  const existing = financeExists(repo) ? rowNamed(repo, 'recurring', name) : null
  if (!existing && a['amount'] === undefined) throw new ToolError(`${name} is new: give its amount.`)
  const day = a['day']
  if (day !== undefined && (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31))
    throw new ToolError('day is a day of the month, 1 to 31.')
  const share = a['my_share']
  if (share !== undefined && (typeof share !== 'number' || !Number.isInteger(share) || share < 0 || share > 100))
    throw new ToolError('my_share is a percentage, 0 to 100.')
  const paidBy = a['paid_by'] === undefined ? undefined : who(a['paid_by'], 'paid_by', 'me')
  const values: Record<string, PropertyValue | null> = {}
  const options = new Options(repo)
  if (a['amount'] !== undefined) values[RECURRING.amount] = reais(amount(a['amount']))
  if (!existing) values[RECURRING.kind] = KIND_ID.expense
  if (typeof day === 'number') values[RECURRING.day] = day
  const category = text(a['category'], 'category')
  if (category) values[RECURRING.category] = options.id('recurring', RECURRING.category, category)
  const account = text(a['account'], 'account')
  if (account) values[RECURRING.account] = options.id('recurring', RECURRING.account, account)
  if (typeof a['active'] === 'boolean' || !existing) values[RECURRING.active] = a['active'] !== false
  if (paidBy !== undefined || !existing)
    values[RECURRING.paidBy] = options.id('recurring', RECURRING.paidBy, paidBy === 'partner' ? stored.partner : ME)
  values[RECURRING.group] = options.id('recurring', RECURRING.group, stored.group)
  // Its own percentage, written down: the household's may change later without changing this bill.
  if (typeof share === 'number') values[RECURRING.share] = share
  else if (!existing || existing.props.values?.[RECURRING.share] === undefined) values[RECURRING.share] = stored.myShare
  const { row, created } = upsert(repo, 'recurring', name, values, options)
  const line = readBooks(repo).recurring.find((each) => each.id === row.id)
  const payer = line && !isMe(line.paidBy) ? line.paidBy : 'you'
  return `${created ? 'Added' : 'Updated'}: ${titleOf(row)} [${row.id}] · ${brl(line?.cents ?? 0)} a month · paid by ${payer} · ${line?.share ?? stored.myShare}% yours${line?.day ? ` · day ${line.day}` : ''}${line?.active === false ? ' · stopped' : ''}.`
}

function launch(target: FinanceTarget, a: Args, now: Date): string {
  const { repo } = target
  const stored = household(repo)
  const name = text(a['name'], 'the fixed bill, by name or id', true)
  if (!financeExists(repo)) throw new ToolError('The household has no fixed bills yet: add one with split_bill.')
  const books = readBooks(repo)
  const lines = books.recurring.filter((each) => same(each.group, stored.group))
  const line = lines.find((each) => each.id === name) ?? lines.find((each) => same(each.title, name))
  if (!line) {
    const known = lines.map((each) => `“${each.title}”`).slice(0, 30)
    throw new ToolError(
      known.length
        ? `The household has no fixed bill called “${name}”. There are: ${known.join(', ')}.`
        : 'The household has no fixed bills yet: add one with split_bill.'
    )
  }
  const ref = month(a['month'], now)
  const already = books.entries.find(
    (entry: Entry) => entry.recurring === line.id && (entry.ref ?? monthOf(entry.date)) === ref && entry.paid
  )
  if (already) return `${line.title} was already launched for ${ref}:\n${entryLine(already)}`
  const cents = a['amount'] === undefined ? line.cents : amount(a['amount'])
  if (!cents) throw new ToolError(`${line.title} has no amount: give this month's.`)
  const today = localDay(now)
  const { mine, theirs } = splitByShare(cents, line.share ?? stored.myShare)
  const mineToPay = isMe(line.paidBy)
  const draft: Draft = {
    title: line.title,
    cents,
    kind: 'expense',
    date:
      a['date'] !== undefined
        ? date(a['date'], now)
        : monthOf(today) === ref || !line.day
          ? today
          : `${ref}-${String(Math.min(line.day, 28)).padStart(2, '0')}`,
    category: line.category,
    account: mineToPay ? line.account : null,
    paidBy: mineToPay ? ME : stored.partner,
    shares: sharesOf(stored, mine, theirs),
    group: stored.group,
    recurring: line.id,
    ref
  }
  const [entry] = addEntries(target, books, draft)
  return `Launched for ${ref}:\n${entryLine(entry)}\n${balanceNow(repo, stored)}`
}

function settle(target: FinanceTarget, a: Args, now: Date): string {
  const { repo } = target
  const stored = household(repo)
  const balance = financeExists(repo) ? householdBalance(readBooks(repo), stored) : 0
  // Whoever owes pays, unless told otherwise; with no amount, all of it.
  const paidBy = who(a['paid_by'], 'paid_by', balance < 0 ? 'me' : 'partner')
  if (a['amount'] === undefined && !balance) throw new ToolError(`You and ${stored.partner} are even: give the amount that was paid.`)
  const cents = a['amount'] === undefined ? Math.abs(balance) : amount(a['amount'])
  const note = text(a['note'], 'note')
  const draft: Draft = {
    title: paidBy === 'partner' ? `Acerto: ${stored.partner} pagou` : `Acerto: paguei ${stored.partner}`,
    cents,
    kind: 'settlement',
    date: date(a['date'], now),
    account: text(a['account'], 'account'),
    paidBy: paidBy === 'partner' ? stored.partner : ME,
    to: paidBy === 'partner' ? ME : stored.partner,
    group: stored.group,
    note
  }
  const [entry] = addEntries(target, readBooks(repo), draft)
  return `Recorded:\n${entryLine(entry)}\n${balanceNow(repo, stored)}`
}

function summary(repo: Repository, a: Args, now: Date): string {
  const format = a['format']
  if (format !== undefined && format !== 'text' && format !== 'json') throw new ToolError('format is text or json.')
  const stored = readHousehold(repo)
  const ref = month(a['month'], now)
  if (!stored.partner) return 'The household is not set up yet: say who it is shared with, with split_config ("partner").'
  const view = householdView(repo, ref, localDay(now))
  if (format === 'json') {
    const { categories: _categories, accountNames: _accounts, ...data } = view
    return JSON.stringify(data, null, 1)
  }
  const m = householdMonth(
    financeExists(repo) ? readBooks(repo) : { entries: [], recurring: [], budget: [], accounts: [], boxes: [] },
    stored,
    ref
  )
  const out = [
    `Divisão de contas with ${stored.partner} (${stored.myShare}% yours, ${100 - stored.myShare}% theirs).`,
    balanceLine(m.balance, stored.partner),
    '',
    `${ref}: ${brl(m.total)} in ${m.expenses.length} expense${m.expenses.length === 1 ? '' : 's'}.`,
    `- Your part ${brl(m.mine.share)}; you paid ${brl(m.mine.paid)}.`,
    `- ${stored.partner}'s part ${brl(m.theirs.share)}; they paid ${brl(m.theirs.paid)}.`
  ]
  if (m.byCategory.length) out.push('', 'By category:', ...m.byCategory.map((line) => `- ${line.category}: ${brl(line.cents)}`))
  if (m.bills.length) {
    out.push('', 'Fixed bills:')
    for (const each of m.bills) {
      const payer = isMe(each.recurring.paidBy) ? 'you pay' : `${each.recurring.paidBy} pays`
      out.push(
        `- ${each.recurring.title} [${each.recurring.id}]: ${brl(each.entry?.cents ?? each.recurring.cents)} · ${payer} · ${each.entry ? `launched ${each.entry.date}` : `pending${each.recurring.day ? `, day ${each.recurring.day}` : ''}`}`
      )
    }
  }
  if (m.expenses.length) {
    out.push('', 'Expenses:', ...m.expenses.slice(0, 40).map(entryLine))
    if (m.expenses.length > 40) out.push(`- (and ${m.expenses.length - 40} more: finance_entries with group "${stored.group}")`)
  }
  if (m.settlements.length) out.push('', 'Payments between you, the latest first:', ...m.settlements.slice(0, 10).map(entryLine))
  return out.join('\n')
}

/** Runs one tool of the household block. */
export function callSplitTool(target: FinanceTarget, name: string, raw: unknown, now: Date = new Date()): string {
  const a = args(raw)
  switch (name) {
    case 'split_summary':
      return summary(target.repo, a, now)
    case 'split_config':
      return config(target, a)
    case 'split_add':
      return add(target, a, now)
    case 'split_bill':
      return bill(target, a)
    case 'split_launch':
      return launch(target, a, now)
    case 'split_settle':
      return settle(target, a, now)
    default:
      throw new ToolError('No such tool.')
  }
}
