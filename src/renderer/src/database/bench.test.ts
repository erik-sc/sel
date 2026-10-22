/**
 * Renderer benchmark: one cell edit in a database of 5,000 rows. Skipped unless SEL_BENCH=1:
 *
 *   SEL_BENCH=1 npx vitest run src/renderer/src/database/bench.test.ts
 *
 * No DOM and no React: the test subscribes to the block store with the selectors a full-page
 * database registers (its block, its source, its rows, the related databases) and, whenever
 * one of them gives something new, does what DatabaseView renders from them: the live rows,
 * the view's query (a filter on a rollup, a sort on a formula that reads it), the board's
 * groups and the cells of the 40 rows a window shows. An edit costs the optimistic write,
 * the reconcile with what the backend returns (an immediate fake), and everything above.
 *
 * The workspace: Tasks (5,000 rows: hours, a status, a two-way relation to one project, a
 * rollup of the project's budget, a formula over both) and Projects (200 rows, a rollup
 * counting their tasks), with a page of 10,000 text blocks in the cache besides.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Block, DatabaseView, Op, PropertySchema } from '@shared/types'
import * as L from '@shared/database'

const enabled = process.env['SEL_BENCH'] === '1'

const TASKS = 'tasks'
const PROJECTS = 'projects'
const ROWS = 5_000
const PROJECT_ROWS = 200
const OTHER_BLOCKS = 10_000
const VISIBLE_ROWS = 40
const EDITS = 60

type Store = typeof import('@/store/blocks')
type Related = typeof import('./related')
type Resolved = typeof import('./resolved')

let seed = 7
function rnd(n: number): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed % n
}

function block(id: string, type: Block['type'], parentId: string | null, props: Block['props'], content: string[] = []): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

const STATUS: PropertySchema = {
  id: 'status',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'doing', name: 'Doing', color: 'blue' },
    { id: 'done', name: 'Done', color: 'green' }
  ]
}

const TASK_SCHEMA: Record<string, PropertySchema> = {
  title: { id: 'title', name: 'Name', type: 'title' },
  hours: { id: 'hours', name: 'Hours', type: 'number' },
  status: STATUS,
  project: { id: 'project', name: 'Project', type: 'relation', relation: { databaseId: PROJECTS, syncedPropertyId: 'tasks' } },
  budget: { id: 'budget', name: 'Budget', type: 'rollup', rollup: { relationId: 'project', propertyId: 'budget', function: 'sum' } },
  cost: { id: 'cost', name: 'Cost', type: 'formula', formula: { expression: 'prop("Hours") * prop("Budget") / 100' } }
}

const PROJECT_SCHEMA: Record<string, PropertySchema> = {
  title: { id: 'title', name: 'Name', type: 'title' },
  budget: { id: 'budget', name: 'Budget', type: 'number' },
  tasks: { id: 'tasks', name: 'Tasks', type: 'relation', relation: { databaseId: TASKS, syncedPropertyId: 'project' } },
  count: { id: 'count', name: 'Count', type: 'rollup', rollup: { relationId: 'tasks', function: 'count' } }
}

const VIEW: DatabaseView = {
  id: 'v',
  name: 'Table',
  type: 'table',
  visibleProperties: ['hours', 'status', 'project', 'budget', 'cost'],
  filters: [{ propertyId: 'budget', operator: 'gt', value: 0 }],
  sorts: [{ propertyId: 'cost', direction: 'desc' }]
}

function workspace(): Block[] {
  const tasks: Block[] = []
  const linked: string[][] = Array.from({ length: PROJECT_ROWS }, () => [])
  for (let i = 0; i < ROWS; i++) {
    const project = rnd(PROJECT_ROWS)
    linked[project].push(`t${i}`)
    tasks.push(
      block(`t${i}`, 'page', TASKS, {
        title: [[`Task ${i}`]],
        values: { hours: 1 + rnd(40), status: STATUS.options![rnd(3)].id, project: [`p${project}`] }
      })
    )
  }
  const projects = linked.map((ids, i) =>
    block(`p${i}`, 'page', PROJECTS, { title: [[`Project ${i}`]], values: { budget: 100 + rnd(900), tasks: ids } })
  )
  const other: Block[] = []
  for (let i = 0; i < OTHER_BLOCKS; i++) other.push(block(`x${i}`, 'text', 'notes', { title: [[`Line ${i}`]] }))
  return [
    block('ws', 'page', null, { title: [['Workspace']] }, [TASKS, PROJECTS, 'notes']),
    block(
      TASKS,
      'database',
      'ws',
      { title: [['Tasks']], schema: TASK_SCHEMA, views: [VIEW] },
      tasks.map((t) => t.id)
    ),
    block(
      PROJECTS,
      'database',
      'ws',
      { title: [['Projects']], schema: PROJECT_SCHEMA, views: [] },
      projects.map((p) => p.id)
    ),
    block(
      'notes',
      'page',
      'ws',
      { title: [['Notes']] },
      other.map((b) => b.id)
    ),
    ...tasks,
    ...projects,
    ...other
  ]
}

let store: Store
let related: Related
let resolved: Resolved

/** The backend: answers every write at once with the blocks it touched, as stored. */
const api = {
  clientId: 'bench',
  blocks: {
    apply: async (ops: Op[]): Promise<Block[]> => {
      const ids = new Set<string>()
      for (const op of ops) ids.add(op.op === 'create' ? (op.input.id as string) : op.id)
      return [...ids].flatMap((id) => {
        const b = store.getBlock(id)
        return b ? [{ ...b, updatedAt: b.updatedAt + 1 }] : []
      })
    },
    getMany: async (): Promise<Block[]> => [],
    children: async (): Promise<Block[]> => [],
    getTree: async (): Promise<Block[]> => []
  },
  pages: { ancestors: async (): Promise<Block[]> => [] },
  onChange: () => () => undefined
}

