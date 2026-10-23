import { AI_CONTEXT_CAPS, AI_CONTEXT_KEY, AI_CONTEXT_PAGES_KEY, contextPageIds, type AiSent } from '../../shared/aiContext'
import type { Block } from '../../shared/types'
import { pinnedBody, type PromptContext, type StandingContext } from './prompts'

/**
 * Settings → AI → Context: what goes along with every request the user makes from a page or the
 * panel, read here from what is stored. The written context is the user's own words; the pinned
 * pages are content like any page, read fresh each time (an edit shows in the next request).
 * Free of Electron imports (unit-tested); the repository is passed in.
 */

export interface StandingSource {
  getSetting(key: string): unknown
  get(id: string): Block | null
  pageToMarkdown(id: string): { title: string; markdown: string }
}

/** The standing context, or null when the user set none (or none of it can be read any more). */
export function loadStanding(source: StandingSource): StandingContext | null {
  const stored = source.getSetting(AI_CONTEXT_KEY)
  const text = typeof stored === 'string' && stored.trim() ? stored.slice(0, AI_CONTEXT_CAPS.text) : undefined
  const pages: NonNullable<StandingContext['pages']> = []
  for (const id of contextPageIds(source.getSetting(AI_CONTEXT_PAGES_KEY))) {
    const block = source.get(id)
    // A page in the Trash, or gone, is left out until it is restored.
    if (!block || block.trashedAt !== null || (block.type !== 'page' && block.type !== 'database')) continue
    try {
      const { title, markdown } = source.pageToMarkdown(id)
      pages.push({ id, title, markdown })
    } catch (err) {
      console.error('[ai] a pinned page could not be read', err)
    }
  }
  if (!text && !pages.length) return null
  return { ...(text ? { text } : {}), ...(pages.length ? { pages } : {}) }
}

/** What the window is told went along with a request, or undefined when nothing did. */
export function sentOf(context: PromptContext, servers: readonly string[] = []): AiSent | undefined {
  const standing = context.standing
  const pages = standing?.pages ?? []
  // Only the pages that fitted in the prompt.
  const fitted = pages.length ? pinnedBody(pages).count : 0
  const sent: AiSent = {
    context: Boolean(standing?.text?.trim()),
    pages: pages.slice(0, fitted).map((page) => page.title.trim() || 'Untitled'),
    servers: [...servers]
  }
  return sent.context || sent.pages.length || sent.servers.length ? sent : undefined
}
