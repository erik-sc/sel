// The SVG of a chart: draws a scene (see chartLayout.ts) and owns what is purely visual
// about it: hover, keyboard focus and the tooltip. Nothing here aggregates or lays out.
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, KeyboardEvent, RefObject } from 'react'
import * as L from './chartLogic'
import type { Scene, SceneLabel, SceneMark } from './chartLayout'

/** A mark (`si` set) or a whole category (`si` null). */
export interface Target {
  ci: number
  si: number | null
}

export interface PickPoint {
  x: number
  y: number
}

/**
 * The CSS colour of a palette name: a tag colour token, or the accent, softened towards the
 * sheet by --chart-series-strength (the tag colours are text colours, heavy as large fills).
 */
export function colourVar(name: string | undefined): string {
  const named = name && name !== L.CHART_ACCENT_COLOUR && (L.OPTION_COLORS as readonly string[]).includes(name)
  const token = named ? `var(--c-${name})` : 'var(--accent)'
  return `color-mix(in oklab, ${token} var(--chart-series-strength), var(--bg-solid))`
}

function markStyle(colour: string): CSSProperties {
  return { '--db-chart-mark': colourVar(colour) } as CSSProperties
}

function Label({ label, className }: { label: SceneLabel; className: string }): JSX.Element {
  return (
    <text
      className={label.current ? `${className} is-current` : className}
      x={label.x}
      y={label.y}
      textAnchor={label.anchor}
      dominantBaseline={label.middle ? 'central' : undefined}
    >
      {label.text}
      {label.full && <title>{label.full}</title>}
    </text>
  )
}

export interface PlotProps {
  data: L.ChartData
  scene: Scene
  summary: string
  svgRef: RefObject<SVGSVGElement | null>
  /** A mark's or a category's value as text. */
  format: (value: number | null) => string
  /** Share of a mark in its whole, as text; empty when shares mean nothing. */
  shareOf: (ci: number, si: number) => string
  onPick: (target: Target, at: PickPoint) => void
}

const keyOf = (ci: number, si: number): string => `${ci}:${si}`

