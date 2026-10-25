# Team state

```yaml
phase: BUILD                   # PLAN | BUILD | CLOSE | AWAITING_SHIP
release: 0.10.0        # X.Y.Z once the PM has chosen it
release_branch: release/0.10.0 # release/X.Y.Z once cut
release_pr: 114        # number of the release PR; kept after it merges until the next one opens
team_log_comment: 6404436624 # id of the "Team log" comment on that PR
queue: [100, 98, 97, 96]              # approved proposal issue numbers, in build order
merged_at: null        # when Érik merged the release PR (AWAITING_SHIP)
paused: false          # set by /hold, cleared by /resume
last_run: 2026-10-25T22:00:00Z # ISO UTC: time the signals were READ last run; next run reads after it
lock:
  since: 2026-10-25T22:40:00Z
  run: sched-1022
```

## Items

| Item | Branch | PR | Status | Nights | Notes |
|---|---|---|---|---|---|
| E1a | team/0.10.0/select-keys | #115 | merged | 1 | 7a86cd3; 2 rounds |
| E1b | team/0.10.0/select-strip | #116 | needs another night | 1 | 2 rounds used. Open: pt-BR strip overflows (scrollbar), Herman covers it; fix width at 1280/480 or one "Alterar" menu; then re-review (reviewer ab611a2ad3ab4b792-type fresh ok) and merge |

## Last night

2026-10-25 evening scheduled run: 0.9.0 was merged (tag v0.9.0). Érik approved #101,#100,#98,#97,#96 (in that order), rejected #99. Cut release/0.10.0, PM plan (1d6f953), draft PR #114, #101 closed. E1a merged (#115). E1b #116 at head 4393c5c: CI green, reviewer and designer both want the pt-BR strip fixed.

## Left for tomorrow

- Finish E1b; then CLOSE (growth, dev knowledge/version 0.10.0, PM delivered/roadmap, PR ready).
- #98 follows #97 in its text but Érik ordered #98 first: flagged in Team log.
- Env: job logs are proxy-blocked (use check-run annotations and the sel-screens comment); Node 24 via `npm i --prefix /home/claude/node24 node@24`; use script files, not heredoc python after cd.
