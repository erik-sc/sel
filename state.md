# Team state

```yaml
phase: AWAITING_SHIP           # PLAN | BUILD | CLOSE | AWAITING_SHIP
release: 0.9.0         # X.Y.Z once the PM has chosen it
release_branch: release/0.9.0 # release/X.Y.Z once cut
release_pr: 82         # number of the release PR; kept after it merges until the next one opens
team_log_comment: 6365752721 # id of the "Team log" comment on that PR
queue: []              # approved proposal issue numbers, in build order
merged_at: null        # when Érik merged the release PR (AWAITING_SHIP)
paused: false          # set by /hold, cleared by /resume
last_run: 2026-10-25T03:03:10Z # ISO UTC: time the signals were READ last run; next run reads after it
lock:
  since: 2026-10-25T22:00:00Z
  run: sched-1022
```

## Items

| Item | Branch | PR | Status | Nights | Notes |
|---|---|---|---|---|---|
| S0 | team/0.9.0/s0-screenshot-job | #88 | merged | 1 | da1e903; merged 2026-10-24 23:34 UTC from Érik's own session (his OK under rule 3) |
| A1a | team/0.9.0/a1a-any-block-beside | #103 | merged | 1 | 954a438; 1 design round |
| B1 | team/0.9.0/b1-name-property-on-add | #102 | merged | 1 | 3bc4326; 1 design round |
| C1 | team/0.9.0/c1-patch-bumps | #89 | merged | 1 | 53847d2 |
| A1b | team/0.9.0/a1b-drag-side-columns | #105 | merged | 1 | 6468512; 1 review round (slash ranking) |
| B3 | team/0.9.0/b3-select-options-menu | #104 | merged | 1 | 11b2e54; no rounds |
| C2 | team/0.9.0/c2-toolchain-majors | #90 | merged | 1 | 798acd1; 2 review rounds |
| A1c | team/0.9.0/a1c-typing-in-columns | #106 | merged | 2 | 1314ec9; 3 review rounds over 2 runs |
| B2 | team/0.9.0/b2-header-keyboard-insert | #107 | merged | 1 | 936ff76; 1 design round |

## Last night

2026-10-25 03:03–03:58 UTC manual run (BUILD → CLOSE → AWAITING_SHIP; the fire payload repeated
Érik's earlier ask for 3 new proposals, already done by the 23:31 run as #96–#98). Signals since
23:31:40: only the relayed "merge everything" note on #88 (S0 already merged). Merged main (#94
panel review skill) into release/0.9.0 (d4a8911). PM aligned the roadmap with all six open
proposals (5724cd8); all six already had Panel review sections. A1c fixed by a new dev, approved
by a fresh reviewer and the designer, merged (#106, 1314ec9). CLOSE: PM plan Delivered/Left for
later, decisions, roadmap (01eb8aa); dev codebase-knowledge (83c9c1e) and version 0.9.0 (6639bec);
growth README/site (81dc733), screenshots columns.webp + property-menu.webp (569d2eb), release
notes in #82 body. #82 body has a `screens` block with `all`. #82 head 569d2eb: typecheck/test
green; screens capturing at end of run. PR already non-draft (ready for review).

## Left for tomorrow

- AWAITING_SHIP: no commits to release/0.9.0 unless Érik asks in a comment. Watch: #82 merged →
  set merged_at; tag v0.9.0 → reset state, phase PLAN. Merged but no tag after 2 days → ask.
- Read signals since 2026-10-25T03:03:10Z (Needs you: ship, confirm pain 2, pick a proposal,
  database undo in 0.9.0 or not, `/2` `/3`, private-from-AI leaks, team/screens size).
- Backlog upkeep: PM drafts a "database undo" proposal (Undo toast on option delete first) and runs
  it through the panel; PM applies the pending panel changes to #96–#98; fix #100's claim that the
  0.9.0 plan promises 0.11.0.
- Check the full `all` screenshot comment on #82 posted for 569d2eb; if it failed, say so.
- Env: Node 24 via `npm i --prefix /home/claude/node24 node@24`; plain `git fetch origin` fails on
  team/screens — use explicit refspecs; compound gh/git loops in agent worktrees get refused — use
  scripts; merge via GitHub MCP `merge_pull_request`; pushes to the release branch cancel an
  in-progress screens run on the release PR; sel-panel is not loaded as an agent type here —
  spawn general-purpose with `.claude/agents/sel-panel.md` as the brief.

## Screenshots for Érik

- Hover a row of columns (gap line fades in); narrow window wrapping a row (no stray line).
- Drag a block to the left side of another; into a gap of a row of 3; onto a full row of 4.
- In a column: Enter twice (does leaving read clearly?); Enter at the start then Backspace.
- Drag an option by its handle in a select's column menu; Esc in the option pane goes back.
- Table: ArrowUp from a cell to the headers, Left/Right/End to "+", Enter → Insert right → Esc.