export const ChartPlot = memo(function ChartPlot(p: PlotProps): JSX.Element {
  const { data, scene, summary, svgRef, format, shareOf, onPick } = p
  const [hover, setHover] = useState<Target | null>(null)
  /** The mark that takes the Tab stop (roving tabindex). */
  const [cursor, setCursor] = useState<string | null>(null)
  const clipId = useId().replace(/[^A-Za-z0-9_-]/g, '')

  const index = useMemo(() => {
    const byKey = new Map<string, SceneMark>()
    for (const mark of scene.marks) byKey.set(keyOf(mark.ci, mark.si), mark)
    const categories = [...new Set(scene.marks.map((mark) => mark.ci))].sort((a, b) => a - b)
    return { byKey, categories }
  }, [scene])

  // A new scene may not have the mark that was hovered or focused.
  useEffect(() => {
    setHover((current) => (current && current.ci < data.categories.length ? current : null))
    setCursor((current) => (current && index.byKey.has(current) ? current : null))
  }, [index, data.categories.length])

  const tabStop = cursor ?? (scene.marks[0] ? keyOf(scene.marks[0].ci, scene.marks[0].si) : null)

  const focusMark = useCallback(
    (key: string) => {
      const el = svgRef.current?.querySelector<SVGElement>(`[data-mark="${key}"]`)
      el?.focus({ preventScroll: false })
    },
    [svgRef]
  )

  const onKeyDown = (event: KeyboardEvent<SVGElement>, mark: SceneMark): void => {
    const along = scene.horizontal ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft']
    const across = scene.horizontal ? ['ArrowRight', 'ArrowLeft'] : ['ArrowUp', 'ArrowDown']
    const { categories, byKey } = index
    const seriesAt = (ci: number): number[] => data.series.map((_, si) => si).filter((si) => byKey.has(keyOf(ci, si)))
    let next: string | null = null
    if (event.key === along[0] || event.key === along[1] || event.key === 'Home' || event.key === 'End') {
      const at = categories.indexOf(mark.ci)
      const to =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? categories.length - 1
            : Math.max(0, Math.min(categories.length - 1, at + (event.key === along[0] ? 1 : -1)))
      const ci = categories[to]
      const series = seriesAt(ci)
      // Stay on the same series where it exists, else the nearest one.
      const si = series.includes(mark.si) ? mark.si : series.reduce((best, s) => (Math.abs(s - mark.si) < Math.abs(best - mark.si) ? s : best), series[0])
      if (ci !== undefined && si !== undefined) next = keyOf(ci, si)
    } else if (event.key === across[0] || event.key === across[1]) {
      const series = seriesAt(mark.ci)
      const at = series.indexOf(mark.si)
      const to = series[at + (event.key === across[0] ? 1 : -1)]
      if (to !== undefined) next = keyOf(mark.ci, to)
      else return
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      onPick({ ci: mark.ci, si: mark.si }, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      return
    } else if (event.key === 'Escape') {
      if (hover) {
        event.stopPropagation()
        setHover(null)
      }
      return
    } else {
      return
    }
    event.preventDefault()
    if (next && next !== keyOf(mark.ci, mark.si)) {
      setCursor(next)
      focusMark(next)
    }
  }

  const isActive = (mark: SceneMark): boolean => !!hover && hover.ci === mark.ci && (hover.si === null || hover.si === mark.si)

  const labelOf = (mark: SceneMark): string => {
    const category = data.categories[mark.ci]?.label ?? ''
    const series = data.split ? `, ${data.series[mark.si]?.label ?? ''}` : ''
    const share = shareOf(mark.ci, mark.si)
    return `${category}${series}: ${format(data.series[mark.si]?.values[mark.ci] ?? null)}${share ? ` (${share})` : ''}`
  }

  const markProps = (mark: SceneMark) => {
    const key = keyOf(mark.ci, mark.si)
    return {
      'data-mark': key,
      role: 'button',
      tabIndex: key === tabStop ? 0 : -1,
      'aria-label': labelOf(mark),
      style: markStyle(mark.colour),
      onMouseEnter: () => setHover({ ci: mark.ci, si: mark.si }),
      onFocus: () => {
        setCursor(key)
        setHover({ ci: mark.ci, si: mark.si })
      },
      onBlur: () => setHover((current) => (current && current.ci === mark.ci && current.si === mark.si ? null : current)),
      onKeyDown: (event: KeyboardEvent<SVGElement>) => onKeyDown(event, mark),
      onClick: (event: { clientX: number; clientY: number; stopPropagation: () => void }) => {
        event.stopPropagation()
        // The list of rows takes over from the tooltip.
        setHover(null)
        onPick({ ci: mark.ci, si: mark.si }, { x: event.clientX, y: event.clientY })
      }
    }
  }

  const hoverBand = hover ? scene.bands.find((band) => band.ci === hover.ci) : undefined
  const hoverMark = hover && hover.si !== null ? index.byKey.get(keyOf(hover.ci, hover.si)) : undefined
  const pointed = hoverMark ?? hoverBand
  const anchor = pointed ? { x: pointed.ax, y: pointed.ay, under: pointed.ab ?? pointed.ay } : null

  return (
    <div className="db-chart-canvas" style={{ width: scene.width, height: scene.height }} onMouseLeave={() => setHover(null)}>
      <svg
        ref={svgRef}
        className={hover ? 'db-chart-svg has-hover' : 'db-chart-svg'}
        width={scene.width}
        height={scene.height}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        role="group"
        aria-label="Chart"
      >
        <defs>
          {scene.clips.map((clip, i) => (
            <clipPath key={i} id={`${clipId}-${i}`}>
              <rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} />
            </clipPath>
          ))}
        </defs>

        {/* Everything a reader takes in at once: one image with a generated description. */}
        <g role="img" aria-label={summary}>
          {scene.grid.map((line, i) => (
            <line
              key={i}
              className={line.zero ? 'db-chart-grid is-zero' : 'db-chart-grid'}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
            />
          ))}
          {scene.axisLabels.map((label, i) => (
            <Label key={i} label={label} className="db-chart-tick" />
          ))}
          {scene.categoryLabels.map((label, i) => (
            <Label key={i} label={label} className="db-chart-category" />
          ))}
        </g>

        {/* Hit areas of whole categories, under the marks. */}
        <g aria-hidden="true">
          {scene.bands.map((band) => (
            <rect
              key={band.ci}
              className={hover?.ci === band.ci && !scene.crosshair ? 'db-chart-band is-active' : 'db-chart-band'}
              x={band.x}
              y={band.y}
              width={band.width}
              height={band.height}
              onMouseEnter={() => setHover({ ci: band.ci, si: null })}
              onClick={(event) => {
                setHover(null)
                onPick({ ci: band.ci, si: null }, { x: event.clientX, y: event.clientY })
              }}
            />
          ))}
          {scene.crosshair && hoverBand && (
            <line className="db-chart-crosshair" x1={hoverBand.ax} y1={hoverBand.y} x2={hoverBand.ax} y2={hoverBand.y + hoverBand.height} />
          )}
        </g>

        <g className="db-chart-marks" role="group" aria-label="Data points">
          {scene.paths.map((path, i) =>
            path.kind === 'area' ? <path key={`a${i}`} className="db-chart-area" d={path.d} style={markStyle(path.colour)} /> : null
          )}
          {scene.paths.map((path, i) =>
            path.kind === 'line' ? <path key={`l${i}`} className="db-chart-line" d={path.d} style={markStyle(path.colour)} /> : null
          )}
          {scene.marks.map((mark) => {
            const key = keyOf(mark.ci, mark.si)
            const active = isActive(mark)
            if (mark.shape === 'bar') {
              const rect = (
                <rect
                  {...markProps(mark)}
                  className={`db-chart-mark db-chart-bar${mark.stacked ? ' is-stacked' : ''}${active ? ' is-active' : ''}`}
                  x={mark.x}
                  y={mark.y}
                  width={mark.width}
                  height={mark.height}
                />
              )
              return mark.clip === undefined ? (
                <g key={key}>{rect}</g>
              ) : (
                <g key={key} clipPath={`url(#${clipId}-${mark.clip})`}>
                  {rect}
                </g>
              )
            }
            if (mark.shape === 'slice') {
              return <path key={key} {...markProps(mark)} className={`db-chart-mark db-chart-slice${active ? ' is-active' : ''}`} d={mark.d} />
            }
            const shown = scene.showPoints || mark.isolated || active
            return (
              <g key={key} {...markProps(mark)} className={`db-chart-mark db-chart-point${shown ? ' is-shown' : ''}${active ? ' is-active' : ''}`}>
                <circle className="db-chart-point-hit" cx={mark.x} cy={mark.y} r={9} />
                <circle className="db-chart-point-dot" cx={mark.x} cy={mark.y} />
              </g>
            )
          })}
        </g>

        <g aria-hidden="true">
          {scene.valueLabels.map((label, i) => (
            <Label key={i} label={label} className="db-chart-value" />
          ))}
          {scene.centre && <Centre centre={scene.centre} />}
        </g>
      </svg>

      {hover && anchor && <PlotTooltip data={data} hover={hover} anchor={anchor} scene={scene} format={format} shareOf={shareOf} />}
    </div>
  )
})

