import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType, Op } from '@shared/types'
import { invertOps } from '../editor/ops'
import { order, type Tree } from '../editor/structure'
import { END } from '../editor/types'
import { applyOpsToMap, type BlockMap } from '../store/ops'
import { IDLE, isBusy, reduceRun, type RunEvent, type RunState } from './machine'
import { markdownToNodes, markdownToSnapshot, planAccept, type AiTarget, type InsertPlan } from './plan'

// --------------------------------------------------------------- state machine

describe('request state machine', () => {
  const play = (events: RunEvent[], from: RunState = IDLE): RunState => events.reduce(reduceRun, from)
  const delta = (id: string, text: string): RunEvent => ({ type: 'delta', id, text })

  it('goes from idle through starting and streaming to done', () => {
    let state = reduceRun(IDLE, { type: 'start' })
    expect(state).toMatchObject({ status: 'starting', id: null, text: '', run: 1 })
    expect(isBusy(state)).toBe(true)
    state = reduceRun(state, { type: 'started', id: 'r1' })
    expect(state).toMatchObject({ status: 'starting', id: 'r1' })
    state = play([delta('r1', 'Hello'), delta('r1', ', world')], state)
    expect(state).toMatchObject({ status: 'streaming', text: 'Hello, world' })
    state = reduceRun(state, { type: 'done', id: 'r1', text: 'Hello, world.', truncated: false })
    expect(state).toMatchObject({ status: 'done', text: 'Hello, world.', truncated: false, error: null })
    expect(isBusy(state)).toBe(false)
  })

  it('takes the final text as the answer, and keeps what streamed when the final text is empty', () => {
    const streaming = play([{ type: 'start' }, { type: 'started', id: 'r1' }, delta('r1', 'partial')])
    expect(reduceRun(streaming, { type: 'done', id: 'r1', text: 'whole answer', truncated: false }).text).toBe('whole answer')
    expect(reduceRun(streaming, { type: 'done', id: 'r1', text: '', truncated: true })).toMatchObject({
      text: 'partial',
      truncated: true,
      status: 'done'
    })
  })

  it('finishes straight from starting when nothing streamed', () => {
    const state = play([
      { type: 'start' },
      { type: 'started', id: 'r1' },
      { type: 'done', id: 'r1', text: 'all at once', truncated: false }
    ])
    expect(state).toMatchObject({ status: 'done', text: 'all at once' })
  })

  it('ignores events of another request', () => {
    const state = play([{ type: 'start' }, { type: 'started', id: 'r2' }, delta('r2', 'mine')])
    expect(reduceRun(state, delta('r1', ' stale'))).toBe(state)
    expect(reduceRun(state, { type: 'done', id: 'r1', text: 'stale', truncated: false })).toBe(state)
    expect(reduceRun(state, { type: 'error', id: 'r1', code: 'failed', message: 'stale' })).toBe(state)
    // An id cannot be swapped under a running request.
    expect(reduceRun(state, { type: 'started', id: 'r3' })).toBe(state)
    expect(reduceRun(state, { type: 'rejected', message: 'late' })).toBe(state)
  })

  it('keeps what streamed when the user stops it, and lets nothing in afterwards', () => {
    const streaming = play([{ type: 'start' }, { type: 'started', id: 'r1' }, delta('r1', 'so far')])
    const stopped = reduceRun(streaming, { type: 'cancel' })
    expect(stopped).toMatchObject({ status: 'cancelled', text: 'so far' })
    expect(reduceRun(stopped, delta('r1', ' more'))).toBe(stopped)
    expect(reduceRun(stopped, { type: 'done', id: 'r1', text: 'late', truncated: false })).toBe(stopped)
    expect(reduceRun(stopped, { type: 'error', id: 'r1', code: 'cancelled', message: 'x' })).toBe(stopped)
    expect(reduceRun(stopped, { type: 'cancel' })).toBe(stopped)
    // Stopping before the id arrived works too.
    expect(play([{ type: 'start' }, { type: 'cancel' }, { type: 'started', id: 'r9' }, delta('r9', 'x')])).toMatchObject({
      status: 'cancelled',
      id: null,
      text: ''
    })
  })

  it('maps errors: a cancellation is not a failure, anything else carries its code and message', () => {
    const running = play([{ type: 'start' }, { type: 'started', id: 'r1' }, delta('r1', 'half')])
    expect(reduceRun(running, { type: 'error', id: 'r1', code: 'cancelled', message: 'Cancelled' })).toMatchObject({
      status: 'cancelled',
      error: null,
      text: 'half'
    })
    expect(reduceRun(running, { type: 'error', id: 'r1', code: 'not-logged-in', message: 'Sign in' })).toMatchObject({
      status: 'error',
      text: 'half',
      error: { code: 'not-logged-in', message: 'Sign in' }
    })
    expect(reduceRun(running, { type: 'error', id: 'r1', code: 'failed', message: 'No', detail: 'boom' }).error).toEqual({
      code: 'failed',
      message: 'No',
      detail: 'boom'
    })
    expect(play([{ type: 'start' }, { type: 'rejected', message: 'Unknown AI action' }])).toMatchObject({
      status: 'error',
      error: { code: 'failed', message: 'Unknown AI action' }
    })
  })

  it('starts clean every time and counts the runs', () => {
    const failed = play([
      { type: 'start' },
      { type: 'started', id: 'r1' },
      delta('r1', 'old'),
      { type: 'error', id: 'r1', code: 'timeout', message: 'Too slow' }
    ])
    const again = reduceRun(failed, { type: 'start' })
    expect(again).toEqual({ status: 'starting', id: null, text: '', truncated: false, error: null, run: 2 })
    expect(reduceRun(again, delta('r1', 'ghost'))).toBe(again)
    expect(reduceRun(failed, { type: 'reset' })).toEqual({ ...IDLE, run: 1 })
  })

  it('does nothing while idle or finished', () => {
    for (const event of [
      delta('r1', 'x'),
      { type: 'done', id: 'r1', text: 'x', truncated: false },
      { type: 'cancel' },
      { type: 'started', id: 'r1' }
    ] as RunEvent[]) {
      expect(reduceRun(IDLE, event)).toBe(IDLE)
    }
    const done = play([{ type: 'start' }, { type: 'started', id: 'r1' }, { type: 'done', id: 'r1', text: 'x', truncated: false }])
    expect(reduceRun(done, delta('r1', 'y'))).toBe(done)
    expect(reduceRun(done, { type: 'cancel' })).toBe(done)
  })
})

