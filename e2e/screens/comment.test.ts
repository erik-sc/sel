import { describe, expect, it } from 'vitest'
import { buildComment, COMMIT_PLACEHOLDER, type Manifest, MAX_BODY, plainLine, SCREENS_MARKER, SIGNATURE, TEAM_MARKER } from './comment'

const both = ['light', 'dark'] as const

function manifest(extra: Partial<Manifest> = {}): Manifest {
  return {
    repo: 'erik-sc/sel',
    pr: 90,
    headSha: 'abcdef1234567890',
    baseSha: '1234567abcdef',
    runUrl: 'https://github.com/erik-sc/sel/actions/runs/1',
    scenarios: [{ id: 'today', description: 'The Today screen', themes: [...both] }],
    results: [
      { id: 'today', theme: 'light', side: 'base', status: 'ok' },
      { id: 'today', theme: 'light', side: 'head', status: 'ok' },
      { id: 'today', theme: 'dark', side: 'base', status: 'ok' },
      { id: 'today', theme: 'dark', side: 'head', status: 'ok' }
    ],
    unknown: [],
    ...extra
  }
}

describe('buildComment', () => {
  it('starts with both markers, names the shas and ends with the signature', () => {
    const body = buildComment(manifest())
    expect(body.startsWith(`${TEAM_MARKER}\n${SCREENS_MARKER}\n## Screens · head abcdef1 vs base 1234567\n`)).toBe(true)
    expect(body.trimEnd().endsWith(SIGNATURE)).toBe(true)
  })

  it('shows each scenario as pairs: light above dark, base on the left', () => {
    const body = buildComment(manifest())
    expect(body).toContain('### today — The Today screen')
    expect(body).toContain('| | Before (base) | After (head) |')
    const dir = `https://github.com/erik-sc/sel/raw/${COMMIT_PLACEHOLDER}/pr-90/abcdef1`
    const light = body.indexOf(`| Light | <a href="${dir}/today-light-base.png">`)
    const dark = body.indexOf(`| Dark | <a href="${dir}/today-dark-base.png">`)
    expect(light).toBeGreaterThan(0)
    expect(dark).toBeGreaterThan(light)
    expect(body.indexOf(`${dir}/today-light-head.png`)).toBeGreaterThan(light)
    expect(body).not.toContain('Failed:')
    expect(body).not.toContain('Unknown:')
  })

  it('says "not in base" when the scenario cannot run on base', () => {
    const body = buildComment(
      manifest({
        results: [
          { id: 'today', theme: 'light', side: 'base', status: 'not-in-base', error: 'no such button' },
          { id: 'today', theme: 'light', side: 'head', status: 'ok' }
        ],
        scenarios: [{ id: 'today', description: 'x', themes: ['light'] }]
      })
    )
    expect(body).toContain('| Light | _not in base_ | <a href=')
    expect(body).not.toContain('Failed:')
  })

  it('lists failed captures and unknown ids, sanitised, with a link to the run', () => {
    const body = buildComment(
      manifest({
        results: [
          { id: 'today', theme: 'dark', side: 'head', status: 'failed', error: 'Timeout `30s` waiting for @erik <b>\nsecond line' }
        ],
        unknown: ['nope-not-a-scenario', 'evil`<img src=x>@team']
      })
    )
    expect(body).toContain('| Dark | — | _failed_ |')
    expect(body).toContain('Failed: `today` (dark, head): `Timeout 30s waiting for @​erik b second line`')
    expect(body).toContain('Unknown: `nope-not-a-scenario`')
    expect(body).toContain('Unknown: `evilimg src=x@​team`')
    expect(body).toContain('[The run](https://github.com/erik-sc/sel/actions/runs/1)')
    expect(body).not.toMatch(/@[a-z]/)
  })

  it('stays under GitHub’s size limit', () => {
    const scenarios = Array.from({ length: 400 }, (_, n) => ({ id: `s-${n}`, description: 'd'.repeat(120), themes: [...both] }))
    const results = scenarios.flatMap((s) =>
      both.flatMap((theme) => (['base', 'head'] as const).map((side) => ({ id: s.id, theme, side, status: 'ok' as const })))
    )
    const body = buildComment(manifest({ scenarios, results }))
    expect(body.length).toBeLessThanOrEqual(MAX_BODY)
    expect(body.trimEnd().endsWith(SIGNATURE)).toBe(true)
  })
})

describe('plainLine', () => {
  it('keeps one short line with no markup', () => {
    expect(plainLine('a\n\nb `c` <d> | [e]', 100)).toBe('a b c d e')
    expect(plainLine('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
