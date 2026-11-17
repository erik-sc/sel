/**
 * The skills sel has of its own (see ./index.ts): how to make a skill, and how to work each
 * block. Written for an assistant connected over MCP, which reads one when it is about to do
 * that kind of thing. They name the tools of the blocks (src/main/<block>/toolspecs.ts): a tool
 * renamed there is renamed here (skills.test.ts checks every name they mention).
 *
 * Pure data.
 */
import type { Skill } from './index'

const SKILL_CREATOR = `# Making a skill in sel

A skill is a procedure the user does not want to explain twice: a name, one line saying what it is for and when to use it, and instructions another conversation can follow with no other context. The user's skills live in sel (\`list_skills\`, \`get_skill\`, \`save_skill\`, \`delete_skill\`); sel keeps every version of each in the page's history.

## 1. Find out what it is, by asking

Ask one question at a time, and wait for the answer. Skip a question the conversation has already answered; stop asking when the answers stop changing the skill. In the user's language.

1. **The job.** What do you want to stop explaining? Ask for the last real time it was done: what was asked, what came out.
2. **The trigger.** When should it be used? Which words would you say, or which situation is it? And when should it *not* be used?
3. **What it starts from.** What does it need to be given or to find: a file, a page of sel, a month, a person?
4. **The steps.** How do you do it today, in order? Which tools does it use: sel's own (tasks, pages, Finanças, Divisão de contas) or other connected apps?
5. **The result.** What does a good result look like: its format, its length, its language, where it is put? An example of a good one, if there is one.
6. **What goes wrong.** Where did it go wrong before? What must it check before it is done?
7. **The limits.** What must it never do without asking first (send, delete, pay, publish)?

If the user is turning something just done in this conversation into a skill, start from what was done: propose the answers and ask only for what is missing.

## 2. Write it

- **name**: lowercase words joined by hyphens, short, the job itself: \`fechar-o-mes\`, \`refinar-tarefa\`. Not \`helper\`, not \`skill-2\`.
- **description**: one sentence, under 200 characters when it can be, in the third person: what it does, then when to use it, with the words the user would say. The description is all another conversation sees when deciding whether to load the skill, so the trigger has to be in it. "Closes the month in Finanças: reviews the ledger, pays the invoices, sets next month's budget. Use when the user says 'fechar o mês' or asks how the month went."
- **instructions**, in Markdown:
  - one paragraph on what the job is and what done means;
  - the steps, numbered, each one an action, naming the tool it uses;
  - the rules: what to check, what never to do without asking;
  - the shape of the result, with one short example when the shape matters.

Write only what a capable assistant would not already know: the user's own way, names, accounts, order, exceptions. Say why a rule exists when it is not obvious, so it can be applied to a case nobody listed. Keep it short: a skill that fits on a screen is read whole.

Never put a password, a card or account number, or a token in a skill.

## 3. Show it, then save it

Show the user the name, the description and the instructions, and ask what is wrong or missing. Change it until they say it is right. Then \`save_skill\`. Saving over a skill that exists replaces it; the one before stays in its history in sel.

Offer to try it at once on a real case. What goes wrong in the trial goes back into the instructions.

## Improving a skill that exists

\`get_skill\` first. Ask what happened the last time it was used and what should have happened. Change the least that fixes it, show what changed, and \`save_skill\` under the same name.
`

const TASKS = `# Working the user's tasks in sel

The tasks are one database in sel with lists (inbox, today, upcoming), projects (\`#Casa\`), labels (\`@contas\`), priorities (\`p1\` to \`p4\`), dates and recurrence.

## Reading

- \`list_tasks\`: a list at a time (today, upcoming, inbox, all, completed), or one project or label. Start here: ids come from it.
- \`list_projects\`: the projects and labels that exist. Use an existing name before making a new one.

## Adding

\`add_task\` takes the task as the user would type it, in Portuguese or English, and reads the date, the hour, the recurrence, the priority, the project and the labels out of it: \`Pagar aluguel todo dia 5 9h p1 #Casa @contas\`. Pass the user's own words; do not translate them. Several tasks are several calls.

## Changing

- Done: \`complete_task\`. A task that repeats moves on to its next date by itself.
- Not this time, for a task that repeats: \`skip_task\`. It moves on to its next date without counting as done. Do not complete a task that was not done, and do not reschedule a repeating task by hand to skip it.
- Another day: \`reschedule_task\`. Anything else (title, project, labels, priority, recurrence): \`update_task\`.
- Done by mistake: \`reopen_task\`.
- \`delete_task\` moves it to the trash; \`restore_page\` brings it back. Say so when you delete.

## Rules

- Change only the tasks the user spoke of. For "clean up my list" and the like, show what you would change and ask before changing.
- A task with no date is not late: do not give it a date nobody asked for.
- \`tasks_calendar\` publishes the tasks as a calendar for Google Calendar and the iPhone. Turn it on only when the user asks, and give its address only to them.
`

