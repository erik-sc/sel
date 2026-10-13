// Per-page editor controller: the single object the components talk to.
//
// It owns the undo history and the commit pipeline (every mutation goes through
// `commit`, which records the inverse ops and applies the batch through the
// store) and exposes the editing commands. The rules live in focused modules:
//   selection.ts    focus registry, caret restoration, block selection
//   structure.ts    tree navigation and structural ops (pure)
//   typingHooks.ts  pending marks, Markdown shortcuts, slash menu
//   paste.ts        copy, paste, duplicate, file drops
//   clipboard.ts    clipboard formats and their validation (pure)
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BlockProps, BlockType, Mark, Op, RichText } from '@shared/types'
import { applyOps, getBlock, loadTree, newId } from '@/store/blocks'
import { isTextType, type SlashItem } from './blockTypes'
import { History } from './history'
import { invertOps } from './ops'
import * as paste from './paste'
import { addMark, marksAt, removeMark, replaceRange, rtLength, toggleMark } from './richtext-dom'
import { sanitizeHref } from './sanitize'
import { SelectionManager } from './selection'
import {
  backspacePlan,
  deleteForwardPlan,
  indentOps,
  isDescendant,
  isEditable,
  liveChildren,
  moveOps,
  moveToOps,
  nextVisible,
  outdentOps,
  prevVisible,
  redoPlan,
  splitPlan,
  topLevel,
  turnIntoOps,
  type Plan,
  type Tree
} from './structure'
import { TypingHooks } from './typingHooks'
import {
  END,
  textSel,
  type CommitOptions,
  type DropTarget,
  type Focusable,
  type PropsPatch,
  type Sel,
  type TextRange,
  type UIState
} from './types'

export { MIME_BLOCKS, MIME_DRAG, MIME_RICHTEXT } from './clipboard'
export type { DropPos, DropTarget, Focusable, PropsPatch, Sel, SlashState, TextRange, UIState } from './types'

export class EditorController {
  readonly history = new History<Sel>()
  readonly ui: StoreApi<UIState> = createStore<UIState>(() => ({
    selected: [],
    anchor: null,
    head: null,
    slash: null,
    sourcePicker: null,
    drop: null,
    menu: null,
    linkRequest: 0
  }))
  readonly tree: Tree
  onOpenPage: (id: string, opts?: { newTab?: boolean }) => void = () => {}
  /** Ids being dragged with the block handle. */
  dragIds: string[] | null = null

  private readonly selection: SelectionManager
  private readonly typing: TypingHooks
  /** Undo/redo run one at a time: each may wait for the backend before the next starts. */
  private historyQueue: Promise<void> = Promise.resolve()

  constructor(readonly pageId: string) {
    this.tree = { pageId, get: getBlock }
    this.selection = new SelectionManager(this.tree, this.ui)
    this.typing = new TypingHooks(this)
  }

  /** Releases timers. The controller stays usable (effects may run again in StrictMode). */
  dispose(): void {
    this.selection.dispose()
    this.typing.dispose()
  }

  // ---- focus and selection (see selection.ts) ---------------------------

  get root(): HTMLElement | null {
    return this.selection.root
  }

  set root(el: HTMLElement | null) {
    this.selection.root = el
  }

  register(key: string, f: Focusable): () => void {
    return this.selection.register(key, f)
  }

  focusable(key: string): Focusable | undefined {
    return this.selection.focusable(key)
  }

  flush(key: string): void {
    this.selection.flush(key)
  }

  flushAll(): void {
    this.selection.flushAll()
  }

  focusedKey(): string | null {
    return this.selection.focusedKey()
  }

  currentSel(): Sel {
    return this.selection.current()
  }

  restoreSel(sel: Sel): void {
    this.selection.restore(sel)
  }

  focusBlock(id: string, start: number, end = start): void {
    this.selection.focusBlock(id, start, end)
  }

  focusOrSelect(id: string, where: 'start' | 'end'): void {
    this.selection.focusOrSelect(id, where)
  }

  selectBlocks(ids: string[]): void {
    this.selection.selectBlocks(ids)
  }

  clearBlockSelection(): void {
    this.selection.clearBlockSelection()
  }

