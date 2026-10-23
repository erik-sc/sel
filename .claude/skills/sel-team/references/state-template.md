# Team state

Lives only on the branch `team/state` (never merged anywhere). Read first and rewritten last by
the lead of each night's run. To bootstrap: create `team/state` as an orphan branch holding
only this file, with the values below.

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
  since: null          # ISO UTC while a run is going; cleared at the end
  run: null            # short id of the run holding it
```

## Items

| Item | Branch | PR | Status | Nights | Notes |
|---|---|---|---|---|---|

Status: `ready` · `building` · `in review` · `needs another night` · `blocked: needs Érik`
· `merged` · `dropped` · `moved to later`. "Nights" counts nights the item was worked on.

## Last night

## Left for tomorrow

## Screenshots for Érik

## Reset when a new release starts

When the shipped release is confirmed (merged and tagged): `release`, `release_branch`,
`veto_until`, `merged_at`, the Items table, "Left for tomorrow" and "Screenshots for Érik" are
cleared. `release_pr` and `team_log_comment` keep pointing at the shipped PR (Érik's `/hold`
there still counts) until the new release PR is opened, which replaces both. `paused` and
`last_run` are kept.
