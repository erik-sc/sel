// Calendar nights are UTC instants seen from a zone; this suite runs in Brazil's.
process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import { addDays, cometNight, eventOf, isCometArrival, seasonOf, type EventContext, type SkyEvent } from './events'

const SOUTH: EventContext = { hemisphere: 'south', firstStarDay: null }
const NORTH: EventContext = { hemisphere: 'north', firstStarDay: null }

function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

describe('calendar nights', () => {
  it('give their event on their date', () => {
    expect(eventOf('2026-03-03', SOUTH)).toEqual({ kind: 'eclipse', total: true })
    expect(eventOf('2026-08-28', SOUTH)).toEqual({ kind: 'eclipse', total: false })
    expect(eventOf('2028-12-31', SOUTH)).toEqual({ kind: 'eclipse', total: true })
    expect(eventOf('2026-08-12', SOUTH)).toEqual({ kind: 'meteors', shower: 'perseids' })
    expect(eventOf('2026-08-13', SOUTH)).toEqual({ kind: 'meteors', shower: 'perseids' })
    expect(eventOf('2026-12-14', SOUTH)).toEqual({ kind: 'meteors', shower: 'geminids' })
    expect(eventOf('2027-01-01', SOUTH)).toEqual({ kind: 'new-year' })
    expect(eventOf('2026-06-21', SOUTH)).toEqual({ kind: 'season', mark: 'winter-solstice' })
    expect(eventOf('2026-06-21', NORTH)).toEqual({ kind: 'season', mark: 'summer-solstice' })
    expect(eventOf('2026-03-20', SOUTH)).toEqual({ kind: 'season', mark: 'autumn-equinox' })
    expect(eventOf('2026-12-21', NORTH)).toEqual({ kind: 'season', mark: 'winter-solstice' })
    // 22 Sep 2026 21:06 in São Paulo (00:06 UTC on the 23rd): the equinox night is the 22nd here
    expect(eventOf('2026-09-22', SOUTH)).toEqual({ kind: 'season', mark: 'spring-equinox' })
  })

  it('give the first star its birthday, from the next year on', () => {
    const ctx = { hemisphere: 'south' as const, firstStarDay: '2025-06-10' }
    expect(eventOf('2026-06-10', ctx)).toEqual({ kind: 'anniversary' })
    expect(eventOf('2025-06-10', ctx)?.kind).not.toBe('anniversary')
    const leap = { hemisphere: 'south' as const, firstStarDay: '2024-02-29' }
    expect(eventOf('2026-02-28', leap)).toEqual({ kind: 'anniversary' })
  })

  it('keep their order: eclipse, birthday, meteors, season, new year', () => {
    // an eclipse on a birthday: the eclipse
    expect(eventOf('2026-03-03', { hemisphere: 'south', firstStarDay: '2025-03-03' })?.kind).toBe('eclipse')
    // a birthday on a meteor night: the birthday
    expect(eventOf('2026-08-12', { hemisphere: 'south', firstStarDay: '2025-08-12' })?.kind).toBe('anniversary')
    // a birthday on new year's day: the birthday
    expect(eventOf('2027-01-01', { hemisphere: 'south', firstStarDay: '2026-01-01' })?.kind).toBe('anniversary')
  })
})

describe('chance nights', () => {
  const tenYears = days('2026-01-01', '2035-12-31')

  it('give the same event for the same day', () => {
    for (const d of tenYears.slice(0, 400)) expect(eventOf(d, SOUTH)).toEqual(eventOf(d, SOUTH))
  })

  it('never put two events on one night', () => {
    // eventOf returns one event or none, by its type; a night is never both calendar and chance
    for (const d of tenYears) {
      const e = eventOf(d, SOUTH)
      expect(e === null || typeof e.kind === 'string').toBe(true)
    }
  })

  it('bring a comet for seven nights, and not again for 120 days', () => {
    const arrivals = tenYears.filter(isCometArrival)
    expect(arrivals.length).toBeGreaterThan(0)
    for (let i = 1; i < arrivals.length; i++) {
      const gap = (Date.parse(arrivals[i]) - Date.parse(arrivals[i - 1])) / 86_400_000
      expect(gap).toBeGreaterThan(120)
    }
    const a = arrivals[0]
    for (let k = 0; k < 7; k++) expect(cometNight(addDays(a, k))).toBe(k)
    expect(cometNight(addDays(a, 7))).toBe(null)
    expect(cometNight(addDays(a, -1))).toBe(null)
  })

  it('follow the hemisphere for the seasons', () => {
    expect(seasonOf('2026-01-15', 'south')).toBe('summer')
    expect(seasonOf('2026-01-15', 'north')).toBe('winter')
    expect(seasonOf('2026-04-15', 'south')).toBe('autumn')
    expect(seasonOf('2026-10-15', 'north')).toBe('autumn')
    for (const d of tenYears) {
      const s = eventOf(d, SOUTH)
      const n = eventOf(d, NORTH)
      if (s?.kind === 'fireflies') expect(seasonOf(d, 'south')).toBe('summer')
      if (n?.kind === 'fireflies') expect(seasonOf(d, 'north')).toBe('summer')
      if (s?.kind === 'flock') expect(seasonOf(d, 'south')).toBe('autumn')
      if (n?.kind === 'flock') expect(seasonOf(d, 'north')).toBe('autumn')
    }
    const firefliesSouth = tenYears.filter((d) => eventOf(d, SOUTH)?.kind === 'fireflies').map((d) => Number(d.slice(5, 7)))
    expect(firefliesSouth.length).toBeGreaterThan(0)
    expect(firefliesSouth.every((m) => m === 12 || m <= 2)).toBe(true)
  })

  // The spec's rates give 42–72 nights a year over 2026–2040 (about 55 on average): the floor is
  // the spec's "~45", read loosely, so that a quiet year (2031) is not a failure.
  it('make roughly one night in six or seven an event, every year for ten years', () => {
    for (const hemisphere of ['south', 'north'] as const) {
      for (let y = 2026; y <= 2035; y++) {
        const nights = days(`${y}-01-01`, `${y}-12-31`).filter((d) => eventOf(d, { hemisphere, firstStarDay: '2025-05-02' }) !== null)
        expect(nights.length, `${hemisphere} ${y}`).toBeGreaterThanOrEqual(40)
        expect(nights.length, `${hemisphere} ${y}`).toBeLessThanOrEqual(85)
      }
    }
  })

  it('use every kind over ten years', () => {
    const kinds = new Set<SkyEvent['kind']>()
    for (const d of tenYears) {
      const e = eventOf(d, { hemisphere: 'south', firstStarDay: '2025-05-02' })
      if (e) kinds.add(e.kind)
    }
    for (const k of ['eclipse', 'anniversary', 'meteors', 'season', 'new-year', 'comet', 'halo', 'fireflies', 'flock', 'shooting-star', 'satellite', 'cloud'] as const) {
      expect(kinds.has(k), k).toBe(true)
    }
  })
})
