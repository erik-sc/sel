// Settings of a chart view: what is drawn, from which properties, and how.
// Every control edits the view as it is in the store when the edit lands (`patchView`),
// so two quick changes never drop each other and a linked view edits its own block.
import { useEffect, useId, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { ChartAggregate, ChartConfig, ChartDateBucket, ChartPalette, ChartSort, DatabaseView } from '@shared/types'
import {
  CHART_AGGREGATES,
  CHART_DATE_BUCKETS,
  CHART_KINDS,
  CHART_MAX_HEIGHT,
  CHART_MAX_LIMIT,
  CHART_MIN_HEIGHT,
  CHART_MIN_LIMIT
} from '@shared/chart'
import * as L from '../logic'
import * as actions from '../actions'
import { settleChart } from '../chartFresh'
import { useCommitOnUnmount } from '../hooks'
import { ChartKindIcon } from './chartIcons'
import './chart.css'

const SORT_LABELS: Record<ChartSort, string> = {
  manual: 'Natural order',
  x_asc: 'Axis, ascending',
  x_desc: 'Axis, descending',
  y_desc: 'Value, high to low',
  y_asc: 'Value, low to high'
}
const SORTS: ChartSort[] = ['manual', 'x_asc', 'x_desc', 'y_desc', 'y_asc']

const PALETTE_LABELS: Record<ChartPalette, string> = {
  accent: 'Accent colour',
  colourful: 'Colourful',
  options: 'Option colours'
}
const PALETTES: ChartPalette[] = ['accent', 'colourful', 'options']

/** Typing pause after which a number is applied. */
const COMMIT_DELAY_MS = 400

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="db-chart-setting">
      <label className="db-chart-setting-label" htmlFor={htmlFor}>
        {label}
      </label>
      <span className="db-chart-setting-control">{children}</span>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }): JSX.Element {
  const id = useId()
  return (
    <Row label={label} htmlFor={id}>
      <input id={id} type="checkbox" className="db-toggle" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </Row>
  )
}

/** An optional whole number: empty means "not set". Applied after a pause, on blur, on Enter and on close. */
function NumberField(p: {
  id: string
  value: number | undefined
  min: number
  max: number
  placeholder: string
  onCommit: (value: number | undefined) => void
}): JSX.Element {
  const text = p.value === undefined ? '' : String(p.value)
  const [draft, setDraft] = useState(text)
  const committed = useRef(text)
  useEffect(() => {
    // Changed elsewhere (another window, a clamp): adopt it.
    if (text !== committed.current) {
      committed.current = text
      setDraft(text)
    }
  }, [text])

  /** `settled`: the user is done typing (blur, Enter, close), so an out-of-range number is clamped rather than waited on. */
  const flush = (settled: boolean): void => {
    if (draft === committed.current) return
    const trimmed = draft.trim()
    const parsed = Number(trimmed)
    if (trimmed !== '' && !isFinite(parsed)) return
    if (trimmed !== '' && !settled && (parsed < p.min || parsed > p.max)) return
    const next = trimmed === '' ? undefined : Math.round(Math.max(p.min, Math.min(p.max, parsed)))
    committed.current = next === undefined ? '' : String(next)
    p.onCommit(next)
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    if (draft === committed.current) return
    const timer = setTimeout(() => flushRef.current(false), COMMIT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft])
  useCommitOnUnmount(() => flushRef.current(true))

  return (
    <input
      id={p.id}
      className="ui-input db-chart-number-input"
      type="number"
      inputMode="numeric"
      min={p.min}
      max={p.max}
      step={1}
      value={draft}
      placeholder={p.placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        flush(true)
        setDraft(committed.current)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        flush(true)
        setDraft(committed.current)
      }}
    />
  )
}

