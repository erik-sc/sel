import { describe, expect, it } from 'vitest'
import type { BlockProps, PropertySchema } from '../../shared/types'
import { detectSignal, fold, isOpenRow, planCompletion, planUndo, selectTasks, type TaskBlock } from './tasks'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from '../../shared/tasks'

const TODAY = '2026-10-13'

const STATUS: PropertySchema = {
  id: 'status',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'doing', name: 'In progress', color: 'blue' },
    { id: 'done', name: 'Done', color: 'green' },
    { id: 'dropped', name: 'Cancelled', color: 'red' }
  ]
}
const PRIORITY: PropertySchema = {
  id: 'prio',
  name: 'Priority',
  type: 'select',
  options: [
    { id: 'hi', name: 'High', color: 'red' },
    { id: 'mid', name: 'Medium', color: 'yellow' },
    { id: 'lo', name: 'Low', color: 'gray' }
  ]
}
const SCHEMA: Record<string, PropertySchema> = {
  title: { id: 'title', name: 'Name', type: 'title' },
  status: STATUS,
  due: { id: 'due', name: 'Due', type: 'date' },
  prio: PRIORITY
}

let stamp = 0
function block(
  id: string,
  type: TaskBlock['type'],
  parentId: string | null,
  props: BlockProps = {},
  extra: Partial<TaskBlock> = {}
): TaskBlock {
  return { id, type, parentId, props, updatedAt: ++stamp, trashedAt: null, ...extra }
}
const database = (
  id: string,
  schema: unknown = SCHEMA,
  title = 'Tasks',
  extra: Partial<TaskBlock> = {},
  props: BlockProps = {}
): TaskBlock => block(id, 'database', null, { title: [[title]], schema: schema as BlockProps['schema'], ...props }, extra)
const row = (
  id: string,
  parentId: string,
  title: string,
  values: Record<string, unknown> = {},
  extra: Partial<TaskBlock> = {}
): TaskBlock => block(id, 'page', parentId, { title: [[title]], values: values as BlockProps['values'] }, extra)

const titles = (list: { title: string }[]): string[] => list.map((task) => task.title)

describe('names', () => {
  it('compares without case, diacritics or punctuation', () => {
    expect(fold('  Situação ')).toBe('situacao')
    expect(fold('In-Progress!')).toBe('in progress')
    expect(fold('CONCLUÍDO')).toBe('concluido')
    expect(fold(undefined)).toBe('')
    expect(fold(42)).toBe('')
  })
})

