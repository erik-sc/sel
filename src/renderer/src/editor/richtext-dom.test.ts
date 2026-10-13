import { describe, expect, it } from 'vitest'
import type { RichText } from '@shared/types'
import {
  addMark,
  classesForMarks,
  concat,
  blockColorClass,
  insertText,
  isColorValue,
  markValueAt,
  marksAt,
  normalize,
  parseMarks,
  parseRichText,
  rangeHasMark,
  removeMark,
  replaceRange,
  richTextEqual,
  rtLength,
  slice,
  split,
  textOf,
  toHtml,
  toggleMark
} from './richtext-dom'

const sample: RichText = [['Hello '], ['bold', [['b']]], [' world']]

describe('normalize', () => {
  it('merges neighbours with equal marks and drops empty spans', () => {
    expect(normalize([['a'], [''], ['b'], ['c', [['b']]], ['d', [['b']]]])).toEqual([['ab'], ['cd', [['b']]]])
  })

  it('treats an empty marks array as no marks', () => {
    expect(normalize([['a', []], ['b']])).toEqual([['ab']])
  })

  it('orders marks canonically so equal sets merge', () => {
    expect(normalize([['a', [['i'], ['b']]], ['b', [['b'], ['i']]]])).toEqual([['ab', [['b'], ['i']]]])
  })

  it('keeps one mark per kind, last wins; text and background colours coexist', () => {
    expect(normalize([['x', [['h', 'red'], ['h', 'blue'], ['h', 'green_background']]]])).toEqual([
      ['x', [['h', 'blue'], ['h', 'green_background']]]
    ])
  })

  it('does not merge different links', () => {
    expect(normalize([['a', [['a', 'https://a.com']]], ['b', [['a', 'https://b.com']]]])).toHaveLength(2)
  })

  it('does not mutate its input', () => {
    const input: RichText = [['a'], ['b']]
    normalize(input)
    expect(input).toEqual([['a'], ['b']])
  })
})

describe('measuring', () => {
  it('textOf / rtLength', () => {
    expect(textOf(sample)).toBe('Hello bold world')
    expect(rtLength(sample)).toBe(16)
    expect(rtLength(undefined)).toBe(0)
  })

  it('richTextEqual ignores span segmentation', () => {
    expect(richTextEqual([['ab']], [['a'], ['b']])).toBe(true)
    expect(richTextEqual([['ab']], [['ab', [['b']]]])).toBe(false)
    expect(richTextEqual(undefined, [])).toBe(true)
  })
})

describe('slice / split / concat', () => {
  it('slices across span boundaries keeping marks', () => {
    expect(slice(sample, 4, 8)).toEqual([['o '], ['bo', [['b']]]])
    expect(slice(sample, 6, 10)).toEqual([['bold', [['b']]]])
    expect(slice(sample, 10)).toEqual([[' world']])
    expect(slice(sample, 3, 3)).toEqual([])
  })

  it('split at an offset and concat is the identity', () => {
    for (let i = 0; i <= rtLength(sample); i++) {
      const [a, b] = split(sample, i)
      expect(rtLength(a)).toBe(i)
      expect(concat(a, b)).toEqual(sample)
    }
  })

  it('split inside a marked span keeps the mark on both halves', () => {
    const [a, b] = split(sample, 8)
    expect(a).toEqual([['Hello '], ['bo', [['b']]]])
    expect(b).toEqual([['ld', [['b']]], [' world']])
  })

  it('concat merges adjacent equal spans', () => {
    expect(concat([['a', [['i']]]], [['b', [['i']]]], undefined, [['c']])).toEqual([['ab', [['i']]], ['c']])
  })
})

describe('editing', () => {
  it('replaceRange deletes and inserts', () => {
    expect(replaceRange(sample, 0, 6, [])).toEqual([['bold', [['b']]], [' world']])
    expect(textOf(replaceRange(sample, 6, 10, [['brave']]))).toBe('Hello brave world')
  })

  it('insertText inherits marks from the character before the caret', () => {
    expect(insertText(sample, 10, '!')).toEqual([['Hello '], ['bold!', [['b']]], [' world']])
    expect(insertText(sample, 6, '!')).toEqual([['Hello !'], ['bold', [['b']]], [' world']])
    expect(insertText([], 0, 'x')).toEqual([['x']])
  })

  it('marksAt', () => {
    expect(marksAt(sample, 7)).toEqual([['b']])
    expect(marksAt(sample, 6)).toEqual([])
    expect(marksAt([['x', [['i']]]], 0)).toEqual([['i']])
  })
})

