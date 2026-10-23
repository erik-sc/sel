import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { on: () => undefined } }))

import type { ActivityKind, ActivityRow } from '../../shared/activity'
import { openTestRepository } from '../db/testing'
import {
  countsByDay,
  countsByKind,
  countsByProject,
  countsByWeekHour,
  filterRows,
  querySpan,
  returningPages,
  summarize,
  timeByArea,
  timeByAreaPerWeek,
  transitions,
  visits,
  weekOf
} from './queries'
import { activityQuery, registerActivity } from './register'

const MINUTE = 60_000
/** Local times, so that the expectations hold in any time zone. */
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime()

const row = (time: number, kind: ActivityKind, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  at: time,
  kind,
  area: null,
  pageId: null,
  project: null,
  count: 1,
  minutes: null,
  ...extra
})
const open = (time: number, area: string, pageId: string | null = null): ActivityRow => row(time, 'open', { area, pageId })

describe('counts', () => {
  // Thursday 22 and Friday 23 October 2026.
  const rows = [
    row(at(22, 9), 'edit', { pageId: 'a', count: 7 }),
    row(at(22, 9, 1), 'edit', { pageId: 'a' }),
    row(at(22, 14), 'task.completed', { project: 'p1' }),
    row(at(23, 9), 'task.created', { project: 'p1' }),
    row(at(23, 10), 'task.postponed'),
    row(at(23, 10), 'focus.finish', { minutes: 25 })
  ]

  it('by day, oldest first, each row once', () => {
    expect(countsByDay(rows)).toEqual([
      { day: '2026-10-22', count: 3 },
      { day: '2026-10-23', count: 3 }
    ])
  })

  it('by weekday and hour', () => {
    const grid = countsByWeekHour(rows)
    expect(grid).toHaveLength(7)
    expect(grid.every((hours) => hours.length === 24)).toBe(true)
    expect(grid[4][9]).toBe(2)
    expect(grid[4][14]).toBe(1)
    expect(grid[5][9]).toBe(1)
    expect(grid[5][10]).toBe(2)
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(6)
  })

  it('by kind and by project (tasks only)', () => {
    expect(countsByKind(rows)).toEqual({ edit: 2, 'task.completed': 1, 'task.created': 1, 'task.postponed': 1, 'focus.finish': 1 })
    expect(countsByProject(rows)).toEqual([
      { project: 'p1', count: 2 },
      { project: null, count: 1 }
    ])
  })

  it('filtered by kind and project', () => {
    expect(filterRows(rows, { kinds: ['edit'] })).toHaveLength(2)
    expect(filterRows(rows, { project: 'p1' }).map((r) => r.kind)).toEqual(['task.completed', 'task.created'])
    expect(filterRows(rows, { kinds: [] })).toHaveLength(6)
  })
})

describe('flows', () => {
  const rows = [
    open(at(22, 9), 'today'),
    open(at(22, 9, 5), 'tasks'),
    open(at(22, 9, 10), 'page', 'x'),
    row(at(22, 9, 11), 'edit', { pageId: 'x' }),
    open(at(22, 9, 20), 'page', 'x'),
    open(at(22, 9, 30), 'today'),
    open(at(22, 9, 35), 'tasks'),
    // Two hours away: not a move from Tasks to the Sky, and not two hours in Tasks.
    open(at(22, 11, 35), 'sky')
  ]
  const end = at(22, 11, 45)

  it('visits last until the next open, capped, and the same place twice is one visit', () => {
    expect(visits(rows, end).map((v) => [v.area, v.pageId, v.ms / MINUTE])).toEqual([
      ['today', null, 5],
      ['tasks', null, 5],
      ['page', 'x', 20],
      ['today', null, 5],
      ['tasks', null, 30],
      ['sky', null, 10]
    ])
  })

  it('transitions, most common first, never across a gap', () => {
    expect(transitions(rows)).toEqual([
      { from: { area: 'today', pageId: null }, to: { area: 'tasks', pageId: null }, count: 2 },
      { from: { area: 'tasks', pageId: null }, to: { area: 'page', pageId: 'x' }, count: 1 },
      { from: { area: 'page', pageId: 'x' }, to: { area: 'today', pageId: null }, count: 1 }
    ])
    expect(transitions(rows, 1)).toHaveLength(1)
  })

  it('time by area, and by area per week', () => {
    expect(timeByArea(rows, end).map((a) => [a.area, a.ms / MINUTE])).toEqual([
      ['tasks', 35],
      ['page', 20],
      ['today', 10],
      ['sky', 10]
    ])
    const weeks = timeByAreaPerWeek([...rows, open(at(27, 9), 'sky')], at(27, 9, 10))
    expect(weeks.map((w) => w.week)).toEqual(['2026-10-19', '2026-10-26'])
    expect(weeks[1].areas).toEqual([{ area: 'sky', ms: 10 * MINUTE }])
    expect(weekOf(at(25, 23))).toBe('2026-10-19')
    expect(weekOf(at(26, 0))).toBe('2026-10-26')
  })

  it('pages that pull you back: on the most days first', () => {
    const more = [...rows, open(at(23, 9), 'page', 'y'), open(at(24, 9), 'page', 'y'), open(at(24, 10), 'page', 'y')]
    expect(returningPages(more)).toEqual([
      { pageId: 'y', days: 2, opens: 3 },
      { pageId: 'x', days: 1, opens: 2 }
    ])
  })
})

