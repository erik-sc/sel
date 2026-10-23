import { TASK_PROPS } from './tasks'
import type { Block } from './types'

/**
 * "Private from AI" ("Privado para a AI"): a page, a database or a project of Tasks the user keeps
 * away from the AI. What is private, and everything under it, never goes into a prompt (the page
 * asked about, the workspace around it, the related pages, the day, the pinned pages), never
 * comes back from the workspace tools Claude reads through, and is invisible to the apps
 * connected over MCP (sel for other apps): they can neither read nor write it.
 *
 * Stored on the blocks themselves, so it syncs and is exported with them:
 * - `props.aiPrivate: true` on a page or database: it, its sub-pages, its rows and every block
 *   inside them. A linked view of a private database is private too (it shows the same rows).
 * - `props.aiPrivateProjects: string[]` on a database (the built-in Tasks database): the option
 *   ids of its project property (`tasks.project`) whose rows are private, wherever they show.
 *
 * Whatever reads content for the AI asks `isPrivateForAi` (or a `privacyChecker`, the same
 * answer remembered for one read) about every id before it reads it. Pure: no Electron, Node or
 * React; the main process enforces it, the window shows the lock with it.
 */

/** Anything that can give a block by id: the repository, or the window's block store. */
export interface PrivacyLookup {
  get(id: string): Block | null | undefined
}

/** Why a block is private: its own mark, an ancestor's, its project's, or its source database's. */
export type AiPrivacyReason = 'self' | 'ancestor' | 'project' | 'source'

export interface AiPrivacy {
  reason: AiPrivacyReason
  /** The block that carries the mark (for `project`: the database that lists the project). */
  fromId: string
}

/** What a tool or a refusal says about something private. Never its title. */
export const AI_PRIVATE_MESSAGE = 'That is private: the user keeps it from the AI.'
/** A request made about a private page (other than a question, which goes without the page). */
export const AI_PRIVATE_PAGE_MESSAGE = 'This page is private from the AI. Turn that off in its ⋯ menu to use the AI on it.'

const MAX_DEPTH = 64

const pageLike = (block: Block): boolean => block.type === 'page' || block.type === 'database'

/** The page or database carries the mark itself. */
export function ownAiPrivate(block: Pick<Block, 'type' | 'props'> | null | undefined): boolean {
  return !!block && (block.type === 'page' || block.type === 'database') && block.props.aiPrivate === true
}

/** The project option ids a database keeps private (cleaned). */
export function privateProjects(database: Pick<Block, 'props'> | null | undefined): string[] {
  const value: unknown = database?.props.aiPrivateProjects
  if (!Array.isArray(value)) return []
  return value.filter((id, index): id is string => typeof id === 'string' && id.length > 0 && value.indexOf(id) === index)
}

/** The project of a row (its `tasks.project` option id), or null. */
function projectOf(row: Block): string | null {
  const value = row.props.values?.[TASK_PROPS.project]
  return typeof value === 'string' && value ? value : null
}

/**
 * Why `block` is private by what it is or where it is shown, apart from its ancestors: its own
 * mark, its project, or the database it is a linked view of. `deeper` answers for another id.
 */
function ownReason(source: PrivacyLookup, block: Block, deeper: (id: string) => boolean): AiPrivacy | null {
  if (ownAiPrivate(block)) return { reason: 'self', fromId: block.id }
  if (block.type === 'database' && typeof block.props.sourceId === 'string' && deeper(block.props.sourceId))
    return { reason: 'source', fromId: block.props.sourceId }
  if (block.type === 'page' && block.parentId) {
    const project = projectOf(block)
    if (project) {
      const parent = source.get(block.parentId)
      if (parent && parent.type === 'database' && privateProjects(parent).includes(project)) return { reason: 'project', fromId: parent.id }
    }
  }
  return null
}

/**
 * Why `id` is private for the AI, or null when it is not (or is not known). Walks up from the
 * block: the first mark found decides.
 */
export function aiPrivacy(source: PrivacyLookup, id: string | null | undefined): AiPrivacy | null {
  const check = privacyChecker(source)
  let current = id ? source.get(id) : null
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    const own = ownReason(source, current, check)
    if (own) return current.id === id ? own : { reason: 'ancestor', fromId: current.id }
    current = current.parentId ? source.get(current.parentId) : null
  }
  return null
}

/** True when `id` (or anything it is inside) is private for the AI. */
export function isPrivateForAi(source: PrivacyLookup, id: string | null | undefined): boolean {
  return id ? privacyChecker(source)(id) : false
}

/**
 * `isPrivateForAi` for many ids in one read: what is learnt of a block and its ancestors is
 * remembered, so walking a tree costs one look per block. Make a new one for each read: the
 * answers are not refreshed.
 */
export function privacyChecker(source: PrivacyLookup): (id: string | null | undefined) => boolean {
  const known = new Map<string, boolean>()
  /** Linked views being looked through: a cycle of them is not private by itself. */
  const visiting = new Set<string>()
  const check = (id: string | null | undefined): boolean => {
    if (!id) return false
    const cached = known.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return false
    visiting.add(id)
    try {
      // The chain from the block up to the first one already known (or the top).
      const chain: Block[] = []
      let base = false
      let cursor: string | null = id
      while (cursor && chain.length < MAX_DEPTH) {
        const seen = known.get(cursor)
        if (seen !== undefined) {
          base = seen
          break
        }
        const block = source.get(cursor)
        if (!block) break
        chain.push(block)
        cursor = block.parentId
      }
      for (let i = chain.length - 1; i >= 0; i--) {
        const block = chain[i]
        base = base || (pageLike(block) && ownReason(source, block, check) !== null)
        known.set(block.id, base)
      }
      return known.get(id) ?? base
    } finally {
      visiting.delete(id)
    }
  }
  return check
}
