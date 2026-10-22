// Store-backed actions against an in-memory store with the real op semantics
// (`applyOpsToMap`). Each test is about what reaches the store: lost updates,
// reference clean-up, and the fate of a cancelled new row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_PROPS, tasksDatabaseProps } from '../../../shared/tasks'
import type { Block, DatabaseView, Op, PropertyValue } from '../../../shared/types'

const store = vi.hoisted(() => ({
  blocks: {} as Record<string, unknown>,
  batches: [] as unknown[][],
  seq: 0,
  /** Blocks that only exist "on disk" until loadChildren is called. */
  unloaded: [] as unknown[],
  loads: 0
}))

vi.mock('../store/blocks', async () => {
  const { applyOpsToMap } = await import('../store/ops')
  type Map = Parameters<typeof applyOpsToMap>[0]
  return {
    newId: () => `new-${++store.seq}`,
    getBlock: (id: string | null | undefined) => (id && Object.hasOwn(store.blocks, id) ? (store.blocks[id] as Block) : undefined),
    // Like the real store: the optimistic write is applied synchronously.
    applyOps: (ops: Op[]) => {
      store.batches.push(ops)
      store.blocks = applyOpsToMap(store.blocks as Map, ops, 2_000).map
      return Promise.resolve([])
    },
    loadChildren: () => {
      store.loads += 1
      for (const block of store.unloaded as Block[]) store.blocks[block.id] = block
      store.unloaded = []
      return Promise.resolve()
    },
    loadTree: () => Promise.resolve(),
    // `pages.restore` (below) already writes to the store.
    refreshBlocks: () => Promise.resolve()
  }
})

const toasts = vi.hoisted(() => [] as { message: string; action?: { label: string; run: () => void } }[])
vi.mock('../ui/toast', () => ({
  toast: (message: string, options: { action?: { label: string; run: () => void } } = {}) => {
    toasts.push({ message, action: options.action })
    return 'toast'
  },
  notifyError: (message: string, error: unknown) => {
    throw new Error(`${message} ${String(error)}`)
  }
}))

import * as actions from './actions'
import * as L from './logic'

const schema: L.Schema = {
  t: { id: 't', name: 'Name', type: 'title' },
  txt: { id: 'txt', name: 'Notes', type: 'text' },
  num: { id: 'num', name: 'Price', type: 'number' },
  chk: { id: 'chk', name: 'Done?', type: 'checkbox' },
  sel: {
    id: 'sel',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'todo', name: 'To do', color: 'gray' },
      { id: 'done', name: 'Done', color: 'green' }
    ]
  },
  tags: {
    id: 'tags',
    name: 'Tags',
    type: 'multi_select',
    options: [
      { id: 'a', name: 'A', color: 'red' },
      { id: 'b', name: 'B', color: 'blue' },
      { id: 'c', name: 'C', color: 'pink' }
    ]
  },
  date: { id: 'date', name: 'Due', type: 'date' }
}

const tableView: DatabaseView = { id: 'v1', name: 'Table', type: 'table', visibleProperties: ['t', 'txt'], filters: [], sorts: [] }
const boardView: DatabaseView = { id: 'v2', name: 'Board', type: 'board', visibleProperties: ['t'], filters: [], sorts: [], groupBy: 'sel' }

function page(id: string, title: string, values: Record<string, PropertyValue> = {}, extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: title ? [[title]] : [], values },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    ...extra
  }
}

function seed(rows: Block[], props: Record<string, unknown> = { schema, views: [tableView, boardView] }): void {
  const db: Block = {
    id: 'db',
    type: 'database',
    parentId: null,
    content: rows.map((r) => r.id),
    props: props as Block['props'],
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null
  }
  store.blocks = { db, ...Object.fromEntries(rows.map((r) => [r.id, r])) }
}

const get = (id: string): Block => store.blocks[id] as Block
const valuesOf = (id: string): Record<string, PropertyValue> => get(id).props.values ?? {}
const dbProps = (): Block['props'] => get('db').props
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  store.blocks = {}
  store.batches = []
  store.unloaded = []
  store.loads = 0
  store.seq = 0
})

