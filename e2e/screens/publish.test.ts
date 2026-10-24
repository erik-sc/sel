/**
 * The publish job's check (the script written inline in .github/workflows/screens.yml), run on
 * crafted artifacts: what reaches the comment and team/screens must be what the capture would
 * have written, and nothing else.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildComment, type CaptureResult, fileName, type Manifest, MAX_IMAGES } from './comment'

const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/screens.yml', import.meta.url))

/** The heredoc between `<<'SCRIPT'` and `SCRIPT`, unindented. */
function checkScript(): string {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.trimEnd().endsWith("<<'SCRIPT'"))
  const end = lines.findIndex((l, i) => i > start && l.trim() === 'SCRIPT')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return lines
    .slice(start + 1, end)
    .map((l) => l.replace(/^ {10}/, ''))
    .join('\n')
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const RUN_URL = 'https://github.com/erik-sc/sel/actions/runs/7'
const HEAD_SHA = 'abcdef1234567890'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function manifest(): Manifest {
  const results: CaptureResult[] = (['light', 'dark'] as const).flatMap((theme) =>
    (['base', 'head'] as const).map((side) => ({ id: 'today', theme, side, status: 'ok' as const }))
  )
  return {
    repo: 'erik-sc/sel',
    pr: 88,
    headSha: HEAD_SHA,
    baseSha: '1234567aaaa',
    runUrl: RUN_URL,
    scenarios: [{ id: 'today', description: 'The Today screen', themes: ['light', 'dark'] }],
    results,
    unknown: []
  }
}

/** Runs the check on an artifact with these files; returns the body it would post and the images it would publish. */
function check(comment: string | null, pngs: Record<string, Buffer> = {}): { body: string; published: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'sel-publish-'))
  dirs.push(root)
  const art = join(root, 'artifact')
  const out = join(root, 'publish')
  mkdirSync(join(art, 'png'), { recursive: true })
  mkdirSync(out)
  for (const [name, data] of Object.entries(pngs)) writeFileSync(join(art, 'png', name), data)
  if (comment !== null) writeFileSync(join(art, 'comment.md'), comment)
  writeFileSync(join(out, 'check.cjs'), checkScript())
  execFileSync(process.execPath, [join(out, 'check.cjs')], {
    env: { ...process.env, ART: art, OUT: out, PR: '88', REPO: 'erik-sc/sel', HEAD_SHA, RUN_URL },
    stdio: 'pipe'
  })
  return { body: readFileSync(join(out, 'body.md'), 'utf8'), published: readdirSync(join(out, 'pub')).sort() }
}

const todayPngs = (): Record<string, Buffer> =>
  Object.fromEntries(
    (['light', 'dark'] as const).flatMap((theme) => (['base', 'head'] as const).map((side) => [fileName('today', theme, side), PNG]))
  )

const isFallback = (body: string): boolean => body.includes('See [the run]') && !body.includes('<img')

describe('the publish check', () => {
  it('posts the comment the capture wrote and publishes the images it shows', () => {
    const comment = buildComment(manifest())
    const { body, published } = check(comment, { ...todayPngs(), 'extra-light-head.png': PNG })
    expect(body).toBe(comment)
    expect(published).toEqual(Object.keys(todayPngs()).sort())
  })

  it('falls back to a fixed body, with no images, when there is no comment', () => {
    const { body, published } = check(null, todayPngs())
    expect(isFallback(body)).toBe(true)
    expect(body).toContain('Nothing was captured')
    expect(published).toEqual([])
  })

  it('refuses images that are not PNGs or are named otherwise', () => {
    const comment = buildComment(manifest())
    expect(isFallback(check(comment, { ...todayPngs(), 'today-light-base.png': Buffer.from('GIF89a......') }).body)).toBe(true)
    const odd = buildComment(manifest()).replace('today-dark-head.png', 'today-dark-head.png.svg')
    expect(isFallback(check(odd, todayPngs()).body)).toBe(true)
  })

  const crafted: [string, string][] = [
    ['another site', 'see https://evil.example/x'],
    ['a protocol-relative link', '[x](//evil.example/x)'],
    ['a protocol-relative image', '<img src="//evil.example/x.png">'],
    ['a bare www name', 'go to www.evil.example now'],
    ['mailto', '[mail](mailto:someone@example.com)'],
    ['a javascript href', '<a href="javascript:alert(1)">x</a>'],
    ['an unquoted src', '<img src=https://evil.example/x.png>'],
    ['an entity-encoded scheme', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['a markdown link elsewhere', '[the run](https://github.com/erik-sc/sel/actions/runs/8)'],
    ['a reference link', '[x][1]\n\n[1]: http://evil.example'],
    ['an autolink', '<http://evil.example>'],
    ['other markup', '<details><summary>x</summary></details>'],
    ['another image of the repo', '<img src="https://github.com/erik-sc/sel/raw/main/docs/screens/x.png">']
  ]
  for (const [what, extra] of crafted) {
    it(`falls back when the comment holds ${what}`, () => {
      const comment = buildComment(manifest()).replace('— sel team (automated)', `${extra}\n\n— sel team (automated)`)
      const { body, published } = check(comment, todayPngs())
      expect(isFallback(body)).toBe(true)
      expect(published).toEqual([])
    })
  }

  it('lets links inside inline code through, as text, and defuses mentions', () => {
    const comment = buildComment({ ...manifest(), unknown: ['www.evil.example'] }).replace('## Screens', '## Screens @erik')
    const { body } = check(comment, todayPngs())
    expect(isFallback(body)).toBe(false)
    expect(body).toContain('Unknown: `www.evil.example`')
    expect(body).toContain('@​erik')
  })

  it('uses the same image limit as the comment builder', () => {
    expect(checkScript()).toMatch(new RegExp(`const MAX_IMAGES = ${MAX_IMAGES}\\b`))
  })
})
