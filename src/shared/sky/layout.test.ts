process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import type { SkyInput, SkyLine, SkyMark } from './index'
import { figureOfMonth, figureSegments } from './figures'
import { earlierSkies, echoOf, monthCentre, skyScene, SKY_HEIGHT, SKY_WIDTH, yearsWithStars, type SkyScene } from './layout'

function line(day: string, text = `line of ${day}`): SkyLine {
  return { day, text }
}

function daysOf(month: string, from: number, to: number): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d++) out.push(`${month}-${String(d).padStart(2, '0')}`)
  return out
}

function input(over: Partial<SkyInput> = {}): SkyInput {
  return { meditations: [], grains: [], pomodoros: [], names: {}, hemisphere: 'south', locale: 'pt-BR', ...over }
}

function shuffle<T>(list: readonly T[], seed: number): T[] {
  const out = [...list]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const RICH: SkyInput = input({
  meditations: [
    ...daysOf('2025-12', 1, 31).map((d) => line(d)),
    ...daysOf('2026-01', 1, 31).map((d) => line(d)),
    ...daysOf('2026-03', 2, 9).map((d) => line(d)),
    ...daysOf('2026-07', 1, 20).map((d) => line(d)),
    ...daysOf('2026-10', 1, 14).map((d) => line(d))
  ],
  grains: [...daysOf('2026-02', 1, 28), ...daysOf('2026-09', 1, 30)].map((d, i): SkyMark => ({ key: `task-${i}-${d}`, day: d, at: 0 })),
  pomodoros: [
    { key: 'p1', day: '2026-03-02', at: 1 },
    { key: 'p2', day: '2026-03-02', at: 2 },
    { key: 'p3', day: '2026-03-02', at: 3 },
    { key: 'p4', day: '2026-03-02', at: 4 },
    { key: 'p5', day: '2026-04-10', at: 5 }
  ],
  names: { '2026-07': 'Os dias de frio', '2026-10': 'Não aparece' }
})

describe('skyScene', () => {
  it('gives the same scene for the same input, in any order', () => {
    const a = skyScene(RICH, 2026, '2026-10-15')
    for (const seed of [1, 7, 42]) {
      const b = skyScene(
        { ...RICH, meditations: shuffle(RICH.meditations, seed), grains: shuffle(RICH.grains, seed), pomodoros: shuffle(RICH.pomodoros, seed) },
        2026,
        '2026-10-15'
      )
      expect(b).toEqual(a)
    }
  })

  it('puts star j of a month on star j of its figure, and loose stars after the last one', () => {
    const scene = skyScene(RICH, 2026, '2026-10-15')
    const jan = scene.months.find((m) => m.month === '2026-01')!
    const fig = figureOfMonth('2026-01')
    expect(jan.figureId).toBe(fig.id)
    expect(jan.stars).toHaveLength(31)
    jan.stars.forEach((s, j) => {
      expect(s.index).toBe(j)
      expect(s.day).toBe(`2026-01-${String(j + 1).padStart(2, '0')}`)
      expect(s.loose).toBe(j >= fig.stars.length)
    })
    // the figure's own stars keep their shape: distances scale by 64/100 (rotation keeps them)
    const [a, b] = [fig.stars[0], fig.stars[1]]
    const d = Math.hypot(jan.stars[0].x - jan.stars[1].x, jan.stars[0].y - jan.stars[1].y)
    expect(d).toBeCloseTo((Math.hypot(a[0] - b[0], a[1] - b[1]) * 64) / 100, 0)
    // loose stars lie 36–60 units from the month's centre
    const c = monthCentre(0)
    for (const s of jan.stars.filter((x) => x.loose)) {
      const r = Math.hypot(s.x - c.x, s.y - c.y)
      expect(r).toBeGreaterThanOrEqual(35.8)
      expect(r).toBeLessThanOrEqual(60.2)
    }
  })

  it('shows a segment only once both of its stars are lit', () => {
    const scene = skyScene(RICH, 2026, '2026-10-15')
    const mar = scene.months.find((m) => m.month === '2026-03')!
    const fig = figureOfMonth('2026-03')
    const lit = Math.min(8, fig.stars.length)
    const expected = figureSegments(fig).filter((s) => s.a < lit && s.b < lit)
    expect(mar.segments).toHaveLength(expected.length)
    for (const s of mar.segments) expect(s.at).toBeLessThan(lit)
    // one star: no segment at all
    const one = skyScene(input({ meditations: [line('2026-05-03')] }), 2026, '2026-10-15')
    expect(one.months[0].segments).toHaveLength(0)
  })

  it('names past months only, a given name over the figure, and draws nothing for a month with no line', () => {
    const scene = skyScene(RICH, 2026, '2026-10-15')
    expect(scene.months.map((m) => m.month)).toEqual(['2026-01', '2026-03', '2026-07', '2026-10'])
    const byMonth = Object.fromEntries(scene.months.map((m) => [m.month, m]))
    expect(byMonth['2026-10'].label).toBeNull()
    expect(byMonth['2026-07'].label).toBe('Os dias de frio')
    expect(byMonth['2026-07'].named).toBe(true)
    const fig = figureOfMonth('2026-03')
    expect(byMonth['2026-03'].label).toBe(fig.pt[0].toUpperCase() + fig.pt.slice(1))
    expect(byMonth['2026-03'].named).toBe(false)
    const en = skyScene({ ...RICH, locale: 'en' }, 2026, '2026-10-15')
    expect(en.months.find((m) => m.month === '2026-03')!.label).toBe(fig.en[0].toUpperCase() + fig.en.slice(1))
  })

  it('stops halos at three, and turns a pomodoro with no star into a grain', () => {
    const scene = skyScene(RICH, 2026, '2026-10-15')
    const halos = scene.halos.filter((h) => h.day === '2026-03-02')
    expect(halos.map((h) => h.ring)).toEqual([0, 1, 2])
    expect(halos.map((h) => h.r)).toEqual([4.2, 5.8, 7.4])
    expect(scene.halos.some((h) => h.key === 'p4')).toBe(false)
    expect(scene.grains.some((g) => g.key === 'p5' && g.day === '2026-04-10')).toBe(true)
    expect(scene.grains.some((g) => g.key === 'p4')).toBe(false)
  })

  it('crowns the oldest star of all years as the first one', () => {
    const scene2025 = skyScene(RICH, 2025, '2026-10-15')
    const scene2026 = skyScene(RICH, 2026, '2026-10-15')
    expect(scene2025.firstStar?.day).toBe('2025-12-01')
    expect(scene2026.firstStar).toBeNull()
  })

  it('lists only years with stars as earlier skies', () => {
    const many = input({ meditations: [line('2023-04-01'), line('2025-12-31'), line('2026-01-02')], grains: [{ key: 'g', day: '2024-05-05', at: 0 }] })
    expect(yearsWithStars(many)).toEqual([2026, 2025, 2023])
    expect(earlierSkies(many, 2026)).toEqual([2025, 2023])
    expect(earlierSkies(input(), 2026)).toEqual([])
  })

  it('finds this date a year ago, and rings it in that year’s sky', () => {
    const data = input({ meditations: [line('2024-10-15', 'two years'), line('2025-10-15', 'one year'), line('2026-10-01')] })
    expect(echoOf(data, '2026-10-15')).toEqual({ day: '2025-10-15', text: 'one year', years: 1 })
    expect(skyScene(data, 2025, '2026-10-15').echo?.day).toBe('2025-10-15')
    expect(skyScene(data, 2026, '2026-10-15').echo).toBeNull()
    expect(skyScene(data, 2024, '2026-10-15').echo).toBeNull()
  })

  it('keeps every position inside the box', () => {
    const everyDay = input({
      meditations: Array.from({ length: 365 }, (_, i) => line(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10))),
      grains: Array.from({ length: 2000 }, (_, i) => ({ key: `g${i}`, day: '2026-06-01', at: 0 })),
      pomodoros: Array.from({ length: 400 }, (_, i) => ({ key: `p${i}`, day: new Date(Date.UTC(2026, 0, 1 + (i % 365))).toISOString().slice(0, 10), at: i }))
    })
    const scenes: SkyScene[] = [skyScene(everyDay, 2026, '2026-12-31'), skyScene(RICH, 2026, '2026-10-15'), skyScene(RICH, 2025, '2026-10-15')]
    for (const scene of scenes) {
      const points = [
        ...scene.months.flatMap((m) => [...m.stars, m.centre, ...m.segments.flatMap((s) => [s.a, s.b])]),
        ...scene.grains,
        ...scene.field,
        scene.moon
      ]
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(SKY_WIDTH)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(SKY_HEIGHT)
      }
      for (const h of scene.halos) {
        expect(h.x - h.r).toBeGreaterThanOrEqual(0)
        expect(h.x + h.r).toBeLessThanOrEqual(SKY_WIDTH)
        expect(h.y - h.r).toBeGreaterThanOrEqual(0)
        expect(h.y + h.r).toBeLessThanOrEqual(SKY_HEIGHT)
      }
      // a label sits under its figure, still inside
      for (const m of scene.months) expect(m.centre.y + 46).toBeLessThanOrEqual(SKY_HEIGHT)
    }
  })

  it('draws a darker, fuller sky on a moonless night, and the event only in this year’s sky', () => {
    const newMoon = skyScene(input(), 2026, '2026-10-11')
    const ordinary = skyScene(input(), 2026, '2026-10-17')
    expect(newMoon.dark).toBe(true)
    expect(newMoon.field.length).toBe(ordinary.field.length * 2)
    expect(skyScene(input(), 2026, '2026-08-12').event).toEqual({ kind: 'meteors', shower: 'perseids' })
    expect(skyScene(input(), 2026, '2026-08-12', { events: false }).event).toBeNull()
    expect(skyScene(input(), 2025, '2026-08-12').event).toBeNull()
  })
})
