import {
  ACTIVITY_IDLE_MS,
  type ActivityKind,
  type ActivityPlace,
  type ActivityQuery,
  type ActivityRow,
  type ActivitySummary,
  type ActivityTransition
} from '../../shared/activity'
import { retentionCutoff } from '../db/activity'

/**
 * What the heatmaps and the flows (docs/plans/release-0.8.0.md, D2–D4) read of the activity log:
 * pure functions over its rows (`ActivityLog.rows`), so that each is tested without a database
 * and a screen asks for aggregates, never for rows. Days and hours are the computer's local ones
 * unless `local` says otherwise; each row weighs 1 (an `edit` row is one minute with edits).
 */

/** Where a moment falls: its day (`YYYY-MM-DD`), weekday (0 = Sunday) and hour. */
export interface LocalTime {
  day: string
  weekday: number
  hour: number
}

export type LocalClock = (at: number) => LocalTime

const pad = (n: number): string => String(n).padStart(2, '0')

/** The computer's own time zone. */
export const localTime: LocalClock = (at) => {
  const d = new Date(at)
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, weekday: d.getDay(), hour: d.getHours() }
}

/** Only the rows a query asks for: its kinds, its project. The span is the caller's (`ActivityLog.rows`). */
export function filterRows(rows: readonly ActivityRow[], query: Pick<ActivityQuery, 'kinds' | 'project'> = {}): ActivityRow[] {
  const kinds = query.kinds?.length ? new Set<ActivityKind>(query.kinds) : null
  return rows.filter((row) => (!kinds || kinds.has(row.kind)) && (query.project === undefined || row.project === query.project))
}

/** Rows per local day, oldest first; days with none are left out. */
export function countsByDay(rows: readonly ActivityRow[], local: LocalClock = localTime): { day: string; count: number }[] {
  const days = new Map<string, number>()
  for (const row of rows) {
    const { day } = local(row.at)
    days.set(day, (days.get(day) ?? 0) + 1)
  }
  return [...days].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, count]) => ({ day, count }))
}

/** Rows per weekday × hour: `[weekday][hour]`, weekday 0 = Sunday. */
export function countsByWeekHour(rows: readonly ActivityRow[], local: LocalClock = localTime): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  for (const row of rows) {
    const { weekday, hour } = local(row.at)
    grid[weekday][hour] += 1
  }
  return grid
}

export function countsByKind(rows: readonly ActivityRow[]): Partial<Record<ActivityKind, number>> {
  const out: Partial<Record<ActivityKind, number>> = {}
  for (const row of rows) out[row.kind] = (out[row.kind] ?? 0) + 1
  return out
}

const TASK_KINDS = new Set<ActivityKind>(['task.created', 'task.completed', 'task.postponed'])

/** Task events per project (null: a task with none), most first. */
export function countsByProject(rows: readonly ActivityRow[]): { project: string | null; count: number }[] {
  const projects = new Map<string | null, number>()
  for (const row of rows) if (TASK_KINDS.has(row.kind)) projects.set(row.project, (projects.get(row.project) ?? 0) + 1)
  return [...projects].map(([project, count]) => ({ project, count })).sort((a, b) => b.count - a.count)
}

/** One stay somewhere: from an `open` to the next one (or the idle cap). */
export interface Visit extends ActivityPlace {
  at: number
  ms: number
}

const samePlace = (a: ActivityPlace, b: ActivityPlace): boolean => a.area === b.area && a.pageId === b.pageId

/**
 * The `open` rows as visits, oldest first. A visit lasts until the next `open`, at most `idle`
 * (time away from the computer is not time spent); the last one lasts until `end`, at most
 * `idle` too. The same place opened twice in a row is one visit.
 */
export function visits(rows: readonly ActivityRow[], end: number, idle = ACTIVITY_IDLE_MS): Visit[] {
  const opens = rows.filter((row) => row.kind === 'open' && row.area)
  const out: Visit[] = []
  for (let i = 0; i < opens.length; i++) {
    const row = opens[i]
    const next = opens[i + 1]?.at ?? Math.max(row.at, end)
    const ms = Math.min(Math.max(0, next - row.at), idle)
    const place: ActivityPlace = { area: row.area as string, pageId: row.pageId }
    const last = out[out.length - 1]
    // A gap longer than the cap starts a new stay even in the same place.
    if (last && samePlace(last, place) && row.at - last.at <= idle) last.ms += ms
    else out.push({ ...place, at: row.at, ms })
  }
  return out
}