// ------------------------------------------------------------ insertion plans

function block(id: string, type: BlockType, parentId: string | null, content: string[] = [], props: BlockProps = {}): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

/**
 * page
 * ├─ a      text "Alpha beta gamma"
 * ├─ e      text "" (empty)
 * ├─ l      bulleted "List" └─ l1 text "child"
 * ├─ sub    page "Sub"
 * └─ z      text "Zulu"
 */
function world(): BlockMap {
  const list = [
    block('page', 'page', null, ['a', 'e', 'l', 'sub', 'z'], { title: [['Doc']] }),
    block('a', 'text', 'page', [], { title: [['Alpha '], ['beta', [['b']]], [' gamma']] }),
    block('e', 'text', 'page'),
    block('l', 'bulleted_list', 'page', ['l1'], { title: [['List']] }),
    block('l1', 'text', 'l', [], { title: [['child']] }),
    block('sub', 'page', 'page', [], { title: [['Sub']] }),
    block('z', 'text', 'page', [], { title: [['Zulu']] })
  ]
  return Object.fromEntries(list.map((b) => [b.id, b]))
}

const treeOf = (map: BlockMap): Tree => ({ pageId: 'page', get: (id) => map[id] })
const ids = (): (() => string) => {
  let n = 0
  return () => `n${++n}`
}
const shape = (map: BlockMap): unknown =>
  Object.values(map)
    .map((b) => ({ id: b.id, type: b.type, parentId: b.parentId, content: b.content, props: b.props, trashed: !!b.trashedAt }))
    .sort((x, y) => x.id.localeCompare(y.id))
const text = (b: Block | undefined): string => (b?.props.title ?? []).map((span) => span[0]).join('')
/** What the page reads top to bottom: `type:text`. */
const reading = (map: BlockMap): string[] => order(treeOf(map)).map((id) => `${map[id].type}:${text(map[id])}`)

/** Plans, applies with the store's reducer, and checks that ONE inverse batch restores the page exactly. */
function accept(
  target: AiTarget,
  markdown: string,
  replace = true,
  before: BlockMap = world()
): { plan: InsertPlan; after: BlockMap; ops: Op[] } {
  const plan = planAccept(treeOf(before), target, markdown, ids(), replace)
  if (!plan) throw new Error('expected a plan')
  const { inverse } = invertOps(plan.ops, (id) => before[id])
  const after = applyOpsToMap(before, plan.ops).map
  expect(shape(after)).not.toEqual(shape(before))
  expect(shape(applyOpsToMap(after, inverse).map)).toEqual(shape(before))
  return { plan, after, ops: plan.ops }
}

