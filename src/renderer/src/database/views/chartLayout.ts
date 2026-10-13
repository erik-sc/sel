// Geometry of a chart: from aggregated data and a size to a "scene" of marks, lines,
// labels and hit areas in pixels. Pure (text is measured through a function it is
// given), so the SVG renderer only draws what is described here and hovering never
// recomputes any of it.
import * as L from './chartLogic'

export interface SceneLabel {
  x: number
  y: number
  text: string
  /** The untruncated text, when `text` was shortened. */
  full?: string
  anchor: 'start' | 'middle' | 'end'
  /** Vertically centred on `y` instead of sitting on it. */
  middle?: boolean
  current?: boolean
}

export interface SceneMark {
  /** Category and series index into the data the scene was built from. */
  ci: number
  si: number
  shape: 'bar' | 'point' | 'slice'
  x: number
  y: number
  width: number
  height: number
  /** bar: index into `Scene.clips`; the rounded rect runs past the baseline and is cut there. */
  clip?: number
  /** bar: a segment of a stack (only slightly rounded, never clipped). */
  stacked?: boolean
  /** point: no neighbour to draw a line to, so the dot is always shown. */
  isolated?: boolean
  /** slice: the path. */
  d?: string
  colour: string
  /** Where a tooltip for the mark points at. */
  ax: number
  ay: number
  /** Where it points at when it has to go under the mark instead (thin horizontal bars). */
  ab?: number
}

export interface ScenePath {
  si: number
  d: string
  colour: string
  kind: 'line' | 'area'
}

export interface SceneBand {
  ci: number
  x: number
  y: number
  width: number
  height: number
  ax: number
  ay: number
  ab?: number
}

export interface Scene {
  width: number
  /** May exceed the container for a bar chart with many categories (it scrolls). */
  height: number
  marks: SceneMark[]
  paths: ScenePath[]
  grid: { x1: number; y1: number; x2: number; y2: number; zero: boolean }[]
  axisLabels: SceneLabel[]
  categoryLabels: SceneLabel[]
  valueLabels: SceneLabel[]
  bands: SceneBand[]
  clips: { x: number; y: number; width: number; height: number }[]
  /** line / area: a vertical rule follows the hovered category. */
  crosshair: boolean
  /** line / area: dots are drawn for every point (few categories) or only on hover. */
  showPoints: boolean
  /** horizontal bar: categories run down the page, so the arrow keys swap roles. */
  horizontal: boolean
  centre?: { x: number; y: number; value: string; label: string; width: number }
}

export interface SceneOptions {
  width: number
  height: number
  fontSize: number
  measure: L.Measure
  stacked: boolean
  showValues: boolean
  showGrid: boolean
  /** A value as text. */
  format: (value: number | null) => string
  /** The ticks of the value axis as text, formatted as one set. */
  formatTicks: (values: number[]) => string[]
  formatShare: (share: number) => string
}

/** Bars run this far past their baseline before being clipped there, so only the data end is rounded. */
const BAR_OVERSHOOT = 20
const BAR_GAP = 2
const MAX_BAR = 56
const POINTS_UP_TO = 40

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

function colourOf(data: L.ChartData, ci: number, si: number, perCategory: boolean): string {
  const series = data.series[si]
  const category = data.categories[ci]
  return (perCategory && !data.split ? category?.colour : undefined) ?? series?.colour ?? L.CHART_ACCENT_COLOUR
}

function emptyScene(o: SceneOptions): Scene {
  return {
    width: o.width,
    height: o.height,
    marks: [],
    paths: [],
    grid: [],
    axisLabels: [],
    categoryLabels: [],
    valueLabels: [],
    bands: [],
    clips: [],
    crosshair: false,
    showPoints: false,
    horizontal: false
  }
}

interface Stack {
  positive: number
  negative: number
}

/** Extent of the values (and, when stacked, of the stacks) with zero included where bars need it. */
function domainOf(data: L.ChartData, stacked: boolean, zero: boolean): { lo: number; hi: number; stacks: Stack[] } {
  let lo = Infinity
  let hi = -Infinity
  const stacks: Stack[] = data.categories.map(() => ({ positive: 0, negative: 0 }))
  for (const series of data.series) {
    series.values.forEach((value, ci) => {
      if (typeof value !== 'number' || !isFinite(value) || !stacks[ci]) return
      if (value >= 0) stacks[ci].positive += value
      else stacks[ci].negative += value
      if (value < lo) lo = value
      if (value > hi) hi = value
    })
  }
  if (stacked) {
    lo = Math.min(...stacks.map((s) => s.negative))
    hi = Math.max(...stacks.map((s) => s.positive))
  }
  if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1, stacks }
  if (zero || lo < 0.35 * hi) {
    // Bars and areas are lengths from zero; a line only leaves zero out when that shows more.
    if (lo > 0) lo = 0
    if (hi < 0) hi = 0
  }
  return { lo, hi, stacks }
}