describe('summarize', () => {
  it('reads only the span asked for, and filters the counts but not the flows', () => {
    const rows = [
      open(at(20, 9), 'today'),
      open(at(22, 9), 'today'),
      open(at(22, 9, 1), 'tasks'),
      row(at(22, 9, 2), 'task.completed', { project: 'p' })
    ]
    const summary = summarize(rows, { from: at(21, 0), to: at(23, 0), kinds: ['task.completed'] }, at(23, 0))
    expect(summary.total).toBe(1)
    expect(summary.byKind).toEqual({ 'task.completed': 1 })
    expect(summary.byDay).toEqual([{ day: '2026-10-22', count: 1 }])
    expect(summary.transitions).toHaveLength(1)
    expect(summary.byWeek.map((week) => week.week)).toEqual(['2026-10-19'])
    expect(summary.byProject).toEqual([{ project: 'p', count: 1 }])
    // Aggregates only: nothing in it is a row.
    expect(JSON.stringify(summary)).not.toContain('"kind"')
  })

  it('spans the last 12 months unless told otherwise', () => {
    const now = at(22, 12)
    expect(querySpan({}, now)).toEqual({ from: new Date(2025, 9, 22, 12).getTime(), to: now + 1 })
    expect(querySpan({ from: 5, to: 2 }, now)).toEqual({ from: 5, to: 5 })
  })

  it('is empty with no rows', () => {
    const summary = summarize([], {}, at(22, 12))
    expect(summary.total).toBe(0)
    expect(summary.byDay).toEqual([])
    expect(summary.byWeekHour.flat().every((n) => n === 0)).toBe(true)
    expect(summary.transitions).toEqual([])
  })
})

describe('the activity channels', () => {
  it('take a screen or a page from a window, and nothing else', async () => {
    const repo = openTestRepository()
    const { handlers } = registerActivity(repo.activity, () => at(22, 12))
    await handlers['activity:open'](['today'], undefined as never)
    await handlers['activity:open'](['page', 'abc'], undefined as never)
    expect(() => handlers['activity:open'](['nowhere'], undefined as never)).toThrow('Invalid area')
    expect(() => handlers['activity:open'](['page'], undefined as never)).toThrow()
    expect(() => handlers['activity:open'](['page', '../x'], undefined as never)).toThrow()
    const status = (await handlers['activity:status']([], undefined as never)) as { enabled: boolean; events: number }
    expect(status).toMatchObject({ enabled: true, events: 2 })
    const cleared = (await handlers['activity:clear']([], undefined as never)) as { events: number; since: number | null }
    expect(cleared).toMatchObject({ events: 0, since: null })
    repo.close()
  })

  it('answer a summary of aggregates', async () => {
    let now = at(22, 9)
    const repo = openTestRepository(':memory:', { clock: () => now })
    const { handlers } = registerActivity(repo.activity, () => now)
    await handlers['activity:open'](['today'], undefined as never)
    now += 5 * MINUTE
    await handlers['activity:open'](['tasks'], undefined as never)
    const summary = (await handlers['activity:summary']([{ kinds: ['open'] }], undefined as never)) as {
      total: number
      transitions: unknown[]
    }
    expect(summary.total).toBe(2)
    expect(summary.transitions).toHaveLength(1)
    repo.close()
  })

  it('check a query', () => {
    expect(activityQuery(undefined)).toEqual({})
    expect(activityQuery({ from: 1, to: 2, kinds: ['edit'], project: 'p' })).toEqual({ from: 1, to: 2, kinds: ['edit'], project: 'p' })
    expect(() => activityQuery({ kinds: ['nope'] })).toThrow()
    expect(() => activityQuery({ from: 'x' })).toThrow()
    expect(() => activityQuery('x')).toThrow()
  })
})
