# S0 research: the screenshot job

Research for item S0 of `docs/plans/release-0.9.0.md` (lines 42-170), written in the VETO phase
on 2026-10-24. Nothing in the repository was changed apart from this file. All the experiments ran
in a throwaway copy (`/tmp/s0-research`, from `git archive` of `release/0.9.0`).

**What was checked, and how.** Some things were tried on Linux: a cloud session, Node 22.23,
`xvfb-run`, Electron 44.7.0 from `node_modules`, and `@playwright/test` 1.64.0. Those are marked
**[verified]**. Things that only Windows CI or GitHub can show are marked **[assumed]**, with the
reasoning behind them.

## 0. Findings that change the plan

1. **Drop `npm run rebuild` from the build steps.** The plan says to run it (plan line 97), but
   better-sqlite3 13.0.3 ships ready-made N-API binaries for `win32-x64` and every other
   platform in `node_modules/better-sqlite3/prebuilds/`, and `lib/binding.js` loads those
   first **[verified]**. The repo already relies on this: `electron-builder.yml:19-20`
   (`npmRebuild: false`), `ci.yml:4` and `release.yml:10-12`. `electron-rebuild -f` would
   compile SQLite from source with node-gyp on the runner. That adds minutes and can break, and
   it gains nothing. The steps per checkout are `npm ci --ignore-scripts`, then
   `node node_modules/electron/install.js` (head only, see 1.4), then `npm run build`.
2. **The seed cannot import `openTestRepository`.** `src/main/db/testing.ts:16` uses
   `import.meta.url`. Playwright compiles TypeScript to CommonJS because `package.json` has no
   `"type": "module"`, so loading that file fails with "Cannot use 'import.meta' outside a module"
   **[verified]**. The seed has to do what `openTestRepository` does itself:
   `new Repository(new DatabaseSync(file), { clock })`, with `Repository` from
   `src/main/db/repository.ts` (which only imports `src/shared` and `node:` modules) **[verified]**.
3. **Seed the base side with base's own `Repository`.** If head adds a migration, base's
   `migrate` throws "Database schema version N is newer than this app supports"
   (`src/main/db/schema.ts:161-162`). `openStore` then hands over to `recoverStore` →
   `recoverDatabase` (`src/main/index.ts:331-356`), which opens a native dialog, and the launch
   hangs until it times out. The fix keeps "the seed always comes from head": the seed module
   takes the `Repository` class as a parameter, and for base it is loaded with
   `require(join(baseDir, 'src/main/db/repository.ts'))`. Loading a `Repository` from a second
   checkout inside the Playwright worker works **[verified]**. 0.9.0 adds no migration, so this
   only becomes urgent later. It is cheap to build in from the start.
4. **The comment cannot be built by code from `e2e/` in `screens-publish`.** The plan has
   `comment.ts` live in `e2e/screens/` (PR code), and `screens-publish` "checks out no PR code"
   (plan line 109). So the `screens` job (read-only token) builds `comment.md` with head's
   `comment.ts` and puts it in the artifact. `screens-publish` treats it as untrusted data:
   - it checks the markers, the signature and a size cap;
   - it checks that every image URL points at its own `team/screens` path;
   - only then does it post the comment.

   The other option, running `comment.ts` from the base branch, cannot work on S0's own PR,
   because base has no `e2e/` yet.
5. **Compare against the merge base, not `pull_request.base.sha`.** When `release/0.9.0` moves
   after a branch was cut, `base.sha` contains other items' merged work that head lacks. The
   "before" picture would then show things the "after" picture is missing. The merge base of
   head and the base branch (REST `GET /repos/{o}/{r}/compare/{base.sha}...{head.sha}` →
   `merge_base_commit.sha`, read-only token) is the true "before" for head's diff. If the lead
   prefers the plan's wording, keep `base.sha`, but expect confusing pairs late in BUILD.
6. **Use `if: !cancelled() && …` on `screens-publish`, not `if: always()`.** With
   `cancel-in-progress: true`, `always()` still runs the publish job of a run that a newer push
   cancelled. That run could then overwrite the comment with older pictures, or race the newer
   run's push.
