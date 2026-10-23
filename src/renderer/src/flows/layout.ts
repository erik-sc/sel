// The Fluxos screen's arithmetic: where each day of the year sits in its grid, how dark a square
// is, the week × hour grid in reading order, and the weeks of time per area. Pure: no React, no
// DOM, no store, so that each is tested on its own. Weeks start on Monday, like the log's own
// weeks (main/activity/queries.ts weekOf). There is no total, no streak and no record here: only
// where things fall, and how much, in a few steps of ink.

/** Steps of ink a square can take: 0 is nothing, then 1 (faint) to LEVELS (darkest). */
export const LEVELS = 4

/** How many weeks the year grid shows: a full year and the current week. */
export const YEAR_WEEKS = 53

const pad = (n: number): string => String(n).padStart(2, '0')

/** A local date as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM-DD` as a local date at midnight; null when it is not one. */
export function parseDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return dayKey(date) === day ? date : null
}

/** Rows of the grids from Monday to Sunday, as `Date#getDay` numbers (0 = Sunday). */
export const WEEK_ROWS: readonly number[] = [1, 2, 3, 4, 5, 6, 0]

/** The local Monday of the week `date` is in. */
export function mondayOf(date: Date): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

/**
 * How dark a count is, from the counts it is shown among: 0 for none, else 1 to `steps` by its
 * rank among the non-zero counts (the share of them it is at least as large as), so the largest
 * is always the darkest. Ranks, not the largest count, so that one busy day does not wash out the
 * rest of the year.
 */
export function levelScale(values: Iterable<number>, steps = LEVELS): (value: number) => number {
  const sorted = [...values].filter((value) => value > 0).sort((a, b) => a - b)
  return (value) => {
    if (!(value > 0)) return 0
    if (!sorted.length) return steps
    // How many counts are at most this one (a binary search: the year has hundreds).
    let low = 0
    let high = sorted.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (sorted[mid] <= value) low = mid + 1
      else high = mid
    }
    return Math.min(steps, Math.max(1, Math.ceil((low / sorted.length) * steps)))
  }
}

export interface DayCell {
  /** `YYYY-MM-DD`. */
  day: string
  /** `Date#getDay`: 0 = Sunday. */
  weekday: number
  count: number
  level: number
  /** After today: drawn as nothing. */
  future: boolean
}

export interface YearGrid {
  /** Columns, oldest first; each has seven cells, Monday to Sunday. */
  weeks: DayCell[][]
  /** Where a month starts: the column of its first Monday-started week, and the month (0–11). */
  months: { column: number; month: number; year: number }[]
  /** The first and the last day shown. */
  from: string
  to: string
}

/**
 * The year as a calendar of squares: `weeks` columns of seven days, the last one holding `today`.
 * `counts` are per local day (ActivitySummary.byDay).
 */
export function yearGrid(today: string, counts: readonly { day: string; count: number }[], weeks = YEAR_WEEKS): YearGrid {
  const now = parseDay(today) ?? new Date()
  const byDay = new Map(counts.map((entry) => [entry.day, entry.count]))
  const start = mondayOf(now)
  start.setDate(start.getDate() - (weeks - 1) * 7)
  const shown: number[] = []
  const columns: DayCell[][] = []
  const months: YearGrid['months'] = []
  const cursor = new Date(start)
  const todayKey = dayKey(now)
  for (let column = 0; column < weeks; column++) {
    const cells: DayCell[] = []
    for (let row = 0; row < 7; row++) {
      const day = dayKey(cursor)
      const future = day > todayKey
      const count = future ? 0 : (byDay.get(day) ?? 0)
      if (count) shown.push(count)
      cells.push({ day, weekday: cursor.getDay(), count, level: 0, future })
      // A month is named over the column its first day falls in.
      if (cursor.getDate() === 1) months.push({ column, month: cursor.getMonth(), year: cursor.getFullYear() })
      cursor.setDate(cursor.getDate() + 1)
    }
    columns.push(cells)
  }
  const level = levelScale(shown)
  for (const cells of columns) for (const cell of cells) cell.level = level(cell.count)
  const last = new Date(cursor)
  last.setDate(last.getDate() - 1)
  return { weeks: columns, months, from: dayKey(start), to: dayKey(last) }
}

export interface HourRow {
  /** `Date#getDay`: 0 = Sunday. */
  weekday: number
  hours: { hour: number; count: number; level: number }[]
}

/** The week × hour grid (`[weekday][hour]`, weekday 0 = Sunday) as rows from Monday, each with its levels. */
export function weekHourRows(byWeekHour: readonly (readonly number[])[]): HourRow[] {
  const level = levelScale(byWeekHour.flat())
  return WEEK_ROWS.map((weekday) => ({
    weekday,
    hours: Array.from({ length: 24 }, (_, hour) => {
      const count = byWeekHour[weekday]?.[hour] ?? 0
      return { hour, count, level: level(count) }
    })
  }))
}

/** True when nothing at all is in a summary's counts or flows. */
export function isEmptySummary(summary: { total: number; transitions: readonly unknown[]; timeByArea: readonly unknown[] }): boolean {
  return summary.total === 0 && summary.transitions.length === 0 && summary.timeByArea.length === 0
}

export interface AreaWeeks {
  /** The weeks shown, as their Mondays, oldest first. */
  weeks: string[]
  /** Each area that had time in them, most time first; `ms[i]` is its time in `weeks[i]`, `share[i]` that against the most any cell had. */
  areas: { area: string; ms: number[]; share: number[] }[]
}

/**
 * Time per area for the last `count` weeks up to the one of `today` (ActivitySummary.byWeek),
 * weeks with nothing included, so that the columns line up.
 */
export function areaWeeks(
  byWeek: readonly { week: string; areas: readonly { area: string; ms: number }[] }[],
  today: string,
  count = 6
): AreaWeeks {
  const monday = mondayOf(parseDay(today) ?? new Date())
  const weeks: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(monday)
    date.setDate(date.getDate() - i * 7)
    weeks.push(dayKey(date))
  }
  const found = new Map(byWeek.map((entry) => [entry.week, entry.areas]))
  const totals = new Map<string, number>()
  for (const week of weeks) for (const { area, ms } of found.get(week) ?? []) totals.set(area, (totals.get(area) ?? 0) + ms)
  const areas = [...totals].sort((a, b) => b[1] - a[1]).map(([area]) => area)
  const grid = areas.map((area) => weeks.map((week) => found.get(week)?.find((entry) => entry.area === area)?.ms ?? 0))
  const most = Math.max(0, ...grid.flat())
  return {
    weeks,
    areas: areas.map((area, i) => ({ area, ms: grid[i], share: grid[i].map((ms) => (most ? ms / most : 0)) }))
  }
}

/** A span of time, the way a person says it: "under a minute", "25 min", "2 h 10 min". */
export function duration(ms: number, locale: 'en' | 'pt-BR'): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return locale === 'pt-BR' ? 'menos de 1 min' : 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}
