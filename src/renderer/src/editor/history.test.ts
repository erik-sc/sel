import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType, Op } from '@shared/types'
import { History } from './history'
import { Overlay, insertAfter, invertOps } from './ops'

function block(id: string, type: BlockType, parentId: string | null, content: string[] = [], props: BlockProps = {}): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

function world(): Map<string, Block> {
  const list = [
    block('page', 'page', null, ['a', 'b', 'c']),
    block('a', 'text', 'page', [], { title: [['A']] }),
    block('b', 'toggle', 'page', ['b1', 'b2'], { title: [['B']] }),
    block('b1', 'text', 'b', [], { title: [['B1']] }),
    block('b2', 'to_do', 'b', [], { title: [['B2']], checked: true }),
    block('c', 'page', 'page', ['inner'], { title: [['Sub']] }),
    block('inner', 'text', 'c', [])
  ]
  return new Map(list.map((b) => [b.id, b]))
}

/** Applies ops to a plain map the way the backend would, via the overlay. */
function run(map: Map<string, Block>, ops: Op[]): Map<string, Block> {
  const ov = new Overlay((id) => map.get(id))
  for (const op of ops) ov.apply(op)
  const ids = new Set<string>(map.keys())
  for (const op of ops) if (op.op === 'create' && op.input.id) ids.add(op.input.id)
  const out = new Map<string, Block>()
  for (const id of ids) {
    const b = ov.get(id)
    if (b) out.set(id, b)
  }
  return out
}

function shape(map: Map<string, Block>): unknown {
  return [...map.values()]
    .map((b) => ({ id: b.id, type: b.type, parentId: b.parentId, content: b.content, props: b.props }))
    .sort((x, y) => x.id.localeCompare(y.id))
}

function roundTrip(ops: Op[]): void {
  const before = world()
  const { inverse } = invertOps(ops, (id) => before.get(id))
  const after = run(before, ops)
  expect(shape(after)).not.toEqual(shape(before))
  expect(shape(run(after, inverse))).toEqual(shape(before))
}

describe('insertAfter', () => {
  it('null = first, undefined = append, id = after it', () => {
    const list = ['a', 'b']
    insertAfter(list, 'x', null)
    insertAfter(list, 'y', undefined)
    insertAfter(list, 'z', 'a')
    insertAfter(list, 'w', 'missing')
    expect(list).toEqual(['x', 'a', 'z', 'b', 'y', 'w'])
  })
})

