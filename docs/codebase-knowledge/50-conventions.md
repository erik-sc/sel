# Conventions ("plans" this project uses)

## Naming

- IPC invoke channels are `namespace:method`, nested with a dot, and name the method's place on `window.api`: `api.briefing.calendars.list` answers on `briefing:calendars.list` (src/shared/ipc.ts:1-10). Each is declared once, in its feature's fragment of `INVOKE` (src/shared/api.ts; see "Adicionar uma feature").
- Settings keys are `area.key` (src/shared/ai.ts:142, src/shared/herman.ts:143-145); the pattern is enforced by a regex (src/main/validate.ts:29).
- Main-process feature folders use `register.ts` (handlers, loaded at start-up), `index.ts` (the lazy `*Bridge`), `service.ts` (Electron-free) (src/main/briefing/register.ts:9-12, src/main/briefing/index.ts:36-55, src/main/briefing/service.ts:81).
- Renderer features expose `gate.ts` (always loaded), `Host.tsx` (mount point) and lazy chunks (src/renderer/src/ai/gate.ts:1-3, src/renderer/src/ai/Host.tsx:8-19).
- Renderer start-up functions are `initX` (async, idempotent) and `bootX` (synchronous, from the mirror) (src/renderer/src/main.tsx:35-50).
- Lazy components export a matching `preloadX` (src/renderer/src/editor/lazy.tsx:7-22).
- Test support files are named for their role: `testing.ts`, `harness.ts`, `*.suite.ts`, `fixtures/` (src/main/db/testing.ts:12, src/main/sync/harness.ts:1-5, src/main/briefing/ical.suite.ts:44).
- Commit subjects are plain imperative sentences describing user-visible behaviour (commit 9c93ac1, commit 18fd2a0).

## Layering rules

- The renderer reaches main only through `window.api` (src/preload/index.ts:112).
- Paths never come from the renderer; they come from native dialogs in main (src/main/ipc.ts:125, src/main/sync/index.ts:275-295, src/main/ai/index.ts:225-255).
- Pure modules carry a header comment saying they are free of Electron, React or the store (src/shared/database/mutations.ts:1-2, src/main/briefing/secrets.ts:21, src/main/meetings/grant.ts:5).
- zustand stores hold state only; mutations are free exported functions (src/renderer/src/store/tabs.ts:48, src/renderer/src/store/ui.ts:64).
- Database code is consumed from outside through `@/database/lazy` (src/renderer/src/editor/BlockView.tsx:7, src/renderer/src/shell/PageHost.tsx:5).
- Main imports shared by relative path; preload and renderer use the `@shared` and `@` aliases (src/main/validate.ts:1, src/preload/index.ts:2, src/renderer/src/App.tsx:2).
- Migrations are append-only (src/main/db/schema.ts:4-7).

## Adicionar uma feature

Since 0.7.0 (item 2) a feature lives in its own folders, one per process, and joins the app with
one line in each list of features. Nothing central has to be edited by hand beyond those lines,
and typecheck or a test fails when one is missing. The feature that does not exist,
`fake` (src/shared/fake, src/main/fake, src/renderer/src/fake), is written this way, and its tests
(src/main/fake/fake.test.ts, src/renderer/src/fake/fake.test.ts) add it to every list and check that
its call, setting, command and screen work from that alone.

Say the feature is `garden`, with a call, a setting, a command and a screen:

