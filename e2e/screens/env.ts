/**
 * Where the harness reads its inputs and writes its output. Set by the workflow; every value
 * has a default for a local run (README.md).
 *
 * - SCREENS_IDS: the ids to capture, separated by spaces or new lines (`all` for every one), or
 *   `@<file>` to read them from a file.
 * - SCREENS_HEAD_DIR / SCREENS_BASE_DIR: the checkouts whose app is captured. Without a base,
 *   only head is captured.
 * - SCREENS_NOW: the job's moment (ms), shared by every capture so "today" is the same day.
 * - SCREENS_OUT: the output folder.
 * - SCREENS_PR, SCREENS_REPO, SCREENS_HEAD_SHA, SCREENS_BASE_SHA, SCREENS_RUN_URL: for the comment.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const env = process.env

export const OUT_DIR = resolve(env['SCREENS_OUT'] || join(__dirname, '.output'))
export const HEAD_DIR = resolve(env['SCREENS_HEAD_DIR'] || join(__dirname, '..', '..'))
export const BASE_DIR = env['SCREENS_BASE_DIR'] ? resolve(env['SCREENS_BASE_DIR']) : null

export function requestedIds(): string[] {
  let raw = env['SCREENS_IDS'] ?? 'all'
  if (raw.startsWith('@')) raw = readFileSync(raw.slice(1), 'utf8')
  return raw.split(/\s+/).filter(Boolean)
}

/** The job's moment, rounded down to the minute. */
export function jobNow(): Date {
  const ms = Number(env['SCREENS_NOW']) || Date.now()
  return new Date(Math.floor(ms / 60_000) * 60_000)
}

export const PNG_DIR = join(OUT_DIR, 'png')
export const FAILED_DIR = join(OUT_DIR, 'failed')
export const RESULTS_DIR = join(OUT_DIR, 'results')
export const UNKNOWN_FILE = join(OUT_DIR, 'unknown.json')
export const SCENARIOS_FILE = join(OUT_DIR, 'scenarios.json')
