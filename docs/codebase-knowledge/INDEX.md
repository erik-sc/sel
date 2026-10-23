# sel knowledge base

sel (short for selida) is a local-first desktop notes app for one person: pages made of
blocks, databases made of pages, version history, a Today and Calendar briefing, meeting
recording with local transcription, git-based sync between the user's own devices, and an
assistant ("Herman") that runs through the user's local Claude Code CLI. It is Electron 44
with React 19 and zustand in the renderer and better-sqlite3 in the main process, written
in TypeScript and tested with vitest (package.json:18-37, README.md:5).

**Architectural hypothesis (verified):** a sandboxed renderer holds only client state and
reaches everything else through one typed `window.api` bridge; the main process validates
every call and owns all I/O; features are vertical slices mirrored under `src/main/<feature>`
and `src/renderer/src/<feature>` with a contract in `src/shared` (src/preload/index.ts:157,
src/main/ipc.ts:69-90, src/renderer/index.html:19).

## Read next

- [Overview](00-overview.md) · [Glossary](10-glossary.md) · [Architecture](20-architecture.md)
- Flows: [startup](30-flows/startup.md), [edit to disk](30-flows/edit-to-disk.md),
  [ask Herman and Apply](30-flows/herman-ask-apply.md), [restore from a backup](30-flows/restore-from-backup.md)
- [History and ownership](40-history.md) · [Conventions](50-conventions.md) · [Open questions](90-questions.md)

## Five things you would not guess from the code

1. **Order is stored twice.** A child has `parent_id`, but sibling order is the parent's
   `content` array, and root order is a setting (src/main/db/repository.ts:690,
   src/main/db/repository.ts:389-390, src/main/db/repository.ts:48-50).
2. **Version history has no timer.** A version is taken before the first write after a
   session gap, on bulk changes, and on quit (src/main/db/versions.ts:575-589,
   src/main/index.ts:268).
3. **Main imports renderer code.** Markdown export reuses the renderer's pure database logic,
   which is why the node tsconfig includes that folder (src/main/markdown.ts:20-23,
   tsconfig.node.json:15).
4. **Tests only come from `src/`.** vitest.config.ts limits discovery to `src/` (so copies
   under `.claude/worktrees` are skipped) and gives tests the build's `@shared` and `@`
   aliases; older modules still import values by relative path (vitest.config.ts:15-26).
5. **Sync has no change log.** Each upload recomputes page fingerprints and compares them
   with `sync_state` (src/main/sync/engine.ts:834-850).

Also worth knowing: an invoke call is declared once, as a `namespace:method` line in `INVOKE`
next to the `Api` type (src/shared/api.ts:279); the preload builds `window.api` from that table
(src/preload/index.ts:30) and main must give every line a handler, or typecheck fails
(src/main/invoke.ts:16, src/main/ipc.ts:280); see "Adding an IPC call" in
[Conventions](50-conventions.md). The build refuses to run when the installed
Electron major differs from the pinned targets (electron.vite.config.ts:15-26).

## Top open questions

1. Should a failed editor write tell the user? On the editor path the store rolls back, undo
   is cleared and the rejection is caught, so no toast appears
   (src/renderer/src/store/blocks.ts:334-337, src/renderer/src/editor/controller.ts:206-218).
2. Is a malformed `sel-actions` proposal dropped silently (src/shared/actions.ts:218-221)?