/**
 * The most common moves from one place to the next, most first. A move across a gap longer than
 * `idle` is not one: coming back to the computer is not going from there to here.
 */
export function transitions(rows: readonly ActivityRow[], limit = 10, idle = ACTIVITY_IDLE_MS): ActivityTransition[] {
  const opens = rows.filter((row) => row.kind === 'open' && row.area)
  const counts = new Map<string, ActivityTransition>()
  for (let i = 1; i < opens.length; i++) {
    const from: ActivityPlace = { area: opens[i - 1].area as string, pageId: opens[i - 1].pageId }
    const to: ActivityPlace = { area: opens[i].area as string, pageId: opens[i].pageId }
    if (samePlace(from, to) || opens[i].at - opens[i - 1].at > idle) continue
    const key = JSON.stringify([from.area, from.pageId, to.area, to.pageId])
    const found = counts.get(key)
    if (found) found.count++
    else counts.set(key, { from, to, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

/** Time spent per area (`page` for every page together), most first. */
export function timeByArea(rows: readonly ActivityRow[], end: number, idle = ACTIVITY_IDLE_MS): { area: string; ms: number }[] {
  const areas = new Map<string, number>()
  for (const visit of visits(rows, end, idle)) areas.set(visit.area, (areas.get(visit.area) ?? 0) + visit.ms)
  return [...areas].map(([area, ms]) => ({ area, ms })).sort((a, b) => b.ms - a.ms)
}

/** Time spent per area in each week (weeks start on Monday, local), oldest week first. */
export function timeByAreaPerWeek(
  rows: readonly ActivityRow[],
  end: number,
  idle = ACTIVITY_IDLE_MS
): { week: string; areas: { area: string; ms: number }[] }[] {
  const weeks = new Map<string, Map<string, number>>()
  for (const visit of visits(rows, end, idle)) {
    const week = weekOf(visit.at)
    const areas = weeks.get(week) ?? new Map<string, number>()
    areas.set(visit.area, (areas.get(visit.area) ?? 0) + visit.ms)
    weeks.set(week, areas)
  }
  return [...weeks]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, areas]) => ({ week, areas: [...areas].map(([area, ms]) => ({ area, ms })).sort((a, b) => b.ms - a.ms) }))
}

/** The local Monday of the week `at` is in, as `YYYY-MM-DD`. */
export function weekOf(at: number): string {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localTime(d.getTime()).day
}

/** The pages opened on the most different days (the ones that pull you back), then by opens. */
export function returningPages(
  rows: readonly ActivityRow[],
  limit = 10,
  local: LocalClock = localTime
): { pageId: string; days: number; opens: number }[] {
  const pages = new Map<string, { days: Set<string>; opens: number }>()
  for (const row of rows) {
    if (row.kind !== 'open' || !row.pageId) continue
    const page = pages.get(row.pageId) ?? { days: new Set<string>(), opens: 0 }
    page.days.add(local(row.at).day)
    page.opens++
    pages.set(row.pageId, page)
  }
  return [...pages]
    .map(([pageId, { days, opens }]) => ({ pageId, days: days.size, opens }))
    .sort((a, b) => b.days - a.days || b.opens - a.opens)
    .slice(0, limit)
}

/** The span a query covers: its own, else the retention up to `now` (included). */
export function querySpan(query: ActivityQuery, now: number): { from: number; to: number } {
  const to = typeof query.to === 'number' && Number.isFinite(query.to) ? query.to : now + 1
  const from = typeof query.from === 'number' && Number.isFinite(query.from) ? query.from : retentionCutoff(now)
  return { from, to: Math.max(from, to) }
}

/**
 * Everything a screen of D2/D3 shows, from the rows of the span. Kind and project filters apply
 * to the counts; the flows (transitions, time, returning pages) always read every `open`.
 */
export function summarize(rows: readonly ActivityRow[], query: ActivityQuery, now: number, local: LocalClock = localTime): ActivitySummary {
  const { from, to } = querySpan(query, now)
  const span = rows.filter((row) => row.at >= from && row.at < to)
  const counted = filterRows(span, query)
  return {
    from,
    to,
    total: counted.length,
    byDay: countsByDay(counted, local),
    byWeekHour: countsByWeekHour(counted, local),
    byKind: countsByKind(counted),
    byProject: countsByProject(counted),
    transitions: transitions(span),
    timeByArea: timeByArea(span, Math.min(to, now)),
    byWeek: timeByAreaPerWeek(span, Math.min(to, now)),
    returning: returningPages(span, 10, local)
  }
}
