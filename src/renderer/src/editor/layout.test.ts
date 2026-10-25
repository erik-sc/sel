import { describe, expect, it } from 'vitest'
import type { Block, Op } from '../../../shared/types'
import { applyOpsToMap, type BlockMap } from '../store/ops'
import { MAX_BESIDE, besideChoice, canShareRow, rowRepairOps, rowWidth, rowsOf, sitsBeside } from './layout'
import { invertOps } from './ops'

const block = (id: string, type: Block['type'], beside = false): Block =>
  ({ id, type, parentId: 'p', content: [], props: beside ? { beside: true } : {}, createdAt: 0, updatedAt: 0, trashedAt: null }) as Block

const ids = (rows: Block[][]): string[][] => rows.map((row) => row.map((b) => b.id))

describe('blocks side by side', () => {
  it('lets only database blocks share a row below the top of a page', () => {
    expect(canShareRow(block('a', 'database'))).toBe(true)
    expect(canShareRow(block('a', 'text', true))).toBe(false)
    expect(canShareRow(undefined)).toBe(false)
    expect(sitsBeside(block('b', 'database', true), block('a', 'database'))).toBe(true)
    expect(sitsBeside(block('b', 'database'), block('a', 'database'))).toBe(false)
    expect(sitsBeside(block('b', 'database', true), block('a', 'text'))).toBe(false)
    expect(sitsBeside(block('b', 'database', true), undefined)).toBe(false)
    expect(sitsBeside(block('b', 'image', true), block('a', 'database'))).toBe(false)
  })

  it('puts a database block beside the one before it when it asks to', () => {
    const blocks = [
      block('t', 'text'),
      block('a', 'database'),
      block('b', 'database', true),
      block('c', 'database', true),
      block('u', 'text'),
      block('d', 'database')
    ]
    expect(ids(rowsOf(blocks))).toEqual([['t'], ['a', 'b', 'c'], ['u'], ['d']])
  })

  it('ignores the wish of a block that has nothing to sit beside', () => {
    expect(ids(rowsOf([block('a', 'database', true), block('t', 'text'), block('b', 'database', true)]))).toEqual([['a'], ['t'], ['b']])
    expect(ids(rowsOf([block('a', 'database'), block('b', 'database')]))).toEqual([['a'], ['b']])
    expect(rowsOf([])).toEqual([])
  })

  it('starts a new row once one is full', () => {
    const many = Array.from({ length: MAX_BESIDE + 2 }, (_, i) => block(`d${i}`, 'database', true))
    const rows = rowsOf(many)
    expect(rows.map((row) => row.length)).toEqual([MAX_BESIDE, 2])
    // The block that could not fit leads the next row, and the one after it sits beside it.
    expect(rows[1][0].id).toBe(`d${MAX_BESIDE}`)
  })
})

describe('the choice the block menu offers', () => {
  it('offers to join the row before, to leave a row, or nothing', () => {
    const blocks = [
      block('t', 'text'),
      block('a', 'database'),
      block('b', 'database', true),
      block('c', 'database'),
      block('u', 'text', true)
    ]
    expect(besideChoice(blocks, 'b')).toBe('below')
    expect(besideChoice(blocks, 'c')).toBe('beside')
    // The first database has nothing to sit beside; nested text never shares a row.
    expect(besideChoice(blocks, 'a')).toBeNull()
    expect(besideChoice(blocks, 't')).toBeNull()
    expect(besideChoice(blocks, 'u')).toBeNull()
    expect(besideChoice(blocks, 'missing')).toBeNull()
  })

  it('offers nothing when the row before is full', () => {
    const full = Array.from({ length: MAX_BESIDE }, (_, i) => block(`d${i}`, 'database', i > 0))
    expect(besideChoice([...full, block('e', 'database')], 'e')).toBeNull()
    // Marked, but pushed into a row of its own: there is nothing to undo either.
    expect(besideChoice([...full, block('e', 'database', true)], 'e')).toBeNull()
  })
})

// ---------------------------------------------------------------- 0.9.0 A1a: any block