describe('finding the done signal', () => {
  it('reads a status select with a done-like option', () => {
    const signal = detectSignal({ schema: SCHEMA })
    expect(signal?.status).toMatchObject({ property: 'status', done: 'done' })
    expect([...signal!.status!.closed].sort()).toEqual(['done', 'dropped'])
    expect([...signal!.status!.active]).toEqual(['doing'])
    expect(signal?.date).toBe('due')
    expect(signal?.priority?.property).toBe('prio')
    expect(signal?.checkbox).toBeUndefined()
  })

  it.each([
    ['Estado', 'Concluído'],
    ['Situação', 'Feito'],
    ['STATE', 'COMPLETED'],
    ['status', 'pronto'],
    ['Stage', 'Finished'],
    ['Status', 'Closed']
  ])('understands %s / %s', (name, done) => {
    const schema = {
      s: {
        id: 's',
        name,
        type: 'select',
        options: [
          { id: 'a', name: 'Aberto', color: 'gray' },
          { id: 'z', name: done, color: 'green' }
        ]
      }
    }
    expect(detectSignal({ schema: schema as never })?.status?.done).toBe('z')
  })

  it('reads a checkbox named like "done", or a lone checkbox that does not mean something else', () => {
    const named = { a: { id: 'a', name: 'Starred', type: 'checkbox' }, b: { id: 'b', name: 'Feito', type: 'checkbox' } }
    expect(detectSignal({ schema: named as never })?.checkbox).toBe('b')
    expect(detectSignal({ schema: { c: { id: 'c', name: 'Shipped it', type: 'checkbox' } } as never })?.checkbox).toBe('c')
    for (const name of ['Favourite', 'Favorito', 'Pinned', 'Archived', 'Read', 'Important']) {
      expect(detectSignal({ schema: { c: { id: 'c', name, type: 'checkbox' } } as never }), name).toBeNull()
    }
    const two = { a: { id: 'a', name: 'Urgent', type: 'checkbox' }, b: { id: 'b', name: 'Billable', type: 'checkbox' } }
    expect(detectSignal({ schema: two as never })).toBeNull()
  })

  it('needs a done-like option, and a select that is a status', () => {
    const noDone = { s: { id: 's', name: 'Status', type: 'select', options: [{ id: 'a', name: 'Open', color: 'gray' }] } }
    expect(detectSignal({ schema: noDone as never })).toBeNull()
    const notStatus = { s: { id: 's', name: 'Colour', type: 'select', options: [{ id: 'a', name: 'Done', color: 'gray' }] } }
    expect(detectSignal({ schema: notStatus as never })).toBeNull()
    expect(detectSignal({})).toBeNull()
    expect(detectSignal(null)).toBeNull()
  })

  it('prefers a date named like "due"', () => {
    const schema = {
      ...SCHEMA,
      created: { id: 'created', name: 'Started', type: 'date' },
      due: undefined,
      prazo: { id: 'prazo', name: 'Prazo', type: 'date' }
    }
    expect(detectSignal({ schema: schema as never })?.date).toBe('prazo')
    const only = { ...SCHEMA, due: { id: 'due', name: 'Whenever', type: 'date' } }
    expect(detectSignal({ schema: only as never })?.date).toBe('due')
  })

  it('does not crash on malformed schemas', () => {
    const shapes: unknown[] = [
      null,
      7,
      'schema',
      [],
      [1, 2],
      { a: null },
      { a: 7 },
      { a: [] },
      { a: {} },
      { a: { type: 5 } },
      { a: { type: 'select' } },
      { a: { type: 'select', name: 'Status', options: 'nope' } },
      { a: { type: 'select', name: 'Status', options: [null, 3, {}, { id: 1, name: 2 }, { id: 'x' }, { name: 'Done' }] } },
      { a: { type: 'select', name: { toString: () => 'Status' }, options: [{ id: 'd', name: 'Done' }] } },
      { __proto__: { type: 'checkbox', name: 'Done' } },
      { constructor: { id: 'constructor', type: 'checkbox', name: 'Done' } },
      { a: { type: 'checkbox', name: 'Done', id: '__proto__' } },
      { a: { type: 'date', name: null }, b: { type: 'checkbox', name: 'x'.repeat(100_000) } }
    ]
    for (const schema of shapes) {
      expect(() => detectSignal({ schema: schema as never })).not.toThrow()
      expect(() => selectTasks([database('db', schema), row('r', 'db', 'x', { a: true })], { today: TODAY })).not.toThrow()
    }
    // The dangerous keys never become a signal.
    expect(detectSignal({ schema: { a: { type: 'checkbox', name: 'Done', id: '__proto__' } } as never })).toBeNull()
  })
})

