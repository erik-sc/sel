import { describe, expect, it } from 'vitest'
import { ACTION_LIMITS, cleanAction, splitActions, type HermanAction } from '../../../shared/actions'
import type { Block, BlockProps, BlockType } from '@shared/types'
import { applyOpsToMap, type BlockMap } from '../store/ops'
import { actionTargets, createdTitles, describeAction, planActions, summarizeActions } from './actions'

const fence = (json: unknown): string => '```sel-actions\n' + (typeof json === 'string' ? json : JSON.stringify(json)) + '\n```'

function block(id: string, type: BlockType, props: BlockProps = {}, extra: Partial<Block> = {}): Block {
  return { id, type, parentId: null, content: [], props, createdAt: 1, updatedAt: 1, trashedAt: null, ...extra }
}

function env(map: BlockMap, currentPageId: string | null = null) {
  let n = 0
  return { currentPageId, get: (id: string) => map[id], newId: () => `new-${++n}` }
}

// ---------------------------------------------------------------------- reading

describe('reading a proposal out of an answer', () => {
  it('tells what is read from what is proposed', () => {
    const answer = `Here is a page for it.\n\n${fence([{ do: 'create-page', title: 'Trip', markdown: '# Plan\n\n```js\nlet a\n```' }])}\n`
    const parsed = splitActions(answer)
    expect(parsed.text).toBe('Here is a page for it.')
    expect(parsed.actions).toEqual([{ do: 'create-page', title: 'Trip', markdown: '# Plan\n\n```js\nlet a\n```' }])
    expect(parsed).toMatchObject({ pending: false, rejected: 0 })
    expect(splitActions('Just an answer with ```js\ncode\n```.')).toMatchObject({ actions: [], pending: false })
  })

  it('hides a block that is still being written', () => {
    const parsed = splitActions('I will make it.\n\n```sel-actions\n[{"do":"create-page","ti')
    expect(parsed).toMatchObject({ text: 'I will make it.', actions: [], pending: true })
  })

  it('takes one block, and nothing from one that does not parse', () => {
    const two = splitActions(`A\n${fence([{ do: 'create-page', title: 'One' }])}\nB\n${fence([{ do: 'create-page', title: 'Two' }])}\nC`)
    expect(two.actions.map((action) => 'title' in action && action.title)).toEqual(['One'])
    expect(two.text).toBe('A\n\nB\n\nC')
    expect(splitActions(fence('[{"do":"create-page",'))).toMatchObject({ actions: [], rejected: 1, text: '' })
    expect(splitActions(fence({ do: 'create-page', title: 'Alone' })).actions).toHaveLength(1)
    const many = splitActions(fence(Array.from({ length: ACTION_LIMITS.actions + 3 }, (_, i) => ({ do: 'create-page', title: `P${i}` }))))
    expect(many.actions).toHaveLength(ACTION_LIMITS.actions)
    expect(many.rejected).toBe(3)
  })

  it('accepts exactly the actions it knows, typed and bounded', () => {
    expect(cleanAction({ do: 'delete-page', page: 'current' })).toBeNull()
    expect(cleanAction({ do: 'create-page', title: '   ' })).toBeNull()
    expect(cleanAction({ do: 'create-page', title: 'X', parent: '../etc' })).toBeNull()
    expect(cleanAction({ do: 'append', page: 'current', markdown: '' })).toBeNull()
    expect(cleanAction({ do: 'add-rows', database: 'current', rows: [] })).toBeNull()
    expect(cleanAction({ do: 'create-page', title: 'A\nB\u0000', icon: 'not an emoji', ref: 'a', extra: 1 })).toEqual({
      do: 'create-page',
      title: 'A B',
      ref: 'a'
    })
    expect(cleanAction({ do: 'create-page', title: 'X', icon: '🧭', parent: '@a' })).toEqual({
      do: 'create-page',
      title: 'X',
      icon: '🧭',
      parent: '@a'
    })
    const db = cleanAction({
      do: 'create-database',
      title: 'Tasks',
      view: 'spreadsheet',
      properties: [{ name: 'Status', type: 'select', options: ['To do', 'To do', 'Done', 7] }, { name: 'Formula', type: 'formula' }, 'x'],
      rows: [{ Name: 'Write', Status: 'To do', Tags: ['a', 3], Nested: { a: 1 }, __proto__: 'x' }, 'x', {}]
    })
    expect(db).toEqual({
      do: 'create-database',
      title: 'Tasks',
      properties: [{ name: 'Status', type: 'select', options: ['To do', 'Done'] }],
      rows: [{ Name: 'Write', Status: 'To do', Tags: ['a'] }]
    })
  })
})

