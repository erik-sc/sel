// The chart engine. Runs under a negative-UTC-offset timezone with DST history
// (America/Sao_Paulo): day strings must land in the bucket they name, whatever the
// machine thinks midnight is. The timezone is process-wide, hence set before any import.
process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import type { Block, ChartConfig, DatabaseView } from '../../../../shared/types'
import * as L from '../views/chartLogic'

const EN: L.FormatOptions = { locale: 'en-US', currency: 'USD' }

function row(id: string, values: Record<string, unknown> = {}, extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: [[id]], values: values as Block['props']['values'] },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    ...extra
  }
}

const schema: L.Schema = {
  title: { id: 'title', name: 'Name', type: 'title' },
  st: {
    id: 'st',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'todo', name: 'To do', color: 'gray' },
      { id: 'doing', name: 'Doing', color: 'blue' },
      { id: 'done', name: 'Done', color: 'green' }
    ]
  },
  tags: {
    id: 'tags',
    name: 'Tags',
    type: 'multi_select',
    options: [
      { id: 'a', name: 'Alpha', color: 'red' },
      { id: 'b', name: 'Beta', color: 'purple' }
    ]
  },
  amt: { id: 'amt', name: 'Amount', type: 'number', numberFormat: 'currency' },
  ok: { id: 'ok', name: 'Approved', type: 'checkbox' },
  due: { id: 'due', name: 'Due', type: 'date' },
  who: { id: 'who', name: 'Owner', type: 'text' },
  made: { id: 'made', name: 'Created', type: 'created_time' }
}

const rows: Block[] = [
  row('r1', { st: 'todo', tags: ['a', 'b'], amt: 10, ok: true, due: { start: '2024-01-15' }, who: 'Ada' }),
  row('r2', { st: 'done', tags: ['a'], amt: 20, ok: false, due: { start: '2024-01-31' }, who: 'Ada' }),
  row('r3', { st: 'done', tags: [], amt: 30, ok: true, due: { start: '2024-03-01' }, who: 'Bob' }),
  row('r4', { amt: 'abc', who: '  ' }),
  row('r5', { st: 'done', amt: 40, ok: true, due: { start: '2024-03-10', end: '2024-03-12' }, who: 'Cy' })
]

const count = (x: string, more: Partial<ChartConfig> = {}): ChartConfig => ({ kind: 'column', x, y: { aggregate: 'count' }, ...more })
const build = (config: ChartConfig, input: Block[] = rows, now?: Date): L.ChartData => L.buildChartData(input, schema, config, now, EN)
const labels = (data: L.ChartData): string[] => data.categories.map((c) => c.label)
const values = (data: L.ChartData, series = 0): (number | null)[] => data.series[series].values

describe('timezone guard', () => {
  it('really runs in America/Sao_Paulo', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Sao_Paulo')
    expect(new Date('2024-03-10').getDate()).toBe(9)
  })
})

