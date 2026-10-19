import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHART_MAX_HEIGHT,
  CHART_MAX_LIMIT,
  CHART_MIN_HEIGHT,
  DEFAULT_CHART_CONFIG,
  sanitizeChartConfig,
  sanitizeViewCharts
} from '../shared/chart'
import type { Block, BlockProps, ChartConfig, DatabaseView } from '../shared/types'
import type { Repository } from './db/repository'
import { openTestRepository } from './db/testing'
import { pageToMarkdown } from './markdown'
import * as arg from './validate'

let repo: Repository

beforeEach(() => {
  repo = openTestRepository()
})

const chartView = (chart: unknown, more: Partial<DatabaseView> = {}): DatabaseView =>
  ({
    id: 'v-chart',
    name: 'By status',
    type: 'chart',
    visibleProperties: ['title'],
    filters: [],
    sorts: [],
    chart,
    ...more
  }) as DatabaseView

const schema: BlockProps['schema'] = {
  title: { id: 'title', name: 'Name', type: 'title' },
  st: {
    id: 'st',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'todo', name: 'To do', color: 'gray' },
      { id: 'done', name: 'Done', color: 'green' }
    ]
  },
  pts: { id: 'pts', name: 'Points', type: 'number' },
  due: { id: 'due', name: 'Due', type: 'date' }
}

function database(views: DatabaseView[], parentId: string | null = null): Block {
  const db = repo.create({ type: 'database', parentId, props: { title: [['Tasks']], schema, views } })
  const add = (title: string, values: BlockProps['values']): Block =>
    repo.create({ type: 'page', parentId: db.id, props: { title: [[title]], values } })
  add('Write | report', { st: 'done', pts: 3, due: { start: '2024-01-15' } })
  add('Call Ada', { st: 'done', pts: 5, due: { start: '2024-03-02' } })
  add('Plan', { st: 'todo', pts: 2, due: { start: '2024-03-20' } })
  add('Idea', { pts: 1 })
  return repo.get(db.id)!
}

