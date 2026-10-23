// The Fluxos screen (docs/plans/release-0.8.0.md D2–D4): the year in squares, the week hour by
// hour, where you go between screens and pages, time per area, the pages that pull you back, and
// the switch for the weekly word about your rhythm. Everything comes from `activity.summary`,
// which hands over aggregates of the local log, never its rows. Ink and dots, mono labels, one
// hairline frame: no score, no streak, no record. Loaded on demand through Host.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import {
  ACTIVITY_COPY,
  ACTIVITY_RHYTHM_KEY,
  type ActivityPlace,
  type ActivityStatus,
  type ActivitySummary,
  rhythmEnabled
} from '@shared/activity'
import { optionsOf, propOf } from '@shared/database'
import { plainText } from '@shared/richtext'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { useHome } from '@/home/store'
import { useBlock } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import { setSettingsOpen, useUi } from '@/store/ui'
import { dayName, FILTER_KINDS, FLOW_FILTERS, FLOWS_COPY, type FlowFilter, type FlowsCopy } from './copy'
import { areaWeeks, dayKey, duration, isEmptySummary, LEVELS, mondayOf, parseDay, weekHourRows, YEAR_WEEKS, yearGrid } from './layout'
import './flows.css'

interface Loaded {
  status: ActivityStatus
  /** The flows of this week: the moves between places. */
  week: ActivitySummary
  /** The last six weeks: time per area, the pages that pull you back. */
  recent: ActivitySummary
}

const WEEK_MS = 7 * 24 * 60 * 60_000

function openDataSettings(): void {
  useUi.setState({ settingsSection: 'general' })
  setSettingsOpen(true)
}

/** The first moment of the year grid: the Monday 52 weeks before this week's. */
function yearStart(today: string): number {
  const monday = mondayOf(parseDay(today) ?? new Date())
  monday.setDate(monday.getDate() - (YEAR_WEEKS - 1) * 7)
  return monday.getTime()
}

// ---- the year ------------------------------------------------------------------------

const CELL = 10
const GAP = 3
const STEP = CELL + GAP
const LEFT = 30
const TOP = 16

