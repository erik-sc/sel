import { describe, expect, it } from 'vitest'
import { backspacePair, enter, indent, lineAt, lineRange, typePair, type Edit } from './editing'
import { highlightLines, markLines } from './highlight'

/** Applies an edit; `|` marks the caret (and `[`…`]` a selection) in both strings. */
function run(fn: (value: string, start: number, end: number) => Edit | null, marked: string): string | null {
  const start = marked.indexOf('|')
  const value = marked.replace('|', '')
  const edit = fn(value, start, start)
  if (!edit) return null
  const out = value.slice(0, edit.start) + edit.text + value.slice(edit.end)
  return out.slice(0, edit.caret) + '|' + out.slice(edit.caret)
}

describe('auto-closing', () => {
  const type = (key: string) => (v: string, s: number, e: number) => typePair(v, s, e, key)

  it('adds the closing brace, bracket and dollar', () => {
    expect(run(type('{'), '\\textbf|')).toBe('\\textbf{|}')
    expect(run(type('['), '\\section|')).toBe('\\section[|]')
    expect(run(type('$'), 'see | here')).toBe('see $|$ here')
  })

  it('steps over the closer it added', () => {
    expect(run(type('}'), '\\emph{x|}')).toBe('\\emph{x}|')
    expect(run(type('$'), '$x|$')).toBe('$x$|')
  })

  it('turns $|$ into display math', () => {
    expect(run(type('$'), '$|$')).toBe('$$|$$')
  })

  it('stays out of the way before a word and after a backslash', () => {
    expect(run(type('{'), '|word')).toBeNull()
    expect(run(type('{'), '\\|')).toBeNull()
  })

  it('wraps a selection', () => {
    expect(typePair('a bold b', 2, 6, '{')).toEqual({ start: 2, end: 6, text: '{bold}', caret: 3, caretEnd: 7 })
  })

  it('removes an empty pair on backspace', () => {
    expect(run(backspacePair, 'x{|}')).toBe('x|')
    expect(run(backspacePair, 'x{a|}')).toBeNull()
    expect(run(backspacePair, '\\{|}')).toBeNull()
  })
})

describe('enter', () => {
  it('keeps the indentation', () => {
    expect(run(enter, '  \\item one|')).toBe('  \\item one\n  |')
  })

  it('closes an environment after \\begin', () => {
    expect(run(enter, '  \\begin{itemize}|')).toBe('  \\begin{itemize}\n    |\n  \\end{itemize}')
    expect(run(enter, '\\begin{tabular}{lc}|')).toBe('\\begin{tabular}{lc}\n  |\n\\end{tabular}')
  })

  it('does not close it twice', () => {
    expect(run(enter, '\\begin{center}|\n\\end{center}')).toBe('\\begin{center}\n  |\n\\end{center}')
    expect(run(enter, '\\begin{document}|\n\nx\n\\end{document}')).toBe('\\begin{document}\n|\n\nx\n\\end{document}')
  })
})

describe('indent', () => {
  it('indents at the caret and every selected line', () => {
    expect(run((v, s, e) => indent(v, s, e, false), 'a|')).toBe('a  |')
    const edit = indent('a\nb\nc', 0, 3, false)!
    expect(edit.text).toBe('  a\n  b')
  })

  it('outdents', () => {
    expect(run((v, s, e) => indent(v, s, e, true), '    x|')).toBe('  x|')
    expect(indent('x', 0, 0, true)).toBeNull()
  })
})

describe('lines', () => {
  it('finds a line and the line of an offset', () => {
    expect(lineRange('one\ntwo\nthree', 2)).toEqual({ start: 4, end: 7 })
    expect(lineRange('one', 9)).toEqual({ start: 0, end: 3 })
    expect(lineAt('one\ntwo\nthree', 5)).toBe(2)
  })
})

describe('highlight', () => {
  it('colours commands, environments, comments and math, one string per line', () => {
    const lines = highlightLines('\\section{A} % note\n$x^2$ and \\begin{equation}\ny\n\\end{equation}\n')
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe(
      '<span class="tex-cmd">\\section</span><span class="tex-brace">{</span>A<span class="tex-brace">}</span> <span class="tex-comment">% note</span>'
    )
    expect(lines[1]).toContain('<span class="tex-math-delim">$</span><span class="tex-math">x</span><span class="tex-special tex-math">^</span>')
    expect(lines[1]).toContain('<span class="tex-env">equation</span>')
    expect(lines[2]).toBe('<span class="tex-math">y</span>')
    expect(lines[4]).toBe('')
  })

  it('escapes the source', () => {
    expect(highlightLines('<b>&')).toEqual(['&lt;b&gt;<span class="tex-special">&amp;</span>'])
  })

  it('marks find results, across lines', () => {
    expect(markLines('ab\ncd', [{ start: 1, end: 4 }], 0)).toEqual(['a<mark class="latex-mark is-current">b</mark>', '<mark class="latex-mark is-current">c</mark>d'])
  })
})