describe('chart configuration shape (shared by main, renderer and clipboard)', () => {
  it('accepts a full configuration unchanged', () => {
    const full: ChartConfig = {
      kind: 'area',
      x: 'due',
      xDateBucket: 'quarter',
      y: { aggregate: 'median', property: 'pts' },
      series: 'st',
      sort: 'y_desc',
      limit: 7,
      stacked: true,
      showEmpty: false,
      showValues: true,
      showLegend: false,
      showGrid: true,
      cumulative: true,
      palette: 'options',
      height: 420
    }
    expect(sanitizeChartConfig(full)).toEqual(full)
    expect(JSON.stringify(sanitizeChartConfig(full))).toBe(JSON.stringify(full))
  })

  it('is not a configuration without a known kind', () => {
    for (const bad of [null, undefined, 3, 'pie', [], {}, { kind: 'radar' }, { kind: 5 }, { kind: ['pie'] }]) {
      expect(sanitizeChartConfig(bad)).toBeUndefined()
    }
  })

  it('drops unknown keys, unknown enum members and wrong types', () => {
    expect(
      sanitizeChartConfig({
        kind: 'bar',
        x: 5,
        xDateBucket: 'decade',
        y: { aggregate: 'mode', property: ['a'], more: true },
        series: '',
        sort: 'random',
        palette: 'neon',
        stacked: 1,
        showEmpty: 'true',
        showValues: null,
        cumulative: {},
        limit: '5',
        height: NaN,
        onload: 'alert(1)',
        __proto__: { polluted: true }
      })
    ).toEqual({ kind: 'bar', y: { aggregate: 'count' } })
    expect(sanitizeChartConfig({ kind: 'bar', y: 'count' })).toEqual({ kind: 'bar', y: { aggregate: 'count' } })
    expect(sanitizeChartConfig({ kind: 'bar' })).toEqual({ kind: 'bar', y: { aggregate: 'count' } })
  })

  it('clamps and rounds numbers', () => {
    expect(sanitizeChartConfig({ kind: 'bar', limit: 0, height: 1 })).toMatchObject({ limit: 1, height: CHART_MIN_HEIGHT })
    expect(sanitizeChartConfig({ kind: 'bar', limit: 1e9, height: 1e9 })).toMatchObject({
      limit: CHART_MAX_LIMIT,
      height: CHART_MAX_HEIGHT
    })
    expect(sanitizeChartConfig({ kind: 'bar', limit: 4.6, height: 300.4 })).toMatchObject({ limit: 5, height: 300 })
    expect(sanitizeChartConfig({ kind: 'bar', limit: Infinity, height: -Infinity })).toEqual({ kind: 'bar', y: { aggregate: 'count' } })
  })

  it('refuses property ids that could reach the prototype or are absurdly long', () => {
    const out = sanitizeChartConfig({ kind: 'bar', x: '__proto__', series: 'constructor', y: { aggregate: 'sum', property: 'toString' } })
    expect(out).toEqual({ kind: 'bar', y: { aggregate: 'sum' } })
    expect(sanitizeChartConfig({ kind: 'bar', x: 'x'.repeat(201) })?.x).toBeUndefined()
    expect(sanitizeChartConfig({ kind: 'bar', x: 'x'.repeat(200) })?.x).toHaveLength(200)
  })

  it('never shares objects with its input', () => {
    const raw = { kind: 'bar', y: { aggregate: 'sum', property: 'pts' } }
    const out = sanitizeChartConfig(raw)!
    expect(out.y).not.toBe(raw.y)
    out.y.aggregate = 'count'
    expect(raw.y.aggregate).toBe('sum')
    expect(sanitizeChartConfig({ kind: 'bar' })!.y).not.toBe(DEFAULT_CHART_CONFIG.y)
  })

  it('sanitizeViewCharts returns its input when every chart is already clean', () => {
    const views = [chartView({ kind: 'pie', x: 'st', y: { aggregate: 'count' } }), { id: 't', type: 'table' }]
    expect(sanitizeViewCharts(views)).toBe(views)
    expect(sanitizeViewCharts(undefined)).toBeUndefined()
    expect(sanitizeViewCharts('views')).toBe('views')
    const odd = [null, 5, 'x', []]
    expect(sanitizeViewCharts(odd)).toBe(odd)
  })

  it('sanitizeViewCharts repairs chart views and cleans other views, leaving the rest of each view alone', () => {
    const views = [
      chartView(undefined),
      chartView(
        { kind: 'line', x: 'due', bogus: 1, y: { aggregate: 'count' } },
        { id: 'v2', filters: [{ propertyId: 'st', operator: 'is_empty' }] }
      ),
      { id: 't1', type: 'table', chart: { kind: 'bar', y: { aggregate: 'count' } }, extra: 'kept' },
      { id: 't2', type: 'table', chart: 'nope' }
    ]
    const out = sanitizeViewCharts(views) as Record<string, unknown>[]
    expect(out).not.toBe(views)
    expect(out[0].chart).toEqual({ kind: 'column', y: { aggregate: 'count' } })
    expect(out[1]).toEqual({ ...views[1], chart: { kind: 'line', x: 'due', y: { aggregate: 'count' } } })
    expect(out[2]).toBe(views[2])
    expect(out[3]).toEqual({ id: 't2', type: 'table' })
  })
})

