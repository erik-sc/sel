import type { Block, BlockProps, SearchResult } from '../../shared/types'
import { isPageLike, parseProps } from './blocks'
import { ftsQuery, likePattern, makeSnippet, safePlain, searchText } from './text'
import { archivedFilter, liveFilter, pagesAbove, type Link } from './tree'

const MAX_QUERY_CHARS = 200

/** What search needs from the repository. */
export interface SearchSource {
  /** Runs a (cached) statement and returns its rows. */
  all(sql: string, ...params: unknown[]): unknown[]
  lineage(ids: string[]): Map<string, Link>
  getMany(ids: string[]): Block[]
}

/**
 * Full-text search over block text: ranked prefix matches first, a substring
 * pass when those are too few. Hits inside the trash are dropped, page titles
 * come before block text, and each page is listed once.
 */
/** True for a database whose stored props carry a `sourceId` (the substring test skips the JSON parser for the rest). */
function isLinkedView(link: Link): boolean {
  if (link.type !== 'database' || !link.props || !link.props.includes('"sourceId":')) return false
  return typeof (parseProps(link.props) as { sourceId?: unknown }).sourceId === 'string'
}

export function searchBlocks(source: SearchSource, text: string, limit = 20): SearchResult[] {
  if (typeof text !== 'string') return []
  const query = text.trim().slice(0, MAX_QUERY_CHARS)
  if (!query) return []
  const n = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 20))
  const fetch = n * 5

  const ids: string[] = []
  const seen = new Set<string>()
  const push = (rows: unknown[]): void => {
    for (const r of rows as { id: string }[]) {
      if (!seen.has(r.id)) {
        seen.add(r.id)
        ids.push(r.id)
      }
    }
  }

  const match = ftsQuery(query)
  if (match) {
    try {
      push(source.all('SELECT id FROM blocks_fts WHERE blocks_fts MATCH ? ORDER BY bm25(blocks_fts) LIMIT ?', match, fetch))
    } catch {
      /* malformed for FTS: the LIKE pass below still answers */
    }
  }
  if (ids.length < n) {
    // Substring fallback: catches infix matches and punctuation the tokenizer drops. It has to
    // look at every indexed text, so it reads FTS5's content table (c0 = id, c1 = text) directly:
    // the same rows in the same order as `blocks_fts`, at half the cost of going through the
    // virtual table.
    push(source.all(`SELECT c0 AS id FROM blocks_fts_content WHERE c1 LIKE ? ESCAPE '\\' LIMIT ?`, likePattern(query), fetch))
  }
  if (!ids.length) return []

  // One statement resolves, for every hit, whether it is in the trash and which pages contain it.
  const links = source.lineage(ids)
  const live = liveFilter(links)
  interface Hit {
    id: string
    page: Link
    chain: Link[]
  }
  const pageHits: Hit[] = []
  const blockHits: Hit[] = []
  for (const id of ids) {
    const self = links.get(id)
    if (!self || !live(id)) continue
    const chain = pagesAbove(id, links)
    // A linked view is another place its source appears, not a database of its own: the source is the hit.
    if (isLinkedView(self)) continue
    if (isPageLike(self.type)) pageHits.push({ id, page: self, chain })
    else if (chain.length) blockHits.push({ id, page: chain[chain.length - 1], chain: chain.slice(0, -1) })
  }

  // One result per page: opening a hit opens its page, so a page that mentions the words many
  // times would otherwise fill the list. Its title hit, or else its best block, stands for it.
  const byPage = new Map<string, Hit>()
  for (const hit of [...pageHits, ...blockHits]) {
    if (!byPage.has(hit.page.id)) byPage.set(hit.page.id, hit)
  }

  // Only the hits that are returned are read in full and turned into results.
  const hits = [...byPage.values()].slice(0, n)
  const props = new Map<string, BlockProps>()
  const propsOf = (link: Link): BlockProps => {
    let p = props.get(link.id)
    if (!p) props.set(link.id, (p = parseProps(link.props ?? '{}')))
    return p
  }
  const blocks = new Map(source.getMany(hits.filter((h) => h.id !== h.page.id).map((h) => h.id)).map((b) => [b.id, b]))
  // Archived pages are found like any other; the result says so.
  const archived = archivedFilter(links)
  return hits.map((hit) => {
    const page = propsOf(hit.page)
    const result: SearchResult = {
      id: hit.id,
      pageId: hit.page.id,
      title: safePlain(page.title),
      path: hit.chain.map((a) => safePlain(propsOf(a).title))
    }
    if (typeof page.icon === 'string') result.icon = page.icon
    const block = blocks.get(hit.id)
    if (block) result.snippet = makeSnippet(searchText(block.props), query)
    if (archived(hit.page.id)) result.archived = true
    return result
  })
}