function YearMap({ byDay, today, copy }: { byDay: ActivitySummary['byDay']; today: string; copy: FlowsCopy }): JSX.Element {
  const grid = useMemo(() => yearGrid(today, byDay), [today, byDay])
  const width = LEFT + grid.weeks.length * STEP
  const height = TOP + 7 * STEP
  const label = copy.yearLabel(dayName(grid.from, copy), dayName(grid.to, copy))
  const months = useMemo(() => {
    const rows = new Map<string, { label: string; days: number; entries: number }>()
    for (const cells of grid.weeks)
      for (const cell of cells) {
        if (cell.future) continue
        const date = parseDay(cell.day) as Date
        const key = cell.day.slice(0, 7)
        const row = rows.get(key) ?? { label: `${copy.months[date.getMonth()]} ${date.getFullYear()}`, days: 0, entries: 0 }
        if (cell.count) {
          row.days++
          row.entries += cell.count
        }
        rows.set(key, row)
      }
    return [...rows.values()]
  }, [grid, copy])
  return (
    <figure className="flows-figure">
      <svg className="flows-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {grid.months.map(({ column, month }) => (
          <text key={`${column}-${month}`} className="flows-axis" x={LEFT + column * STEP} y={TOP - 6}>
            {copy.months[month]}
          </text>
        ))}
        {[0, 2, 4].map((row) => (
          <text key={row} className="flows-axis" x={0} y={TOP + row * STEP + CELL - 1}>
            {copy.weekdaysShort[(row + 1) % 7]}
          </text>
        ))}
        {grid.weeks.map((cells, column) =>
          cells.map((cell, row) => {
            if (cell.future) return null
            const x = LEFT + column * STEP
            const y = TOP + row * STEP
            const title = copy.cell(dayName(cell.day, copy), cell.count)
            return cell.level ? (
              <rect key={cell.day} className={`flows-cell is-l${cell.level}`} x={x} y={y} width={CELL} height={CELL}>
                <title>{title}</title>
              </rect>
            ) : (
              <circle key={cell.day} className="flows-dot" cx={x + CELL / 2} cy={y + CELL / 2} r={1.2}>
                <title>{title}</title>
              </circle>
            )
          })
        )}
      </svg>
      <Legend copy={copy} />
      <details className="flows-table">
        <summary>{copy.asTable}</summary>
        <table>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th scope="col">{copy.month}</th>
              <th scope="col">{copy.daysWith}</th>
              <th scope="col">{copy.entries}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.days}</td>
                <td>{row.entries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

function Legend({ copy }: { copy: FlowsCopy }): JSX.Element {
  return (
    <div className="flows-legend" aria-hidden="true">
      <span>{copy.less}</span>
      <svg viewBox={`0 0 ${(LEVELS + 1) * STEP} ${CELL}`} width={(LEVELS + 1) * STEP} height={CELL}>
        <circle className="flows-dot" cx={CELL / 2} cy={CELL / 2} r={1.2} />
        {Array.from({ length: LEVELS }, (_, i) => (
          <rect key={i} className={`flows-cell is-l${i + 1}`} x={(i + 1) * STEP} y={0} width={CELL} height={CELL} />
        ))}
      </svg>
      <span>{copy.more}</span>
    </div>
  )
}

// ---- the week, hour by hour ------------------------------------------------------------

const HOUR = 14

function WeekHours({ byWeekHour, copy }: { byWeekHour: number[][]; copy: FlowsCopy }): JSX.Element {
  const rows = useMemo(() => weekHourRows(byWeekHour), [byWeekHour])
  const width = LEFT + 24 * HOUR
  const height = TOP + 7 * HOUR
  return (
    <figure className="flows-figure">
      <svg className="flows-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={copy.weekLabel}>
        {[0, 6, 12, 18].map((hour) => (
          <text key={hour} className="flows-axis" x={LEFT + hour * HOUR} y={TOP - 6}>
            {String(hour).padStart(2, '0')}
          </text>
        ))}
        {rows.map((row, r) => (
          <g key={row.weekday}>
            <text className="flows-axis" x={0} y={TOP + r * HOUR + HOUR - 4}>
              {copy.weekdaysShort[row.weekday]}
            </text>
            {row.hours.map(({ hour, count, level }) => {
              const x = LEFT + hour * HOUR
              const y = TOP + r * HOUR
              const title = copy.cell(`${copy.weekdays[row.weekday]} ${String(hour).padStart(2, '0')}h`, count)
              return level ? (
                <rect key={hour} className={`flows-cell is-l${level}`} x={x + 1} y={y + 1} width={HOUR - 2} height={HOUR - 2}>
                  <title>{title}</title>
                </rect>
              ) : (
                <circle key={hour} className="flows-dot" cx={x + HOUR / 2} cy={y + HOUR / 2} r={1.2}>
                  <title>{title}</title>
                </circle>
              )
            })}
          </g>
        ))}
      </svg>
      <details className="flows-table">
        <summary>{copy.asTable}</summary>
        <div className="flows-table-scroll">
          <table>
            <caption className="sr-only">{copy.weekLabel}</caption>
            <thead>
              <tr>
                <td />
                {Array.from({ length: 24 }, (_, hour) => (
                  <th key={hour} scope="col">
                    {String(hour).padStart(2, '0')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.weekday}>
                  <th scope="row">{copy.weekdays[row.weekday]}</th>
                  {row.hours.map(({ hour, count }) => (
                    <td key={hour}>{count || ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

// ---- where you go ----------------------------------------------------------------------

function PageName({ id, copy }: { id: string; copy: FlowsCopy }): JSX.Element {
  const block = useBlock(id)
  return <>{plainText(block?.props.title).trim() || copy.untitled}</>
}

function PlaceName({ place, copy }: { place: ActivityPlace; copy: FlowsCopy }): JSX.Element {
  if (place.area === 'page' && place.pageId) return <PageName id={place.pageId} copy={copy} />
  return <>{copy.areas[place.area] ?? place.area}</>
}

const placeKey = (place: ActivityPlace): string => `${place.area}:${place.pageId ?? ''}`

function Moves({ transitions, copy }: { transitions: ActivitySummary['transitions']; copy: FlowsCopy }): JSX.Element {
  if (!transitions.length) return <p className="flows-quiet">{copy.noMoves}</p>
  const most = transitions[0]?.count ?? 1
  return (
    <ol className="flows-moves">
      {transitions.map((move) => (
        <li key={`${placeKey(move.from)}>${placeKey(move.to)}`} className="flows-move">
          <span className="flows-move-path">
            <PlaceName place={move.from} copy={copy} />
            <span className="flows-arrow">{' → '}</span>
            <PlaceName place={move.to} copy={copy} />
          </span>
          <span className="flows-ribbon" style={{ '--share': move.count / most } as CSSProperties} aria-hidden="true" />
          <span className="flows-count">{copy.moves(move.count)}</span>
        </li>
      ))}
    </ol>
  )
}

function AreaTime({
  byWeek,
  today,
  copy,
  locale
}: {
  byWeek: ActivitySummary['byWeek']
  today: string
  copy: FlowsCopy
  locale: 'en' | 'pt-BR'
}): JSX.Element {
  const table = useMemo(() => areaWeeks(byWeek, today), [byWeek, today])
  if (!table.areas.length) return <p className="flows-quiet">{copy.noTime}</p>
  const weekName = (week: string): string => {
    const date = parseDay(week) as Date
    return `${date.getDate()} ${copy.months[date.getMonth()]}`
  }
  return (
    <div className="flows-table-scroll">
      <table className="flows-weeks">
        <caption className="sr-only">{copy.time}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.area}</th>
            {table.weeks.map((week) => (
              <th key={week} scope="col" aria-label={copy.weekOf(weekName(week))}>
                {weekName(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.areas.map((row) => (
            <tr key={row.area}>
              <th scope="row">{copy.areas[row.area] ?? row.area}</th>
              {row.ms.map((ms, i) => (
                <td key={table.weeks[i]} title={duration(ms, locale)}>
                  <span className="flows-bar" style={{ '--share': row.share[i] } as CSSProperties} aria-hidden="true" />
                  <span className="sr-only">{duration(ms, locale)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Returning({ returning, copy }: { returning: ActivitySummary['returning']; copy: FlowsCopy }): JSX.Element {
  if (!returning.length) return <p className="flows-quiet">{copy.noBack}</p>
  return (
    <ul className="flows-back">
      {returning.map((page) => (
        <li key={page.pageId}>
          <button type="button" className="flows-link" onClick={() => openPage(page.pageId)}>
            <PageName id={page.pageId} copy={copy} />
          </button>
          <span className="flows-count">{copy.days(page.days)}</span>
        </li>
      ))}
    </ul>
  )
}

// ---- the weekly word ----------------------------------------------------------------------

function RhythmSwitch({ locale }: { locale: 'en' | 'pt-BR' }): JSX.Element {
  const words = ACTIVITY_COPY[locale]
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    window.api.app
      .getSetting(ACTIVITY_RHYTHM_KEY)
      .then((stored) => live && setOn(rhythmEnabled(stored)))
      .catch(() => live && setOn(false))
    return () => {
      live = false
    }
  }, [])
  const set = (next: boolean): void => {
    setOn(next)
    window.api.app.setSetting(ACTIVITY_RHYTHM_KEY, next).catch(() => setOn(!next))
  }
  return (
    <section className="flows-section flows-rhythm" aria-labelledby="flows-rhythm">
      <div className="flows-rhythm-text">
        <h2 className="flows-label" id="flows-rhythm">
          {words.rhythmLabel}
        </h2>
        <p className="flows-quiet">{words.rhythmHelp}</p>
      </div>
      <div className="flows-chips" role="radiogroup" aria-labelledby="flows-rhythm">
        {([true, false] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={on === value}
            className={on === value ? 'flows-chip is-on' : 'flows-chip'}
            disabled={on === null}
            onClick={() => set(value)}
          >
            {value ? words.on : words.off}
          </button>
        ))}
      </div>
    </section>
  )
}

// ---- the screen -------------------------------------------------------------------------

/** The Tasks database's projects, for the filter: id and name. */
function useProjects(): { id: string; name: string }[] {
  const tasks = useBlock(TASKS_DATABASE_ID)
  return useMemo(
    () => optionsOf(propOf(tasks?.props.schema, TASK_PROPS.project)).map((option) => ({ id: option.id, name: option.name })),
    [tasks]
  )
}

export function FlowsScreen({ now }: { now?: number } = {}): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = FLOWS_COPY[locale]
  const today = dayKey(new Date(now ?? Date.now()))
  const projects = useProjects()
  const [filter, setFilter] = useState<FlowFilter>('all')
  const [project, setProject] = useState('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [year, setYear] = useState<ActivitySummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }, [])

  // The flows read every place, whatever the filter: read once (and again on "Try again").
  useEffect(() => {
    let live = true
    const monday = mondayOf(parseDay(today) ?? new Date()).getTime()
    Promise.all([
      window.api.activity.status(),
      window.api.activity.summary({ from: monday }),
      window.api.activity.summary({ from: monday - 5 * WEEK_MS })
    ]).then(
      ([status, week, recent]) => live && setLoaded({ status, week, recent }),
      (error: unknown) => {
        console.error('the flows could not be read', error)
        if (live) setFailed(true)
      }
    )
    return () => {
      live = false
    }
  }, [today, attempt])

  // The squares follow the filter.
  useEffect(() => {
    let live = true
    window.api.activity.summary({ from: yearStart(today), kinds: FILTER_KINDS[filter], ...(project ? { project } : {}) }).then(
      (summary) => live && setYear(summary),
      (error: unknown) => {
        console.error('the year could not be read', error)
        if (live) setFailed(true)
      }
    )
    return () => {
      live = false
    }
  }, [today, filter, project, attempt])

  const head = (
    <header className="flows-head">
      <p className="flows-kicker">{copy.kicker}</p>
      <h1 className="flows-title">{copy.title}</h1>
      <p className="flows-lede">{copy.lede}</p>
    </header>
  )

  if (failed) {
    return (
      <article className="flows" aria-label={copy.title} lang={locale}>
        {head}
        <p className="flows-note" role="alert">
          {copy.loadFailed}
        </p>
        <button type="button" className="flows-link" onClick={retry}>
          {copy.tryAgain}
        </button>
      </article>
    )
  }

  if (!loaded || !year) {
    return (
      <article className="flows" aria-label={copy.title} aria-busy="true" lang={locale}>
        {head}
      </article>
    )
  }

  const off = !loaded.status.enabled
  const nothing = loaded.status.events === 0 && isEmptySummary(year) && isEmptySummary(loaded.recent)

  return (
    <article className="flows" aria-label={copy.title} lang={locale}>
      {head}
      {(off || nothing) && (
        <section className="flows-empty" aria-labelledby="flows-empty">
          <h2 className="flows-label" id="flows-empty">
            {off ? copy.offTitle : copy.emptyTitle}
          </h2>
          <p className="flows-quiet">{off ? copy.off : copy.empty}</p>
          {off && (
            <button type="button" className="flows-link" onClick={openDataSettings}>
              {copy.openSettings}
            </button>
          )}
        </section>
      )}
      {!nothing && (
        <>
          <div className="flows-filters">
            <div className="flows-chips" role="radiogroup" aria-label={copy.filterLabel}>
              {FLOW_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={filter === value}
                  className={filter === value ? 'flows-chip is-on' : 'flows-chip'}
                  onClick={() => setFilter(value)}
                >
                  {copy.filters[value]}
                </button>
              ))}
            </div>
            {projects.length > 0 && (
              <label className="flows-project">
                <span>{copy.project}</span>
                <select value={project} onChange={(event) => setProject(event.target.value)}>
                  <option value="">{copy.allProjects}</option>
                  {projects.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <section className="flows-section" aria-labelledby="flows-year">
            <h2 className="flows-label" id="flows-year">
              {copy.year}
            </h2>
            <YearMap byDay={year.byDay} today={today} copy={copy} />
          </section>

          <section className="flows-section" aria-labelledby="flows-week">
            <h2 className="flows-label" id="flows-week">
              {copy.week}
            </h2>
            <WeekHours byWeekHour={year.byWeekHour} copy={copy} />
          </section>

          <section className="flows-section" aria-labelledby="flows-where">
            <h2 className="flows-label" id="flows-where">
              {copy.where}
            </h2>
            <p className="flows-quiet">{copy.whereLede}</p>
            <Moves transitions={loaded.week.transitions} copy={copy} />
          </section>

          <section className="flows-section" aria-labelledby="flows-time">
            <h2 className="flows-label" id="flows-time">
              {copy.time}
            </h2>
            <p className="flows-quiet">{copy.timeLede}</p>
            <AreaTime byWeek={loaded.recent.byWeek} today={today} copy={copy} locale={locale} />
          </section>

          <section className="flows-section" aria-labelledby="flows-back">
            <h2 className="flows-label" id="flows-back">
              {copy.back}
            </h2>
            <p className="flows-quiet">{copy.backLede}</p>
            <Returning returning={loaded.recent.returning} copy={copy} />
          </section>
        </>
      )}
      <RhythmSwitch locale={locale} />
    </article>
  )
}