describe('markdown to blocks', () => {
  it('uses the paste parser: headings, lists, to-dos, quotes, code, dividers and inline marks', () => {
    const nodes = markdownToNodes(
      '## Key points\n\n- one **bold**\n1. first\n- [ ] task\n- [x] done\n> quote\n---\n```js\nlet a = 1\n```\nplain *text*'
    )
    expect(nodes.map((node) => node.type)).toEqual([
      'heading_2',
      'bulleted_list',
      'numbered_list',
      'to_do',
      'to_do',
      'quote',
      'divider',
      'code',
      'text'
    ])
    expect(nodes[1].props.title).toEqual([['one '], ['bold', [['b']]]])
    expect(nodes[3].props.checked).toBe(false)
    expect(nodes[4].props.checked).toBe(true)
    expect(nodes[7].props).toMatchObject({ language: 'js', title: [['let a = 1']] })
    expect(markdownToNodes('  \n\n')).toEqual([])
  })

  it('never turns answer text into a link the editor would not allow', () => {
    const [node] = markdownToNodes('[click](javascript:alert(1)) and [ok](https://example.com)')
    const marks = (node.props.title ?? []).flatMap((span) => span[1] ?? [])
    expect(marks).toEqual([['a', 'https://example.com']])
  })

  it('builds the preview from the same blocks', () => {
    const snapshot = markdownToSnapshot('# Title\n\ntext')
    expect(snapshot.blocks.map((b) => b.type)).toEqual(['page', 'heading_1', 'text'])
    expect(snapshot.blocks[0].content).toEqual(['ai-0', 'ai-1'])
    expect(markdownToSnapshot('').blocks[0].content).toEqual([])
  })
})

