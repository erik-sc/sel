// LaTeX → HTML for the preview of a LaTeX document. Covers the `article` subset people write
// by hand (see docs/plans/release-0.6.0.md §9); everything else is shown marked and listed as
// a warning, never thrown. Syntax errors carry the line they are on. Math goes to KaTeX, which
// is handed in (`engine`) so this file stays pure: no DOM, no React, no import of the engine.
//
// Every character of the source reaches the HTML escaped; the only markup that is not built here
// is KaTeX's own output, rendered with `trust: false` (no links, no classes, no raw HTML).
import { escapeHtml, renderMath, type MathCache, type MathEngine } from './math'
import { DOCUMENT_WORDS, diagnosticMessage, type DiagnosticCode, type LatexLocale } from './words'

export type { MathEngine }

export type Severity = 'error' | 'warning'

export interface LatexDiagnostic {
  /** 1-based line of the source. */
  line: number
  severity: Severity
  code: DiagnosticCode
  message: string
}

export interface LatexResult {
  html: string
  diagnostics: LatexDiagnostic[]
}

export interface ConvertOptions {
  engine: MathEngine
  /** The app's language: the document's when it does not choose one with babel. */
  locale: LatexLocale
  /** For \today; tests pin it. */
  now?: Date
  cache?: MathCache
}

/** More diagnostics than this are counted, not listed. */
export const MAX_DIAGNOSTICS = 200
/** User macros may expand into one another this deep. */
const MAX_EXPANSION = 32

// ---------------------------------------------------------------- helpers

const LETTER = /[A-Za-z]/

/** TeX's ligatures for quotes and dashes, on raw text (before escaping). */
function typographic(raw: string): string {
  return raw
    .replace(/---/g, '\u2014')
    .replace(/--/g, '\u2013')
    .replace(/!`/g, '\u00a1')
    .replace(/\?`/g, '\u00bf')
    .replace(/``/g, '\u201c')
    .replace(/''/g, '\u201d')
    .replace(/`/g, '\u2018')
    .replace(/'/g, '\u2019')
}

const SYMBOLS: Record<string, string> = {
  ldots: '\u2026',
  dots: '\u2026',
  textellipsis: '\u2026',
  textbackslash: '\\',
  textasciitilde: '~',
  textasciicircum: '^',
  textbar: '|',
  textless: '<',
  textgreater: '>',
  textendash: '\u2013',
  textemdash: '\u2014',
  textquoteleft: '\u2018',
  textquoteright: '\u2019',
  textquotedblleft: '\u201c',
  textquotedblright: '\u201d',
  textunderscore: '_',
  textbullet: '\u2022',
  textperiodcentered: '\u00b7',
  textdegree: '\u00b0',
  S: '\u00a7',
  P: '\u00b6',
  copyright: '\u00a9',
  textcopyright: '\u00a9',
  textregistered: '\u00ae',
  texttrademark: '\u2122',
  dag: '\u2020',
  ddag: '\u2021',
  textdagger: '\u2020',
  textdaggerdbl: '\u2021',
  pounds: '\u00a3',
  textsterling: '\u00a3',
  euro: '\u20ac',
  texteuro: '\u20ac',
  guillemotleft: '\u00ab',
  guillemotright: '\u00bb',
  ss: '\u00df',
  ae: '\u00e6',
  AE: '\u00c6',
  oe: '\u0153',
  OE: '\u0152',
  o: '\u00f8',
  O: '\u00d8',
  aa: '\u00e5',
  AA: '\u00c5',
  l: '\u0142',
  L: '\u0141',
  i: '\u0131',
  j: '\u0237',
  quad: '\u2003',
  qquad: '\u2003\u2003',
  enspace: '\u2002',
  enskip: '\u2002',
  thinspace: '\u2009',
  slash: '/',
  space: ' ',
  hfill: '\u2003',
  dotfill: '\u2026',
  hrulefill: '\u2003'
}

/** Accent commands → combining mark. */
const ACCENTS: Record<string, string> = {
  "'": '\u0301',
  '`': '\u0300',
  '^': '\u0302',
  '"': '\u0308',
  '~': '\u0303',
  '=': '\u0304',
  '.': '\u0307',
  u: '\u0306',
  v: '\u030c',
  H: '\u030b',
  c: '\u0327',
  k: '\u0328',
  r: '\u030a',
  d: '\u0323',
  b: '\u0331',
  t: '\u0361'
}

const LOGOS: Record<string, string> = {
  LaTeX: '<span class="latex-logo">L<span class="latex-logo-a">a</span>T<span class="latex-logo-e">e</span>X</span>',
  LaTeXe:
    '<span class="latex-logo">L<span class="latex-logo-a">a</span>T<span class="latex-logo-e">e</span>X\u00a02<sub>\u03b5</sub></span>',
  TeX: '<span class="latex-logo">T<span class="latex-logo-e">e</span>X</span>'
}

/** Packages whose effect the preview already has: accepted without a word. */
const BUILT_IN_PACKAGES = new Set(['amsmath', 'amssymb', 'amsfonts', 'inputenc', 'fontenc', 'babel', 'lmodern', 'textcomp'])

const BABEL_LANGUAGES: Record<string, LatexLocale> = {
  brazil: 'pt-BR',
  brazilian: 'pt-BR',
  portuguese: 'pt-BR',
  portuges: 'pt-BR',
  english: 'en',
  american: 'en',
  USenglish: 'en',
  british: 'en',
  UKenglish: 'en'
}

/**
 * Commands about the printed page (page styles, lengths, hyphenation). The preview is not
 * paginated, so they change nothing on screen; they are read with their arguments and dropped.
 * The value is how many braced arguments they take.
 */
const PAGE_ONLY: Record<string, number> = {
  pagestyle: 1,
  thispagestyle: 1,
  pagenumbering: 1,
  setlength: 2,
  addtolength: 2,
  linespread: 1,
  hyphenation: 1,
  frenchspacing: 0,
  nonfrenchspacing: 0,
  sloppy: 0,
  fussy: 0,
  raggedbottom: 0,
  flushbottom: 0,
  nopagebreak: 0,
  protect: 0,
  relax: 0,
  null: 0,
  indent: 0,
  onecolumn: 0
}

type Weight = '' | 'bf' | 'md'
type Shape = '' | 'it' | 'sl' | 'sc' | 'up'
type Family = '' | 'tt' | 'sf' | 'rm'

interface Style {
  weight: Weight
  shape: Shape
  family: Family
  size: string
}

const PLAIN: Style = { weight: '', shape: '', family: '', size: '' }

const SIZES = new Set(['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge'])

/** Declarations (`{\bfseries …}`) and the style they set. */
const DECLARATIONS: Record<string, Partial<Style>> = {
  bfseries: { weight: 'bf' },
  bf: { weight: 'bf' },
  mdseries: { weight: 'md' },
  itshape: { shape: 'it' },
  it: { shape: 'it' },
  slshape: { shape: 'sl' },
  sl: { shape: 'sl' },
  scshape: { shape: 'sc' },
  sc: { shape: 'sc' },
  upshape: { shape: 'up' },
  ttfamily: { family: 'tt' },
  tt: { family: 'tt' },
  sffamily: { family: 'sf' },
  sf: { family: 'sf' },
  rmfamily: { family: 'rm' },
  rm: { family: 'rm' },
  normalfont: { weight: '', shape: '', family: '' }
}

/** `\textbf{…}` and friends: the declaration their argument is set in. */
const TEXT_COMMANDS: Record<string, Partial<Style>> = {
  textbf: { weight: 'bf' },
  textmd: { weight: 'md' },
  textit: { shape: 'it' },
  textsl: { shape: 'sl' },
  textsc: { shape: 'sc' },
  textup: { shape: 'up' },
  texttt: { family: 'tt' },
  textsf: { family: 'sf' },
  textrm: { family: 'rm' },
  textnormal: { weight: '', shape: '', family: '' }
}

const NUMBERED_MULTI: Record<string, string> = {
  align: 'align*',
  'align*': 'align*',
  flalign: 'align*',
  'flalign*': 'align*',
  eqnarray: 'align*',
  'eqnarray*': 'align*',
  gather: 'gather*',
  'gather*': 'gather*',
  multline: 'gather*',
  'multline*': 'gather*',
  alignat: 'alignat*',
  'alignat*': 'alignat*'
}

const SINGLE_DISPLAY = new Set(['equation', 'equation*', 'displaymath'])

function styleClass(style: Style): string {
  const classes: string[] = []
  if (style.weight) classes.push(`latex-${style.weight}`)
  if (style.shape) classes.push(`latex-${style.shape}`)
  if (style.family) classes.push(`latex-${style.family}`)
  if (style.size && style.size !== 'normalsize') classes.push(`latex-size-${style.size}`)
  return classes.join(' ')
}

/** Lengths LaTeX users write, as CSS; null for what has no meaning on screen (\textwidth…). */
function cssLength(raw: string): string | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(pt|mm|cm|in|em|ex|px|bp|pc)\s*$/.exec(raw)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value) || Math.abs(value) > 500) return null
  const unit = m[2] === 'bp' ? 'pt' : m[2]
  return `${value}${unit}`
}

