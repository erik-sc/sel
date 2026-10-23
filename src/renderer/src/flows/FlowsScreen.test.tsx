// @vitest-environment happy-dom
// The Fluxos screen with a year of activity, with none, and with the history turned off: the
// squares and their tables, where you go, time per area, what pulls you back, the filters and the
// switch for the weekly word.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityQuery, ActivityStatus, ActivitySummary } from '@shared/activity'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'
import { useHome } from '@/home/store'
import { useUi } from '@/store/ui'

const { FlowsScreen } = await import('./FlowsScreen')

/** Thursday 22 October 2026, noon. */
const NOW = new Date(2026, 9, 22, 12).getTime()

const grid = (): number[][] => Array.from({ length: 7 }, () => new Array<number>(24).fill(0))

function summary(extra: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    from: 0,
    to: NOW,
    total: 0,
    byDay: [],
    byWeekHour: grid(),
    byKind: {},
    byProject: [],
    transitions: [],
    timeByArea: [],
    byWeek: [],
    returning: [],
    ...extra
  }
}

const hours = grid()
hours[2][9] = 12
hours[4][15] = 3

const FULL = summary({
  total: 20,
  byDay: [
    { day: '2026-10-20', count: 12 },
    { day: '2026-10-22', count: 3 },
    { day: '2026-03-03', count: 5 }
  ],
  byWeekHour: hours,
  byKind: { edit: 15, 'task.completed': 5 },
  transitions: [
    { from: { area: 'today', pageId: null }, to: { area: 'tasks', pageId: null }, count: 4 },
    { from: { area: 'tasks', pageId: null }, to: { area: 'sky', pageId: null }, count: 1 }
  ],
  timeByArea: [{ area: 'today', ms: 20 * 60_000 }],
  byWeek: [
    {
      week: '2026-10-19',
      areas: [
        { area: 'today', ms: 20 * 60_000 },
        { area: 'tasks', ms: 5 * 60_000 }
      ]
    }
  ],
  returning: [{ pageId: '11111111-1111-4111-8111-111111111111', days: 3, opens: 5 }]
})

interface Api {
  status: ActivityStatus
  summary: ActivitySummary
  queries: ActivityQuery[]
  settings: Record<string, unknown>
}

let api: Api

function install(status: Partial<ActivityStatus>, data: ActivitySummary): void {
  api = { status: { enabled: true, events: 40, since: NOW - 1000, ...status }, summary: data, queries: [], settings: {} }
  const base = fakeApi({ 'blocks.getMany': [] }) as Record<string, unknown>
  const activity = {
    status: vi.fn(async () => api.status),
    summary: vi.fn(async (query: ActivityQuery) => {
      api.queries.push(query)
      return api.summary
    })
  }
  const app = {
    getSetting: vi.fn(async (key: string) => api.settings[key] ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      api.settings[key] = value
    })
  }
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) => (prop === 'activity' ? activity : prop === 'app' ? app : target[prop as string])
  })
}

const text = (): string => document.body.textContent ?? ''
const radio = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label) as HTMLButtonElement

beforeEach(() => {
  useHome.setState({ locale: 'en' })
})

afterEach(cleanup)

describe('the Fluxos screen', () => {
  it('draws the year, the week by the hour, where you go, time per area and what pulls you back', async () => {
    install({}, FULL)
    await render(<FlowsScreen now={NOW} />)
    await settle()
    const [year, week] = [...document.querySelectorAll('svg.flows-svg')]
    expect(year.getAttribute('role')).toBe('img')
    expect(year.getAttribute('aria-label')).toMatch(/^Activity per day, from Mon 20 Oct 2025 to Sun 25 Oct 2026$/)
    // Three days with something; the rest are dots, and nothing is drawn after today.
    expect(year.querySelectorAll('rect.flows-cell')).toHaveLength(3)
    expect(year.querySelector('rect.flows-cell.is-l4 title')?.textContent).toBe('Tue 20 Oct 2026: 12 entries')
    expect(week.querySelectorAll('rect.flows-cell')).toHaveLength(2)
    // The tables say the same for a screen reader.
    const tables = [...document.querySelectorAll('.flows-table table')]
    expect(tables).toHaveLength(2)
    expect(tables[0].textContent).toContain('Oct 2026')
    expect(tables[1].querySelectorAll('tbody tr')).toHaveLength(7)
    // Where you go: the moves of the week, most first.
    const moves = [...document.querySelectorAll('.flows-move')].map((li) => li.textContent?.replace(/\s+/g, ' '))
    expect(moves[0]).toBe('Today → Tasks4×')
    expect(moves).toHaveLength(2)
    // Time per area for the last six weeks.
    const weeks = document.querySelector('table.flows-weeks') as HTMLTableElement
    expect(weeks.querySelectorAll('thead th')).toHaveLength(7)
    expect(weeks.querySelector('tbody tr th')?.textContent).toBe('Today')
    expect(weeks.querySelector('tbody tr td:last-child')?.textContent).toBe('20 min')
    // What pulls you back: a page not loaded is untitled until it is.
    expect(document.querySelector('.flows-back li')?.textContent).toBe('Untitledon 3 days')
    // No score anywhere.
    expect(text()).not.toMatch(/streak|record|best|score/i)
    expect(await seriousViolations()).toEqual([])
  })

  it('reads the year with the kind and the time it is filtered by', async () => {
    install({}, FULL)
    await render(<FlowsScreen now={NOW} />)
    await settle()
    expect(api.queries).toContainEqual({ from: new Date(2025, 9, 20).getTime(), kinds: undefined })
    await act(async () => radio('Writing').click())
    await settle()
    expect(api.queries.at(-1)).toEqual({ from: new Date(2025, 9, 20).getTime(), kinds: ['edit'] })
    expect(radio('Writing').getAttribute('aria-checked')).toBe('true')
    // The flows are read for this week and the last six, whatever the filter.
    expect(api.queries).toContainEqual({ from: new Date(2026, 9, 19).getTime() })
  })

  it('says so when there is nothing yet', async () => {
    install({ events: 0, since: null }, summary())
    await render(<FlowsScreen now={NOW} />)
    await settle()
    expect(text()).toContain('Nothing here yet')
    expect(document.querySelector('svg.flows-svg')).toBeNull()
    expect(await seriousViolations()).toEqual([])
  })

  it('points to the setting when the history is off', async () => {
    install({ enabled: false, events: 0, since: null }, summary())
    await render(<FlowsScreen now={NOW} />)
    await settle()
    expect(text()).toContain('The activity history is off')
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Open settings') as HTMLButtonElement
    await act(async () => open.click())
    expect(useUi.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'general' })
  })

  it('speaks Portuguese, and turns the weekly word on and off', async () => {
    useHome.setState({ locale: 'pt-BR' })
    install({}, FULL)
    await render(<FlowsScreen now={NOW} />)
    await settle()
    expect(text()).toContain('Para onde você vai')
    expect(text()).toContain('Um comentário sobre o seu ritmo')
    expect(radio('Desligado').getAttribute('aria-checked')).toBe('true')
    await act(async () => radio('Ligado').click())
    expect(api.settings['activity.rhythm']).toBe(true)
    expect(radio('Ligado').getAttribute('aria-checked')).toBe('true')
  })
})
