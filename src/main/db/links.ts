import { PAGE_LINK_PREFIX, parsePageLink } from '../../shared/pageLink'
import type { BlockProps } from '../../shared/types'
import { parseProps } from './blocks'

/**
 * Links from a block's text to pages (`sel://page/<id>`, see shared/pageLink), as the
 * `page_links` table keeps them: the marks of its title and caption, which is the text
 * "Linked from" reads.
 */

/** True when stored props may hold a page link: a substring test that spares the JSON parser for almost every block. */
export function mayLink(raw: string): boolean {
  return raw.includes(PAGE_LINK_PREFIX)
}

function collect(rt: unknown, into: Set<string>): void {
  if (!Array.isArray(rt)) return
  for (const span of rt as unknown[]) {
    const marks = Array.isArray(span) ? (span[1] as unknown) : null
    if (!Array.isArray(marks)) continue
    for (const m of marks as unknown[]) {
      if (!Array.isArray(m) || m[0] !== 'a') continue
      const target = parsePageLink(m[1])
      if (target) into.add(target.pageId)
    }
  }
}

/** The pages a block's text links to (to one of its blocks counts as to the page), each once. */
export function linkTargets(props: string | BlockProps): string[] {
  let parsed: BlockProps
  if (typeof props === 'string') {
    if (!mayLink(props)) return []
    parsed = parseProps(props)
  } else parsed = props
  const out = new Set<string>()
  collect(parsed.title, out)
  collect(parsed.caption, out)
  return [...out]
}
