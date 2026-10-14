// Which commands a palette query finds, best first. Pure: free of React, the DOM and the store.
//
// Case and accents are ignored as in find in page ("preferencias" finds "Preferências"). Every
// word of the query must be found, in the title or the keywords. A word found as written beats
// one whose letters are only in order ("tgth" for "Toggle theme"); a word that starts the title
// beats one that starts a later word, which beats one in the middle of a word. Recently used
// commands get a boost, and with no query they are listed first.
import { fold, foldQuery } from '../shell/findInPage'

export interface Matchable {
  id: string
  title: string
  keywords?: readonly string[]
}

export interface Ranked<T> {
  command: T
  /** Among the recently used commands. */
  recent: boolean
}

/** At most this many recently used commands are remembered. */
export const RECENT_LIMIT = 8
/** What the most recently used command adds to its score; older ones get less. */
export const RECENT_BOOST = 30
/** A match whose letters are only in order never scores more than this (a word found as written scores 50 or more). */
const FUZZY_MAX = 40

const SEPARATOR = /[\s\-–—/:,.()…&]/

function isWordStart(text: string, index: number): boolean {
  return index === 0 || SEPARATOR.test(text[index - 1])
}

/**
 * Score for the letters of `needle` in order in `hay`; `prefer` picks word starts and runs when
 * it can. 0: not there, or too scattered: letters picked from the middle of words, away from the
 * one before, may be at most a third of them (at least one), so "page" does not find "rePort A buG".
 */
function inOrder(hay: string, needle: string, prefer: boolean): number {
  let score = 0
  let from = 0
  let previous = -2
  let scattered = 0
  const allowed = Math.max(1, Math.floor(needle.length / 3))
  for (const char of needle) {
    let at = -1
    if (prefer) {
      for (let i = hay.indexOf(char, from); i >= 0; i = hay.indexOf(char, i + 1)) {
        if (i === previous + 1 || isWordStart(hay, i)) {
          at = i
          break
        }
      }
    }
    if (at < 0) at = hay.indexOf(char, from)
    if (at < 0) return 0
    if (at === previous + 1) score += 3
    else if (isWordStart(hay, at)) score += 4
    else if (++scattered > allowed) return 0
    else score += 1
    previous = at
    from = at + char.length
  }
  return Math.min(FUZZY_MAX, 5 + score)
}

/**
 * How well one folded query word is found in a folded text, 0 when it is not: 100 at the
 * start, 80 at the start of a later word, 50 inside a word, up to 40 when its letters are only in order.
 */
export function scoreWord(hay: string, needle: string): number {
  if (!needle) return 0
  let best = 0
  for (let at = hay.indexOf(needle); at >= 0 && best < 100; at = hay.indexOf(needle, at + 1)) {
    best = Math.max(best, at === 0 ? 100 : isWordStart(hay, at) ? 80 : 50)
  }
  if (best > 0) return best
  // Skipping ahead to a word start can leave too few letters behind; plain order then decides.
  return inOrder(hay, needle, true) || inOrder(hay, needle, false)
}

/** How well `query` finds `command` (case and accents aside); 0 when it does not. */
export function scoreCommand(command: Matchable, query: string): number {
  const words = foldQuery(query).split(' ').filter(Boolean)
  if (words.length === 0) return 0
  const title = fold(command.title).text
  const keywords = (command.keywords ?? []).map((keyword) => fold(keyword).text)
  let total = 0
  for (const word of words) {
    let score = scoreWord(title, word)
    for (const keyword of keywords) {
      const found = scoreWord(keyword, word)
      // Keywords count a little less than the title, and only as written: letters in order would find too much.
      if (found > FUZZY_MAX) score = Math.max(score, Math.round(found * 0.8))
    }
    if (score === 0) return 0
    total += score
  }
  const phrase = words.join(' ')
  if (title === phrase) total += 20
  else if (words.length > 1 && title.includes(phrase)) total += 50
  return total
}

/** The commands `query` finds, best first; with an empty query, all of them, recently used first. */
export function rankCommands<T extends Matchable>(commands: readonly T[], query: string, recent: readonly string[]): Ranked<T>[] {
  const recentAt = new Map<string, number>()
  recent.slice(0, RECENT_LIMIT).forEach((id, index) => {
    if (!recentAt.has(id)) recentAt.set(id, index)
  })
  const needle = foldQuery(query).trim()

  if (!needle) {
    const used = commands.filter((command) => recentAt.has(command.id))
    used.sort((a, b) => (recentAt.get(a.id) ?? 0) - (recentAt.get(b.id) ?? 0))
    const rest = commands.filter((command) => !recentAt.has(command.id))
    return [...used.map((command) => ({ command, recent: true })), ...rest.map((command) => ({ command, recent: false }))]
  }

  const scored: { command: T; recent: boolean; score: number; index: number }[] = []
  commands.forEach((command, index) => {
    const score = scoreCommand(command, needle)
    if (score === 0) return
    const at = recentAt.get(command.id)
    const boost = at === undefined ? 0 : RECENT_BOOST - (at * RECENT_BOOST) / RECENT_LIMIT
    scored.push({ command, recent: at !== undefined, score: score + boost, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.map(({ command, recent: isRecent }) => ({ command, recent: isRecent }))
}

/** `recent` after running `id`: it moves to the front, the oldest falls off the end. */
export function noteRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((other) => other !== id)].slice(0, RECENT_LIMIT)
}

/** A stored list of recent command ids, cleaned: strings only, no repeats, at most RECENT_LIMIT. */
export function readRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const id of value) {
    if (typeof id === 'string' && id.length > 0 && id.length <= 100 && !out.includes(id)) out.push(id)
    if (out.length === RECENT_LIMIT) break
  }
  return out
}
