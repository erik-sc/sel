// Reactions to typing in a rich-text block: pending marks, Markdown shortcuts
// and the slash menu.
import type { Block, BlockProps, BlockType, Mark, Op, RichText } from '@shared/types'
import { getBlock, newId } from '@/store/blocks'
import type { EditorController } from './controller'
import { defaultDatabaseProps, filterSlashItems, type SlashItem } from './blockTypes'
import { caretRect, marksAt, replaceRange, rtLength, textOf } from './richtext-dom'
import { prevSibling, turnIntoPatch } from './structure'
import { applyPendingMarks, blockShortcutOps, inlineShortcut, toggleMarkIn, type PendingMarks } from './typing'
import { textSel, type Sel } from './types'
import { aiEnabled } from '../ai/gate'
import { aiFromSlash } from '../ai/session'
import { newMeeting } from '../meetings/gate'

/** The slash menu closes once the query is this long... */
const SLASH_MAX_QUERY = 24
/** ...or after this many characters that match no item. */
const SLASH_MAX_UNMATCHED = 5
/** Wait for the block created by the "+" handle to mount and take focus. */
const SLASH_OPEN_DELAY_MS = 40

export class TypingHooks {
  private pendingMarks: PendingMarks | null = null
  private slashTimer = 0

  constructor(private readonly ctrl: EditorController) {}

  // ---- pending marks ----------------------------------------------------

  /** Ctrl+B and friends with a collapsed caret: the next typed text gets (or loses) the mark. */
  togglePendingMark(id: string, caret: number, mark: Mark): void {
    const p = this.pendingMarks
    const current = p && p.id === id && p.at === caret ? p.marks : marksAt(getBlock(id)?.props.title, caret)
    this.pendingMarks = { id, at: caret, marks: toggleMarkIn(current, mark) }
  }

  /** The caret moved or the block lost focus: typing goes back to inheriting marks. */
  clearPendingMarks(): void {
    this.pendingMarks = null
  }

  // ---- input ------------------------------------------------------------

  /**
   * Called after every text input in a block, with the block's live content
   * (already handed to the editable as its pending edit) and the text that was
   * inserted, if any. Returns true when the content was rewritten.
   */
  afterInput(id: string, rt: RichText, caret: number, data: string | null): boolean {
    const { ctrl } = this
    const pending = this.pendingMarks
    this.pendingMarks = null
    const b = getBlock(id)
    if (!b) return false
    const slash = ctrl.ui.getState().slash
    if (slash && slash.blockId === id) {
      this.updateSlash(textOf(rt), caret)
      return false
    }
    if (!data) return false
    if (pending && pending.id === id && caret === pending.at + data.length) {
      const title = applyPendingMarks(rt, pending.at, caret, pending.marks)
      if (title) {
        // Part of the typing: same history key, so it coalesces with the keystrokes around it.
        ctrl.update(id, { title }, { after: textSel(id, caret), key: `text:${id}` })
        return true
      }
    }
    if (data.length !== 1) return false
    if (data === '/') {
      const f = ctrl.focusable(id)
      if (f && textOf(rt)[caret - 1] === '/') this.openSlash(id, caret - 1, true, caretRect(f.el))
      return false
    }
    const blockOps = blockShortcutOps(b, rt, caret, data, prevSibling(ctrl.tree, id), newId)
    if (blockOps) {
      // Commit what was typed first, so undo brings the literal text back.
      ctrl.flush(id)
      ctrl.commit(blockOps, { after: textSel(id, 0) })
      return true
    }
    const inline = inlineShortcut(rt, caret, data)
    if (inline) {
      ctrl.flush(id)
      ctrl.update(id, { title: inline.rt }, { after: textSel(id, inline.caret) })
      this.pendingMarks = { id, at: inline.caret, marks: inline.next }
      return true
    }
    return false
  }

  // ---- slash menu -------------------------------------------------------

  openSlash(blockId: string, from: number, hasSlash: boolean, rect: DOMRect): void {
    this.ctrl.ui.setState({ slash: { blockId, from, hasSlash, query: '', index: 0, rect } })
  }

  closeSlash(): void {
    if (this.ctrl.ui.getState().slash) this.ctrl.ui.setState({ slash: null })
  }

  private updateSlash(text: string, caret: number): void {
    const s = this.ctrl.ui.getState().slash
    if (!s) return
    const qStart = s.from + (s.hasSlash ? 1 : 0)
    if (caret < qStart || (s.hasSlash && text[s.from] !== '/')) return this.closeSlash()
    const query = text.slice(qStart, caret)
    const none = filterSlashItems(query, aiEnabled()).length === 0
    if (query.includes('\n') || query.length > SLASH_MAX_QUERY || (none && (query.length > SLASH_MAX_UNMATCHED || !s.hasSlash))) {
      return this.closeSlash()
    }
    this.ctrl.ui.setState({ slash: { ...s, query, index: 0 } })
  }

  /** Keyboard handling while the slash menu is open. Returns true when the key was consumed. */
  slashKey(key: string): boolean {
    const s = this.ctrl.ui.getState().slash
    if (!s) return false
    const items = filterSlashItems(s.query, aiEnabled())
    if (key === 'Escape') {
      this.closeSlash()
      return true
    }
    if (!items.length) return false
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const index = (s.index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      this.ctrl.ui.setState({ slash: { ...s, index } })
      return true
    }
    if (key === 'Enter') {
      this.runSlash(items[Math.min(s.index, items.length - 1)])
      return true
    }
    return false
  }

