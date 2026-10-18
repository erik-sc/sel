// Syntax colouring of LaTeX source, one HTML string per line, for the layer drawn under the
// source textarea. Pure: strings in, escaped HTML out.
import { escapeHtml } from './math'

type Token = [text: string, cls: string]

/** Environments whose body is mathematics. */
const MATH_ENVS = /^(equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math)\*?$/

const VERBATIM_ENVS = /^(verbatim\*?|lstlisting)$/

function tokenize(src: string): Token[] {
  const out: Token[] = []
  // Inside a formula: the delimiter that closes it (or the math environment's \end).
  let math: string | null = null
  let mathEnv: string | null = null
  const push = (text: string, cls: string): void => {
    out.push([text, math || mathEnv ? `${cls} tex-math`.trim() : cls])
  }
  // Delimiters are coloured as such, inside or outside the formula they open or close.
  const delimit = (text: string): void => {
    out.push([text, 'tex-math-delim'])
  }
  for (let i = 0; i < src.length; ) {
    const ch = src[i]
    if (ch === '%') {
      const end = src.indexOf('\n', i)
      const stop = end < 0 ? src.length : end
      push(src.slice(i, stop), 'tex-comment')
      i = stop
      continue
    }
    if (ch === '\\') {
      const m = /^\\(begin|end)(\s*)\{([^{}\n]*)\}/.exec(src.slice(i, i + 120))
      if (m) {
        const name = m[3].trim()
        if (m[1] === 'end' && mathEnv === name) mathEnv = null
        push(`\\${m[1]}`, 'tex-env-cmd')
        if (m[2]) push(m[2], '')
        push('{', 'tex-brace')
        push(m[3], 'tex-env')
        push('}', 'tex-brace')
        i += m[0].length
        if (m[1] === 'begin' && MATH_ENVS.test(name)) mathEnv = name
        if (m[1] === 'begin' && VERBATIM_ENVS.test(name)) {
          const closer = `\\end{${name}}`
          const close = src.indexOf(closer, i)
          const stop = close < 0 ? src.length : close
          push(src.slice(i, stop), 'tex-verbatim')
          i = stop
        }
        continue
      }
      const word = /^\\[A-Za-z]+\*?/.exec(src.slice(i, i + 80))
      if (word) {
        push(word[0], 'tex-cmd')
        i += word[0].length
        continue
      }
      const next = src[i + 1]
      if (next === undefined) {
        push('\\', 'tex-cmd')
        i++
        continue
      }
      if (!math && !mathEnv && (next === '(' || next === '[')) {
        math = next === '(' ? '\\)' : '\\]'
        delimit(`\\${next}`)
        i += 2
        continue
      }
      if (math && `\\${next}` === math) {
        delimit(math)
        math = null
        i += 2
        continue
      }
      push(`\\${next}`, 'tex-cmd')
      i += 2
      continue
    }
    if (ch === '$' && !mathEnv) {
      const double = src[i + 1] === '$'
      const delim = double ? '$$' : '$'
      if (math === delim) {
        delimit(delim)
        math = null
      } else if (!math) {
        delimit(delim)
        math = delim
      } else delimit(delim)
      i += delim.length
      continue
    }
    if (ch === '{' || ch === '}') {
      push(ch, 'tex-brace')
      i++
      continue
    }
    if (ch === '&' || ch === '~' || ch === '^' || ch === '_' || ch === '#') {
      push(ch, 'tex-special')
      i++
      continue
    }
    let j = i + 1
    while (j < src.length && !/[%\\$&~^_#{}]/.test(src[j])) j++
    push(src.slice(i, j), '')
    i = j
  }
  return out
}

/** The source as coloured HTML, one string per line (an empty line is an empty string). */
export function highlightLines(src: string): string[] {
  const lines: string[] = ['']
  for (const [text, cls] of tokenize(src)) {
    const parts = text.split('\n')
    parts.forEach((part, k) => {
      if (k > 0) lines.push('')
      if (!part) return
      const html = escapeHtml(part)
      lines[lines.length - 1] += cls ? `<span class="${cls}">${html}</span>` : html
    })
  }
  return lines
}

export interface Range {
  start: number
  end: number
}

/** The source with `ranges` marked (find results), one string per line; `current` is the selected one. */
export function markLines(src: string, ranges: readonly Range[], current: number): string[] {
  const lines: string[] = ['']
  let at = 0
  const plain = (text: string): void => {
    text.split('\n').forEach((part, k) => {
      if (k > 0) lines.push('')
      lines[lines.length - 1] += escapeHtml(part)
    })
  }
  ranges.forEach((range, index) => {
    if (range.start < at || range.end <= range.start) return
    plain(src.slice(at, range.start))
    const cls = index === current ? 'latex-mark is-current' : 'latex-mark'
    src
      .slice(range.start, range.end)
      .split('\n')
      .forEach((part, k) => {
        if (k > 0) lines.push('')
        if (part) lines[lines.length - 1] += `<mark class="${cls}">${escapeHtml(part)}</mark>`
      })
    at = range.end
  })
  plain(src.slice(at))
  return lines
}
