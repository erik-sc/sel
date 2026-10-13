import { describe, expect, it } from 'vitest'
import * as L from '../views/chartLogic'

/** Seven pixels per character: widths are easy to reason about. */
const measure: L.Measure = (text) => [...text].length * 7

describe('niceStep', () => {
  it('rounds up to 1, 2, 2.5, 5 or 10 times a power of ten', () => {
    expect(L.niceStep(0.9)).toBe(1)
    expect(L.niceStep(1.2)).toBe(2)
    expect(L.niceStep(2.1)).toBe(2.5)
    expect(L.niceStep(3)).toBe(5)
    expect(L.niceStep(7)).toBe(10)
    expect(L.niceStep(23)).toBe(25)
    expect(L.niceStep(0.03)).toBeCloseTo(0.05)
    expect(L.niceStep(1200)).toBe(2000)
  })

  it('integer steps are whole numbers and skip 2.5', () => {
    expect(L.niceStep(0.3, true)).toBe(1)
    expect(L.niceStep(2.1, true)).toBe(5)
    expect(L.niceStep(21, true)).toBe(50)
  })

  it('has an answer for nonsense', () => {
    expect(L.niceStep(0)).toBe(1)
    expect(L.niceStep(-3)).toBe(1)
    expect(L.niceStep(NaN)).toBe(1)
    expect(L.niceStep(Infinity)).toBe(1)
  })
})

describe('niceTicks', () => {
  it('covers the range with round numbers', () => {
    expect(L.niceTicks(0, 87).values).toEqual([0, 20, 40, 60, 80, 100])
    expect(L.niceTicks(0, 100).values).toEqual([0, 20, 40, 60, 80, 100])
    expect(L.niceTicks(0, 3, 5, true).values).toEqual([0, 1, 2, 3])
    expect(L.niceTicks(0, 7, 5, true).values).toEqual([0, 2, 4, 6, 8])
    expect(L.niceTicks(0, 1).values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(L.niceTicks(0, 12_345).values).toEqual([0, 2500, 5000, 7500, 10000, 12500])
  })

  it('reports its domain and step', () => {
    const ticks = L.niceTicks(3, 87)
    expect(ticks.min).toBe(0)
    expect(ticks.max).toBe(100)
    expect(ticks.step).toBe(20)
    expect(ticks.values[0]).toBe(ticks.min)
    expect(ticks.values.at(-1)).toBe(ticks.max)
  })

  it('handles negative and mixed ranges', () => {
    expect(L.niceTicks(-40, 60).values).toEqual([-40, -20, 0, 20, 40, 60])
    expect(L.niceTicks(-87, 0).values).toEqual([-100, -80, -60, -40, -20, 0])
    expect(L.niceTicks(-3, 9).values).toContain(0)
  })

  it('keeps counts whole', () => {
    for (const max of [1, 2, 3, 4, 5, 9, 13, 47, 1001]) {
      const ticks = L.niceTicks(0, max, 5, true)
      expect(ticks.values.every(Number.isInteger)).toBe(true)
      expect(ticks.max).toBeGreaterThanOrEqual(max)
      expect(ticks.values.length).toBeLessThanOrEqual(7)
    }
  })

  it('never returns an empty or a degenerate axis', () => {
    expect(L.niceTicks(0, 0).values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(L.niceTicks(0, 0, 5, true).values).toEqual([0, 1])
    expect(L.niceTicks(5, 5).values).toEqual([0, 1, 2, 3, 4, 5])
    expect(L.niceTicks(-5, -5).values.at(-1)).toBe(0)
    expect(L.niceTicks(NaN, Infinity).values.length).toBeGreaterThan(1)
    expect(L.niceTicks(10, 2).values).toEqual(L.niceTicks(2, 10).values)
  })

  it('has no floating-point noise', () => {
    expect(L.niceTicks(0, 0.3).values).toEqual([0, 0.1, 0.2, 0.3])
    expect(L.niceTicks(0, 0.3, 6).values).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3])
    expect(L.niceTicks(0, 0.7).values).toEqual([0, 0.2, 0.4, 0.6, 0.8])
    for (const value of L.niceTicks(0.1, 0.9).values) expect(String(value).length).toBeLessThanOrEqual(4)
  })

  it('stays close to the number of ticks asked for', () => {
    for (const [min, max] of [
      [0, 1],
      [0, 999],
      [13, 17],
      [-250, 1000],
      [0.001, 0.002],
      [0, 1e9]
    ]) {
      for (const target of [2, 4, 6]) {
        const ticks = L.niceTicks(min, max, target)
        expect(ticks.values.length).toBeGreaterThanOrEqual(2)
        expect(ticks.values.length).toBeLessThanOrEqual(target + 2)
        expect(ticks.min).toBeLessThanOrEqual(min)
        expect(ticks.max).toBeGreaterThanOrEqual(max)
      }
    }
  })
})

