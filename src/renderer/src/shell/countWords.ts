// Word count: how many words and characters a page (or a selection) holds, and how long it
// takes to read. Pure: blocks and strings go in, numbers and labels come out. Free of the DOM,
// React and the store; the readout in the top bar (./WordCount.tsx) feeds it.
//
// What counts is the page's own text: every block's text (paragraphs, headings, lists, to-dos,
// toggles with their children even when collapsed, quotes, callouts, code) and the captions of
// images and bookmarks. Not counted: the page's title (it is the page's name), and anything
// that belongs to another page: sub-pages and databases, their titles, rows and contents.
//
// Words are found with Intl.Segmenter, so accented words stay whole and Chinese and Japanese,
// written without spaces, are split into words too. Those two are read by the character
// rather than by the word, so their characters go into the reading time at their own pace.
import type { Block, RichText } from '@shared/types'

export interface TextCounts {
  words: number
  /** Characters as the reader sees them (an emoji or an accented letter is one), spaces included, line breaks not. */
  characters: number
  /** How many of `words` are Chinese or Japanese... */
  cjkWords: number
  /** ...and how many characters those have: they are timed by the character. */
  cjkCharacters: number
}

export const NO_TEXT: TextCounts = Object.freeze({ words: 0, characters: 0, cjkWords: 0, cjkCharacters: 0 })

/** Reading pace for text written in words. */
export const WORDS_PER_MINUTE = 220
/** Reading pace for Chinese and Japanese, in characters. */
export const CJK_CHARACTERS_PER_MINUTE = 500

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu
const LINE_BREAKS = /[\r\n\p{Zl}\p{Zp}]/gu
/** Without Intl.Segmenter: runs of letters, marks and digits, with apostrophes inside them ("don't"). */
const FALLBACK_WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu

interface Segmenter {
  segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }>
}
type SegmenterCtor = new (locale: string, options: { granularity: 'word' | 'grapheme' }) => Segmenter

let words: Segmenter | null | undefined
let graphemes: Segmenter | null | undefined

function segmenter(granularity: 'word' | 'grapheme'): Segmenter | null {
  const make = (): Segmenter | null => {
    const ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
    return typeof ctor === 'function' ? new ctor('und', { granularity }) : null
  }
  if (granularity === 'word') return words === undefined ? (words = make()) : words
  return graphemes === undefined ? (graphemes = make()) : graphemes
}

function countCjk(word: string): number {
  CJK.lastIndex = 0
  let n = 0
  while (CJK.exec(word)) n++
  return n
}

/**
 * Words and characters in a piece of text. `segment: false` uses the simpler counting kept for
 * when Intl.Segmenter is missing: there each Chinese or Japanese character is one word.
 */
export function countText(text: string, options: { segment?: boolean } = {}): TextCounts {
  if (!text) return NO_TEXT
  const flat = text.replace(LINE_BREAKS, '')
  const useSegmenter = options.segment !== false
  const graphemeSeg = useSegmenter ? segmenter('grapheme') : null
  const characters = graphemeSeg ? Array.from(graphemeSeg.segment(flat)).length : Array.from(flat).length

  let count = 0
  let cjkWords = 0
  let cjkCharacters = 0
  const wordSeg = useSegmenter ? segmenter('word') : null
  if (wordSeg) {
    for (const part of wordSeg.segment(text)) {
      if (!part.isWordLike) continue
      count++
      const cjk = countCjk(part.segment)
      if (cjk > 0) {
        cjkWords++
        cjkCharacters += cjk
      }
    }
  } else {
    for (const match of text.matchAll(FALLBACK_WORD)) {
      const cjk = countCjk(match[0])
      if (cjk === 0) {
        count++
        continue
      }
      // Each character a word; letters of other scripts stuck to them make one word more.
      const rest = match[0].replace(CJK, '') ? 1 : 0
      count += cjk + rest
      cjkWords += cjk
      cjkCharacters += cjk
    }
  }
  if (count === 0 && characters === 0) return NO_TEXT
  return { words: count, characters, cjkWords, cjkCharacters }
}

export function addCounts(a: TextCounts, b: TextCounts): TextCounts {
  if (b === NO_TEXT) return a
  if (a === NO_TEXT) return b
  return {
    words: a.words + b.words,
    characters: a.characters + b.characters,
    cjkWords: a.cjkWords + b.cjkWords,
    cjkCharacters: a.cjkCharacters + b.cjkCharacters
  }
}

export function sameCounts(a: TextCounts, b: TextCounts): boolean {
  return a.words === b.words && a.characters === b.characters && a.cjkWords === b.cjkWords && a.cjkCharacters === b.cjkCharacters
}

function plain(rich: RichText | undefined): string {
  if (!Array.isArray(rich)) return ''
  let out = ''
  for (const span of rich) if (Array.isArray(span) && typeof span[0] === 'string') out += span[0]
  return out
}

/** Pages and databases are other pages: neither they nor anything under them is counted. */
function isOtherPage(block: Block): boolean {
  return block.type === 'page' || block.type === 'database'
}

// Blocks are replaced, never changed in place, when they are edited (see store/ops.ts): the
// count of a block object is computed once, and a recount of a large page only adds numbers up.
const memo = new WeakMap<Block, TextCounts>()

/** The text of one block itself, without its children. */
export function blockCounts(block: Block): TextCounts {
  const known = memo.get(block)
  if (known) return known
  let counts = NO_TEXT
  if (!isOtherPage(block)) {
    const title = plain(block.props.title)
    const caption = plain(block.props.caption)
    counts = countText(title && caption ? `${title}\n${caption}` : title || caption)
  }
  memo.set(block, counts)
  return counts
}

/**
 * The blocks `ids` and everything nested under them, skipping other pages. Blocks that are not
 * loaded are skipped too; a block reached twice is counted once.
 */
export function countBlocks(ids: readonly string[], get: (id: string) => Block | undefined): TextCounts {
  let total = NO_TEXT
  const seen = new Set<string>()
  const stack = [...ids]
  while (stack.length) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const block = get(id)
    if (!block || isOtherPage(block)) continue
    total = addCounts(total, blockCounts(block))
    for (const child of block.content) stack.push(child)
  }
  return total
}

/** Everything on a page, below its title. */
export function countPage(pageId: string, get: (id: string) => Block | undefined): TextCounts {
  const page = get(pageId)
  return page ? countBlocks(page.content, get) : NO_TEXT
}

/** Whole minutes to read, at least one for any text at all. */
export function readingMinutes(counts: TextCounts): number {
  if (counts.words === 0) return 0
  const minutes = (counts.words - counts.cjkWords) / WORDS_PER_MINUTE + counts.cjkCharacters / CJK_CHARACTERS_PER_MINUTE
  return Math.max(1, Math.round(minutes))
}

const number = new Intl.NumberFormat('en-US')

function plural(n: number, one: string, many: string): string {
  return `${number.format(n)} ${n === 1 ? one : many}`
}

/** The readout for a page: "1,240 words · 6 min read"; empty for a page without words. */
export function describePage(counts: TextCounts): string {
  if (counts.words === 0) return ''
  return `${plural(counts.words, 'word', 'words')} · ${number.format(readingMinutes(counts))} min read`
}

/** The readout for a selection: "38 words selected". */
export function describeSelection(counts: TextCounts): string {
  return `${plural(counts.words, 'word', 'words')} selected`
}

/** The longer line shown on hover: "1,240 words · 7,312 characters". */
export function describeDetail(counts: TextCounts): string {
  return `${plural(counts.words, 'word', 'words')} · ${plural(counts.characters, 'character', 'characters')}`
}