  selectRange(a: string, b: string): void {
    this.selection.selectRange(a, b)
  }

  selectAll(): void {
    this.selection.selectAll()
  }

  shiftAnchor(): string | null {
    return this.selection.shiftAnchor()
  }

  extendSelection(dir: -1 | 1): void {
    this.selection.extendSelection(dir)
  }

  moveSelection(dir: -1 | 1): void {
    this.selection.moveSelection(dir)
  }

  targetIds(id: string): string[] {
    return this.selection.targetIds(id)
  }

  nextVisible(id: string): string | null {
    return nextVisible(this.tree, id)
  }

  /** Last top-level block of the page, if any. */
  lastBlock(): string | null {
    const kids = liveChildren(this.tree, getBlock(this.pageId))
    return kids[kids.length - 1] ?? null
  }

  moveVertical(id: string, dir: -1 | 1, x: number | null): boolean {
    const target = dir < 0 ? prevVisible(this.tree, id) : nextVisible(this.tree, id)
    if (!target) return false
    this.selection.focusOrSelectAt(target, x, dir < 0 ? 'bottom' : 'top')
    return true
  }

  moveHorizontal(id: string, dir: -1 | 1): boolean {
    const target = dir < 0 ? prevVisible(this.tree, id) : nextVisible(this.tree, id)
    if (!target) return false
    this.focusOrSelect(target, dir < 0 ? 'end' : 'start')
    return true
  }

  // ---- history ----------------------------------------------------------

  commit(ops: Op[], opts: CommitOptions = {}): void {
    if (ops.length === 0) {
      if (opts.after !== undefined && !opts.silent) this.restoreSel(opts.after)
      return
    }
    const before = opts.before !== undefined ? opts.before : this.currentSel()
    const after = opts.after !== undefined ? opts.after : before
    const { inverse, restore } = invertOps(ops, getBlock)
    this.history.commit(ops, inverse, before, after, { key: opts.key, restore })
    void applyOps(ops).catch((err: unknown) => this.onApplyFailed('applyOps', err))
    if (!opts.silent) this.restoreSel(after)
  }

  /**
   * A batch was rejected (the store has already rolled the blocks back). The
   * recorded inverses no longer describe the document, so replaying any of them
   * could corrupt it: drop the history.
   */
  private onApplyFailed(what: string, err: unknown): void {
    console.error(`[editor] ${what} failed`, err)
    this.history.clear()
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.historyQueue.then(task)
    this.historyQueue = run.catch(() => undefined)
    return run
  }

  private async restorePages(ids: readonly string[]): Promise<void> {
    if (!ids.length) return
    for (const id of ids) await window.api.pages.restore(id)
    await loadTree(this.pageId)
  }

  undo(): Promise<void> {
    return this.enqueue(async () => {
      this.flushAll()
      this.typing.closeSlash()
      const e = this.history.undo()
      if (!e) return
      try {
        await this.restorePages(e.restore ?? [])
        if (e.inverse.length) await applyOps(e.inverse)
      } catch (err) {
        this.onApplyFailed('undo', err)
      }
      this.restoreSel(e.before)
    })
  }

  redo(): Promise<void> {
    return this.enqueue(async () => {
      this.flushAll()
      const e = this.history.redo()
      if (!e) return
      try {
        // Pages/databases created by this entry were only trashed by the undo.
        const plan = redoPlan(e.ops, getBlock)
        await this.restorePages(plan.restore)
        if (plan.ops.length) await applyOps(plan.ops)
      } catch (err) {
        this.onApplyFailed('redo', err)
      }
      this.restoreSel(e.after)
    })
  }

  update(id: string, props: PropsPatch, opts: CommitOptions = {}): void {
    this.commit([{ op: 'update', id, patch: { props } }], opts)
  }

  /** Executes what a structural key press resolved to. */
  private run(plan: Plan, id: string): void {
    if (!plan) return
    switch (plan.do) {
      case 'commit':
        return this.commit(plan.ops, { after: plan.after })
      case 'turnText':
        return this.turnInto([id], 'text')
      case 'outdent':
        return this.outdent([id])
      case 'focus':
        return this.focusOrSelect(plan.id, plan.where)
      case 'select':
        return this.selectBlocks([plan.id])
    }
  }