7. **`edited` fires on every edit of the PR body, and the team edits PR bodies often.** Without a
   guard, every edit costs a 10-20 minute Windows run. When `github.event.action == 'edited'`, the
   parser compares the block in `github.event.changes.body.from` with the current one. If they are
   the same (or the body did not change), the job ends green at once.
8. **This cloud session can launch the app.** The plan's premise (line 36: cloud sessions "cannot
   launch the app") did not hold here: `npm ci`, the Electron download through the proxy, the
   build and an `xvfb-run` launch all worked, with screenshots. This is no substitute for the
   Windows job (fonts, DPI and window chrome differ), but a developer can try out scenarios
   locally on Linux before pushing.

## 1. Launching the built app with `_electron.launch`

### 1.1 Entry file and what to pass

- `npm run build` (`electron-vite build`) writes `out/main/index.js`, `out/main/mcp.js`,
  `out/main/backup.js`, `out/preload/index.js` and `out/renderer/**` (inputs at
  `electron.vite.config.ts:85-91`). `package.json` has `"main": "./out/main/index.js"`. So the
  app is launched as `.` with `cwd` set to the checkout, exactly as the plan says. Passing
  `out/main/index.js` also works, but `.` keeps `app.getAppPath()` and the package name the same
  as `electron-vite preview`.
- The window loads `out/renderer/index.html` through `win.loadFile(RENDERER_FILE)`
  (`src/main/index.ts:170-176`, `src/main/security.ts:32`). The dev URL is used only when
  `ELECTRON_RENDERER_URL` is set (`src/main/security.ts:29`). The harness must not pass it.
- **Launch the unpackaged app, never `release/win-unpacked/sel.exe`.** Playwright starts
  Electron as `electron -r <playwright>/loader.js --inspect=0 --remote-debugging-port=0 …args`
  (from `playwright-core/lib/coreBundle.js`, `Electron.launch`) **[verified by reading]**. The
  packaged app turns off Node's inspect flags with fuses (`electron-builder.yml`,
  `enableNodeCliInspectArguments: false`), so Playwright could not attach to it. Fuses are
  written only when packaging, so the `node_modules` Electron is unaffected.
- **Which Electron runs.** Without `executablePath`, Playwright uses
  `require("electron/index.js")` resolved from *its own* install, which is head's `node_modules`
  **[verified by reading]**. Base's app therefore runs on head's Electron too. That is fine in
  0.9.0, where nothing changes Electron, and it means base needs no `electron/install.js`
  (about 100 MB saved). Passing `executablePath` instead skips Playwright's `loader.js`, which
  holds back `ready` and adds its Chromium switches. Do not do that. If a future PR upgrades
  Electron, its base pictures are taken on the new Electron: say so in the comment, or accept it.
- **Isolated profile.** `--user-data-dir=<dir>` is honoured: inside the app,
  `app.getPath('userData')` returned exactly `<dir>` **[verified]**. Everything follows from
  it:
  - the database, at `join(userData, DB_FILE)` (`src/main/index.ts:324,332`;
    `DB_FILE = 'sel.db'` at `src/main/legacy.ts:5`);
  - the logs (`src/main/index.ts:493`);
  - the single-instance lock, which Electron keys on the profile directory, so launches with
    different directories do not collide **[assumed; one launch at a time was tested]**.

  `adoptLegacyProfile` returns early once `sel.db` exists (`src/main/legacy.ts:19`), so a
  seeded directory never picks up a stray `Selida` folder next to it.

Sketch of the launch (this is the shape that ran):

```ts
const app = await _electron.launch({
  args: ['.', `--user-data-dir=${dir}`, '--lang=en-US', '--force-device-scale-factor=1'],
  cwd: checkoutDir,             // head or base checkout; Playwright adds --no-sandbox on Linux itself
  env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  timeout: 60_000
})
const page = await app.firstWindow()
```

### 1.2 Window size, theme and motion

- **Size.** `createWindow` uses the stored `windowBounds` setting or `DEFAULT_SIZE` 1200×800
  (`src/main/bounds.ts:12`), limited to the largest display (`fitBounds`,
  `src/main/bounds.ts:21-25`). Windows runners have a small desktop (1024×768 by common report)
  **[assumed]**. So set the size after launch, both ways:
  `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))`,
  then `page.setViewportSize({ width: 1280, height: 800 })`. The second is CDP emulation, and it
  guarantees a 1280×800 viewport and PNG even when the OS clamps the real window. On a 1024×768
  Xvfb screen this gave `innerWidth/innerHeight = 1280/800` and a 1280×800 PNG **[verified]**.
  Add `--force-device-scale-factor=1` so the runner's DPI cannot double the size.