describe('selecting tasks', () => {
  const blocks = (): TaskBlock[] => [
    database('db'),
    row('late', 'db', 'Pay the rent', { status: 'todo', due: { start: '2026-10-10' } }),
    row('later', 'db', 'File taxes', { status: 'todo', due: { start: '2026-10-01' }, prio: 'lo' }),
    row('now', 'db', 'Call the bank', { status: 'todo', due: { start: '2026-10-13' }, prio: 'hi' }),
    row('now2', 'db', 'Water the plants', { status: 'todo', due: { start: '2026-10-13T09:00:00Z' } }),
    row('doing', 'db', 'Write the report', { status: 'doing', due: { start: '2026-11-01' }, prio: 'mid' }),
    row('future', 'db', 'Renew the passport', { status: 'todo', due: { start: '2026-12-01' } }),
    row('nodate', 'db', 'Read that book', { status: 'todo' }),
    row('empty', 'db', '', {}),
    row('done', 'db', 'Done already', { status: 'done', due: { start: '2026-10-01' } }),
    row('dropped', 'db', 'Never mind', { status: 'dropped', due: { start: '2026-10-13' } }),
    row('trashed', 'db', 'In the trash', { status: 'todo', due: { start: '2026-10-13' } }, { trashedAt: 5 })
  ]

  it('groups open rows into overdue, today and no date', () => {
    const selected = selectTasks(blocks(), { today: TODAY })
    expect(titles(selected.overdue)).toEqual(['File taxes', 'Pay the rent'])
    expect(titles(selected.today)).toEqual(['Call the bank', 'Write the report', 'Water the plants'])
    expect(titles(selected.noDate)).toEqual(['Read that book', 'Untitled'])
    const call = selected.today[0]
    expect(call).toEqual({
      id: 'now',
      kind: 'row',
      title: 'Call the bank',
      pageId: 'now',
      source: 'Tasks',
      due: '2026-10-13',
      dateProperty: 'due',
      priority: { id: 'hi', name: 'High', color: 'red' }
    })
    expect(selected.today[2].due).toBe('2026-10-13')
    expect(selected.today[1].due).toBe('2026-11-01')
  })

  it('keeps the hour a task is due at, and the property its date is in', () => {
    const selected = selectTasks(
      [
        database('db'),
        row('timed', 'db', 'Call', { due: { start: '2026-10-13T15:30' } }),
        row('plain', 'db', 'Shop', { due: { start: '2026-10-13' } }),
        row('zoned', 'db', 'Zoned', { due: { start: '2026-10-13T09:00:00Z' } }),
        row('range', 'db', 'Trip', { due: { start: '2026-10-12T08:00', end: '2026-10-14T18:00' } }),
        row('bad', 'db', 'Bad hour', { due: { start: '2026-10-13T25:00' } })
      ],
      { today: TODAY, range: { from: '2026-10-01', to: '2026-10-31' } }
    )
    const byTitle = new Map(selected.dated?.map((task) => [task.title, task]))
    expect(byTitle.get('Call')).toMatchObject({ due: '2026-10-13', time: '15:30', dateProperty: 'due' })
    expect(byTitle.get('Shop')?.time).toBeUndefined()
    // A time with a zone is not a wall-clock time: the day alone, as everywhere else.
    expect(byTitle.get('Zoned')?.time).toBeUndefined()
    expect(byTitle.get('Trip')).toMatchObject({ due: '2026-10-14', time: '18:00' })
    expect(byTitle.get('Bad hour')?.time).toBeUndefined()
  })

  it('reads a start and an end on the same day as a time block', () => {
    const selected = selectTasks(
      [
        database('db'),
        row('block', 'db', 'Write', { due: { start: '2026-10-13T09:00', end: '2026-10-13T10:30' } }),
        row('backwards', 'db', 'Odd', { due: { start: '2026-10-13T11:00', end: '2026-10-13T10:00' } }),
        row('range', 'db', 'Trip', { due: { start: '2026-10-12T08:00', end: '2026-10-14T18:00' } })
      ],
      { today: TODAY, range: { from: '2026-10-01', to: '2026-10-31' } }
    )
    const byTitle = new Map(selected.dated?.map((task) => [task.title, task]))
    expect(byTitle.get('Write')).toMatchObject({ due: '2026-10-13', time: '09:00', minutes: 90 })
    expect(byTitle.get('Odd')?.minutes).toBeUndefined()
    expect(byTitle.get('Trip')?.minutes).toBeUndefined()
  })

  it('does not depend on the order blocks arrive in', () => {
    const forward = selectTasks(blocks(), { today: TODAY })
    const shuffled = blocks().reverse()
    const backward = selectTasks(shuffled, { today: TODAY })
    expect(new Set(titles(backward.overdue))).toEqual(new Set(titles(forward.overdue)))
    expect(new Set(titles(backward.today))).toEqual(new Set(titles(forward.today)))
    expect(titles(backward.overdue)).toEqual(titles(forward.overdue))
  })

  it('reads a date range: overdue once it has ended, today while it runs', () => {
    const selected = selectTasks(
      [
        database('db'),
        row('running', 'db', 'Conference', { due: { start: '2026-10-12', end: '2026-10-14' } }),
        row('ended', 'db', 'Trip', { due: { start: '2026-10-05', end: '2026-10-08' } }),
        row('soon', 'db', 'Sprint', { due: { start: '2026-10-14', end: '2026-10-20' } }),
        row('junk', 'db', 'Junk date', { due: { start: 'next tuesday' } }),
        row('odd', 'db', 'Odd date', { due: 20261013 })
      ],
      { today: TODAY }
    )
    expect(titles(selected.today)).toEqual(['Conference'])
    expect(titles(selected.overdue)).toEqual(['Trip'])
    expect(titles(selected.noDate)).toEqual(['Junk date', 'Odd date'])
  })

  it('uses a checkbox, alone or together with a status', () => {
    const schema = { title: SCHEMA.title, ok: { id: 'ok', name: 'Done', type: 'checkbox' }, status: STATUS, due: SCHEMA.due }
    const selected = selectTasks(
      [
        database('db', schema),
        row('a', 'db', 'Unchecked', { ok: false, due: { start: TODAY } }),
        row('b', 'db', 'Checked', { ok: true, due: { start: TODAY } }),
        row('c', 'db', 'Checked by status only', { ok: false, status: 'done', due: { start: TODAY } }),
        row('d', 'db', 'No values at all')
      ],
      { today: TODAY }
    )
    expect(titles(selected.today)).toEqual(['Unchecked'])
    expect(titles(selected.noDate)).toEqual(['No values at all'])
  })

  it('leaves out linked views, trashed databases, databases inside trashed pages and those not chosen', () => {
    const input: TaskBlock[] = [
      block('page', 'page', null, { title: [['Projects']] }),
      block('bin', 'page', null, { title: [['Old']] }, { trashedAt: 9 }),
      database('a', SCHEMA, 'A', { parentId: 'page' }),
      database('b', SCHEMA, 'B'),
      database('gone', SCHEMA, 'Gone', { trashedAt: 3 }),
      database('nested', SCHEMA, 'Nested', { parentId: 'bin' }),
      database('view', SCHEMA, 'View', {}, { sourceId: 'a' }),
      database('plain', { title: SCHEMA.title, note: { id: 'note', name: 'Note', type: 'text' } }, 'Notes'),
      row('a1', 'a', 'From A', { due: { start: TODAY } }),
      row('b1', 'b', 'From B', { due: { start: TODAY } }),
      row('g1', 'gone', 'From a trashed database', { due: { start: TODAY } }),
      row('n1', 'nested', 'From a database in the trash', { due: { start: TODAY } }),
      row('v1', 'view', 'From a linked view', { due: { start: TODAY } }),
      row('p1', 'plain', 'From a database that is not a task list', { due: { start: TODAY } }),
      row('o1', 'nowhere', 'Orphan', { due: { start: TODAY } }),
      row('sub', 'page', 'A sub-page, not a row', { due: { start: TODAY } })
    ]
    expect(titles(selectTasks(input, { today: TODAY }).today)).toEqual(['From A', 'From B'])
    expect(titles(selectTasks(input, { today: TODAY, databases: ['b', 'gone', 'view'] }).today)).toEqual(['From B'])
    expect(titles(selectTasks(input, { today: TODAY, databases: [] }).today)).toEqual([])
    expect(titles(selectTasks(input, { today: TODAY, exclude: ['a'] }).today)).toEqual(['From B'])
  })

  it('adds unchecked to-dos of recently edited pages when asked', () => {
    const input: TaskBlock[] = [
      block('fresh', 'page', null, { title: [['Meeting notes']] }, { updatedAt: 1000 }),
      block('stale', 'page', null, { title: [['Last year']] }, { updatedAt: 10 }),
      block('binned', 'page', null, { title: [['Binned']] }, { updatedAt: 1000, trashedAt: 1 }),
      block('t1', 'to_do', 'fresh', { title: [['Send the summary']] }),
      block('t2', 'to_do', 'fresh', { title: [['Already sent']], checked: true }),
      block('toggle', 'toggle', 'fresh', { title: [['Details']] }),
      block('t3', 'to_do', 'toggle', { title: [['Nested one']] }),
      block('t4', 'to_do', 'fresh', { title: [['   ']] }),
      block('t5', 'to_do', 'stale', { title: [['Too old']] }),
      block('t6', 'to_do', 'binned', { title: [['In the trash']] }),
      block('t7', 'to_do', 'missing', { title: [['No page']] })
    ]
    expect(selectTasks(input, { today: TODAY }).today).toEqual([])
    const selected = selectTasks(input, { today: TODAY, includeTodos: true, todoSince: 500 })
    expect(selected.today).toEqual([
      { id: 't1', kind: 'todo', title: 'Send the summary', pageId: 'fresh', source: 'Meeting notes' },
      { id: 't3', kind: 'todo', title: 'Nested one', pageId: 'fresh', source: 'Meeting notes' }
    ])
  })

  it('puts database tasks before to-dos, and high priority first', () => {
    const selected = selectTasks(
      [
        block('p', 'page', null, { title: [['Notes']] }, { updatedAt: 1000 }),
        block('t', 'to_do', 'p', { title: [['A to-do']] }),
        database('db'),
        row('lo', 'db', 'Low', { due: { start: TODAY }, prio: 'lo' }),
        row('none', 'db', 'None', { due: { start: TODAY } }),
        row('hi', 'db', 'High', { due: { start: TODAY }, prio: 'hi' }),
        row('mid', 'db', 'Medium', { due: { start: TODAY }, prio: 'mid' })
      ],
      { today: TODAY, includeTodos: true, todoSince: 0 }
    )
    expect(titles(selected.today)).toEqual(['High', 'Medium', 'None', 'Low', 'A to-do'])
  })

  it('caps each group', () => {
    const input: TaskBlock[] = [database('db')]
    for (let i = 0; i < 50; i++) input.push(row(`r${i}`, 'db', `Task ${i}`, { due: { start: i % 2 ? TODAY : '2026-01-01' } }))
    const selected = selectTasks(input, { today: TODAY, cap: 7 })
    expect(selected.today).toHaveLength(7)
    expect(selected.overdue).toHaveLength(7)
  })

  it('survives blocks that are not blocks', () => {
    const junk = [
      null,
      undefined,
      7,
      'x',
      {},
      { id: 5 },
      { id: 'a', type: 'page', parentId: 'a', props: null },
      { id: 'loop1', type: 'to_do', parentId: 'loop2', props: { title: [['x']] } },
      { id: 'loop2', type: 'toggle', parentId: 'loop1', props: {} },
      { id: 'r', type: 'page', parentId: 'db', props: { title: 'not rich text', values: 'nope' } },
      { id: 'r2', type: 'page', parentId: 'db', props: { title: [[5]], values: [1, 2] } }
    ] as unknown as TaskBlock[]
    expect(() => selectTasks([database('db'), ...junk], { today: TODAY, includeTodos: true })).not.toThrow()
    expect(() => selectTasks([database('db')], { today: 'not a day' })).not.toThrow()
  })

  it('is fast on a workspace of 50 000 blocks', () => {
    // A workspace shaped like a real one: a dozen databases with a few thousand rows, and the rest text.
    const input: TaskBlock[] = []
    for (let d = 0; d < 12; d++) input.push(database(`db${d}`, d % 3 === 2 ? { title: SCHEMA.title } : SCHEMA, `Database ${d}`))
    for (let p = 0; p < 400; p++) input.push(block(`page${p}`, 'page', null, { title: [[`Page ${p}`]] }, { updatedAt: p }))
    for (let i = 0; input.length < 50_000; i++) {
      if (i % 4 === 0) {
        const status = ['todo', 'doing', 'done', 'dropped'][(i % 7) % 4]
        const day = String((i % 28) + 1).padStart(2, '0')
        input.push(
          row(`row${i}`, `db${i % 12}`, `Row ${i}`, {
            status,
            due: i % 5 ? { start: `2026-${i % 2 ? '10' : '09'}-${day}` } : undefined,
            prio: ['hi', 'mid', 'lo'][i % 3]
          })
        )
      } else if (i % 4 === 1) input.push(block(`todo${i}`, 'to_do', `page${i % 400}`, { title: [[`To-do ${i}`]], checked: i % 3 === 0 }))
      else input.push(block(`text${i}`, 'text', `page${i % 400}`, { title: [['Some text in a paragraph that is of no interest here.']] }))
    }
    expect(input).toHaveLength(50_000)
    // Warm up once, then take the best of a few runs: the bound is on the work, not on a cold start.
    selectTasks(input, { today: TODAY, includeTodos: true, todoSince: 200 })
    let best = Infinity
    let selected = selectTasks(input, { today: TODAY })
    for (let run = 0; run < 5; run++) {
      const started = performance.now()
      selected = selectTasks(input, { today: TODAY, includeTodos: true, todoSince: 200 })
      best = Math.min(best, performance.now() - started)
    }
    expect(selected.overdue.length).toBeGreaterThan(100)
    expect(selected.today.length).toBeGreaterThan(100)
    console.info(`[bench] selectTasks over 50 000 blocks: ${best.toFixed(1)} ms`)
    expect(best).toBeLessThan(150)
  })
})

