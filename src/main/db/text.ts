import type { BlockProps, RichText } from '../../shared/types'
import { plainText } from '../../shared/richtext'

/** Search text: what gets indexed, how a query is turned into SQL, and result snippets. */

export function safePlain(rt: unknown): string {
  return Array.isArray(rt) ? plainText(rt as RichText) : ''
}

/** Plain text indexed for search. */
export function searchText(props: BlockProps): string {
  const title = Array.isArray(props.title) ? safePlain(props.title) : ''
  const caption = Array.isArray(props.caption) ? safePlain(props.caption) : ''
  return caption ? (title ? `${title}\n${caption}` : caption) : title
}

/**
 * Turns free text into an FTS5 MATCH expression: every run of letters/digits
 * becomes a quoted prefix term, implicitly ANDed. Quoting turns operators
 * (AND, OR, NOT, NEAR, column filters, `*`, `^`, parentheses) into plain text,
 * so user input can neither change the query's meaning nor make it a syntax
 * error. Returns null when there is nothing to search for.
 */
export function ftsQuery(text: string): string | null {
  const tokens = text.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)
  if (!tokens) return null
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

/** A substring pattern for `LIKE ? ESCAPE '\'` with the wildcards in `text` neutralized. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function makeSnippet(text: string, query: string, width = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= width) return flat
  const haystack = fold(flat)
  let at = -1
  for (const token of fold(query).split(/\s+/).filter(Boolean)) {
    at = haystack.indexOf(token)
    if (at >= 0) break
  }
  // Folding can change string length for a few scripts; clamp defensively.
  const start = Math.max(0, Math.min(flat.length - width, (at < 0 ? 0 : at) - Math.floor(width / 3)))
  const end = Math.min(flat.length, start + width)
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '')
}
