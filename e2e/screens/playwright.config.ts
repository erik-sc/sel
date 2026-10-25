import { defineConfig } from '@playwright/test'

/**
 * `npm run screens`: captures the scenarios named in SCREENS_IDS (see README.md). Only
 * capture.pw.ts is a Playwright file; the *.test.ts files beside it are vitest's.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /capture\.pw\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  outputDir: '.output/playwright',
  globalSetup: './setup.ts',
  globalTeardown: './report.ts',
  use: { actionTimeout: 10_000 }
})