describe('repository: chart views are validated before they are stored', () => {
  it('stores a well-formed chart view as it was sent', () => {
    const chart: ChartConfig = { kind: 'donut', x: 'st', y: { aggregate: 'sum', property: 'pts' }, showLegend: false, height: 240 }
    const db = database([chartView(chart)])
    expect(db.props.views).toEqual([chartView(chart)])
  })

  it('rebuilds a malformed configuration on create', () => {
    const db = database([
      chartView({ kind: 'line', x: 'due', y: { aggregate: 'sum', property: 'pts', evil: 1 }, limit: 1e12, script: '<img onerror=1>' })
    ])
    expect(db.props.views![0].chart).toEqual({ kind: 'line', x: 'due', y: { aggregate: 'sum', property: 'pts' }, limit: CHART_MAX_LIMIT })
  })

  it('gives a chart view without a usable configuration the default one', () => {
    for (const chart of [undefined, null, 'x', { kind: 'radar' }]) {
      const db = database([chartView(chart)])
      expect(db.props.views![0]).toMatchObject({ type: 'chart', chart: { kind: 'column', y: { aggregate: 'count' } } })
    }
  })

  it('validates on update and inside a batch', () => {
    const db = database([chartView({ kind: 'bar', x: 'st', y: { aggregate: 'count' } })])
    const updated = repo.update(db.id, {
      props: { views: [chartView({ kind: 'bar', x: 'st', y: { aggregate: 'count' }, height: -5, nope: true })] }
    })
    expect(updated.props.views![0].chart).toEqual({ kind: 'bar', x: 'st', y: { aggregate: 'count' }, height: CHART_MIN_HEIGHT })
    const [applied] = repo.apply([{ op: 'update', id: db.id, patch: { props: { views: [chartView({ kind: 'pie', palette: 'neon' })] } } }])
    expect(applied.props.views![0].chart).toEqual({ kind: 'pie', y: { aggregate: 'count' } })
    expect(repo.get(db.id)!.props.views![0].chart).toEqual({ kind: 'pie', y: { aggregate: 'count' } })
  })

  it('validates the views of a linked view, which are its own', () => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Home']] } })
    const db = database([chartView({ kind: 'bar', x: 'st', y: { aggregate: 'count' } })], page.id)
    const linked = repo.create({
      type: 'database',
      parentId: page.id,
      props: { sourceId: db.id, views: [chartView({ kind: 'number', y: { aggregate: 'sum', property: 'pts' }, stacked: 'yes' })] }
    })
    expect(linked.props.views![0].chart).toEqual({ kind: 'number', y: { aggregate: 'sum', property: 'pts' } })
    expect(linked.props.schema).toBeUndefined()
  })

  it('does not touch views that have nothing to do with charts, nor other props', () => {
    const table: DatabaseView = {
      id: 't',
      name: 'Table',
      type: 'table',
      visibleProperties: ['title', 'st'],
      filters: [],
      sorts: [],
      propertyWidths: { st: 200 }
    }
    const db = database([table])
    expect(db.props.views).toEqual([table])
    expect(db.props.schema).toEqual(schema)
    const text = repo.create({
      type: 'text',
      parentId: db.parentId ?? repo.create({ type: 'page', parentId: null }).id,
      props: { title: [['x']], views: 'not views' } as unknown as BlockProps
    })
    expect((text.props as { views?: unknown }).views).toBe('not views')
  })

  it('keeps a well-formed configuration on a view that is shown as something else', () => {
    const chart: ChartConfig = { kind: 'line', x: 'due', xDateBucket: 'week', y: { aggregate: 'count' } }
    const db = database([{ ...chartView(chart), type: 'table' }])
    expect(db.props.views![0]).toMatchObject({ type: 'table', chart })
    const cleaned = database([{ ...chartView({ kind: 'nope' }), type: 'table' }])
    expect(cleaned.props.views![0]).not.toHaveProperty('chart')
  })
})

