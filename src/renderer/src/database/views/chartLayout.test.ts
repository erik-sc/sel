import { describe, expect, it } from 'vitest'
import type { ChartKind } from '../../../../shared/types'
import * as L from './chartLogic'
import { buildScene, type Scene, type SceneOptions } from './chartLayout'

const measure: L.Measure = (text) => [...text].length * 6

function options(more: Partial<SceneOptions> = {}): SceneOptions {
  return {
    width: 600,
    height: 300,
    fontSize: 11,
    measure,
    stacked: false,
    showValues: false,
    showGrid: true,
    format: (value) => (value === null ? '–' : String(value)),
    formatTicks: (values) => values.map(String),
    formatShare: (share) => `${Math.round(share * 100)}%`,
    ...more
  }
}

function data(kind: ChartKind, series: (number | null)[][], labels?: string[]): L.ChartData {
  const n = series[0].length
  return {
    status: 'ok',
    kind,
    categories: Array.from({ length: n }, (_, i) => ({ key: `c${i}`, label: labels?.[i] ?? `Category ${i}` })),
    series: series.map((values, i) => ({ key: `s${i}`, label: `Series ${i}`, colour: L.CHART_COLOURS[i], values })),
    total: 0,
    yFormat: { numberFormat: 'number', integer: true },
    rowCount: 1,
    additive: true,
    split: series.length > 1,
    xLabel: 'X',
    yLabel: 'Count'
  }
}

const bars = (scene: Scene) => scene.marks.filter((mark) => mark.shape === 'bar')
const inside = (scene: Scene): boolean =>
  [...scene.axisLabels, ...scene.categoryLabels, ...scene.valueLabels].every(
    (label) => label.x >= -0.5 && label.x <= scene.width + 0.5 && label.y >= 0 && label.y <= scene.height
  )

