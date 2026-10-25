# Release 0.10.0 — Select several tasks

Status: **building** · 2026-10-25 · branch `release/0.10.0`

You refine tasks and add what to do today. When fifteen tasks share a project, or five should all be
"tomorrow", every change is a chip click per task. A database table in sel already has what is
missing: select rows, then edit one property of all of them (`src/renderer/src/database/bulkEdit.tsx`,
`editCells` in `src/renderer/src/database/actions.ts:664`, which also completes repeating tasks
correctly through `completeTaskOps`). The Tasks screen has no selection (`TaskRow.tsx` and
`TasksScreen.tsx` hold none). This release brings it there, with no new data and no new write path.

Approved in #101 (its title guessed 0.12.0; the real version is 0.10.0 because it is the head of
Érik's queue: #101, #100, #98, #97, #96).

**Re-check against today's code (2026-10-25).** The proposal said this release "reuses the Let go and
tomorrow moves of 0.10.0 (A3)" from proposal #99. Érik rejected #99, so nothing of that exists. The
approved scope already describes Let go in full, so it is built here, inside E1b, with its own copy;
no scope changed. Also gone: the "Overdue menu of 0.10.0" (also #99); Today and the Calendar keep
their rows exactly as they are. What exists and is reused: `deleteTask` in `tasks/edit.ts:129` (moves
one task to Trash with an Undo toast; the Delete key on one row already does this), `actions.deleteRows`
and `actions.restoreRows`, `editCells`. "Tomorrow" is already an entry of the date menu.

**Principles for every item.** Quiet: a selection is only what you made, nothing is selected by sel.
Keyboard first, mouse as well. Every change is one batch and one Undo toast. Announcements are polite
and short ("3 selected"). Words in English and pt-BR (`tasks/copy.ts`, both locales). Typecheck, lint,
tests green; `screens` blocks.

## Epic E — Several at once

### E1a. Selection in the Tasks lists: the model and the keys

**Today.** `TaskRow` (`src/renderer/src/tasks/TaskRow.tsx`) is one Tab stop per list with arrows
(`useTaskRows`, line 431; its `onKeyDown` returns early when Shift is held); a click opens the panel
(`onClick`, line 204); Ctrl+click opens a tab. `rowKeyAction` (`tasks/model.ts`) maps `D`, `R`, `L`,
`1`-`4`, `#`, `@`, Space, F2 and Delete for one row. `editCells` (`database/actions.ts:664`) applies
one change to many rows. `TasksScreen.tsx` builds the row list at line 189 and renders `TaskRow`
around line 423.

**Scope.**
- A selection in the Tasks lists (`TasksScreen.tsx` only): `Shift+Up/Down` extends it from the focused
  row, `Shift+click` selects a range, `Esc` clears; "Select all in this list" is a Ctrl+K command and a
  row-menu entry. Plain click and Ctrl+click are unchanged. Selected rows are marked by more than colour
  (`aria-selected`, a visible mark), and "3 selected" is announced politely.
- The keys act on the selection when it has two or more rows: `D` opens the date menu for all, `1`-`4`
  set the priority, `#` the project, Space the done state, all through `editCells` (repeating tasks move
  on, completions are dated), one batch and one Undo toast each. `R`, `L`, `@` and F2 stay single-task and
  are ignored with several selected. The Delete key is ignored on a multiple selection.
- `useTaskRows` keeps its single Tab stop; the selection never changes it.

**Out of scope.** The strip and Let go (E1b); Today and the Calendar; drag of a selection; labels and
repeat for many; selection across lists.

**Touches.** `src/renderer/src/tasks/TaskRow.tsx`, `tasks/model.ts`, `tasks/TasksScreen.tsx`, new
`tasks/selection.ts`, `tasks/copy.ts`, `tasks/row.css`, `src/renderer/src/commands/builtin.ts` (the
select-all command; its spec type lives in `src/shared/tasks/api.ts`), tests (`tasks/model.test.ts`,
`tasks/TaskRow.test.tsx`, new `selection.test.ts`).

**Done when.** Shift+Down twice selects three rows; `D` then Tomorrow sets all three and one Undo
restores them; `2` sets priority on all; Space on repeating tasks moves them to their next dates; Esc
clears; a plain click still opens the panel; `useTaskRows` still has one Tab stop; `R`/`L`/`@`/F2/Delete
do nothing with several selected. Unit tests for the selection model (range, extend, clear, a row that
leaves the list) and for the keys; component test in `TaskRow.test.tsx`.

**Design.** To be written by sel-designer on the PR from the screenshots.

### E1b. The strip and Let go

**Today.** Nothing: Delete moves one task to Trash (`deleteTask`, `tasks/edit.ts:129`).

**Scope.**
- A thin, optional strip at the foot of the list, "3 selected", with the same actions as buttons for
  the mouse and **Let go**. It appears only when two or more rows are selected, and does not cover the
  add line (the designer decides its place).
- **Let go** moves the selection to Trash (restorable), one Undo toast (`actions.deleteRows`,
  `actions.restoreRows`, as `deleteTask` does for one). It is not "done" (finished tasks become Sky
  dust). With more than one row it asks once, "Let go of 3 tasks?", naming the count. The strip has no
  Delete; Let go is the only way for many. Copy in en and pt-BR ("Let go" / "Deixar ir").

**Out of scope.** Today and the Calendar's list; a trash screen change; anything about the single-task
Delete key.

**Touches.** new `src/renderer/src/tasks/SelectionBar.tsx`, `tasks/TasksScreen.tsx`, `tasks/edit.ts`
(a `letGoTasks` next to `deleteTask`), `tasks/copy.ts`, `tasks/tasks.css`, tests; screens scenarios in
`e2e/screens/`.

**Done when.** The strip is absent with one row selected and present with two; its buttons do what the
keys do; Let go asks once with the count and Undo brings the rows back from Trash in their order;
nothing leaves Trash it did not put there. Screens: `tasks-selected`, `tasks-selected-pt`,
`tasks-let-go`.

```screens
tasks-selected: the Tasks list with three rows selected and the strip at the foot
tasks-selected-pt: the same, in Portuguese (pt-BR)
tasks-let-go: the "Let go of 3 tasks?" confirmation
```

**Design.** To be written by sel-designer on the PR from the screenshots.

## Waves
| Wave | Items | Why |
|---|---|---|
| 1 | E1a | The model and the keys; E1b stands on it |
| 2 | E1b | Same files (`TasksScreen.tsx`, `copy.ts`), needs the selection from E1a |

## Risks
- Shift+click and Shift+arrows must not break the row's Tab-stop model; `TaskRow.test.tsx` already pins it.
- The strip at the foot may cover the add line; the designer decides its place.
- Panel left two objections open on #101 (Lia: any selection adds a mode to the list; Marco: little
  gain over the table's bulk edit). Kept because the selection only exists when the user makes it.

## Delivered     (filled in CLOSE)
## Left for later     (filled in CLOSE)