/** Labels of a horizontal category axis: shortened to their slot, or thinned out when slots are narrow. */
function categoryAxis(
  data: L.ChartData,
  centre: (ci: number) => number,
  slot: number,
  y: number,
  minX: number,
  maxX: number,
  o: SceneOptions
): SceneLabel[] {
  const labels = data.categories.map((category) => category.label)
  const widest = labels.reduce((max, label) => Math.max(max, o.measure(label)), 0)
  let stride = 1
  let room = slot - 6
  // A date cut short ("Mar 20…") says nothing: date axes skip labels instead. Names are
  // shortened while their slot leaves something to read.
  if (widest > room && (slot < 44 || data.bucket !== undefined)) {
    stride = L.labelStride(slot, Math.min(widest, 76), 10)
    room = stride * slot - 10
  }
  const out: SceneLabel[] = []
  for (let ci = 0; ci < labels.length; ci += stride) {
    const text = L.truncateLabel(labels[ci], Math.max(room, 12), o.measure)
    if (!text) continue
    const half = o.measure(text) / 2
    const label: SceneLabel = { x: clamp(centre(ci), minX + half, Math.max(minX + half, maxX - half)), y, text, anchor: 'middle' }
    if (text !== labels[ci]) label.full = labels[ci]
    if (data.categories[ci].current) label.current = true
    out.push(label)
  }
  return out
}

function keepVisible(labels: SceneLabel[], o: SceneOptions, scene: Scene): SceneLabel[] {
  const boxes = labels.map((label) => {
    const width = o.measure(label.text)
    const x = label.anchor === 'middle' ? label.x - width / 2 : label.anchor === 'end' ? label.x - width : label.x
    return { x, y: label.middle ? label.y - o.fontSize / 2 : label.y - o.fontSize, width, height: o.fontSize }
  })
  const visible = L.hideCollidingLabels(boxes, 3, { x: 0, y: 0, width: scene.width, height: scene.height })
  return labels.filter((_, index) => visible[index])
}

