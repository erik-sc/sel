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

## 2026-10-25 — The roadmap made to agree with six open proposals (#96–#101)
**Decision.**
- Six proposals are open, two per target version (#96 and #99 on 0.10.0, #97 and #100 on 0.11.0,
  #98 and #101 on 0.12.0), from two sessions. None is closed or rewritten; the roadmap lists all six
  in one suggested order and says every target version is a guess set when Érik approves.
- Suggested order: #99, #97, #101, #98, #100, #96. Érik's own screen (Today, pain 1) first, then
  the panel's strongest (#97); #101 after #99 because it reuses #99's moves and row component;
  #98 after #97 because its outline jumps with #97's reveal; #100 fifth as the panel was
  indifferent and the issue itself says rejecting it is fine; #96 last because by the panel rule
  (most indifferent, simulated Érik among them) it should be cut or shrunk to plain paste.
- The versioned rows after 0.9.0 in "Themes, release by release" become ordered rows without
  numbers ("next", "after them", "then"); "Ready for another developer" and the polish pass keep
  their place before 1.0.0, behind whatever Érik approves. The 0.8.0 leftovers that pointed at
  0.13.0 and 0.14.0 now point at those themes by name. Issue templates and `CONTRIBUTING.md`
  (0.9.0 plan, "First run") are named in "Ready for another developer".
- The 1.0.0 milestone gets a note: none of the six moves pains 3, 4 or 5, so 1.0.0 still needs
  them back in a shape Érik chooses, and its predecessor's version is not fixed.
- The 0.9.0 plan parks the editor's pt-BR menus under the roadmap's "Later", which had no such
  line. A "Parked by the 0.9.0 plan" table now holds it and points at #100, which also takes
  "one language throughout" from rejected #92; if #100 is rejected, the line returns as parked.
  #100 says the 0.9.0 plan "promises" 0.11.0; the plan only says "a later release". Not
  corrected on the issue (its body is not edited tonight).
- #96, #97 and #98 carry panel verdicts with "pending: next run". The roadmap marks them as
  "panel changes still to apply" and says they are applied before any of them is built.
**Why.** The skill says the roadmap and the open proposals must agree; renumbering or closing
proposals Érik has not read would decide for him. Order follows his pain first, then real
dependencies, then the panel.
**To undo.** `/next` on any proposal puts it first whatever the suggested order; `/reject` on
#96 or #100 removes it from the table (and #100's rejection sends the editor translation back to
"Later"); say "keep version numbers" on #82 and the themes table gets them back.

## 2026-10-25 — Calls made while building B1, A1a, B3, A1b, A1c and B2 (0.9.0)
Logged at CLOSE from each PR's "decided on my own" section and its review rounds, for Érik to
review. The calls already logged from the VETO research (2026-10-23, night) are not repeated.

**Decision.**
- **B1 (#102):** a second property with a taken name gets " 1" (what `uniqueName` does today; the
  design said " 2"). The add menu is a fixed 240 px; its hint line is always reserved (hidden while
  the field is empty) so the list does not jump. After an add the table scrolls "+" into view, not
  the new column's header, so the next "+" is at hand. `ui/Menu.tsx` gets an optional
  `onExitStart` (ArrowUp on the first item goes back to the field); `actions.addRelation` takes an
  optional typed name, which wins over the related database's title.
- **A1a (#103):** only blocks whose parent is the page join rows (a `top` option, default off, so
  other callers keep the 0.8.0 rule). The row repair runs inside `commit`, in the same undo step;
  blocks a batch creates, or whose `beside` it sets itself, are left alone. Copy, paste and
  Duplicate keep `beside` on any block but a sub-page, but **paste drops `beside` on a fragment's
  first block** (a pasted whole row stays a row; Duplicate keeps its place); this applies to
  databases too. A column's head loses its top margin; text, heading, callout and quote heads draw
  their children flush, while toggle, list and to-do heads keep the indent. The version viewer
  draws the same rows but keeps wide rows at its text width. The gap line is a column border shown
  only on hover or focus.
