// Types shared by the editor controller, its helper modules and the components.
import type { UpdateBlockInput, ViewType } from '@shared/types'
import type { Offsets } from './richtext-dom'

/** Offset that every editable clamps to its end. */
export const END = Number.MAX_SAFE_INTEGER

/** Typing is committed to the store after this pause (and on blur, unmount or any command). */
export const TEXT_DEBOUNCE_MS = 300

export type PropsPatch = NonNullable<UpdateBlockInput['props']>

export type TextSel = { kind: 'text'; blockId: string; start: number; end: number }

export type Sel = TextSel | { kind: 'blocks'; ids: string[] } | null

export function textSel(blockId: string, start: number, end = start): TextSel {
  return { kind: 'text', blockId, start, end }
}

export interface TextRange {
  id: string
  start: number
  end: number
}

/** Something that can hold the caret: a block's contenteditable or a code textarea. */
export interface Focusable {
  el: HTMLElement
  /** Rich text block body (formatting toolbar applies). */
  rich: boolean
  /** Persist pending local edits now. */
  flush(): void
  /** Drop pending local edits and make the DOM match the model. */
  sync(): void
  getSel(): Offsets | null
  setSel(start: number, end: number): void
  /** Focus on the first/last line, as close as possible to viewport x. */
  focusAt(x: number | null, edge: 'top' | 'bottom'): void
}

export interface SlashState {
  blockId: string
  /** Offset where the text to remove starts (the '/' when `hasSlash`). */
  from: number
  hasSlash: boolean
  query: string
  index: number
  rect: DOMRect
}

/** The picker of source databases, opened by the slash item "Linked database view". */
export interface SourcePickerState {
  blockId: string
  /** The slash text to remove from the block once a source is chosen: [from, cut). */
  from: number
  cut: number
  rect: DOMRect
  /** The type of the single view the new linked view starts with (a table when absent). */
  view?: ViewType
}

export type DropPos = 'before' | 'after' | 'inside'

export interface DropTarget {
  id: string
  pos: DropPos
}

export interface UIState {
  /** Block selection, in document order. */
  selected: string[]
  anchor: string | null
  head: string | null
  slash: SlashState | null
  sourcePicker: SourcePickerState | null
  drop: DropTarget | null
  menu: { id: string; rect: DOMRect } | null
  /** Incremented to ask the selection toolbar to open its link editor. */
  linkRequest: number
}

export interface CommitOptions {
  before?: Sel
  after?: Sel
  /** History coalescing key (typing in one block). */
  key?: string
  /** Do not move the caret after applying (typing). */
  silent?: boolean
}

/** Where new blocks go. */
export interface Place {
  parentId: string
  afterId: string | null | undefined
  /** Empty block that the inserted content replaces. */
  replace?: string
}