  // ---- text commands ----------------------------------------------------

  private titleOf(id: string): RichText {
    return getBlock(id)?.props.title ?? []
  }

  /** Replaces [start, end) of a block's text and puts the caret after the insertion. */
  replaceText(id: string, start: number, end: number, insert: RichText): void {
    this.flush(id)
    if (!getBlock(id)) return
    const title = replaceRange(this.titleOf(id), start, end, insert)
    this.update(id, { title }, { after: textSel(id, start + rtLength(insert)) })
  }

  insertPlain(id: string, start: number, end: number, text: string): void {
    this.flush(id)
    const marks = marksAt(this.titleOf(id), start)
    this.replaceText(id, start, end, text ? [[text, marks]] : [])
  }

  /** Selection of the focused rich-text block, collapsed or not. */
  private focusedRange(): TextRange | null {
    const key = this.focusedKey()
    const f = key ? this.focusable(key) : undefined
    const o = f?.getSel()
    return key && f?.rich && o ? { id: key, ...o } : null
  }

  /**
   * Toggles a mark on `range` (default: the focused selection). With a collapsed
   * caret nothing changes yet: the mark applies to the text typed next.
   */
  toggleMark(mark: Mark, range: TextRange | null = this.focusedRange()): void {
    if (!range) return
    this.flush(range.id)
    if (range.end <= range.start) {
      this.typing.togglePendingMark(range.id, range.start, mark)
      return
    }
    const title = toggleMark(this.titleOf(range.id), range.start, range.end, mark)
    this.update(range.id, { title }, { after: textSel(range.id, range.start, range.end) })
  }

  /** Sets a mark over the range, or removes marks of `kind` when `mark` is null. */
  setMark(range: TextRange, kind: string, mark: Mark | null): void {
    this.flush(range.id)
    const cur = this.titleOf(range.id)
    const title = mark ? addMark(cur, range.start, range.end, mark) : removeMark(cur, range.start, range.end, kind)
    this.update(range.id, { title }, { after: textSel(range.id, range.start, range.end) })
  }

  /** Links the range (null removes the link). Returns false, changing nothing, when the url is not allowed. */
  setLink(range: TextRange, url: string | null): boolean {
    const href = url === null ? null : sanitizeHref(url)
    if (url !== null && !href) return false
    this.setMark(range, 'a', href ? ['a', href] : null)
    return true
  }

  requestLink(): void {
    const range = this.focusedRange()
    if (range && range.end > range.start) this.ui.setState((s) => ({ linkRequest: s.linkRequest + 1 }))
  }

  clearPendingMarks(): void {
    this.typing.clearPendingMarks()
  }

  split(id: string, start: number, end: number): void {
    this.flush(id)
    this.run(splitPlan(this.tree, id, start, end, newId), id)
  }

  backspaceAtStart(id: string): void {
    this.flushAll()
    this.run(backspacePlan(this.tree, id), id)
  }

  deleteAtEnd(id: string): void {
    this.flushAll()
    this.run(deleteForwardPlan(this.tree, id), id)
  }

  // ---- block commands ---------------------------------------------------

  turnInto(ids: string[], type: BlockType): void {
    this.flushAll()
    this.commit(turnIntoOps(this.tree, ids, type))
  }

  setColor(ids: string[], color: string | null): void {
    this.commit(ids.filter((id) => getBlock(id)).map((id): Op => ({ op: 'update', id, patch: { props: { color } } })))
  }

  indent(ids: string[]): void {
    this.flushAll()
    this.commit(indentOps(this.tree, ids))
  }

  outdent(ids: string[]): void {
    this.flushAll()
    this.commit(outdentOps(this.tree, ids))
  }

  moveBlocks(ids: string[], dir: -1 | 1): void {
    this.flushAll()
    this.commit(moveOps(this.tree, ids, dir))
  }

  duplicate(ids: string[]): void {
    paste.duplicate(this, ids)
  }