- **A1b (#105):** the side zone is the block's outer quarter, capped at 96 px; the left zone
  starts at the block's edge, not in its gutter, so a straight-down drag from the handle never
  becomes a side drop. **Side drops only beside top-level blocks.** **A drop above or below a
  column never splits its row**: above a later column means beside it, below a non-last text
  column means inside it, and above or below at page level puts the block on a line of its own.
  **`/2` and `/3` pick "2 columns" / "3 columns"** (Heading 2/3 stay on `/h2`, `/h3`); the
  label-word rank that makes `/col` work applies to the column items only. `/columns` replaces an
  empty text-type block with no children. Files dropped on a side land below the block. The gap
  line hides when a row wraps (a `ResizeObserver` per row).
- **B3 (#104):** **the Tasks priorities P1–P4 cannot be moved or deleted from the column menu**
  (no handle, no "Delete option"; rename and recolour stay); the cell picker and board group pane
  are unchanged. **Every column menu is a fixed 240 px** (it was 220–340 px), so long relation and
  rollup labels end in an ellipsis. Tab wraps inside the column menu instead of leaving it (`Menu`
  `tabbable`, `Popover` `onEscape`, both opt-in). Adding an option is announced. "Ocultar na
  visualização". The option edit pane's own words stay English.
- **A1c (#106):** **Enter at the very start of a column's head** puts a new empty head in its
  place, with the old head as its first line; the new head keeps the old head's type (as Enter does
  elsewhere), so a to-do or list column takes two Backspaces to undo it. **`HOLDS_ITS_CHILDREN`**
  (toggle, bulleted, numbered, to-do, the same list as the CSS indent rule): such a head keeps its
  sub-items when Enter moves it down, and Backspace never lifts such a first line into the row
  over other lines. Backspace in an empty head over a text first line lifts that line into the row
  (the reverse of Enter at the start). Backspace at the start of a column's last line joins it to
  the line above, inside the column. Delete never pulls a head in, also from the block above the
  row. A collapsed toggle head opens when Enter adds a line under it. An empty bullet that leaves a
  row stays a bullet.
- **B2 (#107):** **F2 opens a header's menu** with its name selected; F2 stays one `PAGE_KEYS`
  line whose "where" now names table headers too. Mouse clicks do not make a header active (the
  click flow looks as before). **The insert position is stored in the view's existing
  `visibleProperties`** (what a column drag writes), in the same write as the schema. Insert
  left/right come after a relation's, rollup's or formula's own settings. Escape on an active
  header does nothing. "One undo" is proved as one write whose inverse restores the page, since
  databases have no undo yet. Two new icons, `InsertLeft` / `InsertRight`.

**Why.** Each is the smallest choice that keeps old data opening unchanged, keeps a row whole
while the user types or drags, and keeps menus calm. All were reviewed and approved on their PRs.
**To undo.** Name the call on #82 and it becomes an item in the next release. Larger ones: show
P1–P4 deletion everywhere, or nowhere; let paste keep the first block's `beside`; give `/2` back
to Heading 2; let side drops reach nested blocks (a scope change); keep each column menu at its
content's width.

## 2026-10-25 — 0.9.0 CLOSE: where its leftovers go
**Decision.** The leftovers in the 0.9.0 plan's "Left for later" go to the polish pass before
1.0, except: the pt-BR words still in English go to proposal #100; undo for database edits gets
its own small proposal in the next backlog upkeep (first step: an Undo toast on option delete),
because it is a gap against the release's own principle and option delete now clears every row in
two clicks; screenshot-harness limits are team tooling with no release slot. The six proposals'
suggested order (#99, #97, #101, #98, #100, #96) is unchanged: nothing 0.9.0 shipped touches
their dependencies.
**Why.** Polish before novelty; none of these is a pain Érik named, and most need him to try the
columns in use before they are worth a night.
**To undo.** Say on #82 which line to take sooner (it becomes an item of the next release), or
that database undo can wait for the polish pass.

## 2026-10-25 — 0.10.0 plan: Let go built inside #101, E1 split in two
**Decision.** #101 relied on #99's Let go and tomorrow moves; #99 was rejected, so Let go is built in
0.10.0 (E1b) with its own copy, reusing `deleteRows`/`restoreRows`. Today and the Overdue menu mentioned
in the proposal are not touched. E1 is split into E1a (selection and keys) and E1b (strip and Let go), two
waves, so each fits a night. Scope as approved is unchanged. Versions in the roadmap follow Érik's order.
**Why.** The approved text already described Let go in full; the split keeps files from overlapping.
**To undo.** Say on the release PR; E1b can be dropped with `/drop E1b` and the keys of E1a ship alone.