describe('accepting an answer', () => {
  it('returns nothing for an empty answer', () => {
    expect(planAccept(treeOf(world()), { kind: 'after', blockId: 'a' }, '  \n ', ids())).toBeNull()
  })

  it('replaces a text selection in place when the answer is one paragraph, keeping the text around it', () => {
    const { plan, after, ops } = accept({ kind: 'range', blockId: 'a', start: 6, end: 10 }, 'the *second* letter')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'update', id: 'a' })
    expect(after['a'].props.title).toEqual([['Alpha the '], ['second', [['i']]], [' letter gamma']])
    expect(plan.after).toEqual({ kind: 'text', blockId: 'a', start: 6, end: 6 + 'the second letter'.length })
    expect(reading(after)).toHaveLength(reading(world()).length)
  })

  it('turns a selection into blocks when the answer has several, taking the selected text out of the line', () => {
    const { plan, after } = accept({ kind: 'range', blockId: 'a', start: 6, end: 10 }, '## Beta\n\n- first\n- second')
    expect(text(after['a'])).toBe('Alpha  gamma')
    expect(reading(after).slice(0, 4)).toEqual(['text:Alpha  gamma', 'heading_2:Beta', 'bulleted_list:first', 'bulleted_list:second'])
    expect(plan.after).toEqual({ kind: 'text', blockId: 'n3', start: END, end: END })
  })

  it('replaces the whole block when the selection was all of it', () => {
    const { after } = accept({ kind: 'range', blockId: 'z', start: 0, end: 4 }, '- one\n- two')
    expect(after['z']).toBeUndefined()
    expect(reading(after).slice(-2)).toEqual(['bulleted_list:one', 'bulleted_list:two'])
    // A block with children is emptied, not deleted: its children stay.
    const list = accept({ kind: 'range', blockId: 'l', start: 0, end: 4 }, '# A\n\ntext').after
    expect(list['l']).toBeDefined()
    expect(list['l1'].parentId).toBe('l')
  })

  it('clamps a selection that no longer fits the text', () => {
    const { after } = accept({ kind: 'range', blockId: 'z', start: 2, end: 999 }, 'XX')
    expect(text(after['z'])).toBe('ZuXX')
  })

  it('puts an explanation below the block, leaving the selection alone', () => {
    const { after } = accept({ kind: 'range', blockId: 'a', start: 6, end: 10 }, 'It means the second letter.', false)
    expect(text(after['a'])).toBe('Alpha beta gamma')
    expect(reading(after).slice(0, 2)).toEqual(['text:Alpha beta gamma', 'text:It means the second letter.'])
  })

  it('replaces selected blocks with the answer, where they were', () => {
    const { plan, after } = accept({ kind: 'blocks', ids: ['a', 'l', 'l1'] }, 'One paragraph.\n\n- item')
    expect(after['a']).toBeUndefined()
    expect(after['l']).toBeUndefined()
    expect(after['l1']).toBeUndefined()
    expect(reading(after)).toEqual(['text:', 'text:One paragraph.', 'bulleted_list:item', 'page:Sub', 'text:Zulu'])
    expect(plan.after).toEqual({ kind: 'blocks', ids: ['n1', 'n2'] })
  })

  it('never deletes a sub-page that was part of the selection', () => {
    const { after } = accept({ kind: 'blocks', ids: ['sub', 'z'] }, 'New text')
    expect(after['sub']).toBeDefined()
    expect(after['sub'].trashedAt).toBeNull()
    expect(after['z']).toBeUndefined()
    expect(reading(after).slice(-2)).toEqual(['page:Sub', 'text:New text'])
  })

  it('keeps the blocks and adds below them when asked not to replace', () => {
    const { after } = accept({ kind: 'blocks', ids: ['a'] }, '- [ ] task', false)
    expect(reading(after).slice(0, 2)).toEqual(['text:Alpha beta gamma', 'to_do:task'])
  })

  it('continues at the caret, with a space when the words would run together', () => {
    const { plan, after } = accept({ kind: 'caret', blockId: 'z', offset: 4 }, 'and so on.')
    expect(text(after['z'])).toBe('Zulu and so on.')
    expect(plan.after).toEqual({ kind: 'text', blockId: 'z', start: 15, end: 15 })
    expect(text(accept({ kind: 'caret', blockId: 'z', offset: 4 }, ', then more').after['z'])).toBe('Zulu, then more')
    // In the middle of a line it is kept apart from the word that follows as well.
    expect(text(accept({ kind: 'caret', blockId: 'a', offset: 6 }, 'new').after['a'])).toBe('Alpha new beta gamma')
    expect(text(accept({ kind: 'caret', blockId: 'a', offset: 5 }, 'new').after['a'])).toBe('Alpha new beta gamma')
    expect(text(accept({ kind: 'caret', blockId: 'z', offset: 999 }, 'end').after['z'])).toBe('Zulu end')
  })

  it('continues with blocks below when the answer is more than a paragraph', () => {
    const { after } = accept({ kind: 'caret', blockId: 'z', offset: 4 }, 'First.\n\nSecond.')
    expect(text(after['z'])).toBe('Zulu')
    expect(reading(after).slice(-3)).toEqual(['text:Zulu', 'text:First.', 'text:Second.'])
  })

  it('inserts below a block, replacing it when it is an empty paragraph', () => {
    const below = accept({ kind: 'after', blockId: 'a' }, '## Summary\n\nShort.')
    expect(reading(below.after).slice(0, 3)).toEqual(['text:Alpha beta gamma', 'heading_2:Summary', 'text:Short.'])
    expect(below.plan.after).toEqual({ kind: 'text', blockId: 'n2', start: END, end: END })
    const replaced = accept({ kind: 'after', blockId: 'e' }, '## Summary\n\n---')
    expect(replaced.after['e']).toBeUndefined()
    expect(reading(replaced.after).slice(0, 3)).toEqual(['text:Alpha beta gamma', 'heading_2:Summary', 'divider:'])
    // The last block has no caret: the new blocks are selected instead.
    expect(replaced.plan.after).toEqual({ kind: 'blocks', ids: ['n1', 'n2'] })
  })

  it('inserts inside a list when the anchor is nested', () => {
    const { after } = accept({ kind: 'after', blockId: 'l1' }, 'nested answer')
    expect(after['l'].content).toEqual(['l1', 'n1'])
  })

  it('inserts first in the page without an anchor, and falls back to that when the anchor is gone', () => {
    expect(reading(accept({ kind: 'after', blockId: null }, 'Top').after)[0]).toBe('text:Top')
    expect(reading(accept({ kind: 'after', blockId: 'missing' }, 'Top').after)[0]).toBe('text:Top')
    expect(reading(accept({ kind: 'range', blockId: 'missing', start: 0, end: 3 }, 'Top').after)[0]).toBe('text:Top')
    expect(reading(accept({ kind: 'caret', blockId: 'missing', offset: 0 }, 'Top').after)[0]).toBe('text:Top')
    expect(reading(accept({ kind: 'blocks', ids: ['missing'] }, 'Top').after)[0]).toBe('text:Top')
  })

  it('works on an empty page', () => {
    const empty: BlockMap = { page: block('page', 'page', null, [], { title: [['Doc']] }) }
    const { after } = accept({ kind: 'after', blockId: null }, '- [ ] first task', true, empty)
    expect(reading(after)).toEqual(['to_do:first task'])
  })

  it('gives every created block a fresh id and never reuses an existing one', () => {
    const { ops } = accept({ kind: 'after', blockId: 'a' }, 'a\n\nb\n\nc')
    const created = ops.filter((op) => op.op === 'create').map((op) => (op.op === 'create' ? op.input.id : ''))
    expect(created).toEqual(['n1', 'n2', 'n3'])
    expect(new Set(created).size).toBe(3)
  })
})
