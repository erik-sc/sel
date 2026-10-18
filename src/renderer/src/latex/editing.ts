// What the keys of the LaTeX source editor do to its text: auto-closing pairs, Enter after
// \begin{…} and indentation. Pure: a text and a selection in, an edit out. The editor
// applies an edit through the textarea's own undo stack (see SourceEditor).

/** Replace `[start, end)` with `text`, then select `[caret, caretEnd]`. */
export interface Edit {
  start: number
  end: number
  text: string
  caret: number
  caretEnd?: number
}

const PAIRS: Record<string, string> = { '{': '}', '[': ']', $: '$' }
const CLOSERS = new Set(['}', ']', '$'])
const INDENT = '  '

function lineStartOf(value: string, pos: number): number {
  return value.lastIndexOf('\n', pos - 1) + 1
}

function lineEndOf(value: string, pos: number): number {
  const end = value.indexOf('\n', pos)
  return end < 0 ? value.length : end
}

/** Typing `key`: wraps a selection, steps over a closer just typed, or adds the closing pair. */
export function typePair(value: string, start: number, end: number, key: string): Edit | null {
  const close = PAIRS[key]
  if (!close && !CLOSERS.has(key)) return null
  const before = value[start - 1]
  if (before === '\\') return null
  if (start !== end && close) {
    return { start, end, text: key + value.slice(start, end) + close, caret: start + 1, caretEnd: end + 1 }
  }
  if (start !== end) return null
  const next = value[start]
  if (key === '$' && before === '$' && next === '$' && value[start - 2] !== '$') {
    // `$|$` and a second `$`: display math, `$$|$$`.
    return { start, end, text: '$$', caret: start + 1 }
  }
  if (CLOSERS.has(key) && next === key) return { start, end, text: '', caret: start + 1 }
  if (!close) return null
  // Only before nothing or a space/closer: in front of a word the pair would be in the way.
  if (next !== undefined && !/[\s)\]}$,.;:]/.test(next)) return null
  return { start, end, text: key + close, caret: start + 1 }
}

/** Backspace between an empty pair (`{|}`) removes both. */
export function backspacePair(value: string, start: number, end: number): Edit | null {
  if (start !== end || start === 0) return null
  const open = value[start - 1]
  if (PAIRS[open] && value[start] === PAIRS[open] && value[start - 2] !== '\\') {
    return { start: start - 1, end: start + 1, text: '', caret: start - 1 }
  }
  return null
}

/** Enter: keeps the line's indentation; after `\begin{env}` also closes the environment. */
export function enter(value: string, start: number, end: number): Edit {
  const lineStart = lineStartOf(value, start)
  const line = value.slice(lineStart, start)
  const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
  const begin = /\\begin\{([^{}]+)\}(\[[^\]]*\]|\{[^{}]*\})*\s*$/.exec(line)
  const atLineEnd = !value.slice(end, lineEndOf(value, end)).trim()
  if (begin && start === end && atLineEnd) {
    const name = begin[1]
    const inner = `\n${indent}${name === 'document' ? '' : INDENT}`
    const lineEnd = lineEndOf(value, end)
    const nextLine = value.slice(lineEnd + 1, lineEndOf(value, lineEnd + 1))
    // Closed already (the \end follows on the next line, or further down for the document).
    const closed = nextLine.trim() === `\\end{${name}}` || (name === 'document' && value.includes('\\end{document}', end))
    const text = closed ? inner : `${inner}\n${indent}\\end{${name}}`
    return { start, end, text, caret: start + inner.length }
  }
  return { start, end, text: `\n${indent}`, caret: start + 1 + indent.length }
}

/** The lines a selection touches, as [first line start, last line end). */
function touchedLines(value: string, start: number, end: number): [number, number] {
  const from = lineStartOf(value, start)
  const to = lineEndOf(value, end > start && value[end - 1] === '\n' ? end - 1 : end)
  return [from, to]
}

/** Tab: two spaces at the caret, or every selected line indented. Shift+Tab takes them away. */
export function indent(value: string, start: number, end: number, outdent: boolean): Edit | null {
  if (!outdent && start === end) return { start, end, text: INDENT, caret: start + INDENT.length }
  const [from, to] = touchedLines(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const changed = lines.map((l) => (outdent ? l.replace(/^( {1,2}|\t)/, '') : INDENT + l))
  const text = changed.join('\n')
  if (text === value.slice(from, to)) return null
  if (start === end) {
    const removed = lines[0].length - changed[0].length
    const caret = Math.max(from, start - removed)
    return { start: from, end: to, text, caret }
  }
  return { start: from, end: to, text, caret: from, caretEnd: from + text.length }
}

/** Offsets of line `line` (1-based), clamped to the text. */
export function lineRange(value: string, line: number): { start: number; end: number } {
  let start = 0
  for (let n = 1; n < line; n++) {
    const next = value.indexOf('\n', start)
    if (next < 0) break
    start = next + 1
  }
  return { start, end: lineEndOf(value, start) }
}

/** The 1-based line at offset `pos`. */
export function lineAt(value: string, pos: number): number {
  let line = 1
  for (let i = value.indexOf('\n'); i >= 0 && i < pos; i = value.indexOf('\n', i + 1)) line++
  return line
}