describe('completing and undoing', () => {
  it('ticks the checkbox and moves the status, remembering what was there', () => {
    const schema = { ok: { id: 'ok', name: 'Done', type: 'checkbox' }, status: STATUS }
    const signal = detectSignal({ schema: schema as never })!
    const props: BlockProps = { title: [['x']], values: { status: 'doing', other: 'kept' } }
    const plan = planCompletion(signal, props)!
    expect(plan.values).toEqual({ status: 'done', ok: true, other: 'kept' })
    expect(plan.previous).toEqual({ ok: undefined, status: 'doing' })
    expect(isOpenRow(signal, { values: plan.values })).toBe(false)
    expect(planCompletion(signal, { values: plan.values })).toBeNull()
    // Undo touches only what the completion touched, even if something else changed meanwhile.
    expect(planUndo({ values: { ...plan.values, other: 'edited since', extra: 1 } }, plan.previous)).toEqual({
      status: 'doing',
      other: 'edited since',
      extra: 1
    })
    expect(props.values).toEqual({ status: 'doing', other: 'kept' })
  })

  it('works with only one of the two signals', () => {
    const status = detectSignal({ schema: SCHEMA })!
    expect(planCompletion(status, { values: {} })).toEqual({ values: { status: 'done' }, previous: { status: undefined } })
    const checkbox = detectSignal({ schema: { ok: { id: 'ok', name: 'Done', type: 'checkbox' } } as never })!
    expect(planCompletion(checkbox, {})).toEqual({ values: { ok: true }, previous: { ok: undefined } })
    expect(planUndo({ values: { ok: true } }, { ok: undefined })).toEqual({})
    expect(planUndo(null, { __proto__: 1 } as never)).toEqual({})
  })
})

