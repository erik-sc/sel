# The sel team — charter

A small autonomous team grows sel one feature a day. Érik, who built sel and uses it every day,
decides which features get built (in a weekly conversation) and ships each one by merging it.

- Daily build: `.claude/skills/sel-team/SKILL.md` (developer, Opus reviewer, designer).
- Weekly refinement: `.claude/skills/sel-refine/SKILL.md` (suggestions attacked by the persona
  panel in `docs/team/personas.md`, then talked through with Érik in chat).
- The backlog both read and write: `backlog.md` on the `team/state` branch, never merged.

## Working agreement with Érik

| Érik | The team |
|---|---|
| Once a week, answers the refinement in chat: approves, reorders, changes or rejects suggestions | Brings 3 to 5 day-sized suggestions with the panel's verdict; records his answers in the backlog |
| Can also approve or reorder features in any chat with Claude about sel | Builds only Approved entries, in order, one a day |
| Merges the day's PR into `main` when he is happy with it: **the merge is the release** | Opens exactly one PR per feature, from `release/X.Y.Z`, version bumped, CI green, reviewed, with screenshots; never merges it |
| Comments on the PR for changes | Makes them first, the next day |
| | Sensitive changes need two independent Opus reviews and are named in the PR |
| | Signs everything it posts (`<!-- sel-team -->` … `— sel team (automated)`): GitHub shows it under Érik's account |

Runs: the daily build every day at 22:43 São Paulo time and the refinement every Sunday at
19:17, both scheduled tasks in the cloud. A run with nothing to do stops at once. The app cannot
be launched in the cloud; CI runs the tests and captures screenshots of the real app on Windows.

## Identity the team currently holds

The team may propose changes to this section in the weekly refinement, flagged **Identity change**; only Érik approves them.
It starts from what Érik said on 2026-10-21:

- **What sel is:** an offline, open-source Notion with enhanced tasks that tries to calm your
  to-dos through zen mechanics. Built to replace Notion with an app its owner controls and
  can extend.
- **Two verticals.**
  - **D — databases and tasks** (tasks are an extension of databases): pages and blocks,
    formulas, relations and calculations, search and commands, archive and home, history and
    backups, sync, MCP, calendar, reminders, meeting recording, focus mode.
  - **Z — zen:** Meditations, the Sky, Close the day, the persona.
  - **Today** is the bridge between D and Z. **The persona** (Herman, or Hermine) crosses both.
- **Optional extras**, installed but off by default on fresh installs: templates, LaTeX,
  pomodoro, in-app feedback, appearance presets.
- **The persona:** a mix of rules and AI; proposes, never writes on its own (assisted, never
  autonomous); reminds what was left undone and occasionally suggests; no web search.
- **Principles:** local-first, nothing leaves the machine except through the user's own Claude
  Code; no score, streak or notification nobody asked for; anything that runs by itself can be
  turned off and has a limit; the look matters.
- **Audience:** developers first (git sync, Claude Code, MCP); eventually anyone. Windows
  first; macOS and Linux at very low priority.
- **Releases:** thematic, one theme each. Polish before novelty.
