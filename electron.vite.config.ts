import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const shared = resolve(__dirname, 'src/shared')

/**
 * The runtimes inside the Electron this app ships with. electron-vite only knows
 * Electron releases up to its own, and silently falls back to the oldest pair it
 * has for anything newer - which down-levels syntax the real runtime supports.
 * Bump all three together when Electron is upgraded (`process.versions` has them).
 */
const ELECTRON_MAJOR = 44
const NODE_TARGET = 'node24'
const CHROME_TARGET = 'chrome152'

const electronVersion = (
  JSON.parse(readFileSync(resolve(__dirname, 'node_modules/electron/package.json'), 'utf8')) as { version: string }
).version
if (!electronVersion.startsWith(`${ELECTRON_MAJOR}.`)) {
  throw new Error(
    `electron.vite.config.ts targets Electron ${ELECTRON_MAJOR} but ${electronVersion} is installed: update the build targets`
  )
}

/**
 * index.html ships the production CSP (`connect-src 'none'`). The dev server
 * needs its own origin and websocket for module loading and HMR, so that one
 * directive - and nothing else - is relaxed while serving.
 */
function devCsp(): Plugin {
  return {
    name: 'sel:dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      const relaxed = html.replace("connect-src 'none'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
      if (relaxed === html) throw new Error("index.html: expected a CSP with connect-src 'none'")
      return relaxed
    }
  }
}

/**
 * KaTeX's stylesheet offers every font as woff2, woff and ttf. Chromium always takes the woff2,
 * so the other two are dropped from it and never shipped (about 0.9 MB less in the app).
 */
function katexWoff2Only(): Plugin {
  const KATEX_CSS = /[\\/]node_modules[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css(\?.*)?$/
  return {
    name: 'sel:katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!KATEX_CSS.test(id)) return null
      const out = code.replace(/,\s*url\([^)]*\.woff\)\s*format\("woff"\)/g, '').replace(/,\s*url\([^)]*\.ttf\)\s*format\("truetype"\)/g, '')
      if (out === code) throw new Error('katex.css: expected woff and ttf fallbacks to drop')
      return { code: out, map: null }
    }
  }
}

/** Packages that every screen needs and that change only when they are upgraded. */
const VENDOR_RE = /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/

export default defineConfig(({ command }) => {
  /**
   * electron-vite turns minification off by default; everything that ships is
   * minified here (less to read from disk, parse and keep in memory) and nothing
   * ships a source map. `electron-vite dev` keeps readable, unminified code.
   */
  const output = { minify: command === 'build' ? 'esbuild' : false, sourcemap: false } as const

  return {
    main: {
      // Only what is listed under `dependencies` in package.json stays a runtime `require`:
      // better-sqlite3, a native module, and electron-updater, required only when an update
      // check runs. Everything else is bundled.
      resolve: { alias: { '@shared': shared } },
      build: {
        ...output,
        target: NODE_TARGET,
        rollupOptions: {
          // mcp.js: the workspace tools' server, started by the Claude Code program (see src/main/mcp.ts).
          input: { index: resolve(__dirname, 'src/main/index.ts'), mcp: resolve(__dirname, 'src/main/mcp.ts') }
        }
      }
    },
    preload: {
      // The preload runs sandboxed and can only `require('electron')`. It imports nothing
      // else but @shared (bundled in); a dependency added here must be bundled too, i.e.
      // listed in `build.externalizeDeps.exclude`.
      resolve: { alias: { '@shared': shared } },
      build: { ...output, target: NODE_TARGET }
    },
    renderer: {
      plugins: [react(), devCsp(), katexWoff2Only()],
      resolve: {
        alias: { '@shared': shared, '@': resolve(__dirname, 'src/renderer/src') }
      },
      build: {
        ...output,
        target: CHROME_TARGET,
        // Chromium supports <link rel="modulepreload"> natively.
        modulePreload: { polyfill: false },
        // Each lazily loaded feature brings its own stylesheet instead of growing the first one.
        cssCodeSplit: true,
        rollupOptions: {
          output: {
            // One chunk for the framework, whose content only changes when a package is upgraded.
            // Modules behind a dynamic `import()` (React.lazy) become chunks of their own.
            manualChunks: (id) => (VENDOR_RE.test(id) ? 'vendor' : undefined)
          }
        }
      }
    }
  }
})
