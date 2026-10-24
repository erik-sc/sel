# Release 0.9.0 — Pages and databases you can shape

Status: **building** · 2026-10-24 · branch `release/0.9.0` (from `main` at 8da2eb4, v0.8.0)
· approved by Érik's `/ok` on #82, 2026-10-24 · S0 built (#88, waits for his OK) · C1 merged (#89) · C2 merged (#90)

Érik's second pain, in his words: "the multi-column page layout does not work; too many clicks to
edit columns". Today only database blocks can sit side by side, so a page cannot put a note
beside a list or two short sections next to each other; and shaping a database takes a click for
every step: a new property arrives named "Text" and has to be opened again to be renamed, select
options can only be edited from inside a cell, and the table's headers ignore the keyboard. This
release makes pages and databases take the shape you have in mind in the fewest moves. After 0.8.0,
the largest release so far, it adds no new screen and no new kind of data.

Pain 1 (the inbox) looks solved in code by 0.7.0 items 9a–9c (chips, task panel, Refine mode); the
release PR asks Érik to confirm instead of planning more there.

**Principles for every item.**
- Nothing new is stored that an older sel cannot open. Columns reuse the existing `beside` block
  property (`src/shared/types.ts`, `BlockProps.beside`); a 0.8.0 copy reading a 0.9.0 page shows
  the same blocks one under the other. No migration, no change to `src/main/sync/format.ts`, the
  backup or the export format.
- Every action has a keyboard path and is announced to screen readers through
  `src/renderer/src/a11y/announce.ts`.
- New or changed words come in English and Brazilian Portuguese, picked by the home's locale
  (`useHome((s) => s.locale)`, as `src/renderer/src/database/dateCopy.ts` does). The editor and
  database menus are English-only today; this release translates only the menus it touches
  (the rest is planned for 0.11.0).
- Undo (Ctrl+Z) reverses each change as one step.
- `npm run typecheck`, `npm run lint` and `npx vitest run --dir src` green on Node 24 before the PR.
- Every item a user sees (A1a, A1b, A1c, B1, B2, B3) shows itself through S0's screenshot job:
  its PR body carries a `screens` block naming the scenarios in its "Done when", and adding those
  scenarios to the registry is part of the item (skill, "Screenshots").

## Epic S — See it before it merges

Asked by Érik on the release PR (#82), 2026-10-23: "reviewing visual changes without seeing them
is a bottleneck". The cloud sessions cannot launch the app (Electron 44 needs a native
`better-sqlite3` they cannot fetch), so the only place the real app can run is CI's Windows
runner. This item builds the job that the skill's "Screenshots" section describes; every visible
item after it relies on it.

### S0. Screenshot job

**Today.** `.github/workflows/ci.yml` typechecks and lints on Ubuntu and runs
`npx vitest run --dir src` on `windows-latest`; nothing builds or launches the app on a pull
request (only `release.yml` builds, on a tag: `npm ci --ignore-scripts`, then
`node node_modules/electron/install.js`, then `npm run dist`). There is no Playwright and no
`e2e/` folder. The 49 images in `docs/screens/` were taken outside CI, from the Windows app. The app keeps
everything under Electron's `userData` (`src/main/index.ts`: `sel.db`, `DB_FILE` in
`src/main/legacy.ts`) and fills an empty database with the welcome page (`seedIfEmpty` in
`src/main/db/seed.ts`, skipped once the `seeded` setting exists). Tests already open a real
`Repository` on Node's built-in SQLite (`openTestRepository` in `src/main/db/testing.ts`). The
built-in Tasks database has fixed ids (`TASKS_DATABASE_ID`, `TASK_PROPS` in
`src/shared/tasks/index.ts`); view types include `table`, `board` and `calendar`
(`ViewType` in `src/shared/types.ts`). The theme is the stored `theme` setting
(`src/shared/settings.ts`).

**Scope.** A new workflow `.github/workflows/screens.yml`, a harness under `e2e/screens/`, and
no change to the shipped app (`src/` untouched; if the app truly needs a hook, it is a separate
question in the PR, not part of this item).

