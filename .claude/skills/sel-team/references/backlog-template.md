# sel backlog

Lives only on the branch `team/state` as `backlog.md` (never merged). The weekly refinement
(`sel-refine`) adds Approved and Proposed entries from its conversation with Érik; the daily build
(`sel-team`) takes the first Approved entry, moves it to In progress, then to Shipped.

```yaml
last_run: null        # ISO UTC; the daily build reads GitHub signals after this
lock:
  since: null         # ISO UTC while a run is going; cleared at the end
```

## Approved

Build order, top first. Each entry: a heading, the date Érik approved it and where (chat or
issue), then the brief.

### <feature title>
Approved by Érik, <date>, <where>.
**What changes for you.** …
**Scope.** …
**Not in scope.** …
**Touches.** …
**Done when.** …
**Sensitive.** no / yes: …

## In progress

- <feature> — PR #<n>, started <date>

## Proposed

Suggestions not yet answered by Érik (same format as Approved, without the approval line).

## Shipped

- vX.Y.Z — <feature> — PR #<n> — <date>

## Rejected

- <feature> — <date> — <Érik's reason>
