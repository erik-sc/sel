# Team state

```yaml
phase: BUILD           # PLAN | BUILD | CLOSE | AWAITING_SHIP
release: 0.9.0         # X.Y.Z once the PM has chosen it
release_branch: release/0.9.0 # release/X.Y.Z once cut
release_pr: 82         # number of the release PR; kept after it merges until the next one opens
team_log_comment: 6365752721 # id of the "Team log" comment on that PR
queue: []              # approved proposal issue numbers, in build order
merged_at: null        # when Érik merged the release PR (AWAITING_SHIP)
paused: false          # set by /hold, cleared by /resume
last_run: 2026-10-24T23:31:40Z # ISO UTC: time the signals were READ last run; next run reads after it
lock:
  since: null          # ISO UTC while a run is going; cleared at the end
  run: null            # short id of the run holding it
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
| A1c | team/0.9.0/a1c-typing-in-columns | #106 | needs another night | 1 | head 22bdb9e, CI green; design OK after round 1? (designer's blocker fixed, not re-checked by designer); reviewer round 2 blocker: structure.ts:278-288 `liftFirstLinePlan` lifts any text-type first line incl. toggle/list/to-do and nests the head's other lines under it (collapsed toggle hides them). Fix: if `HOLDS_ITS_CHILDREN.has(fb.type)` and the head has other live lines → return null (caret moves back); test with collapsed toggle and list item first lines. Review 5641252964 |
| B2 | team/0.9.0/b2-header-keyboard-insert | #107 | merged | 1 | 936ff76; 1 design round |

## Last night

2026-10-24 23:31 – 2026-10-25 03:05 UTC run (BUILD). Signals: Érik `/reject` on #91–#93 (closed,
kept under roadmap "Later") and his ask on #82 for smaller, concrete proposals with new ideas → PM
opened #96, #97, #98 (9e136d3). S0 merged by Érik's session at 23:34 (after signals were read).
Built and merged B1 (#102), A1a (#103), B3 (#104), A1b (#105), B2 (#107); A1c (#106) left with one
blocker after 2 rounds. Plan status updated (4d3d237). Team log and PR body updated. Proposals
#99–#101 appeared at 23:44 signed as the team but not from this run (PM confirmed) — probably
Érik's own session; not in the roadmap. Another session also committed to team/state at 23:35
while this run held the lock (df8976f, recorded S0 merged).

## Left for tomorrow

- Read signals since 2026-10-24T23:31:40Z — includes Érik's relayed "merge everything" note on #88
  (23:34) and anything on #96–#101 and #82 (Needs you: db undo, `/2` `/3`, private-from-AI leaks).
- A1c (#106): send the reviewer's round-2 blocker to a dev (new agent; read the PR and review
  5641252964), then fresh reviewer + designer re-check; merge when green and approved.
- Then CLOSE: growth (README, site, release notes, docs/screens via `all` screens block), dev
  (codebase-knowledge, version 0.9.0), PM (Delivered / Left for later, decisions, roadmap incl.
  #99–#101 if kept); mark #82 ready for review.
- Left-for-later candidates from reviews: Undo for database edits (Undo toast on option delete);
  version viewer wide rows (versions.css); scenario for Settings › Appearance "Narrowest column";
  `uniqueName` " 1" vs " 2"; option pane words in pt-BR; slash "Blocks" header in pt-BR; relation/rollup
  labels cut at 240 px; header click leaves ring on first cell; P1–P4 deletable from cell picker;
  insert on a linked view test; empty bullet leaving a row stays a bullet.
- Env: Node 24 via `npm i --prefix /home/claude/node24 node@24`; plain `git fetch origin` fails on
  force-updated team/screens — use explicit refspecs; compound gh/git shell loops in agent worktrees
  get refused — use scripts; merging works via GitHub MCP `merge_pull_request`; harness moves the
  pointer off the window before capture (no hover shots; use focus or dispatched drag events).

## Screenshots for Érik

- Hover a row of columns: the gap line fades in; narrow window wrapping a row: no stray line.
- Drag a block to the left side of another; into a gap of a row of 3; onto a full row of 4.
- Drag an option by its handle in a select's column menu; Esc in the option pane goes back.
- In a column, Enter twice: does leaving the row read clearly?
- Table: ArrowUp from a cell to the headers, Left/Right/End to "+", Enter → Insert right → Esc.
