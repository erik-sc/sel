# Roadmap to 2.0.0

Owned by `sel-pm`. Rewritten as the team learns; the history is in git.

Status: **seed** · 2026-10-23 · written from Érik's input before the team's first night.
The team's first PLAN replaces this with its own reading of the code, the plans and the issues.

## Milestones (Érik's, 2026-10-21)

- **1.0.0 — usable and polished.** Usability, tasks and the persona polished, at least the
  pains below.
- **2.0.0 — solid verticals, minimum clicks.** Both verticals coherent and good UX throughout.

## Pains Érik named, in his order (2026-10-21)

1. Handling the inbox (moving, dating, prioritising opens the task screen; awkward).
   *0.7.0 item 9 (tasks: capture, refine, schedule) addressed it; check whether it is solved.*
2. Database usability: multi-column page layout does not work; too many clicks to edit columns.
3. The persona creating real pages and databases (a finances page came out weak).
4. The persona being proactive: reminding what was left undone, suggesting occasionally.
   *0.8.0 epic C (routines) started this; check against what he asked.*
5. Making the verticals clear (extras off by default on fresh installs).

Set aside for now: faster meeting transcription (~1 h last time).

## Releases so far

| Version | Theme |
|---|---|
| 0.7.0 | Consolidation: performance, keyboard and screen reader, visible failures, one folder per feature, tasks capture/refine/schedule, design system and Herman 64 |
| 0.7.1, 0.7.2 | Fixes; Council and other CLIs removed; context and MCPs for Claude |
| 0.8.0 | A persona that keeps you company: onboarding, Hermine, memory, balloon chat, routines, activity heatmaps, week and agenda, import/export/restore |

## Left for later from 0.8.0

From `docs/plans/release-0.8.0.md`, "Falta / para depois": private page titles still visible in
relation cells and links; inline AI actions still offered on private pages; routine answers lost
if the app closes before the persona speaks; non-image attachments and Notion relations imported
as text; backup comparison not measured on very large workspaces; line citations in
`docs/codebase-knowledge` need a pass. Plus the decisions the 0.8.0 agents took on their own,
listed in that plan, for Érik to review.

## Not doing (and why)

- Web search for the persona: Érik decided against it.
