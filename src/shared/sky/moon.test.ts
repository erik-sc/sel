// The moon is read at local noon; this suite runs in Brazil's zone, where most of sel's users are.
process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import { isFullMoonNight, isNewMoonNight, litSide, moonLitPath, moonPhase, phaseIndex } from './moon'

const FULL_2026 = ['01-03', '02-01', '03-03', '04-02', '05-01', '05-31', '06-29', '07-29', '08-28', '09-26', '10-26', '11-24', '12-24']
const NEW_2026 = ['01-18', '02-17', '03-19', '04-17', '05-16', '06-15', '07-14', '08-12', '09-11', '10-10', '11-09', '12-09']

function near(md: string): string[] {
  const t = Date.UTC(2026, Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5)))
  return [-1, 0, 1].map((d) => new Date(t + d * 86_400_000).toISOString().slice(0, 10))
}

describe('moonPhase', () => {
  it('names the full moons of 2026, within a day', () => {
    for (const md of FULL_2026) {
      expect(
        near(md).some((d) => phaseIndex(moonPhase(d)) === 4),
        md
      ).toBe(true)
      expect(
        near(md).some((d) => isFullMoonNight(d)),
        md
      ).toBe(true)
    }
  })

  it('names the new moons of 2026, within a day', () => {
    for (const md of NEW_2026) {
      expect(
        near(md).some((d) => phaseIndex(moonPhase(d)) === 0),
        md
      ).toBe(true)
      expect(
        near(md).some((d) => isNewMoonNight(d)),
        md
      ).toBe(true)
    }
  })

  it('stays in [0, 1)', () => {
    for (const d of ['1999-12-31', '2000-01-06', '2026-10-15', '2040-12-31']) {
      const p = moonPhase(d)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(1)
    }
  })

  it('has one full-moon night and one new-moon night per cycle, give or take', () => {
    let full = 0
    let dark = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
      if (isFullMoonNight(d)) full++
      if (isNewMoonNight(d)) dark++
    }
    expect(full).toBeGreaterThanOrEqual(12)
    expect(full).toBeLessThanOrEqual(14)
    expect(dark).toBeGreaterThanOrEqual(12)
    expect(dark).toBeLessThanOrEqual(14)
  })
})

describe('the lit side', () => {
  it('turns with the hemisphere', () => {
    const waxing = 0.2
    expect(litSide(waxing, 'north')).toBe('right')
    expect(litSide(waxing, 'south')).toBe('left')
    expect(litSide(0.8, 'north')).toBe('left')
    expect(litSide(0.8, 'south')).toBe('right')
    expect(moonLitPath(400, 232, 20, waxing, 'north')).not.toBe(moonLitPath(400, 232, 20, waxing, 'south'))
  })
})
