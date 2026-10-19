// Op-level undo/redo history. Pure; unit tested.
import type { Op } from '@shared/types'

export interface HistoryEntry<S> {
  ops: Op[]
  inverse: Op[]
  before: S
  after: S
  key?: string
  time: number
  /** Trashed page ids that must be restored before applying `inverse`. */
  restore?: string[]
}

export interface CommitOptions {
  /** Entries with the same key committed without a pause are merged (typing). */
  key?: string
  restore?: string[]
  now?: number
}

function singleUpdate(ops: Op[]): { id: string; keys: string } | null {
  if (ops.length !== 1) return null
  const op = ops[0]
  if (op.op !== 'update' || op.patch.type !== undefined) return null
  return {
    id: op.id,
    keys: Object.keys(op.patch.props ?? {})
      .sort()
      .join(',')
  }
}

export class History<S> {
  private undoStack: HistoryEntry<S>[] = []
  private redoStack: HistoryEntry<S>[] = []
  private sealed = false

  constructor(
    private coalesceMs = 1200,
    private limit = 500
  ) {}

  commit(ops: Op[], inverse: Op[], before: S, after: S, opts: CommitOptions = {}): void {
    if (ops.length === 0) return
    const now = opts.now ?? Date.now()
    this.redoStack = []
    const last = this.undoStack[this.undoStack.length - 1]
    if (last && !this.sealed && opts.key && last.key === opts.key && now - last.time < this.coalesceMs) {
      const a = singleUpdate(last.ops)
      const b = singleUpdate(ops)
      if (a && b && a.id === b.id && a.keys === b.keys) {
        // Same fields of the same block: the first inverse already restores the original.
        last.ops = ops
      } else {
        last.ops = [...last.ops, ...ops]
        last.inverse = [...inverse, ...last.inverse]
      }
      last.after = after
      last.time = now
      return
    }
    this.sealed = false
    this.undoStack.push({ ops, inverse, before, after, key: opts.key, time: now, restore: opts.restore })
    if (this.undoStack.length > this.limit) this.undoStack.shift()
  }

  /** The next commit starts a new entry even if its key matches. */
  seal(): void {
    this.sealed = true
  }

  undo(): HistoryEntry<S> | undefined {
    const e = this.undoStack.pop()
    if (e) this.redoStack.push(e)
    this.sealed = true
    return e
  }

  redo(): HistoryEntry<S> | undefined {
    const e = this.redoStack.pop()
    if (e) this.undoStack.push(e)
    this.sealed = true
    return e
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
