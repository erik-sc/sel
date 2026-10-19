import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { skeleton } from './words'
import { convertLatex, type ConvertOptions } from './convert'
import { renderMath, type MathEngine } from './math'

const engine = katex as unknown as MathEngine
const NOW = new Date(2026, 9, 16)
const opts = (locale: ConvertOptions['locale'] = 'en'): ConvertOptions => ({ engine, locale, now: NOW })

const doc = (body: string, preamble = ''): string => `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`

function convert(source: string, locale: ConvertOptions['locale'] = 'en') {
  return convertLatex(source, opts(locale))
}

describe('the new-document skeleton', () => {
  for (const locale of ['en', 'pt-BR'] as const) {
    it(`renders without any diagnostic (${locale})`, () => {
      const result = convert(skeleton(locale), locale)
      expect(result.diagnostics).toEqual([])
      expect(result.html).toContain('class="latex-title"')
      expect(result.html).toContain('class="katex')
      // \eqref and \ref resolve to the equation and the section.
      expect(result.html).toContain('<span class="latex-ref">(1)</span>')
      expect(result.html).toContain('<span class="latex-ref">1</span>')
      expect(result.html).toContain('class="latex-footnotes"')
    })
  }

  it('speaks the language babel asks for', () => {
    expect(convert(skeleton('pt-BR'), 'en').html).toContain('Resumo')
    expect(convert(skeleton('en'), 'pt-BR').html).toContain('Abstract')
    expect(convert(skeleton('pt-BR')).html).toContain('16 de outubro de 2026')
  })

  it('but lists its problems in the app’s language', () => {
    const result = convert(doc('\\foo', '\\usepackage[brazil]{babel}\n'), 'en')
    expect(result.diagnostics.map((d) => d.message)).toEqual(['\\foo is not supported by the preview; it is marked where it appears.'])
  })
})

describe('unsupported commands', () => {
  it('become a warning and a mark, never an exception', () => {
    const source = doc('Hello \\foo{bar} world.\n\n\\begin{tikzpicture}x\\end{tikzpicture}', '\\usepackage{tikz}\n')
    let result: ReturnType<typeof convert> | undefined
    expect(() => (result = convert(source))).not.toThrow()
    const codes = result!.diagnostics.map((d) => [d.line, d.severity, d.code])
    expect(codes).toEqual([
      [2, 'warning', 'ignored-package'],
      [4, 'warning', 'unsupported-command'],
      [6, 'warning', 'unsupported-environment']
    ])
    expect(result!.html).toContain('class="latex-unsupported"')
    expect(result!.html).toContain('bar')
    expect(result!.html).toContain('data-env="tikzpicture"')
  })

  it('in a formula are a warning too', () => {
    const result = convert(doc('Inline $a + \\nosuch{b}$ math.'))
    expect(result.diagnostics.map((d) => [d.line, d.severity, d.code])).toEqual([[3, 'warning', 'math-unsupported']])
    expect(result.diagnostics[0].message).toContain('\\nosuch')
  })

  it('survive garbage input', () => {
    for (const source of ['', '}', '{', '\\', '$', '\\begin{', '\\end{itemize}', '\\item', '&^_#', '\\verb', '\\newcommand', '%']) {
      expect(() => convert(source)).not.toThrow()
    }
  })
})

describe('errors point at the right line', () => {
  const lineOf = (source: string, code: string): number[] =>
    convert(source)
      .diagnostics.filter((d) => d.code === code)
      .map((d) => d.line)

  it('an unclosed brace, at the brace', () => {
    expect(lineOf(doc('one\n\\textbf{two\n\nthree'), 'unclosed-group')).toEqual([4])
  })

  it('an environment never ended, at its \\begin', () => {
    expect(lineOf(doc('a\n\\begin{itemize}\n\\item x\n'), 'unclosed-environment')).toEqual([4])
  })

  it('an inner environment closed by the outer one’s \\end, at the inner \\begin', () => {
    const result = convert(doc('\\begin{itemize}\n\\item x\n\\begin{enumerate}\n\\item y\n\\end{itemize}'))
    expect(result.diagnostics.map((d) => [d.code, d.line, d.message])).toEqual([
      ['unclosed-environment', 5, '\\begin{enumerate} is never closed by \\end{enumerate}.']
    ])
  })

  it('an \\end of nothing open, at the \\end', () => {
    expect(lineOf(doc('a\n\\end{center}\nb'), 'extra-end')).toEqual([4])
  })

  it('an extra closing brace, at the brace', () => {
    expect(lineOf(doc('a\nb}\nc'), 'extra-close')).toEqual([4])
  })

  it('an unclosed $, at the $', () => {
    expect(lineOf(doc('x\n\ny $a + b\n\nz'), 'unclosed-math')).toEqual([5])
  })

  it('an error inside a multi-line formula, at its own line', () => {
    const source = doc('\\begin{align}\n  a &= b \\\\\n  c &= \\frac{d}{\n\\end{align}')
    const d = convert(source).diagnostics.filter((x) => x.severity === 'error')
    expect(d).toHaveLength(1)
    expect(d[0].code).toBe('math-error')
    expect(d[0].line).toBe(5)
  })

  it('a math error after a label and an inserted tag still maps back', () => {
    const source = doc('\\begin{equation}\n  x = 1 \\label{eq:a}\n  + \\frac{1}{\n\\end{equation}')
    expect(convert(source).diagnostics.map((d) => [d.code, d.line])).toEqual([['math-error', 5]])
  })

  it('missing \\begin{document}, at \\documentclass, and still shows the text', () => {
    const result = convert('% header\n\\documentclass{article}\nHello')
    expect(result.diagnostics.map((d) => [d.code, d.line])).toEqual([['missing-begin-document', 2]])
    expect(result.html).toContain('Hello')
  })
})

