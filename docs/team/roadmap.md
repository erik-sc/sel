# Roadmap to 2.0.0

Owned by `sel-pm`. Rewritten as the team learns; the history is in git.

Status: **first team reading, backlog opened** · 2026-10-24 · written by `sel-pm` from Érik's pains
(2026-10-21), the 0.7.0 and 0.8.0 plans, `docs/codebase-knowledge/`, `docs/screens/` and the code
on `main` at 8da2eb4 (v0.8.0); revised on 2026-10-24 when the first three release proposals were
written against the code on `release/0.9.0`; revised again on 2026-10-24 (night) after Érik
rejected those three (#91, #92, #93) and asked for smaller, concrete releases he feels in daily
use, and for new ideas from the team beyond the listed pains (comment on #82); revised on
2026-10-25 to agree with the six open proposals (#96–#101) after three more (#99–#101) were posted
and the panel review reached all six.

## Milestones (Érik's, 2026-10-21)

- **1.0.0 — usable and polished.** Usability, tasks and the persona polished; at least the five
  pains below solved, each one confirmed by Érik in daily use, not only merged.
- **2.0.0 — solid verticals, minimum clicks.** Both verticals (D: databases and tasks; Z: zen)
  coherent, with good UX throughout and nothing that needs a manual to find.

Note (2026-10-25): none of the six open proposals moves pains 3, 4 or 5; #99 and #101 deepen
pain 1 (the inbox and Today), and #100 takes the "one language throughout" part of #92 (pain 5).
1.0.0 is unchanged in what it requires, but it now comes after whichever of the six Érik approves,
then "Ready for another developer", the polish pass, and pains 3–5 in a shape he chooses. Its
predecessor's version number is therefore not fixed.

## Where Érik's pains stand (checked against the code, 2026-10-23)

| # | Pain (his order) | State | Evidence | Next |
|---|---|---|---|---|
| 1 | Handling the inbox: moving, dating, prioritising opened the task screen | **Solved in code, not yet confirmed by him.** Task rows on Tasks, Today and Calendar carry chips (date, repeat, priority, project, labels) that open their editor in place, a context menu, per-row keys, a side task panel, a "To refine" list and a keyboard-only Refine mode, plus four refine reminders | `src/renderer/src/tasks/TaskRow.tsx`, `TaskPanel.tsx`, `Refine.tsx`, `src/shared/tasks/refine.ts`; used in `briefing/TodayScreen.tsx` and `briefing/CalendarScreen.tsx` (0.7.0 items 9a–9c) | Ask him in the 0.9.0 release PR whether it still hurts; reopen only on his word |
| 2 | Database usability: multi-column page layout does not work; too many clicks to edit columns | **Open.** Only database blocks can sit side by side (`editor/layout.ts`, `canShareRow`); text, callouts and images cannot. A new property is created with its type's name and must be opened again to be renamed (`database/propertyMenus.tsx`, `AddPropertyMenu`); select options can only be edited from inside a cell (`database/SelectEditor.tsx`); table headers are mouse-only | code read 2026-10-23 | **0.9.0** |
| 3 | The persona creating real pages and databases (a finances page came out weak) | **Open.** A proposal can only create properties of 8 plain types (no formula, relation, rollup or number format such as currency), one view per database, and no filters, sorts, charts, calculations or side-by-side layout | `src/shared/actions.ts` (`ACTION_PROPERTY_TYPES`, `ACTION_VIEWS`, `HermanAction`) | Later (#91 rejected for now) |
| 4 | The persona being proactive: reminding what was left undone, suggesting occasionally | **Built, not proven.** Routines (morning plan, midday, evening close-of-day draft, weekly review, stalled task) exist but are all off by default; the non-AI counsel already nudges about the inbox. A routine's answer lives only in memory and is lost if the app closes before the persona speaks | `src/shared/routines.ts`, `src/main/routines/`, `src/main/herman/counsel.ts`; release-0.8.0.md "Falta / para depois" | Later (#93 rejected for now) |
| 5 | Making the verticals clear (extras off by default on fresh installs) | **Open.** Templates, LaTeX, pomodoro and in-app feedback have no on/off switch; every fresh install shows all of them. Appearance presets have had no screen since 0.7.1 (commit 4980fe8), so there is nothing to switch | `src/renderer/src/features.ts` registers every feature unconditionally; no `*.enabled` setting for them in `src/shared/` | Later (#92 rejected for now) |

Set aside by Érik: faster meeting transcription (~1 h last time).

## Themes, release by release

One theme each; polish before novelty. Versions after the next one are intentions, not promises:
Érik's feedback reorders them at any time.

| Version | Theme | What it holds |
|---|---|---|
| **0.9.0** | **Pages and databases you can shape** (pain 2) | Columns for any block (block menu, drag to the side, typing inside a column); a new property named as it is made; select options edited from the column's menu; table headers renamed in place, reachable by keyboard, with insert left or right. Housekeeping: land the dev-toolchain bumps Dependabot opened (#75–#78) on the release branch. First, at Érik's request: a CI job that screenshots the real app (Windows, seeded demo workspace, both themes) before and after on every visible PR |
| next | **The open proposals, in Érik's order** | Six proposals wait for approval (see "Release backlog" below, which gives the team's suggested order). Each one approved becomes the next release; one theme per release |
| after them | **Ready for another developer** | README and `site/` that take a stranger from clone to running app; a contributor guide drawn from `docs/codebase-knowledge/`; a first run that works without Claude Code installed and says what AI adds; the line citations in `docs/codebase-knowledge` checked; issue templates and `CONTRIBUTING.md` (0.9.0 plan, "First run") |
| then | **Polish pass before 1.0** | A pass over every screen in `docs/screens/` for clicks, copy, focus and dark mode; importer gaps (non-image attachments, Notion relations as relations); backup comparison measured on a large workspace; whatever Érik's daily use has turned up |
| **1.0.0** | **Usable and polished** | Only fixes and polish on top of the polish pass; the five pains confirmed solved by Érik |

From 1.0.0 to 2.0.0 (order decided after 1.0.0): column widths and page layout presets; database
templates and faster relation and rollup setup; Today as the real bridge between D and Z; the Z
vertical as one ritual (Meditations, the Sky and Close the day speaking to each other); a
privileged `app://` protocol instead of `file://` (codebase question 34); clicks counted on the
ten most common flows and cut; macOS and Linux builds only if someone other than Érik asks.

## Release backlog

Every release after the one in progress starts as a proposal issue (label `release-proposal`); Érik
approves (`/approve`, `/next`) or rejects (`/reject`) it there, and the queue order is the build
order (skill, "Release backlog"). This table and the open proposals must agree.

Six proposals are open, two per target version: #96–#98 were written by the team's run on the
evening of 2026-10-24, #99–#101 by a later session that also ran the panel on all six. **Every
target version below is a guess written when the proposal was posted; the real version is set when
Érik approves and the release starts, in the queue order he chooses.** No proposal was closed or
rewritten to make the numbers line up. The team's suggested order, with why:

| Order | Proposal | Target as posted | Theme | Why here | State |
|---|---|---|---|---|---|
| 1 | #99 | 0.10.0 | Today, with fewer clicks (3 items) | Today is the screen Érik opens every day and pain 1's home; simulated Érik wants it after two panel rounds; touches nothing 0.9.0 changes | waiting for approval; panel done (2 rounds) |
| 2 | #97 | 0.11.0 | Land where you meant to go (3 items) | The panel's strongest (4 of 5 want it); its reveal mechanism is what #98's outline would jump with | waiting for approval; panel changes still to apply (select the block on arrival, keep the place on Today and Tasks too, mark the matched word) |
| 3 | #101 | 0.12.0 | Select several tasks (1 item) | Inbox work (pain 1) at its largest; reuses #99's Let go and tomorrow moves and the same row component, so it must follow #99 | waiting for approval; panel done (2 rounds; Lia still against) |
| 4 | #98 | 0.12.0 | Long pages you can work in (2 items) | Needs #97 first; find and replace survives the panel, the margin outline does not as written (simulated Érik indifferent) | waiting for approval; panel changes still to apply (whole word and match case, a count before Replace all, outline replaced by "Go to heading" or off until asked) |
| 5 | #100 | 0.11.0 | sel in your language (2–3 items) | Pays the mixed-language debt 0.9.0 leaves in the editor (see "Later"); panel mostly indifferent and the issue says rejecting it is fine; cheap, could move up if Érik wants pt-BR sooner | waiting for approval; panel done (2 rounds), posted as rejectable |
| 6 | #96 | 0.10.0 | Text that behaves like the rest of Windows (2 items) | Panel rule says cut: most of the panel, simulated Érik included, is indifferent. If kept, plain paste (T2) alone, small enough to ride in the polish pass | waiting for approval; panel changes still to apply (cut, or T2 alone) |

The panel's recommendations on #96, #97 and #98 are recorded on the issues as "pending: next run";
the team applies them (step 3 of "Panel review") before any of those three is built, and says so on
the issue. The suggested order is only a suggestion: `/next` on any proposal puts it first.

How proposals are sized since 2026-10-24 (Érik, on #82): small and concrete, two to four items,
things felt in daily use; and at least some new ideas from the team, not only the listed pains.

## Later (rejected for now, 2026-10-24)

Érik rejected these three proposals with "Not a priority right now. Keep the idea in the roadmap
for later; do not re-propose it as is." They are kept here, not in "Not doing": the ideas stand,
the timing and the size did not. None comes back as it was written; when one returns it will be a
new, smaller proposal, on Érik's word or when his daily use points at it.

| Was | Theme | What it held | Note |
|---|---|---|---|
| #91 (target 0.10.0) | A persona that builds for real, and keeps its word (pain 3) | Proposals that create formulas, relations, rollups, currency formats, several views, filters, sorts, charts and calculations; the "Private from AI" leaks from 0.8.0 closed | The privacy leaks are a broken promise rather than a feature; the team asked Érik on #82 whether he wants them sooner as a bug fix |
| #92 (target 0.11.0) | Two verticals, clearly (pain 5; identity change) | Settings → Extras with one switch per extra, off on fresh installs; appearance presets leave the charter's extras; a welcome page that explains the verticals; one language throughout | The charter still lists the extras as "off by default on fresh installs"; today they are all on. The charter is left as it is until this returns. "One language throughout" is now in proposal #100 |
| #93 (target 0.12.0) | A persona that remembers what was left undone (pain 4) | Routine answers that survive a restart; what each routine did today; turning a routine off from its line; Close the day listing what was left undone | Waits for Érik to live with the routines (they are off by default) |

### Parked by the 0.9.0 plan

| What | Where it went |
|---|---|
| The editor's menus in pt-BR (slash menu, block menu, selection toolbar, page menu): 0.9.0 adds two Portuguese entries to an English block menu and translates only the database property menus (plan 0.9.0, "Risks" and "First run") | Now proposal **#100**, which also takes "one language throughout" from #92 and adds a language setting of its own. If #100 is rejected, this line returns here as parked |

The 1.0.0 milestone above still names the five pains; pains 3, 4 and 5 therefore come back before
1.0.0, in a shape Érik chooses.

## Left for later from 0.8.0, and where it went

| From `docs/plans/release-0.8.0.md` | Goes to |
|---|---|
| Private page titles still visible in relation cells and links inside public pages | Later, with #91 (question to Érik on #82) |
| Inline AI actions still offered on a private page (refused when used) | Later, with #91 (question to Érik on #82) |
| Routine answers kept only in memory: closing the app before the persona speaks loses the day's answer | Later, with #93 |
| Import: non-image attachments come in as text; Notion relations and rollups come in as text | Polish pass before 1.0 |
| Backup comparison not measured on very large workspaces | Polish pass before 1.0 |
| Line citations in `docs/codebase-knowledge` need a pass | Ready for another developer |
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