- **Theme.** Write the `theme` setting (`'light' | 'dark'`, `src/shared/types.ts:395`, read at
  `src/main/ipc.ts:35-38`, applied as `nativeTheme.themeSource` at `src/main/index.ts:409`) in
  the seed. A seeded `'dark'` gave a dark window from the first paint **[verified, screenshot]**.
  Do not pass Playwright's `colorScheme` launch option. Within the page,
  `matchMedia('(prefers-color-scheme: dark)')` read `false` even though the app drew dark: the
  app's look follows the stored theme, and Playwright's emulation would only confuse a theme
  set to `'system'`.
- **Motion.** `animations: 'disabled'` in `page.screenshot` stops CSS animations but not the
  Herman sprite's entrance, which was caught mid-draw in the bottom-right corner **[verified]**.
  Both Herman components read `prefers-reduced-motion` once, when they mount
  (`src/renderer/src/herman/Herman64.tsx:35,62`, `src/renderer/src/herman/Figure.tsx:31,118`).
  - The Chromium switch `--force-prefers-reduced-motion` had no effect **[verified]**.
  - What works: `await page.emulateMedia({ reducedMotion: 'reduce' })`, then `page.reload()`.
    After that, `matchMedia(...)` was `true` and Herman drew still **[verified]**. Do it once,
    straight after `firstWindow()`, before `run`.
