/** Playwright's global setup: starts from an empty output folder, so nothing from an earlier run is published. */

import { mkdirSync, rmSync } from 'node:fs'
import { OUT_DIR } from './env'

export default function setup(): void {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
}
