import type { ToolSpec } from '../ai/toolspecs'
import { definePack, scoped } from '../tools/pack'

/**
 * The household block's tools ("Divisão de contas") as the MCP servers list them (see ./tools.ts
 * for what they do). Plain data: the server script bundles this file.
 */

export const SPLIT_CAPS = { items: 200, categories: 40 } as const

const AMOUNT = { type: ['number', 'string'], description: 'An amount: 42.9, or text as written, "R$ 1.234,56".' }
const DATE = { type: 'string', description: '"YYYY-MM-DD". Left out: today.' }
const MONTH = { type: 'string', description: '"YYYY-MM". Left out: the current month.' }
const WHO = { type: 'string', enum: ['me', 'partner'], description: 'me: the user. partner: the person they share the household with.' }
const HOW = {
  type: 'string',
  enum: ['default', 'mine', 'theirs', 'custom'],
  description:
    "How it is divided. default: by the household's percentage. mine: all the user's (the other paid it for them). theirs: all the other's (the user paid it for them). custom: \"my_part\" says the user's part."
}

const READ: readonly ToolSpec[] = [
  {
    name: 'split_summary',
    description:
      'The household shared with one person ("Divisão de contas"): who owes whom over every month, and one month in numbers: the total, each one\'s part and what each paid, by category, the fixed bills launched and pending, the expenses and the payments between the two. format "json" gives it as data.',
    inputSchema: {
      type: 'object',
      properties: { month: MONTH, format: { type: 'string', enum: ['text', 'json'] } },
      additionalProperties: false
    }
  }
]

const WRITE: readonly ToolSpec[] = [
  {
    name: 'split_config',
    description:
      "Sets up the household: the name of the person the user shares it with, and the user's part of what is shared, in percent (50 for half each). With nothing given, says how it is set up.",
    inputSchema: {
      type: 'object',
      properties: {
        partner: { type: 'string', description: 'The name of the person the user lives with.' },
        my_share: { type: 'integer', minimum: 0, maximum: 100, description: "The user's part of what is shared, in percent." }
      },
      additionalProperties: false
    }
  },
  {
    name: 'split_add',
    description:
      'Adds an expense of the household: who paid and how it is divided. It goes to the Finance ledger, so the user\'s part is in their own month too. "items" divides a receipt line by line: each line is of both, only the user\'s or only the other\'s; a "total" different from the sum of the lines (service, a discount) scales every part. Returns the expense and who owes whom now.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What it was: "Mercado", "Luz de novembro".' },
        amount: { ...AMOUNT, description: 'The total. Left out with "items": their sum.' },
        paid_by: WHO,
        how: HOW,
        my_part: { ...AMOUNT, description: 'With how "custom": the user\'s part of the total.' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: SPLIT_CAPS.items,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              amount: { ...AMOUNT, description: "The line's total." },
              owner: { type: 'string', enum: ['both', 'me', 'partner'], description: 'Left out: both.' }
            },
            required: ['name', 'amount'],
            additionalProperties: false
          }
        },
        total: { ...AMOUNT, description: 'With "items": what was paid in the end, when it is not their sum.' },
        date: DATE,
        category: { type: 'string', description: 'The category, by name; a new name is added.' },
        account: { type: 'string', description: 'When the user paid: the account or card it left from.' },
        note: { type: 'string' }
      },
      required: ['description'],
      additionalProperties: false
    }
  },
  {
    name: 'split_bill',
    description:
      'Adds or changes, by name, a fixed bill of the household (rent, power, internet): who pays it, how it is divided, and the day it is due. It is launched each month with split_launch.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        amount: { ...AMOUNT, description: "What it usually is. The month's own amount is given when it is launched." },
        day: { type: 'integer', minimum: 1, maximum: 31 },
        category: { type: 'string' },
        paid_by: WHO,
        my_share: { type: 'integer', minimum: 0, maximum: 100, description: "The user's part, in percent. Left out: the household's." },
        account: { type: 'string', description: 'When the user pays it: the account it leaves from.' },
        active: { type: 'boolean', description: 'False stops it without losing its history.' }
      },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'split_launch',
    description: "Launches a fixed bill of the household for a month: adds the expense, with this month's amount when it differs.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The fixed bill, by name or id.' },
        month: MONTH,
        amount: AMOUNT,
        date: DATE
      },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'split_settle',
    description:
      'Records a payment between the two that settles what is owed. With no amount, the whole balance, from whoever owes; "paid_by" and "amount" say otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: AMOUNT,
        paid_by: { ...WHO, description: 'Who paid the other. Left out: whoever owes.' },
        date: DATE,
        account: { type: 'string', description: "The user's account it came into or left from." },
        note: { type: 'string' }
      },
      additionalProperties: false
    }
  }
]

export const SPLIT_PACK = definePack({
  id: 'split',
  title: 'Divisão de contas',
  summary:
    "The household the user shares with one person: shared expenses and fixed bills, each one's part, who owes whom, and the payments that settle it. Its expenses are entries of the Finanças ledger (finance_update and finance_delete change them).",
  tools: [...scoped('finance', READ), ...scoped('finance', WRITE)]
})