- **Trigger.** `pull_request` with types `opened`, `synchronize`, `reopened` and `edited` (so
  changing the PR body's block re-runs it). Concurrency group per PR number,
  `cancel-in-progress: true`. Never `pull_request_target`.
- **The `screens` block.** The first fenced block with the info string `screens` in the PR body;
  one scenario per line, `<id>: <free text>` (only the id is read; blank lines ignored). The
  word `all` on a line means every registered scenario (used by the release PR in CLOSE). No
  block: the job ends green within a couple of minutes, captures nothing, posts nothing.
- **Scenario registry.** `e2e/screens/scenarios/<area>.ts`, one file per area, each exporting an
  array; the harness loads every file in the folder (no index to edit), so two items adding
  scenarios never touch the same file, and ids are checked unique across files. Each entry is
  `{ id, description, locale?: 'en' | 'pt-BR', themes?: ('light' | 'dark')[], workspace?: (repo) => void, run: async (page) => void }`.
  `id` is kebab-case and unique; `themes` defaults to both; `locale` defaults to `en` and is
  written to the home's locale setting before launch; `workspace` adds to the demo workspace for
  this scenario only; `run` drives the window from the open app to the state to capture, using the
  UI (palette, clicks, keys) as a user would. The capture is the whole window at 1280×800 after
  `run` returns, fonts loaded, with Playwright's `animations: 'disabled'` and the caret hidden.
  Unknown ids in the block fail the capture job with a message that names them.
- **Starter scenarios** (defined by this item, both themes):
  - `today`: the Today screen with tasks due today, one overdue, one done.
  - `page-notes`: the demo notes page (headings, text, a to-do list, a callout, a toggle).
  - `tasks-table`, `tasks-board`, `tasks-calendar`: the Tasks database in each of its three
    views (board grouped by priority; calendar on the current month).
- **Demo workspace seed.** `e2e/screens/seed.ts` writes a fresh `sel.db` into a temporary user
  data folder through the real `Repository` on `node:sqlite` (as `openTestRepository` does), so
  the schema and migrations are the app's own: the `seeded` setting set (no welcome page), the
  AI onboarding and any first-run or "what's new" notice marked seen, the theme setting per
  capture; a page "Notes" (content above) and a page "Projects" with two sub-pages; the built-in
  Tasks database with about 12 rows (titles, priority, project, labels, due dates relative to the
  run's date: overdue, today, this week, next week, none; two done) and three views table, board,
  calendar. Text is fixed English (pt-BR scenarios change only the UI language). The same seed
  runs for base and head.
- **Head vs base.** The capture job checks out the PR head and, beside it, the PR's base commit
  (`github.event.pull_request.base.sha`). The harness, registry and seed always come **from the
  head**; the base checkout only supplies the app. Each is installed and built on its own:
  `npm ci --ignore-scripts`, `node node_modules/electron/install.js`, `better-sqlite3` rebuilt for
  Electron's ABI (`npm run rebuild`), `npm run build`. Each scenario × theme is captured on both,
  each launch with Playwright's Electron driver (`_electron.launch` from `@playwright/test`,
  `args: ['.', '--user-data-dir=<temp>']`, `cwd` the checkout) on a fresh copy of the seeded
  folder. A scenario whose `run` fails on base (the feature does not exist there yet) is shown as
  "not in base", not as a failure; one that fails on head is a failure.
- **Two jobs, so PR code never holds a write token.**
  - `screens` (`windows-latest`, `timeout-minutes: 40`, `permissions: contents: read`,
    `persist-credentials: false`): parse the block, build both, capture, and upload the PNGs plus
    a `manifest.json` (scenario, theme, side, status, first line of any error) as a workflow
    artifact (kept 14 days). Red when a head capture failed or an id is unknown.
  - `screens-publish` (`ubuntu-latest`, `needs: screens`, `if: always()` when the block existed,
    `permissions: contents: write, pull-requests: write`; checks out no PR code): downloads the
    artifact, commits it to the orphan branch `team/screens` under
    `pr-<n>/<head-sha-7>/<scenario>-<theme>-<base|head>.png` (the branch is created as an orphan
    with a one-paragraph README the first time; older `pr-<n>/<sha>/` folders are removed in the
    same commit, git history keeps them; push retried with `git pull --rebase` up to three times
    when several PRs publish at once), then posts or updates the comment.
  - Top-level `permissions: {}`; the only token is `GITHUB_TOKEN`; no secrets.
- **The comment.** One per PR, found again by its hidden marker and edited on every push (REST
  `issues/<n>/comments`, then `PATCH`). Body, signed per rule 8:
  ```
  <!-- sel-team -->
  <!-- sel-screens -->
  ## Screens · head <sha7> vs base <sha7>
  ### <id> — <description>
  | | Before (base) | After (head) |
  |---|---|---|
  | Light | <img> | <img> |
  | Dark | <img> | <img> |
  …
  Failed: `<id>` (<theme>): <first line of the error>      (only if any)
  Unknown: `<id>`                                           (only if any)
  — sel team (automated)
  ```
  Images link to `https://github.com/<owner>/<repo>/raw/team/screens/pr-<n>/<sha7>/<file>` (works
  for anyone who can read the repo). A run with a block but no capture at all (build failed)
  still updates the comment to say so, with a link to the run.
- **Fork pull requests.** `GITHUB_TOKEN` is read-only there, so `screens-publish` is skipped
  (`if: github.event.pull_request.head.repo.full_name == github.repository`); the capture still
  runs and its artifact is downloadable from the run. Nothing else changes for them.
- **Docs.** A short "Screens" section in `docs/codebase-knowledge/50-conventions.md`: how to add
  a scenario, how to run the pure parts locally, why capture runs only on Windows CI.

**Out of scope.** Pixel diffs or failing on visual change (the images are for people);
macOS or Linux captures; refreshing `docs/screens/` (CLOSE does that by hand from the job's
output); any change to `ci.yml` or `src/`; video or GIFs.

**Touches.** new `.github/workflows/screens.yml`; new `e2e/screens/` (`playwright.config.ts`,
`seed.ts`, `scenarios/` (`today.ts`, `pages.ts`, `tasks.ts`), `block.ts` for parsing, `comment.ts` for the body, their tests,
`README.md`); `package.json` and `package-lock.json` (`@playwright/test` as a pinned
**devDependency**, a `screens` script); `tsconfig.node.json` and `biome.json` only to include
`e2e/`; `.gitignore` (output folder); `docs/codebase-knowledge/50-conventions.md`.

**Done when.**
- Pure tests (run by the `screens` job before capturing, and green locally on Node 24): the
  block parser (no block, `all`, ids with and without text, blank lines, a second block ignored);
  the comment builder (pairs, "not in base", failed and unknown lines, both markers, the
  signature); the seed (opens the result with `Repository` and finds the Notes page, the Tasks
  database with views `table`, `board` and `calendar`, a row due today, and `seeded` set).
- On S0's own PR, whose body lists the five starter scenarios: `screens` runs green on
  `windows-latest`; `team/screens` gets `pr-<n>/<sha7>/` with 20 PNGs (5 scenarios × 2 themes ×
  base and head); one signed comment shows them in pairs. A second push edits that same comment
  (still one comment) and replaces the folder.
- Editing the block to add `nope-not-a-scenario` turns `screens` red and the comment lists it as
  unknown; removing the block makes the next run green with no new push to `team/screens`.
- The workflow file shows `permissions: {}` at the top, `contents: read` on `screens`, the fork
  condition on `screens-publish`, and no `pull_request_target`.
- **Merging waits for Érik's explicit OK** (skill rule 3: it changes `.github/workflows/`). The
  item is built, its PR shows its own screenshots, and it stays `blocked: needs Érik` until he
  says yes on the PR.

**Design.** _(sel-team)_ Not part of the app. The comment is built for Érik reading on GitHub,
light or dark: one heading per scenario, light row above dark, before on the left; nothing else
in it but the failures, so a glance says "looks right" or "something broke".

## Epic A — Columns on a page

How a column works, for all three items: a **row** is a run of top-level blocks of a page in
which every block after the first has `props.beside === true` (up to `MAX_BESIDE` = 4). Each
block of a row is the **head** of a column; the column is that head plus its children, drawn
under it **without indentation**. This is the model `src/renderer/src/editor/layout.ts` already
uses for database blocks; Epic A opens it to every block type except sub-page blocks (`page`).

### A1a. Any block can sit beside another

**Today.** `canShareRow` in `src/renderer/src/editor/layout.ts` returns true only for `database`
blocks, so `rowsOf`, `sitsBeside` and `besideChoice` group only databases. The block menu
(`src/renderer/src/editor/menus.tsx`, around the `beside` entry) offers "Place beside the previous
block" only to a database. `BlockList` in `src/renderer/src/editor/BlockView.tsx` and the version
viewer `src/renderer/src/versions/ReadOnlyBlocks.tsx` draw a row as `.blk-beside`; the CSS in
`src/renderer/src/editor/editor.css` (`.blk-beside`, `.pe-page .pe-body > .blk-beside`) gives
every row the wide database width. `ctrl.setBeside` in `src/renderer/src/editor/controller.ts`
writes the flag. Nothing repairs a row when its head is moved, deleted or indented: the next
block keeps `beside: true` and joins whatever block now precedes it.

**Scope.**
- `canShareRow` accepts any block whose parent is the page itself (top level) and whose type is
  not `page`; database blocks keep sharing rows at any level, as today. `rowsOf` and
  `besideChoice` follow.
- In a row, each head's children are drawn inside its column without the usual indent
  (`.blk-beside > .blk > .blk-children`); toggles still collapse their children.
- Width (ruled 2026-10-23, from the design note): a row of **2** non-database blocks keeps the
  page's text width (`--page-width`); a row of **3 or 4** blocks, or any row holding a database,
  takes the database width (`--database-width`), as database rows do today. Non-database columns
  have a minimum width from a new token `--column-min: 160px` in
  `src/renderer/src/styles/tokens.css`; database columns keep their 240 px minimum. With less
  room than that, the columns wrap one under the other, as `.blk-beside` already does.
- The block menu offers the beside entry for every block that can share a row, with the same
  rules as today (nothing before it, or that row full: no entry).
- **Row repair.** A pure function in `layout.ts` returns the ops that clear `beside` on a block
  that would otherwise join the wrong row, and the controller applies them in the same commit
  whenever blocks are moved, deleted, indented or merged: when the head of a row leaves, the
  next block of that row becomes the head (its `beside` is cleared); a block that stops being
  top level loses `beside`.
- Copy (block menu and announcement), in a new `src/renderer/src/editor/copy.ts` with a
  `useEditorCopy()` hook:
  - "Place beside the previous block" / "Colocar ao lado do bloco anterior"
  - "Place below the previous block" / "Colocar abaixo do bloco anterior"
  - announced: "Placed beside" / "Colocado ao lado"; "Placed below" / "Colocado abaixo"

**Out of scope.** Dragging to the side and a slash command (A1b); Enter, Backspace and Tab inside
a column (A1c); column widths; columns inside a toggle or a callout; the persona creating columns
(0.10.0); Markdown export of columns (it keeps writing the blocks in order).

**Touches.** `src/renderer/src/editor/layout.ts`, `layout.test.ts`, `BlockView.tsx`, `menus.tsx`,
`controller.ts` (only `setBeside` and the place where commits are built, for the repair),
`editor.css`, new `editor/copy.ts`; `src/renderer/src/versions/ReadOnlyBlocks.tsx`;
`src/renderer/src/styles/tokens.css` (one token, `--column-min`); new
`e2e/screens/scenarios/columns.ts`.

**Done when.**
- `layout.test.ts`: two text blocks with the second `beside` form one row; a sub-page block never
  joins; a nested text block never joins; a fifth block starts a new row; `besideChoice` for a
  text block; the repair returns the right ops for: head deleted, head moved elsewhere, head
  indented, middle block deleted (nothing to repair), last block deleted.
- A happy-dom test renders a page with a text head with two children beside a callout and finds
  one `.blk-beside` with two columns, the children inside the first.
- The row's width class follows the rule: a test (pure helper or happy-dom) finds text width for
  a row of 2 text blocks, database width for a row of 3 text blocks and for a row of a text block
  beside a database.
- The version viewer draws the same rows (test or a case in an existing ReadOnlyBlocks test).
- A page saved with columns and opened by the 0.8.0 rules (`canShareRow` for databases only) lists
  the same blocks in the same order: a pure test that runs the old predicate on the new data.
- Screens (S0; the item adds them in a new `e2e/screens/scenarios/columns.ts`, both themes):
  `columns-two` (a text head with two children beside a callout, text width),
  `columns-four` (four blocks in one row, database width), `columns-beside-database` (a text block
  beside a Tasks database view), `block-menu-beside` (a text block's menu open on "Place beside
  the previous block"), `block-menu-beside-pt` (the same, locale pt-BR).

**Design.** _(sel-designer)_ Flow: hover the block, click its handle (⋮⋮), "Place beside the
previous block": 2 clicks, as for databases today. Keys: Esc selects the block, Shift+F10 (or the
Menu key) opens its menu, arrows, Enter: 4 keys, no new shortcut. A1b's drag and /columns are the
1-gesture paths; this entry stays as the precise, discoverable one.
- **Width (scope change).** "A text row keeps the page's text width" cannot hold 3 or 4 columns:
  `--page-width` is 560 px and the gap 52 px, so 3 columns get 152 px, under the 240 px minimum,
  and A1b's "3 columns" would wrap on creation. Rule instead: a row of **2** non-database blocks
  keeps the text width (2 × 254 px, the page does not jump); a row of **3 or 4**, or any row with
  a database, takes the database width. Non-database columns get a new token
  `--column-min: 160px` (tokens.css) instead of 240 px, so 4 fit in 880 px; database columns keep
  240 px. Below that, columns wrap one under the other, as today.
- **Look at rest: nothing.** No borders, no backgrounds, columns top-aligned (`align-items:
  flex-start`), uneven heights left uneven. Only while the row is hovered or has focus, a
  `--hairline` line in `--border` sits in the middle of each gap, so the columns can be seen and
  aimed at; the block gutter (+, ⋮⋮) still sits in the gap. Both themes come from the tokens.
- **Children in a column** use the column's left edge (no `--indent`); a toggle's children
  keep their own indent inside the toggle, so a toggle still reads as one.
- **States.** One very long column beside a short one: fine, top-aligned. A row full (4): the
  entry is absent, never disabled. Version viewer: same rows, same widths.
- **Screen reader.** Reading order is document order (column 1 with its children, then column
  2). `.blk-beside` gets `role="group"` and `aria-label` "{n} columns" / "{n} colunas", so the
  reader says where the columns start and end; announcements as listed in Scope.
- **Copy** as in Scope, plus the group label: "{n} columns" / "{n} colunas". Herman says nothing:
  layout is not a moment for the persona.

### A1b. Drag a block to the side, or type /columns

**Today.** Dragging blocks in `src/renderer/src/editor/PageEditor.tsx` (`onDragOver`, `onDrop`)
picks a `DropTarget` with `pos` `'before' | 'after' | 'inside'` (`DropPos` in
`src/renderer/src/editor/types.ts`); `moveToOps` and `placeForDrop` in
`src/renderer/src/editor/structure.ts` turn it into ops; the drop line is drawn by the
`drop-before`, `drop-after`, `drop-inside` classes on `.blk`. There is no way to make a row by
dragging, and no slash item for columns (`SLASH_ITEMS` in `src/renderer/src/editor/blockTypes.ts`,
Portuguese search words in `SLASH_KEYWORDS_PT`).

**Scope.**
- Two new drop positions, `'left'` and `'right'`, offered when the pointer is over the outer
  quarter of a block that can share a row (A1a's `canShareRow`) and the row has room (fewer than
  4 blocks, counting the dragged ones that are not already in it). The drop indicator is a
  vertical line on that side of the block.
- Dropping on `'right'` of X puts the dragged blocks right after X with `beside: true`; on
  `'left'` of X puts them before X, the first dragged block taking X's `beside` value and X
  getting `beside: true`. Several dragged blocks become several columns, in order. Dragging a
  head out of its row repairs the row (A1a's repair).
- Dropping files on a side position behaves like `'after'` (no image columns by drop in this
  item).
- Slash items "2 columns" and "3 columns": replace the empty block the slash was typed in with
  that many empty text blocks in one row, caret in the first.
- Copy:
  - slash: "2 columns" / "2 colunas", hint "Two blocks side by side" / "Dois blocos lado a lado";
    "3 columns" / "3 colunas", hint "Three blocks side by side" / "Três blocos lado a lado";
    Portuguese search words "colunas lado a lado"
  - announced after a side drop: "Placed beside" / "Colocado ao lado" (A1a's key)

**Out of scope.** Keyboard moves between columns (Ctrl+Shift+arrows keep moving blocks up and
down); column widths; dropping on the side of a nested block.

**Touches.** `src/renderer/src/editor/PageEditor.tsx` (drag handlers), `types.ts` (`DropPos`),
`structure.ts` and `structure.test.ts` (`placeForDrop`, `moveToOps`), `blockTypes.ts`,
`editor.css` (side drop line), `editor/copy.ts` (keys added), `e2e/screens/scenarios/columns.ts`.

**Done when.**
- `structure.test.ts`: `moveToOps` with `'left'` and `'right'` gives the right order and `beside`
  flags for: one block beside a lone block, a block into an existing row, a row's head dragged out
  (repair), a drop that would make a fifth column (refused: no ops), a block dropped beside itself
  (no ops); each undone by its inverse ops leaves the page as before (the file's `applyAndUndo`).
- The slash items create the row in one commit (test on the plan or the controller).
- On the built app: drag a paragraph to the right of a heading and see two columns; drag it back
  out and see one column. Proved by the screens below (the drag is driven with Playwright's mouse
  in the scenario's `run`) instead of a scratch profile.
- Screens (S0; added by this item to `e2e/screens/scenarios/columns.ts`, both themes): `columns-drag-right` (mid-drag, the vertical drop
  line on the right of a heading), `columns-dropped` (the two columns after the drop),
  `slash-columns` (the slash menu filtered by "col", showing "2 columns" and "3 columns"),
  `slash-columns-pt` (the same, locale pt-BR, filtered by "colunas").

**Design.** _(sel-designer)_ Flow: drag the handle to the side of a block, drop: 1 gesture,
the shortest path to a column. From scratch: "/2" or "/col", Enter: 3 keys gives an empty
two-column row.
- **Drop indicator.** The same 3 px `--accent` line as the before/after line, drawn vertically
  in the middle of the gap on that side (not on the block's edge, where it would cover text),
  as tall as the target block. Only one line shows at a time. When the row is full, the side
  zones simply do not exist and the pointer falls back to before/after: no refusal mark, no toast.
  While a drag hovers a row, its gap hairlines (A1a) show.
- **Slash items** sit in the Blocks section right after Divider (the layout entries together).
  Glyphs in the mono box: "II" and "III". Search words en "columns layout side" (plus the
  existing labels), pt-BR "colunas lado a lado". Offered only when the slash block is top level
  and not inside a row; hidden in a column, a toggle or a callout. If the block holding the slash
  has other text, the row goes right after it instead of replacing it, caret in the first column.
- **Empty columns** made by /columns are empty paragraphs whose placeholder shows only with the
  caret (today's rule); the row's hairlines while focused (A1a) are what shows the other columns.
  An empty column keeps one line of height so it can be clicked.
- **Keyboard and reader.** No keyboard drag (out of scope, agreed: the block menu entry of A1a is
  the keyboard path). After a side drop: "Placed beside" / "Colocado ao lado"; after /columns:
  "{n} columns" / "{n} colunas" (A1a's group label key). The slash options keep their
  `role="option"` and hint as their description.
- **Copy** as in Scope; hint "Two blocks side by side" / "Dois blocos lado a lado", "Three blocks
  side by side" / "Três blocos lado a lado" are right in length for the slash menu.

### A1c. Typing inside a column

**Today.** Enter, Backspace and Tab are handled by `onBlockKeyDown` in
`src/renderer/src/editor/keyboard.ts`, through `splitPlan`, `backspacePlan`, `indentOps` and
`outdentOps` in `src/renderer/src/editor/structure.ts`. `splitPlan` already puts the new block as
the first child of a block that shows children, and lifts an empty last nested block one level
out. None of them knows about rows, so typing in a column breaks it: Enter at the end of a head
with no children makes a sibling that lands between two heads and splits the row.

**Scope.** Inside a row (A1a), with arrows keeping the document order (column by column, which
is also what a screen reader reads):
- Enter at the end of a head creates the new block as the head's **first child**, so it stays in
  the column, whether or not the head had children.
- Enter on an empty block that is the last child of a head moves it **out of the row**, right
  after the row's last column, caret kept: pressing Enter twice leaves the columns, as it leaves
  a list.
- Shift+Tab on a direct child of a head moves it after the row, never between two heads.
- Tab on a head does nothing (it would fold one column into the one before).
- Backspace at the start of a head never merges it into another block. An empty head with no
  children is deleted, the row closes up (A1a's repair) and the caret goes to the end of the last
  block of the previous column, or of the block before the row.
- Delete at the end of the last block of a column does not pull the next column's head in.
- Announced when leaving the row: "Out of the columns" / "Fora das colunas".

**Out of scope.** Moving whole columns left or right by keyboard; selecting across columns
differently from today.

**Touches.** `src/renderer/src/editor/structure.ts` and `structure.test.ts` (`splitPlan`,
`backspacePlan`, `deleteForwardPlan`, `outdentOps`, `indentOps`), `keyboard.ts` only if a plan
needs a new kind, `typing.test.ts` if the keyboard path is covered there, `editor/copy.ts` or
`src/renderer/src/a11y/copy.ts` (one announcement), `e2e/screens/scenarios/columns.ts`.

**Done when.** `structure.test.ts` covers each rule above with a page holding a two-column row and
a block after it: Enter at the end of a lone head; Enter at the end of a head with children;
Enter on an empty last child (lands after the row, row intact); Shift+Tab on a child; Tab on a
head (no ops); Backspace in an empty head (deleted, row repaired) and in a non-empty one (no
merge); Delete at the end of a column (no merge). The plans outside rows give exactly the
results they give today (existing tests unchanged).
Screens (S0; added by this item to `e2e/screens/scenarios/columns.ts`, both themes): `columns-enter-inside` (after typing a line and
Enter at the end of a lone head: the new line under it, inside the column, row intact),
`columns-enter-out` (after Enter twice on an empty last child: the caret's block under the row,
the row intact).

**Design.** _(sel-designer)_ The rules match what a list already does, so nothing has to be
learnt: Enter keeps you in the column, Enter on an empty line leaves it (2 keys out, like leaving
a list). Agreed as scoped, with three precisions:
- **Backspace at the start of a non-empty head** still does the gentle part of today's behaviour
  (a heading, list or quote turns into text first); only the merge into the previous column is
  refused. A key that does nothing at all feels broken.
- **Arrows** follow document order: ArrowDown at the end of column 1 jumps to the top of column 2.
  That jump is expected (it is what a reader reads); the caret's block is scrolled into view if
  needed, nothing else moves.
- **Leaving the row** (Enter on an empty last child, Shift+Tab on a child) announces "Out of the
  columns" / "Fora das colunas" through `announce()`; nothing visual beyond the caret moving under
  the row. Entering is not announced: the group label (A1a) already says it.
- States: an empty head with children is not deleted by Backspace (its children would lose their
  column); Backspace there acts as in any empty block with children today.

## Epic B — Fewer clicks on a database's columns

### B1. Name a property as you add it

**Today.** `AddPropertyMenu` in `src/renderer/src/database/propertyMenus.tsx` is a list of types;
picking one calls `actions.addProperty` (`src/renderer/src/database/actions.ts`), which names the
property after its type ("Text", "Number", then "Text 2"…, `addProperty` in
`src/shared/database/mutations.ts`). To give it a real name the user clicks its header again and
types in `PropertyMenu`'s name field. The same menu is used by the table's "+" header
(`src/renderer/src/database/views/TableView.tsx`), by "Add a property" on a row page
(`src/renderer/src/database/RowProperties.tsx`) and by the properties panel
(`src/renderer/src/database/panels.tsx`). Type names come from `TYPE_LABELS` in
`src/shared/database/values.ts`, English only.

**Scope.**
- `AddPropertyMenu` opens with a name field on top, focused, then the list of types. Typing a
  name and picking a type creates the property with that name; Enter in the field creates a Text
  property with that name; ArrowDown moves into the list. With the field empty, the property is
  named after its type in the user's language (as today, but translated).
- The relation path keeps working: a typed name wins over the target database's title. The
  formula path opens the formula editor as today, with the typed name.
- After the property is created in a table, the new column scrolls into view.
- Copy, in a new `src/renderer/src/database/copy.ts` with a `useDatabaseCopy()` hook (the same
  shape as `dateCopy.ts`):
  - field placeholder and label: "Property name" / "Nome da propriedade"
  - list header: "Type" / "Tipo"
  - hint under the field: "Enter adds a text property" / "Enter cria uma propriedade de texto"
  - popover label: "Add a property" / "Adicionar uma propriedade"
  - type names: Text / Texto · Number / Número · Select / Seleção única · Multi-select / Seleção
    múltipla · Date / Data · Checkbox / Caixa de seleção · URL / URL · Created time / Criado em ·
    Last edited time / Última edição · Relation / Relação · Rollup / Agregação · Formula / Fórmula

**Out of scope.** Renaming headers in place (B2); translating `PropertyMenu` (B3) or the rest of
the database UI; changing `TYPE_LABELS` in shared code (main uses it for Markdown and the AI).

**Touches.** `src/renderer/src/database/propertyMenus.tsx` (`AddPropertyMenu` only), new
`src/renderer/src/database/copy.ts`, `views/TableView.tsx` (scroll the new column into view, via
`onAdded`), a new test file next to them, new `e2e/screens/scenarios/database-menus.ts`.

**Done when.** A happy-dom test opens `AddPropertyMenu`, types "Budget", picks Number, and finds a
Number property named "Budget" in the schema; Enter with "Notes" adds a Text property "Notes";
an empty field with locale `pt-BR` adds "Número"; the relation path with a typed name keeps it.
axe finds nothing serious in the open menu (as `TableView.a11y.test.tsx` does).
Screens (S0; added by this item in a new `e2e/screens/scenarios/database-menus.ts`, both themes): `add-property-empty` (the table's "+" menu just
opened: name field focused, types below, no hint), `add-property-typed` ("Budget" typed, hint
shown), `add-property-pt` (the same with locale pt-BR), `add-property-added` (after Enter: the new
column scrolled into view, its first cell active).

**Design.** _(sel-designer)_ Flow today: "+", type, click the header again, type the name,
Enter or click away: 3 clicks + typing. New: "+", type the name, Enter (text) or click a type:
1–2 clicks + typing. Same on a row page and in the properties panel.
- **Layout** mirrors `PropertyMenu` exactly, so adding and editing look like one thing: the name
  field in `.db-prop-menu-name` with `.ui-input`, focused, then the menu header "Type" / "Tipo" and
  the types with their icons. The hint "Enter adds a text property" / "Enter cria uma propriedade
  de texto" is a single line in `--text-xs`, `--text-tertiary`, under the field and shown **only
  once something is typed** (an empty field explains nothing and should say nothing).
- **Keys.** Enter in the field: Text with that name; on an empty field Enter moves into the list
  (as ArrowDown) instead of adding an unnamed Text. ArrowUp on the first type goes back to the
  field. Esc closes and creates nothing. The typed name never filters the type list.
- **After adding** in a table, the new column scrolls into view and the grid's active cell goes
  to its first row (the "+" button keeps focus when there are no rows), so the next keystroke
  edits it. Announced: "Added {name}" / "Propriedade {name} adicionada".
- **States.** A name that exists already gets " 2" as `uniqueName` does today, silently. Long
  names are capped by `L.MAX_NAME_LENGTH` (the field's `maxLength`, as in `PropertyMenu`).
  Relation: the picker replaces the list as today and the typed name is kept; formula: the
  editor opens with it.
- **Copy** as in Scope, plus "Added {name}" / "Propriedade {name} adicionada". pt-BR type names:
  I'd say "Seleção única" rather than "Seleção" so it reads apart from "Seleção múltipla", and
  "Última edição" rather than "Editado em" (a column header, not a sentence); the rest is right.

### B2. Table headers: keyboard, insert left or right

**Today.** In `src/renderer/src/database/views/TableView.tsx` a header (`.db-th`, role
`columnheader`) opens `PropertyMenu` on click or right-click; it is draggable and resizable but
cannot be reached by keyboard: the grid's active cell (`aria-activedescendant`) moves only among
body cells. There is no way to add a property at a given place; a new one always lands at the
end, and moving it is a drag.

**Scope.**
- Renaming stays as it is: one click on a header opens `PropertyMenu` with the name field
  focused and selected (ruled 2026-10-23: no double-click rename, no header tooltip; a
  double-click would open and then close the menu, since a click toggles it).
- Keyboard: ArrowUp from the first row moves the grid's active descendant to that column's
  header; ArrowDown goes back; Left/Right and Home/End move along the headers, ending on the "+"
  header; Enter, Space, F2, Shift+F10 or the Menu key open the property menu (name focused, so F2
  is rename); Esc in the menu returns the active descendant to the same header. The active header
  shows the grid's focus ring. F2 is listed in `PAGE_KEYS` and the shortcuts screen. The header
  row is announced as headers, as today.
- `PropertyMenu` gains "Insert left" and "Insert right" (under Type and format, before the sort
  group, with a separator) when opened from a table header: each turns the same popover into B1's
  `AddPropertyMenu` anchored on the header, and the new property is placed on that side of this
  one in this view (`L.moveVisibleProperty`), in one undo step; it scrolls into view and is
  announced with B1's "Added {name}".
- Copy (in `database/copy.ts`): "Insert left" / "Inserir à esquerda"; "Insert right" / "Inserir à
  direita".

**Out of scope.** Rename by double-click or in the header itself; a header tooltip; the same in
Board, List or Gallery views; "Duplicate property"; translating the rest of `PropertyMenu` (B3).

**Touches.** `src/renderer/src/database/views/TableView.tsx`, `views/TableView.a11y.test.tsx`,
`propertyMenus.tsx` (only the two insert entries in `PropertyMenu` and the prop that tells it
it was opened from a table), `database/copy.ts` (keys added), `database.css` (focus ring on the
active header), `src/shared/shortcuts.ts` (`PAGE_KEYS`, F2), `e2e/screens/scenarios/database-menus.ts`.

**Done when.** Tests (happy-dom) in `TableView.a11y.test.tsx` or a sibling: ArrowUp from the
first row reaches the header and Enter opens its menu with the name field focused; F2 does the
same; Esc returns to the header; End reaches the "+" header; "Insert left" on the second column adds a property that sits between the first and
second in the view's order; one undo removes it. axe finds nothing serious.
Screens (S0; added by this item to `e2e/screens/scenarios/database-menus.ts`, both themes): `table-header-focus` (ArrowUp from the first row:
the header's focus ring), `property-menu-insert` (a header's menu showing "Insert left" and
"Insert right"), `property-menu-insert-pt` (the same, locale pt-BR).

**Design.** _(sel-designer)_ **Scope change: drop the double-click rename and its tooltip.**
`PropertyMenu` already opens with the name field focused and selected, so renaming is click,
type, Enter: one click. A double-click would first open that menu and then close it on the
second click (the header toggles it), a flicker for no saving; and a tooltip on every header that
explains clicks is exactly the kind of thing sel should not show. Keep what Érik is missing:
- **Keyboard into the headers**, as scoped: ArrowUp from the first row reaches the header of that
  column, ArrowDown goes back, Left/Right and Home/End move along, ending on the "+" header.
  Enter, Space, F2, Shift+F10 or the Menu key open `PropertyMenu` (name already focused, so F2 is
  "rename" without a second component). Esc returns the active descendant to the same header. The
  active header shows the grid's usual focus ring (`--focus-ring`). F2 goes in `PAGE_KEYS` and the
  shortcuts screen, per the conventions.
- **Insert left / Insert right** sit right under the Type (and format) entries, before the sort
  group, with a separator. Choosing one turns the same popover into B1's add menu, anchored on the
  header (no second popover on top): click, Insert right, type the name, Enter: 2 clicks + typing,
  instead of add at the end and drag across. The new column scrolls into view and takes the
  active cell as in B1.
- Reader: headers keep `role="columnheader"`; announcement on insert reuses B1's "Added {name}".
- **Copy**: "Insert left" / "Inserir à esquerda", "Insert right" / "Inserir à direita". The
  tooltip key and its pt-BR line go away.

### B3. Edit select options from the column

**Today.** A select or multi-select property's options (name, colour, order) can be edited only
from a cell's option picker (`SelectEditor.tsx`, `OptionEditPane`) or a board group
(`views/BoardView.tsx`). `PropertyMenu` in `src/renderer/src/database/propertyMenus.tsx` does not
list them. There is no way to reorder options except by creating them in order: there is no
`moveOption` in `src/shared/database/mutations.ts` or `src/renderer/src/database/actions.ts`
(`addOption`, `updateOption`, `deleteOption` exist). `PropertyMenu`'s words are English only.

**Scope.**
- For `select` and `multi_select`, `PropertyMenu` shows an "Options" section under the name: each
  option as its coloured tag; clicking one opens `OptionEditPane` in the same popover (rename,
  colour, delete), with Back; a field "Add an option" at the end (Enter adds, keeps focus for the
  next); drag handles reorder, and Alt+ArrowUp/ArrowDown on a focused option moves it.
- A pure `moveOption(schema, propertyId, optionId, toIndex)` in
  `src/shared/database/mutations.ts`, with an action in `actions.ts`. The order is the one boards
  and pickers already show (the `options` array).
- Every string of `PropertyMenu` goes through `database/copy.ts` (en and pt-BR), so the menu is in
  one language: "Type: {type}" / "Tipo: {type}", "Number format" / "Formato do número", "Number"
  / "Número", "Percent" / "Porcentagem", "Currency" / "Moeda", "Edit formula…" / "Editar
  fórmula…", "Sort ascending" / "Ordenar crescente", "Sort descending" / "Ordenar decrescente",
  "Filter" / "Filtrar", "Hide in view" / "Ocultar nesta visualização", "Delete property" /
  "Excluir propriedade", the relation and rollup entries ("Related to: {name}" / "Relacionada a:
  {name}", "Limit: 1 page" / "Limite: 1 página", "Limit: no limit" / "Limite: sem limite",
  "Two-way: show on {name}" / "Duas vias: mostrar em {name}", "Relation: {name}" / "Relação:
  {name}", "Property: {name}" / "Propriedade: {name}", "Calculate: {fn}" / "Calcular: {fn}",
  "Rows: {rule}" / "Linhas: {rule}"), and the new "Options" / "Opções", "Add an option" /
  "Adicionar uma opção", "Move {name}" / "Mover {name}". With no options, the section is the add
  field alone (no empty-state line; ruled 2026-10-23).

**Out of scope.** `OptionEditPane`'s own words and the cell picker (stay as they are);
`AddPropertyMenu` (B1); the insert entries (B2).

**Touches.** `src/renderer/src/database/propertyMenus.tsx` (`PropertyMenu` and its helpers
`relationItems`, `rollupItems`, `rollupRowsItem`), `SelectEditor.tsx` (only if `OptionEditPane`
needs a prop to sit in this popover), `src/shared/database/mutations.ts` (`moveOption`),
`src/renderer/src/database/actions.ts`, `database/copy.ts` (keys added), `logic.test.ts` or a
mutations test, a new component test, `e2e/screens/scenarios/database-menus.ts`.

**Done when.** A pure test of `moveOption` (first to last, last to first, unknown id unchanged);
a happy-dom test opens the property menu of a select, adds "Groceries", renames it, moves it to
the top with Alt+ArrowUp, deletes it, and checks the schema after each step; with locale `pt-BR`
the menu shows "Excluir propriedade" and no English entry. axe finds nothing serious.
Screens (S0; added by this item to `e2e/screens/scenarios/database-menus.ts`, both themes): `property-menu-options` (the Priority column's
menu with its Options list and the add field), `property-menu-options-long` (a select with 9
options, the list scrolling, one long name with ellipsis), `property-menu-option-edit` (an
option's edit pane with Back), `property-menu-options-pt` (the menu with locale pt-BR).

**Design.** _(sel-designer)_ Flow today: open a cell, open its picker, open an option: 3
clicks before editing one, and no reordering. New: click the header, click the option: 2 clicks;
reorder by drag or Alt+arrows on the list right under the name.
- **Layout.** Order inside `PropertyMenu`: name field; the "Options" / "Opções" header (same
  style as menu headers); the options as a vertical list, each one its coloured tag (`--c-<name>`
  on `--c-<name>-bg`, as in cells) on a `--row-height` row, `--bg-hover` on hover; the handle ⋮⋮
  in `--text-tertiary` appears only on hover or focus; then the "Add an option" field; then the
  rest of the menu (Type…, sort, delete). At most 6 option rows show, the list scrolls inside
  itself, and the add field stays visible under it. Long names: one line, ellipsis, full name in
  `title`.
- **Empty state** is the add field alone with its placeholder: drop "No options yet" (the field
  already says what to do; two lines for one thing is noise).
- **Editing.** Clicking an option swaps the popover content for `OptionEditPane` with a Back
  button at top left (Esc there means Back, not close everything). After delete, Back is implied:
  the list returns with focus on the next option.
- **Keyboard and reader.** The list is one Tab stop (roving tabindex, `role="list"`, items with
  `aria-posinset`/`aria-setsize`); Up/Down move, Enter opens the pane, Alt+ArrowUp/ArrowDown move
  the option and keep focus on it. Handles are `tabIndex={-1}` with `aria-label` "Move {name}" /
  "Mover {name}". Announced after a move: "{name}, position {n} of {total}" / "{name}, posição {n}
  de {total}"; after adding: the new tag appears and focus stays in the field (no announcement
  beyond the field being cleared; the list's size changes).
- **Copy** as in Scope, plus "Back" / "Voltar" and the move announcement above; drop "No options
  yet" / "Nenhuma opção ainda". Check: "Ocultar nesta visualização" is long for a menu row; "Ocultar
  na visualização" reads the same and fits better.

## Epic C — Housekeeping: the development toolchain

Dependabot opened four pull requests against `main` (#75–#78). The team does not merge into
`main`; these items land the same versions on `release/0.9.0`, and Dependabot closes its PRs when
the release reaches `main`. Every package below is a `devDependency` (`package.json`): the two
runtime `dependencies`, `better-sqlite3` and `electron-updater`, are untouched, and Electron
stays on major 44. No item here is blocked by skill rule 3.

### C1. Patch and test-library bumps (#77, #78, Electron from #75)

**Today.** `package.json`: `react` and `react-dom` ^19.3.0, `happy-dom` ^20.14.5 (used by the
component tests), `electron` ^44.7.0. Dependabot offers react 19.3.1 (#77), happy-dom 21.0.3 with
a security fix (#78), and electron 44.9.0 (#75, together with electron-vite 6, which is C2).

**Scope.** Update `react`, `react-dom` (and their `@types` if needed) to ^19.3.1, `happy-dom` to
^21.0.3 and `electron` to ^44.9.0 in `package.json` and `package-lock.json` with
`npm install --ignore-scripts`; fix any test that happy-dom 21 changes; confirm
`electron.vite.config.ts`'s `CHROME_TARGET` and `NODE_TARGET` still match Electron 44.9
(`process.versions` from its release notes) and change them only if they differ.

**Out of scope.** electron-vite, vite, @vitejs/plugin-react, vitest (C2).

**Touches.** `package.json`, `package-lock.json`, tests that break under happy-dom 21,
`electron.vite.config.ts` only if the targets moved.

**Done when.** typecheck, lint and the whole suite green on Node 24; `npm run build` succeeds
locally (CI does not build); the PR lists the Dependabot PRs it supersedes and what changed in
happy-dom's behaviour, if anything.

### C2. Build toolchain majors (#76, electron-vite from #75)

**Today.** `vite` ^7.3.7, `@vitejs/plugin-react` ^5.2.0, `electron-vite` ^5.0.0, `vitest` ^5.0.4.
`electron.vite.config.ts` relies on the build's options: `minify: 'esbuild'`, a vendor chunk
regex (`VENDOR_RE`), the plugins `sel:dev-csp` and `sel:katex-woff2-only`, and the Electron
target pinning. Dependabot offers vite 8.3.4, plugin-react 6.1.2, vitest 5.0.5 (#76) and
electron-vite 6 (#75).

**Scope.** Upgrade the four together; adapt `electron.vite.config.ts` and `vitest.config.ts` to
any changed option (for example if vite 8 no longer minifies with esbuild, use its default
minifier) while keeping what each option is there for: minified, source-map-free production
output; the dev-only CSP relaxation; KaTeX woff2-only; the vendor chunk; the Electron target
check.

**Out of scope.** New build features; changing what ships.

**Touches.** `package.json`, `package-lock.json`, `electron.vite.config.ts`, `vitest.config.ts`.

**Done when.** typecheck, lint and the suite green on Node 24; `npm run build` succeeds and the PR
shows the size of `out/` before and after, the vendor chunk still present, no `.map` files, and
`out/renderer/index.html` still carrying `connect-src 'none'`. If the upgrade cannot keep one of
those, the item stops and says so instead of merging.

## Waves

| Wave | Items | Why (dependencies, overlapping "Touches") |
|---|---|---|
| 0 | S0 | Érik asked for it first, before any visible item. It adds `@playwright/test` to the package files, which C1 and C2 also edit, so it runs alone. Its PR waits for Érik's OK (rule 3, workflows); see Risks for what happens if it is not merged |
| 1 | A1a · B1 · C1 | Visible items (A1a, B1) start once S0 is merged, so their PRs get screenshots; C1 is not visible and does not depend on S0: it runs after S0 is built, not beside it (same package files), and if S0 is still waiting for Érik, C1 merges first and S0's branch refreshes its lock file. A1a lays the column model the other A items build on; B1 creates `database/copy.ts`; C1 is the low-risk dependency step. Disjoint files: editor/ + versions/; database/propertyMenus.tsx (AddPropertyMenu), copy.ts, TableView.tsx (`onAdded` only); package files |
| 2 | A1b · B3 · C2 | A1b needs A1a's `canShareRow` and repair; B3 edits `PropertyMenu` and `copy.ts` after B1; C2 edits the package files after C1. A1b touches editor drag files, B3 database menus and shared mutations, C2 the build config: no overlap |
| 3 | A1c · B2 | A1c needs A1a's rows and touches `structure.ts` after A1b; B2 adds to `PropertyMenu` and `copy.ts` after B3 and edits `TableView.tsx` after B1 |

Every visible item (A1a, A1b, A1c, B1, B2, B3) depends on S0 being merged into `release/0.9.0`:
a `pull_request` workflow runs from the PR's merge ref, so an item PR gets screenshots only once
the job is on its base. The A items add scenarios to `e2e/screens/scenarios/columns.ts` and the B
items to `database-menus.ts`, one wave after the other, so no two items running together edit
the same scenario file. C1 and C2 are not visible and do not depend on S0.

## For other people

_(sel-growth)_ This is a polish release, so this section adds no plan item. The words below are
written during CLOSE, after the waves merge, so that the README and the site never name something
the branch does not have. Anything an item drops is left out.

- **README.** Under "Organise", the sentence "Charts and other database blocks can sit side by
  side: choose 'Place beside the previous block' from a block's menu" becomes true of every block.
  Move it to "Write" as one sentence covering the block menu, dragging to the side and `/2 columns`.
  Also add one sentence on adding a property with its name, inserting it left or right, and editing
  a select's options from its column. "Keys" stays as it is, because F2 on a header is a table key
  and is listed on the shortcuts screen. "Run it" and "Get it" do not change: Windows only, not
  code-signed, Node 24. Step 1 of "Releasing" already asks for this README update.
- **site/index.html.** The Databases line "Charts can sit side by side with other blocks" /
  "Gráficos podem ficar lado a lado com outros blocos" becomes true of every block, in both
  languages. If `columns.webp` exists by CLOSE, it goes in the Write group of the screenshot
  switcher. No layout change.
- **Release notes** (release PR body, for users, by theme):
  1. "Put anything side by side": columns, by menu, drag or `/columns`.
  2. "Shape a database in fewer clicks": the name as you add a property, headers from the
     keyboard and insert left or right, a select's options in its column menu, and those menus
     in Portuguese.
  3. "Under the hood": Electron 44.9 is the runtime that gets installed. For people building from
     source, vite 8, electron-vite 6 and vitest 5.0.5 mean running `npm install` again after
     pulling.
  
  A pt-BR section is added only if sel-pm asks for one.
- **Screenshots** (`docs/screens/`). Two new images:
  - `columns.webp`: a page with a short note beside a to-do list, and a three-column row under it.
  - `property-menu.webp`: a select's column menu with its Options list and the name field.

  `blocks.webp` should be re-shot only if the slash menu's first screen now shows the column items.
  None of these can be made in the cloud. Once S0 is merged they come from its job on the Windows
  runner (scenarios `columns-two` and `property-menu-options`, light theme), converted to webp in
  CLOSE. The job's window shows a seeded workspace and may be framed differently from the
  hand-taken images; if they look out of place, or S0 is not merged, they go in the state's
  "Screenshots for Érik" list with what to set up for each. Until they exist, the README describes
  the features in text only. _(updated by sel-pm when S0 was added)_
- **First run.** Nothing changes. There is no new screen and no change to onboarding or the
  templates (the gallery and list beside it in the kitchen template are already a database row).
  A newcomer finds columns through the `/` menu, which is the path they already know, so the
  slash items are where the feature is discovered.
  - The B3 empty state is only the add field, and that is enough.
  - A pt-BR newcomer will still see a mostly English block menu with two Portuguese entries.
    That is already under Risks and is planned for 0.11.0.
- **Issue templates and contributor docs.** `.github/` has no `ISSUE_TEMPLATE/`, no
  `CONTRIBUTING.md` and no PR template. In-app feedback (`Ctrl+K`, "Say what's wrong") is
  the reporting path the README describes. The roadmap places the contributor guide in 0.13.0
  ("Ready for another developer"). That is when the issue templates (bug report and feature
  request, plus a `config.yml` that points app users to in-app feedback) and `CONTRIBUTING.md`
  should come. Nothing is added in 0.9.0.

## Risks

- **S0 not OK'd, or not working.** S0 changes `.github/workflows/`, so it merges only on Érik's
  word (rule 3), and its first real run happens only on CI. If it is not merged by the night wave
  1 would start, C1 and C2 go on; the visible items wait **one** night, then build anyway: each PR
  keeps its `screens` block (so it is captured as soon as S0 lands) and its scenarios are listed
  with what to set up in the state's "Screenshots for Érik", as before. If the harness is not on
  the release branch yet, the item writes its scenario ids and descriptions in the PR, and the
  scenario code is added right after S0 merges. CLOSE runs the full set (`all`) either way.
- **The demo is not Érik's workspace.** Screens show a seeded, English workspace at 1280×800 on a
  Windows runner, not his data or his DPI. Good enough to judge layout, copy and theme; the
  designer still flags anything that depends on real content (long titles, many rows) by adding
  a scenario for it.
- **`team/screens` grows.** Every push of a visible PR adds a commit of PNGs to the orphan
  branch. It is never merged and can be deleted at any time; the job recreates it.

- **Reading the pain wrong.** "Multi-column page layout does not work" is read as "only databases
  can sit side by side". If Érik meant something else (column widths, full-width pages), his
  `/veto A1a` in the window costs nothing yet.
- **Columns change how typing feels.** A1c changes Enter, Backspace and Tab only inside a row;
  every existing structure test must pass unchanged, and the reviewer checks it on the built app.
- **Other writers do not repair rows.** Sync merges, the persona's Apply and Markdown import do
  not run A1a's repair; at worst a block shows in an unexpected row and the block menu fixes it.
  Nothing is lost.
- **CI does not build the app.** C2 could pass CI and still break `npm run build`; its "Done when"
  asks for a local build and output checks.
- **Electron 44.9 ships to users.** It is a minor update inside the pinned major, so allowed, but
  it changes the runtime Érik installs; the release notes say so.
- **Mixed languages for pt-BR users.** The block menu gets two Portuguese entries among English
  ones until 0.11.0 translates the editor; the database property menus become fully bilingual.

## Delivered

_(filled in CLOSE)_

## Left for later

_(filled in CLOSE)_
