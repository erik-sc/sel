// The syntax of formula properties: a hand-written tokenizer and a recursive-descent
// parser that turn the text of a formula into a small tree. Pure: no React, no store.
//
//   if(prop("Done"), "✓", format(prop("Price") * 1.2) + " €")
//
// The language is deliberately small: number, text and true / false literals, the
// operators below, function calls and `prop("Name")`. Nothing in the text is ever handed
// to `eval` or `Function`, and nothing it names can reach a JavaScript global or
// prototype: function names are looked up in a Map, property names with own-key lookups.
//
// Precedence, loosest first: or (||) · and (&&) · not (!) · comparisons (== != < <= > >=,
// not chainable) · + - · * / % · unary minus · ^ (right-associative, so -2^2 is -4).

/** Bounds that keep any formula cheap to parse and evaluate, whatever its text. */
export const FORMULA_LIMITS = {
  /** Longest formula text that is stored or parsed. */
  length: 4000,
  /** Deepest nesting of brackets, calls and operators. */
  depth: 64,
  /** Tallest tree (a long chain like 1 + 1 + … nests without brackets). */
  height: 200,
  /** Most nodes in one formula's tree. */
  nodes: 1000,
  /** Most steps one evaluation (with every formula it reads) may take. */
  steps: 50_000,
  /** Longest text a formula may build. */
  text: 10_000,
  /** Most formulas one formula may read through others (A reads B reads C...). */
  chain: 10
} as const

/** Something wrong with a formula, and where: offsets into its text, `end` exclusive. */
export interface FormulaProblem {
  message: string
  start: number
  end: number
}

export type TokenKind = 'number' | 'string' | 'name' | 'op' | '(' | ')' | ','

export interface Token {
  kind: TokenKind
  /** The source text of the token. */
  text: string
  /** A number's value, or a string's contents with its escapes resolved. */
  value?: number | string
  start: number
  end: number
}

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or'
export type UnaryOp = '-' | 'not'

interface Span {
  start: number
  end: number
}

export type FormulaNode =
  | ({ kind: 'number'; value: number } & Span)
  | ({ kind: 'text'; value: string } & Span)
  | ({ kind: 'boolean'; value: boolean } & Span)
  /** `prop("…")`: `ref` is what the quotes hold, a property id or name. */
  | ({ kind: 'prop'; ref: string } & Span)
  | ({ kind: 'call'; name: string; args: FormulaNode[] } & Span)
  | ({ kind: 'unary'; op: UnaryOp; operand: FormulaNode } & Span)
  | ({ kind: 'binary'; op: BinaryOp; left: FormulaNode; right: FormulaNode } & Span)

export type ParseResult = { ok: true; ast: FormulaNode | null } | { ok: false; error: FormulaProblem }
export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: FormulaProblem; tokens: Token[] }

class ParseError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number
  ) {
    super(message)
  }
}

const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '^', '<', '>', '!']
const ESCAPES: Record<string, string> = { '"': '"', "'": "'", '\\': '\\', n: '\n', t: '\t' }

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_')
}

function isNamePart(ch: string | undefined): boolean {
  return isNameStart(ch) || isDigit(ch)
}

/**
 * Splits a formula into tokens. On an error the tokens read so far come back too (the
 * editor and the rename-proof storage still use them).
 */