describe('the tasks of a span of days', () => {
  it('are the open rows due within it, earliest first, wherever today falls', () => {
    const blocks = [
      database('db'),
      row('a', 'db', 'Late', { due: { start: '2026-10-20' } }),
      row('b', 'db', 'Early', { due: { start: '2026-10-02' }, prio: 'lo' }),
      row('c', 'db', 'Early and urgent', { due: { start: '2026-10-02' }, prio: 'hi' }),
      row('d', 'db', 'Done', { status: 'done', due: { start: '2026-10-05' } }),
      row('e', 'db', 'Next month', { due: { start: '2026-11-01' } }),
      row('f', 'db', 'No date'),
      row('g', 'db', 'Ends inside', { due: { start: '2026-09-28', end: '2026-10-03' } })
    ]
    const selected = selectTasks(blocks, { today: TODAY, range: { from: '2026-10-01', to: '2026-10-31' } })
    expect(selected.dated?.map((task) => [task.title, task.due])).toEqual([
      ['Early and urgent', '2026-10-02'],
      ['Early', '2026-10-02'],
      ['Ends inside', '2026-10-03'],
      ['Late', '2026-10-20']
    ])
    // Asked for no span, it answers as before.
    expect(Object.keys(selectTasks(blocks, { today: TODAY })).sort()).toEqual(['noDate', 'overdue', 'today'])
  })
})

