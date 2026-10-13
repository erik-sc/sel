// What typing triggers besides inserting a character: pending marks and
// Markdown shortcuts. Pure; unit tested.
import type { Block, Mark, Op, RichText } from '@shared/types'
import { applyInlineShortcut, detectBlockShortcut, detectInlineShortcut } from './markdown'
import { concat, markKind, marksAt, marksEqual, normalizeMarks, slice, textOf } from './richtext-dom'

/**
 * Marks for the next text typed at `at` in block `id`, overriding what the DOM
 * would inherit from the neighbouring character. Set by a formatting shortcut
 * with a collapsed caret (Ctrl+B, then type) and after an inline Markdown
 * shortcut (the text after `**bold**` continues unformatted).
 */
export interface PendingMarks {
  id: string
  at: number
  marks: Mark[]
}

/** Adds the mark, or removes the mark of the same kind when it is already there. */
export function toggleMarkIn(marks: readonly Mark[], mark: Mark): Mark[] {
  const kind = markKind(mark)
  const rest = marks.filter((m) => markKind(m) !== kind)
  return normalizeMarks(rest.length === marks.length ? [...rest, mark] : rest)
}

/**
 * Gives the text typed in [at, caret) exactly `marks`. Returns null when it
 * already has them (nothing to rewrite) or when the range is empty.
 */
export function applyPendingMarks(rt: RichText, at: number, caret: number, marks: readonly Mark[]): RichText | null {
  if (at < 0 || caret <= at) return null
  const typed = slice(rt, at, caret)
  const text = textOf(typed)
  if (text.length !== caret - at) return null
  if (typed.every((s) => marksEqual(s[1], [...marks]))) return null
  return concat(slice(rt, 0, at), [marks.length ? [text, [...marks]] : [text]], slice(rt, caret))
}

/** Characters that can complete a block shortcut such as `# `, `- `, ``` or `---`. */
const BLOCK_TRIGGERS = ' `-'
/** Characters that can close an inline shortcut such as `**bold**`. */
const INLINE_TRIGGERS = '*`~_'

/**
 * Ops for a block-level Markdown shortcut completed by typing `data` at `caret`
 * in the text block `b`, whose live content is `rt`. Null when nothing matches.
 */
export function blockShortcutOps(
  b: Block,
  rt: RichText,
  caret: number,
  data: string,
  prevSiblingId: string | null,
  newId: () => string
): Op[] | null {
  if (b.type !== 'text' || !b.parentId || !BLOCK_TRIGGERS.includes(data)) return null
  const sc = detectBlockShortcut(textOf(rt).slice(0, caret))
  if (!sc) return null
  const rest = slice(rt, caret)
  if (sc.type === 'divider') {
    return [
      { op: 'create', input: { id: newId(), type: 'divider', parentId: b.parentId, afterId: prevSiblingId, props: {} } },
      { op: 'update', id: b.id, patch: { props: { title: rest } } }
    ]
  }
  if (sc.type === 'code') {
    const plain = textOf(rest)
    return [{ op: 'update', id: b.id, patch: { type: 'code', props: { title: plain ? [[plain]] : [] } } }]
  }
  return [{ op: 'update', id: b.id, patch: { type: sc.type, props: { ...sc.props, title: rest } } }]
}

export interface InlineShortcutResult {
  rt: RichText
  caret: number
  /** Marks the text typed next must carry: those of the formatted run minus the new one. */
  next: Mark[]
}

/** Applies an inline Markdown shortcut closed by typing `data` at `caret`, if any. */
export function inlineShortcut(rt: RichText, caret: number, data: string): InlineShortcutResult | null {
  if (!INLINE_TRIGGERS.includes(data)) return null
  // Inside inline code the delimiters are literal.
  if (marksAt(rt, caret - 1).some((m) => markKind(m) === 'c')) return null
  const m = detectInlineShortcut(textOf(rt), caret)
  if (!m) return null
  const r = applyInlineShortcut(rt, m)
  const kind = markKind(m.mark)
  // What the run carried before the shortcut: the marks of the opening delimiter.
  const next = marksAt(rt, m.start + 1).filter((x) => markKind(x) !== kind)
  return { rt: r.rt, caret: r.caret, next }
}
