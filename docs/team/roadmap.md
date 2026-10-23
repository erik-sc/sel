# Roadmap to 2.0.0

Owned by `sel-pm`. Rewritten as the team learns; the history is in git.

Status: **first team reading** · 2026-10-23 · written by `sel-pm` from Érik's pains (2026-10-21),
the 0.7.0 and 0.8.0 plans, `docs/codebase-knowledge/`, `docs/screens/` and the code on `main`
at 8da2eb4 (v0.8.0). No issue or comment from Érik yet.

## Milestones (Érik's, 2026-10-21)

- **1.0.0 — usable and polished.** Usability, tasks and the persona polished; at least the five
  pains below solved, each one confirmed by Érik in daily use, not only merged.
- **2.0.0 — solid verticals, minimum clicks.** Both verticals (D: databases and tasks; Z: zen)
  coherent, with good UX throughout and nothing that needs a manual to find.

## Where Érik's pains stand (checked against the code, 2026-10-23)

| # | Pain (his order) | State | Evidence | Next |
|---|---|---|---|---|
| 1 | Handling the inbox: moving, dating, prioritising opened the task screen | **Solved in code, not yet confirmed by him.** Task rows on Tasks, Today and Calendar carry chips (date, repeat, priority, project, labels) that open their editor in place, a context menu, per-row keys, a side task panel, a "To refine" list and a keyboard-only Refine mode, plus four refine reminders | `src/renderer/src/tasks/TaskRow.tsx`, `TaskPanel.tsx`, `Refine.tsx`, `src/shared/tasks/refine.ts`; used in `briefing/TodayScreen.tsx` and `briefing/CalendarScreen.tsx` (0.7.0 items 9a–9c) | Ask him in the 0.9.0 release PR whether it still hurts; reopen only on his word |
| 2 | Database usability: multi-column page layout does not work; too many clicks to edit columns | **Open.** Only database blocks can sit side by side (`editor/layout.ts`, `canShareRow`); text, callouts and images cannot. A new property is created with its type's name and must be opened again to be renamed (`database/propertyMenus.tsx`, `AddPropertyMenu`); select options can only be edited from inside a cell (`database/SelectEditor.tsx`); table headers are mouse-only | code read 2026-10-23 | **0.9.0** |
| 3 | The persona creating real pages and databases (a finances page came out weak) | **Open.** A proposal can only create properties of 8 plain types (no formula, relation, rollup or number format such as currency), one view per database, and no filters, sorts, charts, calculations or side-by-side layout | `src/shared/actions.ts` (`ACTION_PROPERTY_TYPES`, `ACTION_VIEWS`, `HermanAction`) | 0.10.0 |
| 4 | The persona being proactive: reminding what was left undone, suggesting occasionally | **Built, not proven.** Routines (morning plan, midday, evening close-of-day draft, weekly review, stalled task) exist but are all off by default; the non-AI counsel already nudges about the inbox. A routine's answer lives only in memory and is lost if the app closes before the persona speaks | `src/shared/routines.ts`, `src/main/routines/`, `src/main/herman/counsel.ts`; release-0.8.0.md "Falta / para depois" | 0.12.0, after he has lived with them |
| 5 | Making the verticals clear (extras off by default on fresh installs) | **Open.** Templates, LaTeX, pomodoro, in-app feedback and appearance presets have no on/off switch; every fresh install shows all of them | `src/renderer/src/features.ts` registers every feature unconditionally; no `*.enabled` setting for them in `src/shared/` | 0.11.0 |

Set aside by Érik: faster meeting transcription (~1 h last time).

## Themes, release by release

One theme each; polish before novelty. Versions after the next one are intentions, not promises:
Érik's feedback reorders them at any time.

