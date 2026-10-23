// The Fluxos screen's arithmetic: the year's squares, the steps of ink, the week × hour rows and
// the weeks of time per area.
import { describe, expect, it } from 'vitest'
import { areaWeeks, dayKey, duration, isEmptySummary, levelScale, mondayOf, parseDay, weekHourRows, yearGrid } from './layout'

describe('days', () => {
  it('reads and writes local days, and finds their Monday', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(parseDay('2026-02-30')).toBeNull()
    expect(parseDay('soon')).toBeNull()
    // 22 Oct 2026 is a Thursday; 18 Oct a Sunday.
    expect(dayKey(mondayOf(parseDay('2026-10-22') as Date))).toBe('2026-10-19')
    expect(dayKey(mondayOf(parseDay('2026-10-18') as Date))).toBe('2026-10-12')
  })
})

describe('the steps of ink', () => {
  it('puts nothing at 0 and ranks the rest in four steps, so one busy day does not wash out the year', () => {
    const level = levelScale([1, 2, 3, 4, 5, 6, 7, 8, 500])
    expect(level(0)).toBe(0)
    expect(level(1)).toBe(1)
    expect(level(4)).toBe(2)
    expect(level(6)).toBe(3)
    expect(level(500)).toBe(4)
    expect(level(8)).toBe(4)
  })

  it('makes the largest the darkest, even alone, and copes with nothing', () => {
    expect(levelScale([3])(3)).toBe(4)
    expect(levelScale([])(5)).toBe(4)
    expect(levelScale([])(0)).toBe(0)
  })
})

describe('the year grid', () => {
  const grid = yearGrid('2026-10-22', [
    { day: '2026-10-22', count: 4 },
    { day: '2026-10-20', count: 1 },
    { day: '2025-10-20', count: 9 },
    // Before the grid: left out.
    { day: '2025-01-01', count: 9 }
  ])

  it('has 53 columns of seven days, Monday to Sunday, the last holding today', () => {
    expect(grid.weeks).toHaveLength(53)
    expect(grid.weeks.every((column) => column.length === 7)).toBe(true)
    expect(grid.weeks[0][0].weekday).toBe(1)
    expect(grid.weeks[52][6].weekday).toBe(0)
    expect(grid.from).toBe('2025-10-20')
    expect(grid.to).toBe('2026-10-25')
    expect(grid.weeks[52][3]).toMatchObject({ day: '2026-10-22', count: 4, future: false })
  })

  it('leaves the days after today blank, and darkens the rest by rank', () => {
    expect(grid.weeks[52].slice(4).every((cell) => cell.future && cell.level === 0)).toBe(true)
    expect(grid.weeks[52][1]).toMatchObject({ count: 1, level: 2 })
    expect(grid.weeks[0][0]).toMatchObject({ day: '2025-10-20', count: 9, level: 4 })
    const counted = grid.weeks.flat().filter((cell) => cell.count)
    expect(counted).toHaveLength(3)
  })

  it('names each month over the column where its first day is', () => {
    expect(grid.months[0]).toEqual({ column: 1, month: 10, year: 2025 })
    expect(grid.months.map((month) => month.month)).toEqual([10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})

describe('the week × hour grid', () => {
  it('reads Monday first, with a level for every hour', () => {
    const byWeekHour = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
    byWeekHour[0][8] = 2
    byWeekHour[2][9] = 10
    const rows = weekHourRows(byWeekHour)
    expect(rows.map((row) => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(rows[1].hours[9]).toEqual({ hour: 9, count: 10, level: 4 })
    expect(rows[6].hours[8].count).toBe(2)
    expect(rows[0].hours.every((hour) => hour.level === 0)).toBe(true)
  })
})

describe('time per area per week', () => {
  it('lines the last weeks up, oldest first, the busiest area first, with shares against the busiest cell', () => {
    const table = areaWeeks(
      [
        { week: '2026-10-05', areas: [{ area: 'tasks', ms: 60_000 }] },
        {
          week: '2026-10-19',
          areas: [
            { area: 'page', ms: 120_000 },
            { area: 'tasks', ms: 30_000 }
          ]
        },
        // Too old for six weeks.
        { week: '2026-08-03', areas: [{ area: 'sky', ms: 999_000 }] }
      ],
      '2026-10-22'
    )
    expect(table.weeks).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'])
    expect(table.areas.map((row) => row.area)).toEqual(['page', 'tasks'])
    expect(table.areas[1].ms).toEqual([0, 0, 0, 60_000, 0, 30_000])
    expect(table.areas[0].share[5]).toBe(1)
    expect(table.areas[1].share[3]).toBe(0.5)
  })
})

describe('words for time', () => {
  it('says a span the way a person would', () => {
    expect(duration(20_000, 'en')).toBe('under a minute')
    expect(duration(20_000, 'pt-BR')).toBe('menos de 1 min')
    expect(duration(25 * 60_000, 'en')).toBe('25 min')
    expect(duration(130 * 60_000, 'en')).toBe('2 h 10 min')
    expect(duration(120 * 60_000, 'pt-BR')).toBe('2 h')
  })

  it('knows an empty summary', () => {
    expect(isEmptySummary({ total: 0, transitions: [], timeByArea: [] })).toBe(true)
    expect(isEmptySummary({ total: 0, transitions: [], timeByArea: [{}] })).toBe(false)
  })
})
