import { describe, expect, it } from 'vitest'
import {
  MAX_MATCHES,
  describeCount,
  findInSegments,
  findMatches,
  fold,
  foldQuery,
  keepIndex,
  locate,
  seedFrom,
  stepIndex
} from './findInPage'

const slices = (text: string, query: string): string[] =>
  findMatches(text, query).map((m) => text.slice(m.start, m.end))

describe('fold', () => {
  it('lower-cases and strips accents, mapping each character back', () => {
    const folded = fold('Ação')
    expect(folded.text).toBe('acao')
    expect(folded.starts).toEqual([0, 1, 2, 3])
    expect(folded.ends).toEqual([1, 2, 3, 4])
  })

  it('maps decomposed accents back to their base letter', () => {
    const folded = fold('café!')
    expect(folded.text).toBe('cafe!')
    expect(folded.starts).toEqual([0, 1, 2, 3, 5])
  })

  it('keeps the marks of other scripts, which make different letters', () => {
    expect(fold('が').text).not.toBe(fold('か').text)
    expect(fold('한').text).toBe('한')
    expect(fold('Ελλάδα').text).toBe('ελλαδα')
  })

  it('keeps characters outside the basic plane whole', () => {
    const folded = fold('a😀b')
    expect(folded.text).toBe('a😀b')
    expect(folded.starts).toEqual([0, 1, 1, 3])
    expect(folded.ends).toEqual([1, 3, 3, 4])
  })
})

describe('foldQuery', () => {
  it('treats blank queries as nothing to find', () => {
    expect(foldQuery('')).toBe('')
    expect(foldQuery('   \n')).toBe('')
  })

  it('collapses white space and folds', () => {
    expect(foldQuery('Olá\t  Mundo')).toBe('ola mundo')
  })
})

describe('findMatches', () => {
  it('ignores case and accents', () => {
    expect(slices('A ação e a Acao', 'acao')).toEqual(['ação', 'Acao'])
    expect(slices('Café com CAFÉ', 'café')).toEqual(['Café', 'CAFÉ'])
  })

  it('returns non-overlapping matches in order', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
  })

  it('does not find a letter inside a different one', () => {
    expect(findMatches('はがき', 'か')).toEqual([])
    expect(findMatches('한국', '하')).toEqual([])
    expect(slices('São Tomé e Ação', 'sao')).toEqual(['São'])
  })

  it('maps offsets back across decomposed characters', () => {
    const text = 'um café forte'
    expect(slices(text, 'café')).toEqual(['café'])
  })

  it('matches a space against any white space, a no-break space included', () => {
    expect(slices('hello world', 'hello world')).toEqual(['hello world'])
  })

  it('finds nothing for a blank query', () => {
    expect(findMatches('anything', '  ')).toEqual([])
  })

  it('stops at the limit', () => {
    expect(findMatches('x'.repeat(50), 'x', 7)).toHaveLength(7)
    expect(findMatches('x'.repeat(50), 'x', 0)).toEqual([])
  })
})

describe('locate', () => {
  const nodes = ['ab', 'cd', 'ef']

  it('puts a start on a boundary in the later node and an end in the earlier one', () => {
    expect(locate(nodes, 2, 'start')).toEqual({ node: 1, offset: 0 })
    expect(locate(nodes, 2, 'end')).toEqual({ node: 0, offset: 2 })
  })

  it('handles the edges of the run', () => {
    expect(locate(nodes, 0, 'start')).toEqual({ node: 0, offset: 0 })
    expect(locate(nodes, 6, 'end')).toEqual({ node: 2, offset: 2 })
    expect(locate(nodes, 6, 'start')).toEqual({ node: 2, offset: 2 })
  })

  it('skips empty nodes', () => {
    expect(locate(['a', '', 'b'], 1, 'start')).toEqual({ node: 2, offset: 0 })
  })
})

describe('findInSegments', () => {
  it('finds a word split by formatting inside one run', () => {
    expect(findInSegments([['some ', 'bo', 'ld', ' text']], 'bold')).toEqual([
      { segment: 0, start: { node: 1, offset: 0 }, end: { node: 2, offset: 2 } }
    ])
  })

  it('never joins two runs', () => {
    expect(findInSegments([['wor'], ['ld']], 'world')).toEqual([])
  })

  it('reports matches in document order with their run', () => {
    const found = findInSegments([['one note'], [], ['Note two', ' and a note']], 'note')
    expect(found.map((m) => [m.segment, m.start.node, m.start.offset])).toEqual([
      [0, 0, 4],
      [2, 0, 0],
      [2, 1, 7]
    ])
  })

  it('applies the limit across runs', () => {
    const runs = Array.from({ length: 10 }, () => ['x x x'])
    expect(findInSegments(runs, 'x', 12)).toHaveLength(12)
    expect(findInSegments(runs, 'x')).toHaveLength(30)
  })

  it('finds nothing for a blank query', () => {
    expect(findInSegments([['text']], '')).toEqual([])
  })
})

describe('stepIndex', () => {
  it('wraps both ways', () => {
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(2, 3, 1)).toBe(0)
    expect(stepIndex(0, 3, -1)).toBe(2)
  })

  it('starts from the first or last match when there is no current one', () => {
    expect(stepIndex(-1, 3, 1)).toBe(0)
    expect(stepIndex(-1, 3, -1)).toBe(2)
    expect(stepIndex(9, 3, 1)).toBe(0)
  })

  it('is -1 when there is nothing', () => {
    expect(stepIndex(0, 0, 1)).toBe(-1)
  })
})

describe('keepIndex', () => {
  it('stays put, or moves to the last match left', () => {
    expect(keepIndex(1, 5)).toBe(1)
    expect(keepIndex(4, 2)).toBe(1)
    expect(keepIndex(-1, 2)).toBe(0)
    expect(keepIndex(3, 0)).toBe(-1)
  })
})

describe('describeCount', () => {
  it('says nothing before there is a query', () => {
    expect(describeCount(-1, 0, ' ')).toBe('')
  })

  it('counts', () => {
    expect(describeCount(-1, 0, 'x')).toBe('No results')
    expect(describeCount(0, 12, 'x')).toBe('1 of 12')
    expect(describeCount(MAX_MATCHES - 1, MAX_MATCHES, 'x')).toBe(`${MAX_MATCHES} of ${MAX_MATCHES}+`)
  })
})

describe('seedFrom', () => {
  it('takes a short selection on one line', () => {
    expect(seedFrom('  budget ')).toBe('budget')
  })

  it('ignores long, multi-line or empty selections', () => {
    expect(seedFrom('a\nb')).toBe('')
    expect(seedFrom('x'.repeat(101))).toBe('')
    expect(seedFrom(null)).toBe('')
  })
})