describe('niceBins', () => {
  it('makes at most the asked number of round buckets that cover the range', () => {
    expect(L.niceBins(0, 99, 10)).toEqual({ start: 0, step: 10, count: 10 })
    expect(L.niceBins(0, 100, 10)).toEqual({ start: 0, step: 20, count: 6 })
    expect(L.niceBins(3, 47, 10)).toEqual({ start: 0, step: 5, count: 10 })
    const bins = L.niceBins(-13.5, 912.25, 10)
    expect(bins.count).toBeLessThanOrEqual(10)
    expect(bins.start).toBeLessThanOrEqual(-13.5)
    expect(bins.start + bins.step * bins.count).toBeGreaterThan(912.25)
  })

  it('puts every value of the range in a bin', () => {
    const bins = L.niceBins(0, 99, 10)
    expect(L.binIndex(0, bins)).toBe(0)
    expect(L.binIndex(9.99, bins)).toBe(0)
    expect(L.binIndex(10, bins)).toBe(1)
    expect(L.binIndex(99, bins)).toBe(9)
    expect(L.binIndex(1e9, bins)).toBe(9)
    expect(L.binIndex(-1e9, bins)).toBe(0)
    expect(L.binEdge(3, bins)).toBe(30)
    const small = L.niceBins(0, 0.9, 10)
    expect(L.binEdge(3, small)).toBe(0.3)
  })

  it('has an answer for a degenerate range', () => {
    expect(L.niceBins(5, 5).count).toBe(1)
    expect(L.niceBins(NaN, 5).count).toBe(1)
  })
})

describe('label fitting', () => {
  it('leaves a label that fits alone', () => {
    expect(L.truncateLabel('Done', 100, measure)).toBe('Done')
    expect(L.truncateLabel('Done', 28, measure)).toBe('Done')
  })

  it('shortens to the longest prefix that fits with an ellipsis', () => {
    expect(L.truncateLabel('In progress', 50, measure)).toBe('In pro…')
    expect(measure(L.truncateLabel('A very long category name', 80, measure))).toBeLessThanOrEqual(80)
    expect(L.truncateLabel('In progress', 14, measure)).toBe('I…')
    expect(L.truncateLabel('In progress', 8, measure)).toBe('…')
  })

  it('does not end a shortened label with a space', () => {
    expect(L.truncateLabel('To do later', 42, measure)).toBe('To do…')
  })

  it('gives nothing when there is no room at all', () => {
    expect(L.truncateLabel('Done', 5, measure)).toBe('')
    expect(L.truncateLabel('Done', 0, measure)).toBe('')
    expect(L.truncateLabel('', 100, measure)).toBe('')
  })

  it('counts characters, not UTF-16 units', () => {
    const out = L.truncateLabel('😀😀😀😀😀', 22, measure)
    expect(out).toBe('😀😀…')
  })

  it('thins out axis labels when slots are narrower than the labels', () => {
    expect(L.labelStride(60, 40)).toBe(1)
    expect(L.labelStride(20, 40)).toBe(3)
    expect(L.labelStride(10, 52, 8)).toBe(6)
    expect(L.labelStride(0, 40)).toBe(1)
  })

  it('estimates a width when nothing can measure', () => {
    expect(L.estimateTextWidth('abcd', 10)).toBeCloseTo(22.4)
    expect(L.estimateTextWidth('', 10)).toBe(0)
  })
})

