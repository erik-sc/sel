# GitHub from a team run

GraphQL is unavailable from these sessions, so `gh pr list`, `gh pr view` and most `gh issue`
subcommands fail. Use `gh api` with REST routes. `R=repos/erik-sc/sel`.

## Pull requests

```sh
# open PRs into a branch
gh api "$R/pulls?state=open&base=release/0.9.0&per_page=100"
# the release PR
gh api "$R/pulls?state=open&base=main&head=erik-sc:release/0.9.0"
# open a PR (draft for the release PR)
gh api "$R/pulls" -f title='Release 0.9.0 — <theme>' -f head=release/0.9.0 -f base=main \
  -F draft=true -F body=@/tmp/body.md
# edit the body
gh api -X PATCH "$R/pulls/<n>" -F body=@/tmp/body.md
# mark ready for review (session proxy route; REST has none). If it fails, ask Érik in "Needs you".
gh api -X POST "$R/pulls/<n>/ccr/ready_for_review"
# merge with a merge commit
gh api -X PUT "$R/pulls/<n>/merge" -f merge_method=merge
```

## Comments, reviews and commands

```sh
# conversation comments on a PR or issue, since the last run
gh api "$R/issues/<n>/comments?since=<ISO time>&per_page=100"
# review comments (on lines) and reviews
gh api "$R/pulls/<n>/comments?since=<ISO time>"
gh api "$R/pulls/<n>/reviews"
# post / edit the Team log comment
gh api "$R/issues/<n>/comments" -F body=@/tmp/log.md
gh api -X PATCH "$R/issues/comments/<comment id>" -F body=@/tmp/log.md
# a review from the reviewer agent
gh api "$R/pulls/<n>/reviews" -f event=COMMENT -F body=@/tmp/review.md
```

Team posts appear as `erik-sc` too, because the session uses Érik's account. Every body the team
posts starts with `<!-- sel-team -->` and ends with `— sel team (automated)`. A command counts
only when the author is `erik-sc` and the body has no `<!-- sel-team -->`; a `/veto` from anyone
else is feedback.

```sh
gh api "$R/issues/<n>/comments?since=<ISO>" --jq '.[] | select(.user.login=="erik-sc" and (.body|contains("<!-- sel-team -->")|not)) | {id, created_at, body}'
```

## CI

```sh
gh api "$R/commits/<sha>/check-runs" --jq '.check_runs[] | {name, status, conclusion}'
# logs of a failed job
gh api "$R/actions/jobs/<job id>/logs"
```

CI runs on every pull request (and on pushes to main): typecheck and lint on Ubuntu, tests on
Windows, audit. A release branch has no CI of its own; its head is checked through the release PR.
Wait for it with Monitor and an until-loop on the check runs, not with sleep.

## Issues

```sh
gh api "$R/issues?state=all&since=<ISO time>&per_page=100"   # also returns PRs: skip items with .pull_request
gh api "$R/issues/<n>/labels" -f 'labels[]=triaged'
gh api "$R/issues/<n>/comments" -F body=@/tmp/reply.md
gh api -X PATCH "$R/issues/<n>" -f state=closed -f state_reason=completed
```
