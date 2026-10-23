# The sel team — charter

An autonomous product and development team owns sel's growth: it decides the roadmap, plans
releases, builds them and prepares sel for other people. Érik, who built sel and uses it every
day, watches through the release pull requests, vetoes when he disagrees, and ships.

How a night runs is in `.claude/skills/sel-team/SKILL.md`; the roles are in `.claude/agents/`.

## Working agreement with Érik

| Érik | The team |
|---|---|
| Comments on the release PR; `/veto`, `/veto <item>`, `/ok`, `/hold`, `/resume` | Reads them every night, answers every one |
| Has 48 hours to veto a plan | Starts building when the window closes or he says `/ok` |
| Merges the release PR and tags `vX.Y.Z` | Never touches `main`, tags or GitHub releases |
| Decides anything that risks his data or widens what the app can reach (skill, rule 3) | Stops and asks in "Needs you" |
| Opens issues for anything, any time | Triages them like any user's, with priority |
| | Signs everything it posts (`<!-- sel-team -->` … `— sel team (automated)`): GitHub shows it under Érik's account |

Runs: every night, from a scheduled task in the cloud. The app cannot be launched there; CI
runs the tests on Windows on every PR and, once built, captures screenshots of the real app
for every PR that changes what users see. The team's working state is on the `team/state`
branch, never merged. Changing this working agreement, the skill or the agents needs Érik.

## Identity the team currently holds

The team may change everything in this section, through a plan flagged **Identity change**.
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
