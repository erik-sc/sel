# Release 0.12.0 — Blocks, a complete MCP, and Finanças

Status: **proposed** · 2026-11-10 · branch `release/0.12.0`

Érik, 2026-11-10: what works for him in sel today is tasks; databases he barely uses, and the
finances he tried to keep in one did not last, because a generic database is fiddly for a specific
job. The direction: **blocks** — parts of sel built to measure, each with its own data and its
own tools — that an agent can add on request ("vibe coding" a plugin), operated headless from
Claude on the phone. Decisions he made that day:

- The first delivery is the **contract and the registry**, not moving every feature's files.
- Only he writes blocks: no plugin loader, no sandbox, no stable API. A block is a folder in the
  repo and a build.
- The MCP may **delete when there is version control**: to the trash, never for good.
- Finanças must be able to feed the "Meu mês" dashboard he keeps as a Claude artifact, improved,
  and do what Splitwise does, receipts ("notas fiscais") included.

## 1. Blocks: the contract and the registry

A block declares its tools as plain data (`toolspecs.ts`, a `ToolPack` with a scope per tool) and
runs them (`tools.ts`); `src/main/tools/catalog.ts` lists the packs and `src/main/tools/run.ts`
their runners. The endpoint for apps on this computer and the remote connector both read from
there, so a tool added to a block reaches both, and the phone, with no other change.
docs/codebase-knowledge/50-conventions.md, "Adicionar um bloco", is the contract.

Three blocks so far: **Tasks** (its tools moved from src/main/remote to src/main/tasks),
**Pages and databases** (the workspace tools), **Finanças** (new). Herman's own read-only tools are
not a pack and did not change.

## 2. A complete MCP

Before: 14 tools, nothing could be changed in place or taken away. Now 41, by block:

- **Tasks** — `list_tasks` also lists what was completed and filters by project or label;
  `list_projects`; `update_task` (title, priority, project, labels, repeat, notes);
  `reopen_task`; `delete_task`.
- **Pages and databases** — `update_page` (title, icon, or the whole text: the version history
  keeps what it said, and the pages inside stay); `move_page`; `delete_page` and `restore_page`,
  with `list_trash`; `create_database`, `add_database_property`, `add_select_options`.
- **Finanças** — fifteen tools, below.

Deleting is always to the trash. The consent screen of the remote connector has a fourth line,
**Finance**, off unless asked for; connections made before keep what they were given.

## 3. Finanças

A page with five databases, created the first time something is entered (never on a read, never
at start-up): **Lançamentos** (the ledger), **Recorrentes** (fixed bills and expected income),
**Orçamento** (a monthly limit by category), **Contas e cartões**, **Caixinhas**. They are
ordinary databases with fixed ids: they sync, export, keep history and can be private from the
AI like any other, and can be opened and edited in the window as they are.

What the tools do with them (src/shared/finance/calc.ts is the arithmetic, in cents):

- **The month** (`finance_month`): what the accounts hold, income received and expected, bills
  paid and pending, each card's invoice, the day-to-day budget by category with what is left a
  week, the boxes, who owes him, what should be left at the end of the month, and the forecast of
  the month after. `format: "json"` gives the same as data: what a "Meu mês" dashboard is drawn
  from.
- **Cards**: a purchase falls on the invoice its date and the card's closing day say; instalments
  are one entry a month, each on its invoice; paying an invoice is a transfer, so nothing counts
  twice.
- **Balances**: an account or a box says what it held when last told (from the bank's app);
  entries made from then on move it.
- **Shared expenses**, as Splitwise: an expense split in equal parts or exact shares, whoever
  paid; `finance_balances` nets every pair; `finance_settle` records a payment; groups (a trip, the
  house).
- **Receipts** (`finance_receipt`): Claude reads the photo and gives the lines; each line may name
  who shares it, the rest is split among the people given, and service or a discount scales every
  part to what was paid. The lines stay on the entry's page.
- `finance_projection`: the reserve month by month, with what is saved and what it yields.

## Not in this release

- **A screen for Finanças in the window.** The data are there as databases; the screen built to
  measure (the "Meu mês" view inside sel) is the next step.
- Meditations and the other features as blocks: they have no tools of their own yet, and move to
  the contract when they are next touched.
- Currencies other than the real; importing a bank statement; reading a receipt inside sel (the
  photo is read by Claude, which calls the tool).
- A block created at run time: adding one is still a change to the repo and a build.

## Checks

`npm run typecheck`, `npm run lint`, `npx vitest run --dir src`: the four failures of the base
branch on Linux and Node 22 (three Windows-only suites, one chart test that needs Node 24) and no
other. New tests: src/shared/finance/calc.test.ts, src/main/finance/finance.test.ts,
src/main/tools/tools.test.ts, and the task tools in src/main/remote/remote.test.ts.