| Version | Theme | What it holds |
|---|---|---|
| **0.9.0** | **Pages and databases you can shape** (pain 2) | Columns for any block (block menu, drag to the side, typing inside a column); a new property named as it is made; select options edited from the column's menu; table headers renamed in place, reachable by keyboard, with insert left or right. Housekeeping: land the dev-toolchain bumps Dependabot opened (#75–#78) on the release branch |
| 0.10.0 | **A persona that builds for real, and keeps its word** (pain 3 + 0.8.0 privacy leftovers) | Proposals that create formulas, relations, rollups, number formats (currency), several views, filters, sorts, charts and calculations, and columns from 0.9.0; a check of the result against a few reference requests (finances, reading list, project). The "Private from AI" promise closed: private titles no longer reach the AI through relation cells and links, and inline AI is not offered on private pages |
| 0.11.0 | **Two verticals, clearly** (pain 5) | An "Extras" section in Settings with one switch per extra (templates, LaTeX, pomodoro, feedback, appearance presets), off on fresh installs and unchanged on existing ones; the sidebar and onboarding say what D and Z are; one language throughout (the editor and database menus are English-only today, while every newer feature has pt-BR) |
| 0.12.0 | **A persona that remembers what was left undone** (pain 4) | Routine answers that survive a restart; the evening and stalled routines tuned from Érik's use; a quiet "left undone" recap the persona can offer without AI; limits and the off switch kept in sight |
| 0.13.0 | **Ready for another developer** | README and `site/` that take a stranger from clone to running app; a contributor guide drawn from `docs/codebase-knowledge/`; a first run that works without Claude Code installed and says what AI adds; the line citations in `docs/codebase-knowledge` checked |
| 0.14.0 | **Polish pass before 1.0** | A pass over every screen in `docs/screens/` for clicks, copy, focus and dark mode; importer gaps (non-image attachments, Notion relations as relations); backup comparison measured on a large workspace; whatever Érik's daily use has turned up |
| **1.0.0** | **Usable and polished** | Only fixes and polish on top of 0.14.0; the five pains confirmed solved by Érik |

From 1.0.0 to 2.0.0 (order decided after 1.0.0): column widths and page layout presets; database
templates and faster relation and rollup setup; Today as the real bridge between D and Z; the Z
vertical as one ritual (Meditations, the Sky and Close the day speaking to each other); a
privileged `app://` protocol instead of `file://` (codebase question 34); clicks counted on the
ten most common flows and cut; macOS and Linux builds only if someone other than Érik asks.

## Left for later from 0.8.0, and where it went

| From `docs/plans/release-0.8.0.md` | Goes to |
|---|---|
| Private page titles still visible in relation cells and links inside public pages | 0.10.0 |
| Inline AI actions still offered on a private page (refused when used) | 0.10.0 |
| Routine answers kept only in memory: closing the app before the persona speaks loses the day's answer | 0.12.0 |
| Import: non-image attachments come in as text; Notion relations and rollups come in as text | 0.14.0 |
| Backup comparison not measured on very large workspaces | 0.14.0 |
| Line citations in `docs/codebase-knowledge` need a pass | 0.13.0 |
| Decisions the 0.8.0 agents took (activity log on by default; memory uses haiku on every request; 08:00–19:00 as the working day; Monday-to-Sunday week; a project's next action is only the chosen one; weekly rhythm note off) | Listed for Érik in the 0.9.0 release PR; any he rejects becomes an item |

## How the team treats dependency updates

- Dependabot opens its pull requests against `main`, which the team never touches, so the team
  does not merge them. When they change only `devDependencies` (Electron within its major
  included), a plan item lands the same versions on the release branch, with a local
  `npm run build` because CI does not build the app. The Dependabot PR closes itself once the
  release reaches `main`.
- A bump of a runtime `dependencies` entry (`better-sqlite3`, `electron-updater`) or of Electron's
  major is planned as `blocked: needs Érik`, with the question, per skill rule 3.

## Not doing (and why)

- **Web search for the persona.** Érik decided against it.
- **A persona that writes on its own.** Assisted, never autonomous: every change waits for Apply.
- **Scores, streaks, badges, "records", or notifications nobody asked for.** Against the zen
  vertical; the heatmaps stay ink, not a scoreboard.
- **A sync server, accounts, or real-time collaboration.** Local-first; sync stays plain git on
  the user's own repository.
- **AI through API keys or other CLIs.** The council and the other programs were removed in
  0.7.2; AI goes only through the user's own Claude Code.
- **Telemetry or crash reporting.** Nothing leaves the machine.
- **A mobile app, or macOS and Linux builds before 1.0.0.** Windows first; the audience today is
  one Windows user and developers like him.
- **Third-party plugins.** A feature is one folder plus one line in each feature list; that is
  the extension point until 2.0.0.
- **Faster meeting transcription, for now.** Set aside by Érik on 2026-10-21; back on his word.
