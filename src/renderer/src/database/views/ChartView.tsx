import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, RefObject } from 'react'
import type { Block, ChartKind } from '@shared/types'
import { CHART_KINDS } from '@shared/chart'
import { notifyError, toast } from '@/ui/toast'
import { ArrowUpRight, Copy, Image as ImageIcon } from '@/ui/icons'
import * as L from './chartLogic'
import * as actions from '../actions'
import { isFreshChart, settleChart } from '../chartFresh'
import { Floating, RowIcon, rowTitle, type ViewProps } from '../common'
import { useRelated } from '../related'
import { ChartKindIcon } from './chartIcons'
import { buildScene, type Scene } from './chartLayout'
import { ChartPlot, NumberTile, colourVar, type PickPoint, type Target } from './chartPlot'
import './chart.css'

/** Rows listed in the popover behind a mark; the rest is counted. */
const MAX_LISTED_ROWS = 100

// ---------------------------------------------------------------------------
// Size and text metrics of the plot
// ---------------------------------------------------------------------------

interface Metrics {
  width: number
  height: number
  fontSize: number
  font: string
}

/**
 * Size of the plot box and the font its labels are drawn with. The box is observed
 * (never polled), and the font is read again when the theme or an appearance token
 * changes, since both can change text widths without changing the box.
 */
function usePlotMetrics(ref: RefObject<HTMLDivElement | null>): Metrics | null {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void => {
      const style = getComputedStyle(el)
      const next: Metrics = {
        width: Math.floor(el.clientWidth),
        height: Math.floor(el.clientHeight),
        fontSize: parseFloat(style.fontSize) || 11,
        font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      }
      setMetrics((current) =>
        current && current.width === next.width && current.height === next.height && current.font === next.font ? current : next
      )
    }
    read()
    const resize = new ResizeObserver(read)
    resize.observe(el)
    const tokens = new MutationObserver(read)
    tokens.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    const overrides = document.getElementById('appearance-overrides')
    if (overrides) tokens.observe(overrides, { childList: true, characterData: true, subtree: true })
    return () => {
      resize.disconnect()
      tokens.disconnect()
    }
  }, [ref])
  return metrics
}

let canvasContext: CanvasRenderingContext2D | null | undefined
const widthCache = new Map<string, Map<string, number>>()
const MAX_CACHED_WIDTHS = 4000

