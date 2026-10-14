// Find in page: where a query occurs in the text on screen. Pure: strings go in, offsets come
// out; the find bar turns them into DOM ranges. Free of the DOM, React and the store.
//
// Matching ignores case and accents, so "acao" finds "Ação" and "cafe" finds "café". A match
// stays inside one run of text (a block's line, a table cell), but may cross the formatting
// inside it: "bold" is found in "**bo**ld".

/** More matches than this are not counted one by one; the bar says "1000+". */
export const MAX_MATCHES = 1000

/** A text with case and accents removed, and where each of its characters came from. */
export interface FoldedText {
  text: string
  /** For each character of `text`, the index in the original where its source character starts. */
  starts: number[]
  /** ...and where it ends. */
  ends: number[]
}

// Only the accents of Latin (and Greek, Cyrillic) letters: the marks of other scripts, such as
// the Japanese voicing marks, make a different letter, so "か" must not find "が".
const ACCENTS = /[\u0300-\u036f]/g
const ACCENT = /^[\u0300-\u036f]$/

/** Lower-cases `text` and strips its accents, keeping a map back to the original. */
export function fold(text: string): FoldedText {
  let out = ''
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) ?? 0
    const char = String.fromCodePoint(cp)
    // Recomposed after the accents go, so a Korean syllable stays one letter and is not found by its parts.
    const folded = char.toLowerCase().normalize('NFD').replace(ACCENTS, '').normalize('NFC')
    for (let k = 0; k < folded.length; k++) {
      starts.push(i)
      ends.push(i + char.length)
    }
    out += folded
    i += char.length
  }
  return { text: out, starts, ends }
}

/** The query as it is matched: folded, with runs of white space made one space. Empty means "nothing to find". */
export function foldQuery(query: string): string {
  const folded = fold(query.replace(/\s+/g, ' ')).text
  return folded.trim() === '' ? '' : folded
}

export interface TextMatch {
  /** Offsets in the original text, end exclusive. */
  start: number
  end: number
}

/** Non-overlapping matches of `query` in `text`, at most `limit` of them. */
export function findMatches(text: string, query: string, limit = MAX_MATCHES): TextMatch[] {
  const needle = foldQuery(query)
  if (!needle || limit <= 0) return []
  const hay = fold(text.replace(/\s/g, ' '))
  const matches: TextMatch[] = []
  let from = 0
  while (matches.length < limit) {
    const at = hay.text.indexOf(needle, from)
    if (at < 0) break
    const start = hay.starts[at]
    let end = hay.ends[at + needle.length - 1]
    // Accents typed as separate marks fold to nothing; the match takes those on its last letter.
    while (end < text.length && ACCENT.test(text[end])) end++
    // A folded character can stand for part of a wider original one; never return an empty match.
    if (end > start) matches.push({ start, end })
    from = at + needle.length
  }
  return matches
}

/** A point in a run of text: which of its nodes, and the offset inside that node. */
export interface NodePoint {
  node: number
  offset: number
}

export interface SegmentMatch {
  /** Which run of text. */
  segment: number
  start: NodePoint
  end: NodePoint
}

/**
 * Matches across runs of text. A run is the text nodes of one line or cell, in order (they
 * are split wherever the formatting changes); a match never spans two runs. At most `limit`
 * matches overall, in document order.
 */
export function findInSegments(segments: readonly (readonly string[])[], query: string, limit = MAX_MATCHES): SegmentMatch[] {
  if (!foldQuery(query)) return []
  const out: SegmentMatch[] = []
  for (let s = 0; s < segments.length && out.length < limit; s++) {
    const nodes = segments[s]
    const text = nodes.join('')
    if (!text) continue
    for (const match of findMatches(text, query, limit - out.length)) {
      out.push({ segment: s, start: locate(nodes, match.start, 'start'), end: locate(nodes, match.end, 'end') })
    }
  }
  return out
}

/**
 * Turns an offset in the joined run into a node and an offset in it. On a boundary between two
 * nodes a start belongs to the later node and an end to the earlier one, so a range never
 * begins or ends in a node it does not cover.
 */
export function locate(nodes: readonly string[], offset: number, side: 'start' | 'end'): NodePoint {
  let before = 0
  for (let i = 0; i < nodes.length; i++) {
    const length = nodes[i].length
    const inside = side === 'start' ? offset < before + length : offset <= before + length
    if (inside) return { node: i, offset: offset - before }
    before += length
  }
  const last = Math.max(0, nodes.length - 1)
  return { node: last, offset: nodes[last]?.length ?? 0 }
}

/** The next match to show from `current` (forward or back), wrapping around; -1 when there are none. */
export function stepIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1
  if (current < 0 || current >= total) return direction === 1 ? 0 : total - 1
  return (current + direction + total) % total
}

/** Where to stand after the matches were found again (the page changed): the same place, or the nearest that is left. */
export function keepIndex(current: number, total: number): number {
  if (total <= 0) return -1
  if (current < 0) return 0
  return Math.min(current, total - 1)
}

/** What the bar says about the matches. */
export function describeCount(current: number, total: number, query: string): string {
  if (!foldQuery(query)) return ''
  if (total === 0) return 'No results'
  const of = total >= MAX_MATCHES ? `${MAX_MATCHES}+` : String(total)
  return current >= 0 ? `${current + 1} of ${of}` : of
}

/** Text worth starting a search with: a short selection on one line, or nothing. */
export function seedFrom(selection: string | null | undefined): string {
  const text = (selection ?? '').trim()
  if (!text || text.length > 100 || /[\r\n]/.test(text)) return ''
  return text
}