| What | In the feature's folder | The one line, in the list |
|---|---|---|
| Its contract | `GardenApi` in src/shared/garden.ts | `garden: GardenApi` in `Api` (src/shared/api.ts) |
| Its calls | `GARDEN_INVOKE = { 'garden:plant': true } as const satisfies Record<InvokeChannels<{ garden: GardenApi }>, true>` next to `GardenApi` | `...GARDEN_INVOKE` in `INVOKE` (src/shared/api.ts) |
| The bridge's review | src/preload/reviewed/garden.ts, the channels written out (`REVIEWED`) | none: the preload test reads the folder |
| Its handlers | `gardenFeature = defineFeature({ namespace: 'garden', register(ctx) { … } })` in src/main/garden/register.ts | `gardenFeature` in `FEATURES` (src/main/features.ts) |
| Its settings | `GARDEN_SETTINGS: SettingsSpec` (`keys`, `clean`, `dialogOnly?`, `syncedAt?`) in src/shared/garden.ts | `GARDEN_SETTINGS` in `SETTINGS` (src/shared/settings.ts) |
| Its commands | `GARDEN_COMMANDS` (`id`, `shortcut`, `menu`, `palette`, `catalog`) in src/shared/garden.ts | `...GARDEN_COMMANDS` in `COMMANDS` (src/shared/commands.ts) |
| What they do, its start-up, its overlays | `gardenFeature = defineFeature({ id, menu, init?, idle?, overlays? })` in src/renderer/src/garden/feature.ts | `gardenFeature` in `FEATURES` (src/renderer/src/features.ts) |
| Its screen's route | none | `GARDEN_ROUTE = '_garden'` in src/renderer/src/routes.ts |
| Its screen | `GARDEN_SCREENS` (`route`, `title`, `alias?`, `Host: lazy(…)`) in src/renderer/src/garden/screens.ts | `...GARDEN_SCREENS` in `SCREENS` (src/renderer/src/screens.ts) |
| Its section of Settings | `GARDEN_SECTION = settingsSection({ id, label, keywords, order, Section: lazyPanel(…) })` in src/renderer/src/garden/settingsSection.ts | `GARDEN_SECTION` in `LISTED` (src/renderer/src/shell/settingsSections.ts) |

What fails when a piece is missing:

- A method of `GardenApi` without its channel, or a channel without a method: the fragment's own
  `satisfies` (a spread into `INVOKE` would let a channel too many through), then `INVOKE`'s.
- A channel without a handler: `Handlers<'garden'>` in `Registered<'garden'>`; a namespace no
  feature answers: `EVERY_NAMESPACE_ANSWERED` in src/main/ipc.ts.
- A channel not written in src/preload/reviewed/: src/preload/index.test.ts. A change there changes
  what a renderer can reach, and is reviewed as such.
- A command without a handler in any renderer feature: `EVERY_COMMAND_HANDLED` in
  src/renderer/src/shell/menuCommands.ts. Two commands on the same keys: src/shared/shortcuts.test.ts.

The rules the lists keep:

- **Registries are leaf data.** A screen's `Host`, a section's panel and an overlay are lazy imports:
  the lists are loaded at start-up, a component only when it is first drawn. Never import a Host or
  a Settings component statically from a list or from a feature's `feature.ts`.
- **Places are numbers.** A command's `menu.order` has its group in the hundreds (a separator goes
  between groups), `palette.order` places it among the built-in commands when there is no query,
  `catalog.order` among its group's lines on the shortcuts screen; Settings sections and overlays
  have an `order` too. Ten apart, so one fits between two.
- **A feature uses another through `ctx.feature('<namespace>')`** in main (src/main/feature.ts),
  when it is used rather than while registering; only a feature listed earlier exists while
  registering (the Sky listens to the pomodoro, so it comes after it).
- **What changing a setting does** in main is the feature's `onSettingChanged(key)`; every key
  reaches every feature. A setting that syncs names its `sync.*At` stamp in `syncedAt`.
- **Kept central, on purpose:** the order of the sidebar's items (`SIDEBAR_ITEMS`,
  src/shared/sidebar.ts), sync's `PATHS` (src/main/sync/format.ts) and `STATE_*` keys (src/main/sync/engine.ts), and the screens that
  can be the home (`HOME_SCREENS`, src/shared/home.ts): they are stored or synced, so their order
  never changes.
- **Not invoke calls**, still written by hand in src/preload/index.ts: events (`on*` methods that
  return an unsubscribe function, their channel constant with the feature, e.g. `SYNC_CHANNEL`),
  fire-and-forget sends (`IPC.window*`, `MEETINGS_CHANNELS.frames`) and plain values (`clientId`,
  `app.platform`), with `ipcMain.on` in main. A `MenuCommand` is not an IPC call: it travels on
  `event:command`.

Adding one call to an existing feature is the first rows only: the method in its contract, the
channel in its fragment and in src/preload/reviewed/<namespace>.ts, the handler in its main side.
Arguments arrive as `unknown`: narrow them with `arg.*` (src/main/validate.ts) or in the service.
The wrapper in src/main/ipc.ts already checks the sender and the client id, waits for `ready`,
drains changes and reduces errors; nothing calls `ipcMain.handle` by itself.