// --------------------------------------------------------------------- planning

describe('carrying out a proposal', () => {
  const page = block('page-1', 'page', { title: [['Projects']] }, { content: ['t1'] })
  const text = block('t1', 'text', { title: [['Hello']] }, { parentId: 'page-1' })
  const base: BlockMap = { [page.id]: page, [text.id]: text }

  it('creates a page with its content, under the page asked for or at the top', () => {
    const actions: HermanAction[] = [
      {
        do: 'create-page',
        title: 'Trip',
        icon: '🧭',
        parent: 'current',
        markdown: '# Plan\n\n- [ ] Book flights\n- [ ] Pack',
        ref: 'trip'
      },
      { do: 'create-page', title: 'Packing', parent: '@trip' },
      { do: 'create-page', title: 'Loose' }
    ]
    const plan = planActions(actions, env(base, page.id))
    expect(plan.skipped).toEqual([])
    const { map } = applyOpsToMap(base, plan.ops)
    const trip = map['new-1']
    expect(trip).toMatchObject({ type: 'page', parentId: page.id, props: { title: [['Trip']], icon: '🧭' } })
    expect(map[page.id].content).toEqual(['t1', 'new-1'])
    expect(trip.content.map((id) => map[id].type)).toEqual(['heading_1', 'to_do', 'to_do', 'page'])
    expect(map[trip.content[3]]).toMatchObject({ props: { title: [['Packing']] } })
    expect(Object.values(map).find((b) => b.props.title?.[0]?.[0] === 'Loose')?.parentId).toBeNull()
    expect(plan.open).toBe('new-1')
    expect(plan.parents).toEqual([page.id, 'new-1', null])
    expect(plan.done[0]).toBe('Created the page “Trip”.')
  })

  it('appends to a page, after what is there and after what it appended before', () => {
    const plan = planActions(
      [
        { do: 'append', page: 'current', markdown: 'One' },
        { do: 'append', page: page.id, markdown: 'Two' }
      ],
      env(base, page.id)
    )
    const { map } = applyOpsToMap(base, plan.ops)
    expect(map[page.id].content.map((id) => map[id].props.title?.[0]?.[0])).toEqual(['Hello', 'One', 'Two'])
    expect(plan.done).toEqual(['Added to “Projects”.', 'Added to “Projects”.'])
  })

  it('creates a database with its properties, a view and typed rows', () => {
    const plan = planActions(
      [
        {
          do: 'create-database',
          title: 'Tasks',
          view: 'board',
          properties: [
            { name: 'Task', type: 'title' },
            { name: 'Status', type: 'select', options: ['To do', 'Done'] },
            { name: 'Due', type: 'date' },
            { name: 'Hours', type: 'number' },
            { name: 'Tags', type: 'multi_select' },
            { name: 'Urgent', type: 'checkbox' }
          ],
          rows: [
            {
              Task: 'Write guide',
              Status: 'Doing',
              Due: '2026-10-20',
              Hours: '2,5',
              Tags: ['docs', 'launch'],
              Urgent: true,
              Unknown: 'dropped'
            },
            { name: 'Book room', status: 'done', Due: 'next week', Hours: 'many', Urgent: 'no' },
            { Unknown: 'only' }
          ]
        }
      ],
      env(base, page.id)
    )
    const { map } = applyOpsToMap(base, plan.ops)
    const db = map['new-1']
    expect(db).toMatchObject({ type: 'database', parentId: null })
    const schema = Object.values(db.props.schema ?? {})
    expect(schema.map((p) => `${p.name}:${p.type}`)).toEqual([
      'Task:title',
      'Status:select',
      'Due:date',
      'Hours:number',
      'Tags:multi_select',
      'Urgent:checkbox'
    ])
    const status = schema[1]
    // An option a row names is added; one that exists is found whatever its case.
    expect(status.options?.map((o) => o.name)).toEqual(['To do', 'Done', 'Doing'])
    expect(db.props.views).toHaveLength(1)
    expect(db.props.views?.[0]).toMatchObject({ type: 'board', groupBy: status.id })
    const [first, second] = db.content.map((id) => map[id])
    expect(db.content).toHaveLength(2)
    const by = (name: string): string => schema.find((p) => p.name === name)?.id ?? ''
    expect(first.props.title).toEqual([['Write guide']])
    expect(first.props.values).toEqual({
      [by('Status')]: status.options?.[2].id,
      [by('Due')]: { start: '2026-10-20' },
      [by('Hours')]: 2.5,
      [by('Tags')]: schema[4].options?.map((o) => o.id),
      [by('Urgent')]: true
    })
    expect(second.props.title).toEqual([['Book room']])
    expect(second.props.values).toEqual({ [by('Status')]: status.options?.[1].id })
    expect(plan.done).toEqual(['Created the database “Tasks” with 2 rows.'])
  })

  it('adds rows to a database that exists, through a linked view too, with new options written to its schema', () => {
    const db = block('db-1', 'database', {
      title: [['Reading']],
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        g: { id: 'g', name: 'Genre', type: 'select', options: [{ id: 'o1', name: 'Essay', color: 'blue' }] }
      }
    })
    const linked = block('view-1', 'database', { sourceId: 'db-1' }, { parentId: page.id })
    const map: BlockMap = { ...base, [db.id]: db, [linked.id]: linked }
    const plan = planActions(
      [
        {
          do: 'add-rows',
          database: 'view-1',
          rows: [
            { Name: 'Walden', Genre: 'essay' },
            { Name: 'Dune', Genre: 'Novel' }
          ]
        }
      ],
      env(map)
    )
    const next = applyOpsToMap(map, plan.ops).map
    expect(next['db-1'].content).toHaveLength(2)
    expect(next['db-1'].props.schema?.['g'].options?.map((o) => o.name)).toEqual(['Essay', 'Novel'])
    expect(next[next['db-1'].content[0]].props.values).toEqual({ g: 'o1' })
    expect(plan.done).toEqual(['Added 2 rows to “Reading”.'])
    expect(plan.open).toBe('view-1')
    // Nothing new in the schema: it is not rewritten.
    expect(planActions([{ do: 'add-rows', database: 'db-1', rows: [{ Name: 'Emerson', Genre: 'Essay' }] }], env(map)).ops).toHaveLength(1)
  })

  it('skips what it cannot place, says so, and still does the rest', () => {
    const trashed = block('page-2', 'page', { title: [['Old']] }, { trashedAt: 9 })
    const map: BlockMap = { ...base, [trashed.id]: trashed }
    const plan = planActions(
      [
        { do: 'create-page', title: 'A', parent: 'page-2' },
        { do: 'create-page', title: 'B', parent: 'missing-id-0000' },
        { do: 'create-page', title: 'C', parent: 't1' },
        { do: 'append', page: 'current', markdown: 'x' },
        { do: 'add-rows', database: page.id, rows: [{ Name: 'x' }] },
        { do: 'add-rows', database: '@nothing', rows: [{ Name: 'x' }] },
        { do: 'create-page', title: 'Kept' }
      ],
      env(map)
    )
    expect(plan.ops).toHaveLength(1)
    expect(plan.done).toEqual(['Created the page “Kept”.'])
    expect(plan.skipped).toHaveLength(6)
    expect(planActions([], env(base))).toMatchObject({ ops: [], open: null })
  })

  it('names what it will touch before anything is done', () => {
    const actions: HermanAction[] = [
      { do: 'create-page', title: 'Trip', parent: 'current', ref: 'a' },
      { do: 'append', page: '@a', markdown: 'x' },
      { do: 'add-rows', database: 'db-9', rows: [{ Name: 'x' }, { Name: 'y' }] }
    ]
    expect(actionTargets(actions, page.id)).toEqual([page.id, 'db-9'])
    expect(actionTargets(actions, null)).toEqual(['db-9'])
    const look = { currentPageId: page.id, get: (id: string) => base[id] }
    expect(actions.map((action) => describeAction(action, look))).toEqual([
      'Create the page “Trip” in “Projects”',
      'Add to the page created above',
      'Add 2 rows to a database'
    ])
  })
})

