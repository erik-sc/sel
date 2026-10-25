import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType, Op } from '@shared/types'
import { applyOpsToMap, type BlockMap } from '../store/ops'
import { invertOps } from './ops'
import { rowRepairOps, rowsOf } from './layout'
import {
  backspacePlan,
  canDropBeside,
  canMakeColumns,
  columnsOps,
  deleteForwardPlan,
  dropInRow,
  indentOps,
  isDescendant,
  moveOps,
  moveToOps,
  nextVisible,
  order,
  outdentOps,
  placeForDrop,
  prevVisible,
  redoPlan,
  splitPlan,
  topLevel,
  turnIntoOps,
  type Plan,
  type Tree
} from './structure'

function block(id: string, type: BlockType, parentId: string | null, content: string[] = [], props: BlockProps = {}): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

/**
 * page
 * ├─ a      text "Alpha"
 * ├─ b      bulleted "Bravo"
 * │  ├─ b1  bulleted "B-one"
 * │  │  └─ b1x text "deep"
 * │  └─ b2  text "B-two"
 * ├─ t      toggle "Tango" (collapsed)
 * │  └─ t1  text "hidden"
 * ├─ o      toggle "Open"
 * │  └─ o1  text "shown"
 * ├─ d      divider
 * ├─ sub    page "Sub" (holds its own content)
 * ├─ gone   page, trashed
 * └─ z      text "Zulu"
 */
function world(): BlockMap {
  const list = [
    block('page', 'page', null, ['a', 'b', 't', 'o', 'd', 'sub', 'gone', 'z']),
    block('a', 'text', 'page', [], { title: [['Alpha']] }),
    block('b', 'bulleted_list', 'page', ['b1', 'b2'], { title: [['Bravo']] }),
    block('b1', 'bulleted_list', 'b', ['b1x'], { title: [['B-one']] }),
    block('b1x', 'text', 'b1', [], { title: [['deep']] }),
    block('b2', 'text', 'b', [], { title: [['B-two']] }),
    block('t', 'toggle', 'page', ['t1'], { title: [['Tango']], collapsed: true }),
    block('t1', 'text', 't', [], { title: [['hidden']] }),
    block('o', 'toggle', 'page', ['o1'], { title: [['Open']] }),
    block('o1', 'text', 'o', [], { title: [['shown']] }),
    block('d', 'divider', 'page'),
    block('sub', 'page', 'page', ['inside'], { title: [['Sub']] }),
    block('inside', 'text', 'sub', [], { title: [['other page']] }),
    { ...block('gone', 'page', 'page'), trashedAt: 5 },
    block('z', 'text', 'page', [], { title: [['Zulu']] })
  ]
  return Object.fromEntries(list.map((b) => [b.id, b]))
}

function treeOf(map: BlockMap): Tree {
  return { pageId: 'page', get: (id) => map[id] }
}

function ids(): () => string {
  let n = 0
  return () => `n${++n}`
}

function shape(map: BlockMap): unknown {
  return Object.values(map)
    .map((b) => ({ id: b.id, type: b.type, parentId: b.parentId, content: b.content, props: b.props, trashed: !!b.trashedAt }))
    .sort((x, y) => x.id.localeCompare(y.id))
}

/** Applies ops with the store's own reducer and checks that the computed inverse restores the document. */
function applyAndUndo(before: BlockMap, ops: Op[]): BlockMap {
  const { inverse } = invertOps(ops, (id) => before[id])
  const after = applyOpsToMap(before, ops).map
  expect(shape(after)).not.toEqual(shape(before))
  expect(shape(applyOpsToMap(after, inverse).map)).toEqual(shape(before))
  return after
}

function committed(plan: Plan): Extract<Plan, { do: 'commit' }> {
  if (!plan || plan.do !== 'commit') throw new Error(`expected a commit, got ${JSON.stringify(plan)}`)
  return plan
}

/** Text of the visible blocks in document order: what the user sees top to bottom. */
function reading(map: BlockMap): string[] {
  return order(treeOf(map)).map((id) => (map[id].props.title ?? []).map((s) => s[0]).join(''))
}