describe('markdown export of a chart view', () => {
  const exported = (views: DatabaseView[]): string => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Report']] } })
    database(views, page.id)
    return pageToMarkdown(repo, page.id).markdown
  }

  it('writes the aggregated table under a caption', () => {
    const markdown = exported([chartView({ kind: 'column', x: 'st', y: { aggregate: 'count' } })])
    expect(markdown).toContain(
      [
        '**Tasks**',
        '',
        '*By status – Column chart: Count by Status*',
        '',
        '| Status | Count |',
        '| --- | ---: |',
        '| To do | 1 |',
        '| Done | 2 |'
      ].join('\n')
    )
    // The rows themselves are not listed.
    expect(markdown).not.toContain('Call Ada')
  })

  it('applies the filters of the view, the aggregate and the empty group', () => {
    const markdown = exported([
      chartView(
        { kind: 'bar', x: 'st', y: { aggregate: 'sum', property: 'pts' }, showEmpty: true },
        { filters: [{ propertyId: 'pts', operator: 'gt', value: 1 }] }
      )
    ])
    expect(markdown).toContain(
      [
        '*By status – Bar chart: Sum of Points by Status*',
        '',
        '| Status | Sum of Points |',
        '| --- | ---: |',
        '| To do | 2 |',
        '| Done | 8 |'
      ].join('\n')
    )
    expect(markdown).not.toContain('No Status')
    const unfiltered = exported([chartView({ kind: 'bar', x: 'st', y: { aggregate: 'sum', property: 'pts' }, showEmpty: true })])
    expect(unfiltered).toContain('| No Status | 1 |')
  })

  it('writes one column per series and a continuous date axis', () => {
    const markdown = exported([chartView({ kind: 'line', x: 'due', xDateBucket: 'month', series: 'st', y: { aggregate: 'count' } })])
    expect(markdown).toContain('*By status – Line chart: Count by Due and Status*')
    expect(markdown).toContain('| Due | To do | Done |')
    expect(markdown).toContain('| --- | ---: | ---: |')
    // Month labels follow the locale of the machine; the numbers do not.
    const all = markdown.split('\n')
    const body = all.slice(all.indexOf('| --- | ---: | ---: |') + 1).filter((line) => line.startsWith('|'))
    expect(body.map((line) => line.replace(/^\| [^|]+ /, ''))).toEqual(['| 0 | 1 |', '| 0 | 0 |', '| 1 | 1 |'])
  })

  it('writes a single figure as a two-cell table', () => {
    const markdown = exported([chartView({ kind: 'number', y: { aggregate: 'sum', property: 'pts' } }, { name: 'Total' })])
    expect(markdown).toContain(
      ['*Total – Number chart: Sum of Points*', '', '| Measure | Value |', '| --- | ---: |', '| Sum of Points | 11 |'].join('\n')
    )
  })

  it('escapes markdown in names and labels', () => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Report']] } })
    const db = repo.create({
      type: 'database',
      parentId: page.id,
      props: {
        title: [['T']],
        schema: { title: { id: 'title', name: 'Name', type: 'title' }, who: { id: 'who', name: 'Own|er *x*', type: 'text' } },
        views: [chartView({ kind: 'column', x: 'who', y: { aggregate: 'count' } }, { name: '_View_' })]
      }
    })
    repo.create({ type: 'page', parentId: db.id, props: { title: [['a']], values: { who: 'A|B\nC' } } })
    const markdown = pageToMarkdown(repo, page.id).markdown
    expect(markdown).toContain('*\\_View\\_ – Column chart: Count by Own|er \\*x\\**')
    expect(markdown).toContain('| Own\\|er \\*x\\* | Count |')
    expect(markdown).toContain('| A\\|B C | 1 |')
  })

  it('a malformed stored configuration exports the default chart instead of failing', () => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Report']] } })
    const db = database([chartView({ kind: 'column', x: 'gone', y: { aggregate: 'sum', property: 'gone' } })], page.id)
    expect(repo.get(db.id)!.props.views![0].chart).toEqual({ kind: 'column', x: 'gone', y: { aggregate: 'sum', property: 'gone' } })
    const markdown = pageToMarkdown(repo, page.id).markdown
    // The axis falls back to the default one, the value to the first property that can be summed.
    expect(markdown).toContain('Column chart: Sum of Points by Status*')
    expect(markdown).toContain('| Done | 8 |')
  })

  it('a linked chart view exports its source rows through its own chart, and other views still export as tables', () => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Report']] } })
    const db = database([{ id: 't', name: 'Table', type: 'table', visibleProperties: ['title', 'st'], filters: [], sorts: [] }], page.id)
    repo.create({
      type: 'database',
      parentId: page.id,
      props: {
        sourceId: db.id,
        title: [['Share']],
        views: [chartView({ kind: 'pie', x: 'st', y: { aggregate: 'count' } }, { name: 'Split' })]
      }
    })
    const markdown = pageToMarkdown(repo, page.id).markdown
    expect(markdown).toContain('| Name | Status |')
    expect(markdown).toContain('| Write \\| report | Done |')
    expect(markdown).toContain(
      [
        '**Share**',
        '',
        '*Split – Pie chart: Count by Status*',
        '',
        '| Status | Count |',
        '| --- | ---: |',
        '| To do | 1 |',
        '| Done | 2 |'
      ].join('\n')
    )
  })
})

