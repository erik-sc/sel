# sel backlog

Lives only on this branch (`team/state`, never merged). The weekly refinement (`sel-refine`) adds
Approved and Proposed entries from its conversation with Érik; the daily build (`sel-team`) takes
the first Approved entry, builds it as one release PR into main, and moves it to Shipped when
Érik merges. Format: `.claude/skills/sel-team/references/backlog-template.md` on main.

```yaml
last_run: 2026-10-26T21:00:00Z
lock:
  since: null
```

## Approved

Moved here from the old release queue on 2026-10-26. Each brief is the full text of its GitHub
issue (read it with `gh api repos/erik-sc/sel/issues/<n> --jq .body`), including its Panel
review. Most are bigger than one day: build them one day-sized part at a time (sel-team rule 2)
and leave the rest of each here, first.

### Meetings processed on your other computer, over your Wi-Fi (#117)
Approved by Érik, 2026-10-26, on #117 (`/approved`, then `/next`: he wants it first).
**Brief.** Issue #117. Suggested day-sized parts, in order: (1) R3, the more useful write-up and
"Send next steps to Tasks"; (2) R2's pairing and the local server on the processor (Sensitive);
(3) R1's send from the laptop, the queue and resumable upload (Sensitive); (4) R2's processing on
the other computer and R4's notice; README line.
**Sensitive.** yes: a new network listener and pairing (R1, R2).

### sel in your language (#100)
Approved by Érik, 2026-10-25, on #100. **Brief.** Issue #100.

### Long pages you can work in (#98)
Approved by Érik, 2026-10-25, on #98. **Brief.** Issue #98, with its Panel review
recommendations (whole-word and match-case in Replace; a Ctrl+K "Go to heading" instead of the
margin outline).

### Land where you meant to go (#97)
Approved by Érik, 2026-10-25, on #97. **Brief.** Issue #97, with its Panel review
recommendations (select the block on arrival; keep the place on Today, Tasks and Calendar; mark
the matched word).

### Text that behaves like the rest of Windows (#96)
Approved by Érik, 2026-10-25, on #96. **Brief.** Issue #96; the panel recommends plain paste
(Ctrl+Shift+V) first and a right-click menu styled like sel's own.

## In progress

(none)

## Proposed

- Database edits you can take back (#112) — waiting for Érik.
- From your notes to your tasks (#113) — waiting for Érik.
- Duplicate a task (proposed 2026-10-26, refinement) — waiting for Érik. Row menu + Ctrl+K "Duplicate" (Ctrl+D only if free): copies title, project, labels, priority, repeat; reopens; no subtasks; past dates not copied; toast names a repeat; Esc keeps the copy; one Undo. Touches TaskRow.tsx, tasks/copy.ts, database/actions.ts duplicateRow, shortcuts catalog. Panel: for.
- Finish "Select several tasks" (proposed 2026-10-26) — waiting for Érik. Pick any date for many (same picker and typed field as the chips, keyboard only) + aria-selected on rows. Touches BulkPopover.tsx, bulk.ts, SelectionBar.tsx, TaskRow.tsx. Panel: indifferent except the date.
- Dark-mode pass on Today and Tasks (proposed 2026-10-26) — waiting for Érik. Fix only token pairs failing AA, change the token once; real combinations tested (chip on selection strip/hover); before/after dark screenshots via e2e/screens/scenarios/today.ts, tasks.ts. Panel: mixed (Lia against).

## Shipped

- v0.10.0 — Select several tasks (#101) — PR #114, version fix #118 — 2026-10-26
- v0.9.0 — Pages and databases you can shape — PR #82 — 2026-10-25

## Rejected

- Today, with fewer clicks (#99) — 2026-10-25 — `/reject`
- A persona that builds for real (#91), Two verticals, clearly (#92), A persona that remembers
  what was left undone (#93) — 2026-10-24 — "not a priority right now"
