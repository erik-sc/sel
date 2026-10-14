# Conventions ("plans" this project uses)

## Naming

- IPC invoke channels are `namespace:method`, nested with a dot, written as string literals (src/shared/api.ts:21, src/main/ipc.ts:111, src/main/ipc.ts:199).
- Settings keys are `area.key` (src/shared/ai.ts:142, src/shared/herman.ts:143-145); the pattern is enforced by a regex (src/main/validate.ts:29).
- Main-process feature folders use `register.ts` (handlers, loaded at start-up), `index.ts` (the lazy `*Bridge`), `service.ts` (Electron-free) (src/main/briefing/register.ts:9-12, src/main/briefing/index.ts:36-55, src/main/briefing/service.ts:81).
- Renderer features expose `gate.ts` (always loaded), `Host.tsx` (mount point) and lazy chunks (src/renderer/src/ai/gate.ts:1-3, src/renderer/src/ai/Host.tsx:8-19).
- Renderer start-up functions are `initX` (async, idempotent) and `bootX` (synchronous, from the mirror) (src/renderer/src/main.tsx:35-50).
- Lazy components export a matching `preloadX` (src/renderer/src/editor/lazy.tsx:7-22).
- Test support files are named for their role: `testing.ts`, `harness.ts`, `*.suite.ts`, `fixtures/` (src/main/db/testing.ts:12, src/main/sync/harness.ts:1-5, src/main/briefing/ical.suite.ts:44).
- Commit subjects are plain imperative sentences describing user-visible behaviour (commit 9c93ac1, commit 18fd2a0).

## Layering rules

- The renderer reaches main only through `window.api` (src/preload/index.ts:157).
- Paths never come from the renderer; they come from native dialogs in main (src/main/ipc.ts:125, src/main/sync/index.ts:275-295, src/main/ai/index.ts:225-255).
- Pure modules carry a header comment saying they are free of Electron, React or the store (src/renderer/src/database/logic.ts:1-12, src/main/briefing/secrets.ts:21, src/main/meetings/grant.ts:5).
- zustand stores hold state only; mutations are free exported functions (src/renderer/src/store/tabs.ts:48, src/renderer/src/store/ui.ts:64).
- Database code is consumed from outside through `@/database/lazy` (src/renderer/src/editor/BlockView.tsx:7, src/renderer/src/shell/PageHost.tsx:5).
- Main imports shared by relative path; preload and renderer use the `@shared` and `@` aliases (src/main/validate.ts:1, src/preload/index.ts:2, src/renderer/src/App.tsx:2).
- Migrations are append-only (src/main/db/schema.ts:4-7).

## Error handling

- Renderer input is typed `unknown` and narrowed by validators that throw (src/main/validate.ts:39-57, src/main/ai/index.ts:127-128).
- Validation is done twice: shape at the IPC edge, fields again in the repository (src/main/ipc.ts:104, src/main/db/repository.ts:664-666).
- Errors crossing IPC are reduced to user-safe messages; anything with a system `code` becomes a generic message and is logged (src/main/validate.ts:234-244, src/main/ipc.ts:78).
- Expected failures are typed codes defined in shared (src/shared/sync.ts:10-29, src/shared/ai.ts:114, src/shared/briefing.ts:34); sync's public methods return a status instead of throwing (src/main/sync/engine.ts:230-237).
- Main logs with `console.error` and an area prefix such as `[main]`, `[ipc]`, `[sync]` (src/main/index.ts:163, src/main/ipc.ts:78, src/main/sync/engine.ts:362).
- Renderer: `notifyError` for things the user must know, plain `console.error` for background refreshes (src/renderer/src/ui/toast.ts:88-91, src/renderer/src/store/blocks.ts:331).
- Untrusted persisted data is sanitised on read and returned by reference when already valid, so memoisation holds (src/renderer/src/database/logic/normalize.ts:14, src/shared/chart.ts:60-84, src/renderer/src/store/tabs.ts:256).
- Object keys from data are guarded against prototype members (src/shared/chart.ts:42-44, src/renderer/src/store/blocks.ts:51-57).
- Child processes: no shell, argument arrays, allow-listed environment, timeouts and process-tree kill (src/main/sync/git.ts:370-378, src/main/ai/service.ts:118-148).

## Testing

