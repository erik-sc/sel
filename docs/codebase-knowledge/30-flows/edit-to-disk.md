# Flow: a typed character reaches SQLite, other windows and version history

Trigger: `onInput` on the contentEditable element (src/renderer/src/editor/EditableText.tsx:249)

## Renderer

1. A native `beforeinput` listener blocks unwanted input types and records the selection — src/renderer/src/editor/EditableText.tsx:161-169
2. `onInput` skips during composition and calls `handleInput` — src/renderer/src/editor/EditableText.tsx:249-253; defined at src/renderer/src/editor/EditableText.tsx:177
3. The rich text is read back from the DOM with `domToRichText` — src/renderer/src/editor/EditableText.tsx:181; defined at src/renderer/src/editor/richtext-dom.ts:358
4. Typing hooks (Markdown shortcuts and the like) run through `ctrl.afterInput` — src/renderer/src/editor/EditableText.tsx:191-194; defined at src/renderer/src/editor/controller.ts:524
5. Otherwise the flush is debounced — src/renderer/src/editor/EditableText.tsx:199; `TEXT_DEBOUNCE_MS` is 300 — src/renderer/src/editor/types.ts:10
6. `flush` commits one `update` op with a `text:` key — src/renderer/src/editor/EditableText.tsx:95-105
7. `EditorController.commit` adds the row repair (`rowRepairOps`, src/renderer/src/editor/layout.ts:91: a structural batch that would make a block join a row it was not in clears its `beside`; a text-only batch returns at once), computes the inverse ops of the whole batch and pushes one undo entry — src/renderer/src/editor/controller.ts:203-217; `invertOps` at src/renderer/src/editor/ops.ts:126
8. `applyOps(batch)` is fired without awaiting — src/renderer/src/editor/controller.ts:214; defined at src/renderer/src/store/blocks.ts:457
9. The ops are planned as a set of changed blocks (`planOps`, src/renderer/src/store/ops.ts:52) and written optimistically into the zustand map in place, with a version bump and the changed ids (`commit`) — src/renderer/src/store/blocks.ts:458-473, src/renderer/src/store/blocks.ts:60-90
10. `window.api.blocks.apply(ops)` — src/renderer/src/store/blocks.ts:477; the preload prepends the client id — src/preload/index.ts:25

## Main process

11. The `handle` wrapper: trusted sender, client id, `await ready`, handler — src/main/ipc.ts:70-76
12. `blocks:apply` validates the ops and calls `repo.apply` — src/main/ipc.ts:113
13. `Repository.apply` runs inside `write` — src/main/db/repository.ts:829-831; `write` at src/main/db/repository.ts:227; `transaction` at src/main/db/repository.ts:177 opens `BEGIN IMMEDIATE` — src/main/db/repository.ts:186
14. `updateOne` — src/main/db/repository.ts:604: marks the page dirty for version history — src/main/db/repository.ts:631; updates the row — src/main/db/repository.ts:633; rewrites the FTS row when the text changed — src/main/db/repository.ts:646-647
15. Before commit the version store may veto a bulk change — src/main/db/repository.ts:196; then `COMMIT` — src/main/db/repository.ts:198
16. In the wrapper's `finally`, committed ids are drained into the `ChangeFeed` and sync is told a local change happened — src/main/ipc.ts:82-87
17. `ChangeFeed` coalesces per origin and per event-loop turn — src/main/changes.ts:37-39; flushes with the origin in the payload — src/main/changes.ts:49-52; and is delivered to every window with `webContents.send(IPC.change, ...)` — src/main/ipc.ts:58-61

## Back in the renderers

18. The originating window reconciles the reply, skipping blocks superseded by a newer local write and those that came back as the optimistic write showed them (`sameWrite`) — src/renderer/src/store/blocks.ts:478-489
19. Other windows receive the change through the preload listener — src/preload/index.ts:145-148; the store filters ids with pending writes and its own echoes, then refetches — src/renderer/src/store/blocks.ts:734-747
20. The editable re-renders from the model unless it is composing or has a pending edit — src/renderer/src/editor/EditableText.tsx:109-117

## When a `page_versions` row is written

There is no timer. All captures go through `VersionStore.capture` (src/main/db/versions.ts:664).

- First write to a page after a session gap: `beforeWrite` captures the state before the change as kind `auto`, otherwise only marks the session dirty; it does nothing when history is disabled, and a forced page is captured regardless of the gap (src/main/db/versions.ts:575-589).
- Bulk-change guard: `beforeCommit` throws when a transaction deletes many blocks or replaces most of the text of a page not yet captured (src/main/db/versions.ts:519-532); `Repository.write` rolls back, forces those pages so the rerun captures them, and reruns (src/main/db/repository.ts:233-235).
- On quit: `closeDatabase` calls `flushVersions`, which captures every dirty page (src/main/index.ts:268, src/main/db/repository.ts:1144, src/main/db/versions.ts:634).
- Thinning: `maintainVersions` runs in slices from 15 s after start-up (src/main/index.ts:281-299); the retention plan is at src/main/db/versions.ts:375-405.

## State touched

- Renderer: zustand block map plus module maps for pending writes and own echoes (src/renderer/src/store/blocks.ts:124-130); the editor undo history (src/renderer/src/editor/history.ts:34-61).
- SQLite: `blocks`, `blocks_fts`, conditionally `page_versions` (src/main/db/repository.ts:633, src/main/db/repository.ts:646-647, src/main/db/versions.ts:686).
- `sync_state` is not written on this path; sync is only notified (src/main/ipc.ts:86).

## Failure handling

- Main: any throw rolls back and rethrows — src/main/db/repository.ts:203-210; the wrapper logs unexpected errors and throws a sanitised error — src/main/ipc.ts:77-79
- Renderer store: on rejection it refetches the written blocks, or restores the snapshot if that fails too, then rethrows — src/renderer/src/store/blocks.ts:490-493
- Controller: `onApplyFailed` clears the undo history and shows an error toast ("Couldn't save that change. It was undone.", or the undo/redo variant), at most once per 5 s across all editors; failures inside that window are only logged — src/renderer/src/editor/controller.ts:226-229, src/renderer/src/failures/notify.ts:31
- The rejection is consumed by the `.catch` at src/renderer/src/editor/controller.ts:214, so the global `unhandledrejection` toast (src/renderer/src/main.tsx:26-28) does not also fire. Another `applyOps` caller without a catch would reach that toast.

## Tests covering this flow

- Store: src/renderer/src/store/blocks.test.ts:1, src/renderer/src/store/ops.test.ts:1
- Editor: src/renderer/src/editor/richtext-dom.test.ts:1, src/renderer/src/editor/history.test.ts:1, src/renderer/src/editor/typing.test.ts:1
- Main: src/main/changes.test.ts:1, src/main/db/repository.test.ts:1
- No test file for src/renderer/src/editor/controller.ts or src/renderer/src/editor/ops.ts (glob, this session).

## Open questions

- Resolved: pending 300 ms debounced edits are flushed before a window closes. `PageEditor` flushes on `beforeunload` (through `flushOnUnload`) and on window blur (src/renderer/src/editor/PageEditor.tsx:129-130); the write reaches main and is committed before `will-quit` closes the database (checked by running the app; see question 22 in [90-questions](../90-questions.md)).
- If the process is killed, dirty pages get no final version until the next gap-crossing edit (inferred from src/main/db/versions.ts:575-589).
