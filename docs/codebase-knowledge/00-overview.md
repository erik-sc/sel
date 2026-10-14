# Overview

sel ("selida", Greek for page) is a local-first desktop notes app: pages made of blocks,
databases made of pages, one SQLite file on disk (README.md:5, README.md:40, README.md:101).

## Hypothesis and beacons

**Hypothesis:** a three-process Electron app in which a sandboxed React renderer holds
only client state and reaches everything else (SQLite, files, git, CLIs, network) through
one typed `window.api` bridge; the main process validates every call and owns all I/O;
features are vertical slices that exist once under `src/main/<feature>` and once under
`src/renderer/src/<feature>`, joined by a contract file in `src/shared`.

| Beacon expected | Found? | Evidence |
|---|---|---|
| Main entry opens the DB and creates a sandboxed window | yes | src/main/index.ts:427, src/main/index.ts:105-110 |
| Preload exposes a single API object over `contextBridge` | yes | src/preload/index.ts:157 |
| Every `invoke` handler checks the sender | yes | src/main/ipc.ts:70-71 |
| SQLite schema with a `blocks` table | yes | src/main/db/schema.ts:9 |
| CSP forbids the renderer from opening connections | yes | src/renderer/index.html:19 |
| **Refuting beacon:** renderer imports `electron`/`node:` or calls `fetch` | not found | grep over `src/renderer/src` for `from 'electron'`, `from 'node:`, `fetch(`, `XMLHttpRequest`, `WebSocket(` returned no non-test hits (this session) |

## Repository shape

- 371 files, about 5 MB; TypeScript 331 files, CSS 17, JSON 8 (inventory script, this session).
- Top-level: `src` 356 files, `docs` 5 screenshots, root configs 10 (inventory script, this session).
- `src/main` (Electron main process), `src/preload`, `src/renderer`, `src/shared` (README.md:73-76).
- Feature folders in main: `ai`, `briefing`, `db`, `herman`, `meetings`, `sync`; in the renderer:
  `ai`, `appearance`, `briefing`, `database`, `editor`, `herman`, `meetings`, `shell`, `store`,
  `styles`, `sync`, `ui`, `versions` (`git ls-files src`, this session).
- 73 files match `*.test.ts` (`git ls-files`, this session).
- One runtime dependency, `better-sqlite3` (package.json:18-20); React, zustand, Electron, vite
  and vitest are dev dependencies bundled at build time (package.json:21-37).

## Build, run, test

| Fact | Status |
|---|---|
| Node.js 22 or newer is required | verified in README.md:51 |
| `npm run dev` runs `electron-vite dev` | verified in package.json:9 |
| `npm run build` runs `electron-vite build`; output entry is `./out/main/index.js` | verified in package.json:10, package.json:5 |
| `npm run typecheck` runs `tsc --noEmit` twice, for `tsconfig.node.json` and `tsconfig.web.json` | verified in package.json:12 |
| `npm test` runs `vitest run` | verified in package.json:13 |
| vitest.config.ts restricts tests to `src/`, excludes `.claude/`, `out/`, `release/` and `node_modules/`, and resolves the `@shared` and `@` aliases; environment stays Node | verified in vitest.config.ts:15-26 |
| `npm test` and `npx vitest run --dir src` collect the same 77 test files; worktree copies under `.claude/` are not collected | verified: both runs, and `vitest list --filesOnly` with a probe file under `.claude/worktrees` (this session) |
| `npm run pack` builds an unpacked app into `release/`; `npm run dist` builds the installer | verified in package.json:15-16, electron-builder.yml:7 |
| Packaging target is Windows NSIS x64, per-user, no auto-update, no signing, no publishing | verified in electron-builder.yml:47-50, electron-builder.yml:56-57, electron-builder.yml:28, electron-builder.yml:2 |
| The build fails on purpose if the installed Electron major is not 44 | verified in electron.vite.config.ts:15-26 |
| Path aliases: `@shared` everywhere, `@` (renderer source) in the renderer only | verified in electron.vite.config.ts:60, electron.vite.config.ts:67, electron.vite.config.ts:73 |
| The node tsconfig also compiles `src/renderer/src/database/logic/*.ts` | verified in tsconfig.node.json:15 |
| CI (GitHub Actions) runs `npm run typecheck` (Ubuntu) and `npx vitest run --dir src` (Windows) on Node 24, on every pull request and push to `main`; install is `npm ci --ignore-scripts` | verified in .github/workflows/ci.yml |

## Entry points

| Kind (http/cli/job/ui) | Name | path:line |
|---|---|---|
| process | Electron main: adopt legacy profile, single-instance lock, open DB, `start` | src/main/index.ts:422-429 |
| process | App ready: harden session, register IPC, first window | src/main/index.ts:345-365 |
| bridge | Preload: `contextBridge.exposeInMainWorld('api', api)` | src/preload/index.ts:157 |
| ipc | `registerIpc`: all `ipcMain.handle` registrations | src/main/ipc.ts:57 |
| ui | Renderer HTML shell with the CSP | src/renderer/index.html:18-19 |
| ui | Renderer bootstrap | src/renderer/src/main.tsx:23 |
| job | Version-history housekeeping, 15 s after start | src/main/index.ts:281-299 |
| job | First sync, 1.5 s after the first window is shown | src/main/index.ts:23, src/main/index.ts:357 |
