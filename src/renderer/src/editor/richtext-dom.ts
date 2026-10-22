// Rich text helpers. The first half is pure (no DOM) and unit tested; the second
// half converts between the RichText model and the contenteditable DOM.
import type { Mark, RichText, Span } from '@shared/types'
import { parsePageLink } from '@shared/pageLink'
import { sanitizeLink } from './sanitize'

export const COLOR_NAMES = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const

const BACKGROUND_SUFFIX = '_background'
const KIND_ORDER = ['b', 'i', 'u', 's', 'c', 'a', 'h', 'hb']

/** Marks are unique per kind. Text colour ('h') and background ('hb') are separate kinds. */
export function markKind(m: Mark): string {
  return m[0] === 'h' && m[1].endsWith(BACKGROUND_SUFFIX) ? 'hb' : m[0]
}

export function normalizeMarks(marks: Mark[] | undefined | null): Mark[] {
  if (!marks || marks.length === 0) return []
  const byKind = new Map<string, Mark>()
  for (const m of marks) byKind.set(markKind(m), m)
  return [...byKind.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0])).map((e) => e[1])
}

function marksKey(marks: Mark[] | undefined | null): string {
  return normalizeMarks(marks)
    .map((m) => (m.length > 1 ? `${m[0]}\u0000${m[1]}` : m[0]))
    .join('\u0001')
}

export function marksEqual(a?: Mark[] | null, b?: Mark[] | null): boolean {
  return marksKey(a) === marksKey(b)
}

function mk(text: string, marks: Mark[]): Span {
  return marks.length ? [text, marks] : [text]
}

/** Drops empty spans, canonicalises marks and merges neighbours with equal marks. */
export function normalize(rt: RichText | undefined | null): RichText {
  const out: RichText = []
  let lastKey = ''
  for (const span of rt ?? []) {
    const text = span[0]
    if (!text) continue
    const marks = normalizeMarks(span[1])
    const key = marksKey(marks)
    const last = out[out.length - 1]
    if (last && key === lastKey) last[0] += text
    else {
      out.push(mk(text, marks))
      lastKey = key
    }
  }
  return out
}

export function textOf(rt: RichText | undefined | null): string {
  let s = ''
  for (const span of rt ?? []) s += span[0]
  return s
}

export function rtLength(rt: RichText | undefined | null): number {
  let n = 0
  for (const span of rt ?? []) n += span[0].length
  return n
}

export function richTextEqual(a: RichText | undefined | null, b: RichText | undefined | null): boolean {
  const x = normalize(a)
  const y = normalize(b)
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) {
    if (x[i][0] !== y[i][0] || !marksEqual(x[i][1], y[i][1])) return false
  }
  return true
}

export function slice(rt: RichText | undefined | null, start: number, end = Infinity): RichText {
  const out: RichText = []
  let pos = 0
  for (const [text, marks] of rt ?? []) {
    const from = Math.max(start, pos)
    const to = Math.min(end, pos + text.length)
    if (to > from) out.push(mk(text.slice(from - pos, to - pos), normalizeMarks(marks)))
    pos += text.length
    if (pos >= end) break
  }
  return normalize(out)
}

export function split(rt: RichText | undefined | null, offset: number): [RichText, RichText] {
  return [slice(rt, 0, offset), slice(rt, offset)]
}

export function concat(...parts: (RichText | undefined | null)[]): RichText {
  const all: RichText = []
  for (const p of parts) for (const s of p ?? []) all.push(s)
  return normalize(all)
}

export function replaceRange(rt: RichText | undefined | null, start: number, end: number, insert: RichText): RichText {
  return concat(slice(rt, 0, start), insert, slice(rt, Math.max(start, end)))
}

/** Marks of the character before `offset` (or of the first character at offset 0). */
export function marksAt(rt: RichText | undefined | null, offset: number): Mark[] {
  let pos = 0
  const spans = normalize(rt)
  for (const [text, marks] of spans) {
    if (offset > pos && offset <= pos + text.length) return marks ?? []
    pos += text.length
  }
  return offset === 0 && spans.length ? (spans[0][1] ?? []) : []
}

/** Inserts plain text, inheriting the marks at the insertion point unless given. */
export function insertText(rt: RichText | undefined | null, offset: number, text: string, marks?: Mark[]): RichText {
  return replaceRange(rt, offset, offset, [mk(text, marks ?? marksAt(rt, offset))])
}

/** True when every character in [start, end) carries a mark of this kind. */
export function rangeHasMark(rt: RichText | undefined | null, start: number, end: number, kind: string): boolean {
  const part = slice(rt, start, end)
  if (part.length === 0) return false
  return part.every((s) => (s[1] ?? []).some((m) => markKind(m) === kind))
}

/** Value of the mark of `kind` at the start of the range (link href / colour name). */
export function markValueAt(rt: RichText | undefined | null, start: number, end: number, kind: string): string | null {
  for (const s of slice(rt, start, end)) {
    const m = (s[1] ?? []).find((x) => markKind(x) === kind)
    if (m) return m[1] ?? ''
  }
  return null
}