describe('the built-in Tasks database', () => {
  const builtIn = (): TaskBlock => {
    const props = tasksDatabaseProps()
    const schema = props.schema as Record<string, PropertySchema>
    schema[TASK_PROPS.project] = { ...schema[TASK_PROPS.project], options: [{ id: 'home', name: 'Home', color: 'green' }] }
    schema[TASK_PROPS.labels] = {
      ...schema[TASK_PROPS.labels],
      options: [
        { id: 'calls', name: 'calls', color: 'blue' },
        { id: 'errands', name: 'errands', color: 'pink' }
      ]
    }
    return block(TASKS_DATABASE_ID, 'database', null, props)
  }
  const weekly = JSON.stringify({ rule: 'FREQ=WEEKLY;BYDAY=MO', from: 'due', text: 'every monday' })

  it('gives its rows their project, labels and repeat', () => {
    const selection = selectTasks(
      [
        builtIn(),
        row('a', TASKS_DATABASE_ID, 'Call the bank', {
          [TASK_PROPS.due]: { start: TODAY },
          [TASK_PROPS.project]: 'home',
          [TASK_PROPS.labels]: ['errands', 'gone', 'calls'],
          [TASK_PROPS.recurrence]: weekly
        })
      ],
      { today: TODAY }
    )
    expect(selection.today).toHaveLength(1)
    const [task] = selection.today
    expect(task.project).toEqual({ id: 'home', name: 'Home', color: 'green' })
    expect(task.labels).toEqual([
      { id: 'errands', name: 'errands', color: 'pink' },
      { id: 'calls', name: 'calls', color: 'blue' }
    ])
    expect(task.recurrence).toEqual({ rule: 'FREQ=WEEKLY;BYDAY=MO', from: 'due', text: 'every monday' })
  })

  it('marks its rows by their labels, even with none, and leaves out what they lack', () => {
    const selection = selectTasks(
      [
        builtIn(),
        row('a', TASKS_DATABASE_ID, 'Plain', { [TASK_PROPS.due]: { start: TODAY }, [TASK_PROPS.project]: 'gone' }),
        row('b', TASKS_DATABASE_ID, 'Broken repeat', { [TASK_PROPS.due]: { start: TODAY }, [TASK_PROPS.recurrence]: '{nope' })
      ],
      { today: TODAY }
    )
    for (const task of selection.today) {
      expect(task.labels).toEqual([])
      expect(task).not.toHaveProperty('project')
      expect(task).not.toHaveProperty('recurrence')
    }
  })

  it('carries them into a span of days too', () => {
    const selection = selectTasks(
      [builtIn(), row('a', TASKS_DATABASE_ID, 'Later', { [TASK_PROPS.due]: { start: '2026-10-20' }, [TASK_PROPS.project]: 'home' })],
      { today: TODAY, range: { from: TODAY, to: '2026-10-31' } }
    )
    expect(selection.dated?.[0].project?.name).toBe('Home')
  })

  it('gives other task databases none of them', () => {
    const selection = selectTasks(
      [database('db'), row('a', 'db', 'Other', { due: { start: TODAY }, [TASK_PROPS.project]: 'home', [TASK_PROPS.recurrence]: weekly })],
      { today: TODAY }
    )
    const [task] = selection.today
    expect(task).not.toHaveProperty('labels')
    expect(task).not.toHaveProperty('project')
    expect(task).not.toHaveProperty('recurrence')
  })
})