  runSlash(item: SlashItem): void {
    const { ctrl } = this
    const s = ctrl.ui.getState().slash
    if (!s) return
    this.closeSlash()
    const id = s.blockId
    ctrl.flush(id)
    const b = getBlock(id)
    if (!b || !b.parentId) return
    const cut = s.from + (s.hasSlash ? 1 : 0) + s.query.length
    const cleaned = replaceRange(b.props.title, s.from, cut, [])
    if (item.kind === 'ai') {
      // The slash text goes (its own undo step); what the action writes waits for the user's Accept.
      if (rtLength(cleaned) !== rtLength(b.props.title)) ctrl.update(id, { title: cleaned }, { after: textSel(id, s.from) })
      if (item.ai) aiFromSlash(ctrl, item.ai, id, s.from)
      return
    }
    if (item.kind === 'meeting') {
      // The slash text goes; the meeting is a page of its own in the Meetings database.
      if (rtLength(cleaned) !== rtLength(b.props.title)) ctrl.update(id, { title: cleaned }, { after: textSel(id, s.from) })
      void newMeeting()
      return
    }
    if (item.kind === 'turn') {
      ctrl.commit([{ op: 'update', id, patch: { type: item.type, props: turnIntoPatch(b, item.type, cleaned) } }], {
        after: textSel(id, s.from)
      })
      return
    }
    if (item.linked) {
      // Nothing changes yet: the block keeps its slash text until a source is chosen,
      // so closing the picker leaves the document exactly as it was.
      ctrl.ui.setState({ sourcePicker: { blockId: id, from: s.from, cut, rect: s.rect, view: item.view } })
      return
    }
    let props: BlockProps = {}
    if (item.type === 'database') props = defaultDatabaseProps(item.view ?? 'table', newId)
    else if (item.type === 'page') props = { title: [] }
    const id2 = this.insertBlock(b, cleaned, item.type, props)
    if (item.type === 'page') ctrl.onOpenPage(id2)
  }

  /**
   * Inserts a new block after `b`, whose text becomes `cleaned` (the slash query
   * removed); an empty text block is replaced instead. Returns the new block's id.
   */
  private insertBlock(b: Block, cleaned: RichText, type: BlockType, props: BlockProps): string {
    const { ctrl } = this
    const id = b.id
    const id2 = newId()
    const ops: Op[] = [{ op: 'create', input: { id: id2, type, parentId: b.parentId, afterId: id, props } }]
    const replace = b.type === 'text' && rtLength(cleaned) === 0 && b.content.length === 0
    if (replace) ops.push({ op: 'delete', id })
    else ops.unshift({ op: 'update', id, patch: { props: { title: cleaned } } })
    let after: Sel = { kind: 'blocks', ids: [id2] }
    if (type === 'divider') {
      const id3 = newId()
      ops.push({ op: 'create', input: { id: id3, type: 'text', parentId: b.parentId, afterId: id2, props: {} } })
      after = textSel(id3, 0)
    }
    ctrl.commit(ops, { after })
    return id2
  }

  // ---- source picker ("Linked database view") --------------------------------

  closeSourcePicker(): void {
    if (this.ctrl.ui.getState().sourcePicker) this.ctrl.ui.setState({ sourcePicker: null })
  }

  /**
   * A source was chosen in the picker (or "create a new database instead"): removes the
   * slash text and inserts the database block in one undoable step. `props` describes a
   * linked view (`sourceId` and its views); without them a new database is created.
   */
  insertFromSourcePicker(props: BlockProps): void {
    const { ctrl } = this
    const picker = ctrl.ui.getState().sourcePicker
    if (!picker) return
    this.closeSourcePicker()
    ctrl.flush(picker.blockId)
    const b = getBlock(picker.blockId)
    if (!b || !b.parentId) return
    // The block was not editable while the picker had the focus; clamp all the same.
    const length = rtLength(b.props.title)
    const cleaned = replaceRange(b.props.title, Math.min(picker.from, length), Math.min(picker.cut, length), [])
    this.insertBlock(b, cleaned, 'database', props.sourceId ? props : defaultDatabaseProps('table', newId))
  }

  /** The "+" handle: add an empty block below and open the slash menu on it. */
  insertBelowWithSlash(id: string): void {
    const { ctrl } = this
    ctrl.flushAll()
    const b = getBlock(id)
    if (!b) return
    const reuse = b.type === 'text' && rtLength(b.props.title) === 0
    const target = reuse ? id : ctrl.insertAfter(id, 'text')
    if (reuse) ctrl.focusBlock(id, 0)
    if (this.slashTimer) window.clearTimeout(this.slashTimer)
    this.slashTimer = window.setTimeout(() => {
      this.slashTimer = 0
      const f = ctrl.focusable(target)
      // Only when that block really got the caret; the menu follows the focused block.
      if (f && ctrl.focusedKey() === target) this.openSlash(target, 0, false, caretRect(f.el))
    }, SLASH_OPEN_DELAY_MS)
  }

  dispose(): void {
    this.closeSourcePicker()
    if (this.slashTimer) window.clearTimeout(this.slashTimer)
    this.slashTimer = 0
    this.pendingMarks = null
  }
}
