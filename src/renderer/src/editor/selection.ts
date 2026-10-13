// Focus registry and selection for one editor: which editable holds the caret,
// restoring a caret across re-renders, and the block (multi) selection.
import type { StoreApi } from 'zustand/vanilla'
import { isEditable, nextVisible, order, prevVisible, type Tree } from './structure'
import { END, textSel, type Focusable, type Sel, type TextSel, type UIState } from './types'

const selectedSets = new WeakMap<readonly string[], ReadonlySet<string>>()

/** Membership test for the block selection; O(1) per block instead of scanning the list in every block. */
export function isSelected(selected: readonly string[], id: string): boolean {
  if (selected.length === 0) return false
  let set = selectedSets.get(selected)
  if (!set) selectedSets.set(selected, (set = new Set(selected)))
  return set.has(id)
}

/** How long a restored caret keeps waiting for its block to (re)mount. */
const PENDING_CARET_MS = 300

export class SelectionManager {
  /** The editor surface; receives focus while blocks are selected. */
  root: HTMLElement | null = null

  private reg = new Map<string, Focusable>()
  private pending: TextSel | null = null
  private pendingEl: HTMLElement | null = null
  private pendingToken = 0
  private pendingTimer = 0
  private pendingFrame = 0

  constructor(
    private readonly tree: Tree,
    private readonly ui: StoreApi<UIState>
  ) {}

  // ---- registry ---------------------------------------------------------

  register(key: string, f: Focusable): () => void {
    this.reg.set(key, f)
    if (this.pending?.blockId === key) this.applyPending()
    return () => {
      if (this.reg.get(key) === f) this.reg.delete(key)
    }
  }

  focusable(key: string): Focusable | undefined {
    return this.reg.get(key)
  }

  flush(key: string): void {
    this.reg.get(key)?.flush()
  }

  flushAll(): void {
    for (const f of [...this.reg.values()]) f.flush()
  }

  /** Registry key of the focused editable, if any. */
  focusedKey(): string | null {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return null
    // Every editable carries its registry key, so this is a lookup, not a scan.
    const key = active.dataset.editable
    return key && this.reg.get(key)?.el === active ? key : null
  }

  // ---- caret ------------------------------------------------------------

  current(): Sel {
    const { selected } = this.ui.getState()
    if (selected.length) return { kind: 'blocks', ids: selected }
    const key = this.focusedKey()
    const o = key ? this.reg.get(key)?.getSel() : null
    return key && o ? textSel(key, o.start, o.end) : null
  }

  restore(sel: Sel): void {
    if (!sel) return
    if (sel.kind === 'blocks') {
      this.selectBlocks(sel.ids.filter((id) => this.tree.get(id)))
      return
    }
    this.clearBlockSelection()
    this.cancelPending()
    this.pending = sel
    this.applyPending()
    const token = this.pendingToken
    // The target may be (re)mounted by the render that follows: `register` applies the
    // pending selection for a short while, and we retry once React has committed.
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = requestAnimationFrame(() => {
        this.pendingFrame = 0
        // Only when the target was replaced meanwhile; re-syncing the same element
        // could discard characters typed in between.
        const p = this.pending
        if (token === this.pendingToken && p && this.reg.get(p.blockId)?.el !== this.pendingEl) this.applyPending()
      })
    })
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = 0
      if (token === this.pendingToken) this.pending = null
    }, PENDING_CARET_MS)
  }

  /** Forgets a caret that is still waiting for its block; anything that moves focus elsewhere calls this. */
  cancelPending(): void {
    this.pendingToken++
    this.pending = null
    this.pendingEl = null
    if (this.pendingTimer) window.clearTimeout(this.pendingTimer)
    if (this.pendingFrame) cancelAnimationFrame(this.pendingFrame)
    this.pendingTimer = 0
    this.pendingFrame = 0
  }

  private applyPending(): void {
    const p = this.pending
    if (!p) return
    const f = this.reg.get(p.blockId)
    if (!f || !f.el.isConnected) return
    f.sync()
    f.setSel(p.start, p.end)
    this.pendingEl = f.el
  }

  focusBlock(id: string, start: number, end = start): void {
    this.restore(textSel(id, start, end))
  }

  /** Focus an editable block, or block-select one that has no text. */
  focusOrSelect(id: string, where: 'start' | 'end'): void {
    const b = this.tree.get(id)
    if (!b) return
    if (id === this.tree.pageId || isEditable(b)) this.focusBlock(id, where === 'start' ? 0 : END)
    else this.selectBlocks([id])
  }

  /** Like `focusOrSelect`, entering the block on its first/last line near viewport `x`. */
  focusOrSelectAt(id: string, x: number | null, edge: 'top' | 'bottom'): void {
    const f = this.reg.get(id)
    if (f) {
      this.cancelPending()
      this.clearBlockSelection()
      f.focusAt(x, edge)
    } else this.selectBlocks([id])
  }

  // ---- block selection --------------------------------------------------

  selectBlocks(ids: string[], anchor: string | null = ids[0] ?? null, head: string | null = ids[ids.length - 1] ?? null): void {
    if (ids.length) {
      this.cancelPending()
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== this.root && this.root?.contains(active)) active.blur()
      this.root?.focus({ preventScroll: true })
      window.getSelection()?.removeAllRanges()
    }
    this.ui.setState({ selected: ids, anchor: ids.length ? anchor : null, head: ids.length ? head : null, ...(ids.length ? { slash: null } : {}) })
  }

  clearBlockSelection(): void {
    if (this.ui.getState().selected.length) this.ui.setState({ selected: [], anchor: null, head: null })
  }

  selectRange(a: string, b: string): void {
    const all = order(this.tree)
    const i = all.indexOf(a)
    const j = all.indexOf(b)
    if (i < 0 || j < 0) return
    this.selectBlocks(all.slice(Math.min(i, j), Math.max(i, j) + 1), a, b)
  }

  selectAll(): void {
    const all = order(this.tree)
    if (all.length) this.selectBlocks(all)
  }

  /** Anchor for Shift+click: block selection anchor or the focused block. */
  shiftAnchor(): string | null {
    const key = this.ui.getState().anchor ?? this.focusedKey()
    if (!key) return null
    const id = key.split(':')[0]
    return id === this.tree.pageId ? null : id
  }

  extendSelection(dir: -1 | 1): void {
    const { anchor, head, selected } = this.ui.getState()
    const h = head ?? selected[selected.length - 1]
    if (!h) return
    const next = dir < 0 ? prevVisible(this.tree, h) : nextVisible(this.tree, h)
    if (next && next !== this.tree.pageId) this.selectRange(anchor ?? h, next)
  }

  moveSelection(dir: -1 | 1): void {
    const { head, selected } = this.ui.getState()
    const from = head ?? (dir < 0 ? selected[0] : selected[selected.length - 1])
    if (!from) return
    const target = dir < 0 ? prevVisible(this.tree, from) : nextVisible(this.tree, from)
    if (target) this.focusOrSelectAt(target, null, dir < 0 ? 'bottom' : 'top')
  }

  /** The block's ids to act on: the whole selection when the block is part of it. */
  targetIds(id: string): string[] {
    const { selected } = this.ui.getState()
    return selected.includes(id) ? selected : [id]
  }

  dispose(): void {
    this.cancelPending()
  }
}
