import { isTradition, TRADITIONS, type BriefingPhrase, type OwnPhrases, type Tradition } from '../../shared/briefing'
import { plainText } from '../../shared/richtext'
import type { Block, BlockProps, PropertySchema } from '../../shared/types'
import type { Quote } from './quotes'
import { fold } from './tasks'

/**
 * Choosing the day's phrase. Pure: the collection, the user's own phrases, the history and
 * the date go in; a phrase comes out, the same one for the same inputs.
 */

export const PHRASE_RULES = {
  /** A phrase is not shown again within this many days. */
  noRepeatDays: 60,
  /** With at least this many own phrases, "balanced" uses one of them half of the time. */
  ownThreshold: 10,
  /** How much more often a favourite comes up. */
  favouriteWeight: 3,
  historyEntries: 400
} as const

export interface PhraseCandidate extends BriefingPhrase {
  favourite?: boolean
}

export interface PhraseHistoryEntry {
  /** `YYYY-MM-DD`. */
  date: string
  id: string
}

export interface PhraseSettings {
  /** Traditions the bundled phrases are drawn from; empty or missing = all. */
  traditions?: readonly Tradition[] | null
  own?: OwnPhrases
}

export function fromQuote(quote: Quote): PhraseCandidate {
  return {
    id: quote.id,
    text: quote.text,
    author: quote.author,
    work: quote.work,
    locator: quote.locator,
    translator: quote.translator,
    year: quote.year,
    tradition: quote.tradition,
    own: false
  }
}

// ---- the user's own phrases ------------------------------------------------------

const AUTHOR_NAMES = new Set(['author', 'autor', 'autora', 'by', 'who', 'quem'])
const SOURCE_NAMES = new Set(['source', 'fonte', 'work', 'obra', 'book', 'livro', 'from', 'origem'])
const TRADITION_NAMES = new Set(['tradition', 'tradicao', 'school', 'escola', 'category', 'categoria'])
const FAVOURITE_NAMES = new Set(['favourite', 'favorite', 'favorito', 'favorita', 'star', 'starred', 'loved'])

function schemaOf(props: BlockProps | undefined | null): PropertySchema[] {
  const schema: unknown = props?.schema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const out: PropertySchema[] = []
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const property = value as Partial<PropertySchema>
    if (typeof property.type !== 'string') continue
    out.push({
      ...(property as PropertySchema),
      id: typeof property.id === 'string' && property.id ? property.id : key,
      name: typeof property.name === 'string' ? property.name : ''
    })
  }
  return out
}