describe('column charts', () => {
  it('draws one bar per value, on a zero baseline, taller for larger values', () => {
    const scene = buildScene(data('column', [[1, 4, 2]]), options())
    expect(bars(scene)).toHaveLength(3)
    const base = scene.clips[0].height
    const tops = bars(scene).map((mark) => mark.y)
    expect(tops[1]).toBeLessThan(tops[2])
    expect(tops[2]).toBeLessThan(tops[0])
    // Bars run past the baseline and are clipped there: only the data end is rounded.
    for (const mark of bars(scene)) {
      expect(mark.clip).toBe(0)
      expect(mark.y + mark.height).toBeGreaterThan(base)
      expect(mark.ay).toBe(mark.y)
    }
    expect(scene.grid.some((line) => line.zero && line.y1 === base)).toBe(true)
    expect(scene.axisLabels.map((label) => label.text)).toEqual(['0', '1', '2', '3', '4'])
    expect(scene.categoryLabels.map((label) => label.text)).toEqual(['Category 0', 'Category 1', 'Category 2'])
    expect(scene.bands).toHaveLength(3)
    expect(scene.horizontal).toBe(false)
    expect(inside(scene)).toBe(true)
  })

  it('groups series side by side, with a gap, inside the slot of their category', () => {
    const scene = buildScene(
      data('column', [
        [1, 2],
        [2, 1],
        [3, 3]
      ]),
      options()
    )
    const first = bars(scene).filter((mark) => mark.ci === 0)
    expect(first.map((mark) => mark.si)).toEqual([0, 1, 2])
    expect(first[1].x).toBeCloseTo(first[0].x + first[0].width + 2)
    const band = scene.bands[0]
    expect(first[0].x).toBeGreaterThanOrEqual(band.x)
    expect(first[2].x + first[2].width).toBeLessThanOrEqual(band.x + band.width)
    expect(first.map((mark) => mark.colour)).toEqual(['blue', 'orange', 'pink'])
  })

  it('stacks series on top of each other, and the axis covers the stack', () => {
    const scene = buildScene(
      data('column', [
        [1, 2],
        [2, 1],
        [3, 3]
      ]),
      options({ stacked: true })
    )
    const first = bars(scene).filter((mark) => mark.ci === 0)
    expect(first.every((mark) => mark.stacked && mark.clip === undefined)).toBe(true)
    expect(new Set(first.map((mark) => mark.x)).size).toBe(1)
    // Each segment sits above the previous one, with a hairline between them.
    expect(first[1].y + first[1].height).toBeLessThanOrEqual(first[0].y)
    expect(first[2].y + first[2].height).toBeLessThanOrEqual(first[1].y)
    expect(first[0].y - (first[1].y + first[1].height)).toBeLessThan(3)
    expect(Number(scene.axisLabels.at(-1)?.text)).toBeGreaterThanOrEqual(6)
    // Not stacked: the axis only needs the largest single value.
    expect(
      Number(
        buildScene(
          data('column', [
            [1, 2],
            [2, 1],
            [3, 3]
          ]),
          options()
        ).axisLabels.at(-1)?.text
      )
    ).toBe(3)
  })

  it('draws negative values below the baseline, clipped on the other side', () => {
    const scene = buildScene(data('column', [[5, -3]]), options())
    const base = scene.clips[0].height
    const [up, down] = bars(scene)
    expect(up.clip).toBe(0)
    expect(down.clip).toBe(1)
    expect(down.y).toBeLessThan(base)
    expect(down.y + down.height).toBeGreaterThan(base)
    expect(scene.clips[1].y).toBe(base)
    expect(scene.axisLabels.map((label) => Number(label.text))).toContain(0)
  })

  it('skips values that are missing, keeping the category', () => {
    const scene = buildScene(data('column', [[1, null, 3]]), options())
    expect(bars(scene).map((mark) => mark.ci)).toEqual([0, 2])
    expect(scene.bands).toHaveLength(3)
    expect(scene.categoryLabels).toHaveLength(3)
  })

  it('value labels sit above the bars and hide when they would collide', () => {
    const roomy = buildScene(data('column', [[1, 4, 2]]), options({ showValues: true }))
    expect(roomy.valueLabels.map((label) => label.text)).toEqual(['1', '4', '2'])
    const marks = bars(roomy)
    roomy.valueLabels.forEach((label, i) => expect(label.y).toBeLessThan(marks[i].y))

    const crowded = buildScene(data('column', [Array.from({ length: 60 }, (_, i) => 1000 + i)]), options({ showValues: true, width: 420 }))
    // Labels wider than the room of their own bar would sit on the neighbours: none is drawn.
    expect(crowded.valueLabels).toEqual([])
    // Labels of different widths: the ones that fit their bar stay, and never touch each other.
    const mixed = buildScene(
      data('column', [Array.from({ length: 16 }, (_, i) => (i % 2 ? 7 : 123456))]),
      options({ showValues: true, width: 420 })
    )
    expect(mixed.valueLabels.map((label) => label.text)).toEqual(Array(8).fill('7'))
    const grouped = buildScene(data('line', [Array.from({ length: 30 }, (_, i) => 1000 + i)]), options({ showValues: true, width: 420 }))
    expect(grouped.valueLabels.length).toBeGreaterThan(0)
    expect(grouped.valueLabels.length).toBeLessThan(30)
    const xs = grouped.valueLabels.map((label) => label.x)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(measure('1000'))
    expect(buildScene(data('column', [[1, 4, 2]]), options()).valueLabels).toEqual([])
  })

  it('stacked value labels show the total of each stack', () => {
    const scene = buildScene(
      data('column', [
        [1, 2],
        [2, 1],
        [3, 3]
      ]),
      options({ stacked: true, showValues: true })
    )
    expect(scene.valueLabels.map((label) => label.text)).toEqual(['6', '6'])
  })

  it('truncates long category labels (keeping the full text) and thins them out when slots are narrow', () => {
    const long = buildScene(data('column', [[1, 2, 3, 4]], ['A very long category name indeed', 'B', 'C', 'D']), options({ width: 320 }))
    const first = long.categoryLabels[0]
    expect(first.text.endsWith('…')).toBe(true)
    expect(first.full).toBe('A very long category name indeed')
    expect(long.categoryLabels[1].full).toBeUndefined()

    const many = buildScene(
      data(
        'column',
        [Array.from({ length: 80 }, () => 1)],
        Array.from({ length: 80 }, (_, i) => `Week ${i}`)
      ),
      options()
    )
    expect(many.categoryLabels.length).toBeLessThan(40)
    expect(many.categoryLabels.length).toBeGreaterThan(4)
    const xs = many.categoryLabels.map((label) => label.x)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(measure(many.categoryLabels[i].text))
    expect(inside(many)).toBe(true)
  })

  it('without grid lines only the baseline remains', () => {
    const scene = buildScene(data('column', [[1, 4, 2]]), options({ showGrid: false }))
    expect(scene.grid).toHaveLength(1)
    expect(scene.grid[0].zero).toBe(true)
    expect(scene.axisLabels.length).toBeGreaterThan(1)
  })
})

