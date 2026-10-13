// A chart as a PNG: the SVG that is on screen, with every style it gets from the
// stylesheet written into the copy (an SVG drawn into a canvas has no stylesheet and no
// custom properties), on an opaque background, with its legend drawn underneath.

/** Computed properties that decide how the chart looks; all are valid as inline SVG styles. */
const STYLE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-variant-numeric',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'visibility',
  'r',
  'rx',
  'ry'
]
const SVG_NS = 'http://www.w3.org/2000/svg'
const SCALE = 2
/** Canvases beyond this are refused by the browser (or cost hundreds of megabytes). */
const MAX_CANVAS_SIDE = 8192
const LEGEND_ROW = 22
const PADDING = 16

export interface ExportLegendItem {
  label: string
  /** A CSS colour expression (`var(--c-blue)`); resolved against the chart's own styles. */
  colour: string
}

function resolveColour(context: Element, expression: string): string {
  const probe = document.createElement('span')
  probe.style.color = expression
  probe.style.display = 'none'
  context.appendChild(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour || '#888'
}

let measureContext: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, font: string): number {
  if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d')
  if (!measureContext) return text.length * 7
  measureContext.font = font
  return measureContext.measureText(text).width
}

/** A standalone copy of the chart's SVG as markup, plus its size in CSS pixels. */
export function serializeChart(
  svg: SVGSVGElement,
  options: { title?: string; legend?: ExportLegendItem[] } = {}
): { markup: string; width: number; height: number } {
  const host = svg.parentElement ?? document.body
  const rootStyle = getComputedStyle(svg)
  const chartWidth = svg.width.baseVal.value || svg.clientWidth
  const chartHeight = svg.height.baseVal.value || svg.clientHeight
  const clone = svg.cloneNode(true) as SVGSVGElement

  const originals = svg.querySelectorAll<SVGElement>('*')
  const copies = clone.querySelectorAll<SVGElement>('*')
  const remove: Element[] = []
  originals.forEach((original, index) => {
    const copy = copies[index]
    if (!copy || original.closest('defs') || original.tagName === 'title') return
    const computed = getComputedStyle(original)
    // Hit areas and anything hidden are not part of the picture.
    if (computed.display === 'none' || computed.visibility === 'hidden' || (computed.fill === 'none' && computed.stroke === 'none' && !copy.children.length && copy.tagName !== 'g')) {
      remove.push(copy)
      return
    }
    let style = ''
    for (const property of STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (value) style += `${property}:${value};`
    }
    copy.setAttribute('style', style)
    copy.removeAttribute('class')
    copy.removeAttribute('tabindex')
    copy.removeAttribute('role')
    copy.removeAttribute('aria-label')
    copy.removeAttribute('data-mark')
  })
  for (const el of remove) el.remove()

  const font = `${rootStyle.fontWeight} ${rootStyle.fontSize} ${rootStyle.fontFamily}`
  const textColour = resolveColour(host, 'var(--text)')
  const secondary = resolveColour(host, 'var(--text-secondary)')
  const background = resolveColour(host, 'var(--bg-solid)')
  const fontSize = parseFloat(rootStyle.fontSize) || 11

  // ---- frame: padding, optional title above, legend below ----
  const titleHeight = options.title ? fontSize + 14 : 0
  const legend = options.legend ?? []
  const rows: { item: ExportLegendItem; x: number; row: number }[] = []
  let x = 0
  let row = 0
  for (const item of legend) {
    const width = 16 + textWidth(item.label, font) + 16
    if (x > 0 && x + width > chartWidth) {
      x = 0
      row++
    }
    rows.push({ item, x, row })
    x += width
  }
  const legendHeight = legend.length ? (row + 1) * LEGEND_ROW + 8 : 0
  const width = Math.ceil(chartWidth + PADDING * 2)
  const height = Math.ceil(chartHeight + PADDING * 2 + titleHeight + legendHeight)

  const out = document.createElementNS(SVG_NS, 'svg')
  out.setAttribute('xmlns', SVG_NS)
  out.setAttribute('width', String(width))
  out.setAttribute('height', String(height))
  out.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const add = (tag: string, attributes: Record<string, string | number>, text?: string): SVGElement => {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value))
    if (text !== undefined) el.textContent = text
    out.appendChild(el)
    return el
  }
  add('rect', { x: 0, y: 0, width, height, fill: background })
  const textStyle = `font-family:${rootStyle.fontFamily};font-size:${rootStyle.fontSize};`
  if (options.title) add('text', { x: PADDING, y: PADDING + fontSize, style: `${textStyle}fill:${secondary};` }, options.title)

  clone.setAttribute('x', String(PADDING))
  clone.setAttribute('y', String(PADDING + titleHeight))
  clone.setAttribute('width', String(chartWidth))
  clone.setAttribute('height', String(chartHeight))
  clone.removeAttribute('class')
  clone.removeAttribute('role')
  clone.removeAttribute('aria-label')
  clone.setAttribute('style', textStyle)
  out.appendChild(clone)

  const legendTop = PADDING + titleHeight + chartHeight + 8
  for (const entry of rows) {
    const y = legendTop + entry.row * LEGEND_ROW + LEGEND_ROW / 2
    add('circle', { cx: PADDING + entry.x + 5, cy: y, r: 5, fill: resolveColour(host, entry.item.colour) })
    add('text', { x: PADDING + entry.x + 16, y, 'dominant-baseline': 'central', style: `${textStyle}fill:${textColour};` }, entry.item.label)
  }

  return { markup: new XMLSerializer().serializeToString(out), width, height }
}

/** Renders the chart to a PNG at twice its size on screen. */
export async function chartToPng(svg: SVGSVGElement, options: { title?: string; legend?: ExportLegendItem[] } = {}): Promise<Blob> {
  const { markup, width, height } = serializeChart(svg, options)
  const scale = Math.min(SCALE, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height)
  const image = new Image()
  image.decoding = 'sync'
  // A data: url (allowed by the app's img-src) of a self-contained SVG: no external reference, so the canvas stays readable.
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('The chart could not be drawn as an image'))
  })
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  await loaded
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The chart could not be drawn as an image')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The chart could not be drawn as an image'))), 'image/png')
  })
}
