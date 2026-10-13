import { describe, expect, it } from 'vitest'
import { ACTION_LIMITS, cleanAction, splitActions, type HermanAction } from '../../../shared/actions'
import type { Block, BlockProps, BlockType } from '@shared/types'
import { applyOpsToMap, type BlockMap } from '../store/ops'
import { actionTargets, describeAction, planActions } from './actions'

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
    expect(cleanAction({ do: 'create-page', title: 'A\nB\u0000', icon: 'not an emoji', ref: 'a', extra: 1 })).toEqual({ do: 'create-page', title: 'A B', ref: 'a' })
    expect(cleanAction({ do: 'create-page', title: 'X', icon: '🧭', parent: '@a' })).toEqual({ do: 'create-page', title: 'X', icon: '🧭', parent: '@a' })
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
      { do: 'create-page', title: 'Trip', icon: '🧭', parent: 'current', markdown: '# Plan\n\n- [ ] Book flights\n- [ ] Pack', ref: 'trip' },
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
            { Task: 'Write guide', Status: 'Doing', Due: '2026-10-20', Hours: '2,5', Tags: ['docs', 'launch'], Urgent: true, Unknown: 'dropped' },
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
    expect(schema.map((p) => `${p.name}:${p.type}`)).toEqual(['Task:title', 'Status:select', 'Due:date', 'Hours:number', 'Tags:multi_select', 'Urgent:checkbox'])
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
    const plan = planActions([{ do: 'add-rows', database: 'view-1', rows: [{ Name: 'Walden', Genre: 'essay' }, { Name: 'Dune', Genre: 'Novel' }] }], env(map))
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
    expect(actions.map((action) => describeAction(action, look))).toEqual(['Create the page “Trip” in “Projects”', 'Add to the page created above', 'Add 2 rows to a page'])
  })
})
