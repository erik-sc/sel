import type { ToolSpec } from '../ai/toolspecs'
import { definePack, scoped } from '../tools/pack'

/**
 * The Finance block's tools as the MCP servers list them (see ./tools.ts for what they do).
 * Plain data: the server script bundles this file.
 */

export const FINANCE_CAPS = { list: 200, text: 300, note: 4000, items: 200, people: 30, instalments: 72, months: 60 } as const

const ID = { type: 'string', description: 'An id, as shown in square brackets.' }
const AMOUNT = { type: ['number', 'string'], description: 'An amount: 42.9, or text as written, "R$ 1.234,56".' }
const DATE = { type: 'string', description: '"YYYY-MM-DD". Left out: today.' }
const MONTH = { type: 'string', description: '"YYYY-MM". Left out: the current month.' }
const PEOPLE = { type: 'array', items: { type: 'string' }, maxItems: FINANCE_CAPS.people }
const SHARES = {
  type: 'object',
  description: 'Exact parts by person, in the currency: {"Ana": 30, "Eu": 12.5}. They must add up to the amount.',
  additionalProperties: { type: ['number', 'string'] }
}

const ENTRY = {
  description: { type: 'string', description: 'What it was: "Mercado", "Uber", "Salário".' },
  amount: AMOUNT,
  kind: {
    type: 'string',
    enum: ['expense', 'income', 'transfer'],
    description: 'expense (default), income, or transfer (between accounts, or into and out of a box: give "account" and "to").'
  },
  date: DATE,
  category: { type: 'string', description: 'The category, by name; a new name is added.' },
  account: { type: 'string', description: 'The account or card it left from or came into, by name; a new name is added.' },
  to: { type: 'string', description: 'A transfer only: the account or box it went to, by name.' },
  planned: { type: 'boolean', description: 'True for something expected that has not happened yet.' },
  paid_by: { type: 'string', description: 'Who paid, when it was not the user ("Eu").' },
  split_with: {
    ...PEOPLE,
    description: 'A shared expense: the other people it is split with in equal parts, the payer and the user included.'
  },
  shares: SHARES,
  group: { type: 'string', description: 'What a shared expense belongs to: a trip, the house.' },
  note: { type: 'string', description: "Text for the entry's page." }
}