describe('invertOps', () => {
  it('inverts a create', () => {
    roundTrip([{ op: 'create', input: { id: 'n', type: 'text', parentId: 'page', afterId: 'a', props: { title: [['N']] } } }])
  })

  it('inverts an update, removing props that did not exist and restoring the type', () => {
    const before = world()
    const ops: Op[] = [{ op: 'update', id: 'a', patch: { type: 'to_do', props: { title: [['A!']], checked: true } } }]
    const { inverse } = invertOps(ops, (id) => before.get(id))
    expect(inverse).toEqual([{ op: 'update', id: 'a', patch: { type: 'text', props: { title: [['A']], checked: null } } }])
    roundTrip(ops)
  })

  it('inverts moves back to the previous sibling position', () => {
    roundTrip([{ op: 'move', id: 'a', parentId: 'b', afterId: 'b1' }])
    roundTrip([{ op: 'move', id: 'b2', parentId: 'page', afterId: null }])
    roundTrip([{ op: 'move', id: 'b', parentId: 'page', afterId: null }])
  })

  it('inverts a delete by recreating the whole subtree in place', () => {
    const before = world()
    const ops: Op[] = [{ op: 'delete', id: 'b' }]
    const { inverse, restore } = invertOps(ops, (id) => before.get(id))
    expect(restore).toEqual([])
    expect(inverse.map((o) => (o.op === 'create' ? [o.input.id, o.input.parentId, o.input.afterId] : o.op))).toEqual([
      ['b', 'page', 'a'],
      ['b1', 'b', undefined],
      ['b2', 'b', undefined]
    ])
    roundTrip(ops)
  })

  it('marks trashed pages for restore instead of recreating them', () => {
    const before = world()
    const { inverse, restore } = invertOps([{ op: 'delete', id: 'c' }], (id) => before.get(id))
    expect(restore).toEqual(['c'])
    expect(inverse).toEqual([{ op: 'move', id: 'c', parentId: 'page', afterId: 'b' }])
  })

  it('inverts a batch whose ops depend on each other (split, merge, indent chain)', () => {
    // split
    roundTrip([
      { op: 'update', id: 'a', patch: { props: { title: [['A']] } } },
      { op: 'create', input: { id: 'n', type: 'text', parentId: 'page', afterId: 'a', props: { title: [['rest']] } } },
      { op: 'move', id: 'n', parentId: 'b', afterId: 'b2' }
    ])
    // merge b1 into a, hoisting nothing, then delete
    roundTrip([
      { op: 'update', id: 'a', patch: { props: { title: [['AB1']] } } },
      { op: 'delete', id: 'b1' }
    ])
    // hoist children then delete the parent
    roundTrip([
      { op: 'move', id: 'b1', parentId: 'page', afterId: 'b' },
      { op: 'move', id: 'b2', parentId: 'page', afterId: 'b1' },
      { op: 'delete', id: 'b' }
    ])
    // chained moves
    roundTrip([
      { op: 'move', id: 'a', parentId: 'b', afterId: 'b2' },
      { op: 'move', id: 'b1', parentId: 'page', afterId: null },
      { op: 'update', id: 'b', patch: { props: { collapsed: true } } }
    ])
  })

  it('re-attaches nested pages instead of recreating them', () => {
    const before = world()
    before.set('b', { ...before.get('b')!, content: ['b1', 'c'] })
    before.set('c', { ...before.get('c')!, parentId: 'b' })
    const { inverse } = invertOps([{ op: 'delete', id: 'b' }], (id) => before.get(id))
    expect(inverse.map((o) => o.op)).toEqual(['create', 'create', 'move'])
    expect(inverse[2]).toEqual({ op: 'move', id: 'c', parentId: 'b', afterId: undefined })
  })

  it('recreates a deleted linked database view (it is hard-deleted), not its source', () => {
    const map = world()
    map.set('page', block('page', 'page', null, ['a', 'db', 'lv', 'b', 'c']))
    map.set('db', block('db', 'database', 'page', ['row'], { title: [['Tasks']] }))
    map.set('row', block('row', 'page', 'db', [], { title: [['Row']] }))
    const views = [{ id: 'v', name: 'Table', type: 'table' as const, visibleProperties: ['title'], filters: [], sorts: [] }]
    map.set('lv', block('lv', 'database', 'page', [], { sourceId: 'db', views, title: [['Mine']] }))
    const before = shape(map)

    const ops: Op[] = [{ op: 'delete', id: 'lv' }]
    const { inverse, restore } = invertOps(ops, (id) => map.get(id))
    // Nothing to restore from the trash: the view comes back through a create, link and views intact.
    expect(restore).toEqual([])
    expect(inverse).toEqual([
      {
        op: 'create',
        input: { id: 'lv', type: 'database', parentId: 'page', afterId: 'db', props: { sourceId: 'db', views, title: [['Mine']] } }
      }
    ])
    const after = run(map, ops)
    expect(after.has('lv')).toBe(false)
    expect(after.get('db')).toEqual(map.get('db'))
    expect(after.get('row')).toEqual(map.get('row'))
    expect(shape(run(after, inverse))).toEqual(before)

    // The source is still a container: trashed in place and restored, never recreated.
    const source = invertOps([{ op: 'delete', id: 'db' }], (id) => map.get(id))
    expect(source.restore).toEqual(['db'])
    expect(source.inverse).toEqual([{ op: 'move', id: 'db', parentId: 'page', afterId: 'a' }])
  })

  it('recreates a linked view nested in a deleted block along with it', () => {
    const map = world()
    map.set('b', block('b', 'toggle', 'page', ['b1', 'lv'], { title: [['B']] }))
    map.delete('b2')
    map.set('lv', block('lv', 'database', 'b', [], { sourceId: 'c', views: [] }))
    const before = shape(map)
    const ops: Op[] = [{ op: 'delete', id: 'b' }]
    const { inverse, restore } = invertOps(ops, (id) => map.get(id))
    expect(restore).toEqual([])
    expect(inverse.map((op) => (op.op === 'create' ? op.input.id : op.op))).toEqual(['b', 'b1', 'lv'])
    const after = run(map, ops)
    expect(after.has('lv')).toBe(false)
    expect(shape(run(after, inverse))).toEqual(before)
  })

  it('ignores ops on unknown blocks', () => {
    const before = world()
    expect(invertOps([{ op: 'update', id: 'nope', patch: { props: { title: [] } } }], (id) => before.get(id)).inverse).toEqual([])
  })
})

