import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType, RichText } from '@shared/types'
import { MAX_INLINE_MARKDOWN_LENGTH, parseInlineMarkdown } from './markdown'
import { applyPendingMarks, blockShortcutOps, inlineShortcut, toggleMarkIn } from './typing'

function block(id: string, type: BlockType, parentId: string | null, props: BlockProps = {}): Block {
  return { id, type, parentId, content: [], props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

describe('toggleMarkIn (formatting shortcut with a collapsed caret)', () => {
  it('adds a mark that is missing and removes one that is there', () => {
    expect(toggleMarkIn([], ['b'])).toEqual([['b']])
    expect(toggleMarkIn([['b']], ['b'])).toEqual([])
    expect(toggleMarkIn([['i']], ['b'])).toEqual([['b'], ['i']])
    expect(toggleMarkIn([['b'], ['i']], ['i'])).toEqual([['b']])
  })

  it('toggling twice is the identity', () => {
    const marks = toggleMarkIn([['a', 'https://x.dev'], ['u']], ['c'])
    expect(toggleMarkIn(marks, ['c'])).toEqual([['u'], ['a', 'https://x.dev']])
  })

  it('does not mutate its input', () => {
    const marks = [['b']] as [['b']]
    toggleMarkIn(marks, ['i'])
    expect(marks).toEqual([['b']])
  })
})

describe('applyPendingMarks', () => {
  it('formats the text typed after a formatting shortcut', () => {
    // "Hello " + Ctrl+B + "w": the DOM inserted the "w" as plain text.
    expect(applyPendingMarks([['Hello w']], 6, 7, [['b']])).toEqual([['Hello '], ['w', [['b']]]])
  })

  it('un-formats the text typed after toggling a mark off', () => {
    // Caret at the end of bold text, Ctrl+B, then "x": the DOM put the "x" inside the bold node.
    expect(applyPendingMarks([['boldx', [['b']]]], 4, 5, [])).toEqual([['bold', [['b']]], ['x']])
  })

  it('keeps the text typed after an inline shortcut plain, wherever the caret is', () => {
    const rt: RichText = [['say '], ['hi!', [['b']]], [' there']]
    expect(applyPendingMarks(rt, 6, 7, [])).toEqual([['say '], ['hi', [['b']]], ['! there']])
  })

  it('handles several characters at once (IME commit, paste)', () => {
    expect(applyPendingMarks([['日本語']], 0, 3, [['i']])).toEqual([['日本語', [['i']]]])
    expect(applyPendingMarks([['a'], ['bcd', [['b']]], ['e']], 1, 4, [['c']])).toEqual([['a'], ['bcd', [['c']]], ['e']])
  })

  it('works in an empty block and at the very start', () => {
    expect(applyPendingMarks([['x']], 0, 1, [['b']])).toEqual([['x', [['b']]]])
    expect(applyPendingMarks([['xrest', [['i']]]], 0, 1, [])).toEqual([['x'], ['rest', [['i']]]])
  })

  it('returns null when there is nothing to rewrite', () => {
    expect(applyPendingMarks([['ab', [['b']]]], 1, 2, [['b']])).toBeNull()
    expect(applyPendingMarks([['ab']], 1, 2, [])).toBeNull()
    expect(applyPendingMarks([['ab']], 1, 1, [['b']])).toBeNull()
    expect(applyPendingMarks([['ab']], 2, 1, [['b']])).toBeNull()
    expect(applyPendingMarks([['ab']], -1, 1, [['b']])).toBeNull()
    // The typed range is not there (stale offsets): leave the text alone.
    expect(applyPendingMarks([['ab']], 1, 9, [['b']])).toBeNull()
  })

  it('never changes the text itself', () => {
    const rt: RichText = [['one '], ['two', [['b'], ['i']]], [' three']]
    const out = applyPendingMarks(rt, 5, 9, [['u']])
    expect(out?.map((s) => s[0]).join('')).toBe('one two three')
  })
})

describe('inlineShortcut', () => {
  it('applies the mark and asks for plain text next', () => {
    expect(inlineShortcut([['a **bold**']], 10, '*')).toEqual({ rt: [['a '], ['bold', [['b']]]], caret: 6, next: [] })
    expect(inlineShortcut([['`x`']], 3, '`')).toEqual({ rt: [['x', [['c']]]], caret: 1, next: [] })
  })

  it('text typed next keeps the marks the run had before the shortcut', () => {
    const r = inlineShortcut([['see `code`', [['b']]]], 10, '`')
    expect(r?.rt).toEqual([['see ', [['b']]], ['code', [['b'], ['c']]]])
    expect(r?.next).toEqual([['b']])
  })

  it('the next character really ends up outside the formatted run', () => {
    const r = inlineShortcut([['**bold**']], 8, '*')
    if (!r) throw new Error('expected a shortcut')
    // The browser inserts the next character into the bold node the caret sits in.
    const typed: RichText = [['bold!', [['b']]]]
    expect(applyPendingMarks(typed, r.caret, r.caret + 1, r.next)).toEqual([['bold', [['b']]], ['!']])
  })

  it('ignores other keys, unfinished delimiters and delimiters inside inline code', () => {
    expect(inlineShortcut([['a **bold**']], 10, 'x')).toBeNull()
    expect(inlineShortcut([['a **bold*']], 9, '*')).toBeNull()
    expect(inlineShortcut([['a *b*', [['c']]]], 5, '*')).toBeNull()
  })
})

describe('blockShortcutOps', () => {
  const b = block('x', 'text', 'page')
  const ids = (): string => 'n1'

  it('turns the block into the shortcut type, keeping the text after the caret', () => {
    expect(blockShortcutOps(b, [['# Title']], 2, ' ', null, ids)).toEqual([
      { op: 'update', id: 'x', patch: { type: 'heading_1', props: { title: [['Title']] } } }
    ])
    expect(blockShortcutOps(b, [['[x] done']], 4, ' ', null, ids)).toEqual([
      { op: 'update', id: 'x', patch: { type: 'to_do', props: { checked: true, title: [['done']] } } }
    ])
  })

  it('code drops marks; a divider is inserted above', () => {
    expect(blockShortcutOps(b, [['```'], ['x', [['b']]]], 3, '`', null, ids)).toEqual([
      { op: 'update', id: 'x', patch: { type: 'code', props: { title: [['x']] } } }
    ])
    expect(blockShortcutOps(b, [['---rest']], 3, '-', 'prev', ids)).toEqual([
      { op: 'create', input: { id: 'n1', type: 'divider', parentId: 'page', afterId: 'prev', props: {} } },
      { op: 'update', id: 'x', patch: { props: { title: [['rest']] } } }
    ])
  })

  it('only fires in a plain text block, on a trigger key, at the trigger', () => {
    expect(blockShortcutOps(block('h', 'heading_1', 'page'), [['# ']], 2, ' ', null, ids)).toBeNull()
    expect(blockShortcutOps(b, [['# ']], 2, 'a', null, ids)).toBeNull()
    expect(blockShortcutOps(b, [['a # ']], 4, ' ', null, ids)).toBeNull()
    expect(blockShortcutOps(block('orphan', 'text', null), [['# ']], 2, ' ', null, ids)).toBeNull()
  })
})

describe('parseInlineMarkdown on hostile input', () => {
  it('keeps over-long lines as plain text instead of backtracking over them', () => {
    const line = '['.repeat(MAX_INLINE_MARKDOWN_LENGTH * 20)
    const started = performance.now()
    expect(parseInlineMarkdown(line)).toEqual([[line]])
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('still parses ordinary lines', () => {
    expect(parseInlineMarkdown('a **b** [c](https://x.dev) [d](javascript:alert(1))')).toEqual([
      ['a '],
      ['b', [['b']]],
      [' '],
      ['c', [['a', 'https://x.dev']]],
      [' [d](javascript:alert(1))']
    ])
  })
})