const FINANCES = `# Working the user's money in sel (Finanças)

Finanças is the user's own month: a ledger of entries (expenses, income, transfers), fixed bills, credit cards with invoices and instalments, a budget by category, accounts with balances and boxes of savings. Amounts are in reais.

## Reading

- \`finance_month\`: the month at a glance. \`finance_entries\`: the ledger, filtered. \`finance_balances\`: who owes whom. \`finance_projection\`: the months ahead.
- \`finance_review\`: what looks wrong in the ledger, with the fix for each. Run it after bringing a statement in and whenever the month does not add up.

## Entering

- One thing spent or received: \`finance_add\`. Say the account or card it was on; without one it moves no balance and falls on no invoice.
- A purchase on a card goes on the card (\`account\`: the card's name), with \`instalments\` when it was parcelled. It falls on the invoice its date gives.
- A fixed bill or income: \`finance_recurring\`; paying this month's: \`finance_pay\`.
- Paying a card's invoice: \`finance_pay_invoice\`. It is a transfer from the account to the card, never an expense: the purchases are the expenses.
- A receipt with several items: \`finance_receipt\`.
- Accounts and cards: \`finance_account\` (a card has \`closing_day\` and \`due_day\`). Budget: \`finance_budget\`. Boxes: \`finance_box\`.

## Bringing a statement in

1. Register the accounts and the cards first (\`finance_account\`), each card with its closing and due day.
2. Give each account its balance: the one of today, or the statement's opening balance with \`as_of\` (the day it is of). Entries dated on or before that day do not move it.
3. Enter the lines. In an account's statement, the line that pays a card is a transfer to the card (\`finance_pay_invoice\`, or \`finance_add\` with kind transfer), not an expense. In a card's statement, leave out the "payment received" line: it is the other side of that transfer. A refund on a card is entered as income on the card: it takes from the invoice.
4. Run \`finance_review\` and fix what it lists with \`finance_update\` and \`finance_delete\`.
5. Read \`finance_month\` back to the user and ask whether the balances match the bank's.

## Rules

- Never guess an amount, a date or an account: ask.
- Say the category when the user said it or it is plain; otherwise leave it out and tell them which entries have none.
- \`finance_delete\` moves an entry to the trash (\`restore_page\` brings it back). Before deleting more than a few, list them and ask.
- What is shared with the person the user lives with belongs to Divisão de contas (\`split_*\`), not here. An expense shared now and then with someone else (a trip, a dinner) is entered here with its split, and settled with \`finance_settle\`.
`

const SHARED_BILLS = `# Working the shared bills in sel (Divisão de contas)

The household the user shares with one person: shared expenses and fixed bills, each one's part, who owes whom, and the payments that settle it. Its expenses are entries of the Finanças ledger, so the user's part of each is already in their own month.

## Reading

\`split_summary\`: who owes whom over every month, and one month in numbers: the total, each one's part, what each paid, the fixed bills launched and pending. Start here.

## Entering

- A shared expense: \`split_add\`, saying who paid (\`me\` or \`partner\`). It is divided by the household's percentage unless the call says otherwise (all mine, all theirs, or the user's part as an amount).
- A fixed bill of the household (rent, internet): \`split_bill\` once; each month \`split_launch\` enters the ones still pending.
- A payment between the two: \`split_settle\`.
- The other person's name and the percentage each pays: \`split_config\`.

## Rules

- Ask who paid when it was not said: it changes who owes whom.
- To change or remove a shared expense use \`finance_update\` and \`finance_delete\` with its id: it is an entry of the ledger.
- Do not enter a settlement the user did not say was paid.
`

export const BUILT_IN_SKILLS: readonly Skill[] = [
  {
    name: 'skill-creator',
    description:
      'Makes or improves a skill kept in sel: asks the questions that pin the job down, writes its name, description and instructions, and saves it. Use when the user wants a new skill, wants to turn something they keep explaining into one, or says a skill did the wrong thing.',
    instructions: SKILL_CREATOR
  },
  {
    name: 'sel-tasks',
    description:
      'How to work the user’s tasks in sel: listing, quick add, completing, skipping a repeating task, rescheduling, projects and labels. Use before adding or changing tasks in sel.',
    instructions: TASKS
  },
  {
    name: 'sel-finances',
    description:
      'How to work the user’s money in sel (Finanças): entries, cards and invoices, fixed bills, budget, balances, and bringing a bank or card statement in without mixing them. Use before entering or fixing anything in Finanças.',
    instructions: FINANCES
  },
  {
    name: 'sel-shared-bills',
    description:
      'How to work the household shared with one person in sel (Divisão de contas): shared expenses, fixed bills, who owes whom, settling. Use before entering or changing anything shared with the person the user lives with.',
    instructions: SHARED_BILLS
  }
]

/** The built-in skill of that name, if there is one. */
export const builtInSkill = (name: string): Skill | undefined => BUILT_IN_SKILLS.find((skill) => skill.name === name)