- **Clock and language.** The runner is UTC. The seed, main and the renderer all read the same
  clock, so "today" agrees as long as the seed's `now` is taken once per job and used for both
  sides. Text that depends on the time of day ("Good evening", from main's briefing) can differ
  between base and head only when a run spans the hour where it changes; accept that. The day's
  phrase is chosen from the date (`src/main/briefing/phrases.ts:233`,
  `src/main/briefing/service.ts:312`), so both sides show the same one. Pass `--lang=en-US`, so
  that `navigator.language` does not decide the language (see 2.3).

### 1.3 When the window is ready to capture

There is no "ready" signal from the app, and `src/` stays untouched. This sequence held up
**[verified]**:

1. `await app.firstWindow()`. It came 0.5 to 1.2 s after the launch (a cold first launch was
   the slowest).
2. Wait for the window to be shown: `win.isVisible()`, or its `once('show')`. The window is
   created hidden and shown on `ready-to-show` (`src/main/index.ts:108,159-163`).
3. `emulateMedia` + `reload` (1.2), then `page.waitForLoadState('load')`.
4. Wait for the shell: the tab strip `getByRole('tab')` is visible (`Shell` renders once the
   tabs are ready, `src/renderer/src/shell/Shell.tsx`).
5. `run(page)`.
6. `await page.evaluate(() => document.fonts.ready)`, then two `requestAnimationFrame`s, then
   `page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })`.

The whole sequence took 4-5 s per capture on Linux, including the launch and two screenshots
**[verified]**. On Windows, allow about 10 s **[assumed]**. 20 captures fit in about 3-4 min.

### 1.4 Things that are not a problem

- Headless: Electron has no headless mode. Windows runners have an interactive desktop session,
  so windows render **[assumed: widely used, not tried here]**. On Linux use
  `xvfb-run -a -s "-screen 0 1600x1000x24"`.
- GPU: none on the runner. Chromium falls back to software rendering; the screenshots looked
  right under Xvfb.
- First-run noise:
  - The AI introduction opens by itself only when `ai.onboarded` is `false`
    (`src/renderer/src/ai/gate.ts:82-95`). The seed sets `ai.onboarded = true`.
  - The update check is opt-in.
  - Sync is not configured.
  - The backup's first check comes a minute after start (`src/main/data/register.ts`).
  - Nothing else showed up on the captures **[verified]**.
- `app.close()` runs `before-quit`. With no sync configured, `beforeQuit()` returns nothing and
  the app quits (`src/main/index.ts:449-465`).

## 2. Seeding the demo workspace

### 2.1 Mechanism

The seed runs inside the Playwright worker, under Node 24 on CI, where `node:sqlite` is
built in. It writes `<tmp>/<scenario>-<theme>-<side>/sel.db`, then calls `repo.close()`, which
runs `wal_checkpoint(TRUNCATE)` (`src/main/db/repository.ts:198-215`), so the database is a
single file. Then the app launches on that directory. A fresh seed per capture took 10-170 ms
**[verified]**. That is simpler than copying a seeded folder, and deterministic all the same.

A file written by `node:sqlite` opens fine in the app's better-sqlite3 13 under Electron 44
**[verified]**: the seeded pages and tasks showed, with no welcome page.

What the app does on start with a seeded file (`src/main/index.ts:365-387`):

- `store.isEmpty()` is false, so `seedIfEmpty` never runs. The `seeded` setting is not even
  read; write it anyway, as the plan asks and the test checks.
- `ensureTasksDatabase` (`src/main/db/tasks.ts`) keeps the Tasks database the seed made.
- `migrateNotebookTitle` is harmless.

### 2.2 APIs

These all exist on `Repository` (`src/main/db/repository.ts`):

- `new Repository(driver, { clock })` (constructor at `:171-196`, `RepositoryOptions.clock` at
  `:128-131`). Give it a fixed `clock` (the run's `now`, rounded down to the minute) so that
  `createdAt` and `updatedAt` are fixed. `now()` makes timestamps strictly increasing
  (`:245-249`), so the order of creation is deterministic too.
- `apply(ops: Op[])` (`:1136`), with `{ op: 'create', input: { id, type, parentId, props, afterId? } }`.
  This is what `src/main/db/seed.ts:76-180` uses. Ids are free-form within `^[A-Za-z0-9_-]{1,64}$`
  (`src/main/db/blocks.ts:36`). Use fixed ids such as `screens-notes`, `screens-task-01`.
- `update(id, { props })` (`:866`) to change the Tasks database's schema options and views.
- `setSetting(key, value)` (`:2088`) for `seeded`, `theme`, `ai.onboarded`, `ai.language`.
- `ensureTasksDatabase(repo)` (`src/main/db/tasks.ts`) creates the built-in database with
  `TASKS_DATABASE_ID` and `tasksDatabaseProps()` (`src/shared/tasks/index.ts:13,77-112`).

### 2.3 Settings per capture

| Setting | Value | Why |
|---|---|---|
| `seeded` | `true` | plan; `src/main/db/seed.ts:5` |
| `ai.onboarded` | `true` | no AI introduction (`src/shared/ai.ts:172`) |
| `theme` | `'light'` / `'dark'` | per capture (`src/main/ipc.ts:19`) |
| `ai.language` | `'en'` / `'pt-BR'` | the scenario's `locale`. This is what "the home's locale" reads: `homeLocale(ai.language, navigator.language)` (`src/renderer/src/home/copy.ts:79-82`, loaded at `src/renderer/src/home/store.ts:58-63`). There is no separate locale key. |
| `shell.tabs` | unset | the app opened on Today with one tab **[verified]**; `run` navigates from there |

### 2.4 Data for each starter scenario

All text is fixed English. Dates come from the run's `now` (local `YYYY-MM-DD`, as
`src/main/db/seed.ts:162-166` does).

- **Tasks database** (`TASKS_DATABASE_ID`, property ids in `TASK_PROPS`,
  `src/shared/tasks/index.ts:15-30`):
  - Fill `tasks.project` with options (it ships with none, `:89`): `Website`, `Garden`,
    `Admin`. Fill `tasks.labels` the same way: `errand`, `call`, `reading`. Fixed option ids
    (`screens.project.website` …), so the colours are fixed too.
  - About 12 rows with ids `screens-task-01…12`, each with `values` for `tasks.due`
    (`{ start: 'YYYY-MM-DD' }`), `tasks.priority` (`tasks.p1`…`tasks.p4`), `tasks.project` and
    `tasks.labels`:
    - due dates, two each: overdue (-3, -1 days), today, this week (+2, +4), next week (+8,
      +10), none;
    - two done, with `tasks.done: true` and `tasks.completedAt` set to a fixed moment today
      (`localMoment`, `:116`), so that `today` shows "one done".
  - Views: the built-in `tasks.view.table` and `tasks.view.board` stay (`:100-111`). The board
    there is "By project" (`groupBy: tasks.project`). The plan wants "board grouped by
    priority". **Decide:** add a view `screens.view.priority` ("By priority", board,
    `groupBy: 'tasks.priority'`), or capture "By project". Add a calendar view
    `screens.view.calendar` (`type: 'calendar'`, `groupBy: 'tasks.due'`; for a calendar,
    `groupBy` is the date property, `src/shared/types.ts:327`). Adding a view with `update`
    worked **[verified]**.
  - The sidebar's **Tasks** opens the Tasks *screen* (Inbox, To refine, Today, Upcoming,
    Completed), with the database's views listed under "Views" (it showed "All tasks", "By
    project" and the seeded "Calendar") **[verified, screenshot]**. So `tasks-table`,
    `tasks-board` and `tasks-calendar` are: click Tasks, then click the view's name.