const READ: readonly ToolSpec[] = [
  {
    name: 'finance_month',
    description:
      'The picture of one month ("Meu mês"): what the accounts hold, income received and expected, fixed bills paid and pending, each card\'s invoice, the day-to-day budget by category, the boxes, who owes the user, what should be left at the end of the month, and the forecast of the month after. format "json" gives the same as data, for a dashboard.',
    inputSchema: {
      type: 'object',
      properties: { month: MONTH, format: { type: 'string', enum: ['text', 'json'] } },
      additionalProperties: false
    }
  },
  {
    name: 'finance_entries',
    description:
      'The entries of the ledger, the newest first, each with its id: by month or between two dates, and by kind, category, account, person, group or words.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: '"YYYY-MM". Left out with no dates: the current month. "all": every month.' },
        from: { type: 'string', description: '"YYYY-MM-DD".' },
        until: { type: 'string', description: '"YYYY-MM-DD".' },
        kind: { type: 'string', enum: ['expense', 'income', 'transfer', 'settlement'] },
        category: { type: 'string' },
        account: { type: 'string' },
        person: { type: 'string', description: 'Entries this person paid or has a part in.' },
        group: { type: 'string' },
        search: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: FINANCE_CAPS.list }
      },
      additionalProperties: false
    }
  },
  {
    name: 'finance_balances',
    description:
      'Shared expenses settled up, as Splitwise does: who owes whom and how much, netted pair by pair, with the shared entries behind it. With a group, only that group.',
    inputSchema: { type: 'object', properties: { group: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'finance_projection',
    description:
      "Where the reserve (the boxes) is heading: month by month, what is saved and what it yields. By default it saves what each month's forecast leaves free and yields what the boxes say.",
    inputSchema: {
      type: 'object',
      properties: {
        months: { type: 'integer', minimum: 1, maximum: FINANCE_CAPS.months },
        monthly: { ...AMOUNT, description: 'What is saved each month, instead of what the forecast leaves free.' },
        rate: { type: 'number', description: 'The yield, in percent a month (0.9).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'finance_review',
    description:
      'Looks over the ledger for what a bank or card statement brought in whole gets mixed up, with the ids and what to do about each: invoice payments entered as expenses (counted twice), payments entered on the card, entries with no account or on one that is not registered, entries entered twice, expenses with no category. Use it after bringing a statement in, and when the month does not add up.',
    inputSchema: {
      type: 'object',
      properties: { month: { type: 'string', description: '"YYYY-MM". Left out, or "all": every month.' } },
      additionalProperties: false
    }
  }
]

const WRITE: readonly ToolSpec[] = [
  {
    name: 'finance_add',
    description:
      'Adds an entry to the ledger: an expense, an income or a transfer. On a credit card it falls on the right invoice, and "instalments" makes one entry a month. A shared expense names who it is split with (equal parts) or exact shares. Returns the entry as stored.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ENTRY,
        instalments: {
          type: 'integer',
          minimum: 1,
          maximum: FINANCE_CAPS.instalments,
          description: 'A card purchase paid in this many months.'
        }
      },
      required: ['description', 'amount'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_receipt',
    description:
      'Adds an expense from a receipt ("nota fiscal") read line by line: one entry with its items kept on its page. Each item may name the people who share it; the others are split among "split_with" (left out: all the user\'s). When "total" differs from the sum of the items (service, discount), every part is scaled to it.',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Where it was bought.' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: FINANCE_CAPS.items,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              amount: { ...AMOUNT, description: "The line's total (quantity included)." },
              qty: { type: 'number' },
              people: { ...PEOPLE, description: 'Who shares this item, in equal parts ("Eu" for the user).' }
            },
            required: ['name', 'amount'],
            additionalProperties: false
          }
        },
        total: { ...AMOUNT, description: 'What was paid in the end, when it is not the sum of the items.' },
        date: DATE,
        category: ENTRY.category,
        account: ENTRY.account,
        paid_by: ENTRY.paid_by,
        split_with: { ...PEOPLE, description: 'Who shares the items that name no one, in equal parts, the user included.' },
        group: ENTRY.group,
        instalments: { type: 'integer', minimum: 1, maximum: FINANCE_CAPS.instalments }
      },
      required: ['store', 'items'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_update',
    description:
      'Changes an entry of the ledger: only what is given. null clears category, account, group or the split. "kind" turns it into something else: a card invoice payment that a bank statement brought in as an expense becomes a transfer with "kind": "transfer" and "to": the card, so that it is not counted twice.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        description: ENTRY.description,
        amount: AMOUNT,
        kind: { type: 'string', enum: ['expense', 'income', 'transfer'] },
        date: DATE,
        invoice: {
          type: ['string', 'null'],
          description:
            'A card purchase: the invoice it falls on, "YYYY-MM" (the month it is due), when the date does not give the right one. A transfer to a card: the invoice it pays. null: the one the date gives.'
        },
        category: { type: ['string', 'null'] },
        account: { type: ['string', 'null'] },
        to: { type: ['string', 'null'] },
        planned: ENTRY.planned,
        paid_by: ENTRY.paid_by,
        split_with: { ...PEOPLE, description: 'Splits it again in equal parts with these people. An empty list makes it not shared.' },
        shares: SHARES,
        group: { type: ['string', 'null'] }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_delete',
    description:
      'Moves to the trash an entry, a recurring line, a budget category, an account or a box, by id. It can be restored in sel. "series": true takes every instalment of the same purchase.',
    inputSchema: { type: 'object', properties: { id: ID, series: { type: 'boolean' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'finance_settle',
    description: 'Records money that settles shared expenses: "received" from a person, or "paid" to them.',
    inputSchema: {
      type: 'object',
      properties: {
        person: { type: 'string' },
        amount: AMOUNT,
        direction: { type: 'string', enum: ['received', 'paid'] },
        date: DATE,
        account: ENTRY.account,
        group: ENTRY.group
      },
      required: ['person', 'amount', 'direction'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_recurring',
    description: 'Adds or changes, by name, something that comes every month: a fixed bill (expense) or expected income (salary).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        amount: AMOUNT,
        kind: { type: 'string', enum: ['expense', 'income'] },
        day: { type: 'integer', minimum: 1, maximum: 31, description: 'The day of the month it is due or expected.' },
        category: { type: 'string' },
        account: { type: 'string' },
        active: { type: 'boolean', description: 'False stops it without losing its history.' }
      },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_pay',
    description:
      "Marks a recurring bill as paid, or recurring income as received, for a month: adds the entry to the ledger. The amount and the account are the recurring line's unless given.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The recurring line, by name or id.' },
        month: MONTH,
        amount: AMOUNT,
        date: DATE,
        account: { type: 'string' }
      },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_pay_invoice',
    description: "Records the payment of a card's invoice from an account: a transfer, so the purchases are not counted twice.",
    inputSchema: {
      type: 'object',
      properties: {
        card: { type: 'string' },
        month: { type: 'string', description: 'The month the invoice is due, "YYYY-MM". Left out: the current month.' },
        account: { type: 'string', description: 'The account it is paid from.' },
        amount: { ...AMOUNT, description: 'Left out: what the invoice adds up to.' },
        date: DATE
      },
      required: ['card', 'account'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_budget',
    description: 'Sets the monthly limit of a category of the day-to-day budget, by name.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string' }, limit: AMOUNT, group: { type: 'string' } },
      required: ['category', 'limit'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_account',
    description:
      'Adds or changes an account or a card, by name. "balance" says what it holds now (from the bank\'s app): what happens from then on moves it, and entries dated before are taken to be in it already (a statement of past months moves nothing). A card takes the days its invoice closes and is due.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['checking', 'card', 'cash'] },
        balance: AMOUNT,
        as_of: {
          type: 'string',
          description:
            'With "balance": the day that balance is of, "YYYY-MM-DD" (what it held at the end of that day). Left out: now. Use it to bring a statement in from its starting balance.'
        },
        closing_day: { type: 'integer', minimum: 1, maximum: 31 },
        due_day: { type: 'integer', minimum: 1, maximum: 31 }
      },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'finance_box',
    description:
      'Adds or changes a box of money set aside ("caixinha"), by name. "balance" says what it holds now; transfers from then on move it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        balance: AMOUNT,
        as_of: {
          type: 'string',
          description:
            'With "balance": the day that balance is of, "YYYY-MM-DD" (what it held at the end of that day). Left out: now. Use it to bring a statement in from its starting balance.'
        },
        goal: AMOUNT,
        purpose: { type: 'string', description: 'What it is for.' },
        yield: { type: 'number', description: 'What it yields, in percent a month (0.9).' }
      },
      required: ['name'],
      additionalProperties: false
    }
  }
]

export const FINANCE_PACK = definePack({
  id: 'finance',
  title: 'Finanças',
  summary:
    "The user's own money: the month at a glance, a ledger of expenses and income, fixed bills, credit cards with instalments, a budget by category and boxes of savings. Expenses shared now and then with other people (a trip, a dinner) are split and settled here too; what is shared with the person the user lives with belongs to Divisão de contas (split_*).",
  tools: [...scoped('finance', READ), ...scoped('finance', WRITE)]
})

export const FINANCE_TOOL_NAMES: ReadonlySet<string> = new Set(FINANCE_PACK.tools.map((tool) => tool.spec.name))