/** Text widths in the given font, measured off screen (a canvas, not the DOM) and cached. */
function measurer(font: string, fontSize: number): L.Measure {
  if (canvasContext === undefined) {
    try {
      canvasContext = document.createElement('canvas').getContext('2d')
    } catch {
      canvasContext = null
    }
  }
  let cache = widthCache.get(font)
  if (!cache) {
    if (widthCache.size > 8) widthCache.clear()
    widthCache.set(font, (cache = new Map()))
  }
  const known = cache
  return (text) => {
    const hit = known.get(text)
    if (hit !== undefined) return hit
    let width: number
    if (canvasContext) {
      canvasContext.font = font
      width = canvasContext.measureText(text).width
    } else {
      width = L.estimateTextWidth(text, fontSize)
    }
    if (known.size > MAX_CACHED_WIDTHS) known.clear()
    known.set(text, width)
    return width
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** One click per chart type: shown on a chart nobody configured yet, and next to the empty states. */
function QuickKinds({ kind, onPick }: { kind: ChartKind; onPick: (kind: ChartKind) => void }): JSX.Element {
  return (
    <div className="db-chart-kinds" role="radiogroup" aria-label="Chart type">
      {CHART_KINDS.map((option) => (
        <button
          type="button"
          key={option}
          role="radio"
          aria-checked={option === kind}
          className={option === kind ? 'db-chart-kind is-active' : 'db-chart-kind'}
          onClick={() => onPick(option)}
        >
          <ChartKindIcon kind={option} size={16} />
          <span>{L.CHART_KIND_LABELS[option]}</span>
        </button>
      ))}
    </div>
  )
}

interface LegendItem {
  key: string
  label: string
  colour: string
  value?: string
}

function Legend(p: { items: LegendItem[]; hidden: ReadonlySet<string>; onToggle: (key: string) => void }): JSX.Element {
  return (
    <div className="db-chart-legend" role="group" aria-label="Legend">
      {p.items.map((item) => {
        const shown = !p.hidden.has(item.key)
        return (
          <button
            type="button"
            key={item.key}
            className={shown ? 'db-chart-legend-item' : 'db-chart-legend-item is-off'}
            aria-pressed={shown}
            title={shown ? `Hide ${item.label}` : `Show ${item.label}`}
            onClick={() => p.onToggle(item.key)}
          >
            <span className="db-chart-swatch" style={{ '--db-chart-mark': colourVar(item.colour) } as CSSProperties} />
            <span className="db-chart-legend-label">{item.label}</span>
            {item.value !== undefined && <span className="db-chart-legend-value">{item.value}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The same numbers as the picture, for readers who cannot see it. Visually hidden. */
function DataTable({ data, caption }: { data: L.ChartData; caption: string }): JSX.Element {
  const table = useMemo(() => L.chartTable(data), [data])
  return (
    <table className="db-chart-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {table.header.map((cell, i) => (
            <th key={i} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={i}>{cell}</td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface Drill {
  categoryKey: string
  seriesKey: string | null
  at: PickPoint
}

/** Hides legend entries: series of a split chart, or slices of a pie. Indexes stay those of what is drawn. */
function withoutHidden(data: L.ChartData, hidden: ReadonlySet<string>): L.ChartData {
  if (!hidden.size) return data
  if (data.split) {
    const series = data.series.filter((item) => !hidden.has(item.key))
    return series.length === data.series.length ? data : { ...data, series }
  }
  if (data.kind !== 'pie' && data.kind !== 'donut') return data
  const keep = data.categories.map((category) => !hidden.has(category.key))
  if (keep.every(Boolean)) return data
  return {
    ...data,
    categories: data.categories.filter((_, index) => keep[index]),
    series: data.series.map((item) => ({ ...item, values: item.values.filter((_, index) => keep[index]) }))
  }
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function ChartView(p: ViewProps): JSX.Element {
  const { databaseId, schema, view, rows } = p
  const config = useMemo(() => L.chartConfigOf(view, schema), [view, schema])
  // Relations, rollups and formulas are read through the cells of the related rows.
  const { cells } = useRelated()
  // The only place rows are aggregated: hovering, focusing and resizing reuse this.
  const data = useMemo(() => L.buildChartData(rows, schema, config, undefined, {}, cells), [rows, schema, config, cells])

  const plotRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const metrics = usePlotMetrics(plotRef)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [drill, setDrill] = useState<Drill | null>(null)
  const [fresh, setFresh] = useState(() => isFreshChart(view.id))

  useEffect(() => {
    setFresh(isFreshChart(view.id))
    setHidden(new Set())
    setDrill(null)
  }, [view.id])

  const isPie = data.kind === 'pie' || data.kind === 'donut'
  const format = useCallback((value: number | null) => L.formatChartValue(value, data.yFormat), [data.yFormat])

  const legendItems = useMemo<LegendItem[]>(() => {
    if (data.split) return data.series.map((item) => ({ key: item.key, label: item.label, colour: item.colour ?? '' }))
    if (!isPie) return []
    const values = data.series[0]?.values ?? []
    return data.categories.map((category, index) => ({
      key: category.key,
      label: category.label,
      colour: category.colour ?? '',
      value: format(values[index] ?? null)
    }))
  }, [data, isPie, format])

  // Entries that no longer exist (a filter, another split) are not remembered as hidden.
  useEffect(() => {
    setHidden((current) => {
      if (!current.size) return current
      const known = new Set(legendItems.map((item) => item.key))
      const next = new Set([...current].filter((key) => known.has(key)))
      return next.size === current.size ? current : next
    })
  }, [legendItems])

  const shown = useMemo(() => withoutHidden(data, hidden), [data, hidden])
  const caption = useMemo(() => L.chartCaption(data), [data])
  const summary = useMemo(() => L.chartSummary(shown), [shown])

  const measure = useMemo(() => (metrics ? measurer(metrics.font, metrics.fontSize) : null), [metrics])
  const scene = useMemo<Scene | null>(() => {
    if (!metrics || !measure || shown.kind === 'number' || shown.status !== 'ok') return null
    return buildScene(shown, {
      width: metrics.width,
      height: metrics.height,
      fontSize: metrics.fontSize,
      measure,
      stacked: config.stacked === true,
      showValues: config.showValues === true,
      showGrid: config.showGrid !== false,
      format,
      formatTicks: (values) => L.formatChartTicks(values, shown.yFormat),
      formatShare: (share) => L.formatShare(share, 1)
    })
  }, [metrics, measure, shown, config.stacked, config.showValues, config.showGrid, format])

  /** Share of a mark in its whole: its category when the chart is split, the chart otherwise. */
  const shareOf = useMemo(() => {
    const meaningful = shown.additive && !(config.cumulative && L.chartKindCanAccumulate(shown.kind))
    const wholes = shown.split
      ? shown.categories.map((_, ci) => shown.series.reduce((sum, item) => sum + Math.max(0, item.values[ci] ?? 0), 0))
      : null
    const whole = shown.split ? 0 : (shown.series[0]?.values ?? []).reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0)
    return (ci: number, si: number): string => {
      if (!meaningful) return ''
      const value = shown.series[si]?.values[ci] ?? null
      return L.formatShare(value, wholes ? wholes[ci] : whole)
    }
  }, [shown, config.cumulative])

  const setKind = useCallback(
    (kind: ChartKind) => {
      settleChart(view.id)
      setFresh(false)
      actions.patchView(databaseId, view.id, (v, s) => ({ ...v, chart: L.normalizeChartConfig({ ...L.chartConfigOf(v, s), kind }, s) }))
    },
    [databaseId, view.id]
  )

  const onPick = useCallback(
    (target: Target, at: PickPoint) => {
      const category = shown.categories[target.ci]
      if (!category) return
      const series = target.si !== null && shown.split ? shown.series[target.si] : undefined
      setDrill({ categoryKey: category.key, seriesKey: series?.key ?? null, at })
    },
    [shown]
  )

  const drillRows = useMemo<Block[]>(
    () => (drill ? L.chartRowsAt(rows, schema, config, data, drill.categoryKey, drill.seriesKey, undefined, {}, cells) : []),
    [drill, rows, schema, config, data, cells]
  )
  const drillTitle = useMemo(() => {
    if (!drill) return ''
    if (drill.categoryKey === L.CHART_ALL_KEY) return caption
    const category = data.categories.find((item) => item.key === drill.categoryKey)?.label ?? ''
    const series = drill.seriesKey ? data.series.find((item) => item.key === drill.seriesKey)?.label : undefined
    return series ? `${category} · ${series}` : category
  }, [drill, data, caption])

  const copyData = (): void => {
    navigator.clipboard
      .writeText(L.chartToTSV(data))
      .then(() => toast('Chart data copied.', { kind: 'success' }))
      .catch((error: unknown) => notifyError('Could not copy the chart data.', error))
  }

  const copyImage = async (): Promise<void> => {
    const svg = svgRef.current
    if (!svg) return
    let blob: Blob
    try {
      const { chartToPng } = await import('./chartExport')
      const legend = config.showLegend === false ? [] : legendItems.filter((item) => !hidden.has(item.key))
      blob = await chartToPng(svg, {
        title: `${view.name} – ${caption}`,
        legend: legend.map((item) => ({ label: item.value ? `${item.label}  ${item.value}` : item.label, colour: colourVar(item.colour) }))
      })
    } catch (error) {
      notifyError('Could not turn the chart into an image.', error)
      return
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast('Chart copied as an image.', { kind: 'success' })
    } catch {
      // No image clipboard here: offer a file instead.
      try {
        const result = await window.api.files.saveGeneratedImage(await blob.arrayBuffer())
        if (result.saved) toast('Chart image saved.', { kind: 'success' })
      } catch (error) {
        notifyError('Could not save the chart image.', error)
      }
    }
  }

  const plotStyle: CSSProperties | undefined = config.height ? { height: config.height } : undefined
  const showLegend = config.showLegend !== false && legendItems.length > 0 && data.status === 'ok'
  const nothingShown = data.status === 'ok' && shown.kind !== 'number' && (!shown.series.length || !shown.categories.length)

  // Rows exist, but the filters or the quick search leave none of them.
  const hasHiddenRows = rows.length === 0 && (p.totalRows ?? 0) > 0
  let message: string | null = null
  if (data.kind !== 'number') {
    if (data.status === 'no_x') message = 'Choose a property for the horizontal axis'
    else if (data.status === 'no_rows') {
      if (rows.length) message = `No row has a value for ${data.xLabel || 'this chart'}`
      else message = hasHiddenRows ? 'No rows match the filters of this view' : 'Add a row to see this chart'
    } else if (!data.categories.length) message = 'There is nothing to draw: every value is zero or empty'
  }

  return (
    <div className="db-chart" data-kind={data.kind}>
      <div className="db-chart-head">
        {/* A single figure carries its caption right under it. */}
        <span className="db-chart-caption" title={caption}>
          {data.kind === 'number' ? '' : caption}
        </span>
        <span className="db-chart-actions">
          <button type="button" className="db-mini-button" title="Copy data" aria-label="Copy data" disabled={!!message} onClick={copyData}>
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="db-mini-button"
            title="Copy as image"
            aria-label="Copy as image"
            disabled={!!message}
            onClick={() => void copyImage()}
          >
            <ImageIcon size={14} />
          </button>
        </span>
      </div>

      {((fresh && isFreshChart(view.id)) || message) && <QuickKinds kind={config.kind} onPick={setKind} />}

      <div className={message ? 'db-chart-plot is-empty' : 'db-chart-plot'} ref={plotRef} style={plotStyle}>
        {message ? (
          <div className="db-chart-empty" role="status">
            <p>{message}</p>
            {data.status === 'no_rows' && !rows.length && !hasHiddenRows && (
              <button type="button" className="db-chart-action" onClick={() => p.onNewRow()}>
                Add a row
              </button>
            )}
            {data.status === 'no_x' && p.onOpenChartSettings && (
              <button type="button" className="db-chart-action" onClick={() => p.onOpenChartSettings?.()}>
                Open chart settings
              </button>
            )}
          </div>
        ) : nothingShown ? (
          <div className="db-chart-empty" role="status">
            <p>Everything is hidden. Select an entry in the legend to show it again.</p>
          </div>
        ) : metrics && shown.kind === 'number' ? (
          <NumberTile
            width={metrics.width}
            height={metrics.height}
            value={format(data.total)}
            label={caption}
            note={`${data.rowCount} ${data.rowCount === 1 ? 'row' : 'rows'}`}
            svgRef={svgRef}
            onPick={(at) => setDrill({ categoryKey: L.CHART_ALL_KEY, seriesKey: null, at })}
          />
        ) : scene ? (
          <ChartPlot data={shown} scene={scene} summary={summary} svgRef={svgRef} format={format} shareOf={shareOf} onPick={onPick} />
        ) : null}
      </div>

      {showLegend && (
        <Legend
          items={legendItems}
          hidden={hidden}
          onToggle={(key) =>
            setHidden((current) => {
              const next = new Set(current)
              if (!next.delete(key)) next.add(key)
              return next
            })
          }
        />
      )}

      {!message && data.kind !== 'number' && <DataTable data={data} caption={caption} />}

      {drill && (
        <Floating open anchor={drill.at} onClose={() => setDrill(null)}>
          <div className="db-chart-drill">
            <div className="db-panel-title">
              <span className="db-chart-drill-title">{drillTitle}</span>
              <span className="db-chart-drill-count">
                {drillRows.length} {drillRows.length === 1 ? 'row' : 'rows'}
              </span>
            </div>
            <div className="db-chart-drill-list">
              {drillRows.slice(0, MAX_LISTED_ROWS).map((row) => {
                const title = rowTitle(row)
                return (
                  <button
                    type="button"
                    key={row.id}
                    className="db-chart-drill-row"
                    title={`Open ${title || 'Untitled'}`}
                    onClick={(event) => {
                      setDrill(null)
                      p.onOpen(row.id, event)
                    }}
                    onAuxClick={(event) => {
                      if (event.button === 1) p.onOpen(row.id, { button: 1 })
                    }}
                  >
                    <RowIcon row={row} size={14} />
                    <span className={title ? 'db-text' : 'db-text is-muted'}>{title || 'Untitled'}</span>
                    <ArrowUpRight size={14} />
                  </button>
                )
              })}
              {drillRows.length === 0 && <div className="db-panel-empty">No rows.</div>}
              {drillRows.length > MAX_LISTED_ROWS && (
                <div className="db-panel-empty">And {drillRows.length - MAX_LISTED_ROWS} more. Add a filter to narrow them down.</div>
              )}
            </div>
          </div>
        </Floating>
      )}
    </div>
  )
}
