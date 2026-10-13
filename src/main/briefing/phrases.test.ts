import { describe, expect, it } from 'vitest'
import { TRADITIONS, type Tradition } from '../../shared/briefing'
import type { Block, BlockProps } from '../../shared/types'
import { fromQuote, ownPhrases, ownShare, PHRASE_RULES, phraseColumns, pickPhrase, readHistory, recentIds, recordPhrase, seeded, seedOf, type PhraseCandidate, type PhraseHistoryEntry } from './phrases'
import { QUOTES, quoteById, type Quote } from './quotes'

function bundled(count: number, tradition: Tradition = 'stoic'): PhraseCandidate[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${tradition}-${index}`, text: `Bundled ${tradition} ${index}`, author: 'Someone', tradition, own: false }))
}
function mine(count: number, favourites: number[] = []): PhraseCandidate[] {
  return Array.from({ length: count }, (_, index) => ({ id: `own:${index}`, text: `Mine ${index}`, author: 'Me', own: true, rowId: String(index), ...(favourites.includes(index) ? { favourite: true } : {}) }))
}
function day(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10)
}

describe('the seeded generator', () => {
  it('gives the same numbers for the same seed and different ones for another', () => {
    const a = seeded(seedOf('2026-10-13#0'))
    const b = seeded(seedOf('2026-10-13#0'))
    const c = seeded(seedOf('2026-10-14#0'))
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    expect([c(), c(), c()]).not.toEqual(first)
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true)
    expect(seedOf('2026-10-13#0')).toBe(seedOf('2026-10-13#0'))
    expect(seedOf('2026-10-13#0')).not.toBe(seedOf('2026-10-13#1'))
  })

  it('is spread evenly enough to draw from', () => {
    const random = seeded(12345)
    const buckets = new Array<number>(10).fill(0)
    for (let i = 0; i < 20_000; i++) buckets[Math.floor(random() * 10)]++
    for (const count of buckets) expect(Math.abs(count - 2000)).toBeLessThan(200)
  })
})

describe('the phrase of a day', () => {
  it('is the same every time it is asked for the same day', () => {
    const input = { date: '2026-10-13', bundled: bundled(200), own: mine(20), history: [] }
    const first = pickPhrase(input)
    for (let i = 0; i < 5; i++) expect(pickPhrase({ ...input, bundled: [...input.bundled], own: [...input.own] })).toEqual(first)
    expect(first).not.toBeNull()
  })

  it('differs from day to day, and when another one is asked for', () => {
    const pool = bundled(200)
    const ids = new Set(Array.from({ length: 30 }, (_, index) => pickPhrase({ date: day(index), bundled: pool, own: [], history: [] })!.id))
    expect(ids.size).toBeGreaterThan(20)
    const skips = new Set(Array.from({ length: 30 }, (_, skip) => pickPhrase({ date: '2026-10-13', bundled: pool, own: [], history: [], skip })!.id))
    expect(skips.size).toBeGreaterThan(20)
  })

  it('never repeats a phrase within 60 days while there are others', () => {
    const pool = bundled(90)
    let history: PhraseHistoryEntry[] = []
    const shown: string[] = []
    for (let index = 0; index < 400; index++) {
      const date = day(index)
      const picked = pickPhrase({ date, bundled: pool, own: [], history })!
      const lastSeen = shown.lastIndexOf(picked.id)
      if (lastSeen >= 0) expect(index - lastSeen, `${picked.id} on ${date}`).toBeGreaterThanOrEqual(PHRASE_RULES.noRepeatDays)
      shown.push(picked.id)
      history = recordPhrase(history, date, picked.id)
      expect(history.length).toBeLessThanOrEqual(PHRASE_RULES.noRepeatDays)
    }
    // Every phrase gets its turn.
    expect(new Set(shown).size).toBe(90)
  })

  it('with fewer phrases than days, brings back the one shown longest ago', () => {
    const pool = bundled(5)
    let history: PhraseHistoryEntry[] = []
    const shown: string[] = []
    for (let index = 0; index < 40; index++) {
      const picked = pickPhrase({ date: day(index), bundled: pool, own: [], history })!
      shown.push(picked.id)
      history = recordPhrase(history, day(index), picked.id)
    }
    // Once all five were shown they come round in turn: no phrase twice within five days.
    for (let index = 5; index < shown.length; index++) expect(shown.slice(index - 4, index)).not.toContain(shown[index])
  })

  it('"another" never answers with the phrase on screen', () => {
    const pool = bundled(3)
    for (let skip = 1; skip < 50; skip++) {
      const current = pool[skip % 3].id
      expect(pickPhrase({ date: '2026-10-13', bundled: pool, own: [], history: [], skip, avoid: [current] })!.id).not.toBe(current)
    }
    // With a single phrase there is nothing else to give.
    expect(pickPhrase({ date: '2026-10-13', bundled: bundled(1), own: [], history: [], skip: 1, avoid: ['stoic-0'] })!.id).toBe('stoic-0')
  })

  it('answers null with nothing to choose from', () => {
    expect(pickPhrase({ date: '2026-10-13', bundled: [], own: [], history: [] })).toBeNull()
  })
})

describe('weighting', () => {
  const share = (own: PhraseCandidate[], mode?: 'balanced' | 'mostly' | 'never', pool = bundled(300)): number => {
    let count = 0
    for (let index = 0; index < 1000; index++) if (pickPhrase({ date: day(index), bundled: pool, own, history: [], settings: { own: mode } })!.own) count++
    return count / 1000
  }

  it('uses the own phrases half of the time once there are ten of them', () => {
    expect(ownShare('balanced', 9)).toBe(0)
    expect(ownShare('balanced', 10)).toBe(0.5)
    expect(ownShare(undefined, 25)).toBe(0.5)
    expect(share(mine(9))).toBe(0)
    expect(share(mine(40))).toBeGreaterThan(0.44)
    expect(share(mine(40))).toBeLessThan(0.56)
  })

  it('follows "mostly" and "never"', () => {
    expect(share(mine(3), 'mostly')).toBeGreaterThan(0.74)
    expect(share(mine(3), 'mostly')).toBeLessThan(0.86)
    expect(share(mine(40), 'never')).toBe(0)
    expect(ownShare('mostly', 0)).toBe(0)
  })

  it('falls back to the own phrases when no bundled one is left, but not when they are turned off', () => {
    expect(pickPhrase({ date: '2026-10-13', bundled: [], own: mine(2), history: [] })!.own).toBe(true)
    expect(pickPhrase({ date: '2026-10-13', bundled: [], own: mine(2), history: [], settings: { own: 'never' } })!.own).toBe(true)
    const history = bundled(2).map((item) => ({ date: '2026-10-12', id: item.id }))
    expect(pickPhrase({ date: '2026-10-13', bundled: bundled(2), own: mine(12), history })!.own).toBe(true)
    expect(pickPhrase({ date: '2026-10-13', bundled: bundled(2), own: mine(12), history, settings: { own: 'never' } })!.own).toBe(false)
  })

  it('brings favourites up about three times as often', () => {
    const own = mine(20, [0, 1, 2, 3, 4])
    let favourites = 0
    let total = 0
    for (let index = 0; index < 4000; index++) {
      const picked = pickPhrase({ date: day(index), bundled: [], own, history: [] })!
      total++
      if (picked.favourite) favourites++
    }
    // 5 favourites at weight 3 against 15 others at weight 1: half of the draws.
    expect(favourites / total).toBeGreaterThan(0.45)
    expect(favourites / total).toBeLessThan(0.55)
  })

  it('draws only from the traditions that are on; none chosen means all', () => {
    const pool = [...bundled(50, 'stoic'), ...bundled(50, 'buddhist'), ...bundled(50, 'poetry')]
    const seen = (traditions: Tradition[] | null): Set<string | undefined> => new Set(Array.from({ length: 200 }, (_, index) => pickPhrase({ date: day(index), bundled: pool, own: [], history: [], settings: { traditions } })!.tradition))
    expect(seen(['buddhist'])).toEqual(new Set(['buddhist']))
    expect(seen(['stoic', 'poetry'])).toEqual(new Set(['stoic', 'poetry']))
    expect(seen([])).toEqual(new Set(['stoic', 'buddhist', 'poetry']))
    expect(seen(null)).toEqual(new Set(['stoic', 'buddhist', 'poetry']))
    expect(seen(['nonsense' as Tradition])).toEqual(new Set(['stoic', 'buddhist', 'poetry']))
    // A tradition with nothing in it leaves nothing to show rather than something unwanted.
    expect(pickPhrase({ date: '2026-10-13', bundled: pool, own: [], history: [], settings: { traditions: ['mystic'] } })).toBeNull()
  })
})

describe('history', () => {
  it('keeps what the no-repeat rule can still need', () => {
    let history: PhraseHistoryEntry[] = []
    for (let index = 0; index < 100; index++) history = recordPhrase(history, day(index), `q${index}`)
    expect(history).toHaveLength(60)
    expect(history[0]).toEqual({ date: day(40), id: 'q40' })
    expect(recentIds(history, day(99)).has('q40')).toBe(true)
    expect(recentIds(history, day(100)).has('q40')).toBe(false)
    // The same phrase on the same day is recorded once; "another" adds a second entry for the day.
    history = recordPhrase(recordPhrase(history, day(99), 'q99'), day(99), 'extra')
    expect(history.filter((entry) => entry.date === day(99)).map((entry) => entry.id)).toEqual(['q99', 'extra'])
    // A clock set back does not keep entries from the future.
    expect(recordPhrase([{ date: '2030-01-01', id: 'future' }], '2026-10-13', 'now')).toEqual([{ date: '2026-10-13', id: 'now' }])
  })

  it('reads a stored history as untrusted data', () => {
    expect(readHistory(null)).toEqual([])
    expect(readHistory('nope')).toEqual([])
    expect(readHistory([null, 5, {}, { date: '2026-10-13' }, { date: 'yesterday', id: 'a' }, { date: '2026-10-13', id: 7 }, { date: '2026-10-13', id: 'x'.repeat(100) }, { date: '2026-10-13', id: 'ok', extra: true }])).toEqual([{ date: '2026-10-13', id: 'ok' }])
    expect(readHistory(Array.from({ length: 5000 }, () => ({ date: '2026-10-13', id: 'a' })))).toHaveLength(PHRASE_RULES.historyEntries)
  })
})

describe('the own phrases of a database', () => {
  const schema: BlockProps['schema'] = {
    title: { id: 'title', name: 'Phrase', type: 'title' },
    a: { id: 'a', name: 'Autor', type: 'text' },
    s: { id: 's', name: 'Source', type: 'text' },
    t: { id: 't', name: 'Tradition', type: 'select', options: [{ id: 'o1', name: 'Stoicism', color: 'blue' }, { id: 'buddhist', name: 'Zen', color: 'green' }, { id: 'o3', name: 'Novels', color: 'gray' }] },
    f: { id: 'f', name: 'Favorito', type: 'checkbox' }
  }
  const row = (id: string, title: unknown, values: unknown = {}, extra: Partial<Block> = {}): Block => ({ id, type: 'page', parentId: 'db', content: [], props: { title, values } as BlockProps, createdAt: 0, updatedAt: 0, trashedAt: null, ...extra })

  it('finds the columns by name, in English or Portuguese', () => {
    const columns = phraseColumns({ schema })
    expect(columns).toMatchObject({ author: 'a', source: 's', tradition: 't', favourite: 'f' })
    expect([...columns.traditions]).toEqual([['stoic', 'o1'], ['buddhist', 'buddhist']])
    expect(phraseColumns(null)).toEqual({ traditions: new Map() })
  })

  it('reads one phrase per titled row', () => {
    const phrases = ownPhrases({ props: { schema } }, [
      row('r1', [['Within you there is a stillness and a sanctuary.']], { a: '  Hermann   Hesse ', s: 'Siddhartha', t: 'buddhist', f: true }),
      row('r2', [['Line one\nline two']], { t: 'o3' }),
      row('r3', [['   ']]),
      row('r4', 'not rich text'),
      row('r5', [['In the trash']], {}, { trashedAt: 5 }),
      { ...row('r6', [['Not a row']]), type: 'text' },
      row('r7', [['Odd values']], 'nope')
    ])
    expect(phrases).toEqual([
      { id: 'own:r1', text: 'Within you there is a stillness and a sanctuary.', author: 'Hermann Hesse', work: 'Siddhartha', tradition: 'buddhist', favourite: true, own: true, rowId: 'r1' },
      { id: 'own:r2', text: 'Line one\nline two', author: '', own: true, rowId: 'r2' },
      { id: 'own:r7', text: 'Odd values', author: '', own: true, rowId: 'r7' }
    ])
  })

  it('works on a database with none of the columns, or a broken schema', () => {
    for (const props of [{}, { schema: null }, { schema: 'x' }, { schema: { a: null, b: 5, c: { type: 7 } } }] as unknown as BlockProps[]) {
      expect(ownPhrases({ props }, [row('r', [['Just a line']], { a: 'ignored' })])).toEqual([{ id: 'own:r', text: 'Just a line', author: '', own: true, rowId: 'r' }])
    }
    expect(ownPhrases(null, [])).toEqual([])
  })
})

describe('the bundled collection', () => {
  /** Authors whose work is still in copyright somewhere it matters, and so is never bundled. */
  const DENY = [
    'hesse', 'camus', 'jung', 'sartre', 'beauvoir', 'krishnamurti', 'suzuki', 'nhat hanh', 'thich', 'watts', 'dalai', 'tolle', 'chödrön', 'chodron', 'osho', 'merton', 'frankl',
    'wittgenstein', 'heidegger', 'russell', 'einstein', 'gandhi', 'hemingway', 'borges', 'neruda', 'pessoa', 'saint-exupéry', 'exupery', 'rilke', 'kafka', 'kierkegaard', 'lewis',
    'tolkien', 'orwell', 'huxley', 'steinbeck', 'eliot', 'frost', 'auden', 'campbell', 'fromm', 'arendt', 'weil', 'cioran', 'coelho', 'gummere', 'hays', 'mitchell', 'easwaran', 'barks'
  ]
  const fields: (keyof Quote)[] = ['id', 'text', 'author', 'work', 'locator', 'translator', 'year', 'sourceUrl', 'tradition']

  it('has between 150 and 250 entries, with a good share of each tradition', () => {
    expect(QUOTES.length).toBeGreaterThanOrEqual(150)
    expect(QUOTES.length).toBeLessThanOrEqual(250)
    const counts = Object.fromEntries(TRADITIONS.map((name) => [name, QUOTES.filter((quote) => quote.tradition === name).length]))
    for (const name of TRADITIONS) expect(counts[name], name).toBeGreaterThanOrEqual(10)
    expect(counts['stoic']).toBeGreaterThanOrEqual(40)
    expect(counts['buddhist'] + counts['taoist']).toBeGreaterThanOrEqual(40)
  })

  it('gives every entry every field', () => {
    for (const quote of QUOTES) {
      expect(Object.keys(quote).sort(), quote.id).toEqual([...fields].sort())
      for (const field of ['id', 'text', 'author', 'work', 'locator', 'sourceUrl'] as const) {
        expect(typeof quote[field], `${quote.id}.${field}`).toBe('string')
        expect(quote[field].trim(), `${quote.id}.${field}`).toBe(quote[field])
        expect(quote[field].length, `${quote.id}.${field}`).toBeGreaterThan(0)
      }
      // A translator, or null for a work written in English.
      expect(quote.translator === null || (typeof quote.translator === 'string' && quote.translator.length > 2), quote.id).toBe(true)
      expect(TRADITIONS, quote.id).toContain(quote.tradition)
      expect(Number.isInteger(quote.year) && quote.year >= 1600 && quote.year < 1930, `${quote.id}: ${quote.year}`).toBe(true)
      expect(quote.id, quote.id).toMatch(/^(st|bu|ta|hi|we|po|my)-[0-9a-f]{8}$/)
    }
  })

  it('names a source on Project Gutenberg or Wikisource for every entry', () => {
    for (const quote of QUOTES) {
      expect(quote.sourceUrl, quote.id).toMatch(/^https:\/\/(www\.gutenberg\.org\/ebooks\/\d+|[a-z]{2,3}\.wikisource\.org\/wiki\/\S+)$/)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(QUOTES.map((quote) => quote.id)).size).toBe(QUOTES.length)
    const texts = QUOTES.map((quote) => quote.text.toLowerCase().replace(/[^a-z]+/g, ' ').trim())
    expect(new Set(texts).size).toBe(QUOTES.length)
    // Nor one passage that is the beginning of another.
    const sorted = [...texts].sort()
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].startsWith(sorted[i - 1]), sorted[i - 1]).toBe(false)
  })

  it('keeps every passage short, whole and clean', () => {
    for (const quote of QUOTES) {
      expect(quote.text.length, quote.id).toBeGreaterThanOrEqual(40)
      expect(quote.text.length, quote.id).toBeLessThanOrEqual(420)
      expect(quote.text.split('\n').length, quote.id).toBeLessThanOrEqual(8)
      // Starts where a sentence starts and ends where one ends.
      expect(quote.text, quote.id).toMatch(/^["'“‘(]?[A-Z0-9]/)
      expect(quote.text, quote.id).toMatch(/[.!?]["'”’)]*$/)
      // No editorial leftovers: footnote marks, markup, links, underscores for italics, stray whitespace.
      expect(quote.text, quote.id).not.toMatch(/\[\d+\]|\[Footnote|\{\d+\}|<[a-z/]|https?:|_|\t| {2}|\r/i)
      expect(quote.text.split('\n').every((line) => line === line.trim() && line.length > 0), quote.id).toBe(true)
    }
  })

  it('bundles nothing by an author on the in-copyright list', () => {
    for (const quote of QUOTES) {
      const who = `${quote.author} ${quote.translator ?? ''}`.toLowerCase()
      for (const name of DENY) expect(who.includes(name), `${quote.id}: ${quote.author} / ${quote.translator}`).toBe(false)
    }
    // Hesse in particular: not as an author, not in a title, not in a passage.
    expect(QUOTES.some((quote) => /hesse|siddhartha|steppenwolf|demian/i.test(`${quote.author} ${quote.work} ${quote.text} ${quote.translator}`))).toBe(false)
  })

  it('takes Buddhist entries from the Dhammapada in Max Müller’s translation only', () => {
    for (const quote of QUOTES.filter((entry) => entry.tradition === 'buddhist')) {
      expect(quote.work, quote.id).toBe('The Dhammapada')
      expect(quote.translator, quote.id).toBe('F. Max Müller')
      expect(quote.locator, quote.id).toMatch(/^Chapter [IVXL]+, verse \d+$/)
    }
  })

  it('can be looked up by id and turned into a phrase', () => {
    const quote = QUOTES[0]
    expect(quoteById(quote.id)).toBe(quote)
    expect(quoteById('nope')).toBeUndefined()
    expect(fromQuote(quote)).toEqual({ id: quote.id, text: quote.text, author: quote.author, work: quote.work, locator: quote.locator, translator: quote.translator, year: quote.year, tradition: quote.tradition, own: false })
    expect(JSON.stringify(fromQuote(quote))).not.toContain('gutenberg')
  })
})