/** Column, line and area charts: categories along the bottom, values up the side. */
function vertical(data: L.ChartData, o: SceneOptions): Scene {
  const scene = emptyScene(o)
  const n = data.categories.length
  const k = data.series.length
  const isBars = data.kind === 'column'
  const stacked = o.stacked && k > 1 && data.kind !== 'line'
  const { lo, hi } = domainOf(data, stacked, data.kind !== 'line')

  const top = o.showValues ? o.fontSize + 12 : 10
  const bottom = o.fontSize + 16
  const right = 10
  const ticks = L.niceTicks(lo, hi, clamp(Math.floor((o.height - top - bottom) / 44), 2, 6), data.yFormat.integer)
  const tickTexts = o.formatTicks(ticks.values)
  const left = Math.ceil(tickTexts.reduce((max, text) => Math.max(max, o.measure(text)), 0)) + 12
  const plotWidth = Math.max(10, o.width - left - right)
  const plotHeight = Math.max(10, o.height - top - bottom)
  const span = ticks.max - ticks.min || 1
  const yOf = (value: number): number => top + plotHeight * (1 - (value - ticks.min) / span)
  const slot = plotWidth / n
  const xOf = (ci: number): number => left + slot * (ci + 0.5)
  const base = yOf(clamp(0, ticks.min, ticks.max))

  ticks.values.forEach((value, index) => {
    const y = yOf(value)
    const zero = value === 0 || (index === 0 && ticks.min > 0)
    if (o.showGrid || zero) scene.grid.push({ x1: left, y1: y, x2: o.width - right, y2: y, zero })
    scene.axisLabels.push({ x: left - 8, y, text: tickTexts[index], anchor: 'end', middle: true })
  })
  scene.categoryLabels = categoryAxis(data, xOf, slot, top + plotHeight + o.fontSize + 6, 0, o.width, o)
  scene.clips = [
    { x: 0, y: 0, width: o.width, height: base },
    { x: 0, y: base, width: o.width, height: Math.max(0, o.height - base) }
  ]

  const labels: SceneLabel[] = []
  const tops: number[] = data.categories.map(() => top + plotHeight)

  if (isBars) {
    const lanes = stacked ? 1 : k
    const group = Math.min(slot * (n === 1 ? 0.4 : 0.72), lanes * MAX_BAR + (lanes - 1) * BAR_GAP)
    const barWidth = Math.max(1, (group - (lanes - 1) * BAR_GAP) / lanes)
    for (let ci = 0; ci < n; ci++) {
      let up = 0
      let down = 0
      for (let si = 0; si < k; si++) {
        const value = data.series[si].values[ci]
        if (typeof value !== 'number' || !isFinite(value)) continue
        const x = xOf(ci) - group / 2 + (stacked ? 0 : si * (barWidth + BAR_GAP))
        const colour = colourOf(data, ci, si, true)
        if (stacked) {
          const from = value >= 0 ? up : down
          const to = from + value
          if (value >= 0) up = to
          else down = to
          const y1 = Math.min(yOf(from), yOf(to))
          const size = Math.abs(yOf(to) - yOf(from))
          // A hairline of surface between segments, taken from the far end of each.
          const gap = size > 3 ? 1.5 : 0
          scene.marks.push({
            ci,
            si,
            shape: 'bar',
            x,
            y: value >= 0 ? y1 + gap : y1,
            width: barWidth,
            height: Math.max(0, size - gap),
            stacked: true,
            colour,
            ax: x + barWidth / 2,
            ay: y1
          })
          tops[ci] = Math.min(tops[ci], y1)
          continue
        }
        const y = yOf(value)
        const size = Math.abs(y - base)
        scene.marks.push({
          ci,
          si,
          shape: 'bar',
          x,
          y: value >= 0 ? y : base - BAR_OVERSHOOT,
          width: barWidth,
          height: size + BAR_OVERSHOOT,
          clip: value >= 0 ? 0 : 1,
          colour,
          ax: x + barWidth / 2,
          ay: Math.min(y, base)
        })
        tops[ci] = Math.min(tops[ci], y, base)
        if (o.showValues) {
          const text = o.format(value)
          // A label wider than the room of its own bar would sit on its neighbours: left out.
          if (o.measure(text) <= slot / lanes - 2) {
            labels.push({ x: x + barWidth / 2, y: value >= 0 ? y - 5 : y + o.fontSize + 3, text, anchor: 'middle' })
          }
        }
      }
      if (stacked && o.showValues && (up !== 0 || down !== 0)) {
        const text = o.format(up + down)
        if (o.measure(text) <= slot - 2) labels.push({ x: xOf(ci), y: yOf(up) - 5, text, anchor: 'middle' })
      }
    }
  } else {
    scene.crosshair = true
    scene.showPoints = n <= POINTS_UP_TO
    const lower: number[] = data.categories.map(() => 0)
    for (let si = 0; si < k; si++) {
      const colour = data.series[si].colour ?? L.CHART_ACCENT_COLOUR
      const values = data.series[si].values
      const upper: (number | null)[] = values.map((value, ci) => {
        if (typeof value !== 'number' || !isFinite(value)) return stacked ? lower[ci] : null
        return stacked ? lower[ci] + value : value
      })
      // Runs of consecutive points: a gap in the data is a gap in the line.
      let run: number[] = []
      const flush = (): void => {
        if (!run.length) return
        const points = run.map((ci) => `${xOf(ci).toFixed(1)} ${yOf(upper[ci] as number).toFixed(1)}`)
        if (run.length > 1) scene.paths.push({ si, colour, kind: 'line', d: `M ${points.join(' L ')}` })
        if (data.kind === 'area') {
          const floor = run
            .slice()
            .reverse()
            .map((ci) => `${xOf(ci).toFixed(1)} ${(stacked ? yOf(lower[ci]) : base).toFixed(1)}`)
          // A lone point has no area; two or more close back along the layer below.
          if (run.length > 1) scene.paths.push({ si, colour, kind: 'area', d: `M ${points.join(' L ')} L ${floor.join(' L ')} Z` })
        }
        run = []
      }
      for (let ci = 0; ci < n; ci++) {
        // "Other" and "No value" are not points on the axis: no line runs into them.
        if (ci > 0 && data.categories[ci].kind !== data.categories[ci - 1].kind) flush()
        if (upper[ci] === null) flush()
        else run.push(ci)
      }
      flush()
      for (let ci = 0; ci < n; ci++) {
        const value = values[ci]
        if (typeof value !== 'number' || !isFinite(value)) continue
        const cy = yOf(upper[ci] as number)
        const joins = (a: number, b: number): boolean => upper[a] !== null && upper[b] !== null && data.categories[a].kind === data.categories[b].kind
        const isolated = !(ci > 0 && joins(ci - 1, ci)) && !(ci < n - 1 && joins(ci, ci + 1))
        scene.marks.push({ ci, si, shape: 'point', x: xOf(ci), y: cy, width: 0, height: 0, isolated, colour, ax: xOf(ci), ay: cy })
        tops[ci] = Math.min(tops[ci], cy)
        if (o.showValues) labels.push({ x: xOf(ci), y: cy - 8, text: o.format(value), anchor: 'middle' })
      }
      if (stacked) upper.forEach((value, ci) => (lower[ci] = value as number))
    }
  }

  for (let ci = 0; ci < n; ci++) {
    scene.bands.push({ ci, x: left + slot * ci, y: top, width: slot, height: plotHeight, ax: xOf(ci), ay: tops[ci] })
  }
  scene.valueLabels = keepVisible(labels, o, scene)
  return scene
}

