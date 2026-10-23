# Flow: app launch to first page painted

Trigger: the main-process module body (src/main/index.ts:422-429)

## Main process

1. At module load the startup trace begins and the privileged file scheme is declared, before the app is ready — src/main/index.ts:25-27
2. `adoptEarlierNotes` moves a profile left by the app's earlier name — src/main/index.ts:407-409; `adoptLegacyProfile` is defined at src/main/legacy.ts:18 and returns early when the new database already exists — src/main/legacy.ts:19
3. Single-instance lock; a second instance quits — src/main/index.ts:424-425
4. `openStore` first puts in place a backup chosen in Settings → Data (`applyStagedRestore`, src/main/data/backups.ts), then opens the database before Electron is ready — src/main/index.ts:313-330; `openDatabase` is defined at src/main/db/index.ts:12
5. The `Repository` constructor configures pragmas and migrates — src/main/db/repository.ts:131-132; `configure` at src/main/db/schema.ts:95, `migrate` at src/main/db/schema.ts:109
6. `start(repo)` installs process error loggers, the `second-instance` handler and per-webContents hardening — src/main/index.ts:337-343
7. On `app.whenReady()`: session hardening, theme, file protocol, then `registerIpc` — src/main/index.ts:350-353
8. Seeding is started but not awaited: `seedWorkspace(store)` is passed as `ready` — src/main/index.ts:353; it is a no-op unless the store is empty — src/main/index.ts:325; the seed module is imported dynamically — src/main/index.ts:327; `seedIfEmpty` is defined at src/main/db/seed.ts:8
9. Every invoke handler checks the sender, then awaits `ready`, then runs — src/main/ipc.ts:70-76
10. `createWindow()` — src/main/index.ts:355; the window is created hidden — src/main/index.ts:97; with a sandboxed, context-isolated renderer — src/main/index.ts:108-110; it is shown on `ready-to-show` — src/main/index.ts:147-151
11. The window loads the dev URL or the built file, with an optional `?page=` — src/main/index.ts:155-161
12. After the window: sync and the daily backup (src/main/data/register.ts, first check a minute later; the same `start()` also runs SQLite's `quick_check` on the open database in the backup utility process and raises the `database-damaged` notice when it fails, see [restore from a backup](restore-from-backup.md)) are scheduled 1.5 s after `show` — src/main/index.ts:357; history housekeeping is scheduled — src/main/index.ts:359; meetings are pruned — src/main/index.ts:360; the menu is built — src/main/index.ts:364-365

## Preload

13. A per-window `clientId` is generated — src/preload/index.ts:19; every `invoke` prepends it — src/preload/index.ts:25
14. The API object is exposed as `window.api` — src/preload/index.ts:157

## Renderer

15. The HTML sets the CSP — src/renderer/index.html:19
16. `bootMark('start')` and the `unhandledrejection` toast — src/renderer/src/main.tsx:23-28
17. The first frame is painted from the synchronous localStorage mirror — src/renderer/src/main.tsx:34-35; `readMirror` is defined at src/renderer/src/boot.ts:42
18. All async inits are fired in parallel — src/renderer/src/main.tsx:38-56
19. `initTabs(initialPageId())` — src/renderer/src/main.tsx:50; `initialPageId` at src/renderer/src/store/tabs.ts:42; `initTabs` at src/renderer/src/store/tabs.ts:243
20. When tabs resolve, the active page's tree is prefetched — src/renderer/src/main.tsx:53; `prefetchTree` at src/renderer/src/store/blocks.ts:260
21. `mount()` runs at once when both mirrors existed, otherwise after settings settle — src/renderer/src/main.tsx:72-73
22. Idle time preloads the editor, QuickFind and Herman chunks — src/renderer/src/main.tsx:65-69
23. `App` renders `Shell` — src/renderer/src/App.tsx:15
24. `Shell` waits for tabs to be ready, then picks Today, Calendar, `PageHost` or the empty state — src/renderer/src/shell/Shell.tsx:42-49
25. `PageHost` reads the block and chooses the database view or the editor — src/renderer/src/shell/PageHost.tsx:151-180
26. The lazy editor takes the prefetched tree or loads it — src/renderer/src/editor/PageEditor.tsx:99
27. Terminal read: the `blocks:getTree` handler — src/main/ipc.ts:107; `Repository.getTree` — src/main/db/repository.ts:548

## State touched

- Database file `sel.db` under `userData` (src/main/index.ts:308, src/main/legacy.ts:19).
- Tables `blocks`, `settings`, `blocks_fts`, `page_versions`, `sync_state` (src/main/db/schema.ts:9, src/main/db/schema.ts:25, src/main/db/schema.ts:30, src/main/db/schema.ts:50, src/main/db/schema.ts:66).
- Settings read in main: `windowBounds` (src/main/index.ts:16), `appearance` via `APPEARANCE_KEY` (src/main/index.ts:100), theme (src/main/ipc.ts:31).
- Setting written on first run: `seeded` (src/main/db/seed.ts:9-11).
- Renderer setting `shell.tabs` (src/renderer/src/store/tabs.ts:21).
- localStorage keys under the boot mirror prefix (src/renderer/src/boot.ts:32).

## Failure handling

- Legacy adoption throws: error box, `app.exit(1)` — src/main/index.ts:411-418
- Database cannot open: `recoverStore` loads src/main/data/startup.ts, which explains why in the system's language and, when the file is damaged and a backup passes its check, offers to restore it (the damaged file is renamed `sel.db.damaged-<time>`, never deleted); otherwise `app.exit(1)` — src/main/index.ts:333-349
- Seeding fails: logged only; `ready` still resolves — src/main/index.ts:330-332
- The `whenReady` chain throws: database closed, `app.exit(1)` — src/main/index.ts:371-375
- Window load fails: the window is shown anyway — src/main/index.ts:162-167
- Renderer crash: reload, reload ignoring cache, then a dialog — src/main/index.ts:65-80
- Untrusted IPC sender: `Forbidden` — src/main/ipc.ts:71
- No mirror (first run): mount waits for settings, and mounts even if they fail — src/renderer/src/main.tsx:73
- Tab restore fails: empty tab set, still ready — src/renderer/src/store/tabs.ts:269-281
- Render error: `ErrorBoundary` with "Try again" — src/renderer/src/shell/PageHost.tsx:28-36

## Tests covering this flow

- `adoptLegacyProfile` is exercised in src/main/legacy.test.ts:32.
- No test file exists for src/main/index.ts, src/main/ipc.ts, src/main/db/seed.ts, src/preload/index.ts, src/renderer/src/main.tsx or src/renderer/src/boot.ts (glob of `src/**/*.test.*`, this session).

## Open questions

- A first-run seed failure is silent and `seeded` stays unset, so it retries next launch; intended? (src/main/index.ts:330-332)
- `uncaughtException` is only logged (src/main/index.ts:338); an exception after `whenReady` could leave the app with no window (unverified).
