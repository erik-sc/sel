// Pure op helpers: simulate a batch on top of the cache and compute its inverse.
import type { Block, BlockProps, Op } from '@shared/types'
import { isTrashable } from '../../../shared/linked'

export type GetBlock = (id: string) => Block | undefined

export function insertAfter(list: string[], id: string, afterId: string | null | undefined): void {
  const at = afterId === null ? 0 : afterId === undefined ? list.length : list.indexOf(afterId) + 1 || list.length
  list.splice(at, 0, id)
}

/** Copy-on-write view of the block cache on which ops can be replayed. */
export class Overlay {
  private map = new Map<string, Block | null>()
  constructor(private base: GetBlock) {}

  get(id: string): Block | undefined {
    if (this.map.has(id)) return this.map.get(id) ?? undefined
    return this.base(id)
  }

  private own(id: string): Block | undefined {
    const b = this.get(id)
    if (!b) return undefined
    const copy: Block = { ...b, content: [...b.content], props: { ...b.props } }
    this.map.set(id, copy)
    return copy
  }

  private detach(id: string, parentId: string | null): void {
    const p = parentId ? this.own(parentId) : undefined
    if (p) p.content = p.content.filter((c) => c !== id)
  }

  private attach(id: string, parentId: string | null, afterId: string | null | undefined): void {
    const p = parentId ? this.own(parentId) : undefined
    if (p) insertAfter(p.content, id, afterId)
  }

  private remove(id: string): void {
    const b = this.get(id)
    // Nested pages/databases survive the removal of the block that held them
    // (a linked database view does not: it is an ordinary block as far as deletion goes).
    if (!b || isTrashable(b)) return
    this.map.set(id, null)
    for (const c of b.content) this.remove(c)
  }

  apply(op: Op): void {
    if (op.op === 'create') {
      const id = op.input.id
      if (!id) return
      this.map.set(id, {
        id,
        type: op.input.type,
        parentId: op.input.parentId,
        content: [],
        props: { ...(op.input.props ?? {}) },
        createdAt: 0,
        updatedAt: 0,
        trashedAt: null
      })
      this.attach(id, op.input.parentId, op.input.afterId)
    } else if (op.op === 'update') {
      const b = this.own(op.id)
      if (!b) return
      if (op.patch.type) b.type = op.patch.type
      const props = b.props as Record<string, unknown>
      for (const [k, v] of Object.entries(op.patch.props ?? {})) {
        if (v === null || v === undefined) delete props[k]
        else props[k] = v
      }
    } else if (op.op === 'move') {
      const b = this.own(op.id)
      if (!b) return
      this.detach(op.id, b.parentId)
      b.parentId = op.parentId
      this.attach(op.id, op.parentId, op.afterId)
    } else {
      const b = this.get(op.id)
      if (!b) return
      if (isTrashable(b)) {
        // Containers are trashed in place, not removed.
        const own = this.own(op.id)
        if (own) own.trashedAt = own.trashedAt ?? 1
        return
      }
      this.detach(op.id, b.parentId)
      this.remove(op.id)
    }
  }
}

function prevSiblingOf(ov: Overlay, b: Block): string | null | undefined {
  const parent = b.parentId ? ov.get(b.parentId) : undefined
  if (!parent) return undefined
  const i = parent.content.indexOf(b.id)
  if (i < 0) return undefined
  return i === 0 ? null : parent.content[i - 1]
}

function recreate(ov: Overlay, b: Block, afterId: string | null | undefined, out: Op[]): void {
  if (isTrashable(b)) {
    // Still exists (containers are never hard-deleted with their holder): re-attach it.
    out.push({ op: 'move', id: b.id, parentId: b.parentId, afterId })
    return
  }
  out.push({
    op: 'create',
    input: { id: b.id, type: b.type, parentId: b.parentId, props: { ...b.props }, afterId }
  })
  for (const childId of b.content) {
    const child = ov.get(childId)
    if (child) recreate(ov, child, undefined, out)
  }
}

export interface Inverted {
  /** Ops that undo the batch, already in the order they must be applied. */
  inverse: Op[]
  /** Pages/databases the batch sends to the trash; undo must restore them first. */
  restore: string[]
}

/** Computes the inverse of a batch from the state *before* it is applied. */
export function invertOps(ops: Op[], get: GetBlock): Inverted {
  const ov = new Overlay(get)
  const groups: Op[][] = []
  const restore: string[] = []
  for (const op of ops) {
    const inv: Op[] = []
    if (op.op === 'create') {
      if (op.input.id) inv.push({ op: 'delete', id: op.input.id })
    } else if (op.op === 'update') {
      const old = ov.get(op.id)
      if (old) {
        const props: Record<string, unknown> = {}
        const oldProps = old.props as Record<string, unknown>
        for (const k of Object.keys(op.patch.props ?? {})) props[k] = oldProps[k] === undefined ? null : oldProps[k]
        inv.push({
          op: 'update',
          id: op.id,
          patch: {
            ...(op.patch.type !== undefined ? { type: old.type } : {}),
            ...(op.patch.props ? { props: props as { [K in keyof BlockProps]?: BlockProps[K] | null } } : {})
          }
        })
      }
    } else if (op.op === 'move') {
      const old = ov.get(op.id)
      if (old) inv.push({ op: 'move', id: op.id, parentId: old.parentId, afterId: prevSiblingOf(ov, old) })
    } else {
      const old = ov.get(op.id)
      if (old) {
        const after = prevSiblingOf(ov, old)
        if (isTrashable(old)) {
          restore.push(old.id)
          inv.push({ op: 'move', id: old.id, parentId: old.parentId, afterId: after })
        } else recreate(ov, old, after, inv)
      }
    }
    groups.push(inv)
    ov.apply(op)
  }
  return { inverse: groups.reverse().flat(), restore }
}
