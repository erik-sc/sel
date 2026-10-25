/**
 * The capture: one test per scenario × theme × side, head first. Each seeds a fresh workspace
 * with that side's own code (seed.ts), launches that side's built app on it through Playwright's
 * Electron driver, lets the scenario drive the window, and saves the whole window at 1280×800.
 *
 * A scenario that fails on base is "not in base" (the feature is new), and the test passes; one
 * that fails on head fails the test. Ids nobody registered fail the last test, after the rest
 * was captured, so the comment still shows what it can. Results are one JSON file per capture;
 * report.ts (the global teardown) gathers them into manifest.json and comment.md.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, type ElectronApplication, type Page, test } from '@playwright/test'
import { type CaptureResult, fileName, type Status } from './comment'
import { BASE_DIR, FAILED_DIR, HEAD_DIR, jobNow, PNG_DIR, RESULTS_DIR, requestedIds, SCENARIOS_FILE, UNKNOWN_FILE } from './env'
import { loadScenarios, type Scenario, select, type Side, THEMES, type Theme } from './registry'
import { type SeedCode, seedWorkspace } from './seed'

const WIDTH = 1280
const HEIGHT = 800

const now = jobNow()
const { chosen, unknown } = select(requestedIds(), loadScenarios())
const sides: { side: Side; dir: string }[] = [
  { side: 'head', dir: HEAD_DIR },
  ...(BASE_DIR ? [{ side: 'base' as const, dir: BASE_DIR }] : [])
]

test.beforeAll(() => {
  mkdirSync(PNG_DIR, { recursive: true })
  mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(UNKNOWN_FILE, JSON.stringify(unknown))
  writeFileSync(SCENARIOS_FILE, JSON.stringify(chosen.map((s) => ({ id: s.id, description: s.description, themes: themesOf(s) }))))
})

function themesOf(scenario: Scenario): Theme[] {
  return THEMES.filter((t) => (scenario.themes ?? THEMES).includes(t))
}

/** A checkout's own Repository and Tasks setup, loaded from its source (Playwright compiles the TypeScript). */
function codeOf(dir: string): SeedCode {
  const { Repository } = require(join(dir, 'src/main/db/repository.ts')) as Pick<SeedCode, 'Repository'>
  const { ensureTasksDatabase } = require(join(dir, 'src/main/db/tasks.ts')) as Pick<SeedCode, 'ensureTasksDatabase'>
  return { Repository, ensureTasksDatabase }
}

function record(result: CaptureResult): void {
  writeFileSync(join(RESULTS_DIR, `${result.id}-${result.theme}-${result.side}.json`), JSON.stringify(result))
}

const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .find((l) => l.trim()) ?? 'error'

async function launch(dir: string, userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--lang=en-US', '--force-device-scale-factor=1'],
    cwd: dir,
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    timeout: 60_000
  })
  const page = await app.firstWindow()
  // The window is created hidden and shown when ready to show.
  await app.evaluate(
    ({ BrowserWindow }) =>
      new Promise<void>((done) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win || win.isVisible()) done()
        else win.once('show', () => done())
      })
  )
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.w, size.h), { w: WIDTH, h: HEIGHT })
  await page.setViewportSize({ width: WIDTH, height: HEIGHT })
  // Herman reads reduced motion once, when he mounts: emulate it, then load again.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await page.waitForLoadState('load')
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 30_000 })
  return { app, page }
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
  })
}

async function close(app: ElectronApplication): Promise<void> {
  try {
    await Promise.race([app.close(), new Promise((_, fail) => setTimeout(() => fail(new Error('close timed out')), 15_000))])
  } catch {
    app.process().kill()
  }
}

for (const scenario of chosen) {
  for (const theme of themesOf(scenario)) {
    for (const { side, dir } of sides) {
      test(`${scenario.id} ${theme} ${side}`, async () => {
        const userData = mkdtempSync(join(process.env['RUNNER_TEMP'] || tmpdir(), `sel-${scenario.id}-${theme}-${side}-`))
        const result: CaptureResult = { id: scenario.id, theme, side, status: 'ok' }
        let app: ElectronApplication | null = null
        let page: Page | null = null
        try {
          seedWorkspace(codeOf(dir), join(userData, 'sel.db'), {
            theme,
            locale: scenario.locale ?? 'en',
            now,
            workspace: scenario.workspace
          })
          const opened = await launch(dir, userData)
          app = opened.app
          page = opened.page
          await scenario.run(opened.page, { app, now })
          // Off anything that shows a hover state.
          await opened.page.mouse.move(WIDTH - 1, HEIGHT / 2)
          await settle(opened.page)
          await opened.page.screenshot({
            path: join(PNG_DIR, fileName(scenario.id, theme, side)),
            animations: 'disabled',
            caret: 'hide',
            scale: 'css'
          })
        } catch (error) {
          const status: Status = side === 'base' ? 'not-in-base' : 'failed'
          Object.assign(result, { status, error: firstLine(error) })
          // What the window showed when it failed: in the run's artifact only, never published.
          await page?.screenshot({ path: join(FAILED_DIR, fileName(scenario.id, theme, side)), timeout: 5_000 }).catch(() => {})
          if (side === 'head') throw error
        } finally {
          record(result)
          if (app) await close(app)
          rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
        }
      })
    }
  }
}

test('every requested scenario is registered', () => {
  if (unknown.length > 0) throw new Error(`Unknown screens scenarios: ${unknown.join(', ')}`)
})