- Tests sit next to the code as `*.test.ts`; 73 files, none under `src/shared` or `src/preload` (`git ls-files`, this session).
- vitest.config.ts collects tests from `src/` only and resolves the build's `@shared` and `@` aliases, so tests may import through them; existing tests and modules mostly use relative paths (vitest.config.ts:15-26).
- No DOM library is installed (package.json:21-37) and tests run in vitest's Node environment; renderer tests cover pure logic. src/renderer/src/editor/richtext-dom.test.ts needs no DOM: it tests the pure functions of richtext-dom.ts.
- Repository tests open an in-memory database on `node:sqlite`, or better-sqlite3 when `SEL_TEST_DRIVER` says so (src/main/db/testing.ts:12-22).
- Time-zone-sensitive suites run once per zone by setting `TZ` on the first lines of a tiny test file (src/main/briefing/ical.utc.test.ts:1-4).
- External programs are replaced by scripted fakes selected with markers in the prompt (src/main/ai/fixtures/fake-claude.mjs:6-8).
- Sync tests need a real git binary and skip themselves without one (src/main/sync/harness.ts:18-24).
- Some suites are opt-in through environment flags (src/main/db/bench.test.ts:14, src/main/briefing/net.test.ts:405).
- Run `npm test` and `npm run typecheck` (package.json:12-13).

## Configuration and feature flags

- User configuration is the `settings` table; the renderer may write only allow-listed keys and namespaces (src/main/validate.ts:35-37, src/main/validate.ts:140-143).
- Settings that steer the main process are cleaned by per-feature functions from shared (src/shared/ai.ts:168, src/shared/herman.ts:160).
- Development-only environment variables are ignored in packaged builds: `ELECTRON_RENDERER_URL` (src/main/security.ts:17-29), `SEL_AI_CLI` (src/main/ai/index.ts:41-43), `SEL_HERMAN_FAST` (src/main/herman/service.ts:56-58), `SEL_BRIEFING_LOOPBACK` (src/main/briefing/net.ts:53-55), `SEL_WHISPER_PINS` (src/main/meetings/index.ts:29-41).
- `SEL_TRACE_STARTUP` or `--sel-trace-startup` prints a startup timeline (src/main/trace.ts:10).
- Features are switched by settings, not build flags: `ai.enabled` and `herman.enabled` (src/shared/ai.ts:142, src/shared/herman.ts:143-145).
- No linter or formatter is configured; the gates are typecheck and tests (package.json:8-17).

## Observed violations

| Where | Convention broken | Bug or intent? |
|---|---|---|
| src/main/markdown.ts:20-23 | Main imports renderer code | Intent (reuse of pure logic for export), enabled at tsconfig.node.json:15; the code belongs in shared |
| src/main/background.ts:9, src/main/ipc.ts:55, src/main/sync/engine.ts:123, src/renderer/src/appearance/store.ts:28, src/renderer/src/sync/store.ts:20 | One settings key declared five times | Drift risk, not yet a bug |
| src/main/ai/service.ts:11, src/main/ai/service.ts:445 | The generic AI service imports the Herman persona and reads `herman.*` settings | Intent, but couples two layers |
| src/renderer/src/ai/client.ts:6, src/renderer/src/herman/Dock.tsx:9 | Folder cycle between `ai` and `herman` | Intent; both import only the other's gate |
| src/renderer/src/shell/SettingsDialog.tsx:6 | `appearance/controls` used as a shared UI kit by other features | Intent by convenience; belongs in `ui` |
| src/renderer/src/store/tabs.ts:30-32, src/renderer/src/briefing/route.ts:13-17 | Route constants live in the store, their predicates in a feature folder | Minor inconsistency |
| src/renderer/src/database/actions.ts:20-23 | Database write failures are only logged, while appearance uses `notifyError` (src/renderer/src/appearance/store.ts:88) | Likely an oversight; the user sees nothing |
| src/renderer/src/database/actions.ts:204-209 | `addView` returns an id even when the write was dropped for a linked view without a ready source | Possible bug (unverified by running) |
| src/main/db/schema.ts:54 | Comment lists four version kinds; `sync` is a fifth (src/main/db/repository.ts:1472) | Stale comment |
| src/main/briefing/net.ts:9 | Comment claims to be the only network code | Stale comment |
| src/main/meetings/whisper/download.ts:7 | Binary downloads reuse `validateCalendarUrl` and `CalendarError` | Naming leak, behaviour fine |
| src/main/security.ts:84 | `eslint-disable` comment with no ESLint configured | Vestigial |
| src/main/ipc.ts:257 | `window:isMaximized` is a literal beside constant-named siblings (src/shared/api.ts:251-257) | Minor inconsistency |
| src/main/ipc.ts:169-172 | Two related settings written without a transaction | Probably harmless |
| src/main/sync/git.ts:444 | The auth-failure pattern ends in a bare word that could match unrelated errors | Possible misclassification (unverified) |