describe('line and area charts', () => {
  it('draws a line through the points and leaves a gap where a value is missing', () => {
    const scene = buildScene(data('line', [[1, 2, null, 4, 5]]), options())
    const lines = scene.paths.filter((path) => path.kind === 'line')
    expect(lines).toHaveLength(2)
    expect(lines[0].d.match(/L/g)).toHaveLength(1)
    expect(scene.marks.map((mark) => mark.ci)).toEqual([0, 1, 3, 4])
    expect(scene.marks.every((mark) => mark.shape === 'point')).toBe(true)
    expect(scene.crosshair).toBe(true)
    expect(scene.showPoints).toBe(true)
  })

  it('a point without neighbours is always shown, and many points are only shown on hover', () => {
    const lonely = buildScene(data('line', [[1, null, 3, null, 5, 6]]), options())
    expect(lonely.marks.map((mark) => !!mark.isolated)).toEqual([true, true, false, false])
    const many = buildScene(data('line', [Array.from({ length: 120 }, (_, i) => i)]), options())
    expect(many.showPoints).toBe(false)
    expect(many.marks).toHaveLength(120)
  })

  it('"Other" and "No value" are not joined to the axis by a line', () => {
    const withEmpty = data('line', [[1, 2, 3, 4]])
    withEmpty.categories[3].kind = 'empty'
    const scene = buildScene(withEmpty, options())
    const line = scene.paths.filter((path) => path.kind === 'line')
    expect(line).toHaveLength(1)
    expect(line[0].d.match(/L/g)).toHaveLength(2)
    expect(scene.marks.map((mark) => !!mark.isolated)).toEqual([false, false, false, true])
    const area = data('area', [[1, 2, 3, 4]])
    area.categories[2].kind = 'other'
    area.categories[3].kind = 'empty'
    expect(buildScene(area, options()).paths.filter((path) => path.kind === 'area')).toHaveLength(1)
  })

  it('date axes skip labels instead of cutting them short', () => {
    const months = data(
      'line',
      [Array.from({ length: 12 }, (_, i) => i)],
      Array.from({ length: 12 }, (_, i) => `Month ${i + 1} 2025`)
    )
    const dated = buildScene({ ...months, bucket: 'month' }, options({ width: 640 }))
    expect(dated.categoryLabels.every((label) => !label.text.endsWith('…'))).toBe(true)
    expect(dated.categoryLabels.length).toBeLessThan(12)
    const named = buildScene(months, options({ width: 640 }))
    expect(named.categoryLabels).toHaveLength(12)
    expect(named.categoryLabels.some((label) => label.text.endsWith('…'))).toBe(true)
  })

  it('a line does not have to start at zero, an area does', () => {
    const line = buildScene(data('line', [[100, 104, 102]]), options())
    expect(Number(line.axisLabels[0].text)).toBeGreaterThan(0)
    const area = buildScene(data('area', [[100, 104, 102]]), options())
    expect(Number(area.axisLabels[0].text)).toBe(0)
    expect(area.paths.filter((path) => path.kind === 'area')).toHaveLength(1)
    expect(area.paths.find((path) => path.kind === 'area')?.d.endsWith('Z')).toBe(true)
  })

  it('stacked areas pile up: each series is drawn on top of the one before', () => {
    const scene = buildScene(
      data('area', [
        [1, 2, 3],
        [2, 2, 2]
      ]),
      options({ stacked: true })
    )
    const lower = scene.marks.filter((mark) => mark.si === 0)
    const upper = scene.marks.filter((mark) => mark.si === 1)
    upper.forEach((mark, i) => expect(mark.y).toBeLessThan(lower[i].y))
    expect(Number(scene.axisLabels.at(-1)?.text)).toBeGreaterThanOrEqual(5)
    expect(scene.paths.filter((path) => path.kind === 'area')).toHaveLength(2)
  })

  it('a single category is one visible point in the middle', () => {
    const scene = buildScene(data('line', [[7]]), options())
    expect(scene.marks).toHaveLength(1)
    expect(scene.marks[0].isolated).toBe(true)
    expect(scene.marks[0].x).toBeGreaterThan(200)
    expect(scene.paths).toEqual([])
  })
})

