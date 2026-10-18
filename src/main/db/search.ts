import type { Block, BlockProps, SearchResult } from '../../shared/types'
import { pageLink, parsePageLink } from '../../shared/pageLink'
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

/** True when the rich text has a link to `pageId` (or to a block on it). */
function linksTo(rt: unknown, pageId: string): boolean {
  if (!Array.isArray(rt)) return false
  for (const span of rt as unknown[]) {
    const marks = Array.isArray(span) ? (span[1] as unknown) : null
    if (!Array.isArray(marks)) continue
    for (const m of marks as unknown[]) {
      if (Array.isArray(m) && m[0] === 'a' && parsePageLink(m[1])?.pageId === pageId) return true
    }
  }
  return false
}

/** The text of the first link to `pageId` in the rich text: what the snippet is centred on. */
function linkText(rt: unknown, pageId: string): string {
  for (const span of Array.isArray(rt) ? (rt as unknown[]) : []) {
    if (Array.isArray(span) && typeof span[0] === 'string' && linksTo([span], pageId)) return span[0]
  }
  return ''
}

/**
 * Pages whose text links to `pageId` (`sel://page/<id>`, see shared/pageLink), each once with
 * the text around its first link, the page itself left out, the trash too. Archived pages are
 * listed and say so, as in search.
 */
export function backlinksTo(source: SearchSource, pageId: string, limit = 50): SearchResult[] {
  if (typeof pageId !== 'string' || !parsePageLink(pageLink(pageId))) return []
  const n = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 50))
  // A substring narrows the rows down; the marks themselves decide (an id can begin another one).
  const rows = source.all(
    'SELECT id FROM blocks WHERE trashed_at IS NULL AND instr(props, ?) > 0 LIMIT ?',
    pageLink(pageId),
    n * 20
  ) as { id: string }[]
  if (!rows.length) return []
  const candidates = source.getMany(rows.map((r) => r.id))
  const linking = candidates.filter((b) => linksTo(b.props.title, pageId) || linksTo(b.props.caption, pageId))
  if (!linking.length) return []

  const links = source.lineage(linking.map((b) => b.id))
  const live = liveFilter(links)
  const archived = archivedFilter(links)
  const props = new Map<string, BlockProps>()
  const propsOf = (link: Link): BlockProps => {
    let p = props.get(link.id)
    if (!p) props.set(link.id, (p = parseProps(link.props ?? '{}')))
    return p
  }
  const byPage = new Map<string, SearchResult>()
  for (const block of linking) {
    const self = links.get(block.id)
    if (!self || !live(block.id)) continue
    const chain = pagesAbove(block.id, links)
    const page = isPageLike(self.type) ? self : chain[chain.length - 1]
    if (!page || page.id === pageId || byPage.has(page.id) || isLinkedView(page)) continue
    const path = (isPageLike(self.type) ? chain : chain.slice(0, -1)).map((a) => safePlain(propsOf(a).title))
    const pageProps = propsOf(page)
    const rt = linksTo(block.props.title, pageId) ? block.props.title : block.props.caption
    const result: SearchResult = { id: block.id, pageId: page.id, title: safePlain(pageProps.title), path }
    if (typeof pageProps.icon === 'string') result.icon = pageProps.icon
    if (page.id !== block.id) result.snippet = makeSnippet(searchText(block.props), linkText(rt, pageId))
    if (archived(page.id)) result.archived = true
    byPage.set(page.id, result)
    if (byPage.size >= n) break
  }
  return [...byPage.values()]
}