/** The figure in the middle of a donut, shrunk when it would not fit the hole. */
function Centre({ centre }: { centre: NonNullable<Scene['centre']> }): JSX.Element {
  const ref = useRef<SVGTextElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const width = el.getComputedTextLength()
    const next = width > 0 && centre.width > 0 ? Math.min(1, centre.width / width) : 1
    setScale((current) => (Math.abs(current - next) < 0.01 ? current : next))
  }, [centre.value, centre.width])
  return (
    <g className="db-chart-centre">
      <text
        ref={ref}
        className="db-chart-centre-value"
        textAnchor="middle"
        transform={`translate(${centre.x} ${centre.y - 2}) scale(${scale})`}
      >
        {centre.value}
      </text>
      <text className="db-chart-centre-label" x={centre.x} y={centre.y + 16} textAnchor="middle">
        {centre.label}
      </text>
    </g>
  )
}

function PlotTooltip(p: {
  data: L.ChartData
  hover: Target
  anchor: PickPoint & { under: number }
  scene: Scene
  format: (value: number | null) => string
  shareOf: (ci: number, si: number) => string
}): JSX.Element | null {
  const { data, hover, anchor, scene, format, shareOf } = p
  const category = data.categories[hover.ci]
  if (!category) return null
  const rows =
    hover.si !== null
      ? [hover.si]
      : data.series.map((_, si) => si).filter((si) => typeof data.series[si].values[hover.ci] === 'number')
  if (!rows.length) return null
  const perCategory = !data.split && data.kind !== 'line' && data.kind !== 'area'
  // Kept inside the plot without measuring: the bubble is at most this wide.
  const half = Math.min(120, scene.width / 2)
  const left = Math.max(half, Math.min(scene.width - half, anchor.x))
  const below = anchor.y < 84
  const total = data.split && data.additive && hover.si === null && rows.length > 1
  return (
    <div
      className={below ? 'db-chart-tooltip glass-thick is-below' : 'db-chart-tooltip glass-thick'}
      style={{ left, top: below ? anchor.under : anchor.y }}
      role="status"
    >
      <div className="db-chart-tooltip-title">{category.label}</div>
      {rows.map((si) => {
        const series = data.series[si]
        const share = shareOf(hover.ci, si)
        return (
          <div className="db-chart-tooltip-row" key={series.key}>
            <span className="db-chart-swatch" style={markStyle((perCategory ? category.colour : undefined) ?? series.colour ?? '')} />
            <span className="db-chart-tooltip-name">{series.label}</span>
            <span className="db-chart-tooltip-value">{format(series.values[hover.ci] ?? null)}</span>
            {share && <span className="db-chart-tooltip-share">{share}</span>}
          </div>
        )
      })}
      {total && (
        <div className="db-chart-tooltip-row is-total">
          <span className="db-chart-tooltip-name">Total</span>
          <span className="db-chart-tooltip-value">
            {format(rows.reduce((sum, si) => sum + (data.series[si].values[hover.ci] ?? 0), 0))}
          </span>
        </div>
      )}
    </div>
  )
}