interface Column {
  align: 'l' | 'c' | 'r'
  left: boolean
  right: boolean
}

/** Reads a tabular column spec: l c r p{…} |, with @{…}, >{…}, <{…} and *{n}{…}. */
export function parseColumns(spec: string, depth = 0): Column[] {
  const cols: Column[] = []
  let pendingLeft = false
  const skipGroup = (i: number): number => {
    if (spec[i] !== '{') return i
    let d = 0
    for (let j = i; j < spec.length; j++) {
      if (spec[j] === '{') d++
      else if (spec[j] === '}' && --d === 0) return j + 1
    }
    return spec.length
  }
  for (let i = 0; i < spec.length; ) {
    const ch = spec[i]
    if (ch === '|') {
      if (cols.length) cols[cols.length - 1].right = true
      else pendingLeft = true
      i++
    } else if (ch === 'l' || ch === 'c' || ch === 'r') {
      cols.push({ align: ch, left: pendingLeft, right: false })
      pendingLeft = false
      i++
    } else if (ch === 'p' || ch === 'm' || ch === 'b' || ch === 'X') {
      cols.push({ align: 'l', left: pendingLeft, right: false })
      pendingLeft = false
      i = skipGroup(i + 1)
    } else if (ch === '@' || ch === '!' || ch === '>' || ch === '<') {
      i = skipGroup(i + 1)
    } else if (ch === '*' && depth < 4) {
      const countEnd = skipGroup(i + 1)
      const count = Math.min(50, Math.max(0, parseInt(spec.slice(i + 2, countEnd - 1), 10) || 0))
      const bodyEnd = skipGroup(countEnd)
      const body = spec.slice(countEnd + 1, bodyEnd - 1)
      for (let k = 0; k < count; k++) cols.push(...parseColumns(body, depth + 1))
      i = bodyEnd
    } else i++
  }
  return cols
}

interface Insertion {
  /** Where in the edited formula the inserted text starts, and how long it is. */
  at: number
  length: number
}

/** Maps an offset in an edited formula back to the formula as written. */
function mapBack(offset: number, insertions: readonly Insertion[]): number {
  let shift = 0
  for (const ins of insertions) {
    if (offset >= ins.at + ins.length) shift += ins.length
    else if (offset >= ins.at) return ins.at - shift
  }
  return offset - shift
}

/** Splits an aligned body at its top-level `\\` (not those inside braces or inner environments). */
function splitRows(body: string): { text: string; sep: string }[] {
  const rows: { text: string; sep: string }[] = []
  let depth = 0
  let envDepth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\') {
      if (body.startsWith('\\begin', i)) envDepth++
      else if (body.startsWith('\\end', i)) envDepth = Math.max(0, envDepth - 1)
      else if (body[i + 1] === '\\' && depth === 0 && envDepth === 0) {
        let end = i + 2
        const opt = /^\s*\[[^\]]*\]/.exec(body.slice(end))
        if (opt) end += opt[0].length
        rows.push({ text: body.slice(start, i), sep: body.slice(i, end) })
        start = end
        i = end - 1
        continue
      }
      i++
    } else if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
  }
  rows.push({ text: body.slice(start), sep: '' })
  return rows
}

const LABEL_RE = /\\label\s*\{([^{}]*)\}/g
const NONUMBER_RE = /\\(?:nonumber|notag)(?![A-Za-z])/g
const TAG_RE = /\\tag\*?\s*\{([^{}]*)\}/

function blank(text: string): string {
  return ' '.repeat(text.length)
}

// ---------------------------------------------------------------- converter

type Mode = 'block' | 'inline'

interface Stop {
  /** A list item ends at the next \item. */
  item?: boolean
  /** A table cell ends at & or \\. */
  cell?: boolean
}

interface Emit {
  mode: Mode
  text(raw: string, at: number): void
  /** Puts the text read so far out, before a command changes what comes next. */
  flush(): void
  inline(html: string, at: number): void
  block(html: string): void
  par(): void
}

interface Macro {
  params: number
  optional: string | null
  body: string
}

class Converter {
  private src: string
  private pos = 0
  private limit: number
  private readonly lineStarts: number[] = [0]
  private lineOverride: number | null = null
  private readonly engine: MathEngine
  private readonly cache: MathCache | undefined
  private readonly now: Date
  readonly diagnostics: LatexDiagnostic[] = []
  private overflow = 0
  private readonly envs: { name: string; line: number }[] = []
  private style: Style = PLAIN
  private align = ''
  inDocument = false
  private documentEnded = false
  private straySeen = false
  /** The document's language (babel, else the app's): the words it prints. */
  lang: LatexLocale
  /** The app's language: the language of diagnostics. */
  private readonly uiLocale: LatexLocale
  private readonly sec = [0, 0, 0]
  private appendix = false
  private eq = 0
  private table = 0
  private figure = 0
  private float: 'table' | 'figure' | null = null
  private labelTarget = ''
  readonly labels = new Map<string, string>()
  readonly refs: { name: string; line: number; paren: boolean }[] = []
  readonly footnotes: { n: number; html: string; line: number }[] = []
  readonly toc: { level: number; num: string; html: string }[] = []
  /** Labels known from an earlier pass, so a formula can refer forward. */
  private readonly preLabels: Map<string, string>
  missedMathRef = false
  title: string | null = null
  authors: string[] | null = null
  date: string | null = null
  body = ''
  private noindentNext = false
  private afterDisplay = false
  private readonly macros = new Map<string, Macro>()
  private katexMacros: Record<string, string> = {}
  private macrosKey = ''
  private expansion = 0
  private footnoteCount = 0

  constructor(source: string, options: ConvertOptions, preLabels: Map<string, string> = new Map()) {
    this.src = source.replace(/\u0000/g, '').replace(/\r\n?/g, '\n')
    this.limit = this.src.length
    for (let i = 0; i < this.src.length; i++) if (this.src[i] === '\n') this.lineStarts.push(i + 1)
    this.engine = options.engine
    this.cache = options.cache
    this.now = options.now ?? new Date()
    this.lang = options.locale
    this.uiLocale = options.locale
    this.preLabels = preLabels
  }

  // ---- positions and diagnostics

  private lineOf(pos: number): number {
    if (this.lineOverride !== null) return this.lineOverride
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  private report(severity: Severity, code: DiagnosticCode, pos: number | { line: number }, args: string[] = []): void {
    const line = typeof pos === 'number' ? this.lineOf(pos) : pos.line
    const message = diagnosticMessage(this.uiLocale, code, args)
    if (this.diagnostics.some((d) => d.line === line && d.code === code && d.message === message)) return
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) {
      this.overflow++
      return
    }
    this.diagnostics.push({ line, severity, code, message })
  }

