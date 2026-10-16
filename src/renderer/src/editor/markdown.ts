// Markdown shortcut detection and plain-text paste parsing. Pure; unit tested.
import type { BlockProps, BlockType, Mark, RichText } from '@shared/types'
import { addMark, normalize, replaceRange, slice, rtLength } from './richtext-dom'
import { sanitizeHref } from './sanitize'

export interface BlockShortcut {
  type: BlockType
  props?: BlockProps
}

/**
 * `before` is the block text from its start up to the caret, right after a key
 * was typed. Returns the block type to convert to when it is exactly a trigger.
 */
export function detectBlockShortcut(before: string): BlockShortcut | null {
  if (before === '# ') return { type: 'heading_1' }
  if (before === '## ') return { type: 'heading_2' }
  if (before === '### ') return { type: 'heading_3' }
  if (/^[-*+] $/.test(before)) return { type: 'bulleted_list' }
  if (/^\d{1,3}\. $/.test(before)) return { type: 'numbered_list' }
  if (/^\[ ?\] $/.test(before)) return { type: 'to_do', props: { checked: false } }
  if (/^\[x\] $/i.test(before)) return { type: 'to_do', props: { checked: true } }
  if (before === '>> ') return { type: 'toggle' }
  if (before === '> ' || before === '" ') return { type: 'quote' }
  if (before === '```') return { type: 'code' }
  if (before === '$$') return { type: 'equation' }
  if (before === '---') return { type: 'divider' }
  return null
}

export interface InlineShortcut {
  /** Offset of the opening delimiter. */
  start: number
  /** Offset just after the closing delimiter (the caret). */
  end: number
  delimLength: number
  mark: Mark
}

const INLINE_RULES: { d: string; mark: Mark }[] = [
  { d: '**', mark: ['b'] },
  { d: '~~', mark: ['s'] },
  { d: '`', mark: ['c'] },
  { d: '*', mark: ['i'] },
  { d: '_', mark: ['i'] }
]

/** Detects `**bold**`, `*italic*`, `_italic_`, `` `code` `` and `~~strike~~` ending at the caret. */
export function detectInlineShortcut(text: string, caret: number): InlineShortcut | null {
  const before = text.slice(0, caret)
  for (const { d, mark } of INLINE_RULES) {
    if (!before.endsWith(d)) continue
    const innerEnd = before.length - d.length
    const searchFrom = innerEnd - d.length - 1
    if (searchFrom < 0) continue
    const open = before.lastIndexOf(d, searchFrom)
    if (open < 0) continue
    const inner = before.slice(open + d.length, innerEnd)
    if (!inner || inner !== inner.trim() || inner.includes('\n')) continue
    if (d.length === 1) {
      // Not part of a longer run such as `**bold*`.
      if (inner.startsWith(d) || inner.endsWith(d) || before[open - 1] === d) continue
      // snake_case_words must not become italic.
      if (d === '_' && open > 0 && /\w/.test(before[open - 1])) continue
    }
    return { start: open, end: caret, delimLength: d.length, mark }
  }
  return null
}

/** Removes the delimiters and marks the text in between. Returns the new caret offset. */
export function applyInlineShortcut(rt: RichText, m: InlineShortcut): { rt: RichText; caret: number } {
  const inner = slice(rt, m.start + m.delimLength, m.end - m.delimLength)
  const marked = addMark(inner, 0, rtLength(inner), m.mark)
  return {
    rt: replaceRange(rt, m.start, m.end, marked),
    caret: m.end - 2 * m.delimLength
  }
}

const INLINE_RE =
  /\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|`([^`\n]+)`|\*([^*\s][^*\n]*?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g

/**
 * Lines longer than this are kept as plain text: the inline pattern backtracks on
 * unclosed delimiters, which is quadratic on a hostile megabyte-long line.
 */
export const MAX_INLINE_MARKDOWN_LENGTH = 10_000

/** Basic, non-nested inline Markdown used when pasting plain text. */
export function parseInlineMarkdown(text: string): RichText {
  if (text.length > MAX_INLINE_MARKDOWN_LENGTH) return text ? [[text]] : []
  const out: RichText = []
  let last = 0
  INLINE_RE.lastIndex = 0
  for (let m = INLINE_RE.exec(text); m; m = INLINE_RE.exec(text)) {
    if (m.index > last) out.push([text.slice(last, m.index)])
    if (m[1] !== undefined) out.push([m[1], [['b']]])
    else if (m[2] !== undefined) out.push([m[2], [['s']]])
    else if (m[3] !== undefined) out.push([m[3], [['c']]])
    else if (m[4] !== undefined) out.push([m[4], [['i']]])
    else if (m[5] !== undefined) {
      const href = sanitizeHref(m[6])
      out.push(href ? [m[5], [['a', href]]] : [m[0]])
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push([text.slice(last)])
  return normalize(out)
}

export interface ParsedBlock {
  type: BlockType
  title: RichText
  props?: BlockProps
}

/** One block per non-empty line, with basic Markdown block detection and fenced code. */
export function parseMarkdownBlocks(input: string): ParsedBlock[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const out: ParsedBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue
    const fence = /^```\s*([\w+#-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++])
      const code = body.join('\n')
      out.push({
        type: 'code',
        title: code ? [[code]] : [],
        props: fence[1] ? { language: fence[1].toLowerCase() } : undefined
      })
      continue
    }
    // Display math: `$$ … $$` on one line, or between `$$` lines. Unclosed, it stays text.
    if (line.startsWith('$$')) {
      const one = /^\$\$(.+?)\$\$$/.exec(line)
      let close = -1
      if (!one && line === '$$') for (let j = i + 1; j < lines.length && close < 0; j++) if (lines[j].trim() === '$$') close = j
      if (one || close > 0) {
        const tex = one ? one[1].trim() : lines.slice(i + 1, close).join('\n').trim()
        out.push({ type: 'equation', title: tex ? [[tex]] : [] })
        if (close > 0) i = close
        continue
      }
    }
    let m: RegExpExecArray | null
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) out.push({ type: 'divider', title: [] })
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      const type = (['heading_1', 'heading_2', 'heading_3'] as const)[m[1].length - 1]
      out.push({ type, title: parseInlineMarkdown(m[2]) })
    } else if ((m = /^(?:[-*+]\s+)?\[( |x|X)?\]\s+(.*)$/.exec(line))) {
      out.push({
        type: 'to_do',
        title: parseInlineMarkdown(m[2]),
        props: { checked: (m[1] ?? ' ').toLowerCase() === 'x' }
      })
    } else if ((m = /^[-*+]\s+(.*)$/.exec(line))) out.push({ type: 'bulleted_list', title: parseInlineMarkdown(m[1]) })
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) out.push({ type: 'numbered_list', title: parseInlineMarkdown(m[1]) })
    else if ((m = /^>\s?(.*)$/.exec(line))) out.push({ type: 'quote', title: parseInlineMarkdown(m[1]) })
    else out.push({ type: 'text', title: parseInlineMarkdown(line) })
  }
  return out
}