/** Bar chart: categories down the side, values along the bottom. Grows (and scrolls) with many categories. */
function horizontal(data: L.ChartData, o: SceneOptions): Scene {
  const scene = emptyScene(o)
  scene.horizontal = true
  const n = data.categories.length
  const k = data.series.length
  const stacked = o.stacked && k > 1
  const { lo, hi } = domainOf(data, stacked, true)

  const names = data.categories.map((category) => category.label)
  const labelWidth = Math.min(names.reduce((max, name) => Math.max(max, o.measure(name)), 0), o.width * 0.32, 200)
  const left = Math.ceil(labelWidth) + 14
  const bottom = o.fontSize + 16
  const lanes = stacked ? 1 : k
  const minSlot = lanes * 12 + (lanes - 1) * BAR_GAP + 10
  const slot = clamp((o.height - 8 - bottom) / n, Math.max(22, minSlot), 76)
  const plotHeight = slot * n
  const top = Math.max(8, (o.height - bottom - plotHeight) / 2)
  scene.height = Math.max(o.height, top + plotHeight + bottom)

  // The value axis is laid out twice: the room for value labels depends on its ticks and vice versa.
  let ticks = L.niceTicks(lo, hi, 4, data.yFormat.integer)
  let right = 14
  for (let pass = 0; pass < 2; pass++) {
    const widest = o.showValues
      ? data.series.reduce((max, series) => series.values.reduce<number>((m, v) => Math.max(m, o.measure(o.format(v))), max), 0)
      : 0
    right = Math.ceil(Math.max(o.showValues ? widest + 10 : 0, o.measure(o.formatTicks(ticks.values).at(-1) ?? '') / 2 + 4, 14))
    const room = Math.max(10, o.width - left - right)
    ticks = L.niceTicks(lo, hi, clamp(Math.floor(room / 84), 2, 6), data.yFormat.integer)
  }
  const plotWidth = Math.max(10, o.width - left - right)
  const span = ticks.max - ticks.min || 1
  const xOf = (value: number): number => left + (plotWidth * (value - ticks.min)) / span
  const base = xOf(clamp(0, ticks.min, ticks.max))
  const yOf = (ci: number): number => top + slot * (ci + 0.5)

  const tickLabels: SceneLabel[] = []
  const tickTexts = o.formatTicks(ticks.values)
  ticks.values.forEach((value, index) => {
    const x = xOf(value)
    const zero = value === 0 || (index === 0 && ticks.min > 0)
    if (o.showGrid || zero) scene.grid.push({ x1: x, y1: top, x2: x, y2: top + plotHeight, zero })
    tickLabels.push({ x, y: top + plotHeight + o.fontSize + 6, text: tickTexts[index], anchor: 'middle' })
  })
  scene.axisLabels = keepVisible(tickLabels, o, scene)
  scene.categoryLabels = names.map((name, ci) => {
    const text = L.truncateLabel(name, labelWidth, o.measure)
    const label: SceneLabel = { x: left - 10, y: yOf(ci), text, anchor: 'end', middle: true }
    if (text !== name) label.full = name
    if (data.categories[ci].current) label.current = true
    return label
  })
  scene.clips = [
    { x: base, y: 0, width: Math.max(0, o.width - base), height: scene.height },
    { x: 0, y: 0, width: base, height: scene.height }
  ]

  const group = Math.min(slot * 0.72, lanes * 30 + (lanes - 1) * BAR_GAP)
  const thickness = Math.max(1, (group - (lanes - 1) * BAR_GAP) / lanes)
  const labels: SceneLabel[] = []
  for (let ci = 0; ci < n; ci++) {
    let up = 0
    let down = 0
    let reach = base
    for (let si = 0; si < k; si++) {
      const value = data.series[si].values[ci]
      if (typeof value !== 'number' || !isFinite(value)) continue
      const y = yOf(ci) - group / 2 + (stacked ? 0 : si * (thickness + BAR_GAP))
      const colour = colourOf(data, ci, si, true)
      if (stacked) {
        const from = value >= 0 ? up : down
        const to = from + value
        if (value >= 0) up = to
        else down = to
        const x1 = Math.min(xOf(from), xOf(to))
        const size = Math.abs(xOf(to) - xOf(from))
        const gap = size > 3 ? 1.5 : 0
        scene.marks.push({
          ci,
          si,
          shape: 'bar',
          x: value >= 0 ? x1 : x1 + gap,
          y,
          width: Math.max(0, size - gap),
          height: thickness,
          stacked: true,
          colour,
          ax: x1 + size,
          ay: y,
          ab: y + thickness
        })
        reach = Math.max(reach, x1 + size)
        continue
      }
      const x = xOf(value)
      const size = Math.abs(x - base)
      scene.marks.push({
        ci,
        si,
        shape: 'bar',
        x: value >= 0 ? base - BAR_OVERSHOOT : x,
        y,
        width: size + BAR_OVERSHOOT,
        height: thickness,
        clip: value >= 0 ? 0 : 1,
        colour,
        ax: Math.max(x, base),
        ay: y,
        ab: y + thickness
      })
      reach = Math.max(reach, x)
      if (o.showValues) {
        labels.push({
          x: value >= 0 ? x + 6 : x - 6,
          y: y + thickness / 2,
          text: o.format(value),
          anchor: value >= 0 ? 'start' : 'end',
          middle: true
        })
      }
    }
    if (stacked && o.showValues && (up !== 0 || down !== 0)) {
      labels.push({ x: xOf(up) + 6, y: yOf(ci), text: o.format(up + down), anchor: 'start', middle: true })
    }
    scene.bands.push({ ci, x: 0, y: top + slot * ci, width: o.width, height: slot, ax: reach, ay: top + slot * ci + 2, ab: top + slot * (ci + 1) - 2 })
  }
  scene.valueLabels = keepVisible(labels, o, scene)
  return scene
}