describe('marks over a range', () => {
  it('addMark splits spans as needed', () => {
    expect(addMark([['abcdef']], 2, 4, ['i'])).toEqual([['ab'], ['cd', [['i']]], ['ef']])
  })

  it('addMark replaces a mark of the same kind', () => {
    expect(addMark([['ab', [['a', 'https://old.com']]]], 0, 2, ['a', 'https://new.com'])).toEqual([
      ['ab', [['a', 'https://new.com']]]
    ])
  })

  it('removeMark only touches the range and re-merges', () => {
    expect(removeMark([['abcd', [['b']]]], 1, 3, 'b')).toEqual([['a', [['b']]], ['bc'], ['d', [['b']]]])
    expect(removeMark(sample, 0, 16, 'b')).toEqual([['Hello bold world']])
  })

  it('rangeHasMark requires full coverage', () => {
    expect(rangeHasMark(sample, 6, 10, 'b')).toBe(true)
    expect(rangeHasMark(sample, 5, 10, 'b')).toBe(false)
    expect(rangeHasMark(sample, 3, 3, 'b')).toBe(false)
  })

  it('toggleMark adds when partially marked and removes when fully marked', () => {
    const all = toggleMark(sample, 0, 16, ['b'])
    expect(all).toEqual([['Hello bold world', [['b']]]])
    expect(toggleMark(all, 0, 16, ['b'])).toEqual([['Hello bold world']])
  })

  it('toggling twice restores the original', () => {
    const once = toggleMark(sample, 2, 5, ['u'])
    expect(toggleMark(once, 2, 5, ['u'])).toEqual(sample)
  })

  it('background colour does not replace text colour', () => {
    const rt = addMark(addMark([['abc']], 0, 3, ['h', 'red']), 0, 3, ['h', 'blue_background'])
    expect(rt).toEqual([['abc', [['h', 'red'], ['h', 'blue_background']]]])
    expect(removeMark(rt, 0, 3, 'hb')).toEqual([['abc', [['h', 'red']]]])
  })

  it('markValueAt returns the link of the range', () => {
    const rt = addMark([['see docs']], 4, 8, ['a', 'https://docs.dev'])
    expect(markValueAt(rt, 4, 8, 'a')).toBe('https://docs.dev')
    expect(markValueAt(rt, 0, 3, 'a')).toBeNull()
  })
})

describe('serialising and validating', () => {
  it('toHtml escapes text and attribute values', () => {
    expect(toHtml([['<b>&"\'', [['b']]]])).toBe('<strong>&lt;b&gt;&amp;&quot;&#39;</strong>')
    expect(toHtml([['<img src=x onerror=alert(1)>']])).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(toHtml([['x', [['a', 'https://a.com/?q=1&r=2']]]])).toBe('<a href="https://a.com/?q=1&amp;r=2">x</a>')
    expect(toHtml([['a\nb']])).toBe('a<br>b')
  })

  it('toHtml never emits a link that is not allowed', () => {
    expect(toHtml([['x', [['a', 'javascript:alert(1)']]]])).toBe('x')
    expect(toHtml([['x', [['a', 'https://a.com/"><script>alert(1)</script>']]]])).toBe('x')
    expect(toHtml([['x', [['a', "https://a.com/' onmouseover='alert(1)"]]]])).toBe('x')
  })

  it('parseMarks / parseRichText reject malformed input', () => {
    expect(parseMarks([['b'], ['zz'], 'i', ['a'], ['a', 'https://x.dev'], null])).toEqual([['b'], ['a', 'https://x.dev']])
    expect(parseMarks('nope')).toEqual([])
    expect(parseMarks({ length: 1, 0: ['b'] })).toEqual([])
    expect(parseRichText([['ok'], [1], 'x', ['b', [['b']]]])).toEqual([['ok'], ['b', [['b']]]])
    expect(parseRichText({})).toEqual([])
  })

  it('parseMarks drops links that are not allowed and normalises the rest', () => {
    expect(parseMarks([['a', 'javascript:alert(1)']])).toEqual([])
    expect(parseMarks([['a', ' JaVaScRiPt:alert(1)']])).toEqual([])
    expect(parseMarks([['a', 'data:text/html,<script>alert(1)</script>']])).toEqual([])
    expect(parseMarks([['a', 'vbscript:msgbox(1)']])).toEqual([])
    expect(parseMarks([['a', 'file:///C:/Windows/System32/calc.exe']])).toEqual([])
    expect(parseMarks([['a', 42]])).toEqual([])
    expect(parseMarks([['a', 'example.com']])).toEqual([['a', 'https://example.com']])
    expect(parseRichText([['x', [['a', 'javascript:alert(1)'], ['b']]]])).toEqual([['x', [['b']]]])
  })

  it('parseMarks only keeps palette colours', () => {
    expect(parseMarks([['h', 'blue'], ['h', 'red_background']])).toEqual([['h', 'blue'], ['h', 'red_background']])
    expect(parseMarks([['h', 'x" onload="y']])).toEqual([])
    expect(parseMarks([['h', 'url(https://evil.example/x)']])).toEqual([])
    expect(parseMarks([['h', '_background']])).toEqual([])
    expect(isColorValue('green')).toBe(true)
    expect(isColorValue('green_background')).toBe(true)
    expect(isColorValue('greenish')).toBe(false)
    expect(isColorValue(7)).toBe(false)
  })

  it('parseRichText is idempotent on clean rich text', () => {
    const clean: RichText = [['a ', [['b']]], ['link', [['a', 'https://x.dev'], ['h', 'red']]], [' z']]
    expect(parseRichText(clean)).toEqual(normalize(clean))
    expect(parseRichText(parseRichText(clean))).toEqual(parseRichText(clean))
  })

  it('classesForMarks / blockColorClass only emit known colour names', () => {
    expect(classesForMarks([['b'], ['h', 'blue'], ['h', 'red_background']])).toEqual(['rt-b', 'rt-fg-blue', 'rt-bg-red'])
    expect(classesForMarks([['h', 'x" onload="y']])).toEqual([])
    expect(blockColorClass('blue')).toBe('blk-fg-blue')
    expect(blockColorClass('blue_background')).toBe('blk-bg-blue')
    expect(blockColorClass('blue is-selected')).toBe('')
    expect(blockColorClass(undefined)).toBe('')
  })
})
