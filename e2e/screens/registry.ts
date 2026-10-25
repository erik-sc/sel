/**
 * The scenarios the screenshot job can capture. One file per area in ./scenarios, each with a
 * default export that is an array of `Scenario`; every file in the folder is loaded, so two
 * changes that add scenarios never edit the same file. Ids are kebab-case and unique across files.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { Repository } from '../../src/main/db/repository'

export type Theme = 'light' | 'dark'
export type Side = 'base' | 'head'

export interface Scenario {
  id: string
  description: string
  /** The app's language; written to `ai.language` before launch. Default `en`. */
  locale?: 'en' | 'pt-BR'
  /** Default both. */
  themes?: Theme[]
  /** Adds to the demo workspace (seed.ts) for this scenario only, before the app opens it. */
  workspace?: (repo: Repository, now: Date) => void
  /** Drives the open window, as a user would, to the state to capture. */
  run: (page: Page, context: { app: ElectronApplication; now: Date }) => Promise<void>
}

export const THEMES: readonly Theme[] = ['light', 'dark']

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The scenarios of every file, checked: throws with every problem found. `files` maps a file name to its default export. */
export function validate(files: Record<string, unknown>): Scenario[] {
  const problems: string[] = []
  const seen = new Map<string, string>()
  const all: Scenario[] = []
  for (const [file, list] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!Array.isArray(list)) {
      problems.push(`${file}: the default export is not an array of scenarios`)
      continue
    }
    for (const scenario of list as Scenario[]) {
      const id = scenario?.id
      if (typeof id !== 'string' || !ID.test(id) || id === 'all') {
        problems.push(`${file}: "${String(id)}" is not a kebab-case id (and "all" is reserved)`)
        continue
      }
      const other = seen.get(id)
      if (other) {
        problems.push(`${file}: "${id}" is already defined in ${other}`)
        continue
      }
      if (typeof scenario.description !== 'string' || scenario.description.trim() === '')
        problems.push(`${file}: "${id}" has no description`)
      if (typeof scenario.run !== 'function') problems.push(`${file}: "${id}" has no run function`)
      if (scenario.themes && (scenario.themes.length === 0 || scenario.themes.some((t) => !THEMES.includes(t)))) {
        problems.push(`${file}: "${id}" has themes other than light and dark`)
      }
      seen.set(id, file)
      all.push(scenario)
    }
  }
  if (problems.length > 0) throw new Error(`Bad screens scenarios:\n${problems.join('\n')}`)
  return all
}

/** The registered scenarios. Synchronous `require`: for Playwright, which loads the harness as CommonJS. */
export function loadScenarios(dir = join(__dirname, 'scenarios')): Scenario[] {
  const files: Record<string, unknown> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const mod = require(join(dir, file)) as { default?: unknown }
    files[file] = mod.default
  }
  return validate(files)
}

/** Splits the block's ids into the scenarios to capture and the ids nobody registered. `all` expands to every scenario. */
export function select(ids: readonly string[], scenarios: readonly Scenario[]): { chosen: Scenario[]; unknown: string[] } {
  const byId = new Map(scenarios.map((s) => [s.id, s]))
  const chosen: Scenario[] = []
  const unknown: string[] = []
  const add = (s: Scenario): void => {
    if (!chosen.includes(s)) chosen.push(s)
  }
  for (const id of ids) {
    if (id === 'all') scenarios.forEach(add)
    else {
      const scenario = byId.get(id)
      if (scenario) add(scenario)
      else if (!unknown.includes(id)) unknown.push(id)
    }
  }
  return { chosen, unknown }
}
