import { describe, expect, it } from 'vitest'
import { localDay } from './briefing'
import { isDayWritable } from './notebook'

/**
 * Whether a day of the notebook can still be written, run once per time zone (each zone has a
 * file of its own: the zone is process-wide state). A day is the local day of this computer: it
 * ends at its own midnight, wherever that falls in UTC.
 */

/** One absolute moment, 02:00 UTC on 15 October 2026, and the local day each zone calls it. */
const MOMENT = Date.UTC(2026, 9, 15, 2, 0)
const LOCAL_DAY_AT_MOMENT: Record<string, string> = {
  UTC: '2026-10-15',
  'America/Sao_Paulo': '2026-10-14',
  'America/New_York': '2026-10-14',
  'Asia/Tokyo': '2026-10-15'
}

export function defineWritableSuite(zone: string): void {
  describe(`a day of the notebook, in ${zone}`, () => {
    it('runs in the zone it names', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
    })

    it('can be written until its last millisecond, and not one after', () => {
      const lastMoment = new Date(2026, 9, 15, 23, 59, 59, 999)
      const midnight = new Date(2026, 9, 16, 0, 0, 0, 0)
      expect(isDayWritable('2026-10-15', lastMoment)).toBe(true)
      expect(isDayWritable('2026-10-15', midnight)).toBe(false)
      expect(isDayWritable('2026-10-16', midnight)).toBe(true)
      expect(isDayWritable('2026-10-14', lastMoment)).toBe(false)
    })

    it('opens the days to come and closes those before', () => {
      const noon = new Date(2026, 9, 15, 12)
      expect(isDayWritable('2026-10-16', noon)).toBe(true)
      expect(isDayWritable('2027-01-01', noon)).toBe(true)
      expect(isDayWritable('2025-10-15', noon)).toBe(false)
      expect(isDayWritable('not a day', noon)).toBe(false)
      expect(isDayWritable('2026-02-30', noon)).toBe(false)
    })

    it('follows the local day of the zone, not the day in UTC', () => {
      const local = LOCAL_DAY_AT_MOMENT[zone]
      expect(localDay(MOMENT)).toBe(local)
      expect(isDayWritable(local, MOMENT)).toBe(true)
      // The day before the local one has ended here, even where UTC still calls it today.
      const before = local === '2026-10-15' ? '2026-10-14' : '2026-10-13'
      expect(isDayWritable(before, MOMENT)).toBe(false)
    })

    it('ends at midnight on the days the clocks change', () => {
      // New York leaves summer time on 1 November 2026, São Paulo has none, Tokyo none: either
      // way the day turns at the local midnight, which exists on these dates in every zone here.
      expect(isDayWritable('2026-10-31', new Date(2026, 10, 1, 0, 0, 0, 1))).toBe(false)
      expect(isDayWritable('2026-11-01', new Date(2026, 10, 1, 1, 30))).toBe(true)
      expect(isDayWritable('2026-11-01', new Date(2026, 10, 1, 23, 59, 59, 999))).toBe(true)
      expect(isDayWritable('2026-11-01', new Date(2026, 10, 2, 0, 0))).toBe(false)
    })
  })
}