describe('grouping by property type', () => {
  it('select: one category per option, in option order, empty options included', () => {
    const data = build(count('st'))
    expect(data.status).toBe('ok')
    expect(data.categories.map((c) => c.key)).toEqual(['o:todo', 'o:doing', 'o:done'])
    expect(labels(data)).toEqual(['To do', 'Doing', 'Done'])
    expect(values(data)).toEqual([1, 0, 3])
    expect(data.total).toBe(4)
    expect(data.rowCount).toBe(4)
    expect(data.xLabel).toBe('Status')
    expect(data.yLabel).toBe('Count')
    expect(data.split).toBe(false)
  })

  it('select: the empty group is only part of the chart when asked for, and comes last', () => {
    const data = build(count('st', { showEmpty: true }))
    expect(labels(data)).toEqual(['To do', 'Doing', 'Done', 'No Status'])
    expect(data.categories[3]).toMatchObject({ key: L.CHART_EMPTY_KEY, kind: 'empty' })
    expect(values(data)).toEqual([1, 0, 3, 1])
    expect(data.total).toBe(5)
  })

  it('select: a dangling option id reads as no value', () => {
    const data = build(count('st', { showEmpty: true }), [row('x', { st: 'gone' }), row('y', { st: 'done' })])
    expect(values(data)).toEqual([0, 0, 1, 1])
  })

  it('multi-select: a row counts in each of its options, but once in the total', () => {
    const data = build(count('tags'))
    expect(labels(data)).toEqual(['Alpha', 'Beta'])
    expect(values(data)).toEqual([2, 1])
    expect(data.total).toBe(2)
    expect(data.rowCount).toBe(2)
    expect(values(build(count('tags', { showEmpty: true })))).toEqual([2, 1, 3])
  })

  it('checkbox: checked and unchecked, a missing value being unchecked', () => {
    const data = build(count('ok'))
    expect(labels(data)).toEqual(['Checked', 'Unchecked'])
    expect(values(data)).toEqual([3, 2])
  })

  it('text: exact values in order of first appearance, blank ones left out', () => {
    const data = build(count('who'))
    expect(labels(data)).toEqual(['Ada', 'Bob', 'Cy'])
    expect(values(data)).toEqual([2, 1, 1])
    expect(data.categories[0].key).toBe('t:Ada')
  })

  it('title and url group like text', () => {
    expect(labels(build(count('title')))).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    const urls: L.Schema = { ...schema, link: { id: 'link', name: 'Link', type: 'url' } }
    const data = L.buildChartData(
      [row('a', { link: 'https://a.dev' }), row('b', { link: 'https://a.dev' }), row('c', { link: 'https://b.dev' })],
      urls,
      count('link'),
      undefined,
      EN
    )
    expect(labels(data)).toEqual(['https://a.dev', 'https://b.dev'])
    expect(values(data)).toEqual([2, 1])
  })

  it('text: top N by value, the rest folded into "Other"', () => {
    const data = build(count('who', { limit: 1 }))
    expect(labels(data)).toEqual(['Ada', 'Other'])
    expect(data.categories[1]).toMatchObject({ key: L.CHART_OTHER_KEY, kind: 'other' })
    expect(values(data)).toEqual([2, 2])
  })

  it('text: never more than the default limit of categories without one', () => {
    const many = Array.from({ length: 80 }, (_, i) => row(`m${i}`, { who: `Owner ${i}` }))
    const data = build(count('who'), many)
    expect(data.categories).toHaveLength(L.DEFAULT_CATEGORY_LIMIT + 1)
    expect(data.categories.at(-1)?.kind).toBe('other')
    expect(values(data).at(-1)).toBe(80 - L.DEFAULT_CATEGORY_LIMIT)
  })

  it('number: few distinct values are categories of their own, ascending and formatted', () => {
    const data = build(count('amt'))
    expect(labels(data)).toEqual(['$10.00', '$20.00', '$30.00', '$40.00'])
    expect(values(data)).toEqual([1, 1, 1, 1])
    // "abc" is not a number: that row has no value.
    expect(data.rowCount).toBe(4)
  })

  it('number: more than 12 distinct values are binned into at most 10 round buckets', () => {
    const plain: L.Schema = { ...schema, n: { id: 'n', name: 'Score', type: 'number' } }
    const many = Array.from({ length: 100 }, (_, i) => row(`n${i}`, { n: i }))
    const data = L.buildChartData(many, plain, count('n'), undefined, EN)
    expect(data.categories).toHaveLength(10)
    expect(labels(data).slice(0, 2)).toEqual(['0 – 10', '10 – 20'])
    expect(labels(data).at(-1)).toBe('90 – 100')
    expect(values(data)).toEqual(Array(10).fill(10))
    // Bins are continuous: an empty one is still there, and a limit does not fold them.
    const gappy = many.filter((r) => Number(r.id.slice(1)) < 20 || Number(r.id.slice(1)) >= 80)
    const withGap = L.buildChartData(gappy, plain, count('n', { limit: 2 }), undefined, EN)
    expect(withGap.categories).toHaveLength(10)
    expect(values(withGap).slice(2, 8)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('number: thirteen distinct values still fit ten bins, and the maximum lands in the last one', () => {
    const plain: L.Schema = { ...schema, n: { id: 'n', name: 'Score', type: 'number' } }
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1000].map((n, i) => row(`n${i}`, { n }))
    const data = L.buildChartData(many, plain, count('n'), undefined, EN)
    expect(data.categories.length).toBeLessThanOrEqual(10)
    expect(values(data).reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(13)
    expect(values(data).at(-1)).toBe(1)
  })
})

describe('date axes', () => {
  it('month: a continuous axis with the empty month in between', () => {
    const data = build(count('due', { xDateBucket: 'month' }))
    expect(data.categories.map((c) => c.key)).toEqual(['d:2024-01-01', 'd:2024-02-01', 'd:2024-03-01'])
    expect(labels(data)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024'])
    expect(values(data)).toEqual([2, 0, 2])
    expect(data.bucket).toBe('month')
  })

  it('week: ISO weeks starting on Monday', () => {
    const data = build(count('due', { xDateBucket: 'week' }))
    expect(data.categories.map((c) => c.key)).toEqual([
      'd:2024-01-15',
      'd:2024-01-22',
      'd:2024-01-29',
      'd:2024-02-05',
      'd:2024-02-12',
      'd:2024-02-19',
      'd:2024-02-26',
      'd:2024-03-04'
    ])
    expect(labels(data)[0]).toBe('W3 2024')
    expect(labels(data).at(-1)).toBe('W10 2024')
    expect(values(data)).toEqual([1, 0, 1, 0, 0, 0, 1, 1])
  })

  it('ISO week numbers belong to the year of their Thursday', () => {
    expect(L.isoWeekOf('2021-01-03')).toEqual({ year: 2020, week: 53 })
    expect(L.isoWeekOf('2024-12-30')).toEqual({ year: 2025, week: 1 })
    expect(L.isoWeekOf('2024-01-01')).toEqual({ year: 2024, week: 1 })
    expect(L.isoWeekOf('2023-01-01')).toEqual({ year: 2022, week: 52 })
    expect(L.isoWeekOf('nope')).toBeNull()
    expect(L.bucketStart('2021-01-03', 'week')).toBe('2020-12-28')
    expect(L.bucketLabel('2020-12-28', 'week')).toBe('W53 2020')
  })

  it('day, quarter and year', () => {
    const days = build(count('due', { xDateBucket: 'day' }), [row('a', { due: { start: '2024-02-28' } }), row('b', { due: { start: '2024-03-01' } })])
    expect(days.categories.map((c) => c.key)).toEqual(['d:2024-02-28', 'd:2024-02-29', 'd:2024-03-01'])
    expect(values(days)).toEqual([1, 0, 1])

    const quarters = build(count('due', { xDateBucket: 'quarter' }), [
      row('a', { due: { start: '2023-11-30' } }),
      row('b', { due: { start: '2024-05-01' } })
    ])
    expect(labels(quarters)).toEqual(['Q4 2023', 'Q1 2024', 'Q2 2024'])
    expect(values(quarters)).toEqual([1, 0, 1])

    const years = build(count('due', { xDateBucket: 'year' }), [row('a', { due: { start: '2021-12-31' } }), row('b', { due: { start: '2024-01-01' } })])
    expect(labels(years)).toEqual(['2021', '2022', '2023', '2024'])
    expect(values(years)).toEqual([1, 0, 0, 1])
  })

  it('bucket helpers do civil-day maths only', () => {
    expect(L.bucketStart('2024-03-10', 'month')).toBe('2024-03-01')
    expect(L.bucketStart('2024-03-10', 'quarter')).toBe('2024-01-01')
    expect(L.bucketStart('2024-12-31', 'year')).toBe('2024-01-01')
    expect(L.bucketStart('2024-03-10', 'day')).toBe('2024-03-10')
    expect(L.bucketStart('2024-02-30', 'month')).toBeNull()
    expect(L.nextBucketStart('2024-12-01', 'month')).toBe('2025-01-01')
    expect(L.nextBucketStart('2024-10-01', 'quarter')).toBe('2025-01-01')
    expect(L.nextBucketStart('2024-02-28', 'day')).toBe('2024-02-29')
    expect(L.nextBucketStart('2024-12-30', 'week')).toBe('2025-01-06')
    // The end of the calendar does not move.
    expect(L.nextBucketStart('9999-01-01', 'year')).toBe('9999-01-01')
  })

  it('a day string stays in its own bucket west of Greenwich, also on DST transition days', () => {
    // 2018-11-04 had no local midnight in Sao Paulo (clocks went from 00:00 to 01:00).
    const data = build(count('due', { xDateBucket: 'day' }), [
      row('a', { due: { start: '2018-11-04' } }),
      row('b', { due: { start: '2018-11-04' } }),
      row('c', { due: { start: '2018-11-05' } })
    ])
    expect(data.categories.map((c) => c.key)).toEqual(['d:2018-11-04', 'd:2018-11-05'])
    expect(values(data)).toEqual([2, 1])
    const months = build(count('due'), [row('a', { due: { start: '2024-03-01' } }), row('b', { due: { start: '2024-02-29' } })])
    expect(values(months)).toEqual([1, 1])
    expect(labels(months)).toEqual(['Feb 2024', 'Mar 2024'])
  })

  it('created / edited times fall on the local day they happened on', () => {
    // 01:00 UTC on January 1st is still December 31st, 22:00, in Sao Paulo.
    const stamp = Date.UTC(2024, 0, 1, 1, 0)
    const data = build(count('made', { xDateBucket: 'month' }), [row('a', {}, { createdAt: stamp }), row('b', {}, { createdAt: Date.UTC(2024, 0, 20, 12) })])
    expect(labels(data)).toEqual(['Dec 2023', 'Jan 2024'])
    expect(values(data)).toEqual([1, 1])
    expect(labels(build(count('made', { xDateBucket: 'year' }), [row('a', {}, { createdAt: stamp })]))).toEqual(['2023'])
  })

  it('marks the bucket that contains today', () => {
    const data = build(count('due'), rows, new Date(2024, 2, 15, 23, 30))
    expect(data.categories.map((c) => !!c.current)).toEqual([false, false, true])
    expect(build(count('due'), rows, new Date(2030, 0, 1)).categories.some((c) => c.current)).toBe(false)
  })

  it('a span too long for its bucket is drawn with a coarser one', () => {
    const data = build(count('due', { xDateBucket: 'day' }), [row('a', { due: { start: '2020-01-01' } }), row('b', { due: { start: '2023-01-01' } })])
    expect(data.bucket).toBe('week')
    expect(data.categories.length).toBeLessThanOrEqual(L.MAX_DATE_BUCKETS)
    expect(values(data).reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(2)
    const ages = build(count('due', { xDateBucket: 'day' }), [row('a', { due: { start: '0100-01-01' } }), row('b', { due: { start: '3000-01-01' } })])
    expect(ages.bucket).toBe('year')
    expect(ages.categories.length).toBeLessThanOrEqual(L.MAX_DATE_BUCKETS + 4)
    expect(values(ages).reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(2)
  })

  it('a limit does not break a continuous axis', () => {
    expect(build(count('due', { limit: 1 })).categories).toHaveLength(3)
  })
})

describe('aggregates', () => {
  const by = (aggregate: ChartConfig['y']['aggregate'], property: string, x = 'st'): L.ChartData =>
    build({ kind: 'column', x, y: { aggregate, property } })

  it('sum, with zero for a group that has nothing to add', () => {
    const data = by('sum', 'amt')
    expect(values(data)).toEqual([10, 0, 90])
    expect(data.total).toBe(100)
    expect(data.yLabel).toBe('Sum of Amount')
    expect(data.yFormat).toEqual({ numberFormat: 'currency', integer: false })
    expect(data.additive).toBe(true)
  })

  it('average, minimum, maximum: null where there is nothing to aggregate', () => {
    expect(values(by('average', 'amt'))).toEqual([10, null, 30])
    expect(by('average', 'amt').total).toBe(25)
    expect(values(by('min', 'amt'))).toEqual([10, null, 20])
    expect(values(by('max', 'amt'))).toEqual([10, null, 40])
    expect(by('max', 'amt').additive).toBe(false)
  })

  it('median, for odd and even counts', () => {
    expect(values(by('median', 'amt'))).toEqual([10, null, 30])
    expect(by('median', 'amt').total).toBe(25)
    expect(L.median([4, 1, 3, 2])).toBe(2.5)
    expect(L.median([5])).toBe(5)
    expect(L.median([])).toBeNull()
  })

  it('count of unique values', () => {
    const data = by('count_unique', 'who')
    expect(values(data)).toEqual([1, 0, 3])
    expect(data.total).toBe(3)
    expect(data.yLabel).toBe('Unique Owner')
    expect(data.yFormat.integer).toBe(true)
    // Each option of a multi-select is a value of its own.
    expect(values(by('count_unique', 'tags'))).toEqual([2, 0, 1])
  })

  it('percent checked', () => {
    const data = by('percent_checked', 'ok')
    expect(values(data)[0]).toBe(1)
    expect(values(data)[1]).toBeNull()
    expect(values(data)[2]).toBeCloseTo(2 / 3)
    expect(data.total).toBeCloseTo(3 / 4)
    expect(data.yFormat.numberFormat).toBe('percent')
    expect(data.yLabel).toBe('Approved checked')
  })

  it('a checkbox reads as 1 / 0 for the numeric aggregates', () => {
    expect(values(by('sum', 'ok'))).toEqual([1, 0, 2])
    expect(by('sum', 'ok').yFormat).toEqual({ numberFormat: 'number', integer: true })
    expect(values(by('average', 'ok'))[2]).toBeCloseTo(2 / 3)
  })

  it('ignores NaN, Infinity, text and missing values; reads numeric text as stored numbers are read', () => {
    const odd = [
      row('a', { st: 'done', amt: NaN }),
      row('b', { st: 'done', amt: Infinity }),
      row('c', { st: 'done', amt: 'abc' }),
      row('d', { st: 'done' }),
      row('e', { st: 'done', amt: '12' }),
      row('f', { st: 'done', amt: 8 }),
      row('g', { st: 'done', amt: null })
    ]
    const sum = build({ kind: 'column', x: 'st', y: { aggregate: 'sum', property: 'amt' } }, odd)
    expect(values(sum)).toEqual([0, 0, 20])
    const average = build({ kind: 'column', x: 'st', y: { aggregate: 'average', property: 'amt' } }, odd)
    expect(values(average)).toEqual([null, null, 10])
    expect(values(build(count('st'), odd))).toEqual([0, 0, 7])
  })

  it('"Other" is aggregated from its rows, not from the folded results', () => {
    // Averages: Ada 15, Bob 30, Cy 40. Keeping the top one folds Ada and Bob: (10 + 20 + 30) / 3.
    const data = build({ kind: 'column', x: 'who', y: { aggregate: 'average', property: 'amt' }, limit: 1 })
    expect(labels(data)).toEqual(['Cy', 'Other'])
    expect(values(data)).toEqual([40, 20])
    const unique = build({ kind: 'column', x: 'who', y: { aggregate: 'count_unique', property: 'st' }, limit: 1 })
    expect(labels(unique)).toEqual(['Ada', 'Other'])
    expect(values(unique)).toEqual([2, 1])
  })
})

describe('series', () => {
  it('splits every category by a second property', () => {
    const data = build(count('st', { series: 'who' }))
    expect(data.split).toBe(true)
    expect(data.seriesLabel).toBe('Owner')
    expect(labels(data)).toEqual(['To do', 'Doing', 'Done'])
    expect(data.series.map((s) => s.label)).toEqual(['Ada', 'Bob', 'Cy'])
    expect(data.series.map((s) => s.values)).toEqual([
      [1, 0, 1],
      [0, 0, 1],
      [0, 0, 1]
    ])
    expect(data.series.map((s) => s.colour)).toEqual(['blue', 'orange', 'pink'])
    expect(data.total).toBe(4)
  })

  it('a multi-select split counts a row in each of its series, once per category total', () => {
    const data = build(count('st', { series: 'tags' }))
    expect(data.series.map((s) => s.label)).toEqual(['Alpha', 'Beta'])
    expect(data.series.map((s) => s.values)).toEqual([
      [1, 0, 1],
      [1, 0, 0]
    ])
    expect(data.rowCount).toBe(2)
    const withEmpty = build(count('st', { series: 'tags', showEmpty: true }))
    expect(withEmpty.series.map((s) => s.label)).toEqual(['Alpha', 'Beta', 'No Tags'])
    expect(withEmpty.series[2]).toMatchObject({ kind: 'empty', colour: 'gray', values: [0, 0, 2, 1] })
    expect(labels(withEmpty)).toEqual(['To do', 'Doing', 'Done', 'No Status'])
  })

  it('never draws more series than there are colours: the smallest fold into "Other"', () => {
    const many: Block[] = []
    for (let owner = 0; owner < 12; owner++) {
      for (let n = 0; n <= owner; n++) many.push(row(`s${owner}-${n}`, { st: 'done', who: `Owner ${owner}` }))
    }
    const data = build(count('st', { series: 'who' }), many)
    expect(data.series).toHaveLength(L.MAX_CHART_SERIES)
    expect(data.series.at(-1)).toMatchObject({ key: L.CHART_OTHER_KEY, kind: 'other', colour: 'gray' })
    // The seven largest (Owner 5..11) are kept; Owner 0..4 have 1+2+3+4+5 rows.
    expect(data.series.slice(0, -1).map((s) => s.label)).toEqual(['Owner 5', 'Owner 6', 'Owner 7', 'Owner 8', 'Owner 9', 'Owner 10', 'Owner 11'])
    expect(data.series.at(-1)?.values).toEqual([0, 0, 15])
    expect(new Set(data.series.map((s) => s.colour)).size).toBe(L.MAX_CHART_SERIES)
  })

  it('cells of "Other" categories and series are merged from their rows', () => {
    const data = build({ kind: 'column', x: 'who', series: 'st', y: { aggregate: 'average', property: 'amt' }, limit: 1 })
    expect(labels(data)).toEqual(['Cy', 'Other'])
    const done = data.series.find((s) => s.label === 'Done')
    // Other × Done: r2 (20) and r3 (30).
    expect(done?.values).toEqual([40, 25])
  })

  it('pies and single figures ignore a split', () => {
    expect(build({ kind: 'pie', x: 'st', series: 'who', y: { aggregate: 'count' } }).split).toBe(false)
    expect(build({ kind: 'number', series: 'who', y: { aggregate: 'count' } }).series).toHaveLength(1)
  })

  it('a running total accumulates along the axis on line and area charts only', () => {
    expect(values(build({ kind: 'line', x: 'due', xDateBucket: 'month', y: { aggregate: 'count' }, cumulative: true }))).toEqual([2, 2, 4])
    expect(values(build({ kind: 'area', x: 'due', xDateBucket: 'month', y: { aggregate: 'sum', property: 'amt' }, cumulative: true }))).toEqual([
      30, 30, 100
    ])
    expect(values(build({ kind: 'column', x: 'due', xDateBucket: 'month', y: { aggregate: 'count' }, cumulative: true }))).toEqual([2, 0, 2])
    const split = build({ kind: 'line', x: 'due', xDateBucket: 'month', series: 'who', y: { aggregate: 'count' }, cumulative: true })
    expect(split.series.map((s) => s.values)).toEqual([
      [2, 2, 2],
      [0, 0, 1],
      [0, 0, 1]
    ])
  })
})

describe('sorting and limits', () => {
  it('manual keeps the option order', () => {
    expect(labels(build(count('st', { sort: 'manual' })))).toEqual(['To do', 'Doing', 'Done'])
  })

  it('by axis, ascending and descending', () => {
    expect(labels(build(count('st', { sort: 'x_asc' })))).toEqual(['Doing', 'Done', 'To do'])
    expect(labels(build(count('st', { sort: 'x_desc' })))).toEqual(['To do', 'Done', 'Doing'])
    expect(labels(build(count('amt', { sort: 'x_desc' })))).toEqual(['$40.00', '$30.00', '$20.00', '$10.00'])
    expect(labels(build(count('due', { sort: 'x_desc' })))).toEqual(['Mar 2024', 'Feb 2024', 'Jan 2024'])
  })

  it('by value, with groups that have no value last in both directions', () => {
    expect(labels(build(count('st', { sort: 'y_desc' })))).toEqual(['Done', 'To do', 'Doing'])
    expect(labels(build(count('st', { sort: 'y_asc' })))).toEqual(['Doing', 'To do', 'Done'])
    const average = (sort: ChartConfig['sort']): string[] => labels(build({ kind: 'column', x: 'st', y: { aggregate: 'average', property: 'amt' }, sort }))
    expect(average('y_desc')).toEqual(['Done', 'To do', 'Doing'])
    expect(average('y_asc')).toEqual(['To do', 'Done', 'Doing'])
  })

  it('"Other" and the empty group stay at the end whatever the sort', () => {
    const data = build(count('who', { limit: 1, showEmpty: true, sort: 'y_asc' }))
    expect(labels(data)).toEqual(['Ada', 'Other', 'No Owner'])
    expect(values(data)).toEqual([2, 2, 1])
  })

  it('limits select options too, keeping the largest', () => {
    const data = build(count('st', { limit: 1 }))
    expect(labels(data)).toEqual(['Done', 'Other'])
    expect(values(data)).toEqual([3, 1])
  })
})

describe('colours', () => {
  it('a single series wears the accent, and categories carry no colour of their own', () => {
    const data = build(count('st'))
    expect(data.series[0].colour).toBe(L.CHART_ACCENT_COLOUR)
    expect(data.categories.every((c) => c.colour === undefined)).toBe(true)
  })

  it('colourful follows the option, not its rank: sorting and limiting do not repaint', () => {
    expect(build(count('st', { palette: 'colourful' })).categories.map((c) => c.colour)).toEqual(['blue', 'orange', 'pink'])
    const sorted = build(count('st', { palette: 'colourful', sort: 'y_desc' }))
    expect(sorted.categories.map((c) => [c.label, c.colour])).toEqual([
      ['Done', 'pink'],
      ['To do', 'blue'],
      ['Doing', 'orange']
    ])
    const limited = build(count('st', { palette: 'colourful', limit: 1 }))
    expect(limited.categories.map((c) => c.colour)).toEqual(['pink', 'gray'])
  })

  it("options uses each select option's own colour, and falls back where there are none", () => {
    expect(build(count('st', { palette: 'options', showEmpty: true })).categories.map((c) => c.colour)).toEqual(['gray', 'blue', 'green', 'gray'])
    expect(build(count('who', { palette: 'options' })).categories.map((c) => c.colour)).toEqual(['blue', 'orange', 'pink'])
    expect(build(count('who', { series: 'st', palette: 'options' })).series.map((s) => s.colour)).toEqual(['gray', 'green'])
    const weird: L.Schema = { ...schema, st: { ...schema.st, options: [{ id: 'todo', name: 'To do', color: 'url(javascript:1)' }] } }
    expect(L.buildChartData(rows, weird, count('st', { palette: 'options' }), undefined, EN).categories[0].colour).toBe('gray')
  })

  it('more categories than colours never cycle hues on bars; dates are never painted per bucket', () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`m${i}`, { who: `Owner ${i}` }))
    expect(build(count('who', { palette: 'colourful' }), many).categories.every((c) => c.colour === undefined)).toBe(true)
    expect(build(count('due', { palette: 'colourful' })).categories.every((c) => c.colour === undefined)).toBe(true)
  })

  it('the fixed order uses each tag colour once and keeps gray for "Other" and "No value"', () => {
    expect(new Set(L.CHART_COLOURS).size).toBe(L.CHART_COLOURS.length)
    expect([...L.CHART_COLOURS, L.CHART_NEUTRAL_COLOUR].sort()).toEqual([...L.OPTION_COLORS].sort())
    expect(L.CHART_COLOURS.slice(0, 2)).toEqual(['blue', 'orange'])
  })
})

describe('pie, donut and number', () => {
  it('a pie only has slices for positive values, each with a colour', () => {
    const data = build({ kind: 'pie', x: 'st', y: { aggregate: 'count' } })
    expect(labels(data)).toEqual(['To do', 'Done'])
    expect(values(data)).toEqual([1, 3])
    expect(data.categories.map((c) => c.colour)).toEqual(['blue', 'pink'])
  })

  it('a pie never has more slices than colours', () => {
    const many: Block[] = []
    for (let owner = 0; owner < 12; owner++) {
      for (let n = 0; n <= owner; n++) many.push(row(`s${owner}-${n}`, { who: `Owner ${owner}` }))
    }
    const data = build({ kind: 'donut', x: 'who', y: { aggregate: 'count' }, limit: 30 }, many)
    expect(data.categories).toHaveLength(L.MAX_PIE_SLICES)
    expect(data.categories.at(-1)).toMatchObject({ kind: 'other', colour: 'gray' })
    expect(values(data).reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(78)
    expect(new Set(data.categories.map((c) => c.colour)).size).toBe(L.MAX_PIE_SLICES)
  })

  it('a number is one figure over every row, with or without an axis configured', () => {
    const data = build({ kind: 'number', x: 'st', y: { aggregate: 'sum', property: 'amt' } })
    expect(data.categories).toEqual([{ key: L.CHART_ALL_KEY, label: 'Sum of Amount' }])
    expect(values(data)).toEqual([100])
    expect(data.total).toBe(100)
    // Rows without a status are part of it: nothing is grouped.
    expect(build({ kind: 'number', y: { aggregate: 'count' } }).total).toBe(5)
    expect(build({ kind: 'number', y: { aggregate: 'count' } }, []).total).toBeNull()
  })
})

describe('empty and malformed input', () => {
  it('reports why there is nothing to draw', () => {
    expect(build(count('st'), [])).toMatchObject({ status: 'no_rows', categories: [], series: [], total: null, rowCount: 0 })
    expect(build(count('st'), [row('a'), row('b')])).toMatchObject({ status: 'no_rows', rowCount: 0 })
    expect(L.buildChartData(rows, {}, count('st'), undefined, EN).status).toBe('no_x')
  })

  it('draws the default chart from a configuration that is not one', () => {
    for (const bad of [null, undefined, 42, 'column', [], { kind: 'bogus' }, { y: 5 }]) {
      const data = build(bad as unknown as ChartConfig)
      expect(data.kind).toBe('column')
      expect(data.xLabel).toBe('Status')
      expect(values(data)).toEqual([1, 0, 3])
    }
  })

  it('survives rows that are not what they should be', () => {
    const broken = [
      row('a', { st: ['done', 'todo'], tags: 'a', amt: {}, due: 'not a day', ok: 'yes' }),
      { ...row('b'), props: {} } as Block,
      { ...row('c'), props: { values: 'nope' } } as unknown as Block,
      { ...row('d'), props: { title: 5, values: { st: 5 } } } as unknown as Block
    ]
    expect(values(build(count('st', { showEmpty: true }), broken))).toEqual([0, 0, 1, 3])
    expect(values(build(count('tags'), broken))).toEqual([1, 0])
    expect(build(count('due'), broken).status).toBe('no_rows')
    expect(build({ kind: 'column', x: 'st', y: { aggregate: 'sum', property: 'amt' } }, broken).total).toBe(0)
  })

  it('never reaches the prototype through a property id', () => {
    for (const id of ['__proto__', 'constructor', 'toString']) {
      const data = build({ kind: 'column', x: id, series: id, y: { aggregate: 'sum', property: id } })
      expect(data.xLabel).toBe('Status')
      expect(data.split).toBe(false)
    }
  })
})

describe('filters', () => {
  it('charts the rows of the view: its filters and the quick search apply first', () => {
    const view: DatabaseView = {
      id: 'v',
      name: 'Chart',
      type: 'chart',
      visibleProperties: ['title'],
      filters: [{ propertyId: 'ok', operator: 'checked' }],
      sorts: [],
      chart: count('st')
    }
    const filtered = L.queryRows(rows, schema, view)
    expect(values(build(L.chartConfigOf(view, schema), filtered))).toEqual([1, 0, 2])
    expect(values(build(L.chartConfigOf(view, schema), L.queryRows(rows, schema, view, 'r5')))).toEqual([0, 0, 1])
  })
})

describe('rows behind a mark', () => {
  const idsAt = (config: ChartConfig, category: string, series: string | null = null, input = rows): string[] => {
    const data = build(config, input)
    return L.chartRowsAt(input, schema, config, data, category, series, undefined, EN).map((r) => r.id)
  }

  it('lists the rows of a category, of "Other" and of the empty group', () => {
    expect(idsAt(count('st'), 'o:done')).toEqual(['r2', 'r3', 'r5'])
    expect(idsAt(count('st'), 'o:doing')).toEqual([])
    expect(idsAt(count('st', { showEmpty: true }), L.CHART_EMPTY_KEY)).toEqual(['r4'])
    expect(idsAt(count('st'), L.CHART_EMPTY_KEY)).toEqual([])
    expect(idsAt(count('who', { limit: 1 }), L.CHART_OTHER_KEY)).toEqual(['r3', 'r5'])
    expect(idsAt(count('tags'), 'o:a')).toEqual(['r1', 'r2'])
    expect(idsAt(count('due'), 'd:2024-03-01')).toEqual(['r3', 'r5'])
  })

  it('narrows to one series of a split chart', () => {
    expect(idsAt(count('st', { series: 'who' }), 'o:done', 't:Ada')).toEqual(['r2'])
    expect(idsAt(count('st', { series: 'who' }), 'o:done')).toEqual(['r2', 'r3', 'r5'])
    expect(idsAt(count('st', { series: 'tags', showEmpty: true }), 'o:done', L.CHART_EMPTY_KEY)).toEqual(['r3', 'r5'])
  })

  it('a single figure is backed by every row', () => {
    expect(idsAt({ kind: 'number', y: { aggregate: 'count' } }, L.CHART_ALL_KEY)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
  })

  it('agrees with the counts of the chart', () => {
    for (const config of [count('st', { showEmpty: true }), count('who', { limit: 2 }), count('due', { xDateBucket: 'week' }), count('amt')]) {
      const data = build(config)
      data.categories.forEach((category, index) => {
        expect(L.chartRowsAt(rows, schema, config, data, category.key, null, undefined, EN)).toHaveLength(values(data)[index] ?? 0)
      })
    }
  })
})

describe('configuration repair', () => {
  it('defaults: the first select, else the first date by month, else the title; a count as columns', () => {
    expect(L.defaultChartConfig(schema)).toEqual({ kind: 'column', x: 'st', y: { aggregate: 'count' } })
    const dated: L.Schema = { title: schema.title, due: schema.due, amt: schema.amt }
    expect(L.defaultChartConfig(dated)).toEqual({ kind: 'column', x: 'due', xDateBucket: 'month', y: { aggregate: 'count' } })
    expect(L.defaultChartConfig({ title: schema.title })).toEqual({ kind: 'column', x: 'title', y: { aggregate: 'count' } })
    expect(L.defaultChartConfig({})).toEqual({ kind: 'column', y: { aggregate: 'count' } })
  })

  it('returns a clean configuration by reference', () => {
    const clean: ChartConfig = { kind: 'line', x: 'due', xDateBucket: 'week', y: { aggregate: 'sum', property: 'amt' }, series: 'st', limit: 5 }
    expect(L.normalizeChartConfig(clean, schema)).toBe(clean)
    expect(L.normalizeChartConfig(L.defaultChartConfig(schema), schema)).toEqual(L.defaultChartConfig(schema))
  })

  it('repairs dangling and wrong-typed references to sensible defaults', () => {
    expect(L.normalizeChartConfig({ kind: 'bar', x: 'gone', y: { aggregate: 'count' } }, schema)).toEqual({ kind: 'bar', x: 'st', y: { aggregate: 'count' } })
    // A sum needs a number or a checkbox: the first one there is.
    expect(L.normalizeChartConfig({ kind: 'bar', x: 'st', y: { aggregate: 'sum', property: 'who' } }, schema).y).toEqual({ aggregate: 'sum', property: 'amt' })
    expect(L.normalizeChartConfig({ kind: 'bar', x: 'st', y: { aggregate: 'sum' } }, schema).y).toEqual({ aggregate: 'sum', property: 'amt' })
    expect(L.normalizeChartConfig({ kind: 'bar', x: 'st', y: { aggregate: 'percent_checked', property: 'amt' } }, schema).y).toEqual({
      aggregate: 'percent_checked',
      property: 'ok'
    })
    expect(L.normalizeChartConfig({ kind: 'bar', x: 'st', y: { aggregate: 'count_unique' } }, schema).y).toEqual({ aggregate: 'count_unique', property: 'title' })
    // Nothing to sum at all: a count.
    expect(L.normalizeChartConfig({ kind: 'bar', x: 'st', y: { aggregate: 'median', property: 'amt' } }, { title: schema.title, st: schema.st }).y).toEqual({
      aggregate: 'count'
    })
    // A count takes no property.
    expect(L.normalizeChartConfig({ kind: 'bar', x: 'st', y: { aggregate: 'count', property: 'amt' } }, schema).y).toEqual({ aggregate: 'count' })
  })

  it('drops a series that is gone or that repeats the axis, and keeps a date bucket on date axes only', () => {
    expect(L.normalizeChartConfig({ kind: 'column', x: 'st', series: 'st', y: { aggregate: 'count' } }, schema).series).toBeUndefined()
    expect(L.normalizeChartConfig({ kind: 'column', x: 'st', series: 'gone', y: { aggregate: 'count' } }, schema).series).toBeUndefined()
    expect(L.normalizeChartConfig({ kind: 'column', x: 'st', xDateBucket: 'week', y: { aggregate: 'count' } }, schema).xDateBucket).toBeUndefined()
    expect(L.normalizeChartConfig({ kind: 'column', x: 'due', y: { aggregate: 'count' } }, schema).xDateBucket).toBe('month')
    expect(L.normalizeChartConfig({ kind: 'column', x: 'made', xDateBucket: 'year', y: { aggregate: 'count' } }, schema).xDateBucket).toBe('year')
  })

  it('a number needs no axis, but keeps a valid one', () => {
    expect(L.normalizeChartConfig({ kind: 'number', y: { aggregate: 'count' } }, schema)).toEqual({ kind: 'number', y: { aggregate: 'count' } })
    expect(L.normalizeChartConfig({ kind: 'number', x: 'gone', y: { aggregate: 'count' } }, schema).x).toBeUndefined()
    expect(L.normalizeChartConfig({ kind: 'number', x: 'who', y: { aggregate: 'count' } }, schema).x).toBe('who')
  })

  it('drops unknown keys and clamps numbers', () => {
    const out = L.normalizeChartConfig(
      { kind: 'pie', x: 'st', y: { aggregate: 'count', extra: 1 }, limit: 9999, height: 3, palette: 'neon', sort: 'sideways', stacked: 'yes', evil: '<script>' },
      schema
    )
    expect(out).toEqual({ kind: 'pie', x: 'st', y: { aggregate: 'count' }, limit: 50, height: 120 })
  })

  it('view normalisation gives every chart view a configuration that fits the schema', () => {
    const views = L.sanitizeViews(
      [
        { id: 'a', name: 'Chart', type: 'chart', visibleProperties: ['title'], filters: [], sorts: [] },
        { id: 'b', name: 'Chart 2', type: 'chart', visibleProperties: ['title'], filters: [], sorts: [], chart: { kind: 'line', x: 'gone', y: { aggregate: 'sum', property: 'amt' } } }
      ] as DatabaseView[],
      schema
    )
    expect(views[0].chart).toEqual({ kind: 'column', x: 'st', y: { aggregate: 'count' } })
    expect(views[1].chart).toEqual({ kind: 'line', x: 'st', y: { aggregate: 'sum', property: 'amt' } })
  })

  it('a clean chart view keeps its identity, so nothing is written back', () => {
    const view: DatabaseView = {
      id: 'a',
      name: 'Chart',
      type: 'chart',
      visibleProperties: ['title'],
      filters: [],
      sorts: [],
      chart: { kind: 'donut', x: 'st', y: { aggregate: 'count' }, showLegend: false }
    }
    expect(L.sanitizeViews([view], schema)[0]).toBe(view)
    const props = { schema, views: [view] }
    expect(L.ensureDatabaseProps(props).changed).toBe(false)
  })

  it('a view of another type keeps a well-formed chart configuration and loses a malformed one', () => {
    // What a build without charts leaves behind when it shows a chart view as a table.
    const downgraded = {
      id: 'a',
      name: 'Chart',
      type: 'table',
      visibleProperties: ['title'],
      filters: [],
      sorts: [],
      chart: { kind: 'line', x: 'due', xDateBucket: 'week', y: { aggregate: 'sum', property: 'amt' } }
    } as DatabaseView
    expect(L.sanitizeViews([downgraded], schema)[0]).toBe(downgraded)
    const broken = { ...downgraded, chart: { kind: 'nope' } } as unknown as DatabaseView
    expect(L.sanitizeViews([broken], schema)[0]).not.toHaveProperty('chart')
  })

  it('an unknown view type still degrades to a table without losing what it carries', () => {
    const future = { id: 'f', name: 'Timeline', type: 'timeline', visibleProperties: ['title'], filters: [], sorts: [], chart: { kind: 'bar', x: 'st', y: { aggregate: 'count' } } }
    const [view] = L.sanitizeViews([future as unknown as DatabaseView], schema)
    expect(view.type).toBe('table')
    expect(view.chart).toEqual({ kind: 'bar', x: 'st', y: { aggregate: 'count' } })
  })

  it('new chart views start with the defaults', () => {
    const result = L.addView(schema, [], 'chart')
    expect(result.view).toMatchObject({ type: 'chart', name: 'Chart', chart: { kind: 'column', x: 'st', y: { aggregate: 'count' } } })
    expect(result.schema).toBe(schema)
    expect(L.VIEW_TYPES).toContain('chart')
  })

  it('deleting the property a chart is built on repairs the chart instead of breaking it', () => {
    const view = L.createDefaultView('chart', schema, 'v')
    const withSeries: DatabaseView = { ...view, chart: { kind: 'column', x: 'st', series: 'who', y: { aggregate: 'sum', property: 'amt' } } }
    const result = L.deleteProperty(schema, [withSeries], 'who')
    expect(result.views[0].chart).toEqual({ kind: 'column', x: 'st', y: { aggregate: 'sum', property: 'amt' } })
    const noAxis = L.deleteProperty(schema, [withSeries], 'st')
    expect(noAxis.views[0].chart?.x).toBe('due')
    expect(noAxis.views[0].chart?.xDateBucket).toBe('month')
  })

  it('a linked view of a database can start as a chart', () => {
    const source: Block = { ...row('src'), type: 'database', parentId: null, props: { schema, views: [] } }
    const props = L.linkedViewProps(source, { get: (id) => (id === 'src' ? source : undefined) }, () => 'new-id', 'chart')
    expect(props).toEqual({
      sourceId: 'src',
      views: [{ id: 'new-id', name: 'Chart', type: 'chart', visibleProperties: ['title'], filters: [], sorts: [], chart: { kind: 'column', x: 'st', y: { aggregate: 'count' } } }]
    })
  })
})

describe('text renderings', () => {
  it('formats values like the property they come from', () => {
    const currency: L.ChartYFormat = { numberFormat: 'currency', integer: false }
    const number: L.ChartYFormat = { numberFormat: 'number', integer: false }
    expect(L.formatChartValue(1234.5, currency, EN)).toBe('$1,234.50')
    expect(L.formatChartValue(1234.567, number, EN)).toBe('1,234.57')
    expect(L.formatChartValue(3, { numberFormat: 'number', integer: true }, EN)).toBe('3')
    expect(L.formatChartValue(0.4567, { numberFormat: 'percent', integer: false }, EN)).toBe('45.7%')
    expect(L.formatChartValue(null, number, EN)).toBe('–')
    expect(L.formatChartValue(NaN, number, EN)).toBe('–')
    expect(L.formatChartValue(1234.5, number, { locale: 'pt-BR' })).toBe('1.234,5')
    expect(L.formatChartValue(1234.5, currency, { locale: 'pt-BR' })).toMatch(/^R\$\s1\.234,50$/)
  })

  it('abbreviates large numbers on axes only', () => {
    const number: L.ChartYFormat = { numberFormat: 'number', integer: true }
    expect(L.formatChartValue(1_250_000, number, EN, true)).toBe('1.3M')
    expect(L.formatChartValue(12_000, number, EN, true)).toBe('12K')
    expect(L.formatChartValue(9_999, number, EN, true)).toBe('9,999')
    expect(L.formatChartValue(12_000, { numberFormat: 'currency', integer: false }, EN, true)).toBe('$12K')
  })

  it('formats the ticks of an axis as one set', () => {
    const currency: L.ChartYFormat = { numberFormat: 'currency', integer: false }
    const number: L.ChartYFormat = { numberFormat: 'number', integer: false }
    // All abbreviated or none: never "$8,000.00" next to "$10K".
    expect(L.formatChartTicks([0, 2000, 4000, 6000, 8000, 10000, 12000], currency, EN)).toEqual(['$0', '$2K', '$4K', '$6K', '$8K', '$10K', '$12K'])
    expect(L.formatChartTicks([0, 2500, 5000, 7500, 10000, 12500], number, EN)).toEqual(['0', '2.5K', '5K', '7.5K', '10K', '12.5K'])
    // Whole ticks carry no ".00"; fractional ones keep their cents.
    expect(L.formatChartTicks([0, 100, 200], currency, EN)).toEqual(['$0', '$100', '$200'])
    expect(L.formatChartTicks([0, 0.5, 1, 1.5], currency, EN)).toEqual(['$0.00', '$0.50', '$1.00', '$1.50'])
    expect(L.formatChartTicks([0, 0.25, 0.5], number, EN)).toEqual(['0', '0.25', '0.5'])
    expect(L.formatChartTicks([0, 0.2, 0.4, 1], { numberFormat: 'percent', integer: false }, EN)).toEqual(['0%', '20%', '40%', '100%'])
    expect(L.formatChartTicks([-20000, 0, 20000], number, EN)).toEqual(['-20K', '0', '20K'])
    expect(L.formatChartTicks([0, 1000, 2000], number, { locale: 'pt-BR' })).toEqual(['0', '1.000', '2.000'])
    expect(L.formatChartTicks([], number, EN)).toEqual([])
    expect(L.formatChartTicks([0, NaN, 1], number, EN)).toEqual(['0', '', '1'])
  })

  it('shares', () => {
    expect(L.formatShare(1, 4, EN)).toBe('25%')
    expect(L.formatShare(1, 3, EN)).toBe('33.3%')
    expect(L.formatShare(1, 0, EN)).toBe('')
    expect(L.formatShare(null, 4, EN)).toBe('')
    expect(L.formatShare(-1, 4, EN)).toBe('')
  })

  it('captions', () => {
    expect(L.chartCaption(build(count('st')))).toBe('Count by Status')
    expect(L.chartCaption(build({ kind: 'column', x: 'due', series: 'who', y: { aggregate: 'sum', property: 'amt' } }))).toBe('Sum of Amount by Due and Owner')
    expect(L.chartCaption(build({ kind: 'number', y: { aggregate: 'average', property: 'amt' } }))).toBe('Average Amount')
    expect(L.chartCaption(build({ kind: 'line', x: 'due', y: { aggregate: 'count' }, cumulative: true }))).toBe('Count by Due, running total')
    expect(build({ kind: 'column', x: 'due', y: { aggregate: 'count' }, cumulative: true }).cumulative).toBeUndefined()
  })

  it('the aggregated table, formatted and raw', () => {
    const data = build({ kind: 'column', x: 'st', y: { aggregate: 'average', property: 'amt' } })
    expect(L.chartTable(data, EN)).toEqual({
      header: ['Status', 'Average Amount'],
      rows: [
        ['To do', '$10.00'],
        ['Doing', ''],
        ['Done', '$30.00']
      ]
    })
    expect(L.chartToTSV(data, EN)).toBe('Status\tAverage Amount\nTo do\t10\nDoing\t\nDone\t30')
    const split = build(count('st', { series: 'who' }))
    expect(L.chartToTSV(split, EN)).toBe('Status\tAda\tBob\tCy\nTo do\t1\t0\t0\nDoing\t0\t0\t0\nDone\t1\t1\t1')
    expect(L.chartTable(build({ kind: 'number', y: { aggregate: 'count' } }), EN)).toEqual({ header: ['Measure', 'Value'], rows: [['Count', '5']] })
  })

  it('tabs and line breaks in labels cannot break the TSV', () => {
    const data = build(count('who'), [row('a', { who: 'A\tB' }), row('b', { who: 'C\nD' })])
    expect(L.chartToTSV(data, EN).split('\n')).toEqual(['Owner\tCount', 'A B\t1', 'C D\t1'])
  })

  it('summaries say what the chart shows', () => {
    expect(L.chartSummary(build(count('st')), EN)).toBe('Column chart. Count by Status. 3 categories: To do 1, Doing 0, Done 3.')
    expect(L.chartSummary(build(count('st', { series: 'who' })), EN)).toBe('Column chart. Count by Status and Owner. 3 categories, 3 series: Ada, Bob, Cy.')
    expect(L.chartSummary(build({ kind: 'number', y: { aggregate: 'sum', property: 'amt' } }), EN)).toBe('Sum of Amount: $100.00.')
    expect(L.chartSummary(build(count('st'), []), EN)).toBe('Column chart. Count by Status. There is no data to show.')
    const many = Array.from({ length: 20 }, (_, i) => row(`m${i}`, { who: `O${i}` }))
    expect(L.chartSummary(build(count('who'), many), EN)).toMatch(/^Column chart\. Count by Owner\. 20 categories: O0 1, .*O7 1 and 12 more\.$/)
  })
})

describe('scale', () => {
  it('aggregates 20,000 rows in a couple of passes', () => {
    const big: Block[] = []
    const statuses = ['todo', 'doing', 'done']
    for (let i = 0; i < 20_000; i++) {
      const month = String((i % 12) + 1).padStart(2, '0')
      big.push(row(`b${i}`, { st: statuses[i % 3], amt: i % 97, who: `Owner ${i % 40}`, due: { start: `202${i % 4}-${month}-15` }, ok: i % 2 === 0 }))
    }
    const started = performance.now()
    const data = build({ kind: 'column', x: 'due', xDateBucket: 'month', series: 'st', y: { aggregate: 'median', property: 'amt' } }, big)
    const byOwner = build(count('who', { sort: 'y_desc', limit: 10 }), big)
    const elapsed = performance.now() - started
    expect(data.categories).toHaveLength(48)
    expect(data.series).toHaveLength(3)
    expect(data.rowCount).toBe(20_000)
    expect(values(byOwner).reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(20_000)
    expect(byOwner.categories).toHaveLength(11)
    // Generous: a slow CI machine does this in well under a second.
    expect(elapsed).toBeLessThan(3000)
  })
})
