# Decisions the team made on its own

Append-only. One entry per decision Érik did not ask for and could reasonably disagree with.
He reviews them in the release PR; anything he rejects is undone as a plan item.

Format:

```
## <date> — <short title>
**Decision.** …
**Why.** …
**To undo.** …
```

## 2026-10-23 — 0.9.0 is pain 2 (databases and columns), not a polish pass on 0.8.0
**Decision.** The first team release takes Érik's pain 2 as its theme ("Pages and databases you
can shape"). Pain 1 (inbox) is treated as solved by 0.7.0 items 9a–9c and only confirmed with him;
the persona's pains (3, 4) and 0.8.0's leftovers wait for 0.10.0 and 0.12.0.
**Why.** His order puts pain 2 next, and it is the only one no release has touched. 0.8.0 was a
persona release; a second one before he has lived with it would pile features on unproven ones.
**To undo.** `/veto` the plan and name the pain to take first; the roadmap swaps 0.9.0 and 0.10.0.

## 2026-10-23 — Columns are the existing `beside` flag, opened to every top-level block
**Decision.** Multi-column pages reuse `BlockProps.beside` (today for databases only): a column
is a top-level block plus its children, up to four per row. No new block type, no width setting.
**Why.** An older sel opens such a page with the blocks one under the other, so no migration or
format change is needed (skill rule 3 stays untouched), and it fits one night per item. A
Notion-style column container would be a new block type older copies cannot draw.
**To undo.** `/veto A1a` (A1b and A1c fall with it); a column container would then be planned as
a format change for Érik to approve.

## 2026-10-23 — The 0.8.0 "Private from AI" leaks wait for 0.10.0
**Decision.** Private page titles still shown through relation cells and links, and inline AI
still offered on private pages (0.8.0 "Falta / para depois"), are planned for 0.10.0, not 0.9.0.
**Why.** One theme per release; 0.10.0 is the persona release and touches the same prompt and
context code. Today the only user is Érik, who knows of the gap.
**To undo.** Ask for them in 0.9.0 (`/veto` with that note); they fit as one extra item.

## 2026-10-23 — Dependabot bumps land on the release branch, not through their PRs
**Decision.** The team leaves Dependabot's PRs #75–#78 (all `devDependencies`, Electron staying on
major 44) open and lands the same versions on `release/0.9.0` as items C1 and C2, with a local
build check. The PRs close themselves when the release reaches `main`.
**Why.** The team never merges into `main`, and CI does not build the app, so a vite major could
pass CI and still break the build.
**To undo.** Merge the Dependabot PRs into `main` yourself and `/veto C1` and `/veto C2`.

## 2026-10-23 — Database property menus become bilingual; the editor waits for 0.11.0
**Decision.** Items B1–B3 put every word of the property menus in English and Brazilian
Portuguese; the editor's block menu only gets its new entries in both languages, and the rest of
the editor and database UI stays English until 0.11.0.
**Why.** Translating only what an item touches keeps items one night long, and avoids menus half
in one language where a whole menu is already being rewritten.
**To undo.** Ask for English-only menus (drop the pt-BR keys) or for the full translation sooner.
