import { describe, expect, it } from 'vitest'
import { capitalise, FIGURE_SEQUENCE, figureOfMonth, figureSegments, SKY_FIGURES } from './figures'

// The order the months draw their figures in. Changing it would redraw every sky already seen.
const LOCKED = [
  'mandacaru',
  'book',
  'sprout',
  'cat',
  'araucaria',
  'umbrella',
  'staff',
  'bell',
  'leaf',
  'banana',
  'fish',
  'ipe',
  'hummingbird',
  'mountain',
  'boat',
  'ladder',
  'spectacles',
  'owl',
  'house',
  'cashew',
  'strawhat',
  'snail',
  'turtle',
  'pinwheel',
  'palm',
  'candle',
  'waterlily',
  'berimbau',
  'kite',
  'lighthouse',
  'key',
  'top',
  'bridge',
  'guitar',
  'whale',
  'jangada',
  'lantern',
  'wave',
  'toucan',
  'cup',
  'heron',
  'feather',
  'teapot',
  'hourglass',
  'hammock'
]

describe('the figures', () => {
  it('are 45, with unique ids', () => {
    expect(SKY_FIGURES).toHaveLength(45)
    expect(new Set(SKY_FIGURES.map((f) => f.id)).size).toBe(45)
  })

  it('have 6 to 11 stars inside the 100 × 100 box', () => {
    for (const f of SKY_FIGURES) {
      expect(f.stars.length, f.id).toBeGreaterThanOrEqual(6)
      expect(f.stars.length, f.id).toBeLessThanOrEqual(11)
      for (const [x, y] of f.stars) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(100)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(100)
      }
    }
  })

  it('only draw lines between stars they have', () => {
    for (const f of SKY_FIGURES) {
      for (const line of f.lines) {
        expect(line.length, f.id).toBeGreaterThanOrEqual(2)
        for (const i of line) {
          expect(Number.isInteger(i), f.id).toBe(true)
          expect(i, f.id).toBeGreaterThanOrEqual(0)
          expect(i, f.id).toBeLessThan(f.stars.length)
        }
      }
    }
  })

  it('have names in Portuguese and English, with their article', () => {
    for (const f of SKY_FIGURES) {
      expect(f.pt.trim(), f.id).not.toBe('')
      expect(f.en.trim(), f.id).not.toBe('')
      expect(f.en.startsWith('the '), f.id).toBe(true)
      expect(/^(o|a|os|as) /.test(f.pt), f.id).toBe(true)
    }
    expect(capitalise('o Barco')).toBe('O Barco')
  })
})

describe('FIGURE_SEQUENCE', () => {
  it('holds every id once and is the locked list', () => {
    expect([...FIGURE_SEQUENCE]).toEqual(LOCKED)
    expect([...FIGURE_SEQUENCE].sort()).toEqual(SKY_FIGURES.map((f) => f.id).sort())
    expect(Object.isFrozen(FIGURE_SEQUENCE)).toBe(true)
  })

  it('never repeats in neighbouring months, and a calendar month only after 15 years', () => {
    const months: string[] = []
    for (let y = 2020; y <= 2060; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`)
    for (let i = 1; i < months.length; i++) expect(figureOfMonth(months[i]).id).not.toBe(figureOfMonth(months[i - 1]).id)
    expect(figureOfMonth('2026-10').id).toBe(figureOfMonth('2041-10').id)
    for (let y = 1; y < 15; y++) expect(figureOfMonth(`${2026 + y}-10`).id).not.toBe(figureOfMonth('2026-10').id)
  })
})

describe('figureSegments', () => {
  it('lists each segment once, shown from its later star', () => {
    const book = SKY_FIGURES.find((f) => f.id === 'book')!
    const segs = figureSegments(book)
    // [0, 1, 2, 3, 4, 5, 0, 3]: 0-1 1-2 2-3 3-4 4-5 5-0 0-3
    expect(segs).toHaveLength(7)
    expect(segs.find((s) => s.a === 0 && s.b === 3)?.at).toBe(3)
  })
})