export function addMark(rt: RichText | undefined | null, start: number, end: number, mark: Mark): RichText {
  if (end <= start) return normalize(rt)
  const kind = markKind(mark)
  const mid = slice(rt, start, end).map(([t, ms]): Span => [t, [...(ms ?? []).filter((m) => markKind(m) !== kind), mark]])
  return concat(slice(rt, 0, start), mid, slice(rt, end))
}

export function removeMark(rt: RichText | undefined | null, start: number, end: number, kind: string): RichText {
  if (end <= start) return normalize(rt)
  const mid = slice(rt, start, end).map(
    ([t, ms]): Span =>
      mk(
        t,
        (ms ?? []).filter((m) => markKind(m) !== kind)
      )
  )
  return concat(slice(rt, 0, start), mid, slice(rt, end))
}

/** Removes the mark when the whole range already has it, otherwise applies it. */
export function toggleMark(rt: RichText | undefined | null, start: number, end: number, mark: Mark): RichText {
  const kind = markKind(mark)
  return rangeHasMark(rt, start, end, kind) ? removeMark(rt, start, end, kind) : addMark(rt, start, end, mark)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Escaped HTML for the system clipboard (`text/html`). Never used to build the editor DOM. */
export function toHtml(rt: RichText | undefined | null): string {
  let out = ''
  for (const [text, marks] of normalize(rt)) {
    let html = escapeHtml(text).replace(/\n/g, '<br>')
    for (const m of [...(marks ?? [])].reverse()) {
      if (m[0] === 'b') html = `<strong>${html}</strong>`
      else if (m[0] === 'i') html = `<em>${html}</em>`
      else if (m[0] === 'u') html = `<u>${html}</u>`
      else if (m[0] === 's') html = `<s>${html}</s>`
      else if (m[0] === 'c') html = `<code>${html}</code>`
      else if (m[0] === 'a') {
        const href = sanitizeLink(m[1])
        if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`
      }
    }
    out += html
  }
  return out
}

/** Splits a colour mark value into its palette name and whether it is a background. */
function colorOf(value: string): { name: string; background: boolean } | null {
  const background = value.endsWith(BACKGROUND_SUFFIX)
  const name = background ? value.slice(0, -BACKGROUND_SUFFIX.length) : value
  return (COLOR_NAMES as readonly string[]).includes(name) ? { name, background } : null
}

/** True for a palette colour name, optionally with the `_background` suffix. */
export function isColorValue(value: unknown): value is string {
  return typeof value === 'string' && colorOf(value) !== null
}

/**
 * Validates marks coming from untrusted data (clipboard JSON, `data-m` attributes,
 * blocks written by another window). Unknown kinds are dropped, link targets must
 * pass `sanitizeLink` and colours must be palette names.
 */
export function parseMarks(value: unknown): Mark[] {
  if (!Array.isArray(value)) return []
  const out: Mark[] = []
  for (const m of value) {
    if (!Array.isArray(m)) continue
    const k: unknown = m[0]
    const v: unknown = m[1]
    if (k === 'b' || k === 'i' || k === 'u' || k === 's' || k === 'c') out.push([k])
    else if (k === 'a' && typeof v === 'string') {
      const href = sanitizeLink(v)
      if (href) out.push(['a', href])
    } else if (k === 'h' && isColorValue(v)) out.push(['h', v])
  }
  return normalizeMarks(out)
}

/** Validates rich text coming from untrusted data. Idempotent on clean input. */
export function parseRichText(value: unknown): RichText {
  if (!Array.isArray(value)) return []
  const out: RichText = []
  for (const s of value) {
    if (!Array.isArray(s)) continue
    const text: unknown = s[0]
    if (typeof text === 'string') out.push(mk(text, parseMarks(s[1])))
  }
  return normalize(out)
}

/** CSS classes for a span, derived from its marks. */
export function classesForMarks(marks: Mark[]): string[] {
  const out: string[] = []
  for (const m of marks) {
    if (m[0] === 'h') {
      const color = colorOf(m[1])
      if (color) out.push(color.background ? `rt-bg-${color.name}` : `rt-fg-${color.name}`)
    } else if (m[0] === 'a') out.push('rt-a')
    else out.push(`rt-${m[0]}`)
  }
  return out
}

/** CSS class for a block colour (`props.color`), or '' when it is not a palette colour. */
export function blockColorClass(value: string | undefined | null): string {
  const color = value ? colorOf(value) : null
  if (!color) return ''
  return color.background ? `blk-bg-${color.name}` : `blk-fg-${color.name}`
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/** `span` must already be validated (see `parseRichText`): its marks are written to `data-m`. */
function spanToNode(doc: Document, span: Span): Node {
  const marks = span[1] ?? []
  if (marks.length === 0) return doc.createTextNode(span[0])
  const link = marks.find((m) => m[0] === 'a')
  const href = link ? link[1] : null
  const el = doc.createElement(href ? 'a' : 'span')
  if (href) {
    el.setAttribute('href', href)
    el.setAttribute('rel', 'noreferrer noopener')
    el.setAttribute('title', parsePageLink(href) ? 'Page link (Ctrl+click)' : `${href} (Ctrl+click)`)
  }
  el.className = classesForMarks(marks).join(' ')
  el.setAttribute('data-m', JSON.stringify(marks))
  el.setAttribute('spellcheck', marks.some((m) => m[0] === 'c') ? 'false' : 'true')
  el.textContent = span[0]
  return el
}

/**
 * Rebuilds the element's children from the model by creating nodes; HTML strings are
 * never parsed. The model is validated first, so an unsafe link or an unknown mark
 * stored by another writer never reaches the DOM.
 */
export function renderInto(el: HTMLElement, rt: RichText | undefined | null): void {
  const doc = el.ownerDocument
  const frag = doc.createDocumentFragment()
  const spans = parseRichText(rt)
  for (const span of spans) frag.appendChild(spanToNode(doc, span))
  // A trailing newline is not rendered by the browser unless something follows it.
  if (spans.length && spans[spans.length - 1][0].endsWith('\n')) frag.appendChild(doc.createElement('br'))
  el.replaceChildren(frag)
}

function marksOfElement(el: Element): Mark[] {
  const data = el.getAttribute('data-m')
  if (data) {
    try {
      return parseMarks(JSON.parse(data))
    } catch {
      return []
    }
  }
  switch (el.tagName) {
    case 'B':
    case 'STRONG':
      return [['b']]
    case 'I':
    case 'EM':
      return [['i']]
    case 'U':
      return [['u']]
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return [['s']]
    case 'CODE':
      return [['c']]
    case 'A': {
      const href = sanitizeLink(el.getAttribute('href'))
      return href ? [['a', href]] : []
    }
    default:
      return []
  }
}

/** Browsers insert non-breaking spaces to keep consecutive/trailing spaces visible. */
const NBSP = /\u00a0/g
const TEXT_NODE = 3
const ELEMENT_NODE = 1
const SHOW_TEXT = 4

/** Serialises the editable's DOM back into the model. `<br>` elements are ignored. */
export function domToRichText(root: Node): RichText {
  const out: RichText = []
  const walk = (node: Node, marks: Mark[]): void => {
    if (node.nodeType === TEXT_NODE) {
      const t = (node.nodeValue ?? '').replace(NBSP, ' ')
      if (t) out.push(mk(t, marks))
      return
    }
    if (node.nodeType !== ELEMENT_NODE) return
    const el = node as Element
    if (el.tagName === 'BR') return
    const next = node === root ? marks : [...marks, ...marksOfElement(el)]
    el.childNodes.forEach((c) => walk(c, next))
  }
  walk(root, [])
  return normalize(out)
}

export interface Offsets {
  start: number
  end: number
}

function offsetOf(el: HTMLElement, node: Node, offset: number): number {
  const r = el.ownerDocument.createRange()
  r.selectNodeContents(el)
  r.setEnd(node, offset)
  return r.toString().length
}

/** Current selection as plain-text offsets, or null when it is not inside `el`. */
export function getSelectionOffsets(el: HTMLElement): Offsets | null {
  const sel = el.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null
  return {
    start: offsetOf(el, range.startContainer, range.startOffset),
    end: offsetOf(el, range.endContainer, range.endOffset)
  }
}

function pointAt(el: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = el.ownerDocument.createTreeWalker(el, SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let last: Text | null = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (remaining <= t.length) return { node: t, offset: remaining }
    remaining -= t.length
    last = t
  }
  if (last) return { node: last, offset: last.length }
  return { node: el, offset: 0 }
}

export function setSelectionOffsets(el: HTMLElement, start: number, end: number = start): void {
  const sel = el.ownerDocument.getSelection()
  if (!sel) return
  const a = pointAt(el, start)
  const b = end === start ? a : pointAt(el, end)
  const range = el.ownerDocument.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Rectangle of the selection focus inside `el`; falls back to the element box. */
export function caretRect(el: HTMLElement): DOMRect {
  const sel = el.ownerDocument.getSelection()
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0).cloneRange()
    if (el.contains(range.startContainer)) {
      range.collapse(sel.focusNode === range.startContainer && sel.focusOffset === range.startOffset)
      const rects = range.getClientRects()
      if (rects.length) return rects[0]
      const box = range.getBoundingClientRect()
      if (box.height) return box
    }
  }
  return el.getBoundingClientRect()
}

/** Rectangle covering the whole current selection. */
export function selectionRect(el: HTMLElement): DOMRect | null {
  const sel = el.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return null
  const box = range.getBoundingClientRect()
  return box.width || box.height ? box : null
}
