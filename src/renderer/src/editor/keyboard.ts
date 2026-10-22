// Keyboard handling for a focused rich-text block.
import type { KeyboardEvent } from 'react'
import type { EditorController } from './controller'
import { caretRect, getSelectionOffsets } from './richtext-dom'
import { aiPromptAt, wantsAiPrompt } from '../ai/session'

/** A caret at least this close (px) to the box height means the editable has a single line. */
const SINGLE_LINE_TOLERANCE = 4
/** Fraction of the caret height within which it counts as being on the first/last line. */
const LINE_SLACK = 0.6
/** Keys that move the caret: text typed afterwards no longer gets the pending marks. */
const CARET_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/** Whether the caret sits on the first / last visual line of the editable. */
export function caretLine(el: HTMLElement): { first: boolean; last: boolean; x: number } {
  const box = el.getBoundingClientRect()
  const caret = caretRect(el)
  if (caret === box || caret.height === 0 || caret.height >= box.height - SINGLE_LINE_TOLERANCE) {
    return { first: true, last: true, x: caret === box ? box.left : caret.left }
  }
  const slack = caret.height * LINE_SLACK
  return { first: caret.top - box.top < slack, last: box.bottom - caret.bottom < slack, x: caret.left }
}

export function onBlockKeyDown(ctrl: EditorController, id: string, e: KeyboardEvent<HTMLElement>, el: HTMLElement): void {
  if (e.nativeEvent.isComposing) return
  const mod = e.ctrlKey || e.metaKey
  const key = e.key
  const lower = key.toLowerCase()

  const slash = ctrl.ui.getState().slash
  if (slash && slash.blockId === id && !mod && ctrl.slashKey(key)) {
    e.preventDefault()
    return
  }

  if (CARET_KEYS.has(key)) ctrl.clearPendingMarks()

  const o = getSelectionOffsets(el)
  if (!o) return
  const len = el.textContent?.length ?? 0
  const collapsed = o.start === o.end
  const stop = (): void => e.preventDefault()

  if (mod) {
    if (e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      stop()
      ctrl.moveBlocks([id], key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (e.shiftKey && lower === 's') {
      stop()
      ctrl.toggleMark(['s'])
      return
    }
    if (e.shiftKey || e.altKey) return
    switch (lower) {
      case 'b':
        stop()
        ctrl.toggleMark(['b'])
        return
      case 'i':
        stop()
        ctrl.toggleMark(['i'])
        return
      case 'u':
        stop()
        ctrl.toggleMark(['u'])
        return
      case 'e':
        stop()
        ctrl.toggleMark(['c'])
        return
      case 'k':
        // A link needs selected text; without any, Ctrl+K is left to the shell (the command palette).
        if (collapsed) return
        stop()
        ctrl.requestLink()
        return
      case 'd':
        stop()
        ctrl.duplicate([id])
        return
      case 'a':
        // First Ctrl+A selects the block text (native); the second selects every block.
        if (o.start === 0 && o.end === len) {
          stop()
          ctrl.selectAll()
        }
        return
    }
    return
  }
  if (e.altKey) {
    if (key === 'F10' && !e.shiftKey && ctrl.requestToolbar()) stop()
    return
  }

  switch (key) {
    case ' ':
      // Space as the first key in an empty paragraph asks AI to write; any other key just types.
      if (!e.shiftKey && len === 0 && !slash && wantsAiPrompt(id)) {
        stop()
        aiPromptAt(ctrl, id)
      }
      return
    case 'Enter':
      stop()
      if (e.shiftKey) ctrl.insertPlain(id, o.start, o.end, '\n')
      else ctrl.split(id, o.start, o.end)
      return
    case 'Backspace':
      if (collapsed && o.start === 0) {
        stop()
        ctrl.backspaceAtStart(id)
      }
      return
    case 'Delete':
      if (collapsed && o.start === len) {
        stop()
        ctrl.deleteAtEnd(id)
      }
      return
    case 'Tab':
      stop()
      if (e.shiftKey) ctrl.outdent([id])
      else ctrl.indent([id])
      return
    case 'Escape':
      stop()
      ctrl.selectBlocks([id])
      return
    case 'ArrowUp':
    case 'ArrowDown': {
      if (e.shiftKey) return
      const line = caretLine(el)
      const up = key === 'ArrowUp'
      if ((up && line.first) || (!up && line.last)) {
        if (ctrl.moveVertical(id, up ? -1 : 1, line.x)) stop()
      }
      return
    }
    case 'ArrowLeft':
      if (!e.shiftKey && collapsed && o.start === 0 && ctrl.moveHorizontal(id, -1)) stop()
      return
    case 'ArrowRight':
      if (!e.shiftKey && collapsed && o.start === len && ctrl.moveHorizontal(id, 1)) stop()
      return
  }
}