interface Timings {
  selectors: number
  render: number
  renders: number
}

/** What DatabaseView subscribes to and renders, for the Tasks database; `timings` adds up the work. */
function mountTasks(timings: Timings): { rows: () => Block[]; unmount: () => void } {
  const state = () => store.useBlockStore.getState()
  const db = store.getBlock(TASKS)!
  const schema = L.normalizeDatabase(db).schema
  const targets = L.relationTargets(schema)
  const rowIds = db.content
  const subs: { select: (s: ReturnType<typeof state>) => unknown; value: unknown }[] = [
    { select: (s) => s.blocks[TASKS], value: undefined },
    { select: resolved.sourceSelector(db), value: undefined },
    { select: store.blocksSelector(rowIds), value: undefined },
    { select: related.relatedWatcher(targets), value: undefined }
  ]
  for (const sub of subs) sub.value = sub.select(state())

  let lastRowBlocks: unknown
  let allRows: Block[] = []
  let lastWatched: unknown
  let cells: L.CellContext | undefined
  let rows: Block[] = []
  let shown = new Map<string, Block>()
  let shownCtx: L.CellContext | undefined
  const visible = L.visibleProps(VIEW, schema)
  // As DatabaseView runs it: with a memory of the last result.
  const query = L.createRowQuery()

  const render = (): void => {
    const started = performance.now()
    const rowBlocks = subs[2].value as (Block | undefined)[]
    const watched = subs[3].value
    let changed = false
    if (rowBlocks !== lastRowBlocks) {
      lastRowBlocks = rowBlocks
      allRows = rowBlocks.filter((b): b is Block => !!b && b.type === 'page' && !b.trashedAt && b.parentId === TASKS)
      changed = true
    }
    if (watched !== lastWatched) {
      lastWatched = watched
      cells = L.cellContext({ get: (id) => store.getBlock(id), isMissing: (id) => Object.hasOwn(state().missing, id) })
      changed = true
    }
    if (changed) {
      rows = query(allRows, schema, VIEW, '', cells)
      L.groupRows(rows, STATUS, cells)
    }
    // Memoised rows: a row draws again when its block or the cell context changed.
    const next = new Map<string, Block>()
    for (const row of rows.slice(0, VISIBLE_ROWS)) {
      if (shown.get(row.id) !== row || shownCtx !== cells) for (const prop of visible) L.cellText(row, prop, cells)
      next.set(row.id, row)
    }
    shown = next
    shownCtx = cells
    timings.render += performance.now() - started
    timings.renders++
  }
  render()

  const unsubscribe = store.useBlockStore.subscribe(() => {
    const started = performance.now()
    let dirty = false
    for (const sub of subs) {
      const value = sub.select(state())
      if (value !== sub.value) {
        sub.value = value
        dirty = true
      }
    }
    timings.selectors += performance.now() - started
    if (dirty) render()
  })
  return { rows: () => rows, unmount: unsubscribe }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function report(name: string, totals: number[], timings: Timings): void {
  const per = (n: number): string => (n / totals.length).toFixed(3)
  console.log(
    `${name}: median ${median(totals).toFixed(3)} ms, mean ${per(totals.reduce((a, b) => a + b, 0))} ms ` +
      `(selectors ${per(timings.selectors)} ms, render ${per(timings.render)} ms, ${(timings.renders / totals.length).toFixed(1)} renders)`
  )
}

describe.skipIf(!enabled)('renderer bench: a 5k-row database', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    vi.stubGlobal('window', { api })
    store = await import('@/store/blocks')
    related = await import('./related')
    resolved = await import('./resolved')
  })

  /** Times `edits` writes made by `opFor`, each awaited to its reconcile. */
  async function measure(name: string, opFor: (i: number) => Op): Promise<number> {
    seed = 7
    store.useBlockStore.setState({ blocks: Object.fromEntries(workspace().map((b) => [b.id, b])), missing: {} })
    const timings: Timings = { selectors: 0, render: 0, renders: 0 }
    const view = mountTasks(timings)
    expect(view.rows().length).toBe(ROWS)
    // Warm-up: compiled formulas, JIT.
    for (let i = 0; i < 10; i++) await store.applyOps([opFor(i)])
    timings.selectors = timings.render = timings.renders = 0
    const totals: number[] = []
    for (let i = 0; i < EDITS; i++) {
      const op = opFor(i + 10)
      const started = performance.now()
      await store.applyOps([op])
      totals.push(performance.now() - started)
    }
    view.unmount()
    report(name, totals, timings)
    return median(totals)
  }

  const valuesUpdate = (id: string, propertyId: string, value: number): Op => {
    const row = store.getBlock(id)!
    return { op: 'update', id, patch: { props: { values: L.setValue(L.valuesOf(row), propertyId, value) } } }
  }

  it('edits a cell of a row', async () => {
    const ms = await measure('cell edit (Tasks.hours)', (i) => valuesUpdate(`t${(i * 769) % ROWS}`, 'hours', 1 + (i % 40)))
    expect(ms).toBeGreaterThan(0)
  })

  it('edits a related row', async () => {
    const ms = await measure('related edit (Projects.budget)', (i) =>
      valuesUpdate(`p${(i * 37) % PROJECT_ROWS}`, 'budget', 100 + ((i * 13) % 900))
    )
    expect(ms).toBeGreaterThan(0)
  })

  it('edits a block outside the database', async () => {
    const ms = await measure('unrelated edit (a text block)', (i) => ({
      op: 'update',
      id: `x${(i * 101) % OTHER_BLOCKS}`,
      patch: { props: { title: [[`Line ${i} edited`]] } }
    }))
    expect(ms).toBeGreaterThan(0)
  })
})