describe('bar charts', () => {
  it('runs categories down the side and values along the bottom', () => {
    const scene = buildScene(data('bar', [[1, 4, 2]]), options())
    expect(scene.horizontal).toBe(true)
    const marks = bars(scene)
    const base = scene.clips[0].x
    expect(marks.map((mark) => mark.y)).toEqual([...marks.map((mark) => mark.y)].sort((a, b) => a - b))
    const ends = marks.map((mark) => mark.x + mark.width)
    expect(ends[1]).toBeGreaterThan(ends[2])
    expect(ends[2]).toBeGreaterThan(ends[0])
    for (const mark of marks) expect(mark.x).toBeLessThan(base)
    expect(scene.categoryLabels.every((label) => label.anchor === 'end' && label.x < base)).toBe(true)
    expect(scene.axisLabels.map((label) => label.text)).toContain('0')
    expect(inside(scene)).toBe(true)
  })

  it('grows taller than its box when there are many categories, so that it scrolls instead of squeezing', () => {
    const scene = buildScene(data('bar', [Array.from({ length: 40 }, (_, i) => i + 1)]), options({ height: 300 }))
    expect(scene.height).toBeGreaterThan(300)
    const marks = bars(scene)
    expect(marks[1].y - marks[0].y).toBeGreaterThanOrEqual(22)
    const few = buildScene(data('bar', [[1, 2]]), options({ height: 300 }))
    expect(few.height).toBe(300)
  })

  it('keeps the label column within a third of the width and truncates what does not fit', () => {
    const scene = buildScene(data('bar', [[1, 2]], ['x'.repeat(200), 'Short']), options({ width: 500 }))
    expect(scene.categoryLabels[0].text.endsWith('…')).toBe(true)
    expect(scene.categoryLabels[0].full).toHaveLength(200)
    expect(measure(scene.categoryLabels[0].text)).toBeLessThanOrEqual(500 * 0.32)
    expect(scene.categoryLabels[1].text).toBe('Short')
    expect(scene.clips[0].x).toBeLessThan(500 * 0.4)
  })

  it('value labels follow the end of each bar and stay inside the picture', () => {
    const scene = buildScene(
      data('bar', [[10, 400000, 25]]),
      options({ showValues: true, format: (v) => (v === null ? '' : `${v} units`) })
    )
    expect(scene.valueLabels.map((label) => label.text)).toEqual(['10 units', '400000 units', '25 units'])
    for (const label of scene.valueLabels) expect(label.x + measure(label.text)).toBeLessThanOrEqual(scene.width)
    const stacked = buildScene(
      data('bar', [
        [1, 2],
        [3, 4]
      ]),
      options({ showValues: true, stacked: true })
    )
    expect(stacked.valueLabels.map((label) => label.text)).toEqual(['4', '6'])
    expect(bars(stacked).every((mark) => mark.stacked)).toBe(true)
  })
})