// ---------------------------------------------------------------------- putting in order

describe('putting a workspace in order', () => {
  const home = block('home-1', 'page', { title: [['Home']] }, { content: ['note-1', 'note-2'] })
  const note1 = block('note-1', 'page', { title: [['Meeting notes']] }, { parentId: 'home-1' })
  const note2 = block('note-2', 'page', { title: [['Untitled']] }, { parentId: 'home-1', content: ['child-1'] })
  const child = block('child-1', 'page', { title: [['Inside']] }, { parentId: 'note-2' })
  const db = block(
    'db-1',
    'database',
    {
      title: [['Tasks']],
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        s: { id: 's', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'To do', color: 'blue' }] },
        n: { id: 'n', name: 'Notes', type: 'text' }
      }
    },
    { content: ['row-1', 'row-2'] }
  )
  const row1 = block('row-1', 'page', { title: [['Write']], values: { s: 'o1', n: 'draft' } }, { parentId: 'db-1' })
  const row2 = block('row-2', 'page', { title: [['Read']] }, { parentId: 'db-1' })
  const base: BlockMap = {
    [home.id]: home,
    [note1.id]: note1,
    [note2.id]: note2,
    [child.id]: child,
    [db.id]: db,
    [row1.id]: row1,
    [row2.id]: row2
  }

  it('reads the organizing actions, strictly', () => {
    expect(cleanAction({ do: 'move', page: 'note-0001', parent: 'top' })).toEqual({ do: 'move', page: 'note-0001', parent: null })
    expect(cleanAction({ do: 'move', page: 'note-0001' })).toEqual({ do: 'move', page: 'note-0001', parent: null })
    expect(cleanAction({ do: 'move', page: 'note-0001', parent: '@area' })).toEqual({ do: 'move', page: 'note-0001', parent: '@area' })
    expect(cleanAction({ do: 'move', page: 'note-0001', parent: '../x' })).toBeNull()
    expect(cleanAction({ do: 'move', page: 'note-0001', parent: 'note-0001' })).toBeNull()
    expect(cleanAction({ do: 'update-page', page: 'note-0002', title: ' Ideas\n', icon: '💡', extra: 1 })).toEqual({
      do: 'update-page',
      page: 'note-0002',
      title: 'Ideas',
      icon: '💡'
    })
    expect(cleanAction({ do: 'update-page', page: 'note-0002', icon: 'nope' })).toBeNull()
    expect(cleanAction({ do: 'trash', page: '@a' })).toBeNull()
    expect(cleanAction({ do: 'trash', page: 'note-0001' })).toEqual({ do: 'trash', page: 'note-0001' })
    expect(
      cleanAction({
        do: 'update-rows',
        database: 'db-00001',
        rows: [{ id: 'row-00001', Status: 'Done' }, { Status: 'no id' }, { id: '@x', Status: 'ref' }, { id: 'row-00002' }]
      })
    ).toEqual({
      do: 'update-rows',
      database: 'db-00001',
      rows: [{ id: 'row-00001', Status: 'Done' }]
    })
    expect(
      cleanAction({
        do: 'add-properties',
        database: 'db-00001',
        properties: [
          { name: 'Due', type: 'date' },
          { name: 'Again', type: 'title' }
        ]
      })
    ).toEqual({
      do: 'add-properties',
      database: 'db-00001',
      properties: [{ name: 'Due', type: 'date' }]
    })
  })

  it('makes areas, moves pages into them, renames and clears away, in one batch', () => {
    const actions: HermanAction[] = [
      { do: 'create-page', title: 'Archive', icon: '📦', ref: 'archive' },
      { do: 'move', page: 'note-1', parent: '@archive' },
      { do: 'update-page', page: 'note-2', title: 'Ideas', icon: '💡' },
      { do: 'move', page: 'note-2', parent: null },
      { do: 'trash', page: 'child-1' }
    ]
    const plan = planActions(actions, env(base))
    expect(plan.skipped).toEqual([])
    const { map } = applyOpsToMap(base, plan.ops)
    expect(map['note-1'].parentId).toBe('new-1')
    expect(map['new-1'].content).toEqual(['note-1'])
    expect(map['home-1'].content).toEqual([])
    expect(map['note-2']).toMatchObject({ parentId: null, props: { title: [['Ideas']], icon: '💡' } })
    expect(map['child-1'].trashedAt).not.toBeNull()
    expect(plan.done).toEqual([
      'Created the page “Archive”.',
      'Moved “Meeting notes” into “Archive”.',
      'Renamed “Untitled” to “Ideas”.',
      'Moved “Ideas” to the top level.',
      'Moved “Inside” to the Trash.'
    ])
    // Where pages left from is read again afterwards; the sidebar opens where they went.
    expect(plan.refresh).toEqual(['home-1', 'note-2'])
    expect(plan.parents).toEqual(expect.arrayContaining([null, 'new-1', 'home-1', 'note-2']))
  })

  it('never moves a page into itself, nor twice into the same place, nor after it went to the Trash', () => {
    const plan = planActions(
      [
        { do: 'move', page: 'note-2', parent: 'child-1' },
        { do: 'move', page: 'note-1', parent: 'home-1' },
        { do: 'trash', page: 'note-1' },
        { do: 'move', page: 'note-1', parent: null },
        { do: 'trash', page: 'note-1' },
        { do: 'move', page: 'missing-id-0000', parent: null },
        { do: 'move', page: 'note-1', parent: 'missing-id-0000' }
      ],
      env(base)
    )
    expect(plan.ops).toEqual([{ op: 'delete', id: 'note-1' }])
    expect(plan.skipped).toEqual([
      '“Untitled” was not moved: it cannot go inside itself.',
      '“Meeting notes” is already there.',
      'Nothing was moved: the page was not found.',
      'Nothing was put in the Trash: the page was not found.',
      'Nothing was moved: the page was not found.',
      'Nothing was moved: the page was not found.'
    ])
  })

  it('changes rows that exist, keeping their other values, and adds properties once', () => {
    const plan = planActions(
      [
        {
          do: 'add-properties',
          database: 'db-1',
          properties: [
            { name: 'Due', type: 'date' },
            { name: 'status', type: 'select' }
          ]
        },
        {
          do: 'update-rows',
          database: 'db-1',
          rows: [
            { id: 'row-1', Status: 'Done' },
            { id: 'row-2', Name: 'Read twice', Notes: 'slowly' },
            { id: 'note-1', Status: 'Done' }
          ]
        }
      ],
      env(base)
    )
    const { map } = applyOpsToMap(base, plan.ops)
    const schema = Object.values(map['db-1'].props.schema ?? {})
    expect(schema.map((p) => p.name)).toEqual(['Name', 'Status', 'Notes', 'Due'])
    const done = schema[1].options?.find((o) => o.name === 'Done')?.id
    expect(map['row-1'].props).toMatchObject({ title: [['Write']], values: { s: done, n: 'draft' } })
    expect(map['row-2'].props).toMatchObject({ title: [['Read twice']], values: { n: 'slowly' } })
    expect(plan.done).toEqual(['Added “Due” to “Tasks”.', 'Changed 2 rows of “Tasks”.'])
    expect(plan.skipped).toEqual(['1 row of “Tasks” was not found.'])
  })

  it('says what it will do, one line each and in sum', () => {
    const look = { currentPageId: null, get: (id: string) => base[id] }
    const actions: HermanAction[] = [
      { do: 'move', page: 'note-1', parent: null },
      { do: 'move', page: 'note-2', parent: '@a' },
      { do: 'update-page', page: 'note-2', title: 'Ideas' },
      { do: 'trash', page: 'child-1' },
      { do: 'update-rows', database: 'db-1', rows: [{ id: 'row-1', Status: 'Done' }] },
      { do: 'add-properties', database: 'db-1', properties: [{ name: 'Due', type: 'date' }] }
    ]
    expect(actions.map((action) => describeAction(action, look))).toEqual([
      'Move “Meeting notes” to the top level',
      'Move “Untitled” into the page created above',
      'Rename “Untitled” to “Ideas”',
      'Move “Inside” to the Trash',
      'Change 1 row of “Tasks”',
      'Add “Due” to “Tasks”'
    ])
    expect(summarizeActions(actions)).toBe('2 moved, 1 renamed, 1 to the Trash, 1 row changed, 1 property added')
    // What an earlier action of the same proposal creates is named by its title; a database nobody loaded is a database.
    const created = createdTitles([{ do: 'create-page', title: 'Archive', ref: 'a' }])
    expect(describeAction(actions[1], look, created)).toBe('Move “Untitled” into “Archive”')
    expect(describeAction({ do: 'add-rows', database: 'db-unknown', rows: [{ Name: 'x' }] }, look)).toBe('Add 1 row to a database')
    expect(
      summarizeActions([
        { do: 'create-page', title: 'A' },
        { do: 'create-page', title: 'B' }
      ])
    ).toBe('2 pages created')
    expect(actionTargets(actions, null)).toEqual(['note-1', 'note-2', 'child-1', 'db-1', 'row-1'])
  })
})
