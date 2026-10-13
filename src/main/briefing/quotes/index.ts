import type { Tradition } from '../../../shared/briefing'
import eastern from './eastern.json'
import stoic from './stoic.json'
import western from './western.json'

/**
 * The bundled phrases: passages of public-domain texts in public-domain translations, each
 * copied from the source named in `sourceUrl`. See SOURCES.md for the editions, the basis on
 * which each is in the public domain, and what is deliberately left out.
 */
export interface Quote {
  /** Stable: a tradition prefix and a hash of the text. */
  id: string
  text: string
  author: string
  work: string
  /** Book, chapter, verse or letter. */
  locator: string
  /** Null for a work written in English. */
  translator: string | null
  /** When this text or translation was first published. */
  year: number
  sourceUrl: string
  tradition: Tradition
}

export const QUOTES: readonly Quote[] = [...(stoic as Quote[]), ...(eastern as Quote[]), ...(western as Quote[])]

const byId = new Map(QUOTES.map((quote) => [quote.id, quote]))

export function quoteById(id: string): Quote | undefined {
  return byId.get(id)
}