/** Pie and donut: one slice per category with a positive value. */
function radial(data: L.ChartData, o: SceneOptions): Scene {
  const scene = emptyScene(o)
  const values = data.series[0]?.values ?? []
  const cx = o.width / 2
  const cy = o.height / 2
  const outer = Math.max(10, Math.min(o.width, o.height) / 2 - (o.showValues ? o.fontSize + 26 : 8))
  const inner = data.kind === 'donut' ? outer * 0.62 : 0
  const slices = L.pieSlices(values)
  // The gap between slices is surface showing through, not a stroke.
  const pad = slices.length > 1 ? Math.min(0.03, 1.2 / outer) : 0
  const labels: SceneLabel[] = []
  let sum = 0
  for (const slice of slices) {
    const value = values[slice.index] as number
    sum += value
    const sweep = slice.to - slice.from
    const trim = sweep > pad * 4 ? pad : 0
    const mid = (slice.from + slice.to) / 2
    const reach = (inner + outer) / 2
    scene.marks.push({
      ci: slice.index,
      si: 0,
      shape: 'slice',
      x: cx,
      y: cy,
      width: 0,
      height: 0,
      d: L.arcPath(cx, cy, inner, outer, slice.from + trim, slice.to - trim),
      colour: data.categories[slice.index]?.colour ?? L.CHART_COLOURS[0],
      ax: cx + reach * Math.cos(mid),
      ay: cy + reach * Math.sin(mid)
    })
    if (o.showValues && slice.share >= 0.03) {
      const cos = Math.cos(mid)
      labels.push({
        x: cx + (outer + 10) * cos,
        y: cy + (outer + 10) * Math.sin(mid),
        text: o.formatShare(slice.share),
        anchor: cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle',
        middle: true
      })
    }
  }
  scene.valueLabels = keepVisible(labels, o, scene)
  if (data.kind === 'donut' && slices.length) {
    scene.centre = {
      x: cx,
      y: cy,
      value: o.format(data.additive ? sum : data.total),
      label: data.additive ? 'Total' : data.yLabel,
      width: inner * 1.7
    }
  }
  return scene
}

/** The scene of a chart with at least one category. A single figure (`number`) has no scene. */
export function buildScene(data: L.ChartData, o: SceneOptions): Scene {
  if (!data.categories.length || !data.series.length || !(o.width > 0) || !(o.height > 0)) return emptyScene(o)
  switch (data.kind) {
    case 'bar':
      return horizontal(data, o)
    case 'pie':
    case 'donut':
      return radial(data, o)
    default:
      return vertical(data, o)
  }
}