- **`today`:** the rows above are enough. The Today screen draws the greeting, the date and the
  day's phrase first, and the agenda below them. In 1280×800 the task list is **below the
  fold** **[verified]**, so `run` must scroll the tasks section into view (for example with
  `getByRole('heading', { name: /tasks/i }).scrollIntoViewIfNeeded()`). Check the exact name.
- **`page-notes`:** a root page `screens-notes` "Notes" (icon 📝), with:
  - `heading_1` "Weekly notes";
  - `text` with bold and italic (rich text as in `seed.ts:86-93`);
  - `heading_2`;
  - three `to_do` (one checked);
  - a `callout` (`icon`, `color: 'yellow_background'`);
  - a `toggle` with a child `text`, `collapsed: false` so its content shows.

  `run`: click "Notes" in the sidebar (it appears under PRIVATE **[verified]**).
- **Projects:** a root page `screens-projects` "Projects" with two child pages,
  `screens-project-website` and `screens-project-garden`, each with a line of text. No starter
  scenario uses them yet. They are there for A1a-c.

## 3. Harness layout

```
e2e/screens/
  README.md                 how to add a scenario, run the pure tests, run locally under xvfb
  playwright.config.ts      testDir '.', testMatch /capture\.pw\.ts$/, workers 1, retries 0,
                            timeout 90 s, use.actionTimeout 10 s, reporter 'list'
  capture.pw.ts             the only Playwright file: builds one test per id × theme × side
  block.ts (+ .test.ts)     parse the `screens` block; same-block check for `edited`
  registry.ts (+ .test.ts)  Scenario type, load every scenarios/*.ts, check ids (kebab, unique)
  seed.ts (+ .test.ts)      seed(Repository, dir, { theme, locale, now, workspace? })
  comment.ts (+ .test.ts)   manifest → comment.md (markers, pairs, not in base, failed, unknown)
  scenarios/today.ts, pages.ts, tasks.ts
  .output/                  gitignored: manifest.json, results/*.json, png/*.png, comment.md
```

- **Naming.** Playwright's default `testMatch` picks up `*.test.ts`, and vitest's default picks
  up `*.spec.ts`. So the capture file is `capture.pw.ts`, and the config narrows `testMatch`.
  The pure tests run with `npx vitest run --dir e2e` **[verified: `--dir` overrides
  `test.dir: 'src'` from `vitest.config.ts:22` and keeps its aliases]**. `npm test` and
  `ci.yml` stay on `src/`, as the plan wants.
- **Registry format**, exactly as in plan lines 69-78:

  ```ts
  export interface Scenario {
    id: string                                   // kebab-case, unique across files
    description: string
    locale?: 'en' | 'pt-BR'                      // → ai.language
    themes?: ('light' | 'dark')[]                // default both
    workspace?: (repo: Repository) => void       // runs after the base seed, before close()
    run: (page: Page) => Promise<void>
  }
  ```

  Each `scenarios/<area>.ts` has `export default [ … ] satisfies Scenario[]`. `registry.ts`
  loads them with `readdirSync(scenariosDir).filter(f => f.endsWith('.ts'))` and `require()`.
  That is synchronous, which works inside Playwright's CJS transform and needs no index file.
  For the vitest check (ids unique and kebab-case), the same validation function is fed by
  `import.meta.glob('./scenarios/*.ts', { eager: true })`. Two entry points share one pure
  `validate(modules)`.
