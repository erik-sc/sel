import { describe, expect, it } from 'vitest'

/**
 * Test-only: `describe` for a suite that runs the real git. Without git it is skipped on a
 * developer's computer, but fails on CI (`CI` set), where skipping would hide that it never ran.
 * Not imported by the app bundle.
 */
export function gitSuite(git: string | null, name: string, fn: () => void): void {
  if (git) describe(name, fn)
  else if (process.env['CI']) {
    describe(name, () => {
      it('finds git', () => {
        expect.fail('git was not found: on CI the sync integration tests must run, not be skipped')
      })
    })
  } else describe.skip(name, fn)
}
