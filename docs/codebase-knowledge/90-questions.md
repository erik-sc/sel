# Question log

| # | Question | Conjecture | Status | Evidence |
|---|---|---|---|---|
| 1 | Which types represent the core domain? | `Block`, `Op`, `PropertySchema`, `DatabaseView` in one shared file | verified (code) | src/shared/types.ts:62-74, src/shared/types.ts:264 |
| 2 | Where is the entry point of the app? | Module body of the main script | verified (code) | src/main/index.ts:422-429 |
| 3 | Where is data persisted? | One SQLite file, five tables | verified (code) | src/main/legacy.ts:5, src/main/db/schema.ts:9, src/main/db/schema.ts:66 |
| 4 | How does the renderer talk to main? | Only through `window.api`; every invoke carries a client id | verified (code) | src/preload/index.ts:25, src/preload/index.ts:157 |
| 5 | Does the renderer ever touch the network or Node? | No | verified (code) | src/renderer/index.html:19; grep for `fetch(` and `from 'node:` in `src/renderer/src` found nothing (this session) |
| 6 | How do I add an IPC call? | Edit the `Api` type, the preload list and one `handle` line | verified (code) | src/shared/api.ts:40, src/preload/index.ts:64, src/main/ipc.ts:111 |
| 7 | How are block writes applied? | A list of ops in one `BEGIN IMMEDIATE` transaction | verified (code) | src/main/db/repository.ts:829-853, src/main/db/repository.ts:186 |
| 8 | How do other windows learn of a change? | A coalesced change event per origin, sent to all windows | verified (code) | src/main/changes.ts:37-39, src/main/ipc.ts:58-61 |
| 9 | When is a page version stored? | Before the first write after a session gap, on bulk changes, and on quit; no timer | verified (code) | src/main/db/versions.ts:575-589, src/main/db/versions.ts:519-532, src/main/index.ts:268 |
| 10 | What are the history defaults? | Enabled, 10 minute sessions, 300 versions per page, 200 MB | verified (code) | src/shared/versions.ts:92 |
| 11 | Does the app call an AI API? | No; it spawns the user's local CLI with the prompt on stdin | verified (code) | src/main/ai/service.ts:211-221, src/main/ai/service.ts:566-571 |
| 12 | Can AI output change a page by itself? | No; inline results wait for accept and proposals for Apply | verified (code) | src/renderer/src/ai/session.ts:1-3, src/renderer/src/ai/AssistantPanel.tsx:260-263 |
| 13 | Where are Herman's proposals validated? | In shared code, run in the renderer; main never parses them | verified (code) | src/shared/actions.ts:128, src/shared/actions.ts:182, src/renderer/src/ai/AssistantPanel.tsx:410 |
| 14 | Does sync keep a change log? | No; it compares fingerprints against `sync_state` on each upload | verified (code) | src/main/sync/engine.ts:834-850, src/main/db/schema.ts:66-70 |
| 15 | What happens on a sync conflict? | Merge is field by field; only where both sides changed the same thing differently does the later edit win, and the loser is stored as a version | verified (documented) | commit 9c93ac1; src/main/sync/merge.ts:8-20; src/main/db/repository.ts:1470-1479 |
| 16 | Does main depend on renderer code? | Yes, in one file, for Markdown export | verified (code) | src/main/markdown.ts:20-23 |
| 17 | Is there telemetry, crash reporting or auto-update? | No | verified (code) | electron-builder.yml:2, electron-builder.yml:28; grep over `src` (this session) matched only src/main/ai/command.ts:189 |
| 18 | Is there CI or a linter? | No | verified (code) | package.json:8-17; `.github` absent (ls, this session) |
| 19 | Why does a bare `vitest run` show spurious failures? | It collects stale copies under `.claude/worktrees` because there is no config | open | package.json:13; to check: `npx vitest run --dir src` |
| 20 | Do all style values really live in the tokens file? | Mostly, with a few documented raw lengths | open | README.md:78; src/renderer/src/appearance/appearance.css:3; to check: grep CSS files for raw colours and px values |
| 21 | Does a failed editor write tell the user? | No: the store rolls back, the controller catches the rejection, logs and clears undo, so the global toast never fires | verified (code) | src/renderer/src/store/blocks.ts:334-337, src/renderer/src/editor/controller.ts:206-218, src/renderer/src/main.tsx:26-28; whether that is intended stays open |
| 22 | Are debounced text edits flushed when a window closes? | Unmount flush exists; no `beforeunload` path was found | open | src/renderer/src/editor/EditableText.tsx:172, src/renderer/src/editor/types.ts:10 |
| 23 | Does a council of only non-Claude agents still need Claude installed? | Yes: the outer Herman job has no program target, so Claude is resolved before its builder runs | verified (code) | src/main/ai/service.ts:428-447, src/main/ai/index.ts:199-206 |
| 24 | Is a malformed `sel-actions` block reported to the user? | No; it is stripped and counted in `rejected`, which only tests read | verified (code) | src/shared/actions.ts:218-221, src/renderer/src/ai/actions.test.ts:26 |
| 25 | Is Apply one undo step and one transaction? | Yes, since it is a single `applyOps` call | open | src/renderer/src/ai/applyActions.ts:23, src/main/db/repository.ts:829-853 |
| 26 | Are `SYNC_KEYS`, `sameWorkspace`, `isExternalUrl`, `SCHEMA_VERSION` dead? | Used only by tests or not at all | open | src/shared/sync.ts:101, src/main/sync/merge.ts:133, src/main/security.ts:103, src/main/db/schema.ts:82 |
| 27 | Can `addView` on a linked view with a missing source return a phantom id? | Yes | open | src/renderer/src/database/actions.ts:204-209, src/renderer/src/database/actions.ts:154-172 |
| 28 | Is a silent first-run seed failure intended? | Yes; it retries next launch because `seeded` stays unset | open | src/main/index.ts:330-332, src/main/db/seed.ts:9-11 |
| 29 | What does the editor use `document.execCommand` for? | Plain-text insertion on paste | open | src/renderer/src/editor/EditableText.tsx:209-211 |
| 30 | What is a safe first change, and how to verify it? | A pure function under `database/logic` with its neighbouring test | open | src/renderer/src/database/logic/mutations.ts:59; `npx vitest run --dir src` |
| 31 | What is the intended extension point for a new feature? | A shared contract, a `register.ts` receiving `handle`, a preload namespace, a renderer gate and host | verified (code) | src/main/ipc.ts:223-254, src/preload/index.ts:27-28, src/renderer/src/ai/gate.ts:1-3, src/renderer/src/shell/Shell.tsx:5-9 |
| 32 | Which areas have a single knowledgeable person? | All of them | verified (code) | `git shortlog -sn` (this session); commit 812b72a |
| 33 | Was the Glass look abandoned as default? | Yes, Zen replaced it and Glass survives as a preset | verified (documented) | commit 5f843cb; src/renderer/src/appearance/presets.ts:4-5 |