export function ChartPanel({ databaseId, schema, view }: { databaseId: string; schema: L.Schema; view: DatabaseView }): JSX.Element {
  const config = L.chartConfigOf(view, schema)
  const ids = useId()
  const id = (name: string): string => `${ids}-${name}`

  /** Changes the configuration as it is in the store now; a key set to undefined is removed. */
  const patch = (change: Partial<ChartConfig> | ((current: ChartConfig) => ChartConfig)): void => {
    settleChart(view.id)
    actions.patchView(databaseId, view.id, (v, s) => {
      const current = L.chartConfigOf(v, s)
      const next = typeof change === 'function' ? change(current) : { ...current, ...change }
      return { ...v, chart: L.normalizeChartConfig(next, s) }
    })
  }

  const properties = L.chartAxisProperties(schema)
  const x = L.propOf(schema, config.x)
  const isNumber = config.kind === 'number'
  const isPie = config.kind === 'pie' || config.kind === 'donut'
  const hasSeries = L.chartKindHasSeries(config.kind)
  const split = hasSeries ? L.propOf(schema, config.series) : undefined
  // Several series, or the slices of a pie, cannot all wear the accent: they are told apart by hue.
  const needsHues = !!split || isPie
  const aggregate = config.y.aggregate
  const valueProperties = L.chartValueProperties(schema, aggregate)

  const setAggregate = (next: ChartAggregate): void =>
    patch((current) => {
      const y: ChartConfig['y'] = { aggregate: next }
      // The same property when it still fits; otherwise normalisation picks the first that does.
      if (L.isChartValueProperty(L.propOf(schema, current.y.property), next)) y.property = current.y.property
      return { ...current, y }
    })

  return (
    <div className="db-panel is-narrow db-chart-panel">
      <div className="db-panel-title">Chart type</div>
      <div className="db-chart-kinds is-grid" role="radiogroup" aria-label="Chart type">
        {CHART_KINDS.map((kind) => (
          <button
            type="button"
            key={kind}
            role="radio"
            aria-checked={kind === config.kind}
            className={kind === config.kind ? 'db-chart-kind is-active' : 'db-chart-kind'}
            onClick={() => patch({ kind })}
          >
            <ChartKindIcon kind={kind} size={18} />
            <span>{L.CHART_KIND_LABELS[kind]}</span>
          </button>
        ))}
      </div>

      <div className="db-panel-title">Data</div>
      {!isNumber && (
        <Row label={isPie ? 'Slices' : config.kind === 'bar' ? 'Categories' : 'Horizontal axis'} htmlFor={id('x')}>
          <select id={id('x')} className="db-select is-wide" value={x?.id ?? ''} onChange={(event) => patch({ x: event.target.value })}>
            {properties.map((prop) => (
              <option key={prop.id} value={prop.id}>
                {prop.name}
              </option>
            ))}
          </select>
        </Row>
      )}
      {!isNumber && x && L.isDateLikeType(x.type) && (
        <Row label="Group dates by" htmlFor={id('bucket')}>
          <select
            id={id('bucket')}
            className="db-select is-wide"
            value={config.xDateBucket ?? 'month'}
            onChange={(event) => patch({ xDateBucket: event.target.value as ChartDateBucket })}
          >
            {CHART_DATE_BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {L.CHART_BUCKET_LABELS[bucket]}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="Value" htmlFor={id('aggregate')}>
        <select
          id={id('aggregate')}
          className="db-select is-wide"
          value={aggregate}
          onChange={(event) => setAggregate(event.target.value as ChartAggregate)}
        >
          {CHART_AGGREGATES.map((option) => (
            <option
              key={option}
              value={option}
              // Offered only when some property can be its value.
              disabled={L.aggregateNeedsProperty(option) && L.chartValueProperties(schema, option).length === 0}
            >
              {L.CHART_AGGREGATE_LABELS[option]}
            </option>
          ))}
        </select>
      </Row>
      {L.aggregateNeedsProperty(aggregate) && (
        <Row label="Of property" htmlFor={id('value')}>
          <select
            id={id('value')}
            className="db-select is-wide"
            value={config.y.property ?? ''}
            onChange={(event) => patch((current) => ({ ...current, y: { aggregate: current.y.aggregate, property: event.target.value } }))}
          >
            {valueProperties.map((prop) => (
              <option key={prop.id} value={prop.id}>
                {prop.name}
              </option>
            ))}
          </select>
        </Row>
      )}
      {hasSeries && (
        <Row label="Split by" htmlFor={id('series')}>
          <select
            id={id('series')}
            className="db-select is-wide"
            value={split?.id ?? ''}
            onChange={(event) => patch({ series: event.target.value || undefined })}
          >
            <option value="">None</option>
            {properties
              .filter((prop) => prop.id !== x?.id)
              .map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.name}
                </option>
              ))}
          </select>
        </Row>
      )}

      {!isNumber && (
        <>
          <div className="db-panel-title">Display</div>
          {split && L.chartKindCanStack(config.kind) && (
            <Toggle label="Stack the series" checked={config.stacked === true} onChange={(on) => patch({ stacked: on })} />
          )}
          {L.chartKindCanAccumulate(config.kind) && (
            <Toggle label="Running total" checked={config.cumulative === true} onChange={(on) => patch({ cumulative: on })} />
          )}
          <Row label="Sort" htmlFor={id('sort')}>
            <select
              id={id('sort')}
              className="db-select is-wide"
              value={config.sort ?? 'manual'}
              onChange={(event) => patch({ sort: event.target.value as ChartSort })}
            >
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Show top" htmlFor={id('limit')}>
            <NumberField
              id={id('limit')}
              value={config.limit}
              min={CHART_MIN_LIMIT}
              max={CHART_MAX_LIMIT}
              placeholder="All"
              onCommit={(limit) => patch({ limit })}
            />
          </Row>
          <Row label="Colours" htmlFor={id('palette')}>
            <select
              id={id('palette')}
              className="db-select is-wide"
              value={needsHues && config.palette !== 'options' ? 'colourful' : (config.palette ?? 'accent')}
              onChange={(event) => patch({ palette: event.target.value as ChartPalette })}
            >
              {PALETTES.filter((palette) => !needsHues || palette !== 'accent').map((palette) => (
                <option key={palette} value={palette}>
                  {PALETTE_LABELS[palette]}
                </option>
              ))}
            </select>
          </Row>
          <Toggle label="Value labels" checked={config.showValues === true} onChange={(on) => patch({ showValues: on })} />
          {(split || isPie) && <Toggle label="Legend" checked={config.showLegend !== false} onChange={(on) => patch({ showLegend: on })} />}
          {L.isChartKindWithAxes(config.kind) && (
            <Toggle label="Grid lines" checked={config.showGrid !== false} onChange={(on) => patch({ showGrid: on })} />
          )}
          <Toggle label="Empty group" checked={config.showEmpty === true} onChange={(on) => patch({ showEmpty: on })} />
        </>
      )}

      <div className="db-panel-title">Size</div>
      <Row label="Height" htmlFor={id('height')}>
        <NumberField
          id={id('height')}
          value={config.height}
          min={CHART_MIN_HEIGHT}
          max={CHART_MAX_HEIGHT}
          placeholder="Default"
          onCommit={(height) => patch({ height })}
        />
      </Row>
    </div>
  )
}