describe('markdown export of a calculations view', () => {
  it('writes each figure over the rows the filters let through', () => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Report']] } })
    const calcs = [
      { id: 'a', name: 'Points', formula: 'sum(Points)' },
      { id: 'b', name: 'Rows | all', formula: 'count()' },
      { id: 'c', name: '', formula: 'sum(Nope)' }
    ]
    database(
      [
        {
          id: 'v',
          name: 'Figures',
          type: 'calc',
          visibleProperties: ['title'],
          filters: [{ propertyId: 'pts', operator: 'gt', value: 1 }],
          sorts: [],
          calcs
        }
      ],
      page.id
    )
    const markdown = pageToMarkdown(repo, page.id).markdown
    expect(markdown).toContain(
      [
        '**Tasks**',
        '',
        '*Figures*',
        '',
        '| Calculation | Value |',
        '| --- | ---: |',
        '| Points | 10 |',
        '| Rows \\| all | 3 |',
        '| Untitled | — |'
      ].join('\n')
    )
    expect(markdown).not.toContain('Call Ada')
  })
})

describe('ipc: bytes of a generated image', () => {
  const png = (extra = 64): Uint8Array => {
    const bytes = new Uint8Array(24 + extra)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    return bytes
  }

  it('accepts a PNG as an ArrayBuffer or a typed array, and returns a copy', () => {
    const bytes = png()
    const fromView = arg.pngBytes(bytes)
    expect(fromView).toEqual(bytes)
    expect(fromView.buffer).not.toBe(bytes.buffer)
    expect(arg.pngBytes(bytes.buffer)).toEqual(bytes)
    // A view into a larger buffer is read through its own window.
    const padded = new Uint8Array(200)
    padded.set(bytes, 50)
    expect(arg.pngBytes(padded.subarray(50, 50 + bytes.length))).toEqual(bytes)
    expect(arg.pngBytes(new DataView(bytes.buffer))).toEqual(bytes)
  })

  it('rejects anything that is not binary data', () => {
    for (const bad of [undefined, null, '\x89PNG', [0x89, 0x50], { length: 8 }, 42, { type: 'Buffer', data: [1] }]) {
      expect(() => arg.pngBytes(bad)).toThrow('Invalid image data')
    }
  })

  it('rejects other formats, truncated files and a signature without its header chunk', () => {
    const jpeg = new Uint8Array(64)
    jpeg.set([0xff, 0xd8, 0xff, 0xe0])
    expect(() => arg.pngBytes(jpeg)).toThrow('not a PNG')
    expect(() => arg.pngBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).toThrow(
      'not a PNG'
    )
    expect(() => arg.pngBytes(png().subarray(0, 16))).toThrow('not a PNG')
    expect(() => arg.pngBytes(new Uint8Array(0))).toThrow('not a PNG')
    const noHeader = png()
    noHeader[12] = 0x50
    expect(() => arg.pngBytes(noHeader)).toThrow('not a PNG')
    const almost = png()
    almost[7] = 0x0b
    expect(() => arg.pngBytes(almost)).toThrow('not a PNG')
  })

  it('caps the size', () => {
    expect(() => arg.pngBytes(png(100), 64)).toThrow('too large')
    expect(arg.pngBytes(png(40), 64)).toHaveLength(64)
    expect(arg.LIMITS.generatedImageBytes).toBe(20 * 1024 * 1024)
    expect(() => arg.pngBytes(new Uint8Array(arg.LIMITS.generatedImageBytes + 1))).toThrow('The image is too large (max 20 MB)')
  })
})
