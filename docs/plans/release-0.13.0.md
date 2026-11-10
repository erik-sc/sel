# Release 0.13.0 — Finanças and Divisão de contas, in the window

Status: **proposed** · 2026-11-10 · branch `release/0.13.0`

Érik, after updating to 0.12.0: he expected Finanças to be a fixed screen of the sidebar, as Tasks
and Meditations are, not a page with databases. And he wants two blocks: his own **Finanças**, and
**Divisão de contas** for what he shares with his sister, who lives with him, after the "Contas
do Apê" page he keeps as a Claude artifact (who paid, each one's part, who owes whom, fixed bills
launched each month, payments between the two).

## 1. Two fixed screens

Both are items of the sidebar (after Tasks), in the View menu and the palette.

- **Finanças** ("Meu mês"): what should be left at the end of the month first, then where it
  comes from: accounts, income, fixed bills (with "Paguei"), cards and their invoices, the
  day-to-day budget by category, the boxes, what is shared with others, the month after, and the
  month's entries. A form enters an expense, an income or a transfer; another sets up accounts,
  bills, limits and boxes. It is there before anything is entered.
- **Divisão de contas**: who owes whom over every month, with one button to record the payment;
  the month in numbers (the total, each one's part and what each paid), by category; the fixed
  bills, launched with one button; the expenses and the payments between the two. A form enters
  an expense: who paid and how it is divided (the usual percentage, all of one, exact parts).

The screens ask main for a month already added up (`api.finance`) and write by running the
blocks' own tools, the ones Claude has over MCP: one place checks what is entered.

## 2. The household block

`src/main/split`, six tools: `split_summary`, `split_config` (who it is shared with, and the usual
division), `split_add` (also a receipt line by line: each line of both, of one, or of the other),
`split_bill`, `split_launch`, `split_settle`.

It is a **view of the Finance ledger**, not a second set of books: a shared expense is an entry
with the household's group, who paid and each one's part. So the user's part of the market is in
their own budget, what they paid leaves their own account, and what the other owes shows in
Finanças, without anything entered twice. A fixed bill the user pays is theirs to pay in full that
month; one the other pays is not among their bills; the forecast of the month after counts their
part of both.

## 3. Smaller things

- "Private from AI" on Finanças closes it to the apps connected over MCP, not to its own window.
- `finance_month` as JSON is what the screen is given.
- Recorrentes has three more properties (who pays, the group, the user's part); they are added to
  a workspace that already has the database.

## Not in this release

- Reading a receipt inside sel: the photo goes to Claude, which calls `split_add` with the lines.
- More than one person in the household, or more than one household.
- Paying a card's invoice from the screen (`finance_pay_invoice` does it over MCP).
- The household's setting (who, and the division) does not sync yet: it is set once on each device.

## Checks

`npm run typecheck`, `npm run lint`, `npx vitest run --dir src`: the four failures of the base
branch on Linux and Node 22 and no other. Both screens were drawn in a browser with sample data
(light, dark and 420px wide) and checked with axe in the tests. Not run: the app itself on Windows
with a real workspace.