describe('any block beside another, at the top of a page', () => {
  const top = { top: true }

  it('puts two text blocks in one row when the second asks to', () => {
    expect(canShareRow(block('a', 'text'), true)).toBe(true)
    expect(ids(rowsOf([block('a', 'text'), block('b', 'text', true)], top))).toEqual([['a', 'b']])
  })

  it('never lets a sub-page block join a row', () => {
    expect(canShareRow(block('s', 'page'), true)).toBe(false)
    expect(ids(rowsOf([block('a', 'text'), block('s', 'page', true), block('b', 'text', true)], top))).toEqual([['a'], ['s'], ['b']])
  })

  it('keeps nested blocks one under the other; databases still share rows there', () => {
    expect(ids(rowsOf([block('a', 'text'), block('b', 'text', true)]))).toEqual([['a'], ['b']])
    expect(ids(rowsOf([block('a', 'database'), block('b', 'database', true), block('c', 'text', true)]))).toEqual([['a', 'b'], ['c']])
  })

  it('starts a new row with the fifth block', () => {
    const five = Array.from({ length: 5 }, (_, i) => block(`b${i}`, i % 2 ? 'callout' : 'text', i > 0))
    expect(ids(rowsOf(five, top))).toEqual([['b0', 'b1', 'b2', 'b3'], ['b4']])
  })

  it('mixes text and databases in one row', () => {
    expect(ids(rowsOf([block('t', 'text'), block('d', 'database', true), block('u', 'to_do', true)], top))).toEqual([['t', 'd', 'u']])
  })

  it('offers a text block the row before it, and the way out, but not into a full row', () => {
    const blocks = [block('h', 'heading_2'), block('t', 'text'), block('u', 'text', true)]
    expect(besideChoice(blocks, 't', top)).toBe('beside')
    expect(besideChoice(blocks, 'u', top)).toBe('below')
    expect(besideChoice(blocks, 'h', top)).toBeNull()
    // Nested, a text block is offered nothing.
    expect(besideChoice(blocks, 't')).toBeNull()
    const full = Array.from({ length: MAX_BESIDE }, (_, i) => block(`c${i}`, 'text', i > 0))
    expect(besideChoice([...full, block('e', 'text')], 'e', top)).toBeNull()
    expect(besideChoice([block('a', 'text'), block('s', 'page')], 's', top)).toBeNull()
  })
})

describe('how wide a row is drawn', () => {
  it('keeps the text width for 2 blocks, and takes the database width for 3 or 4 or with a database', () => {
    expect(rowWidth([block('a', 'text'), block('b', 'text', true)])).toBe('text')
    expect(rowWidth([block('a', 'text'), block('b', 'text', true), block('c', 'text', true)])).toBe('wide')
    expect(rowWidth([block('a', 'text'), block('d', 'database', true)])).toBe('wide')
    expect(rowWidth(Array.from({ length: 4 }, (_, i) => block(`b${i}`, 'text', i > 0)))).toBe('wide')
  })
})

describe('a page saved with columns, opened by 0.8.0', () => {
  // The rule of 0.8.0, copied here: only database blocks share a row.
  const oldRowsOf = <T extends Pick<Block, 'type' | 'props'>>(blocks: readonly T[]): T[][] => {
    const old = (b: T | undefined): boolean => !!b && b.type === 'database'
    const rows: T[][] = []
    for (const b of blocks) {
      const row = rows[rows.length - 1]
      if (row && row.length < MAX_BESIDE && old(b) && old(row[row.length - 1]) && b.props.beside === true) row.push(b)
      else rows.push([b])
    }
    return rows
  }

  it('lists the same blocks in the same order, the text columns one under the other', () => {
    const page = [
      block('h', 'heading_1'),
      block('t', 'text'),
      block('c', 'callout', true),
      block('a', 'database'),
      block('b', 'database', true),
      block('u', 'to_do', true),
      block('s', 'page'),
      block('v', 'quote', true)
    ]
    const now = rowsOf(page, { top: true })
    const then = oldRowsOf(page)
    expect(ids(now)).toEqual([['h'], ['t', 'c'], ['a', 'b', 'u'], ['s'], ['v']])
    expect(ids(then)).toEqual([['h'], ['t'], ['c'], ['a', 'b'], ['u'], ['s'], ['v']])
    expect(now.flat()).toEqual(then.flat())
  })

  it('draws a database that 0.8.0 left marked beside a text block in that row (accepted, decisions.md)', () => {
    const page = [block('a', 'database'), block('t', 'text'), block('b', 'database', true)]
    expect(ids(oldRowsOf(page))).toEqual([['a'], ['t'], ['b']])
    expect(ids(rowsOf(page, { top: true }))).toEqual([['a'], ['t', 'b']])
  })
})

// ------------------------------------------------------------------- row repair

function pageOf(list: Block[]): BlockMap {
  const kids = list.filter((b) => b.parentId === 'p').map((b) => b.id)
  const page: Block = { ...block('p', 'page'), parentId: null, content: kids }
  return Object.fromEntries([page, ...list].map((b) => [b.id, b]))
}

const under = (b: Block, parentId: string): Block => ({ ...b, parentId })

/** Rows of the page's own blocks, by id. */
function rowsIn(map: BlockMap): string[][] {
  const kids = map.p.content.map((id) => map[id]).filter((b) => b && !b.trashedAt)
  return ids(rowsOf(kids, { top: true }))
}

