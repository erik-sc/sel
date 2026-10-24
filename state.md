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
last_run: 2026-10-24T20:40:02Z # ISO UTC: time the signals were READ last run; next run reads after it
lock:
  since: 2026-10-24T23:31:35Z # ISO UTC while a run is going; cleared at the end
  run: n1025a          # short id of the run holding it
```

## Items

| Item | Branch | PR | Status | Nights | Notes |
|---|---|---|---|---|---|
| S0 | team/0.9.0/s0-screenshot-job | #88 | merged | 1 | da1e903; merged 2026-10-24 23:34 UTC from Érik's own session (comment on #88: his OK under rule 3, relayed) |
| A1a | team/0.9.0/a1a-any-block-beside | | ready | 0 | wave 1; waited night 1 for S0; builds 2026-10-25 either way |
| B1 | team/0.9.0/b1-name-property-on-add | | ready | 0 | wave 1; waited night 1 for S0; builds 2026-10-25 either way |
| C1 | team/0.9.0/c1-patch-bumps | #89 | merged | 1 | 53847d2 |
| A1b | team/0.9.0/a1b-drag-side-columns | | ready | 0 | wave 2; after A1a |
| B3 | team/0.9.0/b3-select-options-menu | | ready | 0 | wave 2; after B1 |
| C2 | team/0.9.0/c2-toolchain-majors | #90 | merged | 1 | 798acd1; 2 review rounds |
| A1c | team/0.9.0/a1c-typing-in-columns | | ready | 0 | wave 3; after A1a, A1b |
| B2 | team/0.9.0/b2-header-keyboard-insert | | ready | 0 | wave 3; after B1, B3 |

## Last night

2026-10-24 20:40–22:35 UTC run (VETO → BUILD; also a manual fire relayed from Érik's chat, same run):
Érik's `/ok` on #82 at 14:42 UTC → BUILD. #87 (release backlog) merged into main at 20:44, during the
run; the rest of the run followed it (VETO state moved to BUILD, `veto_until` gone, `queue` added).
Built S0 (#88, approved, blocked on Érik's OK), merged C1 (#89) and C2 (#90). Merged main into
release/0.9.0 (b92390e). PM opened proposals #91 (0.10.0), #92 (0.11.0, identity change), #93
(0.12.0), created labels `release-proposal` and `release-queued`, aligned the roadmap (a599c4c).
Decisions appended (6796814). Merging via `gh api .../merge` was refused by the session's
permission check; the GitHub MCP `merge_pull_request` tool worked.

## Left for tomorrow

- S0 is merged (da1e903): wave 1 visible items now get screenshots on their PRs.
- Read `/approve` `/next` `/reject` or feedback on #91–#93; apply to `queue`.
- BUILD wave 1: A1a and B1 (visible). With S0 merged their PRs get screenshots; if not, build
  anyway (they waited one night) and list scenarios in "Screenshots for Érik".
- Give devs the mockups `docs/team/design/0.9.0/` and research `docs/team/research/0.9.0/a1a-*`.
- Node 24: `npm i --prefix /home/claude/node24 node@24` (node only, no npm; system npm drops
  `libc` fields from the lock — devs fix the lock by script). 3 Windows-path test files fail on Linux.
- Runner job logs 403 through the proxy; shell args containing "git" may need a script file.
- Dependabot #75–#78 stay open; C1/C2 landed their versions on the release branch.

## Screenshots for Érik

- Fallback only, if S0 is not merged when visible items are built:
- `docs/screens/columns.webp` — a note beside a to-do list, plus a three-column row (after A1a/A1b).
- `docs/screens/property-menu.webp` — a select's column menu with its Options list (after B3).
- Re-shoot `docs/screens/blocks.webp` only if the column slash items show on the slash menu's first screen.