## Teclado e leitor de tela

Since 0.7.0 (item 4): what lists, popovers and dialogs do with the keyboard and say to a screen
reader. New lists follow it (the task rows of 9b), and so do the windowed database views (item 7).
The helpers are in src/renderer/src/a11y/: `keys.ts` (keys), `announce.ts` (the live region) and
`copy.ts` (what it says, pt-BR and en).

**Lists of things you open** (the page tree, the tab strip, board cards, calendar days and events):

- **One Tab stop per list** (roving tabindex). The item focused last has `tabIndex={0}`, every other
  `-1`. While no item is the stop (none focused yet, or that one went away), the list itself is,
  and hands the focus on (`useTreeEntry` in src/renderer/src/shell/PageTree.tsx). A board has one
  stop per column, a calendar one per month (its focused day, whose events Tab then reaches).
- **Small buttons inside an item** (expand, "⋯", close) are `tabIndex={-1}`: for the pointer. The
  keyboard does what they do with keys and the item's menu.
- **Arrows** move along, Home and End go to the ends, nothing wraps (`rovingTarget`,
  `moveFocusAmong`). Enter opens; Ctrl+Enter opens in a new tab.
- **The item's menu** opens with the Menu key or Shift+F10, under the item: `takeMenuKey(event)`
  on keydown, `keyboardAnchor(el)` as the popover's anchor. Windows sends a `contextmenu` after
  the Menu key: `onContextMenu` ignores it while `isMenuKeyEcho()`.
