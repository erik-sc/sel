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
| Preload exposes a single API object over `contextBridge` | yes | src/preload/index.ts:155 |
| Every `invoke` handler checks the sender | yes | src/main/ipc.ts:70-71 |
| SQLite schema with a `blocks` table | yes | src/main/db/schema.ts:9 |
| CSP forbids the renderer from opening connections | yes | src/renderer/index.html:19 |
| **Refuting beacon:** renderer imports `electron`/`node:` or calls `fetch` | not found | grep over `src/renderer/src` for `from 'electron'`, `from 'node:`, `fetch(`, `XMLHttpRequest`, `WebSocket(` returned no non-test hits (this session) |

## Repository shape

- 1486 tracked files at the 0.9.0 close; TypeScript 944, CSS 50 (`git ls-files`).
- Top-level: `src` 1313 files, `docs` 105,
  `scripts` 14, `.github` 4, `site` 2 (`git ls-files`).
- `src/main` (Electron main process), `src/preload`, `src/renderer`, `src/shared` (README.md:73-76).
- Since 0.7.0 each feature has a folder of its own in each process (`ls src/main src/renderer/src`);
  see "Adicionar uma feature" in [Conventions](50-conventions.md).
- 246 test files under `src` (`*.test.ts`, `*.test.tsx`) (`git ls-files`).
- Two runtime dependencies, `better-sqlite3` and `electron-updater` (package.json:22-25); React,
  zustand, Electron, Vite 8 (Rolldown, through electron-vite 6), vitest, happy-dom, Biome and
  Playwright are dev dependencies, and what the app runs is bundled at build time
  (package.json:26-50, electron.vite.config.ts:77-79).

## Build, run, test

| Fact | Status |
|---|---|
| Node.js 24 or newer is required (a chart test fails on Node 22) | verified in README.md:53 |
| `npm run dev` runs `electron-vite dev` | verified in package.json:9 |
| `npm run build` runs `electron-vite build`; output entry is `./out/main/index.js` | verified in package.json:10, package.json:5 |
| `npm run typecheck` runs `tsc --noEmit` twice, for `tsconfig.node.json` and `tsconfig.web.json` | verified in package.json:12, tsconfig.node.json:20 |
| `npm test` runs `vitest run`; `npm run lint` runs `biome check` over `src/` and the root files | verified in package.json:13-14, biome.json |
| vitest.config.ts restricts tests to `src/`, excludes `.claude/`, `out/`, `release/` and `node_modules/`, and resolves the `@shared` and `@` aliases; environment stays Node | verified in vitest.config.ts:15-26 |
| `npm test` and `npx vitest run --dir src` collect the same test files; worktree copies under `.claude/` are not collected | verified: both runs, and `vitest list --filesOnly` with a probe file under `.claude/worktrees` (this session) |
| `npm run pack` builds an unpacked app into `release/`; `npm run dist` builds the installer | verified in package.json:19-20, electron-builder.yml:7 |
| Packaging target is Windows NSIS x64, per-user, no signing; the build writes the GitHub update feed files (`latest.yml`, block map) but uploads nothing; updates are opt-in in the app | verified in electron-builder.yml:33, electron-builder.yml:72, package.json `dist`, src/main/updates/schedule.ts:46 |
| The build fails on purpose if the installed Electron major is not 44 | verified in electron.vite.config.ts:15-26 |
| Path aliases: `@shared` everywhere, `@` (renderer source) in the renderer only | verified in electron.vite.config.ts:80, electron.vite.config.ts:99, electron.vite.config.ts:105 |
| The pure database logic is shared code (`src/shared/database`), compiled by both tsconfigs; the node one compiles no renderer file | verified in tsconfig.node.json |
| CI (GitHub Actions) runs `npm run typecheck` and `npm run lint` (Ubuntu), an `npm audit` of the runtime dependencies, and `npx vitest run --dir src` (Windows) on Node 24, on every pull request and push to `main`; install is `npm ci --ignore-scripts` | verified in .github/workflows/ci.yml:43-72 |

## Entry points

| Kind (http/cli/job/ui) | Name | path:line |
|---|---|---|
| process | Electron main: adopt legacy profile, single-instance lock, open DB, `start` | src/main/index.ts:422-429 |
| process | App ready: harden session, register IPC, first window | src/main/index.ts:345-365 |
| bridge | Preload: `contextBridge.exposeInMainWorld('api', api)` | src/preload/index.ts:155 |
| ipc | `registerIpc`: all `ipcMain.handle` registrations | src/main/ipc.ts:57 |
| ui | Renderer HTML shell with the CSP | src/renderer/index.html:18-19 |
| ui | Renderer bootstrap | src/renderer/src/main.tsx:23 |
| job | Version-history housekeeping, 15 s after start | src/main/index.ts:281-299 |
| job | First sync, 1.5 s after the first window is shown | src/main/index.ts:23, src/main/index.ts:357 |
