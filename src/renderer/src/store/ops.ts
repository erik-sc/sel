import type { Block, BlockProps, Op } from '@shared/types'
import { isTrashable } from '../../../shared/linked'

export type BlockMap = Record<string, Block>

export interface OpsPlan {
  /** The new version of every block the ops touch; null for a block they remove. */
  changes: Map<string, Block | null>
  /** Ids created, updated, moved or trashed, plus parents whose `content` changed. */
  affected: string[]
  /** Ids removed from the map (hard-deleted blocks and their descendants). */
  removed: string[]
}

export interface ApplyResult {
  /** New map (the input map is never mutated; untouched blocks keep their identity). */
  map: BlockMap
  /** Ids created, updated, moved or trashed, plus parents whose `content` changed. */
  affected: string[]
  /** Ids removed from the map (hard-deleted blocks and their descendants). */
  removed: string[]
}

/** `planOps` applied to a copy of `map`. The store applies the plan in place instead (copying a big cache costs more than the edit). */
export function applyOpsToMap(map: BlockMap, ops: Op[], now: number = Date.now()): ApplyResult {
  const { changes, affected, removed } = planOps(map, ops, now)
  const next: BlockMap = { ...map }
  for (const [id, block] of changes) {
    if (block) next[id] = block
    else delete next[id]
  }
  return { map: next, affected, removed }
}

/** Pages and databases, which a delete sends to the trash. A linked view is removed like any other block. */
function isContainer(block: Block): boolean {
  return isTrashable(block)
}

/**
 * Applies block operations to an in-memory map with the same semantics as the backend:
 * - create: `input.id` is required; inserted into the parent's `content`
 *   (afterId undefined = append, null = first, id = after that sibling).
 * - update: optional type change, props shallow-merged, null removes a key.
 * - move: detached from the old parent, attached to the new one.
 * - delete: pages/databases are trashed (trashedAt set); other blocks, linked database
 *   views included, are removed together with their descendants (nested pages/databases
 *   are left alone).
 * Parents that are not in the map are simply skipped. The map is only read: what changes is
 * returned as a plan, and untouched blocks keep their identity.
 */
export function planOps(map: BlockMap, ops: Op[], now: number = Date.now()): OpsPlan {
  // Blocks written so far (null: removed); everything else is read from `map`.
  const next = new Map<string, Block | null>()
  const cloned = new Set<string>()
  const affected = new Set<string>()
  const removed = new Set<string>()

  // Own properties only: an id such as `constructor` must not resolve to Object.prototype's.
  const at = (id: string): Block | undefined => {
    const written = next.get(id)
    if (written !== undefined) return written ?? undefined
    return Object.hasOwn(map, id) ? map[id] : undefined
  }

  const edit = (id: string | null | undefined): Block | undefined => {
    if (!id) return undefined
    const current = at(id)
    if (!current) return undefined
    affected.add(id)
    if (cloned.has(id)) return current
    const copy: Block = { ...current, content: [...current.content], props: { ...current.props } }
    next.set(id, copy)
    cloned.add(id)
    return copy
  }

  const detach = (parentId: string | null, id: string): void => {
    if (!parentId) return
    const current = at(parentId)
    if (!current || !current.content.includes(id)) return
    const parent = edit(parentId)!
    parent.content = parent.content.filter((c) => c !== id)
  }

  const attach = (parentId: string | null, id: string, afterId: string | null | undefined): void => {
    const parent = edit(parentId)
    if (!parent) return
    const content = parent.content.filter((c) => c !== id)
    if (afterId === null) {
      content.unshift(id)
    } else if (afterId === undefined) {
      content.push(id)
    } else {
      const index = content.indexOf(afterId)
      if (index < 0) content.push(id)
      else content.splice(index + 1, 0, id)
    }
    parent.content = content
  }

  const isDescendantOrSelf = (candidate: string | null, ancestorId: string): boolean => {
    const seen = new Set<string>()
    let cursor = candidate
    while (cursor && !seen.has(cursor)) {
      if (cursor === ancestorId) return true
      seen.add(cursor)
      cursor = at(cursor)?.parentId ?? null
    }
    return false
  }

  for (const op of ops) {
    switch (op.op) {
      case 'create': {
        const { id, type, parentId, props, afterId } = op.input
        if (!id) throw new Error('applyOpsToMap: create requires a client-generated input.id')
        if (id === '__proto__') throw new Error('applyOpsToMap: invalid block id')
        if (at(id)) throw new Error(`applyOpsToMap: block ${id} already exists`)
        next.set(id, {
          id,
          type,
          parentId,
          content: [],
          props: { ...(props ?? {}) },
          createdAt: now,
          updatedAt: now,
          trashedAt: null
        })
        cloned.add(id)
        affected.add(id)
        removed.delete(id)
        attach(parentId, id, afterId)
        break
      }
      case 'update': {
        const block = edit(op.id)
        if (!block) break
        if (op.patch.type) block.type = op.patch.type
        if (op.patch.props) {
          const props = block.props as Record<string, unknown>
          for (const [key, value] of Object.entries(op.patch.props)) {
            if (value === null || value === undefined) delete props[key]
            else props[key] = value
          }
          block.props = props as BlockProps
        }
        block.updatedAt = now
        break
      }
      case 'move': {
        if (!at(op.id)) break
        if (isDescendantOrSelf(op.parentId, op.id)) {
          throw new Error('applyOpsToMap: cannot move a block into itself or its descendants')
        }
        const block = edit(op.id)!
        detach(block.parentId, op.id)
        block.parentId = op.parentId
        block.updatedAt = now
        attach(op.parentId, op.id, op.afterId)
        break
      }
      case 'delete': {
        const current = at(op.id)
        if (!current) break
        if (isContainer(current)) {
          const block = edit(op.id)!
          block.trashedAt = now
          block.updatedAt = now
          break
        }
        detach(current.parentId, op.id)
        const stack = [op.id]
        while (stack.length) {
          const id = stack.pop()!
          const block = at(id)
          if (!block) continue
          if (id !== op.id && isContainer(block)) continue
          stack.push(...block.content)
          next.set(id, null)
          cloned.delete(id)
          affected.delete(id)
          removed.add(id)
        }
        break
      }
    }
  }

  // Blocks created and removed again within the same ops were never in the map.
  for (const [id, block] of next) if (block === null && !Object.hasOwn(map, id)) next.delete(id)
  return { changes: next, affected: [...affected], removed: [...removed] }
}
