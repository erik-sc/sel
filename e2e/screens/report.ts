/**
 * Playwright's global teardown: gathers the per-capture results into manifest.json and writes
 * comment.md, for the publish job. Runs even when captures failed.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildComment, type CaptureResult, type Manifest } from './comment'
import { OUT_DIR, RESULTS_DIR, SCENARIOS_FILE, UNKNOWN_FILE } from './env'

const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback)

export default function report(): void {
  if (!existsSync(SCENARIOS_FILE)) return
  const env = process.env
  const results = existsSync(RESULTS_DIR)
    ? readdirSync(RESULTS_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')) as CaptureResult)
    : []
  const manifest: Manifest = {
    repo: env['SCREENS_REPO'] || 'erik-sc/sel',
    pr: Number(env['SCREENS_PR']) || 0,
    headSha: env['SCREENS_HEAD_SHA'] || 'local',
    baseSha: env['SCREENS_BASE_SHA'] || 'none',
    runUrl: env['SCREENS_RUN_URL'] || '',
    scenarios: readJson(SCENARIOS_FILE, []),
    results,
    unknown: readJson(UNKNOWN_FILE, [])
  }
  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(OUT_DIR, 'comment.md'), buildComment(manifest))
}