export function tokenize(text: string): TokenizeResult {
  const tokens: Token[] = []
  const fail = (message: string, start: number, end: number): TokenizeResult => ({
    ok: false,
    error: { message, start, end },
    tokens
  })
  if (text.length > FORMULA_LIMITS.length) {
    return fail(`A formula can be at most ${FORMULA_LIMITS.length} characters long`, FORMULA_LIMITS.length, text.length)
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ' ') {
      i++
      continue
    }
    const start = i
    if (isDigit(ch) || (ch === '.' && isDigit(text[i + 1]))) {
      while (isDigit(text[i])) i++
      if (text[i] === '.' && isDigit(text[i + 1])) {
        i++
        while (isDigit(text[i])) i++
      }
      if (
        (text[i] === 'e' || text[i] === 'E') &&
        (isDigit(text[i + 1]) || ((text[i + 1] === '+' || text[i + 1] === '-') && isDigit(text[i + 2])))
      ) {
        i += 2
        while (isDigit(text[i])) i++
      }
      const source = text.slice(start, i)
      const value = Number(source)
      if (!isFinite(value)) return fail('This number is too large', start, i)
      tokens.push({ kind: 'number', text: source, value, start, end: i })
      continue
    }
    if (ch === '"' || ch === "'") {
      let value = ''
      i++
      let closed = false
      while (i < text.length) {
        const c = text[i]
        if (c === ch) {
          closed = true
          i++
          break
        }
        if (c === '\\') {
          const next = text[i + 1]
          if (next === undefined || !Object.hasOwn(ESCAPES, next)) {
            return fail(`Unknown escape "\\${next ?? ''}" (use \\" \\' \\\\ \\n or \\t)`, i, Math.min(i + 2, text.length))
          }
          value += ESCAPES[next]
          i += 2
          continue
        }
        value += c
        i++
      }
      if (!closed) return fail('This text has no closing quote', start, text.length)
      tokens.push({ kind: 'string', text: text.slice(start, i), value, start, end: i })
      continue
    }
    if (isNameStart(ch)) {
      while (isNamePart(text[i])) i++
      tokens.push({ kind: 'name', text: text.slice(start, i), start, end: i })
      continue
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ kind: ch, text: ch, start, end: i + 1 })
      i++
      continue
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i))
    if (op) {
      tokens.push({ kind: 'op', text: op, start, end: i + op.length })
      i += op.length
      continue
    }
    if (ch === '=') return fail('Use == to compare two values', start, start + 1)
    if (ch === '&' || ch === '|') return fail(`Use ${ch}${ch} (or ${ch === '&' ? 'and' : 'or'})`, start, start + 1)
    return fail(`Unexpected character "${ch}"`, start, start + 1)
  }
  return { ok: true, tokens }
}

