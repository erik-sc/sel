# sel knowledge base

sel (short for selida) is a local-first desktop notes app for one person: pages made of
blocks, databases made of pages, version history, a Today and Calendar briefing, meeting
recording with local transcription, git-based sync between the user's own devices, and an
assistant ("Herman") that runs through the user's local Claude Code CLI. It is Electron 44
(44.9 since 0.9.0) with React 19 and zustand in the renderer and better-sqlite3 in the main
process, built by electron-vite 6 on Vite 8 (Rolldown), written in TypeScript, linted by Biome
and tested with vitest, components in happy-dom (package.json:8-50, README.md:5).

**Architectural hypothesis (verified):** a sandboxed renderer holds only client state and
reaches everything else through one typed `window.api` bridge; the main process validates
every call and owns all I/O; features are vertical slices mirrored under `src/main/<feature>`
and `src/renderer/src/<feature>` with a contract in `src/shared` (src/preload/index.ts:155,
src/main/ipc.ts:119-140, src/renderer/index.html:19).

## Read next

- [Overview](00-overview.md) · [Glossary](10-glossary.md) · [Architecture](20-architecture.md)
- Flows: [startup](30-flows/startup.md), [edit to disk](30-flows/edit-to-disk.md),
  [ask Herman and Apply](30-flows/herman-ask-apply.md), [import and export](30-flows/import-export.md), [restore from a backup](30-flows/restore-from-backup.md),
  [a routine of the persona](30-flows/routines.md)
- [History and ownership](40-history.md) · [Conventions](50-conventions.md) · [Open questions](90-questions.md)

## Five things you would not guess from the code

1. **Order is stored twice.** A child has `parent_id`, but sibling order is the parent's
   `content` array, and root order is a setting (src/main/db/repository.ts:690,
   src/main/db/repository.ts:389-390, src/main/db/repository.ts:48-50).
2. **Version history has no timer.** A version is taken before the first write after a
   session gap, on bulk changes, and on quit (src/main/db/versions.ts:575-589,
   src/main/index.ts:268).
3. **Columns store nothing new.** A row of blocks side by side (0.9.0) is a run of siblings in
   which every block after the first has `props.beside === true`. `rowsOf` groups them as it
   draws and ignores the flag where a block may not share a row, so an older sel shows the same
   blocks stacked. Only the editor's `commit` repairs the flags after a structural change, in the
   same undo step; sync, Apply and import do not (src/renderer/src/editor/layout.ts:36,
   src/renderer/src/editor/layout.ts:91, src/renderer/src/editor/controller.ts:211).
4. **Tests only come from `src/`.** vitest.config.ts limits discovery to `src/` (so copies
   under `.claude/worktrees` are skipped) and gives tests the build's `@shared` and `@`
   aliases; older modules still import values by relative path (vitest.config.ts:15-26).
5. **Sync has no change log.** Each upload recomputes page fingerprints and compares them
   with `sync_state` (src/main/sync/engine.ts:834-850).

Also worth knowing:

- An invoke call is declared once, as a `namespace:method` line in its feature's fragment of
  `INVOKE` next to the `Api` type (src/shared/api.ts:316); the preload builds `window.api` from
  that table (src/preload/index.ts:45) and main must give every line a handler, or typecheck
  fails (src/main/invoke.ts:16, src/main/ipc.ts:280-295); see "Adicionar uma feature" in
  [Conventions](50-conventions.md). The build refuses to run when the installed Electron major
  differs from the pinned targets (electron.vite.config.ts:15-26).
- The words of the menus translated so far (en and pt-BR, by the home's locale) live in one copy
  module per area: src/renderer/src/editor/copy.ts (`useEditorCopy`, `editorCopy`: the block
  menu's beside/below entries, the columns slash items and announcements) and
  src/renderer/src/database/copy.ts (`useDatabaseCopy`, `databaseCopy`: the add-property menu,
  a property's own menu with a select's options and Insert left/right, the table's "+" header).
  The rest of the editor and database UI is still English; see "Words" in [Conventions](50-conventions.md).
- The columns model is in src/renderer/src/editor/layout.ts (`canShareRow`, `rowsOf`,
  `rowWidth`, `besideChoice`, `rowRepairOps`, `MAX_BESIDE` = 4); the drag and keyboard plans
  that respect rows are in src/renderer/src/editor/structure.ts (`rowOfHead`, `canDropBeside`,
  `dropInRow`, `columnsOps`). See "Row (columns)" in the [Glossary](10-glossary.md).

## Top open questions

1. Database edits have no undo: `actions.run` writes through `applyOps` with no history, so
   Ctrl+Z on a table, a property menu or an option reverses nothing, though the 0.9.0 plan
   asks every change to undo as one step (src/renderer/src/database/actions.ts:42-45,
   src/renderer/src/database/actions.ts:266-268; question 35 in [90-questions](90-questions.md)).
2. Should the windows load from a protocol of sel's own instead of `file://` (question 34)?
