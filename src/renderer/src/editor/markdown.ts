// Markdown shortcut detection and plain-text paste parsing. Pure; unit tested.
import type { BlockProps, BlockType, Mark, RichText } from '@shared/types'
import { addMark, normalize, replaceRange, slice, rtLength } from './richtext-dom'
import { sanitizeLink } from './sanitize'
import type { ClipNode } from './clipboard'

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

/** `**b**`, `__b__`, `~~s~~`, `` `c` ``, `*i*`, `_i_` (not inside snake_case words) and `[text](url)`. */
const INLINE_RE =
  /\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|`([^`\n]+)`|\*([^*\s][^*\n]*?)\*|(?<![\p{L}\p{N}_])_([^_\s][^_\n]*?)_(?![\p{L}\p{N}_])|\[([^\]\n]+)\]\(([^)\s]+)\)/gu

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
    const bold = m[1] ?? m[2]
    const italic = m[5] ?? m[6]
    if (bold !== undefined) out.push([bold, [['b']]])
    else if (m[3] !== undefined) out.push([m[3], [['s']]])
    else if (m[4] !== undefined) out.push([m[4], [['c']]])
    else if (italic !== undefined) out.push([italic, [['i']]])
    else if (m[7] !== undefined) {
      const href = sanitizeLink(m[8])
      out.push(href ? [m[7], [['a', href]]] : [m[0]])
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

/** How many columns a tab stands for when list items are nested by indentation. */
const TAB_WIDTH = 4
/** Pasted lists nest at most this deep (the clipboard's own bound). */
const MAX_LIST_DEPTH = 31

const LIST_TYPES: ReadonlySet<BlockType> = new Set(['bulleted_list', 'numbered_list', 'to_do'])

/** A parsed block and the indentation of the line it came from. */
interface ParsedLine extends ParsedBlock {
  indent: number
}

/** The block for one trimmed line that is not part of a fence or a quote. */
function lineBlock(line: string): ParsedBlock {
  let m: RegExpExecArray | null
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return { type: 'divider', title: [] }
  if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
    const type = (['heading_1', 'heading_2', 'heading_3'] as const)[Math.min(3, m[1].length) - 1]
    return { type, title: parseInlineMarkdown(m[2]) }
  }
  if ((m = /^(?:[-*+]\s+)?\[( |x|X)?\]\s+(.*)$/.exec(line))) {
    return { type: 'to_do', title: parseInlineMarkdown(m[2]), props: { checked: (m[1] ?? ' ').toLowerCase() === 'x' } }
  }
  if ((m = /^[-*+]\s+(.*)$/.exec(line))) return { type: 'bulleted_list', title: parseInlineMarkdown(m[1]) }
  if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) return { type: 'numbered_list', title: parseInlineMarkdown(m[1]) }
  return { type: 'text', title: parseInlineMarkdown(line) }
}

/**
 * The blocks of a pasted text, each with its line's indentation: one block per non-empty
 * line, except that a fence makes one code block and consecutive `>` lines one quote.
 */
function parseLines(input: string): ParsedLine[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const out: ParsedLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\t/g, ' '.repeat(TAB_WIDTH))
    const line = raw.trim()
    if (!line) continue
    const indent = raw.length - raw.trimStart().length
    const fence = /^```\s*([\w+#-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      const pad = ' '.repeat(indent)
      // The fence's own indentation (a code block inside a list item) is not part of the code.
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++)
        body.push(lines[i].startsWith(pad) ? lines[i].slice(indent) : lines[i].trimStart())
      const code = body.join('\n')
      out.push({
        type: 'code',
        title: code ? [[code]] : [],
        props: fence[1] ? { language: fence[1].toLowerCase() } : undefined,
        indent
      })
      continue
    }
    // Display math: `$$ … $$` on one line, or between `$$` lines. Unclosed, it stays text.
    if (line.startsWith('$$')) {
      const one = /^\$\$(.+?)\$\$$/.exec(line)
      let close = -1
      if (!one && line === '$$') for (let j = i + 1; j < lines.length && close < 0; j++) if (lines[j].trim() === '$$') close = j
      if (one || close > 0) {
        const tex = one
          ? one[1].trim()
          : lines
              .slice(i + 1, close)
              .join('\n')
              .trim()
        out.push({ type: 'equation', title: tex ? [[tex]] : [], indent })
        if (close > 0) i = close
        continue
      }
    }
    if (line.startsWith('>')) {
      const body: string[] = []
      for (; i < lines.length && lines[i].trim().startsWith('>'); i++) body.push(lines[i].trim().replace(/^>\s?/, ''))
      i--
      out.push({ type: 'quote', title: parseInlineMarkdown(body.join('\n').trim()), indent })
      continue
    }
    out.push({ ...lineBlock(line), indent })
  }
  return out
}

/** One block per non-empty line, with basic Markdown block detection, fenced code and quotes. Flat. */
export function parseMarkdownBlocks(input: string): ParsedBlock[] {
  return parseLines(input).map(({ type, title, props }) => (props ? { type, title, props } : { type, title }))
}

/**
 * The blocks of a pasted Markdown text as a tree: a line indented under a list item
 * (`- a` then `  - b`) becomes its child, as it does in the Markdown the editor copies.
 */
export function parseMarkdownNodes(input: string): ClipNode[] {
  const root: ClipNode[] = []
  const stack: { indent: number; node: ClipNode }[] = []
  for (const line of parseLines(input)) {
    const heading = line.type.startsWith('heading_')
    while (stack.length && (heading || stack[stack.length - 1].indent >= line.indent)) stack.pop()
    const node: ClipNode = { type: line.type, props: { ...line.props, title: line.title }, children: [] }
    ;(stack.length ? stack[stack.length - 1].node.children : root).push(node)
    if (LIST_TYPES.has(line.type) && stack.length < MAX_LIST_DEPTH) stack.push({ indent: line.indent, node })
  }
  return root
}
