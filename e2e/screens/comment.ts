/**
 * The pull request comment that shows the captures: one heading per scenario, a table with the
 * light row above the dark one, base (before) on the left, head (after) on the right; then only
 * what failed and the ids nobody registered. Pure.
 *
 * Built by the capture job (read-only token) and checked again by the publish job, which treats
 * it as untrusted text: image URLs carry `COMMIT_PLACEHOLDER`, which the publish job replaces with
 * the `team/screens` commit it pushed, after checking every URL points there.
 */

import type { Side, Theme } from './registry'

export const TEAM_MARKER = '<!-- sel-team -->'
export const SCREENS_MARKER = '<!-- sel-screens -->'
export const SIGNATURE = '— sel team (automated)'
export const COMMIT_PLACEHOLDER = '__SCREENS_COMMIT__'
/** GitHub refuses bodies over 65 536 characters. */
export const MAX_BODY = 60_000
/**
 * Images one comment shows: a release's `all` (CLOSE) with 50 scenarios fits. The publish job
 * enforces the same number (`MAX_IMAGES` in .github/workflows/screens.yml; publish.test.ts checks).
 * An image is about 170 characters of the body, so 200 of them stay well under MAX_BODY.
 */
export const MAX_IMAGES = 200

export type Status = 'ok' | 'failed' | 'not-in-base'

export interface CaptureResult {
  id: string
  theme: Theme
  side: Side
  status: Status
  /** First line of the error, when it failed. */
  error?: string
}

export interface Manifest {
  repo: string
  pr: number
  headSha: string
  baseSha: string
  runUrl: string
  scenarios: { id: string; description: string; themes: Theme[] }[]
  results: CaptureResult[]
  unknown: string[]
}

export function fileName(id: string, theme: Theme, side: Side): string {
  return `${id}-${theme}-${side}.png`
}

export const sha7 = (sha: string): string => sha.slice(0, 7)

/** One line of untrusted text, short, with nothing that renders as markup or notifies anyone. */
export function plainLine(text: string, max: number): string {
  let line = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`<>|[\]\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (line.length > max) line = `${line.slice(0, max - 1)}…`
  // A zero-width space after @ keeps "@name" from mentioning anyone.
  return line.replace(/@/g, '@​')
}

/** Inline code holding untrusted text. */
function code(text: string, max: number): string {
  const line = plainLine(text, max)
  return line ? `\`${line}\`` : '``'
}

export function buildComment(manifest: Manifest): string {
  const { repo, pr, headSha, baseSha, results } = manifest
  const dir = `https://github.com/${repo}/raw/${COMMIT_PLACEHOLDER}/pr-${pr}/${sha7(headSha)}`
  const find = (id: string, theme: Theme, side: Side): CaptureResult | undefined =>
    results.find((r) => r.id === id && r.theme === theme && r.side === side)

  let shown = 0
  let cut = 0
  const cell = (id: string, theme: Theme, side: Side): string => {
    const result = find(id, theme, side)
    if (!result) return '—'
    if (result.status === 'not-in-base') return '_not in base_'
    if (result.status === 'failed') return '_failed_'
    if (shown >= MAX_IMAGES) {
      cut++
      return '_cut_'
    }
    shown++
    // GitHub links an image in a comment to its full size by itself.
    const alt = `${id} ${theme} ${side === 'base' ? 'before' : 'after'}`
    return `<img src="${dir}/${fileName(id, theme, side)}" width="440" alt="${alt}">`
  }

  const out: string[] = [TEAM_MARKER, SCREENS_MARKER, `## Screens · head ${sha7(headSha)} vs base ${sha7(baseSha)}`, '']
  for (const scenario of manifest.scenarios) {
    out.push(`### ${scenario.id} — ${plainLine(scenario.description, 120)}`, '', '| | Before (base) | After (head) |', '|---|---|---|')
    for (const theme of scenario.themes) {
      out.push(`| ${theme === 'light' ? 'Light' : 'Dark'} | ${cell(scenario.id, theme, 'base')} | ${cell(scenario.id, theme, 'head')} |`)
    }
    out.push('')
  }
  if (manifest.scenarios.length === 0) out.push('Nothing was captured.', '')

  const failed = results.filter((r) => r.status === 'failed')
  for (const r of failed) out.push(`Failed: \`${r.id}\` (${r.theme}, ${r.side}): ${code(r.error ?? 'unknown error', 200)}  `)
  for (const id of manifest.unknown) out.push(`Unknown: ${code(id, 64)}  `)
  if (cut > 0) out.push(`Cut: ${cut} images over the limit of ${MAX_IMAGES} per comment; every image is in the run's artifact.  `)
  if (failed.length > 0 || manifest.unknown.length > 0 || cut > 0) out.push('', `[The run](${manifest.runUrl})`, '')

  let body = out.join('\n')
  const room = MAX_BODY - SIGNATURE.length - 40
  // Cut at a line end, so no link is left half written.
  if (body.length > room) body = `${body.slice(0, body.lastIndexOf('\n', room))}\n\n_(cut: too long)_\n`
  return `${body.trimEnd()}\n\n${SIGNATURE}\n`
}