/** Applies `ops` and their repair, checks that undoing both restores the page, and returns the page after. */
function commitWithRepair(before: BlockMap, ops: Op[]): { after: BlockMap; repair: Op[] } {
  const repair = rowRepairOps(ops, (id) => before[id])
  const batch = [...ops, ...repair]
  const after = applyOpsToMap(before, batch).map
  const { inverse } = invertOps(batch, (id) => before[id])
  const undone = applyOpsToMap(after, inverse).map
  expect(rowsIn(undone)).toEqual(rowsIn(before))
  for (const id of Object.keys(before)) expect(undone[id]?.props.beside).toBe(before[id].props.beside)
  return { after, repair }
}

const clears = (id: string): Op => ({ op: 'update', id, patch: { props: { beside: null } } })

describe('repairing a row when its blocks move', () => {
  // [h | x | y], then z on its own
  const row = (): BlockMap => pageOf([block('h', 'text'), block('x', 'text', true), block('y', 'callout', true), block('z', 'text')])

  it('makes the next block the head when the head is deleted', () => {
    const { after, repair } = commitWithRepair(row(), [{ op: 'delete', id: 'h' }])
    expect(repair).toEqual([clears('x')])
    expect(rowsIn(after)).toEqual([['x', 'y'], ['z']])
  })

  it('makes the next block the head when the head is moved elsewhere', () => {
    const { after, repair } = commitWithRepair(row(), [{ op: 'move', id: 'h', parentId: 'p', afterId: 'z' }])
    expect(repair).toEqual([clears('x')])
    expect(rowsIn(after)).toEqual([['x', 'y'], ['z'], ['h']])
  })

  it('makes the next block the head when the head is indented into the block above', () => {
    const before = pageOf([block('a', 'text'), block('h', 'text'), block('x', 'text', true), block('y', 'text', true)])
    const { after, repair } = commitWithRepair(before, [{ op: 'move', id: 'h', parentId: 'a', afterId: null }])
    expect(repair).toEqual([clears('x')])
    expect(rowsIn(after)).toEqual([['a'], ['x', 'y']])
  })

  it('takes the mark off a block that stops being top level', () => {
    const { after, repair } = commitWithRepair(row(), [{ op: 'move', id: 'x', parentId: 'h', afterId: null }])
    expect(repair).toEqual([clears('x')])
    expect(after.x.props.beside).toBeUndefined()
    // y now sits beside h, which was in its row: the row holds.
    expect(rowsIn(after)).toEqual([['h', 'y'], ['z']])
  })

  it('repairs nothing when a middle block is deleted', () => {
    const { after, repair } = commitWithRepair(row(), [{ op: 'delete', id: 'x' }])
    expect(repair).toEqual([])
    expect(rowsIn(after)).toEqual([['h', 'y'], ['z']])
  })

  it('repairs nothing when the last block is deleted', () => {
    const { after, repair } = commitWithRepair(row(), [{ op: 'delete', id: 'y' }])
    expect(repair).toEqual([])
    expect(rowsIn(after)).toEqual([['h', 'x'], ['z']])
  })

  it('takes the mark off a column dragged elsewhere, so it does not join the block it lands after', () => {
    const { after, repair } = commitWithRepair(row(), [{ op: 'move', id: 'y', parentId: 'p', afterId: 'z' }])
    expect(repair).toEqual([clears('y')])
    expect(rowsIn(after)).toEqual([['h', 'x'], ['z'], ['y']])
  })

  it('keeps a mark the batch sets itself, and the marks of new blocks', () => {
    const before = row()
    const get = (id: string): Block | undefined => before[id]
    const moveAndMark: Op[] = [
      { op: 'move', id: 'y', parentId: 'p', afterId: 'z' },
      { op: 'update', id: 'y', patch: { props: { beside: true } } }
    ]
    expect(rowRepairOps(moveAndMark, get)).toEqual([])
    expect(
      rowRepairOps([{ op: 'create', input: { id: 'n', type: 'text', parentId: 'p', afterId: 'z', props: { beside: true } } }], get)
    ).toEqual([])
  })

  it('splits the row when a new block lands between two columns', () => {
    const { after, repair } = commitWithRepair(row(), [
      { op: 'create', input: { id: 'n', type: 'text', parentId: 'p', afterId: 'h', props: {} } }
    ])
    expect(repair).toEqual([clears('x')])
    expect(rowsIn(after)).toEqual([['h'], ['n'], ['x', 'y'], ['z']])
  })

  it('leaves a row of databases nested in a block alone when its holder moves', () => {
    const before = pageOf([
      { ...block('h', 'toggle'), content: ['d1', 'd2'] },
      under(block('d1', 'database'), 'h'),
      under(block('d2', 'database', true), 'h'),
      block('z', 'text')
    ])
    expect(rowRepairOps([{ op: 'move', id: 'h', parentId: 'p', afterId: 'z' }], (id) => before[id])).toEqual([])
  })

  it('reads nothing while typing', () => {
    const get = (id: string): Block | undefined => {
      throw new Error(`read ${id}`)
    }
    expect(rowRepairOps([{ op: 'update', id: 'h', patch: { props: { title: [['Hi']] } } }], get)).toEqual([])
  })
})
