import { describe, expect, it } from 'vitest'
import type { VersionInfo } from '@shared/versions'
import { countLabel, dayLabel, formatBytes, groupByDay, kindLabel, kindTone, stampLabel, timeLabel } from './format'

// Local time on purpose: the timeline groups by the user's calendar day.
const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime()
const now = at(2026, 10, 13, 15, 0)
const version = (id: string, createdAt: number): VersionInfo => ({
  id,
  pageId: 'p',
  createdAt,
  kind: 'auto',
  label: null,
  blockCount: 1,
  textSize: 1
})

describe('version timeline words', () => {
  it('formats times in 24 hours', () => {
    expect(timeLabel(at(2026, 10, 13, 14, 32))).toBe('14:32')
    expect(timeLabel(at(2026, 10, 13, 0, 5))).toBe('00:05')
  })

  it('names today and yesterday, then the weekday and date, with the year when it differs', () => {
    expect(dayLabel(at(2026, 10, 13, 0, 1), now)).toBe('Today')
    expect(dayLabel(at(2026, 10, 12, 23, 59), now)).toBe('Yesterday')
    expect(dayLabel(at(2026, 10, 11), now)).toBe('Sunday 11 October')
    expect(dayLabel(at(2025, 12, 31), now)).toBe('31 December 2025')
  })

  it('writes a moment as shortly as its distance allows', () => {
    expect(stampLabel(at(2026, 10, 13, 14, 32), now)).toBe('14:32')
    expect(stampLabel(at(2026, 10, 12, 9, 5), now)).toBe('12 Oct, 09:05')
    expect(stampLabel(at(2025, 3, 2, 18, 0), now)).toBe('2 Mar 2025, 18:00')
  })

  it('groups versions by calendar day, keeping their order', () => {
    const groups = groupByDay(
      [
        version('a', at(2026, 10, 13, 14)),
        version('b', at(2026, 10, 13, 9)),
        version('c', at(2026, 10, 12, 23)),
        version('d', at(2026, 9, 1))
      ],
      now
    )
    expect(groups.map((g) => [g.label, g.items.map((v) => v.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Tuesday 1 September', ['d']]
    ])
    expect(groupByDay([], now)).toEqual([])
  })

  it('labels kinds, counts and sizes', () => {
    expect([kindLabel('auto'), kindLabel('daily'), kindLabel('manual'), kindLabel('restore')]).toEqual([
      'Auto',
      'Auto',
      'Saved',
      'Before restore'
    ])
    expect([kindTone('auto'), kindTone('daily'), kindTone('manual'), kindTone('restore')]).toEqual(['auto', 'auto', 'saved', 'restore'])
    expect(countLabel(1, 'block')).toBe('1 block')
    expect(countLabel(0, 'row')).toBe('0 rows')
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(300)).toBe('1 KB')
    expect(formatBytes(340 * 1024)).toBe('340 KB')
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3 MB')
    expect(formatBytes(48 * 1024 * 1024)).toBe('48 MB')
    expect(formatBytes(2.4 * 1024 ** 3)).toBe('2.4 GB')
  })
})