- **`capture.pw.ts`** reads `SCREENS_IDS` (written by the parse step, `all` already expanded),
  `HEAD_DIR`, `BASE_DIR`, `SCREENS_NOW` and `OUT_DIR` from the environment. For each id, theme
  and side (head first) it declares `test(\`${id} ${theme} ${side}\`)`, which:
  1. seeds with that side's `Repository`;
  2. launches, prepares (1.3), `run`s and captures to `png/<id>-<theme>-<side>.png`;
  3. writes `results/<id>-<theme>-<side>.json` (`{ id, theme, side, status, error }`).

  A base failure is caught and recorded as `status: 'not-in-base'`, and the test passes. A head
  failure is recorded and re-thrown, so the job goes red. A screenshot of the failing state is
  worth keeping in the artifact too. Writing one file per result (not a shared manifest) stays
  safe if workers are raised later. A final step (`if: !cancelled()`) merges `results/` into
  `manifest.json` and runs `comment.ts`.
- **Head vs base on disk:** `actions/checkout` twice, `path: head` (`ref: head.sha`) and
  `path: base` (`ref: <merge base>`), both with `persist-credentials: false`. Each gets
  `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build`. Head also gets
  `node node_modules/electron/install.js`. The harness runs from `head/`
  (`npx playwright test -c e2e/screens/playwright.config.ts`). Base needs no Playwright.
  `setup-node` with `cache: npm` and `cache-dependency-path: head/package-lock.json` (base's
  lockfile is usually close). Optionally cache `%LOCALAPPDATA%\electron\Cache` keyed on the
  Electron version.
- **Artifact:** `actions/upload-artifact` with the name `screens-<pr>-<sha7>`, `.output/**`,
  `retention-days: 14`, `if-no-files-found: ignore`.

## 4. The workflow

```yaml
name: Screens
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
permissions: {}
concurrency:
  group: screens-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  screens:
    runs-on: windows-latest
    timeout-minutes: 40
    permissions: { contents: read }
    outputs: { block: ${{ steps.parse.outputs.block }}, sha7: ... }
    steps: checkout head (persist-credentials: false) → setup-node 24 →
           parse (node head/e2e/screens/block.ts reads $GITHUB_EVENT_PATH) →
           [if block] merge-base via REST → checkout base → npm ci/build ×2 → electron install (head)
           → vitest run --dir e2e → playwright → merge manifest + comment.md (if: !cancelled()) → upload
  screens-publish:
    needs: screens
    if: ${{ !cancelled() && needs.screens.outputs.block == 'true'
            && github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write }
    steps: download artifact → validate → commit to team/screens → upsert comment
```

Details and pitfalls:

- **Untrusted text never goes into `run:`.** Do not write `${{ github.event.pull_request.body }}`
  into a shell line; that is how script injection happens. `block.ts` reads the event JSON from
  `$GITHUB_EVENT_PATH`. Keep `block.ts` free of imports so that Node 24 can run it directly
  (type stripping), before `npm ci`. It writes `block=true|false` and the expanded ids to
  `$GITHUB_OUTPUT` and a file. The same goes for every value taken from the event in the
  publish job: pass it through `env:`, never inline.
- **Parsing without a Windows runner (optional).** A tiny `plan` job on `ubuntu-latest` could do
  the parsing and the `edited`-unchanged check, so that "no block" never starts a Windows VM:
  `screens` would `needs: plan` and carry `if: needs.plan.outputs.block == 'true'`. A skipped
  job counts as passing. That adds a third job to the plan's two; it is the lead's call. Without
  it, "no block" still ends within about 1-2 min (the Windows VM starting up, checkout, parse).
- **Unknown ids:** `screens` reports them in the manifest and comment, and fails *after*
  capturing the known ones, so the comment still shows what it can. The plan only says "red".
  Either order works, but capturing first is kinder.
