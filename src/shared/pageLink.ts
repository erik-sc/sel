// Links from one page to another: `sel://page/<page id>`, optionally `#<block id>`. The same
// address the Markdown export writes for sub-pages. Never handed to the system: the app opens
// the page itself, so this is the only shape of `sel://` it accepts.

export const PAGE_LINK_PREFIX = 'sel://page/'

const ID = '[A-Za-z0-9_-]{1,64}'
const PAGE_LINK_RE = new RegExp(`^sel://page/(${ID})(?:#(${ID}))?$`)

export interface PageLinkTarget {
  pageId: string
  blockId?: string
}

/** The address of a page, or of one block on it. */
export function pageLink(pageId: string, blockId?: string): string {
  return `${PAGE_LINK_PREFIX}${pageId}${blockId ? `#${blockId}` : ''}`
}

/** What a page link points at, or null when `href` is not one. */
export function parsePageLink(href: unknown): PageLinkTarget | null {
  if (typeof href !== 'string') return null
  const m = PAGE_LINK_RE.exec(href)
  if (!m || m[1] === '__proto__') return null
  return m[2] ? { pageId: m[1], blockId: m[2] } : { pageId: m[1] }
}