describe('cell edits are built from the store at commit time', () => {
  it('two quick edits of different cells both survive', () => {
    seed([page('r', 'Row', { txt: 'old' })])
    // Both calls come from a component that rendered before either edit landed.
    actions.setCell('r', schema.num, 5)
    actions.setCell('r', schema.txt, 'new')
    actions.setCell('r', schema.sel, 'done')
    expect(valuesOf('r')).toEqual({ txt: 'new', num: 5, sel: 'done' })
  })

  it('an edit racing an external change keeps the external cell', () => {
    seed([page('r', 'Row', { txt: 'old' })])
    // Another window wrote `num` (arrives through a refetch that replaces the block).
    store.blocks.r = page('r', 'Row', { txt: 'old', num: 99 })
    actions.setCell('r', schema.txt, 'mine')
    expect(valuesOf('r')).toEqual({ txt: 'mine', num: 99 })
  })

  it('quick multi-select toggles accumulate instead of overwriting each other', () => {
    seed([page('r', 'Row', { tags: ['a'] })])
    const add = (id: string) => (current: PropertyValue) => [...(current as string[]), id]
    actions.updateCell('r', schema.tags, add('b'))
    actions.updateCell('r', schema.tags, add('c'))
    expect(valuesOf('r').tags).toEqual(['a', 'b', 'c'])
    actions.updateCell('r', schema.tags, (current) => (current as string[]).filter((id) => id !== 'a'))
    expect(valuesOf('r').tags).toEqual(['b', 'c'])
  })

  it('a checkbox toggled twice ends where it started', () => {
    seed([page('r', 'Row')])
    actions.toggleCheckbox('r', schema.chk)
    expect(valuesOf('r').chk).toBe(true)
    actions.toggleCheckbox('r', schema.chk)
    expect(valuesOf('r').chk).toBe(false)
  })

  it('Done in the built-in Tasks database completes the way the Tasks screen does', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 18, 40))
    try {
      const props = tasksDatabaseProps() as Record<string, unknown>
      const done = (props.schema as L.Schema)[TASK_PROPS.done]
      const daily = JSON.stringify({ rule: 'FREQ=DAILY', from: 'due', text: 'todo dia' })
      seed(
        [page('rep', 'Water', { [TASK_PROPS.due]: { start: '2026-10-15T08:00' }, [TASK_PROPS.recurrence]: daily }), page('once', 'Call')],
        props
      )
      actions.toggleCheckbox('rep', done)
      expect(valuesOf('rep')).toEqual({
        [TASK_PROPS.due]: { start: '2026-10-16T08:00' },
        [TASK_PROPS.recurrence]: daily,
        [TASK_PROPS.completedAt]: { start: '2026-10-15T18:40' }
      })
      actions.toggleCheckbox('once', done)
      expect(valuesOf('once')).toEqual({ [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-15T18:40' } })
      // Unticking reopens it: no longer done, no completion time.
      actions.toggleCheckbox('once', done)
      expect(valuesOf('once')).toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes nothing when the value did not change', () => {
    seed([page('r', 'Row', { txt: 'same', num: 1 })])
    actions.setCell('r', schema.txt, 'same')
    actions.setCell('r', schema.num, 1)
    actions.setCell('r', schema.t, 'Row')
    actions.setCell('missing', schema.txt, 'x')
    actions.setRowTitle('r', 'Row')
    expect(store.batches).toEqual([])
  })

  it('never stores a value that does not fit the property', () => {
    seed([page('r', 'Row', { num: 1, sel: 'todo' })])
    actions.setCell('r', schema.num, NaN)
    actions.setCell('r', schema.sel, 'ghost-option')
    actions.setCell('r', schema.date, { start: '2024-02-30' })
    actions.setCell('r', schema.txt, { start: 'x' } as PropertyValue)
    expect(valuesOf('r')).toEqual({})
    actions.setCell('r', schema.date, { start: '2024-3-1', end: '2024-03-09' })
    expect(valuesOf('r')).toEqual({ date: { start: '2024-03-01', end: '2024-03-09' } })
  })

  it('a select option created a moment ago can be picked by a component holding the old schema', () => {
    seed([page('r', 'Row')])
    const id = actions.addOption('db', 'sel', 'Blocked')!
    actions.updateCell('r', schema.sel, () => id)
    expect(valuesOf('r').sel).toBe(id)
  })

  it('repairs rows whose stored values are not an object', () => {
    seed([page('r', 'Row', 'junk' as unknown as Record<string, PropertyValue>)])
    actions.setCell('r', schema.txt, 'ok')
    expect(valuesOf('r')).toEqual({ txt: 'ok' })
  })
})

describe('view edits are built from the store at commit time', () => {
  it('two quick edits of one view both survive, and other views are untouched', () => {
    seed([])
    actions.patchView('db', 'v1', (v) => ({ ...v, filters: [...v.filters, { propertyId: 'txt', operator: 'is_empty' }] }))
    actions.patchView('db', 'v1', (v) => L.setSort(v, 'num', 'desc'))
    actions.patchView('db', 'v1', (v) => L.setPropertyWidth(v, 'txt', 240))
    const [v1, v2] = dbProps().views!
    expect(v1.filters).toEqual([{ propertyId: 'txt', operator: 'is_empty' }])
    expect(v1.sorts).toEqual([{ propertyId: 'num', direction: 'desc' }])
    expect(v1.propertyWidths).toEqual({ txt: 240 })
    expect(v2).toBe(boardView)
  })

  it('an edit racing an external view change keeps the external change', () => {
    seed([])
    const external = { ...boardView, name: 'Renamed elsewhere' }
    store.blocks.db = { ...get('db'), props: { schema, views: [tableView, external] } }
    actions.patchView('db', 'v1', (v) => L.setSort(v, 'txt', 'asc'))
    expect(dbProps().views![1]).toBe(external)
    expect(dbProps().views![0].sorts).toEqual([{ propertyId: 'txt', direction: 'asc' }])
  })

  it('cannot store references to things that do not exist, and skips no-op writes', () => {
    seed([])
    actions.patchView('db', 'v1', { groupBy: 'constructor', visibleProperties: ['t', 'gone'] })
    actions.patchView('db', 'v2', { groupBy: 'txt' })
    actions.patchView('db', 'v1', (v) => ({ ...v, sorts: [{ propertyId: '__proto__', direction: 'asc' }] }))
    actions.patchView('db', 'v1', (v) => ({ ...v }))
    actions.patchView('db', 'missing', { name: 'x' })
    const [v1, v2] = dbProps().views!
    expect(v1).toEqual({ ...tableView, visibleProperties: ['t'] })
    expect(v2.groupBy).toBe('sel')
    expect(store.batches).toHaveLength(1)
  })

  it('schema and view edits in a row compose', () => {
    seed([])
    const id = actions.addProperty('db', 'date', 'v1', 'When')
    actions.renameProperty('db', id, 'Deadline')
    const calendar = actions.addView('db', 'calendar')!
    actions.renameView('db', calendar, 'Plan')
    const props = dbProps()
    expect(props.schema![id]).toEqual({ id, name: 'Deadline', type: 'date' })
    expect(props.views!.map((v) => v.name)).toEqual(['Table', 'Board', 'Plan'])
    expect(props.views![0].visibleProperties).toEqual(['t', 'txt', id])
    // The calendar is laid out by the first date property of the schema as it is now.
    expect(props.views![2].groupBy).toBe('date')
    expect(L.groupProperty(props.views![2], props.schema!)?.type).toBe('date')
  })

  it('adds a grouping property and points the view at it in a single write', () => {
    seed([], { schema: { t: schema.t }, views: [{ ...boardView, groupBy: undefined }] })
    store.batches = []
    const id = actions.addProperty('db', 'select', 'v2', 'Status', { groupView: true })
    expect(store.batches).toHaveLength(1)
    expect(dbProps().views![0]).toMatchObject({ groupBy: id, visibleProperties: ['t', id] })
  })
})

describe('repairing malformed data', () => {
  it('writes the normalised schema and views once', () => {
    seed([], { schema: { junk: 5, t: { type: 'title' } }, views: 'nope' })
    expect(actions.repairDatabase('db')).toBe(true)
    expect(dbProps().schema).toEqual({ t: { id: 't', name: 'Title', type: 'title' } })
    expect(dbProps().views).toHaveLength(1)
    expect(actions.repairDatabase('db')).toBe(false)
    expect(store.batches).toHaveLength(1)
  })

  it('leaves healthy databases and non-databases alone', () => {
    seed([page('r', 'Row')])
    expect(actions.repairDatabase('db')).toBe(false)
    expect(actions.repairDatabase('r')).toBe(false)
    expect(actions.repairDatabase('missing')).toBe(false)
    expect(store.batches).toEqual([])
  })
})

describe('deleting an option', () => {
  const filtered: DatabaseView = {
    ...tableView,
    filters: [
      { propertyId: 'sel', operator: 'equals', value: 'done' },
      { propertyId: 'tags', operator: 'contains', value: ['a', 'b'] }
    ]
  }

  it('cleans the schema, the filter rules and every row (trashed ones too) in one batch', () => {
    seed(
      [
        page('r1', 'One', { sel: 'done', txt: 'keep' }),
        page('r2', 'Two', { sel: 'todo' }),
        page('r3', 'Three', { sel: 'done' }, { trashedAt: 5 })
      ],
      { schema, views: [filtered, boardView] }
    )
    actions.deleteOption('db', 'sel', 'done')
    expect(store.batches).toHaveLength(1)
    expect(dbProps().schema!.sel.options!.map((o) => o.id)).toEqual(['todo'])
    expect(dbProps().views![0].filters).toEqual([
      { propertyId: 'sel', operator: 'equals' },
      { propertyId: 'tags', operator: 'contains', value: ['a', 'b'] }
    ])
    expect(dbProps().views![1]).toBe(boardView)
    expect(valuesOf('r1')).toEqual({ txt: 'keep' })
    expect(valuesOf('r2')).toEqual({ sel: 'todo' })
    expect(valuesOf('r3')).toEqual({})
    expect(JSON.stringify(store.blocks)).not.toContain('"done"')
  })

  it('strips a multi-select option from arrays', () => {
    seed([page('r1', 'One', { tags: ['a', 'b'] }), page('r2', 'Two', { tags: ['a'] })], { schema, views: [filtered] })
    actions.deleteOption('db', 'tags', 'a')
    expect(valuesOf('r1')).toEqual({ tags: ['b'] })
    expect(valuesOf('r2')).toEqual({})
    expect(dbProps().views![0].filters[1]).toEqual({ propertyId: 'tags', operator: 'contains', value: ['b'] })
  })

  it('loads the rows that are not in the store first, so none keeps the dangling id', async () => {
    const unloaded = page('r2', 'Two', { sel: 'done' })
    seed([page('r1', 'One', { sel: 'done' }), unloaded])
    delete store.blocks.r2
    store.unloaded = [unloaded]
    actions.deleteOption('db', 'sel', 'done')
    expect(store.batches).toEqual([])
    await flush()
    expect(store.loads).toBe(1)
    expect(valuesOf('r1')).toEqual({})
    expect(valuesOf('r2')).toEqual({})
    expect(dbProps().schema!.sel.options!.map((o) => o.id)).toEqual(['todo'])
  })
})

describe('deleting a property', () => {
  it('removes it from the schema, from every view and from every row', () => {
    const views: DatabaseView[] = [
      {
        ...tableView,
        visibleProperties: ['t', 'sel', 'txt'],
        filters: [{ propertyId: 'sel', operator: 'is_empty' }],
        sorts: [{ propertyId: 'sel', direction: 'asc' }],
        propertyWidths: { sel: 120, txt: 90 }
      },
      boardView
    ]
    seed(
      [
        page('r1', 'One', { sel: 'done', txt: 'keep' }),
        page('r2', 'Two', { txt: 'x' }),
        page('r3', 'Old', { sel: 'todo' }, { trashedAt: 9 })
      ],
      {
        schema,
        views
      }
    )
    actions.deleteProperty('db', 'sel')
    expect(store.batches).toHaveLength(1)
    expect(dbProps().schema!.sel).toBeUndefined()
    expect(dbProps().views![0]).toEqual({
      ...tableView,
      visibleProperties: ['t', 'txt'],
      filters: [],
      sorts: [],
      propertyWidths: { txt: 90 }
    })
    expect(dbProps().views![1].groupBy).toBeUndefined()
    expect(valuesOf('r1')).toEqual({ txt: 'keep' })
    expect(valuesOf('r2')).toEqual({ txt: 'x' })
    expect(valuesOf('r3')).toEqual({})
    // r2 had nothing to strip: it is not rewritten.
    expect(store.batches[0].map((op) => (op as { id: string }).id)).toEqual(['db', 'r1', 'r3'])
  })

  it('never deletes the title', () => {
    seed([page('r1', 'One')])
    actions.deleteProperty('db', 't')
    expect(store.batches).toEqual([])
  })
})

describe('changing a property type', () => {
  it('converts every row in the same batch as the schema, including rows loaded on demand', async () => {
    const unloaded = page('r2', 'Two', { txt: '7,5' })
    seed([page('r1', 'One', { txt: '12', num: 1 }), unloaded, page('r3', 'Three', { txt: 'n/a' })])
    delete store.blocks.r2
    store.unloaded = [unloaded]
    actions.changePropertyType('db', 'txt', 'number')
    await flush()
    expect(store.batches).toHaveLength(1)
    expect(dbProps().schema!.txt).toEqual({ id: 'txt', name: 'Notes', type: 'number', numberFormat: 'number' })
    expect(valuesOf('r1')).toEqual({ txt: 12, num: 1 })
    expect(valuesOf('r2')).toEqual({ txt: 7.5 })
    expect(valuesOf('r3')).toEqual({})
  })

  it('re-points views that grouped by the property', () => {
    seed([page('r1', 'One', { sel: 'done' })])
    actions.changePropertyType('db', 'sel', 'text')
    expect(valuesOf('r1')).toEqual({ sel: 'Done' })
    expect(dbProps().views![1].groupBy).toBeUndefined()
  })
})

describe('linked views', () => {
  const linkedView: DatabaseView = { id: 'lv1', name: 'Mine', type: 'table', visibleProperties: ['t', 'num'], filters: [], sorts: [] }

  /** `db` (the source, with `rows`) plus `lv`, a linked view of it with one view of its own. */
  function seedLinked(rows: Block[] = [page('r1', 'One'), page('r2', 'Two')], lvProps: Record<string, unknown> = {}): void {
    seed(rows, { title: [['Tasks']], schema, views: [tableView, boardView] })
    store.blocks.lv = {
      id: 'lv',
      type: 'database',
      parentId: null,
      content: [],
      props: { sourceId: 'db', views: [linkedView], ...lvProps },
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null
    } satisfies Block
  }
  const lvProps = (): Block['props'] => get('lv').props
  const written = (): string[] =>
    store.batches
      .flat()
      .map(
        (op) =>
          (op as Op).op + ':' + ('id' in (op as Op) ? (op as { id: string }).id : (op as { input: { parentId: string } }).input.parentId)
      )

  it('resolves schema and rows through the source', () => {
    seedLinked()
    const snap = actions.snapshot('lv')
    expect(snap).toMatchObject({ linked: true, ready: true, sourceId: 'db' })
    expect(snap.block).toBe(get('lv'))
    expect(snap.source).toBe(get('db'))
    expect(snap.schema).toBe(actions.snapshot('db').schema)
    expect(snap.views).toEqual([linkedView])
    expect(actions.rowsOf('lv').map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(actions.rowsOwnerId('lv')).toBe('db')
    expect(actions.rowsOwnerId('db')).toBe('db')
  })

  it('view edits go to the linked block and never to the source', () => {
    seedLinked()
    const source = get('db')
    actions.patchView('lv', 'lv1', (v) => L.setSort(v, 'num', 'desc'))
    actions.patchView('lv', 'lv1', (v, s) => ({ ...v, filters: [...v.filters, L.defaultFilter(s.sel)] }))
    actions.patchView('lv', 'lv1', (v) => L.setPropertyWidth(v, 'num', 222))
    actions.renameView('lv', 'lv1', 'Renamed')
    const copy = actions.duplicateView('lv', 'lv1')!
    const added = actions.addView('lv', 'list')
    actions.deleteView('lv', copy)

    expect(get('db')).toBe(source)
    expect(written().every((w) => w === 'update:lv')).toBe(true)
    const views = lvProps().views!
    expect(views.map((v) => v.id)).toEqual(['lv1', added])
    expect(views[0]).toMatchObject({ name: 'Renamed', sorts: [{ propertyId: 'num', direction: 'desc' }], propertyWidths: { num: 222 } })
    expect(views[0].filters).toHaveLength(1)
    // The source's own views are a separate set.
    expect(dbProps().views).toEqual([tableView, boardView])
    // And the linked block never grows a schema.
    expect(lvProps().schema).toBeUndefined()
  })

  it('adding a view while the source is away writes nothing and gives no id', () => {
    seedLinked()
    delete store.blocks.db
    expect(actions.snapshot('lv').ready).toBe(false)
    expect(actions.addView('lv', 'list')).toBeUndefined()
    expect(store.batches).toEqual([])
  })

  it('two linked views of one source keep independent views', () => {
    seedLinked()
    store.blocks.lv2 = { ...get('lv'), id: 'lv2', props: { sourceId: 'db', views: [{ ...linkedView, id: 'other' }] } }
    actions.patchView('lv', 'lv1', (v) => L.setSort(v, 'num', 'asc'))
    actions.patchView('lv2', 'other', (v) => L.setPropertyVisible(v, schema, 'num', false))
    expect(lvProps().views![0].sorts).toHaveLength(1)
    expect(get('lv2').props.views![0].sorts).toEqual([])
    expect(get('lv2').props.views![0].visibleProperties).toEqual(['t'])
    expect(lvProps().views![0].visibleProperties).toEqual(['t', 'num'])
  })

  it('schema edits go to the source; the view that asked shows the new property', () => {
    seedLinked()
    const id = actions.addProperty('lv', 'text', 'lv1', 'Owner')
    expect(dbProps().schema![id]).toMatchObject({ name: 'Owner', type: 'text' })
    expect(lvProps().schema).toBeUndefined()
    expect(lvProps().views![0].visibleProperties).toEqual(['t', 'num', id])
    // The source's views are not rewritten from a linked view: other places keep it hidden.
    expect(dbProps().views).toEqual([tableView, boardView])
    // One batch: the schema on the source, the views on the linked block.
    expect(store.batches).toHaveLength(1)
    expect(written()).toEqual(['update:db', 'update:lv'])

    actions.renameProperty('lv', id, 'Assignee')
    actions.addOption('lv', 'sel', 'Blocked')
    expect(dbProps().schema![id].name).toBe('Assignee')
    expect(dbProps().schema!.sel.options!.map((o) => o.name)).toEqual(['To do', 'Done', 'Blocked'])
    expect(written().slice(2)).toEqual(['update:db', 'update:db'])
  })

  it('adding a board view from a linked view creates the grouping property in the source', () => {
    const { sel: _sel, tags: _tags, ...noSelect } = schema
    seedLinked()
    store.blocks.db = { ...get('db'), props: { ...dbProps(), schema: noSelect, views: [tableView] } }
    const id = actions.addView('lv', 'board')
    const status = Object.values(dbProps().schema!).find((p) => p.type === 'select')!
    expect(status).toBeDefined()
    expect(lvProps().views!.find((v) => v.id === id)).toMatchObject({ type: 'board', groupBy: status.id })
    expect(lvProps().schema).toBeUndefined()
  })

  it('rows are created in, moved within and edited in the source', () => {
    seedLinked()
    const id = actions.createRow('lv', { title: 'Three', values: { num: 5 }, afterId: 'r1' })
    expect(get(id)).toMatchObject({ parentId: 'db', props: { title: [['Three']], values: { num: 5 } } })
    expect(get('db').content).toEqual(['r1', id, 'r2'])
    expect(get('lv').content).toEqual([])

    actions.moveRowBefore('lv', 'r2', 'r1')
    expect(get('db').content).toEqual(['r2', 'r1', id])
    actions.moveRowAfter('lv', 'r2', id)
    expect(get('db').content).toEqual(['r1', id, 'r2'])
    expect(get('lv').content).toEqual([])

    actions.setCell('r1', schema.num, 9)
    expect(valuesOf('r1')).toEqual({ num: 9 })
    actions.deleteRows(['r2'])
    expect(get('r2').trashedAt).not.toBeNull()
    expect(actions.rowsOf('lv').map((r) => r.id)).toEqual(['r1', id])
  })

  it('a new row honours the filters of the linked view it was added from', () => {
    seedLinked()
    const filtered: DatabaseView = { ...linkedView, filters: [{ propertyId: 'sel', operator: 'equals', value: 'done' }] }
    const id = actions.createRow('lv', { view: filtered })
    expect(get(id).parentId).toBe('db')
    expect(valuesOf(id)).toEqual({ sel: 'done' })
  })

  it('deleting a property from a linked view cleans the source, every row and this view', () => {
    seedLinked([page('r1', 'One', { num: 1, txt: 'a' }), page('r2', 'Two', { num: 2 }, { trashedAt: 5 })])
    actions.deleteProperty('lv', 'num')
    expect(dbProps().schema!.num).toBeUndefined()
    expect(valuesOf('r1')).toEqual({ txt: 'a' })
    expect(valuesOf('r2')).toEqual({})
    expect(lvProps().views![0].visibleProperties).toEqual(['t'])
    expect(store.batches).toHaveLength(1)
    // The source's own views are repaired by normalisation the next time it is shown.
    expect(actions.snapshot('db').views.every((v) => !v.visibleProperties.includes('num'))).toBe(true)
  })

  it('loads the source rows that are not in the store before rewriting them', async () => {
    seedLinked([page('r1', 'One', { sel: 'done' })])
    store.blocks.db = { ...get('db'), content: ['r1', 'r9'] }
    store.unloaded = [page('r9', 'Nine', { sel: 'done' })]
    actions.deleteOption('lv', 'sel', 'done')
    expect(store.batches).toHaveLength(0)
    await flush()
    expect(store.loads).toBe(1)
    expect(valuesOf('r1')).toEqual({})
    expect(valuesOf('r9')).toEqual({})
    expect(dbProps().schema!.sel.options!.map((o) => o.id)).toEqual(['todo'])
  })

  it('repairs only its own views', () => {
    seedLinked(undefined, { views: [{ ...linkedView, visibleProperties: ['gone', 'num'] }, 'junk'] })
    const source = get('db')
    expect(actions.repairDatabase('lv')).toBe(true)
    expect(get('db')).toBe(source)
    expect(lvProps().views).toEqual([{ ...linkedView, visibleProperties: ['t', 'num'] }])
    expect(lvProps().schema).toBeUndefined()
    expect(actions.repairDatabase('lv')).toBe(false)
  })

  it('the title of a linked view is an override that can be reset', () => {
    seedLinked()
    const source = get('db')
    // Typing the source's own title, or nothing, is not an override.
    actions.setTitle('lv', 'Tasks')
    actions.setTitle('lv', '')
    expect(store.batches).toHaveLength(0)

    actions.setTitle('lv', 'My tasks')
    expect(lvProps().title).toEqual([['My tasks']])
    expect(get('db')).toBe(source)
    actions.setTitle('lv', 'My tasks')
    expect(store.batches).toHaveLength(1)

    // Clearing the field, or typing the source's title again, drops the override.
    actions.setTitle('lv', '')
    expect('title' in lvProps()).toBe(false)
    actions.setTitle('lv', 'Again')
    actions.resetTitle('lv')
    expect('title' in lvProps()).toBe(false)
    actions.resetTitle('lv')
    actions.resetTitle('db')
    expect(get('db')).toBe(source)
    expect(L.titleOf(get('db'))).toBe('Tasks')
    expect(store.batches).toHaveLength(4)
  })

  it('writes nothing while the source is in the trash, missing or still loading', () => {
    const attempt = (): void => {
      actions.patchView('lv', 'lv1', (v) => L.setSort(v, 'num', 'desc'))
      actions.renameView('lv', 'lv1', 'X')
      actions.duplicateView('lv', 'lv1')
      actions.deleteView('lv', 'lv1')
      actions.addView('lv', 'board')
      actions.addProperty('lv', 'text', 'lv1', 'Owner')
      actions.renameProperty('lv', 'num', 'X')
      actions.deleteProperty('lv', 'num')
      actions.changePropertyType('lv', 'num', 'text')
      actions.addOption('lv', 'sel', 'X')
      actions.deleteOption('lv', 'sel', 'done')
      actions.createRow('lv', { title: 'Nope' })
      actions.repairDatabase('lv')
    }
    seedLinked()
    store.blocks.db = { ...get('db'), trashedAt: 9 }
    attempt()
    seedLinked()
    delete store.blocks.db
    attempt()
    // A view pointing at something that is not a database, with views that reference nothing valid.
    seedLinked(undefined, { sourceId: 'r1', views: [{ ...linkedView, visibleProperties: ['gone'] }] })
    attempt()
    expect(store.batches).toEqual([])
    expect(lvProps().views).toEqual([{ ...linkedView, visibleProperties: ['gone'] }])
  })

  it('removes a linked view for good without touching its source, and only a linked view', () => {
    seedLinked()
    const source = get('db')
    actions.removeLinkedView('db')
    expect(store.batches).toEqual([])
    actions.removeLinkedView('lv')
    expect(store.blocks.lv).toBeUndefined()
    expect(get('db')).toBe(source)
    expect(actions.rowsOf('db').map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('inserts a linked view of a source, or of the source of a linked view, into a page', async () => {
    seedLinked()
    store.blocks.pg = { ...page('pg', 'Page'), parentId: null }
    const first = await actions.insertLinkedView('pg', 'db')
    const second = await actions.insertLinkedView('pg', 'lv')
    expect(get('pg').content).toEqual([first, second])
    for (const id of [first!, second!]) {
      expect(get(id)).toMatchObject({ type: 'database', parentId: 'pg', props: { sourceId: 'db' } })
      expect(get(id).props.schema).toBeUndefined()
      expect(get(id).props.views).toHaveLength(1)
      expect(get(id).props.views![0]).toMatchObject({ type: 'table', visibleProperties: Object.keys(schema) })
    }
    expect(get(first!).props.views![0].id).not.toBe(get(second!).props.views![0].id)
    expect(await actions.insertLinkedView('pg', 'pg')).toBeUndefined()
    expect(await actions.insertLinkedView('pg', 'missing')).toBeUndefined()
  })
})

describe('new rows', () => {
  it('Escape on a brand-new empty row removes it; a row with content stays', () => {
    seed([page('filled', 'Has a title'), page('body', '', {}, { content: ['child'] })])
    const id = actions.createRow('db')
    expect(get('db').content).toContain(id)
    expect(actions.isPristineRow(get(id))).toBe(true)
    expect(actions.discardPristineRow(id)).toBe(true)
    expect(get(id).trashedAt).not.toBeNull()

    expect(actions.discardPristineRow('filled')).toBe(false)
    expect(actions.discardPristineRow('body')).toBe(false)
    expect(actions.discardPristineRow('db')).toBe(false)
    expect(actions.discardPristineRow('missing')).toBe(false)
    expect(get('filled').trashedAt).toBeNull()
    expect(get('body').trashedAt).toBeNull()
  })

  it('a title typed before Escape is not saved, so the row is still pristine and goes away', () => {
    seed([])
    const id = actions.createRow('db')
    // The editor only writes on commit; cancelling discards against the store state.
    expect(actions.discardPristineRow(id)).toBe(true)
    actions.setRowTitle(id, 'late commit after unmount')
    expect(L.titleOf(get(id))).toBe('late commit after unmount')
  })

  it('a row keeps its default values from the view filters, and only valid ones', () => {
    seed([])
    const view: DatabaseView = {
      ...tableView,
      filters: [
        { propertyId: 'sel', operator: 'equals', value: 'done' },
        { propertyId: 'chk', operator: 'checked' },
        { propertyId: 'tags', operator: 'contains', value: ['a', 'ghost'] }
      ]
    }
    const id = actions.createRow('db', { view, values: { num: NaN, txt: 'hi', constructor: 'x', date: { start: 'bad' } } as never })
    expect(valuesOf(id)).toEqual({ sel: 'done', chk: true, tags: ['a'], txt: 'hi' })
  })

  it('moves are computed against the current database order', () => {
    seed([page('a', 'A'), page('b', 'B'), page('c', 'C')])
    actions.moveRowBefore('db', 'c', 'a')
    expect(get('db').content).toEqual(['c', 'a', 'b'])
    actions.moveRowAfter('db', 'c', 'b')
    expect(get('db').content).toEqual(['a', 'b', 'c'])
    actions.moveRowBefore('db', 'a', null)
    expect(get('db').content).toEqual(['b', 'c', 'a'])
    const before = store.batches.length
    actions.moveRowAfter('db', 'a', 'a')
    actions.moveRowAfter('db', 'a', 'missing')
    actions.moveRowBefore('db', 'missing', 'a')
    expect(store.batches).toHaveLength(before)
  })
})

describe('bulk edits', () => {
  it('change one property of every selected row in one batch, from the store at commit time', () => {
    seed([page('a', 'A', { sel: 'todo', tags: ['a'] }), page('b', 'B', { tags: ['b'] }), page('c', 'C', { sel: 'todo' })])
    // Another window wrote a cell after the menu was rendered.
    store.blocks.b = page('b', 'B', { tags: ['b'], txt: 'theirs' })
    actions.editCells(['a', 'b', 'missing'], schema.sel, { kind: 'set', value: 'done' })
    expect(store.batches).toHaveLength(1)
    expect(valuesOf('a')).toEqual({ sel: 'done', tags: ['a'] })
    expect(valuesOf('b')).toEqual({ sel: 'done', tags: ['b'], txt: 'theirs' })
    expect(valuesOf('c')).toEqual({ sel: 'todo' })
    actions.editCells(['a', 'b'], schema.tags, { kind: 'add', optionId: 'c' })
    expect([valuesOf('a').tags, valuesOf('b').tags]).toEqual([
      ['a', 'c'],
      ['b', 'c']
    ])
  })

  it('writes nothing when no selected row changes', () => {
    seed([page('a', 'A', { chk: true }), page('b', 'B', { chk: true })])
    actions.editCells(['a', 'b'], schema.chk, { kind: 'set', value: true })
    actions.editCells(['a'], schema.t, { kind: 'clear' })
    expect(store.batches).toEqual([])
  })

  it('Done in the built-in Tasks database completes each task the way a click does', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 18, 40))
    try {
      const props = tasksDatabaseProps() as Record<string, unknown>
      const done = (props.schema as L.Schema)[TASK_PROPS.done]
      const daily = JSON.stringify({ rule: 'FREQ=DAILY', from: 'due', text: 'todo dia' })
      const finished = { [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-14T09:00' } }
      seed(
        [
          page('rep', 'Water', { [TASK_PROPS.due]: { start: '2026-10-15T08:00' }, [TASK_PROPS.recurrence]: daily }),
          page('once', 'Call'),
          page('old', 'Done already', finished)
        ],
        props
      )
      actions.editCells(['rep', 'once', 'old'], done, { kind: 'set', value: true })
      expect(store.batches).toHaveLength(1)
      expect(valuesOf('rep')).toEqual({
        [TASK_PROPS.due]: { start: '2026-10-16T08:00' },
        [TASK_PROPS.recurrence]: daily,
        [TASK_PROPS.completedAt]: { start: '2026-10-15T18:40' }
      })
      expect(valuesOf('once')).toEqual({ [TASK_PROPS.done]: true, [TASK_PROPS.completedAt]: { start: '2026-10-15T18:40' } })
      // A task that was already done keeps the day it was completed.
      expect(valuesOf('old')).toEqual(finished)
      actions.editCells(['once', 'old'], done, { kind: 'set', value: false })
      expect([valuesOf('once'), valuesOf('old')]).toEqual([{}, {}])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('trashing rows', () => {
  beforeEach(() => {
    toasts.length = 0
    // The backend: a restored row is no longer trashed and is appended to its database.
    const restore = vi.fn((id: string) => {
      const row = get(id)
      store.blocks[id] = { ...row, trashedAt: null }
      const db = get('db')
      store.blocks.db = { ...db, content: [...db.content.filter((x) => x !== id), id] }
      return Promise.resolve()
    })
    vi.stubGlobal('window', { api: { pages: { restore } } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers to undo, and undoing puts the rows back where they were', async () => {
    seed([page('a', 'A'), page('b', 'B'), page('c', 'C'), page('d', 'D')])
    actions.trashRows('db', ['b', 'd', 'b'])
    expect([get('b').trashedAt, get('d').trashedAt].every((t) => t !== null)).toBe(true)
    expect(toasts.map((t) => t.message)).toEqual(['2 rows moved to the trash'])
    // Meanwhile the backend dropped them from the order, and a row was added at the end.
    store.blocks.db = { ...get('db'), content: ['a', 'c', 'e'] }
    store.blocks.e = page('e', 'E')
    toasts[0].action!.run()
    await flush()
    await flush()
    expect(get('db').content).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(get('b').trashedAt).toBeNull()
  })

  it('says "row" for one, and does nothing for rows that are gone', () => {
    seed([page('a', 'A')])
    actions.trashRows('db', ['missing'])
    expect(toasts).toEqual([])
    actions.trashRows('db', ['a'])
    expect(toasts.map((t) => t.message)).toEqual(['Row moved to the trash'])
  })
})