describe('pie and donut charts', () => {
  const pie = (kind: ChartKind, values: (number | null)[]): L.ChartData => {
    const base = data(kind, [values])
    base.categories.forEach((category, i) => (category.colour = L.CHART_COLOURS[i]))
    return { ...base, split: false }
  }

  it('draws one slice per positive value, in the colour of its category', () => {
    const scene = buildScene(pie('pie', [1, 0, 3, null]), options())
    expect(scene.marks.map((mark) => mark.ci)).toEqual([0, 2])
    expect(scene.marks.every((mark) => mark.shape === 'slice' && !!mark.d)).toBe(true)
    expect(scene.marks.map((mark) => mark.colour)).toEqual(['blue', 'pink'])
    expect(scene.bands).toEqual([])
    expect(scene.grid).toEqual([])
    expect(scene.centre).toBeUndefined()
  })

  it('a donut has a hole with the total in it', () => {
    const scene = buildScene(pie('donut', [1, 3]), options())
    expect(scene.centre).toMatchObject({ value: '4', label: 'Total', x: 300, y: 150 })
    expect(scene.centre!.width).toBeGreaterThan(40)
    // Ring segments have an inner arc: two arcs per path.
    expect(scene.marks[0].d!.match(/A /g)).toHaveLength(2)
    const average = buildScene({ ...pie('donut', [1, 3]), additive: false, total: 2, yLabel: 'Average Points' }, options())
    expect(average.centre).toMatchObject({ value: '2', label: 'Average Points' })
  })

  it('labels slices with their share, outside the pie, and leaves slivers unlabelled', () => {
    const scene = buildScene(pie('pie', [50, 49, 1]), options({ showValues: true }))
    expect(scene.valueLabels.map((label) => label.text)).toEqual(['50%', '49%'])
    for (const label of scene.valueLabels) expect(Math.hypot(label.x - 300, label.y - 150)).toBeGreaterThan(100)
    expect(inside(scene)).toBe(true)
  })

  it('fits the smaller side of its box', () => {
    const wide = buildScene(pie('pie', [1, 1]), options({ width: 900, height: 200 }))
    for (const mark of wide.marks) expect(Math.hypot(mark.ax - 450, mark.ay - 100)).toBeLessThan(100)
  })

  it('a single slice is a full circle', () => {
    const scene = buildScene(pie('pie', [5]), options())
    expect(scene.marks).toHaveLength(1)
    expect(scene.marks[0].d).toMatch(/Z$/)
  })
})

describe('degenerate input', () => {
  it('gives an empty scene instead of failing', () => {
    expect(buildScene(data('column', [[]]), options()).marks).toEqual([])
    expect(buildScene({ ...data('column', [[1]]), series: [] }, options()).marks).toEqual([])
    expect(buildScene(data('column', [[1, 2]]), options({ width: 0 })).marks).toEqual([])
    expect(buildScene(data('column', [[1, 2]]), options({ height: 0 })).marks).toEqual([])
  })

  it('all-zero and all-missing values still give an axis', () => {
    const zero = buildScene(data('column', [[0, 0]]), options())
    expect(zero.axisLabels.length).toBeGreaterThan(1)
    expect(bars(zero).every((mark) => mark.height >= 0)).toBe(true)
    const missing = buildScene(data('line', [[null, null]]), options())
    expect(missing.marks).toEqual([])
    expect(missing.axisLabels.length).toBeGreaterThan(1)
    expect(buildScene(data('pie', [[0, null]]), options()).marks).toEqual([])
  })

  it('never produces a non-finite coordinate', () => {
    const finite = (scene: Scene): boolean =>
      scene.marks.every((mark) => [mark.x, mark.y, mark.width, mark.height, mark.ax, mark.ay].every(Number.isFinite)) &&
      scene.paths.every((path) => !/NaN|Infinity/.test(path.d)) &&
      [...scene.axisLabels, ...scene.categoryLabels, ...scene.valueLabels].every(
        (label) => Number.isFinite(label.x) && Number.isFinite(label.y)
      )
    for (const kind of ['column', 'bar', 'line', 'area', 'pie', 'donut'] as ChartKind[]) {
      for (const values of [[5], [0], [-5], [1e12, 1], [1e-9, 2e-9], [3, null, 3], [-2, 4, -6]]) {
        for (const stacked of [false, true]) {
          expect(finite(buildScene(data(kind, [values, values]), options({ stacked, showValues: true, width: 90, height: 60 })))).toBe(true)
          expect(finite(buildScene(data(kind, [values]), options({ stacked, showValues: true })))).toBe(true)
        }
      }
    }
  })
})
