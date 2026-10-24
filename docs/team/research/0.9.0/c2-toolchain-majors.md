# C2 research: build toolchain majors (vite 8, plugin-react 6, electron-vite 6, vitest 5.0.5)

Research for item C2 of `docs/plans/release-0.9.0.md` (lines 636-657). It covers Dependabot #76
(vite, @vitejs/plugin-react, vitest) and the electron-vite half of #75. Written in the VETO phase
on 2026-10-24. Nothing in the repository changed apart from this file.

**How it was checked.** I made a throwaway clone of `release/0.9.0` at fd6d6c5
(`/tmp/c2-research`) and ran it on Linux x64 with **Node 24.22.1** (fetched from npm's `node`
package; the machine's own Node is 22.23, and CI uses Node 24), npm 10.9.9.
- **[verified]** means it was run there.
- **[assumed]** means it was reasoned from release notes or code, not run.

Electron's binary was not installed (`--ignore-scripts`, as in CI), so the app itself was not
launched.

## 0. Summary

- **The upgrade works with no required config change.** With the four packages bumped and
  `electron.vite.config.ts` untouched:
  - `npm ci`, typecheck, lint and `npm run build` pass;
  - the test suite gives exactly the baseline result;
  - output has no `.map` files, the `vendor` chunk is still produced, KaTeX ships woff2 only,
    and `connect-src 'none'` is still in `out/renderer/index.html`.

  All **[verified]**.
- **Three config edits are still recommended** (§3). Vite 8 keeps `minify: 'esbuild'`,
  `build.rollupOptions` and `output.manualChunks` only as deprecated paths. `'esbuild'` now
  works only because esbuild happens to be installed as an *optional peer* of vite. With
  `'oxc'` (vite 8's own minifier), the output is smaller than with esbuild under vite 8, and
  the same checks pass **[verified]**.
- **Nothing needs Érik.**
  - Runtime `dependencies` (better-sqlite3, electron-updater) are untouched: the production
    dependency tree (`npm ls --omit=dev --all`) is byte-identical before and after
    **[verified]**.
  - Electron stays on 44.7.0 here; 44.9.0 is C1.
  - No change to `.github/workflows/`.
  - `npm audit --omit=dev --audit-level=high` finds 0 vulnerabilities **[verified]**.
- **The output is about 1% larger and has more chunks.** Rolldown splits differently from
  Rollup: renderer JS goes from 122 to 188 files, and main chunks from 31 to 49. The PR has to
  show this, per "Done when" (§4).

## 1. What changes, per package, and what touches this repo

### vite 7.3.7 → 8.3.x (#76 offers 8.3.4; `npm install vite@^8.3.4` resolved 8.3.5)

| Breaking change | Effect here |
|---|---|
| The bundler is Rolldown, not Rollup. `build.rollupOptions` becomes a deprecated alias of `build.rolldownOptions` (`vite/dist/node/index.d.ts:2903-2907`) | The config uses `rollupOptions` in main (`input`) and renderer (`output.manualChunks`). Both still work **[verified]**. Rename recommended (§3) |
| JS transform and minify use Oxc. `minify: 'esbuild'` is deprecated and needs `esbuild` installed separately. vite lists esbuild as an *optional* peer (`^0.27 \|\| ^0.28`) | `electron.vite.config.ts:73` uses `'esbuild'`. The new lock still installs esbuild 0.28.2, marked `dev, optional, peer`, so the build passed **[verified]**. A later lock refresh can drop it, and then the build fails with "requires esbuild to be installed separately" (`vite/dist/node/chunks/node.js:7402`). Switch to `'oxc'` (§3) |
| `output.manualChunks` is deprecated in Rolldown in favour of `output.codeSplitting.groups` (`rolldown/dist/shared/define-config-*.d.mts:790-835`); the function form still works, the object form does not | The config uses the function form. Still produces `vendor-*.js` **[verified]** |
| CSS minify defaults to Lightning CSS | CSS went from 324,689 to 322,288 bytes; KaTeX woff2-only still holds **[verified]** |
| `engines.node`: `^20.19.0 \|\| >=22.12.0` | CI's Node 24 is fine |
| Warning when a config would not work with the future `configLoader: 'native'` | Printed once per vitest run for `vitest.config.ts` (an ESM file in a CJS package). Not an error. No action needed; a `.mts` rename would silence it, but that is optional and out of scope |

Dev-path plugin hooks (`transformIndexHtml`, `transform`, `apply: 'serve'`, `enforce: 'pre'`)
are unchanged. I started the renderer dev server alone with Vite 8, loading the renderer config
through electron-vite 6's `loadConfigFromFile` (scratch script). It served `index.html` with
`connect-src 'self' ws://localhost:* ws://127.0.0.1:*`, so `sel:dev-csp` works, and it
transformed `src/main.tsx` (HTTP 200, so plugin-react 6 works in dev) **[verified]**.
`electron-vite dev` itself stops with "Electron uninstall" because the binary is absent. The
full dev loop with Electron is **[assumed]**.

### @vitejs/plugin-react 5.2.0 → 6.1.2

- It requires `vite ^8` (a peer), so it must move together with vite. It uses Oxc's React
  transform instead of Babel; `@babel/plugin-transform-react-jsx-self/-source` and
  `react-refresh` leave the lock.
- The config calls `react()` with no options, so nothing to adapt **[verified]**.
- The new `compiler` (React Compiler) option is opt-in and not used.

### electron-vite 5.0.0 → 6.0.0 (#75)

| Breaking change (CHANGELOG v6.0.0) | Effect here |
|---|---|
| Vite 8 support; accepts `rollupOptions` and `rolldownOptions` | Both work **[verified]** |
| `refactor!: simplify resolve config and isolate user config for sub-builds`; `?modulePath` sub-build strategy | The repo uses no `?modulePath`, `?nodeWorker` or `?asset` imports (grep). `?url` imports in the renderer are plain Vite (`recorder.ts:13`, `sky/Sprite.tsx:6`). `pcm-worklet-*.js` is still emitted as its own file **[verified]** |
| `refactor!: bytecode compiler…` | Bytecode protection is not used |
| `fix(deps)!: magic-string v1`, Babel loaded only for bytecode | No direct use |
| The config is bundled with Rolldown instead of esbuild | The config loads; the Electron-major guard (`electron.vite.config.ts:19-25`) still runs **[verified]** |
| `engines.node`: `^20.19.0 \|\| >=22.12.0`; `peer vite ^6 \|\| ^7 \|\| ^8` | OK |
| Built-in Electron target table now covers 42-44: `'44'` → node `24.18`, chrome `152` (`electron-vite/dist/chunks/lib-*.js`) | Same as the pinned `NODE_TARGET = 'node24'` and `CHROME_TARGET = 'chrome152'`. Keep the pins as they are; they still guard against a newer Electron. If C1 changes Chrome for 44.9 (#75 says "Updated Chromium to 152.0.7977.167", same major), nothing changes here |

`build.externalizeDeps` is still the option (the preload comment at `electron.vite.config.ts:91-94`
remains true). The main bundle still `require`s exactly the same external modules as before:
`better-sqlite3`, `electron-updater`, `electron` and `node:*`. I diffed the sorted list of
external `require(...)` calls **[verified]**. The preload still requires only `electron`
**[verified]**. The paths that depend on `__dirname` stay in `out/main/index.js`. The single
use inside a chunk (`toolScript(__dirname)`) already looks in `..` too
(`src/main/ai/toolscript.ts:9-12`) **[verified]**. The built `out/main/mcp.js` runs under
Node 24 and exits 0 on closed stdin, as the old one does **[verified]**.

### vitest 5.0.4 → 5.0.5

- A patch. Peer `vite ^6.4 || ^7 || ^8`.
- `vitest.config.ts` needs no change **[verified]**.

## 2. Results

Node 24.22.1, Linux x64. Each step was run on the untouched clone (baseline) and after
`npm install --ignore-scripts -D vite@^8.3.4 @vitejs/plugin-react@^6.1.2 vitest@^5.0.5 electron-vite@^6.0.0`.

| Step | Baseline (vite 7) | After, config untouched | After, with §3 edits |
|---|---|---|---|
| `npm ci --ignore-scripts` | ok, 399 packages | ok, 394 packages (fresh `rm -rf node_modules && npm ci`) | same |
| `npm run typecheck` | pass | pass | pass |
| `npm run lint` | pass | pass | pass |
| `npm run build` | pass, 9.7 s | pass, 2.5 s | pass |
| `npx vitest run --dir src` | 3 failed / 4485 passed / 12 skipped | Run 1: 4 failed. Run 2: 3 failed / 4485 passed / 12 skipped | (vitest does not read `electron.vite.config.ts`) |
| `npm audit --omit=dev --audit-level=high` | | 0 vulnerabilities | |

**Test failures.**
- The 3 baseline failures are the known Windows-path tests that fail on Linux:
  - `src/main/ai/ai.test.ts` "reads PATH whatever its case on Windows";
  - `src/main/meetings/whisper/whisper.test.ts` "gives the program a minimal environment";
  - `src/main/sync/security.test.ts` "only ever runs a real git executable…".
- The 4th failure in the first run after the upgrade was
  `whisper.test.ts > downloading a pinned file > continues an interrupted transfer with a Range
  request` ("expected 0 to be greater than 0"). Alone it passed 5 out of 5 times, and the
  second full run passed it. It is a load-dependent timing test (a local HTTP server cut
  mid-transfer), not the upgrade **[verified]**. If it shows up on the Windows runner, the PR
  should say so rather than retrying blindly.

## 3. Recommended config edits

None is required for the build to pass. Each one keeps what the option is for (plan line 645)
and was **[verified]** to give the same checks.

```diff
-  const output = { minify: command === 'build' ? 'esbuild' : false, sourcemap: false } as const
+  const output = { minify: command === 'build' ? 'oxc' : false, sourcemap: false } as const
 …
       build: {
         ...output,
         target: NODE_TARGET,
-        rollupOptions: {
+        rolldownOptions: {
           // mcp.js …
 …
-        rollupOptions: {
+        rolldownOptions: {
           output: {
-            manualChunks: (id) => (VENDOR_RE.test(id) ? 'vendor' : undefined)
+            codeSplitting: { groups: [{ name: 'vendor', test: VENDOR_RE }] }
           }
         }
```

- `'oxc'` removes the hidden dependence on an optional peer. The alternative is to add
  `esbuild` as an explicit devDependency and keep `'esbuild'`, but that adds a package for a
  deprecated path.
- The `rolldownOptions` and `codeSplitting` edits produced byte-identical output to the
  `rollupOptions` and `manualChunks` form with `'oxc'` (same sizes, same vendor hash
  `vendor-DEqR5y-i.js`) **[verified]**. They only remove deprecations, so they are optional.
- Update the comment at `electron.vite.config.ts:67-72` ("everything that ships is minified
  here") only if it names esbuild; it does not today.
- `vitest.config.ts`: no edit.
- `package.json`: the four version ranges. The lock changes about 1,900 lines:
  - Rollup and its platform packages go;
  - Rolldown and its bindings come in, including `@rolldown/binding-win32-x64-msvc`, needed on
    the Windows CI and release runners;
  - Lightning CSS comes in;
  - esbuild moves 0.25 → 0.28 as an optional peer;
  - an orphan `@napi-rs/lzma-linux-x64-gnu` entry with no parent is pruned.

## 4. Output, before and after (for the PR's "Done when")

Bytes, `du -sb`. This is a Linux build of the same sources; Windows is **[assumed]** to match.

| | Baseline (vite 7, esbuild) | vite 8, `'esbuild'` | vite 8, `'oxc'` (recommended) |
|---|---|---|---|
| `out/` | 5,347,728 | 5,460,155 (+2.1%) | 5,404,827 (+1.1%) |
| `out/main` | 990,555 | 1,029,984 | 993,697 |
| `out/preload` | 14,450 | 15,999 | 15,619 |
| `out/renderer` | 4,342,723 | 4,414,172 | 4,395,511 |
| renderer JS files / bytes | 122 / 2,540,278 | 188 / 2,609,345 | 188 / 2,590,684 |
| renderer CSS files / bytes | 40 / 324,689 | 40 / 322,288 | 40 / 322,288 |
| `out/main/chunks/*` | 31 | 49 | 49 |
| vendor chunk | `vendor-*.js` 223.25 kB | 221.86 kB | 220,050 B |
| `.map` files | 0 | 0 | 0 |
| `connect-src 'none'` in `out/renderer/index.html` | yes | yes | yes |
| `.woff` / `.ttf` in assets (KaTeX woff2-only) | none | none | none |

The vendor chunk holds react, react-dom, scheduler, zustand and use-sync-external-store
(grep) **[verified]**. The extra 66 renderer chunks are small shared pieces that Rolldown
splits out of lazy features. Rollup had inlined them. They load only with their feature. Their
cost (more files read from the asar at first use) is **[assumed]** negligible. If the reviewer
wants the old shape, `codeSplitting` has knobs (`minSize`, groups), but tuning chunking is
"new build features", out of scope.

## 5. Risks and things the PR must state

- **CI does not build** (plan Risks, line 750). The build was proven only on Linux here. The
  Windows build runs only in `release.yml` on a tag, and in S0's `screens` job once that is
  merged. If S0 is merged first, C2's PR gets a free Windows build through its job.
  Recommendation: give C2's PR a `screens` block with one starter scenario (for example
  `page-notes`), even though C2 is not visible. That proves the app builds and launches on
  Windows with vite 8 **[assumed]**.
- **The app was not launched here** (no Electron binary). The main bundle's CJS shape changed
  (Rolldown's `Object.defineProperty(exports, Symbol.toStringTag…)` header instead of
  esbuild's `"use strict"`), with the same externals and entry files. A Windows smoke run is
  the real proof **[assumed]**.
- **`.github/workflows/ci.yml:5`** says "esbuild's binary comes from its platform package". It
  is still true (esbuild is still installed), but it becomes irrelevant with `'oxc'`. Changing
  that comment means editing a workflow, so leave it: rule 3.
- **Order with C1:** C1 (electron 44.9, react, happy-dom) edits the same `package.json` and
  lock. Build C2 after C1 merges and regenerate the lock from there, as the waves already say.
  None of the C2 packages constrains Electron's version.
- **Dependabot:** #76 and the electron-vite part of #75 close when the release reaches `main`.
  The PR should name both.
- **`docs/codebase-knowledge/`:** no page mentions esbuild, Rollup or `manualChunks`. INDEX's
  line on the Electron-major guard (`electron.vite.config.ts:15-26`) stays true. No update is
  needed beyond `40-history.md`, if the lead counts the bundler switch as structural.
