# Team state

```yaml
phase: PLAN            # PLAN | VETO | BUILD | CLOSE | AWAITING_SHIP
release: null          # X.Y.Z once the PM has chosen it
release_branch: null   # release/X.Y.Z once cut
release_pr: null       # number of the release PR; kept after it merges until the next one opens
team_log_comment: null # id of the "Team log" comment on that PR
veto_until: null       # ISO time with offset (São Paulo)
merged_at: null        # when Érik merged the release PR (AWAITING_SHIP)
paused: false          # set by /hold, cleared by /resume
last_run: null         # ISO UTC: time the signals were READ last run; next run reads after it
lock:
  since: 2026-10-23T13:00:01Z # ISO UTC while a run is going; cleared at the end
  run: nightly-2026-10-23 # short id of the run holding it
```

## Items

| Item | Branch | PR | Status | Nights | Notes |
|---|---|---|---|---|---|

## Last night

## Left for tomorrow

## Screenshots for Érik