describe('coverage', () => {
  it('numbers sections and resolves references, forward ones too', () => {
    const result = convert(doc('See \\ref{s:b}.\n\\section{A}\n\\subsection{A1}\\label{s:a1}\n\\section{B}\\label{s:b}\nAt \\ref{s:a1}.'))
    expect(result.diagnostics).toEqual([])
    expect(result.html).toMatch(/See <span class="latex-ref">2<\/span>/)
    expect(result.html).toContain('<span class="latex-ref">1.1</span>')
    expect(result.html).toContain('<h3 class="latex-h2" data-line="5"><span class="latex-secnum">1.1</span>A1</h3>')
  })

  it('numbers align rows, skipping \\nonumber, and refers to them', () => {
    const result = convert(
      doc(
        '\\begin{align}\na &= b \\label{r1}\\\\\nc &= d \\nonumber\\\\\ne &= f \\label{r3}\n\\end{align}\n(\\ref{r1}, \\ref{r3}) and $x \\eqref{r3}$'
      )
    )
    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('<span class="latex-ref">1</span>, <span class="latex-ref">2</span>')
  })

  it('warns about a reference to nothing', () => {
    const result = convert(doc('See \\ref{nope}.'))
    expect(result.diagnostics.map((d) => [d.code, d.line])).toEqual([['undefined-reference', 3]])
    expect(result.html).toContain('??')
  })

  it('draws lists, nested, with custom labels and descriptions', () => {
    const result = convert(
      doc(
        '\\begin{enumerate}\n\\item one\n\\begin{itemize}\\item[--] inner\\end{itemize}\n\\item two\n\\end{enumerate}\n\\begin{description}\\item[Term] Meaning\\end{description}'
      )
    )
    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('<ol class="latex-enumerate"')
    expect(result.html).toContain('<span class="latex-item-label">\u2013</span>')
    expect(result.html).toMatch(/<dt data-line="\d+">Term<\/dt><dd>/)
  })

  it('draws a simple tabular with rules and alignment', () => {
    const result = convert(
      doc('\\begin{tabular}{|l|c|r|}\n\\hline\na & b & c \\\\\n\\hline\n1 & \\multicolumn{2}{c}{wide} \\\\\n\\hline\n\\end{tabular}')
    )
    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('<td class="latex-col-l latex-rule-left latex-rule-right">a</td>')
    expect(result.html).toContain('colspan="2"')
    expect(result.html).toContain('latex-rule-bottom')
  })

  it('keeps verbatim text verbatim and escaped', () => {
    const result = convert(doc('\\begin{verbatim}\n\\section{<b>} & $x$\n\\end{verbatim}\nand \\verb|\\foo<|.'))
    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('<pre class="latex-verbatim" data-line="3">\\section{&lt;b&gt;} &amp; $x$</pre>')
    expect(result.html).toContain('<code class="latex-verb">\\foo&lt;</code>')
  })

  it('escapes every character of the text', () => {
    const result = convert(doc('<script>alert(1)</script> & "x"'))
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })

  it('collects footnotes at the end, numbered', () => {
    const result = convert(doc('A\\footnote{first} b\\footnote{second}.'))
    expect(result.html).toContain('<sup class="latex-fnmark">1</sup>')
    expect(result.html).toContain('<li value="2" data-line="3">second</li>')
  })

  it('expands \\newcommand in text and in math', () => {
    const result = convert(doc('\\newcommand{\\hi}[1]{Hello, \\textbf{#1}!}\\newcommand{\\R}{\\mathbb{R}}\n\\hi{you} $x \\in \\R$'))
    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('Hello, <span class="latex-bf">you</span>!')
  })

  it('stops a macro that expands into itself', () => {
    const result = convert(doc('\\newcommand{\\loop}{\\loop}\\loop'))
    expect(result.diagnostics.map((d) => d.code)).toEqual(['macro-loop'])
  })

  it('applies quotes, dashes, accents and emphasis', () => {
    const result = convert(doc("``Ol\\'a'' --- p\\~ao -- \\emph{it \\emph{up}}"))
    expect(result.html).toContain('\u201cOlá\u201d \u2014 pão \u2013 ')
    expect(result.html).toContain('<span class="latex-it">it </span><span class="latex-up">up</span>')
  })

  it('ignores page-only commands without a word', () => {
    const result = convert(doc('\\thispagestyle{empty}\\setlength{\\parindent}{0pt}Text\\newpage More'))
    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('latex-pagebreak')
  })

  it('renders a fragment without \\documentclass as a body', () => {
    const result = convert('Just $x^2$ here.')
    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('Just')
  })

  it('warns about text in the preamble once', () => {
    const result = convert('\\documentclass{article}\nstray words\n\\begin{document}\nok\n\\end{document}')
    expect(result.diagnostics.map((d) => [d.code, d.line])).toEqual([['text-in-preamble', 2]])
  })
})

describe('renderMath', () => {
  it('caches by formula', () => {
    const cache = new Map()
    const first = renderMath(engine, 'x^2', true, {}, cache)
    expect(renderMath(engine, 'x^2', true, {}, cache)).toBe(first)
  })

  it('reports an error with its offset', () => {
    const outcome = renderMath(engine, 'a + \\frac{1}{', false)
    expect(outcome.problem?.kind).toBe('error')
    expect(outcome.html).toContain('katex')
  })
})