function textOf(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export interface PhraseColumns {
  author?: string
  source?: string
  tradition?: string
  favourite?: string
  /** The option of the tradition column that stands for each tradition. */
  traditions: Map<Tradition, string>
}

/**
 * The columns of a phrases database, found by name (Author, Source, Tradition, Favourite, in
 * English or Portuguese), so that any database the user points at works.
 */
export function phraseColumns(props: BlockProps | undefined | null): PhraseColumns {
  const schema = schemaOf(props)
  const find = (type: string, names: ReadonlySet<string>): PropertySchema | undefined =>
    schema.find((property) => property.type === type && names.has(fold(property.name)))
  const tradition = find('select', TRADITION_NAMES)
  const columns: PhraseColumns = { traditions: new Map() }
  const author = find('text', AUTHOR_NAMES)
  const source = find('text', SOURCE_NAMES)
  const favourite = find('checkbox', FAVOURITE_NAMES)
  if (author) columns.author = author.id
  if (source) columns.source = source.id
  if (favourite) columns.favourite = favourite.id
  if (tradition) {
    columns.tradition = tradition.id
    for (const option of Array.isArray(tradition.options) ? tradition.options : []) {
      if (!option || typeof option.id !== 'string' || typeof option.name !== 'string') continue
      const name = fold(option.name)
      const match = TRADITIONS.find((entry) => option.id === entry || name === entry || name.startsWith(entry.slice(0, 4)))
      if (match && !columns.traditions.has(match)) columns.traditions.set(match, option.id)
    }
  }
  return columns
}

/**
 * The phrases in a database of the user's: one per row with a title. A database without the
 * usual columns still gives phrases, just without an author.
 */
export function ownPhrases(
  database: Pick<Block, 'props'> | null | undefined,
  rows: readonly Pick<Block, 'id' | 'type' | 'props' | 'trashedAt'>[]
): PhraseCandidate[] {
  const columns = phraseColumns(database?.props)
  const traditions = new Map<string, Tradition>()
  for (const [name, option] of columns.traditions) traditions.set(option, name)
  const out: PhraseCandidate[] = []
  for (const row of rows) {
    if (out.length >= 5000) break
    if (!row || row.type !== 'page' || row.trashedAt != null) continue
    const props: BlockProps = row.props && typeof row.props === 'object' ? row.props : {}
    let text = ''
    try {
      text = Array.isArray(props.title) ? plainText(props.title).trim().slice(0, 1200) : ''
    } catch {
      text = ''
    }
    if (!text) continue
    const values =
      props.values && typeof props.values === 'object' && !Array.isArray(props.values) ? (props.values as Record<string, unknown>) : {}
    const get = (property: string | undefined): unknown =>
      property && Object.prototype.hasOwnProperty.call(values, property) ? values[property] : undefined
    const phrase: PhraseCandidate = { id: `own:${row.id}`, text, author: textOf(get(columns.author), 120), own: true, rowId: row.id }
    const work = textOf(get(columns.source), 200)
    if (work) phrase.work = work
    const picked = get(columns.tradition)
    const school = typeof picked === 'string' ? traditions.get(picked) : undefined
    if (school) phrase.tradition = school
    if (get(columns.favourite) === true) phrase.favourite = true
    out.push(phrase)
  }
  return out
}

// ---- choosing --------------------------------------------------------------------

/** A 32-bit hash of a string (FNV-1a): the seed of a day. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A small seeded generator (mulberry32): the same numbers for the same seed, on every machine. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function dayNumber(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return NaN
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000)
}

/** Ids shown within the no-repeat window before `date` (the day itself included). */
export function recentIds(history: readonly PhraseHistoryEntry[], date: string): Set<string> {
  const today = dayNumber(date)
  const out = new Set<string>()
  for (const entry of history) {
    const age = today - dayNumber(entry.date)
    if (age >= 0 && age < PHRASE_RULES.noRepeatDays) out.add(entry.id)
  }
  return out
}

/** The share of days on which the phrase is one of the user's own. */
export function ownShare(mode: OwnPhrases | undefined, count: number): number {
  if (count === 0 || mode === 'never') return 0
  if (mode === 'mostly') return 0.8
  return count >= PHRASE_RULES.ownThreshold ? 0.5 : 0
}

function weightedPick(pool: readonly PhraseCandidate[], random: () => number): PhraseCandidate {
  let total = 0
  for (const item of pool) total += item.favourite ? PHRASE_RULES.favouriteWeight : 1
  let at = random() * total
  for (const item of pool) {
    at -= item.favourite ? PHRASE_RULES.favouriteWeight : 1
    if (at < 0) return item
  }
  return pool[pool.length - 1]
}

export interface PickInput {
  /** `YYYY-MM-DD`. */
  date: string
  bundled: readonly PhraseCandidate[]
  own: readonly PhraseCandidate[]
  history: readonly PhraseHistoryEntry[]
  settings?: PhraseSettings
  /** How many times the user asked for another phrase today: each gives a different draw. */
  skip?: number
  /** Ids never to answer with (the phrase on screen, when the user asks for another). */
  avoid?: readonly string[]
}

/**
 * The phrase of a day. Determined by the date (and `skip`): asked twice, it answers the same.
 * A phrase shown in the last 60 days is not shown again while there is another to show; when
 * every phrase has been, the one shown longest ago comes back first.
 */
export function pickPhrase(input: PickInput): PhraseCandidate | null {
  const settings = input.settings ?? {}
  const enabled = (settings.traditions ?? []).filter(isTradition)
  const bundled = enabled.length ? input.bundled.filter((item) => !item.tradition || enabled.includes(item.tradition)) : input.bundled
  const own = input.own
  if (!bundled.length && !own.length) return null
  const random = seeded(seedOf(`${input.date}#${input.skip ?? 0}`))
  const share = ownShare(settings.own, own.length)
  // Drawn before anything else, so that the choice of pool does not depend on the pools' sizes.
  const wantsOwn = random() < share
  const recent = recentIds(input.history, input.date)
  const avoid = new Set(input.avoid ?? [])
  const fresh = (pool: readonly PhraseCandidate[]): PhraseCandidate[] => pool.filter((item) => !recent.has(item.id) && !avoid.has(item.id))

  const order = wantsOwn ? [own, bundled] : share > 0 || !bundled.length ? [bundled, own] : [bundled]
  for (const pool of order) {
    const candidates = fresh(pool)
    if (candidates.length) return weightedPick(candidates, random)
  }
  // Everything was shown recently: the one shown longest ago, among those not to be avoided.
  const everything = order.flat()
  const all = everything.filter((item) => !avoid.has(item.id))
  if (!all.length) return everything[0] ?? null
  const last = new Map<string, number>()
  for (const entry of input.history) {
    const day = dayNumber(entry.date)
    if (Number.isFinite(day) && day > (last.get(entry.id) ?? -Infinity)) last.set(entry.id, day)
  }
  let best = all[0]
  let bestDay = last.get(best.id) ?? -Infinity
  for (const item of all) {
    const day = last.get(item.id) ?? -Infinity
    if (day < bestDay) {
      best = item
      bestDay = day
    }
  }
  return best
}

/** The history with `id` shown on `date`, pruned to what the no-repeat rule can still need. */
export function recordPhrase(history: readonly PhraseHistoryEntry[], date: string, id: string): PhraseHistoryEntry[] {
  const today = dayNumber(date)
  const kept = history.filter((entry) => {
    const age = today - dayNumber(entry.date)
    return Number.isFinite(age) && age >= 0 && age < PHRASE_RULES.noRepeatDays && !(entry.date === date && entry.id === id)
  })
  kept.push({ date, id })
  return kept.slice(-PHRASE_RULES.historyEntries)
}

/** A stored history, read back as untrusted data. */
export function readHistory(value: unknown): PhraseHistoryEntry[] {
  if (!Array.isArray(value)) return []
  const out: PhraseHistoryEntry[] = []
  for (const entry of value.slice(-PHRASE_RULES.historyEntries) as unknown[]) {
    if (!entry || typeof entry !== 'object') continue
    const { date, id } = entry as { date?: unknown; id?: unknown }
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof id === 'string' && id.length <= 80) out.push({ date, id })
  }
  return out
}