describe('navigation', () => {
  const w = world()
  const tree = treeOf(w)

  it('orders visible blocks, skipping collapsed toggles, sub-page content and trashed pages', () => {
    expect(order(tree)).toEqual(['a', 'b', 'b1', 'b1x', 'b2', 't', 'o', 'o1', 'd', 'sub', 'z'])
  })

  it('nextVisible / prevVisible walk the same order without scanning the page', () => {
    const all = order(tree)
    expect(nextVisible(tree, 'page')).toBe('a')
    expect(prevVisible(tree, 'page')).toBeNull()
    expect(prevVisible(tree, 'a')).toBe('page')
    all.forEach((id, i) => {
      expect(nextVisible(tree, id)).toBe(all[i + 1] ?? null)
      if (i > 0) expect(prevVisible(tree, id)).toBe(all[i - 1])
    })
  })

  it('leaves a hidden child through its collapsed parent', () => {
    expect(prevVisible(tree, 't1')).toBe('t')
    expect(nextVisible(tree, 't1')).toBe('o')
  })

  it('does not loop on a corrupt parent cycle', () => {
    const cyclic: BlockMap = { ...w, x: block('x', 'text', 'y', ['y']), y: block('y', 'text', 'x', ['x']) }
    const t = treeOf(cyclic)
    expect(isDescendant(t, 'x', 'page')).toBe(false)
    expect(topLevel(t, ['x', 'a'])).toContain('a')
  })

  it('isDescendant follows the parent chain', () => {
    expect(isDescendant(tree, 'b1x', 'b')).toBe(true)
    expect(isDescendant(tree, 'b1x', 'b1')).toBe(true)
    expect(isDescendant(tree, 'b', 'b1x')).toBe(false)
    expect(isDescendant(tree, 'b', 'b')).toBe(false)
  })

  it('topLevel drops nested ids, unknown ids and duplicates, in document order', () => {
    expect(topLevel(tree, ['z', 'b1x', 'b', 'nope', 'a', 'b1', 'a'])).toEqual(['a', 'b', 'z'])
    expect(topLevel(tree, ['b2', 'b1x'])).toEqual(['b1x', 'b2'])
    expect(topLevel(tree, [])).toEqual([])
  })

  it('topLevel stays fast on a large selection', () => {
    const big: BlockMap = { page: block('page', 'page', null, []) }
    for (let i = 0; i < 20000; i++) {
      const id = `k${i}`
      big[id] = block(id, 'text', 'page')
      big.page.content.push(id)
    }
    const started = performance.now()
    expect(topLevel(treeOf(big), [...big.page.content].reverse())).toHaveLength(20000)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('splitPlan (Enter)', () => {
  it('splits a leaf into two siblings and undo joins them again', () => {
    const w = world()
    const plan = committed(splitPlan(treeOf(w), 'a', 2, 2, ids()))
    const after = applyAndUndo(w, plan.ops)
    expect(after.page.content.slice(0, 2)).toEqual(['a', 'n1'])
    expect(after.a.props.title).toEqual([['Al']])
    expect(after.n1.props.title).toEqual([['pha']])
    expect(plan.after).toEqual({ kind: 'text', blockId: 'n1', start: 0, end: 0 })
  })

  it('drops the selected text when splitting over a selection', () => {
    const w = world()
    const after = applyAndUndo(w, committed(splitPlan(treeOf(w), 'a', 1, 4, ids())).ops)
    expect(after.a.props.title).toEqual([['A']])
    expect(after.n1.props.title).toEqual([['a']])
  })

  it('accepts a reversed or out-of-range selection', () => {
    const w = world()
    expect(committed(splitPlan(treeOf(w), 'a', 4, 1, ids())).ops).toEqual(committed(splitPlan(treeOf(w), 'a', 1, 4, ids())).ops)
    const end = applyAndUndo(w, committed(splitPlan(treeOf(w), 'a', 999, 999, ids())).ops)
    expect(end.a.props.title).toEqual([['Alpha']])
    expect(end.n1.props.title).toEqual([])
  })

  it('keeps the text after the caret directly below the text before it when the block has children', () => {
    const w = world()
    const plan = committed(splitPlan(treeOf(w), 'b', 3, 3, ids()))
    const after = applyAndUndo(w, plan.ops)
    // The children stay with the original block; the new block becomes its first child.
    expect(after.b.content).toEqual(['n1', 'b1', 'b2'])
    expect(after.n1).toMatchObject({ type: 'bulleted_list', parentId: 'b', props: { title: [['vo']] } })
    expect(reading(after).slice(0, 6)).toEqual(['Alpha', 'Bra', 'vo', 'B-one', 'deep', 'B-two'])
    expect(plan.after).toEqual({ kind: 'text', blockId: 'n1', start: 0, end: 0 })
  })

  it('Enter at the end of a block with children opens a first child, not a block below the children', () => {
    const w = world()
    const plan = committed(splitPlan(treeOf(w), 'b', 5, 5, ids()))
    expect(plan.ops).toHaveLength(1)
    const after = applyAndUndo(w, plan.ops)
    expect(after.b.props.title).toEqual([['Bravo']])
    expect(after.b.content).toEqual(['n1', 'b1', 'b2'])
    expect(after.page.content).toEqual(w.page.content)
  })

  it('an open toggle gets a plain text first child; a collapsed one gets a sibling', () => {
    const w = world()
    const open = applyAndUndo(w, committed(splitPlan(treeOf(w), 'o', 2, 2, ids())).ops)
    expect(open.o.content).toEqual(['n1', 'o1'])
    expect(open.n1).toMatchObject({ type: 'text', props: { title: [['en']] } })
    const closed = applyAndUndo(w, committed(splitPlan(treeOf(w), 't', 2, 2, ids())).ops)
    expect(closed.t.content).toEqual(['t1'])
    expect(closed.page.content.slice(2, 4)).toEqual(['t', 'n1'])
    expect(closed.n1).toMatchObject({ type: 'toggle', props: { title: [['ngo']] } })
  })

  it('Enter at the very start pushes the block (and its children) down', () => {
    const w = world()
    const plan = committed(splitPlan(treeOf(w), 'b', 0, 0, ids()))
    const after = applyAndUndo(w, plan.ops)
    expect(after.page.content.slice(0, 3)).toEqual(['a', 'n1', 'b'])
    expect(after.b.content).toEqual(['b1', 'b2'])
    expect(after.b.props.title).toEqual([['Bravo']])
    expect(plan.after).toEqual({ kind: 'text', blockId: 'b', start: 0, end: 0 })
  })

  it('continues lists and resets checked; headings continue as text', () => {
    const w: BlockMap = {
      ...world(),
      todo: block('todo', 'to_do', 'page', [], { title: [['task']], checked: true }),
      h: block('h', 'heading_1', 'page', [], { title: [['Head']] })
    }
    w.page = { ...w.page, content: [...w.page.content, 'todo', 'h'] }
    const todo = applyOpsToMap(w, committed(splitPlan(treeOf(w), 'todo', 4, 4, ids())).ops).map
    expect(todo.n1).toMatchObject({ type: 'to_do', props: { checked: false, title: [] } })
    const head = applyOpsToMap(w, committed(splitPlan(treeOf(w), 'h', 4, 4, ids())).ops).map
    expect(head.n1.type).toBe('text')
  })

  it('Enter on an empty block resets its type, or lifts the last nested one out', () => {
    const w: BlockMap = {
      ...world(),
      b2: block('b2', 'bulleted_list', 'b', [], {}),
      a: block('a', 'bulleted_list', 'page', [], {})
    }
    expect(splitPlan(treeOf(w), 'b2', 0, 0, ids())).toEqual({ do: 'outdent' })
    expect(splitPlan(treeOf(w), 'a', 0, 0, ids())).toEqual({ do: 'turnText' })
    const emptyText: BlockMap = { ...world(), b2: block('b2', 'text', 'b', [], {}) }
    expect(splitPlan(treeOf(emptyText), 'b2', 0, 0, ids())).toEqual({ do: 'outdent' })
  })

  it('does nothing for the page itself or an unknown block', () => {
    const w = world()
    expect(splitPlan(treeOf(w), 'page', 0, 0, ids())).toBeNull()
    expect(splitPlan(treeOf(w), 'nope', 0, 0, ids())).toBeNull()
  })

  it('splitting then backspacing restores the original document', () => {
    const w = world()
    const split = applyOpsToMap(w, committed(splitPlan(treeOf(w), 'o', 2, 2, ids())).ops).map
    const merged = applyAndUndo(split, committed(backspacePlan(treeOf(split), 'n1')).ops)
    expect(shape(merged)).toEqual(shape(w))
  })
})

describe('backspacePlan / deleteForwardPlan (merge)', () => {
  it('merges into the previous text block and puts the caret at the seam', () => {
    const w = world()
    w.page = { ...w.page, content: ['a', 'z'] }
    const plan = committed(backspacePlan(treeOf(w), 'z'))
    const after = applyAndUndo(w, plan.ops)
    expect(after.a.props.title).toEqual([['AlphaZulu']])
    expect(after.z).toBeUndefined()
    expect(plan.after).toEqual({ kind: 'text', blockId: 'a', start: 5, end: 5 })
  })

  it('keeps marks on both sides of the seam', () => {
    const w: BlockMap = {
      ...world(),
      a: block('a', 'text', 'page', [], { title: [['Al', [['b']]], ['pha']] }),
      z: block('z', 'text', 'page', [], { title: [['Zu', [['a', 'https://x.dev']]], ['lu']] })
    }
    w.page = { ...w.page, content: ['a', 'z'] }
    const after = applyAndUndo(w, committed(backspacePlan(treeOf(w), 'z')).ops)
    expect(after.a.props.title).toEqual([['Al', [['b']]], ['pha'], ['Zu', [['a', 'https://x.dev']]], ['lu']])
  })

  it('moves to a non-text block above instead of merging into it', () => {
    const w = world()
    w.page = { ...w.page, content: ['a', 'd', 'z'] }
    expect(backspacePlan(treeOf(w), 'z')).toEqual({ do: 'focus', id: 'd', where: 'end' })
    const empty: BlockMap = { ...w, z: block('z', 'text', 'page') }
    const plan = committed(backspacePlan(treeOf(empty), 'z'))
    expect(plan.ops).toEqual([{ op: 'delete', id: 'z' }])
    expect(plan.after).toEqual({ kind: 'blocks', ids: ['d'] })
  })

  it('first turns a styled block into text, and lifts the last nested block out', () => {
    const w = world()
    expect(backspacePlan(treeOf(w), 'b')).toEqual({ do: 'turnText' })
    expect(backspacePlan(treeOf(w), 'b2')).toEqual({ do: 'outdent' })
    expect(backspacePlan(treeOf(w), 'a')).toEqual({ do: 'focus', id: 'page', where: 'end' })
  })

  it('merging a block with children keeps them, in place, and undo restores the nesting', () => {
    const w: BlockMap = { ...world(), b: block('b', 'text', 'page', ['b1', 'b2'], { title: [['Bravo']] }) }
    const plan = committed(backspacePlan(treeOf(w), 'b'))
    const after = applyAndUndo(w, plan.ops)
    expect(after.b).toBeUndefined()
    expect(after.a.props.title).toEqual([['AlphaBravo']])
    expect(after.page.content.slice(0, 3)).toEqual(['a', 'b1', 'b2'])
    expect(after.b1.parentId).toBe('page')
    expect(after.b1.content).toEqual(['b1x'])
    expect(plan.after).toEqual({ kind: 'text', blockId: 'a', start: 5, end: 5 })
    expect(reading(after).slice(0, 4)).toEqual(['AlphaBravo', 'B-one', 'deep', 'B-two'])
  })

  it('merging the first child into its parent keeps its own children under the parent', () => {
    const w: BlockMap = { ...world(), b1: block('b1', 'text', 'b', ['b1x'], { title: [['B-one']] }) }
    const after = applyAndUndo(w, committed(backspacePlan(treeOf(w), 'b1')).ops)
    expect(after.b.props.title).toEqual([['BravoB-one']])
    expect(after.b.content).toEqual(['b1x', 'b2'])
  })

  it('never drops a sub-page held by the merged block', () => {
    const w: BlockMap = {
      ...world(),
      z: block('z', 'text', 'page', ['zp'], { title: [['Zulu']] }),
      zp: block('zp', 'page', 'z', [], { title: [['Kept']] })
    }
    w.page = { ...w.page, content: ['a', 'z'] }
    const after = applyAndUndo(w, committed(backspacePlan(treeOf(w), 'z')).ops)
    expect(after.zp.parentId).toBe('page')
    expect(after.page.content).toEqual(['a', 'zp'])
    expect(after.zp.trashedAt).toBeNull()
  })

  it('an empty block merges without rewriting the block above', () => {
    const w: BlockMap = { ...world(), z: block('z', 'text', 'page') }
    w.page = { ...w.page, content: ['a', 'z'] }
    expect(committed(backspacePlan(treeOf(w), 'z')).ops).toEqual([{ op: 'delete', id: 'z' }])
  })

  it('Delete at the end pulls the next block in, keeping its children', () => {
    const w = world()
    const plan = committed(deleteForwardPlan(treeOf(w), 'a'))
    const after = applyAndUndo(w, plan.ops)
    expect(after.a.props.title).toEqual([['AlphaBravo']])
    expect(after.page.content.slice(0, 3)).toEqual(['a', 'b1', 'b2'])
    expect(plan.after).toEqual({ kind: 'text', blockId: 'a', start: 5, end: 5 })
  })

  it('Delete at the end of a parent pulls its first child in', () => {
    const w = world()
    const after = applyAndUndo(w, committed(deleteForwardPlan(treeOf(w), 'b')).ops)
    expect(after.b.props.title).toEqual([['BravoB-one']])
    expect(after.b.content).toEqual(['b1x', 'b2'])
  })

  it('Delete before a non-text block selects it; nothing after the last block', () => {
    const w = world()
    expect(deleteForwardPlan(treeOf(w), 'o1')).toEqual({ do: 'select', id: 'd' })
    expect(deleteForwardPlan(treeOf(w), 'z')).toBeNull()
  })

  it('Delete into a collapsed toggle reveals its children instead of deleting them', () => {
    const w = world()
    const after = applyAndUndo(w, committed(deleteForwardPlan(treeOf(w), 'b2')).ops)
    expect(after.b2.props.title).toEqual([['B-twoTango']])
    expect(after.t).toBeUndefined()
    expect(after.t1.parentId).toBe('page')
  })
})

describe('indent / outdent / move', () => {
  it('indents under the previous sibling, after its existing children', () => {
    const w = world()
    w.page = { ...w.page, content: ['a', 'b', 'z'] }
    const after = applyAndUndo(w, indentOps(treeOf(w), ['z']))
    expect(after.b.content).toEqual(['b1', 'b2', 'z'])
    expect(after.z.parentId).toBe('b')
  })

  it('indents a multi-block selection together, in order', () => {
    const w = world()
    w.page = { ...w.page, content: ['a', 'b', 'z'] }
    const after = applyAndUndo(w, indentOps(treeOf(w), ['z', 'b', 'b1']))
    expect(after.a.content).toEqual(['b', 'z'])
    expect(after.b.content).toEqual(['b1', 'b2'])
  })

  it('indent is a no-op for the first block, under a non-text block, or across parents', () => {
    const w = world()
    expect(indentOps(treeOf(w), ['a'])).toEqual([])
    expect(indentOps(treeOf(w), ['b1'])).toEqual([])
    expect(indentOps(treeOf(w), ['z'])).toEqual([])
    expect(indentOps(treeOf(w), ['b2', 'z'])).toEqual([])
    expect(indentOps(treeOf(w), [])).toEqual([])
    expect(indentOps(treeOf(w), ['nope'])).toEqual([])
  })

  it('indenting under a collapsed toggle opens it', () => {
    const w = world()
    const ops = indentOps(treeOf(w), ['o'])
    const after = applyAndUndo(w, ops)
    expect(after.t.props.collapsed).toBe(false)
    expect(after.t.content).toEqual(['t1', 'o'])
  })

  it('outdents to follow the parent; a no-op at the top level', () => {
    const w = world()
    const after = applyAndUndo(w, outdentOps(treeOf(w), ['b1']))
    expect(after.page.content.slice(0, 3)).toEqual(['a', 'b', 'b1'])
    expect(after.b.content).toEqual(['b2'])
    expect(after.b1.content).toEqual(['b1x'])
    expect(outdentOps(treeOf(w), ['a'])).toEqual([])
    expect(outdentOps(treeOf(w), ['b1', 'z'])).toEqual([])
    expect(outdentOps(treeOf(w), [])).toEqual([])
  })

  it('outdents several siblings keeping their order', () => {
    const w = world()
    const after = applyAndUndo(w, outdentOps(treeOf(w), ['b2', 'b1']))
    expect(after.page.content.slice(0, 4)).toEqual(['a', 'b', 'b1', 'b2'])
    expect(after.b.content).toEqual([])
  })

  it('indent then outdent is the identity', () => {
    const w = world()
    w.page = { ...w.page, content: ['a', 'z'] }
    const indented = applyOpsToMap(w, indentOps(treeOf(w), ['z'])).map
    const back = applyOpsToMap(indented, outdentOps(treeOf(indented), ['z'])).map
    expect(shape(back)).toEqual(shape(w))
  })

  it('moves blocks up and down among their siblings, stopping at the edges', () => {
    const w = world()
    const down = applyAndUndo(w, moveOps(treeOf(w), ['a'], 1))
    expect(down.page.content.slice(0, 2)).toEqual(['b', 'a'])
    const up = applyAndUndo(w, moveOps(treeOf(w), ['b2'], -1))
    expect(up.b.content).toEqual(['b2', 'b1'])
    expect(moveOps(treeOf(w), ['a'], -1)).toEqual([])
    expect(moveOps(treeOf(w), ['z'], 1)).toEqual([])
    expect(moveOps(treeOf(w), ['b1'], -1)).toEqual([])
    expect(moveOps(treeOf(w), ['b2'], 1)).toEqual([])
    expect(moveOps(treeOf(w), ['a', 'b1'], 1)).toEqual([])
  })

  it('moves a multi-block selection as one', () => {
    const w = world()
    const after = applyAndUndo(w, moveOps(treeOf(w), ['a', 'b'], 1))
    expect(after.page.content.slice(0, 3)).toEqual(['t', 'a', 'b'])
    expect(after.b.content).toEqual(['b1', 'b2'])
  })

  it('moving skips trashed pages that still sit in the parent', () => {
    const w = world()
    const after = applyAndUndo(w, moveOps(treeOf(w), ['z'], -1))
    expect(after.page.content.indexOf('z')).toBeLessThan(after.page.content.indexOf('sub'))
  })

  it('turnInto converts editable blocks and resets type-specific props', () => {
    const w: BlockMap = { ...world(), todo: block('todo', 'to_do', 'page', [], { title: [['x', [['b']]]], checked: true }) }
    const ops = turnIntoOps(treeOf(w), ['todo', 'd', 'a', 'nope'], 'code')
    expect(ops.map((op) => (op.op === 'update' ? op.id : ''))).toEqual(['todo', 'a'])
    const after = applyAndUndo(w, ops)
    expect(after.todo).toMatchObject({ type: 'code', props: { title: [['x']] } })
    expect(after.todo.props.checked).toBeUndefined()
    expect(turnIntoOps(treeOf(w), ['a'], 'text')).toEqual([])
    const callout = applyOpsToMap(w, turnIntoOps(treeOf(w), ['a'], 'callout')).map
    expect(callout.a.props.icon).toBeTruthy()
  })
})

describe('moveToOps (drag & drop)', () => {
  it('drops before, after and inside a target', () => {
    const w = world()
    const before = applyAndUndo(w, moveToOps(treeOf(w), ['z'], { id: 'a', pos: 'before' }).ops)
    expect(before.page.content.slice(0, 2)).toEqual(['z', 'a'])
    const after = applyAndUndo(w, moveToOps(treeOf(w), ['z'], { id: 'b1', pos: 'after' }).ops)
    expect(after.b.content).toEqual(['b1', 'z', 'b2'])
    const inside = applyAndUndo(w, moveToOps(treeOf(w), ['z'], { id: 'a', pos: 'inside' }).ops)
    expect(inside.a.content).toEqual(['z'])
  })

  it('refuses to drop a block into itself or any of its descendants', () => {
    const w = world()
    for (const pos of ['before', 'after', 'inside'] as const) {
      expect(moveToOps(treeOf(w), ['b'], { id: 'b', pos }).ops).toEqual([])
      expect(moveToOps(treeOf(w), ['b'], { id: 'b1', pos }).ops).toEqual([])
      expect(moveToOps(treeOf(w), ['b'], { id: 'b1x', pos }).ops).toEqual([])
      expect(moveToOps(treeOf(w), ['a', 'b'], { id: 'b2', pos }).ops).toEqual([])
    }
  })

  it('refuses unknown targets and nesting inside sub-pages or databases', () => {
    const w = world()
    expect(moveToOps(treeOf(w), ['a'], { id: 'nope', pos: 'after' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), ['a'], { id: 'sub', pos: 'inside' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), [], { id: 'a', pos: 'after' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), ['a'], { id: 'page', pos: 'after' }).ops).toEqual([])
  })

  it('moves a selection as one, dropping nested ids, and survives undo', () => {
    const w = world()
    const { ops, moved } = moveToOps(treeOf(w), ['b1x', 'b', 'a', 'b1'], { id: 'z', pos: 'after' })
    expect(moved).toEqual(['a', 'b'])
    const after = applyAndUndo(w, ops)
    expect(after.page.content.slice(-3)).toEqual(['z', 'a', 'b'])
    expect(after.b.content).toEqual(['b1', 'b2'])
  })

  it('dropping before the block that follows the dragged ones keeps the order', () => {
    const w = world()
    const { ops } = moveToOps(treeOf(w), ['a'], { id: 'b', pos: 'before' })
    expect(applyOpsToMap(w, ops).map.page.content).toEqual(w.page.content)
  })

  it('dropping inside a collapsed toggle opens it', () => {
    const w = world()
    const after = applyAndUndo(w, moveToOps(treeOf(w), ['a'], { id: 't', pos: 'inside' }).ops)
    expect(after.t.props.collapsed).toBe(false)
    expect(after.t.content).toEqual(['t1', 'a'])
  })
})

describe('undo of deletes and redo of created pages', () => {
  it('deleting blocks with children is undone in place, sub-pages included', () => {
    const w: BlockMap = { ...world(), bp: block('bp', 'page', 'b1', [], { title: [['Nested page']] }) }
    w.b1 = { ...w.b1, content: ['b1x', 'bp'] }
    const ops: Op[] = [
      { op: 'delete', id: 'a' },
      { op: 'delete', id: 'b' }
    ]
    const { inverse } = invertOps(ops, (id) => w[id])
    const after = applyOpsToMap(w, ops).map
    expect(after.b).toBeUndefined()
    expect(after.b1x).toBeUndefined()
    expect(after.bp).toBeDefined()
    const back = applyOpsToMap(after, inverse).map
    expect(shape(back)).toEqual(shape(w))
  })

  it('redo restores a page that undo only trashed instead of creating it twice', () => {
    const w = world()
    const ops: Op[] = [
      { op: 'update', id: 'a', patch: { props: { title: [] } } },
      { op: 'create', input: { id: 'np', type: 'page', parentId: 'page', afterId: 'a', props: { title: [] } } }
    ]
    const { inverse } = invertOps(ops, (id) => w[id])
    const undone = applyOpsToMap(applyOpsToMap(w, ops).map, inverse).map
    expect(undone.np.trashedAt).not.toBeNull()
    // Replaying the entry as recorded is what used to fail:
    expect(() => applyOpsToMap(undone, ops)).toThrow(/already exists/)
    const plan = redoPlan(ops, (id) => undone[id])
    expect(plan.restore).toEqual(['np'])
    expect(plan.ops).toEqual([ops[0]])
    expect(() => applyOpsToMap(undone, plan.ops)).not.toThrow()
  })

  it('redo replays ordinary creates unchanged', () => {
    const w = world()
    const ops: Op[] = [{ op: 'create', input: { id: 'nt', type: 'text', parentId: 'page', afterId: 'a', props: {} } }]
    const { inverse } = invertOps(ops, (id) => w[id])
    const undone = applyOpsToMap(applyOpsToMap(w, ops).map, inverse).map
    expect(redoPlan(ops, (id) => undone[id])).toEqual({ restore: [], ops })
  })
})

/**
 * A page with rows (layout.ts):
 * page
 * ├─ h      heading "Head"
 * ├─ p      text "Para"
 * ├─ r1     text "One"   ┐
 * ├─ r2     text "Two"   │ one row
 * ├─ r3     text "Three" ┘
 * ├─ f1…f4  text, one full row of four
 * ├─ q      text "Quiet"
 * │  └─ q1  text "nested"
 * ├─ db     database
 * ├─ sub    page "Sub"
 * └─ z      text "Zulu"
 */
function rowsWorld(): BlockMap {
  const text = (id: string, title: string, beside = false, content: string[] = []): Block =>
    block(id, 'text', 'page', content, { title: [[title]], ...(beside ? { beside: true } : {}) })
  const list = [
    block('page', 'page', null, ['h', 'p', 'r1', 'r2', 'r3', 'f1', 'f2', 'f3', 'f4', 'q', 'db', 'sub', 'z']),
    block('h', 'heading_1', 'page', [], { title: [['Head']] }),
    text('p', 'Para'),
    text('r1', 'One'),
    text('r2', 'Two', true),
    text('r3', 'Three', true),
    text('f1', 'F1'),
    text('f2', 'F2', true),
    text('f3', 'F3', true),
    text('f4', 'F4', true),
    text('q', 'Quiet', false, ['q1']),
    block('q1', 'text', 'q', [], { title: [['nested']] }),
    block('db', 'database', 'page', [], { title: [['Tasks']] }),
    block('sub', 'page', 'page', [], { title: [['Sub']] }),
    text('z', 'Zulu')
  ]
  return Object.fromEntries(list.map((b) => [b.id, b]))
}

/** The page's rows after `ops` and the row repair the controller adds in the same commit, as ids. */
function rowsAfter(before: BlockMap, ops: Op[]): { rows: string[][]; repair: Op[]; map: BlockMap } {
  const repair = rowRepairOps(ops, (id) => before[id])
  const map = applyOpsToMap(before, [...ops, ...repair]).map
  const kids = map.page.content.map((id) => map[id]).filter((b) => !b.trashedAt)
  return { rows: rowsOf(kids, { top: true }).map((row) => row.map((b) => b.id)), repair, map }
}

describe('moveToOps beside a block (left and right)', () => {
  it('puts one block beside a lone block, on its right or on its left', () => {
    const w = rowsWorld()
    const right = moveToOps(treeOf(w), ['p'], { id: 'h', pos: 'right' })
    expect(right.moved).toEqual(['p'])
    applyAndUndo(w, right.ops)
    expect(rowsAfter(w, right.ops).rows.slice(0, 2)).toEqual([
      ['h', 'p'],
      ['r1', 'r2', 'r3']
    ])
    expect(rowsAfter(w, right.ops).repair).toEqual([])

    const left = moveToOps(treeOf(w), ['z'], { id: 'h', pos: 'left' })
    const after = applyAndUndo(w, left.ops)
    expect(after.page.content.slice(0, 3)).toEqual(['z', 'h', 'p'])
    expect(after.z.props.beside).toBeUndefined()
    expect(after.h.props.beside).toBe(true)
    expect(rowsAfter(w, left.ops).rows[0]).toEqual(['z', 'h'])
  })

  it('puts a block into an existing row without splitting it, from either side of the gap', () => {
    const w = rowsWorld()
    for (const drop of [
      { id: 'r1', pos: 'right' },
      { id: 'r2', pos: 'left' }
    ] as const) {
      const { ops } = moveToOps(treeOf(w), ['p'], drop)
      const after = applyAndUndo(w, ops)
      expect(after.page.content.slice(0, 5)).toEqual(['h', 'r1', 'p', 'r2', 'r3'])
      const { rows, repair } = rowsAfter(w, ops)
      expect(rows.slice(0, 2)).toEqual([['h'], ['r1', 'p', 'r2', 'r3']])
      expect(repair).toEqual([])
    }
  })

  it('drags a row’s head out: the next column becomes the head of what is left', () => {
    const w = rowsWorld()
    const { ops } = moveToOps(treeOf(w), ['r1'], { id: 'h', pos: 'right' })
    applyAndUndo(w, ops)
    const { rows, repair, map } = rowsAfter(w, ops)
    expect(rows.slice(0, 3)).toEqual([['h', 'r1'], ['p'], ['r2', 'r3']])
    expect(repair).toEqual([{ op: 'update', id: 'r2', patch: { props: { beside: null } } }])
    // The repair is part of the same step: undoing both brings the page back.
    const all = [...ops, ...repair]
    expect(shape(applyOpsToMap(map, invertOps(all, (id) => w[id]).inverse).map)).toEqual(shape(w))
    // Beside the block right above it, the head does not move in the list: its row still splits.
    const up = moveToOps(treeOf(w), ['r1'], { id: 'p', pos: 'right' }).ops
    applyAndUndo(w, up)
    expect(rowsAfter(w, up).rows.slice(0, 3)).toEqual([['h'], ['p', 'r1'], ['r2', 'r3']])
  })

  it('reorders the columns of a row, the first one keeping no mark', () => {
    const w = rowsWorld()
    const { ops } = moveToOps(treeOf(w), ['r3'], { id: 'r1', pos: 'left' })
    applyAndUndo(w, ops)
    const { rows, map } = rowsAfter(w, ops)
    expect(rows[2]).toEqual(['r3', 'r1', 'r2'])
    expect(map.r3.props.beside).toBeUndefined()
    expect(map.r1.props.beside).toBe(true)
  })

  it('makes several dragged blocks several columns, in their order', () => {
    const w = rowsWorld()
    const { ops, moved } = moveToOps(treeOf(w), ['z', 'p'], { id: 'h', pos: 'right' })
    expect(moved).toEqual(['p', 'z'])
    applyAndUndo(w, ops)
    expect(rowsAfter(w, ops).rows[0]).toEqual(['h', 'p', 'z'])
  })

  it('refuses a fifth column, and a block beside itself or where it already is', () => {
    const w = rowsWorld()
    expect(moveToOps(treeOf(w), ['p'], { id: 'f2', pos: 'right' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), ['p', 'z'], { id: 'r1', pos: 'left' }).ops).toEqual([])
    expect(canDropBeside(treeOf(w), ['p'], 'f1')).toBe(false)
    // A full row may still be reordered: nothing joins it.
    const reorder = moveToOps(treeOf(w), ['f4'], { id: 'f1', pos: 'left' }).ops
    expect(rowsAfter(w, reorder).rows[3]).toEqual(['f4', 'f1', 'f2', 'f3'])
    for (const pos of ['left', 'right'] as const) {
      expect(moveToOps(treeOf(w), ['p'], { id: 'p', pos }).ops).toEqual([])
      expect(moveToOps(treeOf(w), ['q'], { id: 'q', pos }).ops).toEqual([])
    }
    expect(moveToOps(treeOf(w), ['r2'], { id: 'r1', pos: 'right' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), ['r1'], { id: 'r2', pos: 'left' }).ops).toEqual([])
  })

  it('refuses sub-pages and nested targets, and a block beside one it holds', () => {
    const w = rowsWorld()
    expect(moveToOps(treeOf(w), ['sub'], { id: 'h', pos: 'right' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), ['p'], { id: 'sub', pos: 'left' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), ['p'], { id: 'q1', pos: 'right' }).ops).toEqual([])
    expect(moveToOps(treeOf(w), ['q'], { id: 'q1', pos: 'right' }).ops).toEqual([])
    // A nested block may be dragged out beside a block of the page.
    const { ops } = moveToOps(treeOf(w), ['q1'], { id: 'z', pos: 'right' })
    applyAndUndo(w, ops)
    expect(rowsAfter(w, ops).rows.at(-1)).toEqual(['z', 'q1'])
  })

  it('gives a side drop a place in the list: after the target, or before it', () => {
    const w = rowsWorld()
    expect(placeForDrop(treeOf(w), { id: 'h', pos: 'right' })).toEqual({ parentId: 'page', afterId: 'h' })
    expect(placeForDrop(treeOf(w), { id: 'p', pos: 'left' })).toEqual({ parentId: 'page', afterId: 'h' })
  })
})

describe('dropInRow (above and below a column)', () => {
  const w = rowsWorld()
  const at = (dragged: string[], id: string, pos: 'before' | 'after'): unknown => dropInRow(treeOf(w), dragged, { id, pos })

  it('never splits a row', () => {
    expect(at(['p'], 'r1', 'before')).toEqual({ id: 'r1', pos: 'before' })
    expect(at(['p'], 'r2', 'before')).toEqual({ id: 'r2', pos: 'left' })
    expect(at(['p'], 'r1', 'after')).toEqual({ id: 'r1', pos: 'inside' })
    expect(at(['p'], 'r3', 'after')).toEqual({ id: 'r3', pos: 'after' })
    // A full row has no room on the side: above it instead.
    expect(at(['p'], 'f3', 'before')).toEqual({ id: 'f1', pos: 'before' })
    // A sub-page cannot be a column either.
    expect(at(['sub'], 'r2', 'before')).toEqual({ id: 'r1', pos: 'before' })
  })

  it('leaves a lone block, a nested one and a column dragged over itself as they are', () => {
    expect(at(['p'], 'h', 'after')).toEqual({ id: 'h', pos: 'after' })
    expect(at(['p'], 'q1', 'before')).toEqual({ id: 'q1', pos: 'before' })
    // Over its own top half a column stays where it is (moveToOps refuses it), not above its row.
    expect(at(['r2'], 'r2', 'before')).toEqual({ id: 'r2', pos: 'before' })
    expect(moveToOps(treeOf(w), ['r2'], { id: 'r2', pos: 'before' }).ops).toEqual([])
  })

  it('drops below the row for a column that cannot hold children', () => {
    const map = rowsWorld()
    map.page = { ...map.page, content: ['h', 'db', 'z'] }
    map.z = { ...map.z, props: { ...map.z.props, beside: true } }
    expect(dropInRow(treeOf(map), ['p'], { id: 'h', pos: 'before' })).toEqual({ id: 'h', pos: 'before' })
    map.db = { ...map.db, props: { ...map.db.props, beside: true } }
    expect(dropInRow(treeOf(map), ['p'], { id: 'db', pos: 'after' })).toEqual({ id: 'z', pos: 'after' })
  })
})

describe('columnsOps (the slash items "2 columns" and "3 columns")', () => {
  it('replaces an empty text block with a row of empty text blocks, in one batch', () => {
    const w: BlockMap = { ...rowsWorld(), e: block('e', 'text', 'page', [], { title: [] }) }
    w.page = { ...w.page, content: ['h', 'e', 'z'] }
    const made = columnsOps(treeOf(w), 'e', [], 3, ids())
    if (!made) throw new Error('expected a row')
    expect(made.first).toBe('n1')
    applyAndUndo(w, made.ops)
    const { rows, repair, map } = rowsAfter(w, made.ops)
    expect(rows).toEqual([['h'], ['n1', 'n2', 'n3'], ['z']])
    expect(repair).toEqual([])
    expect(map.e).toBeUndefined()
    expect(['n1', 'n2', 'n3'].map((id) => [map[id].type, map[id].props.title ?? []])).toEqual([
      ['text', []],
      ['text', []],
      ['text', []]
    ])
  })

  it('puts the row right after a block that keeps other text', () => {
    const w = rowsWorld()
    const made = columnsOps(treeOf(w), 'p', [['Para!']], 2, ids())
    if (!made) throw new Error('expected a row')
    const after = applyAndUndo(w, made.ops)
    expect(after.page.content.slice(0, 4)).toEqual(['h', 'p', 'n1', 'n2'])
    expect(after.p.props.title).toEqual([['Para!']])
    expect(rowsAfter(w, made.ops).rows.slice(1, 3)).toEqual([['p'], ['n1', 'n2']])
  })

  it('is not offered in a column or a nested block', () => {
    const w = rowsWorld()
    expect(canMakeColumns(treeOf(w), 'p')).toBe(true)
    expect(canMakeColumns(treeOf(w), 'r2')).toBe(false)
    expect(canMakeColumns(treeOf(w), 'r1')).toBe(false)
    expect(canMakeColumns(treeOf(w), 'q1')).toBe(false)
    expect(columnsOps(treeOf(w), 'q1', [], 2, ids())).toBeNull()
  })
})