describe('History', () => {
  const up = (id: string, text: string): Op[] => [{ op: 'update', id, patch: { props: { title: [[text]] } } }]

  it('undo and redo walk the stack', () => {
    const h = new History<string>()
    h.commit(up('a', '1'), up('a', '0'), 's0', 's1')
    h.commit(up('a', '2'), up('a', '1'), 's1', 's2')
    expect(h.canUndo).toBe(true)
    expect(h.undo()?.inverse).toEqual(up('a', '1'))
    expect(h.undo()?.before).toBe('s0')
    expect(h.undo()).toBeUndefined()
    expect(h.redo()?.ops).toEqual(up('a', '1'))
    expect(h.redo()?.after).toBe('s2')
    expect(h.canRedo).toBe(false)
  })

  it('a new commit clears the redo stack', () => {
    const h = new History<null>()
    h.commit(up('a', '1'), up('a', '0'), null, null)
    h.undo()
    h.commit(up('a', 'x'), up('a', '0'), null, null)
    expect(h.canRedo).toBe(false)
  })

  it('ignores empty batches', () => {
    const h = new History<null>()
    h.commit([], [], null, null)
    expect(h.canUndo).toBe(false)
  })

  it('coalesces typing in the same block into one entry per pause', () => {
    const h = new History<number>(1000)
    h.commit(up('a', 'h'), up('a', ''), 0, 1, { key: 'text:a', now: 0 })
    h.commit(up('a', 'he'), up('a', 'h'), 1, 2, { key: 'text:a', now: 400 })
    h.commit(up('a', 'hel'), up('a', 'he'), 2, 3, { key: 'text:a', now: 900 })
    // pause
    h.commit(up('a', 'hello'), up('a', 'hel'), 3, 5, { key: 'text:a', now: 5000 })
    const second = h.undo()
    expect(second?.inverse).toEqual(up('a', 'hel'))
    const first = h.undo()
    expect(first).toMatchObject({ ops: up('a', 'hel'), inverse: up('a', ''), before: 0, after: 3 })
    expect(h.canUndo).toBe(false)
  })

  it('does not coalesce different keys, keyless commits, or across undo', () => {
    const h = new History<null>(1000)
    h.commit(up('a', '1'), up('a', ''), null, null, { key: 'text:a', now: 0 })
    h.commit(up('b', '1'), up('b', ''), null, null, { key: 'text:b', now: 10 })
    h.commit(up('b', '2'), up('b', '1'), null, null, { now: 20 })
    h.commit(up('b', '3'), up('b', '2'), null, null, { key: 'text:b', now: 30 })
    h.undo()
    h.redo()
    h.commit(up('b', '4'), up('b', '3'), null, null, { key: 'text:b', now: 40 })
    let count = 0
    while (h.undo()) count++
    expect(count).toBe(5)
  })

  it('concatenates inverses when coalesced batches differ in shape', () => {
    const h = new History<null>(1000)
    const create: Op[] = [{ op: 'create', input: { id: 'n', type: 'text', parentId: 'page' } }]
    h.commit(up('a', '1'), up('a', '0'), null, null, { key: 'k', now: 0 })
    h.commit(create, [{ op: 'delete', id: 'n' }], null, null, { key: 'k', now: 1 })
    const e = h.undo()
    expect(e?.ops).toEqual([...up('a', '1'), ...create])
    expect(e?.inverse).toEqual([{ op: 'delete', id: 'n' }, ...up('a', '0')])
  })

  it('seal forces a new entry', () => {
    const h = new History<null>(1000)
    h.commit(up('a', '1'), up('a', '0'), null, null, { key: 'k', now: 0 })
    h.seal()
    h.commit(up('a', '2'), up('a', '1'), null, null, { key: 'k', now: 1 })
    expect(h.undo()?.inverse).toEqual(up('a', '1'))
    expect(h.canUndo).toBe(true)
  })
})
