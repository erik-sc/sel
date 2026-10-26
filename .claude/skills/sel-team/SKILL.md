---
name: sel-team
description: Run sel's daily build - take the first approved feature from the backlog, implement it with a developer, review it (Opus) and screenshot it, and open one pull request into main that ships as a release when Érik merges it. Use when the daily scheduled task fires, or when Érik says "run the team" or "/sel-team".
---

# sel team — the daily build

Once a day a scheduled task in the cloud runs this skill. You are the **lead**. Your job is
**one feature, end to end, into one pull request to `main`**. When Érik merges that PR, the
release workflow tags and publishes it. That is the whole loop.

Features are chosen elsewhere: the weekly refinement (`.claude/skills/sel-refine/`) talks with
Érik and records what he approves in the backlog. You build only what is there.

Each run is a fresh session. Everything you know is in the repository and on GitHub. Tokens
cost money: stop early when there is nothing to do, and keep agents few.

## The team

| Role | Agent | Model | Does |
|---|---|---|---|
| Developer | `sel-dev` | Sonnet | builds the feature in its own worktree, tests, docs, release notes |
| Reviewer | `sel-reviewer` | Opus | independent review; never saw the code being written |
| Designer | `sel-designer` | Sonnet | reviews anything a user sees, from the screenshots |

Spawn them with the Agent tool (`subagent_type` = the agent name; if the session does not load
them as types, use a general-purpose agent with the file's content as its brief and its model).
You (the lead) do not write feature code.

## Rules

1. **One feature per day, one PR into `main`.** The PR's branch is named `release/X.Y.Z` so
   that merging it publishes (`.github/workflows/release.yml`). Never push to `main` directly,
   never tag, never merge your own PR: **Érik's merge is the release.**
2. **Build only approved features**, in backlog order. Never pick something that is not under
   "Approved". If the first one is too big for a day, build its first day-sized part, and leave
   the rest as the next Approved entry (say so in the backlog).
3. **Never lose user data.** Data formats older versions cannot open, `src/preload/reviewed/`,
   `.github/workflows/`, signing, updates, Electron's major or runtime `dependencies` are
   **sensitive**: they need two independent Opus reviews and a **Sensitive change** section in
   the PR body. The team's own files (`.claude/`, `docs/team/charter.md`, `docs/team/personas.md`)
   change only when an approved feature says so.
4. **Sign what you post.** GitHub shows team posts under Érik's account. Every body the team
   posts starts with `<!-- sel-team -->` and ends with `— sel team (automated)`.
5. English for code, commits and PRs. Use `gh api` with REST routes (GraphQL is unavailable);
   see `references/github.md`.
6. Budget: at most 5 hours of wall time. If the feature is not ready by then, push what you
   have, leave the PR as a draft with what is left, and continue it tomorrow (it stays first).

## Where things are

- **Backlog:** `backlog.md` on the branch `team/state` (never merged). Sections: **Approved**
  (ordered; the build order), **In progress**, **Proposed** (waiting for Érik), **Shipped**,
  **Rejected**. Written by the weekly refinement and by you. Format in
  `references/backlog-template.md`.
- **Lock and last run:** the yaml block at the top of `backlog.md`.
- **The code knowledge:** `docs/codebase-knowledge/INDEX.md` and `50-conventions.md`.

## The run

### 0. Quick exit (before cloning anything)

With `gh api` only, read `backlog.md` from `team/state`
(`gh api "repos/erik-sc/sel/contents/backlog.md?ref=team/state" --jq .content | base64 -d`).
Stop at once, changing nothing, and reply "Nothing to do." when:
- `lock.since` is set and less than 6 hours old (another run is going), or
- an open team PR into `main` is waiting for Érik (ready for review, CI green) and he has not
  commented on it since `last_run`, and "In progress" holds nothing else, or
- "Approved" is empty and nothing is in progress.

### 1. Start

Clone, set the lock (UTC time) in `backlog.md`, push `team/state`. Install Node 24 if needed
(`npm i --prefix /home/claude/node24 node@24`), `npm ci --ignore-scripts --no-audit --no-fund`.

### 2. Follow up on yesterday

- A team PR into `main` that **Érik merged**: move its entry to **Shipped** with the version and
  the release's link. If the release workflow failed, read its check-run annotations, fix the
  cause in a new `release/X.Y.Z` PR the same way, and say so in that PR.
- A team PR with **comments or change requests from Érik**: do them first, today's work is that.
- A team PR he **closed without merging**: move the entry back to Approved with his reason, or
  to Rejected if he said so.
- A draft left from yesterday: continue it (rule 6).

### 3. Build today's feature

1. Take the first **Approved** entry; move it to **In progress** with today's date.
2. Version: the next minor after the latest tag (`gh api repos/erik-sc/sel/releases?per_page=1`),
   or a patch for a pure fix. Cut `release/X.Y.Z` from `main`.
3. Spawn one `sel-dev` (`isolation: "worktree"`) with the entry's text as its brief. It builds,
   tests, updates docs and README, bumps `package.json` and `package-lock.json`, writes the
   release notes, and pushes the branch. It edits only the files it means to change.
4. Open the PR into `main` (title `Release X.Y.Z — <feature>`; body as below), ready for
   review, with a `screens` block when users see the change (see "Screenshots").
5. Wait for CI (Monitor with an until-loop on the check runs). Spawn a fresh `sel-reviewer`,
   and `sel-designer` for visible changes once the screenshots comment is there; two reviewers
   for sensitive changes. Send findings back to the same developer. At most two rounds.
6. Before leaving it for Érik: CI green; `package.json` on the PR head carries the new version;
   reviews say Approve. Otherwise leave it as a draft with what is missing (rule 6).

### 4. End

Update `backlog.md`: the entry stays **In progress** with the PR link until Érik merges; write
`last_run` (the time you started reading GitHub), clear the lock, push `team/state`. Reply with
two lines: the PR link and what Érik should look at.

## PR body

```
<!-- sel-team -->
# Release X.Y.Z — <feature>

<what changes for you, two or three sentences>

**Merge to release.** Merging this PR publishes vX.Y.Z (installer and update).

## What's in it
## Sensitive change   (only if any: what, why it is safe, how it was tested, both reviews)
## Release notes
## Not done / later

— sel team (automated)
```

## Screenshots

Every PR that changes what a user sees shows it. The PR body has a `screens` block, one
scenario per line (`id: what it shows`); adding a scenario the harness lacks is part of the
work. The CI job `screens` (Windows, the real app, a seeded demo workspace) captures head and
base and posts the before and after images on the PR. The designer reviews from them; a missing
or failed capture is a finding.

## When something goes wrong

- A crashed run leaves its lock; after 6 hours the next run takes over and resumes from the PR.
- A broken `main` after a merge: fix it as today's feature, ahead of the backlog.
- GitHub unreachable or a push refused: stop and say so in the reply.
