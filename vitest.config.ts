import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * `npm test`. Tests live next to their code under src/, and only there: git worktrees
 * under .claude/ hold whole copies of the repo, and out/ and release/ are build output.
 *
 * The aliases are the ones electron.vite.config.ts gives the build. `@` is the renderer's
 * own source; nothing outside it imports `@/`, so one alias table serves every test.
 *
 * Everything else stays on vitest's defaults: the Node environment (no DOM) and one
 * isolated run per test file, which the timezone suites (ical.*.test.ts) rely on:
 * each sets process.env.TZ before it imports anything.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    dir: 'src',
    exclude: ['**/node_modules/**', '**/.claude/**', '**/out/**', '**/release/**']
  }
})