- **`team/screens` commit (publish job).**
  1. Validate the artifact. File names must match
     `^[a-z0-9]+(-[a-z0-9]+)*-(light|dark)-(base|head)\.png$` and start with the PNG
     signature; set a size cap (2 MB a file, 60 files). Anything else is dropped.
  2. `git clone --depth 1 --branch team/screens`. If the branch does not exist, create it:
     `git init`, `git checkout --orphan team/screens`, add the README.
  3. `git rm -r pr-<n>/`, copy the files to `pr-<n>/<sha7>/`, commit as
     `github-actions[bot]`, and push with `https://x-access-token:${GITHUB_TOKEN}@github.com/...`.
  4. **On a rejected push, start again from a fresh shallow clone** and repeat step 3. Do not
     `git pull --rebase` in a depth-1 clone: the merge base is past the shallow edge, and rebase
     then tries to replay the root. Each PR only touches `pr-<n>/`, so re-applying never
     conflicts. Up to 3 attempts, with a few seconds of random wait.
- **Image URLs.** Point them at the commit that was just pushed, not the branch:
  `https://github.com/erik-sc/sel/raw/<team-screens-commit-sha>/pr-<n>/<sha7>/<file>`. Older
  versions of the comment then keep working after the next push deletes the folder, the URL
  has no "branch name with a slash" ambiguity, and the camo cache can never serve a stale
  image. The repo is public (`gh api repos/erik-sc/sel`: `"private": false`), so anyone can see
  the images.