describe('label collisions', () => {
  const box = (x: number, y = 0, width = 30, height = 10): L.LabelBox => ({ x, y, width, height })

  it('keeps labels that do not touch', () => {
    expect(L.hideCollidingLabels([box(0), box(40), box(80)])).toEqual([true, true, true])
  })

  it('hides a label that would touch one already kept, earlier ones winning', () => {
    expect(L.hideCollidingLabels([box(0), box(20), box(40)])).toEqual([true, false, true])
    expect(L.hideCollidingLabels([box(0), box(10), box(20), box(30), box(64)])).toEqual([true, false, false, false, true])
  })

  it('counts the padding between labels', () => {
    expect(L.hideCollidingLabels([box(0), box(31)], 0)).toEqual([true, true])
    expect(L.hideCollidingLabels([box(0), box(31)], 2)).toEqual([true, false])
  })

  it('labels on different lines do not collide', () => {
    expect(L.hideCollidingLabels([box(0, 0), box(0, 20)])).toEqual([true, true])
    expect(L.hideCollidingLabels([box(0, 0), box(0, 8)])).toEqual([true, false])
  })

  it('hides what would be clipped by the bounds, and missing or empty boxes', () => {
    const bounds = box(0, 0, 100, 50)
    expect(L.hideCollidingLabels([box(-5), box(80), box(40, 45), box(30, 20)], 2, bounds)).toEqual([false, false, false, true])
    expect(L.hideCollidingLabels([null, box(0, 0, 0, 10), box(0)])).toEqual([false, false, true])
  })

  it('a hidden label does not push others away', () => {
    // The second collides with the first and is hidden; the third only touches the second.
    expect(L.hideCollidingLabels([box(0), box(25), box(50)])).toEqual([true, false, true])
  })
})

describe('arcs', () => {
  it('slices start at 12 o\'clock, go clockwise and add up to a full turn', () => {
    const slices = L.pieSlices([1, 1, 2])
    expect(slices.map((s) => s.share)).toEqual([0.25, 0.25, 0.5])
    expect(slices[0].from).toBeCloseTo(-Math.PI / 2)
    expect(slices[0].to).toBeCloseTo(0)
    expect(slices[2].to).toBeCloseTo(Math.PI * 1.5)
  })

  it('values that are not positive get no slice but keep their index', () => {
    const slices = L.pieSlices([0, 3, null, -2, NaN, 1])
    expect(slices.map((s) => s.index)).toEqual([1, 5])
    expect(slices.map((s) => s.share)).toEqual([0.75, 0.25])
    expect(L.pieSlices([0, null, -1])).toEqual([])
    expect(L.pieSlices([])).toEqual([])
  })

  it('draws a slice, a ring segment and a full turn', () => {
    expect(L.arcPath(50, 50, 0, 40, 0, Math.PI / 2)).toBe('M 90.00 50.00 A 40 40 0 0 1 50.00 90.00 L 50.00 50.00 Z')
    const ring = L.arcPath(50, 50, 20, 40, 0, Math.PI * 1.5)
    expect(ring).toMatch(/^M 90\.00 50\.00 A 40 40 0 1 1 50\.00 10\.00 L 50\.00 30\.00 A 20 20 0 1 0 70\.00 50\.00 Z$/)
    // A single slice is the whole circle: two half arcs, since an arc cannot end where it starts.
    const full = L.arcPath(50, 50, 0, 40, -Math.PI / 2, Math.PI * 1.5)
    expect(full.match(/A /g)).toHaveLength(2)
    expect(L.arcPath(50, 50, 20, 40, 0, Math.PI * 2).match(/A /g)).toHaveLength(4)
  })

  it('draws nothing for an empty sweep', () => {
    expect(L.arcPath(50, 50, 0, 40, 1, 1)).toBe('')
    expect(L.arcPath(50, 50, 0, 40, 2, 1)).toBe('')
    expect(L.arcPath(50, 50, 0, 0, 0, 1)).toBe('')
  })
})