/** A single figure with what it measures: a KPI tile. Drawn as SVG so that it exports like any chart. */
export function NumberTile(p: {
  width: number
  height: number
  value: string
  label: string
  note: string
  svgRef: RefObject<SVGSVGElement | null>
  onPick: (at: PickPoint) => void
}): JSX.Element {
  const { width, height, value, label, note, svgRef, onPick } = p
  const ref = useRef<SVGTextElement>(null)
  const [fit, setFit] = useState({ scale: 1, size: 40 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const textWidth = el.getComputedTextLength()
    const size = parseFloat(getComputedStyle(el).fontSize) || 40
    const scale = textWidth > 0 ? Math.min(1, Math.max(0.2, (width - 32) / textWidth), Math.max(0.2, (height - 56) / size)) : 1
    setFit((current) => (Math.abs(current.scale - scale) < 0.01 && current.size === size ? current : { scale, size }))
  }, [value, width, height])
  const drawn = fit.size * fit.scale
  const cy = height / 2 - 12
  return (
    <svg
      ref={svgRef}
      className="db-chart-svg is-number"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${value}`}
    >
      <g
        className="db-chart-number"
        role="button"
        tabIndex={0}
        aria-label={`${label}: ${value}. Show the rows`}
        onClick={(event) => onPick({ x: event.clientX, y: event.clientY })}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          onPick({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        }}
      >
        <rect className="db-chart-number-hit" x={0} y={0} width={width} height={height} />
        <text
          ref={ref}
          className="db-chart-number-value"
          textAnchor="middle"
          dominantBaseline="central"
          transform={`translate(${width / 2} ${cy}) scale(${fit.scale})`}
        >
          {value}
        </text>
        <text className="db-chart-number-label" x={width / 2} y={cy + drawn / 2 + 20} textAnchor="middle">
          {label}
        </text>
        {note && (
          <text className="db-chart-number-note" x={width / 2} y={cy + drawn / 2 + 38} textAnchor="middle">
            {note}
          </text>
        )}
      </g>
    </svg>
  )
}