- **Comment upsert.** `GET /repos/{o}/{r}/issues/{n}/comments?per_page=100`, following pages
  through the `Link` header. Find a comment whose `user.login == 'github-actions[bot]'` and
  whose body contains `<!-- sel-screens -->`. If there is one, `PATCH
  /repos/{o}/{r}/issues/comments/{id}`; otherwise `POST`. Use `gh api` (it is on the runner)
  with `GH_TOKEN: ${{ github.token }}`. Notes:
  - The author is `github-actions[bot]`, not `erik-sc`, so the team's command filter
    (`references/github.md`, "Comments") ignores it.
  - Bodies are limited to 65 536 characters, so cap and cut.
  - **Sanitise the error text and the descriptions** (both come from PR code). Keep one line,
    at most 200 characters, inside backticks with any backticks removed, and break `@` (put
    it inside the backticks) so that nobody gets notified (the skill's GitHub mention rule).
- **"Build failed, no captures":** `screens` still uploads a `manifest.json` with
  `{ buildFailed: true, runUrl }` from an `if: failure()` step. `comment.ts` cannot run when the
  head install failed, so the publish job needs a fixed fallback body for "no `comment.md`".
  That body is a constant string in the workflow file plus the run URL: no PR code involved.
- **Fork PRs:** the publish job is skipped by its `if`, the capture runs, and the artifact can
  be downloaded from the run, as planned. Dependabot PRs have no block, so they skip.
- **Image size and branch growth.** PNGs at 1280×800 were 170-240 KB each on Linux
  **[verified]**; Windows text rendering may be a little larger **[assumed]**. 20 images come
  to about 4-5 MB per push. Ten PRs with five pushes each add about 200 MB a release to
  `team/screens`'s history. CI is unaffected (shallow, single-branch checkouts), but a plain
  `git clone` downloads every branch. Options for Érik: run `oxipng -o2` in the publish job
  (lossless, often 30-50 % off), or reset `team/screens` to a fresh orphan at each CLOSE. The
  plan's "git history keeps them" does not hold after a reset.

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The Windows desktop is smaller than 1280×800 and the window gets clamped | medium | `setViewportSize` emulation (1.2), already verified on a smaller Xvfb screen |
| The base launch hangs on a native dialog (schema newer, damaged database) | low now, certain after the next migration | seed base with base's `Repository` (0.3); 60 s launch timeout; `app.close()` in `finally`, falling back to `process().kill()` |
| Captures differ between runs (time of day, animation entrances, the clock crossing midnight) | medium | reduced motion + reload; one `now` per job; settle frames; accept "Good evening"/"Good night" |
| A failing `run` on base eats the time budget (every action waits up to its timeout) | medium as the scenarios grow | `actionTimeout` 10 s; head first; stop base after the first failed step |
| The Windows Playwright quoting of `--user-data-dir` (`shell: true`) | low | keep temp paths free of quotes, under `RUNNER_TEMP` |
| Script injection through the PR body or manifest text | high if ignored | env/`$GITHUB_EVENT_PATH` only; strict validation in publish |
| The publish push races between PRs | medium during BUILD | fresh-clone retry loop (section 4) |
| `team/screens` grows large | certain over time | lossless optimisation; reset at CLOSE (Érik's call) |
| Rule 3: the item changes `.github/workflows/` | certain | as planned: built, its own PR shows its screenshots, `blocked: needs Érik` |

## 6. Recommended order of work

1. **Pure parts first, on Node 24, no Electron:**
   - `block.ts` (with the `edited` same-block check) and its tests;
   - `registry.ts` with the `Scenario` type and `validate`;
   - `seed.ts` (taking the `Repository` class, a fixed `clock`, and the settings in 2.3) with
     the plan's seed test (the Notes page, the Tasks database with table, board and calendar
     views, a row due today, `seeded` set);
   - `comment.ts` and its tests.

   Wire up `tsconfig.node.json` (`include` gets `e2e/**/*`) and `biome.json` (`files.includes`
   gets `e2e/**`). Add `.gitignore` `e2e/screens/.output/`, `@playwright/test` pinned exactly to
   `1.64.0`, and two scripts: `screens` (`playwright test -c e2e/screens/playwright.config.ts`)
   and `screens:test` (`vitest run --dir e2e`). 1.64.0 is the newest release at least two weeks
   old: 2026-10-07; 1.64.1 is from 2026-10-14. No browser download is needed for `_electron`.
2. **`capture.pw.ts` and the five starter scenarios, tried locally under `xvfb-run`** (it works
   in a cloud session, finding 0.8), against one checkout used as both head and base. Look at
   every PNG: scroll on Today, Herman still, theme right, 1280×800.
3. **Make the base side real:** the merge-base lookup and a second checkout (locally, a
   `git worktree` of the merge base). Prove a "not in base" result with a scenario that clicks
   something base lacks.
4. **`screens.yml` `screens` job only** (no publish) on a draft PR, and check the artifact on
   Windows: timings, window size, fonts.
5. **`screens-publish`:** the orphan branch, the retry loop, the comment upsert, sanitising.
   Then walk the plan's "Done when" on S0's own PR: 20 PNGs; a second push edits the same
   comment; `nope-not-a-scenario` turns the run red; removing the block leaves it green without
   a push.
6. **The "Screens" section in `docs/codebase-knowledge/50-conventions.md`** and
   `e2e/screens/README.md`. Mention the Linux/xvfb local loop, and that captures of record come
   only from Windows CI.

## 7. Verified vs assumed

**Verified** (Linux, xvfb, Electron 44.7.0, Playwright 1.64.0, Node 22.23):

- `npm ci --ignore-scripts`, the Electron install and `npm run build` work, and `out/main/index.js`
  exists.
- better-sqlite3 13.0.3 has `prebuilds/win32-x64.node` and loads its prebuilds first.
- `_electron.launch({ args: ['.', '--user-data-dir=…'], cwd })` starts the app, and `userData`
  equals that directory.
- A `sel.db` seeded with `Repository` on `node:sqlite` opens in the app: no welcome page; the
  Notes page, the tasks and an added calendar view show; the stored dark theme applies.
- `openTestRepository` fails to load under Playwright (`import.meta`).
- `Repository` can be loaded from a second checkout.
- First window after 0.5-1.2 s; 4-5 s per capture.
- `setViewportSize` gives 1280×800 on a 1024×768 screen.
- `--force-prefers-reduced-motion` does nothing; `emulateMedia` + `reload` works.
- Herman's entrance gets caught without reduced motion.
- Today's tasks are below the fold.
- PNGs are 170-240 KB.
- `vitest run --dir e2e` works.
- The repo is public.

**Read in the code, not run:** Playwright's launch arguments, its `loader.js` and how it finds
Electron.

**Assumed:**

- everything specific to Windows runners: desktop size, timings, `shell: true` quoting, the
  interactive session;
- GitHub's behaviour: `pull-requests: write` being enough for issue comments on a PR, how
  `edited` events carry `changes.body.from`, pushes with `GITHUB_TOKEN` not starting
  workflows, camo and raw URL behaviour;
- the per-directory single-instance lock with parallel workers.