  deleteBlocks(ids: string[]): void {
    this.flushAll()
    const tops = topLevel(this.tree, ids)
    if (!tops.length) return
    const prev = prevVisible(this.tree, tops[0])
    const pb = prev ? getBlock(prev) : undefined
    let after: Sel = null
    if (prev && pb) after = prev === this.pageId || isEditable(pb) ? textSel(prev, END) : { kind: 'blocks', ids: [prev] }
    this.clearBlockSelection()
    this.commit(
      tops.map((id): Op => ({ op: 'delete', id })),
      { before: { kind: 'blocks', ids: tops }, after }
    )
  }

  /** Creates a block after `afterId` (or first in the page when null) and focuses it. */
  insertAfter(afterId: string | null, type: BlockType = 'text', props: BlockProps = {}): string {
    const ref = afterId ? getBlock(afterId) : undefined
    const id = newId()
    const editable = isTextType(type) || type === 'code'
    this.commit(
      [{ op: 'create', input: { id, type, parentId: ref?.parentId ?? this.pageId, afterId: ref ? ref.id : null, props } }],
      { after: editable ? textSel(id, 0) : { kind: 'blocks', ids: [id] } }
    )
    return id
  }

  /** Click below the last block: focus a trailing empty text block, creating it if needed. */
  focusTail(): void {
    const lastId = this.lastBlock()
    const last = lastId ? getBlock(lastId) : undefined
    if (last && last.type === 'text' && rtLength(last.props.title) === 0 && last.content.length === 0) {
      this.focusBlock(last.id, 0)
      return
    }
    const id = newId()
    this.commit([{ op: 'create', input: { id, type: 'text', parentId: this.pageId, afterId: lastId, props: {} } }], {
      after: textSel(id, 0)
    })
  }

  toggleChecked(id: string): void {
    const b = getBlock(id)
    if (b) this.update(id, { checked: !b.props.checked }, { silent: true })
  }

  toggleCollapsed(id: string): void {
    const b = getBlock(id)
    if (!b) return
    const collapsing = !b.props.collapsed
    // Collapsing hides the children: a caret inside them moves to the toggle itself.
    const focused = this.focusedKey()?.split(':')[0]
    if (collapsing && focused && isDescendant(this.tree, focused, id)) {
      this.flushAll()
      this.update(id, { collapsed: true }, { after: textSel(id, END) })
    } else this.update(id, { collapsed: collapsing }, { silent: true })
  }

  async pickImage(id: string): Promise<void> {
    try {
      const url = await window.api.files.pickImage()
      if (url && getBlock(id)) this.update(id, { url }, { silent: true })
    } catch (err) {
      console.error('[editor] pickImage failed', err)
    }
  }

  // ---- drag & drop, clipboard (see paste.ts) ----------------------------

  moveTo(ids: string[], drop: DropTarget): void {
    this.flushAll()
    const { ops, moved } = moveToOps(this.tree, ids, drop)
    if (ops.length) this.commit(ops, { after: { kind: 'blocks', ids: moved } })
  }

  dropFiles(files: File[], drop: DropTarget | null): Promise<void> {
    return paste.dropFiles(this, files, drop)
  }

  copyPayload(ids: string[]): { text: string; json: string } {
    return paste.copyPayload(this, ids)
  }

  handlePaste(dt: DataTransfer, targetId: string | null): boolean {
    return paste.handlePaste(this, dt, targetId)
  }

  // ---- typing hooks and slash menu (see typingHooks.ts) -----------------

  afterInput(id: string, rt: RichText, caret: number, data: string | null): boolean {
    return this.typing.afterInput(id, rt, caret, data)
  }

  closeSlash(): void {
    this.typing.closeSlash()
  }

  slashKey(key: string): boolean {
    return this.typing.slashKey(key)
  }

  closeSourcePicker(): void {
    this.typing.closeSourcePicker()
  }

  /** Inserts the database chosen in the source picker (a linked view, or a new database). */
  insertFromSourcePicker(props: BlockProps): void {
    this.typing.insertFromSourcePicker(props)
  }

  runSlash(item: SlashItem): void {
    this.typing.runSlash(item)
  }

  insertBelowWithSlash(id: string): void {
    this.typing.insertBelowWithSlash(id)
  }
}
