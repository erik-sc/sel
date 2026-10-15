import type { Block } from './types'

/**
 * Built-in blocks. A page or database whose `props.system` names one of the kinds below is
 * part of the app rather than of the user's notes (the Tasks database is the first): it lives
 * at the workspace root and cannot be deleted, trashed, moved, retyped or duplicated as such.
 * Shared by the main process, which enforces this in the repository, and the renderer, which
 * leaves out the commands that would be refused.
 */

export const SYSTEM_KINDS = ['tasks'] as const
export type SystemKind = (typeof SYSTEM_KINDS)[number]

type BlockLike = Pick<Block, 'type'> & { props?: unknown }

/** True for a value `props.system` may hold. */
export function isSystemKind(value: unknown): value is SystemKind {
  return typeof value === 'string' && (SYSTEM_KINDS as readonly string[]).includes(value)
}

/** The kind of built-in block this is, or null for an ordinary one. Malformed values are ordinary. */
export function systemKindOf(block: BlockLike | null | undefined): SystemKind | null {
  if (!block || (block.type !== 'page' && block.type !== 'database')) return null
  const props = block.props
  if (props === null || typeof props !== 'object') return null
  const kind: unknown = (props as { system?: unknown }).system
  return isSystemKind(kind) ? kind : null
}

/** A built-in block: it stays where it is, as what it is. */
export function isSystemBlock(block: BlockLike | null | undefined): boolean {
  return systemKindOf(block) !== null
}
