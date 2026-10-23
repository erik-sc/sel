# Team state

Read first, rewritten last, by the lead of each night's run.

```yaml
phase: PLAN            # PLAN | VETO | BUILD | CLOSE | AWAITING_SHIP
release: 0.9.0
release_pr: null       # number of the release/X.Y.Z -> main PR, once opened
team_log_comment: null # id of the "Team log" comment on that PR
veto_until: null       # ISO time, São Paulo
paused: false
last_run: 2026-10-23T12:00:00Z   # signals are read since this time
lock:
  since: null          # ISO time UTC while a run is going; cleared at the end
```

## Items

| Item | Branch | PR | Status | Notes |
|---|---|---|---|---|

## Last night

Team set up (`team/setup`). No run yet. v0.8.0 is the latest tag.

## Left for tomorrow

- First PLAN: replace the seed roadmap with the team's own, then write
  `docs/plans/release-0.9.0.md`.

## Screenshots for Érik

(none)
