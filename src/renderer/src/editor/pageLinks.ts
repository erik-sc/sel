// Which pages the link field offers while something is typed into it. Pure.
import type { SearchResult } from '@shared/types'

/** At most this many pages are offered. */
export const PAGE_SUGGESTIONS = 6

/**
 * How the link field reads what is typed:
 * - `url`: it starts with a scheme (`https://`, `sel://`, `mailto:`): only a url, no pages offered;
 * - `address`: it could be a domain or an email: pages are offered, Enter still takes the address;
 * - `words`: pages are offered and Enter picks the first one;
 * - `empty`: nothing typed.
 */
export type LinkInput = 'url' | 'address' | 'words' | 'empty'

export function readLinkInput(text: string): LinkInput {
  const t = text.trim()
  if (!t) return 'empty'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^mailto:/i.test(t)) return 'url'
  if (/^[^\s@]+@[^\s@]+$/.test(t) || /^[^\s.]+(\.[^\s.]+)+\/?$/.test(t)) return 'address'
  return 'words'
}

/** Search results as link targets: one per page, never the page being edited, the first few. */
export function pageSuggestions(results: readonly SearchResult[], currentPageId: string | null): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const result of results) {
    if (out.length >= PAGE_SUGGESTIONS) break
    if (result.pageId === currentPageId || seen.has(result.pageId)) continue
    seen.add(result.pageId)
    out.push(result)
  }
  return out
}
