# History and ownership

At the 0.9.0 close the visible history is 352 commits, 210 of them non-merge, over twelve days
from 2026-10-13 to 2026-10-25 (`git log`). Since 0.9.0 most commits come from the automated team
(skill `.claude/skills/sel-team/SKILL.md`), several releases a week, so dates say little about
pace; order matters more.

## Timeline of structural decisions

| When | What | Why (documented / inferred) | Evidence (commit) |
|---|---|---|---|
| 1 | Initial import as "Selida": blocks, databases, editor, shell, store, versions | Inferred: the project arrives whole, so earlier history was squashed or lived elsewhere | commit 812b72a |
| 2 | AI actions through the local Claude Code CLI | Documented: "The CLI runs headless with no tools, the prompt on stdin, and page content passed as delimited data" | commit 85162f8 |
| 3 | Zen becomes the default look | Inferred from the subject line | commit 5f843cb |
| 4 | iCalendar parser, briefing service, Today screen | Documented in subjects: calendars over https, open tasks, phrase of the day | commit ed6ebb8, commit 705e51a, commit f5f4988 |
| 5 | GitHub sync for one person's devices | Documented: "one JSON file per page in a private git repository"; "the later edit wins and the other is kept in version history" | commit 9c93ac1 |
| 6 | Briefing and sync merged | Documented: "Both features add an API namespace, IPC handlers and a Settings section; keep both" | commit e1a5194 |
| 7 | Meeting recording with local transcription | Documented: "Audio stays local and is never part of sync; the engine is downloaded once, on request, and verified against pinned digests" | commit 3d7fb14 |
| 8 | Herman: settings, non-AI counsel, scheduler, voice, drawn figure | Documented in subjects | commit 12e91f2, commit 90e14c5, commit f9567f7 |
| 9 | Rename to "sel", carrying over stored data | Documented: "the data folder and the database file are renamed on the first start; a migration rewrites the addresses stored in blocks and settings" | commit adde475 |
| 10 | App icon, then tag v0.1.0 | Tag points at the icon fix | commit 6454ef8, commit ba9c680 |
| 11 | Generated shapes replace emojis as page icons | Documented: "Icons saved as emojis are not rewritten: the emoji is the seed" | commit 5f979c1 |
| 12 | Calendar screen with month, then week | Documented in subjects | commit fd0149e, commit b36d895 |
| 13 | Version 0.2.0 | | commit 4f4042f |
| 14 | Herman gets workspace context, a council, other CLIs and proposals | Documented: "nothing is created until Apply is pressed, and the ops go through the same pipeline as the user's own edits"; running limit raised from two to four | commit 8acaec9 |
| 15 | The council and the connected programs (Codex, Gemini, Ollama, stdin) are removed | The owner asked for it ("remova o council"); a question goes to Herman alone, and a stored `herman.council` setting is ignored | branch release/0.7.2 |
| 16 | Time blocks on Today and projects with a direction (0.8.0 E2, E3) | Asked in docs/plans/release-0.8.0.md: a block is the due date's own start and end (no new property, older copies read it as a time), never written to a calendar; a project's objective, next action and milestones live on the Tasks database block, progress is a count "without gamified percentage" | branch feat/0.8.0-agenda |
| 17 | Weekly review (0.8.0 E1) | Asked in docs/plans/release-0.8.0.md: assisted, never autonomous, no score or streak; the week's three priorities are kept as a week focus on the Tasks database (Meditations has no page for a week) instead of rewriting priorities; the AI summary is only a hook | branch feat/0.8.0-review |
| 18 | Any block can sit beside another (0.9.0 A1a) | Asked in docs/plans/release-0.9.0.md: rows reuse the `beside` prop, so nothing new is stored and 0.8.0 reads the same blocks stacked; the editor repairs a row inside `commit`, as part of the same undo step, rather than in each command; stale flags 0.8.0 left on databases are accepted (docs/team/decisions.md) | branch team/0.9.0/a1a-any-block-beside |
| 19 | Drag a block to the side, or type /columns (0.9.0 A1b) | Asked in docs/plans/release-0.9.0.md: two drop positions, `left` and `right`, only beside a block of the page itself; the designer's open question settled as "a drop above or below a column never splits its row" (`dropInRow`); the side zone starts at the block's edge, not in its gutter, so a straight-down drag from the handle keeps dropping above and below | branch team/0.9.0/a1b-drag-side-columns |
| 20 | Typing inside a column (0.9.0 A1c) | Asked in docs/plans/release-0.9.0.md: the key plans in structure.ts learn rows (`rowOfHead`) instead of the keyboard; decided while building: Enter at the very start of a head puts a new empty head in its place with the old head as its first child (its children follow, except under a toggle, list item or to-do, which keep theirs), so the empty line shows above it in the column, and Backspace in that empty head reverses it; Backspace at the start of a column's last line joins it to the line above instead of lifting it out of the row; Delete never pulls a head in, also from the block above the row | branch team/0.9.0/a1c-typing-in-columns |
| 21 | Screenshots of every visible pull request (0.9.0 S0) | Asked by Érik first in docs/plans/release-0.9.0.md: a Playwright harness outside `src/` launches the built app of head and of the merge base on Windows, each seeded by its own `Repository`; the job that runs PR code holds only a read token, and a separate job with write access checks the artifact as untrusted data before committing the images to the orphan branch `team/screens` and editing one comment; the pointer leaves the window before each capture (ADR 11 below) | branch team/0.9.0/s0-screenshot-job, .github/workflows/screens.yml |
| 22 | The build moves to Vite 8 and Rolldown (0.9.0 C2) | Asked in docs/plans/release-0.9.0.md (Dependabot #75, #76): electron-vite 6, `rolldownOptions`, `minify: 'oxc'`; the vendor chunk becomes a `codeSplitting` group and a second group keeps every module of the first screen in the entry, since Rolldown would otherwise split each module a lazy feature shares into a chunk preloaded at start-up; Electron stays on 44 | branch team/0.9.0/c2-toolchain-majors, electron.vite.config.ts:73, electron.vite.config.ts:114-127 |
| 23 | A database's columns shaped from their menus (0.9.0 B1, B2, B3) | Asked in docs/plans/release-0.9.0.md: a property is named as it is added; a select's options are edited in the column's menu; the table's headers are reachable from the keyboard with Insert left/right, which writes the schema and the view's `visibleProperties` as one batch. The menus' words move into one bilingual module, src/renderer/src/database/copy.ts (en and pt-BR), the pattern editor/copy.ts follows; nothing new is stored | branches team/0.9.0/b1-name-property-on-add, team/0.9.0/b3-select-options-menu, team/0.9.0/b2-header-keyboard-insert |
| 24 | Selection in the Tasks lists (0.10.0 E1a) | Asked in docs/plans/release-0.10.0.md: the selection is a value kept by the Tasks screen (selection.ts, useTaskSelection.ts), never stored; keys act on it only from two rows and from a row in it; a change is one `editCells` batch with one Undo that rewrites the rows' old values (tasks/bulk.ts), because the database has no undo of its own. The state is told by the row's name and a tick, not `aria-selected`: ARIA does not allow it on a list item and axe fails it | branch team/0.10.0/select-keys |
| 25 | The selection strip and Let go (0.10.0 E1b) | The strip (SelectionBar.tsx) is a sticky toolbar inside `.tasks-main`, so it never covers the add line at the top. It reuses the keys' functions (bulk.ts) and BulkPopover (now also for priority). Let go (`letGoTasks`, edit.ts) is not Delete and not done: it trashes only tasks present and not already trashed, so its Undo (`restoreRows`) cannot restore anything it did not trash. The Delete key stays single-task | branch team/0.10.0/select-strip |

## Hotspots (churn; say "repo is N days old" when churn is meaningless)

The repo's visible history spans a single day, so churn counts measure how many features
touched a file, not instability. Read them as "integration points every new feature must edit".

| File | Commits touching it | Why it is touched |
|---|---|---|
| README.md | 9 | Feature list grows with each feature (inventory script, this session) |
| src/shared/api.ts | 9 | Each feature adds an API namespace (src/shared/api.ts:24) |
| src/preload/index.ts | 8 | Each feature adds a namespace method list (src/preload/index.ts:27-28) |
| src/renderer/src/shell/SettingsDialog.tsx | 8 | Each feature adds a settings section (src/renderer/src/shell/SettingsDialog.tsx:38-42) |
| src/main/ipc.ts | 7 | Each feature registers handlers (src/main/ipc.ts:223-254) |
| src/renderer/src/shell/Shell.tsx | 7 | Each feature mounts a host (src/renderer/src/shell/Shell.tsx:5-9) |
| src/renderer/src/main.tsx | 7 | Each feature adds an `init*` call (src/renderer/src/main.tsx:38-56) |
| src/main/validate.ts | 6 | Each feature adds writable setting keys (src/main/validate.ts:35) |
| src/main/ai/index.ts, src/main/ai/prompts.ts | 6 each | Briefing, meetings and Herman all route through the AI bridge (src/main/ai/index.ts:310) |

## Ownership concentration (truck factor)

| Area | Main author(s) | Risk |
|---|---|---|
| Entire repository | One person under three git names, "Érik S." (239), "Érik Schünemann" (64, mostly merges) and "erik-sc" (35, the automated team's commits and merges), plus 14 as "Claude" (`git shortlog -sn`, at the 0.9.0 close) | Truck factor 1 |
| All feature commits | Each carries a `Co-Authored-By: Claude` trailer (commit 9c93ac1, commit 3d7fb14, commit adde475) | Rationale lives in commit bodies and code comments rather than in a second person's head |

## Candidate ADRs (inferred, not documented)

Each is inferred from code and commit messages; none exists as a decision record.

1. **Everything is a block.** Pages, databases and rows share one table and one op pipeline (src/shared/types.ts:1, src/main/db/schema.ts:9).
2. **The renderer is untrusted.** Sandbox, CSP and validation on every call (src/main/index.ts:108-110, src/main/ipc.ts:69-90).
3. **AI through the user's own CLI, never an API key.** The child gets an allow-listed environment with no API keys (src/main/ai/command.ts:119-190); commit 85162f8.
4. **AI output never writes directly.** Inline results wait for accept (src/renderer/src/ai/session.ts:1-3); proposals wait for Apply (commit 8acaec9).
5. **Sync by plain git on files the user owns, not a server.** No token is stored (src/shared/sync.ts:4-5); commit 9c93ac1.
6. **Conflict policy: merge field by field; where both sides changed the same thing differently the later edit wins, and the loser is kept as a version.** (src/main/sync/merge.ts:8-20, src/main/sync/engine.ts:778-791, src/main/db/repository.ts:1470-1479).
7. **Few runtime dependencies.** Everything is bundled except the native SQLite module and electron-updater, required only when an update check runs (electron.vite.config.ts:77-79, package.json:22-25).
8. **Charts, diffing, iCalendar parsing and zip reading are hand-written rather than imported.** (src/renderer/src/database/views/chartPlot.tsx:178, src/renderer/src/versions/diff.ts:3-6, src/main/briefing/ical.ts:680, src/main/meetings/whisper/zip.ts:137); consistent with README.md:42.
9. **Unit tests avoid Electron.** Services are Electron-free with injected clocks (src/main/herman/service.ts:69-70); components are tested in happy-dom rather than jsdom (package.json:26-50, "Testing" in 50-conventions.md). Only the screenshot harness (e2e/screens/, 0.9.0) launches the real app, and it gates nothing but the pictures.
10. **Rename without data loss.** Legacy profile adoption and URL rewriting are kept as permanent code (src/main/legacy.ts:18, src/shared/legacy.ts:12); commit adde475.
11. **Visible changes are seen before they merge, on the real app (0.9.0, S0).** Pull requests name scenarios in a `screens` block; the Screens workflow captures head and merge base on Windows through Playwright's Electron driver and posts the pairs as one comment (.github/workflows/screens.yml, e2e/screens/). The capture job holds only a read token; a separate job with write access checks the artifact as untrusted data before committing images to the orphan branch `team/screens`. The harness lives outside `src/` and the app has no test hooks for it.

Abandoned approaches visible in history: emojis as page icons (commit 5f979c1), the "Glass" look as default (src/renderer/src/appearance/presets.ts:4-5; commit 5f843cb), two concurrent AI runs (commit 8acaec9).
