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

## 2026-10-23 — How the screenshot job (0.9.0 item S0) is shaped
**Decision.** Érik asked for the job; the team chose its shape: two jobs (capture on Windows with
a read-only token, publish on Ubuntu with write rights and no PR code), the harness and scenarios
always taken from the PR head and run against both builds (a scenario that cannot run on base
shows "not in base"), one scenario file per area under `e2e/screens/scenarios/` so parallel items
do not collide, an `all` line for the release PR, older `pr-<n>/<sha>/` folders removed from
`team/screens` on each push, and the scenario ids named in each 0.9.0 item. S0 runs alone as wave
0; if it is not merged by wave 1, visible items wait one night and then fall back to
"Screenshots for Érik".
**Why.** PR code never runs with a token that can push or comment; base builds cannot know the
head's new scenarios; one registry file would make every visible item conflict with every other.
**To undo.** Say which part to change on the S0 PR (for example, keep every push's folder, or
one registry file); `/veto S0` drops the job and the visible items go back to "Screenshots for
Érik".

## 2026-10-23 (night) — Small calls from the VETO research (0.9.0)
**Decision.**
- A1a: stale `beside: true` flags left on database blocks by 0.8.0 are accepted as they are (a
  block may join the row above after updating); the release notes say so. No data migration.
- A1b: a before/after drop on a column's top block never splits the row ("after" ends that
  column, "before" on the first column goes before the row, elsewhere it is not offered).
- B1: the pt-BR hint is "Enter cria como texto" so it fits the 240 px menu on one line.
- B3: the Tasks database's fixed Priority options (P1–P4) can be renamed and recoloured, not
  reordered or deleted; the developer checks first what depends on their order.
- S0: the demo workspace seeds a "By priority" board view for the board scenario; the
  `screens-publish` job uses `!cancelled()`, and the comment body is built in `screens` and
  validated as untrusted data in `screens-publish` (details in `docs/team/research/0.9.0/`).
**Why.** Each is the smallest choice that keeps old data opening unchanged and the menus calm;
research notes and mockups are in `docs/team/research/0.9.0/` and `docs/team/design/0.9.0/`.
**To undo.** Say which one to change on #82; option (c) for A1a (a migration clearing stale
flags) would need your OK under rule 3.

## 2026-10-24 — The first three release proposals (#91, #92, #93)
**Decision.**
- #92 (0.11.0) proposes taking "appearance presets" off the charter's list of optional extras,
  flagged as an identity change: since 0.7.1 (commit 4980fe8) there is no Appearance screen and a
  saved appearance is not applied, so there is nothing to switch. The leftover code and the synced
  `appearance` setting stay untouched (removing them touches the sync format, rule 3).
- #92 explains the two verticals on a new workspace's welcome page instead of adding headings to
  the sidebar (the roadmap said "the sidebar and onboarding"): the sidebar is a list the user
  orders and hides items in, and headings there would be chrome on every screen.
- #92's extras switches are per device (not synced) and absent means on, so existing installs do
  not change; only `seedIfEmpty` writes "off" on a fresh install.
- #93 (0.12.0) does not plan "tune the evening and stalled routines from Érik's use": there is no
  use to tune from yet. It asks him to turn them on for a week, and adds Close the day's "Left for
  another day" list and a counted evening line instead.
**Why.** Each keeps the proposals true to the code on `release/0.9.0` and to the charter's
principles (nothing hidden that a user made, no stored format changed, polish before novelty).
**To undo.** Comment on the proposal: on #92, "keep presets as an extra" adds a fifth switch and
a preset picker item; "sync the switches" becomes a rule-3 question; on #93, name what the
routines should change and it becomes an item.

## 2026-10-24 (night) — Calls made while building S0, C1 and C2 (0.9.0)

- **S0:** a small `plan` job on Ubuntu reads the PR body first, so a PR without a `screens` block,
  or a body edit that leaves the block alone, never starts the Windows runner. The concurrency
  group sits on the capture job only, so a body edit cannot cancel a capture in progress.
- **S0:** one shared cap of 200 images per comment (50 scenarios in both themes); the comment
  says how many were cut. The `today` scenario shows open tasks only, because Today lists no done
  tasks; its description says so.
- **C1:** npm installed the newest patches inside the planned ranges: happy-dom 21.0.4 and
  Electron 44.9.3 (the plan named 21.0.3 and 44.9.0). Chromium is still 152, so the build targets
  did not move.
- **C2:** `esbuild` becomes a devDependency, because two tests bundle with it and vite 8 no longer
  installs it. The renderer keeps the old startup shape (entry plus vendor) through a second
  code-splitting group; Rolldown adds one 726-byte runtime chunk that cannot be folded in.
**Why.** Each keeps the plan's intent (cheap CI, nothing new shipped at startup) with the least code.
**To undo.** Say so on the PR in question or on #82; each is a small change.

## 2026-10-24 (night) — The three new proposals after #91–#93 were rejected (#96, #97, #98)
**Decision.**
- #91, #92 and #93 go to a new roadmap section, "Later (rejected for now, 2026-10-24)", not to
  "Not doing": Érik asked to keep the ideas for later. The skill says a rejection is noted in
  "Not doing"; his own words win.
- The 0.8.0 leftovers that rode on them (the "Private from AI" leaks, routine answers lost on
  restart) are parked with them, and Érik is asked on #82 whether he wants the privacy leaks
  sooner as a bug fix, since they are a broken promise rather than a feature.
- The three new proposals are new ideas the team found in the code, none from the listed pains:
  #96 (0.10.0) a right-click menu on text and plain paste, #97 (0.11.0) links, search hits,
  backlinks and Back landing where they point, #98 (0.12.0) find and replace and a headings
  outline. Two or three items each.
- #96 leaves out choosing spell-check languages (on Windows it can mean downloading Hunspell
  dictionaries, which reaches the network) and a "Paste as plain text" menu item (Chromium gives
  the page no way to tell that paste apart).
- #98 keeps the outline's open/closed state in `localStorage` (per device, like the calendar's
  view) rather than a synced setting, and does not add a table-of-contents block (a new block type
  would be a data-format change).
**Why.** Érik asked for smaller, concrete releases felt in daily use, and for the team's own ideas.
Each of these is felt on every page, adds no stored data, channel or dependency (rule 3 untouched),
and the order follows a real dependency (#98's outline jumps with #97's reveal).
**To undo.** `/reject` or comment on any of #96–#98; say "bring back X" for anything in "Later"
and it becomes a new, smaller proposal; "privacy leaks now" on #82 makes them an item.