  private error(code: DiagnosticCode, pos: number | { line: number }, args: string[] = []): void {
    this.report('error', code, pos, args)
  }

  private warn(code: DiagnosticCode, pos: number | { line: number }, args: string[] = []): void {
    this.report('warning', code, pos, args)
  }

  finishDiagnostics(): void {
    if (this.overflow)
      this.diagnostics.push({
        line: this.diagnostics[this.diagnostics.length - 1]?.line ?? 1,
        severity: 'warning',
        code: 'too-many',
        message: diagnosticMessage(this.uiLocale, 'too-many', [String(this.overflow)])
      })
    this.diagnostics.sort((a, b) => a.line - b.line || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  }

  // ---- reading

  private peekName(at = this.pos): string {
    if (this.src[at] !== '\\') return ''
    let j = at + 1
    if (j >= this.limit) return ''
    if (!LETTER.test(this.src[j])) return this.src[j]
    while (j < this.limit && LETTER.test(this.src[j])) j++
    return this.src.slice(at + 1, j)
  }

  /** The environment named by an `\end{…}` at `at`, and where it ends. */
  private peekEnd(at = this.pos): { name: string; end: number } | null {
    if (this.peekName(at) !== 'end') return null
    const m = /^\\end\s*\{([^{}\n]*)\}/.exec(this.src.slice(at, Math.min(this.limit, at + 200)))
    return m ? { name: m[1].trim(), end: at + m[0].length } : null
  }

  private isOpenEnv(name: string): boolean {
    return this.envs.some((e) => e.name === name)
  }

  /** Spaces after a control word, and the end of its line unless a blank line follows. */
  private skipControlSpace(): void {
    while (this.pos < this.limit && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++
    if (this.src[this.pos] === '\n' && this.pos < this.limit) {
      let j = this.pos + 1
      while (j < this.limit && (this.src[j] === ' ' || this.src[j] === '\t')) j++
      if (j < this.limit && this.src[j] !== '\n') this.pos = j
    }
  }

  /** Whitespace and comments, blank lines included. */
  private skipWs(): void {
    while (this.pos < this.limit) {
      const ch = this.src[this.pos]
      if (ch === ' ' || ch === '\t' || ch === '\n') this.pos++
      else if (ch === '%') {
        while (this.pos < this.limit && this.src[this.pos] !== '\n') this.pos++
      } else break
    }
  }

  private eatStar(): boolean {
    if (this.src[this.pos] === '*') {
      this.pos++
      this.skipControlSpace()
      return true
    }
    return false
  }

  /** Index of the `}` matching the `{` at `open`, or -1 when it is never closed. */
  private matchBrace(open: number, closeChar = '}', openChar = '{'): number {
    let depth = 0
    for (let i = open; i < this.limit; i++) {
      const ch = this.src[i]
      if (ch === '\\') i++
      else if (ch === '%') {
        while (i < this.limit && this.src[i] !== '\n') i++
      } else if (ch === openChar || (openChar !== '{' && ch === '{')) depth++
      else if (ch === closeChar || (closeChar !== '}' && ch === '}')) {
        depth--
        if (depth === 0) return ch === closeChar ? i : -1
      }
    }
    return -1
  }

  private readOptionalRaw(): { text: string; start: number } | null {
    const save = this.pos
    while (this.pos < this.limit && /[ \t\n]/.test(this.src[this.pos])) this.pos++
    if (this.src[this.pos] !== '[') {
      this.pos = save
      return null
    }
    const close = this.matchBrace(this.pos, ']', '[')
    if (close < 0) {
      this.pos = save
      return null
    }
    const start = this.pos + 1
    this.pos = close + 1
    return { text: this.src.slice(start, close), start }
  }

  /** A mandatory argument as written: a braced group, a control sequence or one character. */
  private readArgRaw(command: string): { text: string; start: number; ok: boolean } {
    this.skipWs()
    const at = this.pos
    const ch = this.src[at]
    if (at >= this.limit || ch === '}') {
      this.error('missing-argument', at, [command])
      return { text: '', start: at, ok: false }
    }
    if (ch === '{') {
      const close = this.matchBrace(at)
      if (close < 0) {
        this.error('unclosed-group', at)
        this.pos = this.limit
        return { text: this.src.slice(at + 1, this.limit), start: at + 1, ok: true }
      }
      this.pos = close + 1
      return { text: this.src.slice(at + 1, close), start: at + 1, ok: true }
    }
    if (ch === '\\') {
      const name = this.peekName(at)
      this.pos = at + 1 + Math.max(1, name.length)
      return { text: this.src.slice(at, this.pos), start: at, ok: true }
    }
    this.pos = at + 1
    return { text: ch, start: at, ok: true }
  }

  /** Parses `[from, to)` of the source, then leaves the reader at `to`. */
  private parseRange(from: number, to: number, mode: Mode = 'inline', stop: Stop = {}): string {
    const savedLimit = this.limit
    this.pos = from
    this.limit = to
    const html = this.parseSeq(mode, stop)
    this.limit = savedLimit
    this.pos = to
    return html
  }

  /** A mandatory argument, parsed as text in its own group. */
  private parseArg(command: string, patch?: Partial<Style>): string {
    this.skipWs()
    const at = this.pos
    if (this.src[at] !== '{') {
      const raw = this.readArgRaw(command)
      if (!raw.ok) return ''
      const after = this.pos
      const html = this.scoped(patch, () => this.parseRange(raw.start, raw.start + raw.text.length))
      this.pos = after
      return html
    }
    const close = this.matchBrace(at)
    if (close < 0) {
      this.error('unclosed-group', at)
      return this.scoped(patch, () => {
        const savedLimit = this.limit
        this.pos = at + 1
        const html = this.parseSeq('inline')
        this.limit = savedLimit
        return html
      })
    }
    const html = this.scoped(patch, () => this.parseRange(at + 1, close))
    this.pos = close + 1
    return html
  }

  /** Runs `fn` in a group: style and alignment set inside do not leak out. */
  private scoped<T>(patch: Partial<Style> | undefined, fn: () => T): T {
    const style = this.style
    const align = this.align
    if (patch) this.style = { ...style, ...patch }
    try {
      return fn()
    } finally {
      this.style = style
      this.align = align
    }
  }

  /** Runs `fn` over another text (a macro's expansion), its problems reported on `line`. */
  private withSource(text: string, line: number, fn: () => void): void {
    const saved = { src: this.src, pos: this.pos, limit: this.limit, line: this.lineOverride }
    this.src = text
    this.pos = 0
    this.limit = text.length
    this.lineOverride = saved.line ?? line
    try {
      fn()
    } finally {
      this.src = saved.src
      this.pos = saved.pos
      this.limit = saved.limit
      this.lineOverride = saved.line
    }
  }

  // ---- the main loop

  /** Parses until the end of the range or an `\end` of an open environment (or what `stop` names). */
  parseSeq(mode: Mode, stop: Stop = {}, top = false): string {
    const out: string[] = []
    let para = ''
    let paraOpen = false
    let paraAttrs = ''
    let text = ''
    let textAt = 0

    const discard = (html: string, at: number): boolean => {
      // Only the outermost sequence drops what the preamble would print.
      if (!top || this.inDocument) return false
      if (!this.straySeen && /[^\s]/.test(html.replace(/<[^>]*>/g, ''))) {
        this.straySeen = true
        this.warn(this.documentEnded ? 'text-after-end' : 'text-in-preamble', at)
      }
      return true
    }
    const pushInline = (html: string, at: number): void => {
      if (!html || discard(html, at)) return
      if (mode === 'inline') {
        out.push(html)
        return
      }
      if (!paraOpen) {
        if (!/\S/.test(html)) return
        paraOpen = true
        const classes: string[] = []
        if (this.noindentNext || this.afterDisplay) classes.push('latex-noindent')
        if (this.align) classes.push(`latex-align-${this.align}`)
        this.noindentNext = false
        this.afterDisplay = false
        paraAttrs = `${classes.length ? ` class="${classes.join(' ')}"` : ''} data-line="${this.lineOf(at)}"`
      }
      para += html
    }
    const flushText = (): void => {
      if (!text) return
      const raw = text
      text = ''
      const html = escapeHtml(this.style.family === 'tt' ? raw : typographic(raw))
      const cls = styleClass(this.style)
      pushInline(cls && /\S/.test(raw) ? `<span class="${cls}">${html}</span>` : html, textAt)
    }
    const flushPara = (): void => {
      if (!paraOpen) return
      out.push(`<p${paraAttrs}>${para.replace(/^\s+|\s+$/g, '')}</p>`)
      para = ''
      paraOpen = false
    }
    const emit: Emit = {
      mode,
      text: (raw, at) => {
        // A paragraph's line is that of its first visible character.
        if (!/\S/.test(text)) textAt = at
        text += raw
      },
      flush: flushText,
      inline: (html, at) => {
        flushText()
        pushInline(html, at)
      },
      block: (html) => {
        flushText()
        if (discard(html, this.pos)) return
        if (mode === 'block') flushPara()
        out.push(html)
      },
      par: () => {
        flushText()
        if (mode === 'block') {
          flushPara()
          this.afterDisplay = false
        } else if (out.length && !out[out.length - 1].endsWith(' ')) out.push(' ')
      }
    }

    this.loop(emit, stop)
    flushText()
    flushPara()
    return out.join('')
  }

  private loop(emit: Emit, stop: Stop): void {
    while (this.pos < this.limit) {
      const at = this.pos
      const ch = this.src[at]
      if (ch === '\\') {
        const name = this.peekName(at)
        if (name === 'end') {
          const end = this.peekEnd(at)
          if (end && this.isOpenEnv(end.name)) return
          this.pos = end ? end.end : at + 4
          this.error('extra-end', at, [end?.name ?? ''])
          continue
        }
        if (stop.item && name === 'item') return
        if (stop.cell && name === '\\') return
        // Text so far takes the style it was written in, and \begin{document} comes after it.
        if (!(name in SYMBOLS) && !(name.length === 1 && !LETTER.test(name))) emit.flush()
        this.command(emit)
        continue
      }
      switch (ch) {
        case '\n': {
          const lineStart = this.src.lastIndexOf('\n', at - 1) + 1
          const blankLine = /^[ \t]*$/.test(this.src.slice(lineStart, at))
          this.pos++
          while (this.pos < this.limit && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++
          if (blankLine) {
            while (this.pos < this.limit && /[ \t\n]/.test(this.src[this.pos])) this.pos++
            emit.par()
          } else emit.text(' ', at)
          break
        }
        case '%':
          while (this.pos < this.limit && this.src[this.pos] !== '\n') this.pos++
          if (this.pos < this.limit) this.pos++
          while (this.pos < this.limit && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++
          break
        case '{':
          this.group(emit)
          break
        case '}':
          this.error('extra-close', at)
          this.pos++
          break
        case '$':
          this.dollarMath(emit)
          break
        case '&':
          if (stop.cell) return
          this.error('misplaced-alignment', at)
          emit.text('&', at)
          this.pos++
          break
        case '~':
          emit.text('\u00a0', at)
          this.pos++
          break
        case '^':
        case '_':
          this.error('missing-dollar', at, [ch])
          emit.text(ch, at)
          this.pos++
          break
        case '#':
          this.error('parameter-outside-macro', at)
          emit.text('#', at)
          this.pos++
          break
        default: {
          let j = at
          while (j < this.limit && !/[\\{}$%&~^_#\n]/.test(this.src[j])) j++
          emit.text(this.src.slice(at, j).replace(/[ \t]+/g, ' '), at)
          this.pos = j
        }
      }
    }
  }

  private group(emit: Emit): void {
    const at = this.pos
    const close = this.matchBrace(at)
    if (close < 0) this.error('unclosed-group', at)
    const html = this.scoped(undefined, () => {
      if (close < 0) {
        this.pos = at + 1
        return this.parseSeq('inline')
      }
      const inner = this.parseRange(at + 1, close)
      this.pos = close + 1
      return inner
    })
    emit.inline(html, at)
  }

  // ---- commands

  private command(emit: Emit): void {
    const at = this.pos
    const next = this.src[at + 1]
    if (next === undefined || at + 1 >= this.limit) {
      emit.text('\\', at)
      this.pos++
      return
    }
    if (!LETTER.test(next)) {
      this.pos = at + 2
      this.symbol(next, at, emit)
      return
    }
    const name = this.peekName(at)
    this.pos = at + 1 + name.length
    this.skipControlSpace()

    const macro = this.macros.get(name)
    if (macro) return this.expand(name, macro, at, emit)
    if (name in SYMBOLS) return emit.text(SYMBOLS[name], at)
    if (name in LOGOS) return emit.inline(LOGOS[name], at)
    if (name in ACCENTS && name.length === 1) return this.accent(name, at, emit)
    if (name in DECLARATIONS) {
      this.style = { ...this.style, ...DECLARATIONS[name] }
      return
    }
    if (name === 'em') {
      this.style = { ...this.style, shape: this.style.shape === 'it' || this.style.shape === 'sl' ? 'up' : 'it' }
      return
    }
    if (SIZES.has(name)) {
      this.style = { ...this.style, size: name }
      return
    }
    if (name in TEXT_COMMANDS) return emit.inline(this.parseArg(`\\${name}`, TEXT_COMMANDS[name]), at)
    if (name in PAGE_ONLY) {
      for (let k = 0; k < PAGE_ONLY[name]; k++) this.readArgRaw(`\\${name}`)
      return
    }
    switch (name) {
      case 'documentclass':
        return this.documentClass(at)
      case 'usepackage':
        return this.usePackage(at)
      case 'title':
        this.title = this.parseArg('\\title')
        return
      case 'author':
        return this.author()
      case 'date':
        this.date = this.parseArg('\\date')
        return
      case 'thanks':
        return this.footnote(at, emit)
      case 'and':
        return emit.inline('<span class="latex-and"></span>', at)
      case 'maketitle':
        return emit.block(this.titleBlock(at))
      case 'today':
        return emit.text(DOCUMENT_WORDS[this.lang].date(this.now), at)
      case 'section':
        return this.heading(1, at, emit)
      case 'subsection':
        return this.heading(2, at, emit)
      case 'subsubsection':
        return this.heading(3, at, emit)
      case 'paragraph':
      case 'subparagraph':
        return this.runIn(at, emit)
      case 'appendix':
        this.appendix = true
        this.sec.fill(0)
        return
      case 'tableofcontents':
        return emit.block(`<nav class="latex-toc" data-line="${this.lineOf(at)}">\u0000TOC\u0000</nav>`)
      case 'emph':
        return emit.inline(this.parseArg('\\emph', { shape: this.style.shape === 'it' || this.style.shape === 'sl' ? 'up' : 'it' }), at)
      case 'underline':
      case 'uline':
        return emit.inline(`<u>${this.parseArg(`\\${name}`)}</u>`, at)
      case 'mbox':
      case 'hbox':
      case 'text':
        return emit.inline(`<span class="latex-nowrap">${this.parseArg(`\\${name}`)}</span>`, at)
      case 'fbox':
        return emit.inline(`<span class="latex-fbox">${this.parseArg('\\fbox')}</span>`, at)
      case 'footnote':
        return this.footnote(at, emit)
      case 'label':
        return this.label(at)
      case 'ref':
      case 'eqref': {
        const raw = this.readArgRaw(`\\${name}`)
        if (!raw.ok) return
        const index = this.refs.push({ name: raw.text.trim(), line: this.lineOf(at), paren: name === 'eqref' }) - 1
        return emit.inline(`<span class="latex-ref">\u0000${index}\u0000</span>`, at)
      }
      case 'cite':
      case 'citep':
      case 'citet': {
        this.readOptionalRaw()
        const raw = this.readArgRaw(`\\${name}`)
        this.warn('citations', at)
        return emit.inline(
          `<span class="latex-unsupported" title="${escapeHtml(diagnosticMessage(this.uiLocale, 'citations'))}">[${escapeHtml(raw.text)}]</span>`,
          at
        )
      }
      case 'url': {
        const raw = this.readArgRaw('\\url')
        return emit.inline(`<span class="latex-url">${escapeHtml(raw.text)}</span>`, at)
      }
      case 'href': {
        const url = this.readArgRaw('\\href')
        const html = this.parseArg('\\href')
        return emit.inline(`<span class="latex-url" title="${escapeHtml(url.text)}">${html}</span>`, at)
      }
      case 'verb':
        return this.verb(at, emit)
      case 'item':
        this.error('lonely-item', at)
        this.readOptionalRaw()
        return
      case 'newline':
        return emit.inline('<br>', at)
      case 'linebreak':
        this.readOptionalRaw()
        return emit.inline('<br>', at)
      case 'par':
        return emit.par()
      case 'noindent':
        this.noindentNext = true
        return
      case 'newpage':
      case 'clearpage':
      case 'cleardoublepage':
        return emit.block(`<div class="latex-pagebreak" data-line="${this.lineOf(at)}"></div>`)
      case 'pagebreak':
        this.readOptionalRaw()
        return emit.block(`<div class="latex-pagebreak" data-line="${this.lineOf(at)}"></div>`)
      case 'smallskip':
      case 'medskip':
      case 'bigskip':
        return emit.block(`<div class="latex-${name}"></div>`)
      case 'vspace': {
        this.eatStar()
        const raw = this.readArgRaw('\\vspace')
        const length = cssLength(raw.text)
        return emit.block(length ? `<div class="latex-vspace" style="height:${length}"></div>` : '')
      }
      case 'hspace': {
        this.eatStar()
        const raw = this.readArgRaw('\\hspace')
        const length = cssLength(raw.text)
        return emit.inline(length ? `<span class="latex-hspace" style="width:${length}"></span>` : ' ', at)
      }
      case 'vfill':
        return
      case 'centering':
        this.align = 'center'
        return
      case 'raggedright':
        this.align = 'left'
        return
      case 'raggedleft':
        this.align = 'right'
        return
      case 'caption':
        return this.caption(at, emit)
      case 'includegraphics': {
        this.eatStar()
        this.readOptionalRaw()
        const raw = this.readArgRaw('\\includegraphics')
        this.warn('images', at)
        return emit.inline(
          `<span class="latex-image" title="${escapeHtml(diagnosticMessage(this.uiLocale, 'images'))}">${escapeHtml(raw.text)}</span>`,
          at
        )
      }
      case 'selectlanguage': {
        const raw = this.readArgRaw('\\selectlanguage')
        const lang = BABEL_LANGUAGES[raw.text.trim()]
        if (lang) this.lang = lang
        return
      }
      case 'newcommand':
      case 'renewcommand':
      case 'providecommand':
        return this.defineMacro(at, name === 'providecommand')
      case 'def':
        return this.def(at)
      case 'DeclareMathOperator':
        return this.declareOperator(at)
      case 'begin':
        return this.begin(at, emit)
      case 'ensuremath': {
        const raw = this.readArgRaw('\\ensuremath')
        return emit.inline(this.inlineMath(raw.text, raw.start), at)
      }
      default:
        this.unsupported(`\\${name}`, at, emit)
    }
  }

  private unsupported(command: string, at: number, emit: Emit): void {
    this.warn('unsupported-command', at, [command])
    const title = escapeHtml(diagnosticMessage(this.uiLocale, 'unsupported-command', [command]))
    emit.inline(`<span class="latex-unsupported" title="${title}">${escapeHtml(command)}</span>`, at)
  }

  private symbol(ch: string, at: number, emit: Emit): void {
    switch (ch) {
      case '\\':
        this.eatStar()
        this.readOptionalRaw()
        return emit.inline('<br>', at)
      case '%':
      case '$':
      case '&':
      case '#':
      case '_':
      case '{':
      case '}':
        return emit.text(ch, at)
      case ' ':
      case '\n':
      case '\t':
        return emit.text(' ', at)
      case ',':
        return emit.text('\u2009', at)
      case ';':
      case ':':
      case '>':
        return emit.text('\u2005', at)
      case '!':
      case '/':
      case '@':
        return
      case '-':
        return emit.text('\u00ad', at)
      case '[':
        return this.delimitedMath('\\]', true, at, emit)
      case '(':
        return this.delimitedMath('\\)', false, at, emit)
      default:
        if (ch in ACCENTS) return this.accent(ch, at, emit)
        this.unsupported(`\\${ch}`, at, emit)
    }
  }

  private accent(name: string, at: number, emit: Emit): void {
    const raw = this.readArgRaw(`\\${name}`)
    if (!raw.ok) return
    let base = raw.text.trim()
    if (base === '\\i') base = 'i'
    else if (base === '\\j') base = 'j'
    if (base.startsWith('\\')) return this.unsupported(`\\${name}`, at, emit)
    const first = Array.from(base)[0] ?? ' '
    emit.text((first + ACCENTS[name]).normalize('NFC') + base.slice(first.length), at)
  }

  private expand(name: string, macro: Macro, at: number, emit: Emit): void {
    if (this.expansion >= MAX_EXPANSION) {
      this.error('macro-loop', at, [`\\${name}`])
      return
    }
    const args: string[] = []
    if (macro.optional !== null) {
      const opt = this.readOptionalRaw()
      args.push(opt ? opt.text : macro.optional)
    }
    while (args.length < macro.params) args.push(this.readArgRaw(`\\${name}`).text)
    const body = macro.body.replace(/#([1-9])/g, (_, d: string) => args[Number(d) - 1] ?? '')
    this.expansion++
    try {
      this.withSource(body, this.lineOf(at), () => this.loop(emit, {}))
    } finally {
      this.expansion--
    }
  }

  private defineMacro(at: number, provide: boolean): void {
    this.eatStar()
    const nameArg = this.readArgRaw('\\newcommand')
    const name = nameArg.text.trim().replace(/^\\/, '')
    const count = this.readOptionalRaw()
    const optional = this.readOptionalRaw()
    const body = this.readArgRaw('\\newcommand')
    if (!name || !nameArg.ok) return
    if (provide && this.macros.has(name)) return
    const params = Math.max(0, Math.min(9, parseInt(count?.text ?? '0', 10) || 0))
    this.setMacro(name, { params, optional: optional ? optional.text : null, body: body.text })
    if (!/^[A-Za-z]+$/.test(name)) this.warn('unsupported-command', at, [`\\${name}`])
  }

  private def(at: number): void {
    const nameArg = this.readArgRaw('\\def')
    const name = nameArg.text.trim().replace(/^\\/, '')
    const params = /^(#\d)*/.exec(this.src.slice(this.pos))?.[0] ?? ''
    this.pos += params.length
    const body = this.readArgRaw('\\def')
    if (!name) return this.error('missing-argument', at, ['\\def'])
    this.setMacro(name, { params: params.length / 2, optional: null, body: body.text })
  }

  private declareOperator(at: number): void {
    const star = this.eatStar()
    const nameArg = this.readArgRaw('\\DeclareMathOperator')
    const text = this.readArgRaw('\\DeclareMathOperator')
    const name = nameArg.text.trim()
    if (!name.startsWith('\\')) return this.error('missing-argument', at, ['\\DeclareMathOperator'])
    this.katexMacros[name] = `\\operatorname${star ? '*' : ''}{${text.text}}`
    this.macrosKey = JSON.stringify(this.katexMacros)
  }

  private setMacro(name: string, macro: Macro): void {
    this.macros.set(name, macro)
    this.katexMacros[`\\${name}`] = macro.body
    this.macrosKey = JSON.stringify(this.katexMacros)
  }

  private documentClass(at: number): void {
    this.readOptionalRaw()
    const raw = this.readArgRaw('\\documentclass')
    const name = raw.text.trim()
    if (raw.ok && name !== 'article') this.warn('unsupported-class', at, [name])
  }

  private usePackage(at: number): void {
    const options = this.readOptionalRaw()
    const raw = this.readArgRaw('\\usepackage')
    if (this.inDocument) this.warn('package-in-body', at)
    for (const name of raw.text
      .split(',')
      .map((p) => p.replace(/%[^\n]*/g, '').trim())
      .filter(Boolean)) {
      if (name === 'babel' && options) {
        for (const option of options.text.split(',').map((o) => o.trim())) {
          const lang = BABEL_LANGUAGES[option]
          if (lang) this.lang = lang
        }
      }
      if (!BUILT_IN_PACKAGES.has(name)) this.warn('ignored-package', at, [name])
    }
  }

  private author(): void {
    const raw = this.readArgRaw('\\author')
    const after = this.pos
    const authors: string[] = []
    const re = /\\and(?![A-Za-z])/g
    let from = raw.start
    const pieces: [number, number][] = []
    const text = raw.text
    for (let m = re.exec(text); m; m = re.exec(text)) {
      pieces.push([from, raw.start + m.index])
      from = raw.start + m.index + m[0].length
    }
    pieces.push([from, raw.start + text.length])
    for (const [a, b] of pieces) {
      const html = this.scoped(undefined, () => this.parseRange(a, b))
      if (html.trim()) authors.push(html.trim())
    }
    this.pos = after
    this.authors = authors
  }

  private titleBlock(at: number): string {
    const parts: string[] = []
    if (this.title) parts.push(`<h1 class="latex-title">${this.title}</h1>`)
    if (this.authors?.length) {
      parts.push(`<div class="latex-authors">${this.authors.map((a) => `<span class="latex-author">${a}</span>`).join('')}</div>`)
    }
    const date = this.date ?? escapeHtml(DOCUMENT_WORDS[this.lang].date(this.now))
    if (date.trim()) parts.push(`<div class="latex-date">${date}</div>`)
    return `<header class="latex-titleblock" data-line="${this.lineOf(at)}">${parts.join('')}</header>`
  }

  private sectionNumber(level: number): string {
    const first = this.appendix ? String.fromCharCode(64 + Math.min(26, Math.max(1, this.sec[0]))) : String(this.sec[0])
    return [first, ...this.sec.slice(1, level).map(String)].join('.')
  }

  private heading(level: 1 | 2 | 3, at: number, emit: Emit): void {
    const star = this.eatStar()
    this.readOptionalRaw()
    const html = this.parseArg(['\\section', '\\subsection', '\\subsubsection'][level - 1])
    let num = ''
    if (!star) {
      this.sec[level - 1]++
      for (let k = level; k < 3; k++) this.sec[k] = 0
      num = this.sectionNumber(level)
      this.labelTarget = num
      this.toc.push({ level, num, html })
    }
    const tag = `h${level + 1}`
    const number = num ? `<span class="latex-secnum">${num}</span>` : ''
    emit.block(`<${tag} class="latex-h${level}" data-line="${this.lineOf(at)}">${number}${html}</${tag}>`)
    this.noindentNext = true
  }

  private runIn(at: number, emit: Emit): void {
    this.eatStar()
    this.readOptionalRaw()
    const html = this.parseArg('\\paragraph', { weight: 'bf' })
    emit.par()
    emit.inline(`<span class="latex-runin">${html}</span> `, at)
  }

  private footnote(at: number, emit: Emit): void {
    this.readOptionalRaw()
    const n = ++this.footnoteCount
    const html = this.parseArg('\\footnote')
    this.footnotes.push({ n, html, line: this.lineOf(at) })
    emit.inline(`<sup class="latex-fnmark">${n}</sup>`, at)
  }

  private label(at: number): void {
    const raw = this.readArgRaw('\\label')
    const name = raw.text.trim()
    if (!raw.ok || !name) return
    if (this.labels.has(name)) this.warn('duplicate-label', at, [name])
    this.labels.set(name, this.labelTarget)
  }

  private caption(at: number, emit: Emit): void {
    this.readOptionalRaw()
    const kind = this.float ?? 'table'
    const n = kind === 'table' ? ++this.table : ++this.figure
    this.labelTarget = String(n)
    const html = this.parseArg('\\caption')
    const word = DOCUMENT_WORDS[this.lang][kind]
    emit.block(
      `<div class="latex-caption" data-line="${this.lineOf(at)}"><span class="latex-caption-label">${word} ${n}:</span> ${html}</div>`
    )
  }

  private verb(at: number, emit: Emit): void {
    if (this.src[this.pos] === '*') this.pos++
    const delim = this.src[this.pos]
    const end = delim ? this.src.indexOf(delim, this.pos + 1) : -1
    const newline = this.src.indexOf('\n', this.pos + 1)
    if (!delim || /[\sA-Za-z]/.test(delim) || end < 0 || end > this.limit || (newline >= 0 && newline < end)) {
      this.error('missing-argument', at, ['\\verb'])
      return
    }
    emit.inline(`<code class="latex-verb">${escapeHtml(this.src.slice(this.pos + 1, end))}</code>`, at)
    this.pos = end + 1
  }

  // ---- math

  /** `\ref` and `\eqref` inside a formula, as text: KaTeX cannot see the document's labels. */
  private mathRefs(tex: string): string {
    return tex.replace(/\\(eq)?ref\s*\{([^{}]*)\}/g, (_, eq: string | undefined, name: string) => {
      const value = this.labels.get(name.trim()) ?? this.preLabels.get(name.trim())
      if (value === undefined) this.missedMathRef = true
      const shown = value === undefined || value === '' ? '??' : value
      return `\\text{${eq ? `(${shown})` : shown}}`
    })
  }

  private renderFormula(
    tex: string,
    display: boolean,
    body: string,
    bodyStart: number,
    prefixLength: number,
    insertions: Insertion[]
  ): string {
    const outcome = renderMath(this.engine, this.mathRefs(tex), display, this.katexMacros, this.cache, this.macrosKey)
    if (outcome.problem) {
      // An error at the end of the input (a brace never closed) is put on the formula's last character.
      const last = Math.max(0, body.trimEnd().length - 1)
      const offset = Math.min(last, Math.max(0, mapBack(outcome.problem.offset - prefixLength, insertions)))
      const pos = bodyStart + offset
      if (outcome.problem.kind === 'unsupported') this.warn('math-unsupported', pos, [outcome.problem.detail])
      else this.error('math-error', pos, [outcome.problem.detail.replace(/^KaTeX parse error: /, '')])
    }
    return outcome.html
  }

  private inlineMath(body: string, bodyStart: number): string {
    const cleaned = body.replace(LABEL_RE, blank)
    return `<span class="latex-math">${this.renderFormula(cleaned, false, body, bodyStart, 0, [])}</span>`
  }

  private dollarMath(emit: Emit): void {
    const at = this.pos
    const display = this.src[at + 1] === '$'
    const open = display ? 2 : 1
    let close = -1
    for (let j = at + open; j < this.limit; j++) {
      const ch = this.src[j]
      if (ch === '\\') j++
      else if (ch === '$') {
        if (!display || this.src[j + 1] === '$') close = j
        break
      } else if (ch === '\n' && /^\n[ \t]*\n/.test(this.src.slice(j, j + 40))) break
    }
    if (close < 0) {
      this.error('unclosed-math', at, [display ? '$$' : '$'])
      emit.text(display ? '$$' : '$', at)
      this.pos = at + open
      return
    }
    this.pos = close + open
    const body = this.src.slice(at + open, close)
    if (display) this.display('displaymath', body, at + open, at, emit)
    else emit.inline(this.inlineMath(body, at + open), at)
  }

  private delimitedMath(closer: string, display: boolean, at: number, emit: Emit): void {
    const close = this.src.indexOf(closer, this.pos)
    if (close < 0 || close >= this.limit) {
      this.error('unclosed-math', at, [display ? '\\[' : '\\('])
      return
    }
    const body = this.src.slice(this.pos, close)
    const bodyStart = this.pos
    this.pos = close + closer.length
    if (display) this.display('displaymath', body, bodyStart, at, emit)
    else emit.inline(this.inlineMath(body, bodyStart), at)
  }

  /** A displayed formula; numbered environments get a \tag per row and their labels. */
  private display(env: string, body: string, bodyStart: number, at: number, emit: Emit): void {
    const numbered = !env.endsWith('*') && env !== 'displaymath'
    const labelsOf = (text: string): string[] => Array.from(text.matchAll(LABEL_RE), (m) => m[1].trim())
    const setLabels = (names: string[], value: string, pos: number): void => {
      for (const name of names) {
        if (this.labels.has(name)) this.warn('duplicate-label', pos, [name])
        this.labels.set(name, value)
      }
    }
    let html: string
    const kateEnv = NUMBERED_MULTI[env]
    if (kateEnv) {
      const insertions: Insertion[] = []
      let edited = ''
      const rows = splitRows(body)
      const lastNonEmpty = rows.reduce((last, row, i) => (/\S/.test(row.text) ? i : last), -1)
      rows.forEach((row, i) => {
        const names = labelsOf(row.text)
        let text = row.text.replace(LABEL_RE, blank)
        const skip = NONUMBER_RE.test(text)
        NONUMBER_RE.lastIndex = 0
        text = text.replace(NONUMBER_RE, blank)
        const tag = TAG_RE.exec(text)
        let value = ''
        const multline = env === 'multline'
        if (tag) value = tag[1]
        else if (numbered && !skip && /\S/.test(text) && (!multline || i === lastNonEmpty)) {
          value = String(++this.eq)
          edited += text
          const insert = `\\tag{${value}}`
          insertions.push({ at: edited.length, length: insert.length })
          edited += insert + row.sep
          setLabels(names, value, bodyStart)
          return
        }
        setLabels(names, value, bodyStart)
        edited += text + row.sep
      })
      const prefix = `\\begin{${kateEnv}}`
      html = this.renderFormula(`${prefix}${edited}\\end{${kateEnv}}`, true, body, bodyStart, prefix.length, insertions)
    } else {
      const names = labelsOf(body)
      let text = body.replace(LABEL_RE, blank)
      const skip = NONUMBER_RE.test(text)
      NONUMBER_RE.lastIndex = 0
      text = text.replace(NONUMBER_RE, blank)
      const tag = TAG_RE.exec(text)
      const insertions: Insertion[] = []
      let value = tag ? tag[1] : ''
      if (!tag && numbered && !skip) {
        value = String(++this.eq)
        const insert = `\\tag{${value}}`
        insertions.push({ at: text.length, length: insert.length })
        text += insert
      }
      setLabels(names, value, bodyStart)
      html = this.renderFormula(text, true, body, bodyStart, 0, insertions)
    }
    emit.block(`<div class="latex-display" data-line="${this.lineOf(at)}">${html}</div>`)
    this.afterDisplay = true
  }

  // ---- environments

  /**
   * After an environment's body: its `\end`. Anything else (the `\end` of an environment around
   * it, or the end of the text) means it was never closed, which is said at its `\begin`.
   */
  private closeEnv(name: string, line: number): void {
    const end = this.peekEnd()
    if (end && end.name === name) {
      this.pos = end.end
      return
    }
    this.error('unclosed-environment', { line }, [name])
  }

  /** Parses an environment's body in `mode`, inside its own group. */
  private envBody(name: string, line: number, mode: Mode, stop: Stop = {}): string {
    this.envs.push({ name, line })
    const html = this.scoped(undefined, () => this.parseSeq(mode, stop))
    this.closeEnv(name, line)
    this.envs.pop()
    return html
  }

  private begin(at: number, emit: Emit): void {
    const raw = this.readArgRaw('\\begin')
    const name = raw.text.trim()
    const line = this.lineOf(at)
    if (!raw.ok || !name) return
    if (name === 'document') return this.document(line)
    if (SINGLE_DISPLAY.has(name) || name in NUMBERED_MULTI) return this.mathEnv(name, at, emit)
    switch (name) {
      case 'math': {
        const body = this.rawBody(name, line)
        if (body) emit.inline(this.inlineMath(body.text, body.start), at)
        return
      }
      case 'itemize':
      case 'enumerate':
      case 'description':
        return emit.block(this.list(name, line))
      case 'tabular':
      case 'tabular*':
        return emit.block(this.tabular(name, line))
      case 'table':
      case 'table*':
      case 'figure':
      case 'figure*': {
        this.readOptionalRaw()
        const float = this.float
        this.float = name.startsWith('table') ? 'table' : 'figure'
        const html = this.envBody(name, line, 'block')
        this.float = float
        return emit.block(`<figure class="latex-float" data-line="${line}">${html}</figure>`)
      }
      case 'center':
      case 'flushleft':
      case 'flushright': {
        const html = this.scoped(undefined, () => {
          this.align = name === 'center' ? 'center' : name === 'flushleft' ? 'left' : 'right'
          return this.envBody(name, line, 'block')
        })
        return emit.block(`<div class="latex-${name}" data-line="${line}">${html}</div>`)
      }
      case 'quote':
      case 'quotation':
      case 'verse':
        return emit.block(`<blockquote class="latex-${name}" data-line="${line}">${this.envBody(name, line, 'block')}</blockquote>`)
      case 'abstract': {
        const html = this.envBody(name, line, 'block')
        return emit.block(
          `<div class="latex-abstract" data-line="${line}"><div class="latex-abstract-title">${DOCUMENT_WORDS[this.lang].abstract}</div>${html}</div>`
        )
      }
      case 'verbatim':
      case 'verbatim*':
      case 'lstlisting': {
        if (name === 'lstlisting') this.readOptionalRaw()
        const body = this.rawBody(name, line)
        if (!body) return
        const text = body.text.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '')
        return emit.block(`<pre class="latex-verbatim" data-line="${line}">${escapeHtml(text)}</pre>`)
      }
      default: {
        this.warn('unsupported-environment', at, [name])
        const html = this.envBody(name, line, 'block')
        return emit.block(`<div class="latex-unsupported-env" data-env="${escapeHtml(name)}" data-line="${line}">${html}</div>`)
      }
    }
  }

  /** The text up to `\end{name}`, which is consumed; null (and an error) when it never comes. */
  private rawBody(name: string, line: number): { text: string; start: number } | null {
    const closer = `\\end{${name}}`
    const close = this.src.indexOf(closer, this.pos)
    if (close < 0 || close >= this.limit) {
      this.error('unclosed-environment', { line }, [name])
      this.pos = this.limit
      return null
    }
    const start = this.pos
    this.pos = close + closer.length
    return { text: this.src.slice(start, close), start }
  }

  private mathEnv(name: string, at: number, emit: Emit): void {
    const line = this.lineOf(at)
    const closer = `\\end{${name}}`
    let close = this.src.indexOf(closer, this.pos)
    let end = close + closer.length
    if (close < 0 || close >= this.limit) {
      this.error('unclosed-environment', { line }, [name])
      const blankLine = /\n[ \t]*\n/.exec(this.src.slice(this.pos, this.limit))
      close = blankLine ? this.pos + blankLine.index : this.limit
      end = close
    }
    const start = this.pos
    this.pos = end
    this.display(name, this.src.slice(start, close), start, at, emit)
  }

  private document(line: number): void {
    if (this.inDocument) {
      this.warn('unsupported-environment', { line }, ['document'])
      return
    }
    this.inDocument = true
    this.envs.push({ name: 'document', line })
    this.body = this.parseSeq('block')
    this.closeEnv('document', line)
    this.envs.pop()
    this.inDocument = false
    this.documentEnded = true
    this.straySeen = false
  }

  private list(name: string, line: number): string {
    this.envs.push({ name, line })
    const items: string[] = []
    let count = 0
    const savedTarget = this.labelTarget
    while (true) {
      this.skipWs()
      if (this.pos >= this.limit) break
      const end = this.peekEnd()
      if (end && this.isOpenEnv(end.name)) break
      const at = this.pos
      let label: string | null = null
      if (this.peekName() === 'item') {
        this.pos += 5
        this.skipControlSpace()
        const opt = this.readOptionalRaw()
        if (opt) {
          const after = this.pos
          label = this.scoped(undefined, () => this.parseRange(opt.start, opt.start + opt.text.length))
          this.pos = after
        }
      } else if (end) {
        this.pos = end.end
        this.error('extra-end', at, [end.name])
        continue
      } else this.error('missing-item', at)
      count++
      if (name === 'enumerate') this.labelTarget = String(count)
      const body = this.scoped(undefined, () => this.parseSeq('block', { item: true }))
      const dataLine = `data-line="${this.lineOf(at)}"`
      if (name === 'description') {
        items.push(`<dt ${dataLine}>${label ?? ''}</dt><dd>${body}</dd>`)
      } else if (label !== null) {
        items.push(`<li class="latex-labeled" ${dataLine}><span class="latex-item-label">${label}</span>${body}</li>`)
      } else items.push(`<li ${dataLine}>${body}</li>`)
    }
    this.labelTarget = name === 'enumerate' ? savedTarget : this.labelTarget
    this.closeEnv(name, line)
    this.envs.pop()
    const tag = name === 'itemize' ? 'ul' : name === 'enumerate' ? 'ol' : 'dl'
    return `<${tag} class="latex-${name}" data-line="${line}">${items.join('')}</${tag}>`
  }

  private tabular(name: string, line: number): string {
    if (name === 'tabular*') this.readArgRaw('\\begin{tabular*}')
    this.readOptionalRaw()
    const spec = this.readArgRaw(`\\begin{${name}}`)
    const cols = parseColumns(spec.text)
    this.envs.push({ name, line })
    const rows: { cells: { html: string; span: number; col: Column | undefined }[]; top: boolean; line: number }[] = []
    let rules = 0
    let bottom = false
    const isRule = (n: string): boolean => n === 'hline' || n === 'toprule' || n === 'midrule' || n === 'bottomrule'
    while (true) {
      this.skipWs()
      const n = this.peekName()
      if (isRule(n)) {
        this.pos += 1 + n.length
        rules++
        continue
      }
      if (n === 'cline' || n === 'cmidrule') {
        this.pos += 1 + n.length
        this.readOptionalRaw()
        this.readArgRaw(`\\${n}`)
        rules++
        continue
      }
      const end = this.peekEnd()
      if (this.pos >= this.limit || (end && this.isOpenEnv(end.name))) {
        bottom = rules > 0
        break
      }
      const row = { cells: [] as { html: string; span: number; col: Column | undefined }[], top: rules > 0, line: this.lineOf(this.pos) }
      rules = 0
      let col = 0
      while (true) {
        while (this.pos < this.limit && /[ \t\n]/.test(this.src[this.pos])) this.pos++
        if (this.peekName() === 'multicolumn') {
          this.pos += 12
          const span = Math.max(1, Math.min(50, parseInt(this.readArgRaw('\\multicolumn').text, 10) || 1))
          const own = parseColumns(this.readArgRaw('\\multicolumn').text)[0]
          const html = this.parseArg('\\multicolumn')
          row.cells.push({ html, span, col: own })
          col += span
          // Whatever follows in the cell belongs to it.
          const rest = this.scoped(undefined, () => this.parseSeq('inline', { cell: true }))
          row.cells[row.cells.length - 1].html += rest
        } else {
          const html = this.scoped(undefined, () => this.parseSeq('inline', { cell: true }))
          row.cells.push({ html, span: 1, col: cols[col] })
          col++
        }
        if (this.src[this.pos] === '&') {
          this.pos++
          continue
        }
        if (this.peekName() === '\\') {
          this.pos += 2
          this.eatStar()
          this.readOptionalRaw()
        }
        break
      }
      if (row.cells.length > 1 || row.cells[0]?.html.trim()) rows.push(row)
    }
    this.closeEnv(name, line)
    this.envs.pop()
    const body = rows
      .map((row, r) => {
        const classes = [row.top ? 'latex-rule-top' : '', r === rows.length - 1 && bottom ? 'latex-rule-bottom' : '']
          .filter(Boolean)
          .join(' ')
        const cells = row.cells
          .map((cell) => {
            const c = [`latex-col-${cell.col?.align ?? 'l'}`]
            if (cell.col?.left) c.push('latex-rule-left')
            if (cell.col?.right) c.push('latex-rule-right')
            return `<td class="${c.join(' ')}"${cell.span > 1 ? ` colspan="${cell.span}"` : ''}>${cell.html.trim()}</td>`
          })
          .join('')
        return `<tr${classes ? ` class="${classes}"` : ''} data-line="${row.line}">${cells}</tr>`
      })
      .join('')
    const align = this.align ? ` latex-align-${this.align}` : ''
    return `<div class="latex-tabular-wrap${align}" data-line="${line}"><table class="latex-tabular"><tbody>${body}</tbody></table></div>`
  }

  // ---- the whole document

  run(): string {
    // Comments blanked, not removed: offsets must stay those of the source.
    const sansComments = this.src.replace(/(^|[^\\])(%[^\n]*)/g, (_, before: string, comment: string) => before + blank(comment))
    const hasBegin = /\\begin\s*\{document\}/.test(sansComments)
    const classMatch = /\\documentclass/.exec(sansComments)
    if (!hasBegin) {
      if (classMatch) this.error('missing-begin-document', classMatch.index)
      this.inDocument = true
      this.envs.push({ name: 'document', line: 1 })
      this.body = this.parseSeq('block')
      this.envs.pop()
      return this.body
    }
    this.parseSeq('block', {}, true)
    return this.body
  }

  /** A warning found after the parse (a reference to no label). */
  warnLine(code: DiagnosticCode, line: number, args: string[]): void {
    this.warn(code, { line }, args)
  }
}

/** Converts a LaTeX document to the preview's HTML, with what it could not do as diagnostics. */
export function convertLatex(source: string, options: ConvertOptions): LatexResult {
  let converter = new Converter(source, options)
  let body = converter.run()
  // A formula that refers to a label defined further down needs a second look.
  if (converter.missedMathRef && converter.labels.size) {
    const labels = converter.labels
    converter = new Converter(source, options, labels)
    body = converter.run()
  }
  const c = converter
  body = body.replace(/\u0000(\d+)\u0000/g, (_, index: string) => {
    const ref = c.refs[Number(index)]
    if (!ref) return '??'
    const value = c.labels.get(ref.name)
    if (value === undefined) {
      c.warnLine('undefined-reference', ref.line, [ref.name])
      return '??'
    }
    const shown = escapeHtml(value || '??')
    return ref.paren ? `(${shown})` : shown
  })
  body = body.replace(/\u0000TOC\u0000/g, () => {
    const entries = c.toc
      .map((e) => `<div class="latex-toc-entry latex-toc-${e.level}"><span class="latex-secnum">${e.num}</span>${e.html}</div>`)
      .join('')
    return `<div class="latex-toc-title">${DOCUMENT_WORDS[c.lang].contents}</div>${entries}`
  })
  const footnotes = c.footnotes.length
    ? `<footer class="latex-footnotes"><ol>${c.footnotes
        .map((f) => `<li value="${f.n}" data-line="${f.line}">${f.html}</li>`)
        .join('')}</ol></footer>`
    : ''
  c.finishDiagnostics()
  return {
    html: `<article class="latex-doc" lang="${c.lang}">${body}${footnotes}</article>`,
    diagnostics: c.diagnostics
  }
}
