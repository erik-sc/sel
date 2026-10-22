import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType } from '@shared/types'
import {
  blockCounts,
  countBlocks,
  countPage,
  countText,
  describeDetail,
  describePage,
  describeSelection,
  NO_TEXT,
  readingMinutes
} from './countWords'

function block(id: string, type: BlockType, props: BlockProps = {}, content: string[] = []): Block {
  return { id, type, parentId: null, content, props, createdAt: 0, updatedAt: 0, trashedAt: null }
}

const text = (s: string): BlockProps => ({ title: [[s]] })

function map(...blocks: Block[]): (id: string) => Block | undefined {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  return (id) => byId.get(id)
}

describe('countText', () => {
  it('counts words and characters', () => {
    expect(countText('Hello, world. This is sel!')).toMatchObject({ words: 5, characters: 26 })
    expect(countText('')).toBe(NO_TEXT)
    expect(countText('   ')).toMatchObject({ words: 0, characters: 3 })
  })

  it('keeps accented words and contractions whole', () => {
    expect(countText('Ação é café, não?').words).toBe(4)
    expect(countText("don't stop").words).toBe(2)
    // A decomposed accent is one character with its letter.
    expect(countText('café').characters).toBe(4)
  })

  it('counts an emoji as one character', () => {
    expect(countText('👍🏽 ok').characters).toBe(4)
  })

  it('leaves line breaks out of the characters', () => {
    expect(countText('one\ntwo')).toMatchObject({ words: 2, characters: 6 })
  })

  it('splits Chinese and Japanese into words and times them by the character', () => {
    const zh = countText('我们今天去公园散步')
    expect(zh.words).toBeGreaterThan(1)
    expect(zh.cjkWords).toBe(zh.words)
    expect(zh.cjkCharacters).toBe(9)
    const mixed = countText('sel は 便利です')
    expect(mixed.words - mixed.cjkWords).toBe(1)
  })

  it('counts without Intl.Segmenter too', () => {
    expect(countText('Ação é café, não?', { segment: false }).words).toBe(4)
    expect(countText("don't stop", { segment: false }).words).toBe(2)
    expect(countText('我们去 park', { segment: false })).toMatchObject({ words: 4, cjkWords: 3, cjkCharacters: 3 })
    expect(countText('👍🏽 ok', { segment: false }).words).toBe(1)
  })
})

describe('reading time', () => {
  const words = (n: number) => ({ words: n, characters: n * 5, cjkWords: 0, cjkCharacters: 0 })

  it('rounds to whole minutes, at least one', () => {
    expect(readingMinutes(NO_TEXT)).toBe(0)
    expect(readingMinutes(words(3))).toBe(1)
    expect(readingMinutes(words(1240))).toBe(6)
    expect(readingMinutes(words(2200))).toBe(10)
  })

  it('reads Chinese and Japanese by the character', () => {
    expect(readingMinutes({ words: 600, characters: 1500, cjkWords: 600, cjkCharacters: 1500 })).toBe(3)
  })
})

describe('labels', () => {
  const counts = { words: 1240, characters: 7312, cjkWords: 0, cjkCharacters: 0 }

  it('says words and reading time for a page', () => {
    expect(describePage(counts)).toBe('1,240 words · 6 min read')
    expect(describePage({ ...counts, words: 1 })).toBe('1 word · 1 min read')
    expect(describePage(NO_TEXT)).toBe('')
  })

  it('says how much is selected and what the characters are', () => {
    expect(describeSelection({ ...counts, words: 38 })).toBe('38 words selected')
    expect(describeSelection({ ...counts, words: 1 })).toBe('1 word selected')
    expect(describeDetail(counts)).toBe('1,240 words · 7,312 characters')
    expect(describeDetail({ ...counts, words: 1, characters: 1 })).toBe('1 word · 1 character')
  })
})

describe('countPage', () => {
  it('counts every kind of text block, nested and collapsed children included', () => {
    const get = map(
      block('p', 'page', text('A title of five words'), ['h', 'l', 't', 'q', 'c', 'code', 'img', 'div']),
      block('h', 'heading_1', text('Heading')),
      block('l', 'bulleted_list', text('one'), ['l2']),
      block('l2', 'numbered_list', text('two'), ['td']),
      block('td', 'to_do', { title: [['three'], [' four', [['b']]]], checked: true }),
      block('t', 'toggle', { ...text('folded'), collapsed: true }, ['t1']),
      block('t1', 'text', text('hidden but counted')),
      block('q', 'quote', text('a quote')),
      block('c', 'callout', text('a callout')),
      block('code', 'code', { title: [['const x = 1']], language: 'ts' }),
      block('img', 'image', { url: 'x.png', caption: [['a caption']] }),
      block('div', 'divider')
    )
    // Heading 1, one two three four 4, folded hidden but counted 4, a quote 2, a callout 2, const x 1 3, a caption 2.
    expect(countPage('p', get).words).toBe(18)
  })

  it('leaves out the title, sub-pages and databases with everything under them', () => {
    const get = map(
      block('p', 'page', text('Title words here'), ['a', 'sub', 'db']),
      block('a', 'text', text('two words')),
      block('sub', 'page', text('Sub page'), ['sub1']),
      block('sub1', 'text', text('not counted at all')),
      block('db', 'database', text('Tasks'), ['row']),
      block('row', 'page', text('A row'), ['row1']),
      block('row1', 'text', text('row body'))
    )
    expect(countPage('p', get)).toMatchObject({ words: 2, characters: 9 })
  })

  it('skips blocks that are not loaded and survives a cycle', () => {
    const get = map(
      block('p', 'page', {}, ['a', 'gone']),
      block('a', 'text', text('loop'), ['b']),
      block('b', 'text', text('back'), ['a', 'p'])
    )
    expect(countPage('p', get).words).toBe(2)
    expect(countPage('missing', get)).toBe(NO_TEXT)
  })

  it('counts a selection of blocks once each, with their children', () => {
    const get = map(block('a', 'toggle', text('one two'), ['b']), block('b', 'text', text('three')), block('c', 'text', text('four')))
    expect(countBlocks(['a', 'b', 'c'], get).words).toBe(4)
    expect(countBlocks([], get)).toBe(NO_TEXT)
  })

  it('reuses the count of a block that did not change', () => {
    const b = block('a', 'text', text('same words'))
    expect(blockCounts(b)).toBe(blockCounts(b))
    expect(blockCounts({ ...b, props: text('other three words') }).words).toBe(3)
  })
})
