import type { Block } from './types'

/**
 * Linked database views. A `database` block whose `props.sourceId` names another
 * database shows that database's schema and rows through its own `props.views`.
 * Shared by the main process (validation, deletion) and the renderer (rendering,
 * optimistic ops), so both agree on what counts as a linked view.
 */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

type BlockLike = Pick<Block, 'id' | 'type'> & { props?: unknown }

/**
 * The id of the database a block is a linked view of, or null when it is not one.
 * Anything malformed (wrong type, not an id, pointing at itself) is not a link.
 */
export function sourceIdOf(block: BlockLike | null | undefined): string | null {
  if (!block || block.type !== 'database') return null
  const props = block.props
  if (props === null || typeof props !== 'object') return null
  const sourceId: unknown = (props as { sourceId?: unknown }).sourceId
  return typeof sourceId === 'string' && ID_RE.test(sourceId) && sourceId !== block.id ? sourceId : null
}

export function isLinkedView(block: BlockLike | null | undefined): boolean {
  return sourceIdOf(block) !== null
}

/**
 * Pages and databases go to the trash when deleted; a linked view does not: it
 * owns no rows, so it is removed like any ordinary block.
 */
export function isTrashable(block: BlockLike | null | undefined): boolean {
  return !!block && (block.type === 'page' || block.type === 'database') && !isLinkedView(block)
}