/** Text in double quotes that reads back as `text`. */
export function quoteText(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`
}

const COMPARISONS: readonly string[] = ['==', '!=', '<', '<=', '>', '>=']
const KEYWORDS: readonly string[] = ['and', 'or', 'not', 'true', 'false']

class Parser {
  private index = 0
  private depth = 0
  private nodes = 0

  constructor(
    private readonly tokens: Token[],
    private readonly length: number,
    private readonly isFunction: (name: string) => boolean
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private next(): Token | undefined {
    return this.tokens[this.index++]
  }

  private isOp(...ops: string[]): boolean {
    const token = this.peek()
    if (!token) return false
    if (token.kind === 'op') return ops.includes(token.text)
    return token.kind === 'name' && ops.includes(token.text)
  }

  private node<T extends FormulaNode>(node: T): T {
    if (++this.nodes > FORMULA_LIMITS.nodes) throw new ParseError('This formula is too long', node.start, node.end)
    return node
  }

  private unexpected(token: Token | undefined, expected: string): ParseError {
    if (!token) return new ParseError(`The formula ends early: ${expected}`, this.length, this.length)
    return new ParseError(`Unexpected "${token.text}": ${expected}`, token.start, token.end)
  }

  parse(): FormulaNode | null {
    if (!this.tokens.length) return null
    const ast = this.expression()
    const extra = this.peek()
    if (extra) throw this.unexpected(extra, extra.kind === ')' ? 'there is no "(" for it' : 'expected an operator or the end')
    return ast
  }

  private expression(): FormulaNode {
    if (++this.depth > FORMULA_LIMITS.depth) {
      const token = this.peek()
      throw new ParseError('This formula is nested too deeply', token?.start ?? this.length, token?.end ?? this.length)
    }
    const out = this.or()
    this.depth--
    return out
  }

  private binary(op: BinaryOp, left: FormulaNode, right: FormulaNode): FormulaNode {
    return this.node({ kind: 'binary', op, left, right, start: left.start, end: right.end })
  }

  private or(): FormulaNode {
    let left = this.and()
    while (this.isOp('or', '||')) {
      this.next()
      left = this.binary('or', left, this.and())
    }
    return left
  }

  private and(): FormulaNode {
    let left = this.not()
    while (this.isOp('and', '&&')) {
      this.next()
      left = this.binary('and', left, this.not())
    }
    return left
  }

  private not(): FormulaNode {
    if (this.isOp('not', '!')) {
      const token = this.next() as Token
      this.enter(token)
      const operand = this.not()
      this.depth--
      return this.node({ kind: 'unary', op: 'not', operand, start: token.start, end: operand.end })
    }
    return this.comparison()
  }

  private comparison(): FormulaNode {
    const left = this.additive()
    const token = this.peek()
    if (!token || token.kind !== 'op' || !COMPARISONS.includes(token.text)) return left
    this.next()
    const node = this.binary(token.text as BinaryOp, left, this.additive())
    const again = this.peek()
    if (again?.kind === 'op' && COMPARISONS.includes(again.text)) {
      throw new ParseError('Comparisons cannot be chained: join them with and', again.start, again.end)
    }
    return node
  }

  private additive(): FormulaNode {
    let left = this.multiplicative()
    while (this.isOp('+', '-')) {
      const op = (this.next() as Token).text as BinaryOp
      left = this.binary(op, left, this.multiplicative())
    }
    return left
  }

  private multiplicative(): FormulaNode {
    let left = this.unary()
    while (this.isOp('*', '/', '%')) {
      const op = (this.next() as Token).text as BinaryOp
      left = this.binary(op, left, this.unary())
    }
    return left
  }

  private enter(token: Token): void {
    if (++this.depth > FORMULA_LIMITS.depth) throw new ParseError('This formula is nested too deeply', token.start, token.end)
  }

  private unary(): FormulaNode {
    if (this.isOp('-')) {
      const token = this.next() as Token
      this.enter(token)
      const operand = this.unary()
      this.depth--
      return this.node({ kind: 'unary', op: '-', operand, start: token.start, end: operand.end })
    }
    return this.power()
  }

  private power(): FormulaNode {
    const base = this.primary()
    if (!this.isOp('^')) return base
    const token = this.next() as Token
    this.enter(token)
    // The exponent may carry its own sign (2^-1), and `^` groups to the right (2^3^2 = 2^9).
    const exponent = this.unary()
    this.depth--
    return this.binary('^', base, exponent)
  }

  private primary(): FormulaNode {
    const token = this.next()
    if (!token) throw this.unexpected(token, 'expected a value')
    switch (token.kind) {
      case 'number':
        return this.node({ kind: 'number', value: token.value as number, start: token.start, end: token.end })
      case 'string':
        return this.node({ kind: 'text', value: token.value as string, start: token.start, end: token.end })
      case '(': {
        const inner = this.expression()
        const close = this.next()
        if (close?.kind !== ')') throw this.unexpected(close, 'expected ")"')
        return inner
      }
      case 'name':
        return this.name(token)
      default:
        throw this.unexpected(token, 'expected a value')
    }
  }

  private name(token: Token): FormulaNode {
    const name = token.text
    if (name === 'true' || name === 'false') {
      return this.node({ kind: 'boolean', value: name === 'true', start: token.start, end: token.end })
    }
    if (this.peek()?.kind !== '(') {
      if (KEYWORDS.includes(name)) throw new ParseError(`"${name}" needs a value on both sides`, token.start, token.end)
      if (this.isFunction(name)) throw new ParseError(`${name} is a function: write ${name}(…)`, token.start, token.end)
      throw new ParseError(`Unknown name "${name}". To read a property, write prop("${name}")`, token.start, token.end)
    }
    this.next()
    if (name === 'prop') {
      const ref = this.next()
      const close = this.next()
      if (ref?.kind !== 'string' || close?.kind !== ')') {
        const end = close?.end ?? ref?.end ?? this.length
        throw new ParseError('prop() takes the name of a property in quotes, like prop("Price")', token.start, end)
      }
      return this.node({ kind: 'prop', ref: ref.value as string, start: token.start, end: close.end })
    }
    this.enter(token)
    const args: FormulaNode[] = []
    if (this.peek()?.kind === ')') {
      const close = this.next() as Token
      this.depth--
      return this.node({ kind: 'call', name, args, start: token.start, end: close.end })
    }
    for (;;) {
      args.push(this.expression())
      const sep = this.next()
      if (sep?.kind === ')') {
        this.depth--
        return this.node({ kind: 'call', name, args, start: token.start, end: sep.end })
      }
      if (sep?.kind !== ',') throw this.unexpected(sep, `expected "," or ")" to close ${name}(`)
      if (this.peek()?.kind === ')') {
        const close = this.peek() as Token
        throw new ParseError('Remove the "," before ")"', close.start, close.end)
      }
    }
  }
}

function heightOf(node: FormulaNode): number {
  switch (node.kind) {
    case 'unary':
      return 1 + heightOf(node.operand)
    case 'binary':
      return 1 + Math.max(heightOf(node.left), heightOf(node.right))
    case 'call':
      return 1 + node.args.reduce((max, arg) => Math.max(max, heightOf(arg)), 0)
    default:
      return 1
  }
}

/**
 * Parses a formula. A blank formula parses to null (it gives no value). `isFunction` tells
 * the parser which names are functions, for better messages only.
 */
export function parseFormula(text: string, isFunction: (name: string) => boolean = () => false): ParseResult {
  if (typeof text !== 'string') return { ok: true, ast: null }
  const lexed = tokenize(text)
  if (!lexed.ok) return { ok: false, error: lexed.error }
  try {
    const ast = new Parser(lexed.tokens, text.length, isFunction).parse()
    if (ast && heightOf(ast) > FORMULA_LIMITS.height) {
      return { ok: false, error: { message: 'This formula is nested too deeply', start: ast.start, end: ast.end } }
    }
    return { ok: true, ast }
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: { message: error.message, start: error.start, end: error.end } }
    // A stack overflow or the like: never thrown at the caller.
    return { ok: false, error: { message: 'This formula cannot be read', start: 0, end: text.length } }
  }
}

/** Where a `prop("…")` reference sits in a formula's tokens: the quoted string's span and contents. */
export interface PropReference {
  ref: string
  start: number
  end: number
}

/** Every `prop("…")` in the text, found on the tokens (so it works on a formula with errors further on). */
export function propReferences(text: string): PropReference[] {
  const { tokens } = tokenize(text)
  const out: PropReference[] = []
  for (let i = 0; i + 3 < tokens.length; i++) {
    const [name, open, ref, close] = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]]
    if (name?.kind === 'name' && name.text === 'prop' && open?.kind === '(' && ref?.kind === 'string' && close?.kind === ')') {
      out.push({ ref: ref.value as string, start: ref.start, end: ref.end })
    }
  }
  return out
}

/** The text with each `prop("…")` reference replaced by `replace(ref)` (null: left as written). */
export function rewriteReferences(text: string, replace: (ref: string) => string | null): string {
  if (typeof text !== 'string') return ''
  let out = ''
  let at = 0
  for (const reference of propReferences(text)) {
    const next = replace(reference.ref)
    if (next === null) continue
    out += text.slice(at, reference.start) + quoteText(next)
    at = reference.end
  }
  return at === 0 ? text : out + text.slice(at)
}

/** 1-based line and column of an offset, for messages. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}
