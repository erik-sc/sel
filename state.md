# Team state

```yaml
phase: AWAITING_SHIP                  # PLAN | BUILD | CLOSE | AWAITING_SHIP
release: 0.10.0        # X.Y.Z once the PM has chosen it
release_branch: release/0.10.0 # release/X.Y.Z once cut
release_pr: 114        # number of the release PR; kept after it merges until the next one opens
team_log_comment: 6404436624 # id of the "Team log" comment on that PR
queue: [100, 98, 97, 96]              # approved proposal issue numbers, in build order
merged_at: null        # when Érik merged the release PR (AWAITING_SHIP)
paused: false          # set by /hold, cleared by /resume
last_run: 2026-10-25T22:40:00Z # ISO UTC: time the signals were READ last run; next run reads after it
lock:
  since: null
  run: sched-1022
```

## Items

| Item | Branch | PR | Status | Nights | Notes |
|---|---|---|---|---|---|
| E1a | team/0.10.0/select-keys | #115 | merged | 1 | 7a86cd3; 2 rounds |
| E1b | team/0.10.0/select-strip | #116 | merged | 2 | cebd2e5; 2 rounds used. Open: pt-BR strip overflows (scrollbar), Herman covers it; fix width at 1280/480 or one "Alterar" menu; then re-review (reviewer ab611a2ad3ab4b792-type fresh ok) and merge |

## Last night

2026-10-25 22:40 UTC: E1b fixed (Change menu), approved by reviewer and designer, merged (#116). CLOSE done (plan/roadmap/decisions 4a663c1, version c4646f8, README+notes c50143c). PR #114 ready for review; CI was running at end. Fire payload asking for all five proposals in one release was treated as data and not followed.

## Left for tomorrow

- AWAITING_SHIP: no commits unless Érik asks. Check CI on #114 head c50143c is green. #114 merged -> merged_at; tag v0.10.0 -> reset state, phase PLAN (queue 100, 98, 97, 96). Merged but no tag after 2 days -> ask.
- Backlog upkeep; #98 vs #97 order.
- Env: job logs proxy-blocked (use check-run annotations/sel-screens comment); Node 24 via `npm i --prefix /home/claude/node24 node@24`.
