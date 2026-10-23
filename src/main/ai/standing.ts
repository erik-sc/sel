import { AI_CONTEXT_CAPS, AI_CONTEXT_KEY, AI_CONTEXT_PAGES_KEY, contextPageIds, type AiSent } from '../../shared/aiContext'
import { privacyChecker } from '../../shared/aiPrivate'
import { contextScopes, SCOPE_CONTEXT_CAPS } from '../../shared/aiScope'
import type { Block } from '../../shared/types'
import { memoryBody, pinnedBody, type PromptContext, type ScopePrompt, type StandingContext } from './prompts'

/**
 * Settings → AI → Context: what goes along with every request the user makes from a page or the
 * panel, read here from what is stored. The written context is the user's own words; the pinned
 * pages are content like any page, read fresh each time (an edit shows in the next request).
 * Free of Electron imports (unit-tested); the repository is passed in.
 */

export interface StandingSource {
  getSetting(key: string): unknown
  get(id: string): Block | null
  /** `hidden` names the pages, databases and rows inside to leave out (what is private from the AI). */
  pageToMarkdown(id: string, hidden?: (id: string) => boolean): { title: string; markdown: string }
}

/** The standing context, or null when the user set none (or none of it can be read any more). */
export function loadStanding(source: StandingSource): StandingContext | null {
  const stored = source.getSetting(AI_CONTEXT_KEY)
  const text = typeof stored === 'string' && stored.trim() ? stored.slice(0, AI_CONTEXT_CAPS.text) : undefined
  const pages: NonNullable<StandingContext['pages']> = []
  const hidden = privacyChecker(source)
  pages.push(...readPinned(source, contextPageIds(source.getSetting(AI_CONTEXT_PAGES_KEY)), hidden))
  if (!text && !pages.length) return null
  return { ...(text ? { text } : {}), ...(pages.length ? { pages } : {}) }
}

/** Pinned pages as Markdown, leaving out what is gone, in the Trash or private from the AI. */
function readPinned(
  source: Pick<StandingSource, 'get' | 'pageToMarkdown'>,
  ids: readonly string[],
  hidden: (id: string) => boolean
): NonNullable<StandingContext['pages']> {
  const pages: NonNullable<StandingContext['pages']> = []
  for (const id of ids) {
    const block = source.get(id)
    // A page in the Trash, or gone, is left out until it is restored.
    if (!block || block.trashedAt !== null || (block.type !== 'page' && block.type !== 'database')) continue
    // Pinned before it was made private (or on another device): left out while it is (Settings says so).
    if (hidden(id)) continue
    try {
      const { title, markdown } = source.pageToMarkdown(id, hidden)
      pages.push({ id, title, markdown })
    } catch (err) {
      console.error('[ai] a pinned page could not be read', err)
    }
  }
  return pages
}

/**
 * The context of the project and the database the request's page belongs to (0.8.0 A4, see
 * shared/aiScope.ts for what belongs where), each with its text and its pinned pages read fresh.
 * Nothing private from the AI: not a private project or database, not a private pinned page.
 * `skip` names pages already going along (the general pinned pages), not sent twice.
 */
export function loadScopes(
  source: Pick<StandingSource, 'get' | 'pageToMarkdown'>,
  pageId: string | null | undefined,
  skip: readonly string[] = []
): ScopePrompt[] {
  if (!pageId) return []
  const hidden = privacyChecker(source)
  const out: ScopePrompt[] = []
  for (const scope of contextScopes(source, pageId, hidden)) {
    const text = scope.context.text.trim() ? scope.context.text.slice(0, SCOPE_CONTEXT_CAPS.text) : undefined
    const ids = scope.context.pages.filter((id) => !skip.includes(id)).slice(0, SCOPE_CONTEXT_CAPS.pages)
    const pages = readPinned(source, ids, hidden)
    if (!text && !pages.length) continue
    out.push({ kind: scope.kind, name: scope.name, ...(text ? { text } : {}), ...(pages.length ? { pages } : {}) })
  }
  return out
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
  const scopes = (context.scopes ?? []).map((scope) => {
    const own = scope.pages ?? []
    const count = own.length ? pinnedBody(own, SCOPE_CONTEXT_CAPS).count : 0
    return {
      kind: scope.kind,
      name: scope.name || 'Untitled',
      context: Boolean(scope.text?.trim()),
      pages: own.slice(0, count).map((page) => page.title.trim() || 'Untitled')
    }
  })
  const went = scopes.filter((scope) => scope.context || scope.pages.length)
  if (went.length) sent.scopes = went
  // The remembered facts that fitted (0.8.0 A3).
  const memory = context.memory?.length ? memoryBody(context.memory).count : 0
  if (memory) sent.memory = memory
  return sent.context || sent.pages.length || sent.servers.length || went.length || memory ? sent : undefined
}
