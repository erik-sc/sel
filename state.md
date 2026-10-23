# Team state

```yaml
phase: VETO            # PLAN | VETO | BUILD | CLOSE | AWAITING_SHIP
release: 0.9.0         # X.Y.Z once the PM has chosen it
release_branch: release/0.9.0 # release/X.Y.Z once cut
release_pr: 82         # number of the release PR; kept after it merges until the next one opens
team_log_comment: 6365752721 # id of the "Team log" comment on that PR
veto_until: 2026-10-25T10:15:07-03:00 # ISO time with offset (São Paulo)
merged_at: null        # when Érik merged the release PR (AWAITING_SHIP)
paused: false          # set by /hold, cleared by /resume
last_run: 2026-10-23T13:00:19Z # ISO UTC: time the signals were READ last run; next run reads after it
lock:
  since: 2026-10-23T13:42:08Z # ISO UTC while a run is going; cleared at the end
  run: r1341            # short id of the run holding it
```

## Items

| Item | Branch | PR | Status | Nights | Notes |
|---|---|---|---|---|---|
| A1a | team/0.9.0/a1a-any-block-beside | | ready | 0 | wave 1 |
| B1 | team/0.9.0/b1-name-property-on-add | | ready | 0 | wave 1 |
| C1 | team/0.9.0/c1-patch-bumps | | ready | 0 | wave 1; supersedes #77, #78, electron part of #75 |
| A1b | team/0.9.0/a1b-drag-side-columns | | ready | 0 | wave 2; after A1a |
| B3 | team/0.9.0/b3-select-options-menu | | ready | 0 | wave 2; after B1 |
| C2 | team/0.9.0/c2-toolchain-majors | | ready | 0 | wave 2; after C1; must run `npm run build` locally |
| A1c | team/0.9.0/a1c-typing-in-columns | | ready | 0 | wave 3; after A1a, A1b |
| B2 | team/0.9.0/b2-header-keyboard-insert | | ready | 0 | wave 3; after B1, B3 |

## Last night

2026-10-23 (first night): bootstrapped `team/state`. No signals from Érik. PM rewrote the
roadmap and wrote the 0.9.0 plan (pain 2); designer added Design notes (PM accepted her three
scope changes: column widths for 3–4 columns, no double-click rename in B2, no empty state in
B3); growth added "For other people". Cut `release/0.9.0`, opened draft PR #82, posted the
Team log. Node 24 install failed in the cloud (Node 22); nothing built.

## Left for tomorrow

- Read Érik's answers on PR #82: pain 1 solved?, pain 2 reading, 0.8.0 decisions.
- VETO: only no-behaviour work. Designer mockups in `docs/team/design/0.9.0/` (A1b drop line
  and row hairlines, B1 add menu, B3 options section); research for A1a and C2.
- Dependabot PRs #75–#78 stay open; C1/C2 land the same versions on the release branch.

## Screenshots for Érik

- `docs/screens/columns.webp` — a note beside a to-do list, plus a three-column row (after A1a/A1b).
- `docs/screens/property-menu.webp` — a select's column menu with its Options list (after B3).
- Re-shoot `docs/screens/blocks.webp` only if the column slash items show on the slash menu's first screen.