- **Moving an item** from the keyboard: Ctrl+Alt+arrows on a board and in a calendar, Alt+Shift+
  arrows in the tree, Ctrl+Shift+PageUp/PageDown on tabs, plain Alt+arrows in a list inside a
  popover (a select's options in its column menu, src/renderer/src/database/optionList.tsx; the
  sidebar settings). It calls what dragging calls
  (`moveCard` in BoardView.tsx, `moveEvent` in CalendarView.tsx, `dropPage`, `moveTab`), says where
  the item went with `announce()`, and keeps the focus on it: the item is drawn again in its new
  place and focused by its id (`data-card-id`, `data-event-id`, `data-tab-id`, the tree's `pending`).
  The time blocks of Today's plan (briefing/DayPlan.tsx) are the exception that has room for it:
  plain arrows move a focused block by a quarter hour, Shift+arrows change its length, Delete
  takes it off the plan, and a "Schedule…" form puts a task on it without a pointer.
- **Roles**: `list` and `listitem` (board columns and cards, a calendar day and its events),
  `tree`/`treeitem` with `aria-level` and `aria-expanded`, `tablist`/`tab`. A list with nothing in
  it gets no list role: an empty `listbox` or `list` is an error to axe and says nothing.
- **New keys** go in `PAGE_KEYS` (src/shared/shortcuts.ts), which src/shared/shortcuts.test.ts checks
  against the app shortcuts (main sees every key first and would keep one that matched), and in
  the shortcuts screen (src/renderer/src/shortcuts/catalog.ts).
- **Windowed** (item 7): the focused item is never left out of the window, or the focus falls to
  `<body>` and the place is lost. Lists, galleries and board columns of 200+ items window with
  `useItemWindow` (src/renderer/src/database/views/windowing.ts): pass the focused item, the
  list's Tab stop and the item being edited as `pinned`. A key that moves the focus to an item
  that is not drawn makes it the focused one first and focuses it once drawn (`focusCard` in
  BoardView.tsx). Items say their place with `aria-posinset`/`aria-setsize`.

**Grids** (the table, src/renderer/src/database/views/TableView.tsx): the grid element holds the
focus and points at the focused cell with `aria-activedescendant` (`cellId` in TableRow.tsx), only
while its row is drawn. Rows carry `aria-rowindex` (the header row is 1), cells `aria-colindex`,
and `aria-rowcount` counts every row of the view, drawn or not. Since 0.9.0 (B2) the headers are
active descendants too (`headerId` in TableView.tsx; a cell and a header are never active
together): ArrowUp from the first row goes to the column's header, Left/Right/Home/End move along
the headers and end on "+", ArrowDown goes back, Enter, Space, F2, Shift+F10 or the Menu key open the header's
`PropertyMenu`, and Escape there comes back to the same header. From a table that menu also offers
"Insert left / right" (`onInsert`): the add menu takes its place on the header, and
`actions.addProperty(..., { before })` writes the new property and its place in the view's
`visibleProperties` as one write. A popover that replaces another has no opener to give the focus
back to (it read the first popover's element as it rendered), so the table takes it back itself
(`regainFocus`).

**Popovers and dialogs**:

- `Modal` takes `labelledBy`, the id of its visible title, when the title is drawn with it; `label`
  only when nothing on it says what it is (Quick find, the palette) or the title is behind
  `Suspense`.
- `Popover` is a `dialog` by default and then needs `label` or `labelledBy`; `role="none"` when all
  it holds is a `Menu` or a listbox, which name themselves.
- A `Menu` keeps the focus on itself and points at its items with `aria-activedescendant`
  (src/renderer/src/ui/Menu.tsx). A field drawn above a `Menu` (the add-property menu's name) passes
  `onExitStart`, so ArrowUp on the first item gives it the focus back instead of wrapping. When
  the fields are Tab stops too (a column's menu: name, a select's options, the add-an-option field,
  then the entries; src/renderer/src/database/propertyMenus.tsx), the `Menu` is `tabbable` and the
  popover keeps Tab inside it, wrapping at both ends (`keepTabInside`). A popover whose content has a
  step to go back from (an option opened from that menu) passes `onEscape`, so Escape means Back
  there and not close (src/renderer/src/ui/Popover.tsx). A search field over a list is a `combobox` with
  `aria-controls` and `aria-activedescendant` on option ids from `useId()`; options are `option`
  with `aria-selected`, and nothing in an option takes the focus (it is read and chosen whole).
- The focus goes back where it came from: `Modal` and `Popover` do it. A screen of its own (the
  rest of Close the day, notebook/CloseDayScreen.tsx) keeps Tab on itself and does it too.

**The editor**: each block's text is a `textbox` with `aria-roledescription` (the kind of block)
and `aria-placeholder`; a heading's sits in `role="heading"` with its `aria-level`. While the slash
menu is open, the block points at its highlighted option (`slashListId`, `slashOptionId`). Moves,
indents and deletions made from the keyboard are announced by the controller. Alt+F10 goes from
selected text to its toolbar.

**Contrast**: src/renderer/src/appearance/contrast.test.ts holds every preset, light and dark, to
4.5:1 for text, secondary and tertiary text on the surfaces they are drawn on and 3:1 for the
focus ring; the few exceptions, kept for fidelity to the original, are listed there with why.

## Words (en and pt-BR)

Since 0.9.0 the menus a release touches come in English and Brazilian Portuguese, picked by the
home's locale (`useHome((s) => s.locale)`), as the date picker did first
(src/renderer/src/database/dateCopy.ts). Each area keeps its words in one plain-data module with a
hook for components and a reader for code outside React: src/renderer/src/editor/copy.ts
(`EDITOR_COPY`, `useEditorCopy`, `editorCopy`) and src/renderer/src/database/copy.ts
(`DATABASE_COPY`, `useDatabaseCopy`, `databaseCopy`). A new word goes into both languages of its
area's module, never inline in a component; what is said to a screen reader goes there too. The
rest of the editor and database UI is still English (the full translation is proposal #100,
docs/team/roadmap.md:103). A translated menu gets a `-pt` screenshot scenario (`locale: 'pt-BR'`).

## Screens

Since 0.9.0 (S0): every pull request that changes what a user sees shows it. Its body holds a
`screens` block naming scenarios, one `<id>: <text>` per line; the Screens workflow
(.github/workflows/screens.yml) captures them on the PR's head and on its merge base and posts one
comment with the pairs, light above dark, before on the left (e2e/screens/README.md).

- **Adding a scenario** is part of the item that needs it:
  1. Add an entry to the area's file under e2e/screens/scenarios/ (columns.ts, database-menus.ts,
     pages.ts, tasks.ts, today.ts, or a new file: every file there is loaded, there is no index).
     Its `id` is kebab-case and unique across files (e2e/screens/registry.ts:33); `locale`
     (`'pt-BR'` for a translated menu) and `themes` are optional; `workspace(repo, now)` adds to
     the demo workspace for that scenario only (e2e/screens/seed.ts:104).
  2. `run(page)` starts on the open app (Today, one tab) and drives it as a user would, by role
     and name (the common steps are in e2e/screens/ui.ts: `openFromSidebar`, `openPage`, `see`),
     and returns only once what should be pictured is on screen.
  3. `npm run screens:test` checks the registry (ids, shapes); `SCREENS_IDS="<id>" xvfb-run -a
     npm run screens` tries the capture on Linux (e2e/screens/README.md).
  4. Name the id in the PR body's `screens` block. A `run` that fails on base shows as "not in
     base" (the feature is new); one that fails on head turns the job red.
- **What the capture does after `run`** (e2e/screens/capture.pw.ts:118-128): it moves the pointer
  off the window, to its right edge (`mouse.move(WIDTH - 1, HEIGHT / 2)`), so no hover state is
  pictured by accident; waits for the fonts and two frames; and saves the whole window at
  1280×800 with animations disabled and the caret hidden. So a scenario cannot show a hover: show
  the state through the focus instead where the app draws it for both (`columns-hover` clicks into
  a column, so the row's `:focus-within` draws the line). And a drag made with the mouse ends when
  the pointer moves: to picture one mid-drag, dispatch the drag events the window gets from a real
  drag (`holdOnRightOf`, e2e/screens/scenarios/columns.ts:135).
- **The demo workspace** is written by the app's own `Repository` on `node:sqlite`, from fixed
  ids and English text, dated around the run's day. Base is seeded with base's own `Repository`,
  so a new migration never leaves base with a database it refuses.
- **Locally**: `npm run screens:test` runs the pure tests (block, registry, seed, comment) on
  Node 24; `npm run screens` captures, on Linux under `xvfb-run` (README). The pictures of record
  come only from the Windows job: fonts, DPI and window chrome differ elsewhere, and Windows is
  the only platform sel ships for.
- **Nothing in `src/` exists for the harness.** The window is found by role and text; reduced
  motion is emulated so Herman draws still.

## Error handling

- Renderer input is typed `unknown` and narrowed by validators that throw (src/main/validate.ts:39-57, src/main/ai/index.ts:127-128).
- Validation is done twice: shape at the IPC edge, fields again in the repository (src/main/ipc.ts:104, src/main/db/repository.ts:664-666).
- Errors crossing IPC are reduced to user-safe messages; anything with a system `code` becomes a generic message and is logged (src/main/validate.ts:170-180, src/main/ipc.ts:78).
- Expected failures are typed codes defined in shared (src/shared/sync.ts:10-29, src/shared/ai.ts:114, src/shared/briefing.ts:34); sync's public methods return a status instead of throwing (src/main/sync/engine.ts:230-237).
- Main logs with `console.error` and an area prefix such as `[main]`, `[ipc]`, `[sync]` (src/main/index.ts:163, src/main/ipc.ts:78, src/main/sync/engine.ts:362).
- Renderer: `notifyError` for things the user must know, plain `console.error` for background refreshes (src/renderer/src/ui/toast.ts:88-91, src/renderer/src/store/blocks.ts:486).
- Untrusted persisted data is sanitised on read and returned by reference when already valid, so memoisation holds (src/shared/database/normalize.ts:16, src/shared/chart.ts:60-84, src/renderer/src/store/tabs.ts:256).
- Object keys from data are guarded against prototype members (src/shared/chart.ts:42-44, src/renderer/src/store/blocks.ts:94-97).
- Child processes: no shell, argument arrays, allow-listed environment, timeouts and process-tree kill (src/main/sync/git.ts:370-378, src/main/ai/service.ts:118-148).

## Testing

- Tests sit next to the code as `*.test.ts`. vitest.config.ts resolves the `@shared` and `@` aliases, so tests import code the way the app does.
- Most renderer tests cover pure logic in Node. Components are tested in a DOM by happy-dom (dev only, like axe-core): the file starts with `// @vitest-environment happy-dom` and uses src/renderer/src/a11y/testing.tsx (`render`, `press`, `settle`, `seriousViolations`, `fakeApi`), as src/renderer/src/a11y/axe.test.tsx and src/renderer/src/database/views/TableView.a11y.test.tsx do.
- Repository tests open an in-memory database on `node:sqlite`, or better-sqlite3 when `SEL_TEST_DRIVER` says so (src/main/db/testing.ts:12-22).
- Time-zone-sensitive suites run once per zone by setting `TZ` on the first lines of a tiny test file (src/main/briefing/ical.utc.test.ts:1-4).
- External programs are replaced by scripted fakes selected with markers in the prompt (src/main/ai/fixtures/fake-claude.mjs:6-8).
- Sync tests need a real git binary and skip themselves without one (src/main/sync/harness.ts:18-24).
- Some suites are opt-in through environment flags (src/main/db/bench.test.ts:14, src/main/briefing/net.test.ts:405).
- The screenshot harness's own pure tests live under e2e/screens/ (`*.test.ts`) and run with `npm run screens:test` (`vitest run --dir e2e`), not with `npm test`.
- Before a PR: `npm run typecheck`, `npm run lint` and `npx vitest run --dir src` on Node 24 (package.json:12-14). CI runs the tests on Windows; a few suites exercise Windows paths or programs and fail on Linux (ai.test.ts, sync/security.test.ts, whisper.test.ts), so compare with the base branch before calling a failure yours.

## Configuration and feature flags

- User configuration is the `settings` table; the renderer may write only allow-listed keys and namespaces (src/main/validate.ts:35-37, src/main/validate.ts:140-143).
- Settings that steer the main process are cleaned by per-feature functions from shared (src/shared/ai.ts:168, src/shared/herman.ts:160).
- Development-only environment variables are ignored in packaged builds: `ELECTRON_RENDERER_URL` (src/main/security.ts:17-29), `SEL_AI_CLI` (src/main/ai/index.ts:41-43), `SEL_HERMAN_FAST` (src/main/herman/service.ts:56-58), `SEL_BRIEFING_LOOPBACK` (src/main/briefing/net.ts:53-55), `SEL_WHISPER_PINS` (src/main/meetings/index.ts:29-41), `SEL_UPDATE_FEED` (src/main/updates/register.ts:25).
- `SEL_TRACE_STARTUP` or `--sel-trace-startup` prints a startup timeline (src/main/trace.ts:10).
- Features are switched by settings, not build flags: `ai.enabled` and `herman.enabled` (src/shared/ai.ts:142, src/shared/herman.ts:143-145).
- The gates are typecheck, lint (Biome: `npm run lint`, `biome.json`) and tests; CI runs all three on every pull request (package.json, .github/workflows/ci.yml).

## Observed violations

| Where | Convention broken | Bug or intent? |
|---|---|---|
| src/main/background.ts:9, src/main/ipc.ts:55, src/main/sync/engine.ts:123, src/renderer/src/appearance/store.ts:28, src/renderer/src/sync/store.ts:20 | One settings key declared five times | Drift risk, not yet a bug |
| src/main/ai/service.ts:11, src/main/ai/service.ts:445 | The generic AI service imports the Herman persona and reads `herman.*` settings | Intent, but couples two layers |
| src/renderer/src/ai/client.ts:6, src/renderer/src/herman/Dock.tsx:9 | Folder cycle between `ai` and `herman` | Intent; both import only the other's gate |
| src/renderer/src/shell/SettingsDialog.tsx:6 | `appearance/controls` used as a shared UI kit by other features | Intent by convenience; belongs in `ui` |
| src/renderer/src/store/tabs.ts:30-32, src/renderer/src/briefing/route.ts:13-17 | Route constants live in the store, their predicates in a feature folder | Minor inconsistency |
| src/renderer/src/database/actions.ts:42-45 | Database edits get no undo entry, while the 0.9.0 plan asks every change to undo as one step (docs/plans/release-0.9.0.md:29) | Known gap; the actions keep each change one `applyOps` batch so a later undo can reverse it whole (question 35) |
| src/main/db/schema.ts:56 | Comment lists four version kinds; `sync` is a fifth (src/main/db/repository.ts:2004) | Stale comment |
| src/main/briefing/net.ts:8 | Comment claims to be the only network code | Stale comment |
| src/main/meetings/whisper/download.ts:7 | Binary downloads reuse `validateCalendarUrl` and `CalendarError` | Naming leak, behaviour fine |
| src/main/ipc.ts:169-172 | Two related settings written without a transaction | Probably harmless |
| src/main/sync/git.ts:444 | The auth-failure pattern ends in a bare word that could match unrelated errors | Possible misclassification (unverified) |
