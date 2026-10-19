import { describe, expect, it } from 'vitest'
import {
  FORMULA_LIMITS,
  lineColumn,
  parseFormula,
  propReferences,
  quoteText,
  rewriteReferences,
  tokenize,
  type FormulaNode
} from './formulaSyntax'

/** The tree as a compact string: (op a b), f(a, b), prop[ref]. */
function show(node: FormulaNode | null): string {
  if (!node) return '∅'
  switch (node.kind) {
    case 'number':
      return String(node.value)
    case 'text':
      return JSON.stringify(node.value)
    case 'boolean':
      return String(node.value)
    case 'prop':
      return `prop[${node.ref}]`
    case 'unary':
      return `(${node.op} ${show(node.operand)})`
    case 'binary':
      return `(${node.op} ${show(node.left)} ${show(node.right)})`
    case 'call':
      return `${node.name}(${node.args.map(show).join(', ')})`
  }
}

function tree(text: string): string {
  const result = parseFormula(text, (name) => ['if', 'round', 'now'].includes(name))
  if (!result.ok) throw new Error(`parse failed: ${result.error.message}`)
  return show(result.ast)
}

function problem(text: string): { message: string; start: number; end: number } {
  const result = parseFormula(text, (name) => ['if', 'round', 'now'].includes(name))
  if (result.ok) throw new Error(`expected an error for ${text}`)
  return result.error
}

describe('the formula tokenizer', () => {
  it('reads numbers, texts, names, operators and punctuation with their places', () => {
    const result = tokenize('round(1.5e2, .5) + "a\\"b" <= x')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.map((t) => [t.kind, t.text])).toEqual([
      ['name', 'round'],
      ['(', '('],
      ['number', '1.5e2'],
      [',', ','],
      ['number', '.5'],
      [')', ')'],
      ['op', '+'],
      ['string', '"a\\"b"'],
      ['op', '<='],
      ['name', 'x']
    ])
    expect(result.tokens[2].value).toBe(150)
    expect(result.tokens[4].value).toBe(0.5)
    expect(result.tokens[7].value).toBe('a"b')
    expect(result.tokens[8]).toMatchObject({ start: 26, end: 28 })
  })

  it('accepts both quotes and the usual escapes, and nothing else', () => {
    const result = tokenize(`'it\\'s' "tab\\tnew\\nline\\\\"`)
    expect(result.ok && result.tokens.map((t) => t.value)).toEqual(["it's", 'tab\tnew\nline\\'])
    expect(tokenize('"\\x"')).toMatchObject({ ok: false, error: { message: expect.stringContaining('Unknown escape'), start: 1 } })
    expect(tokenize('"open')).toMatchObject({ ok: false, error: { message: 'This text has no closing quote', start: 0 } })
  })

  it('explains the characters it does not take', () => {
    expect(tokenize('a = b')).toMatchObject({ ok: false, error: { message: 'Use == to compare two values', start: 2, end: 3 } })
    expect(tokenize('a & b')).toMatchObject({ ok: false, error: { message: expect.stringContaining('&&') } })
    expect(tokenize('a ; b')).toMatchObject({ ok: false, error: { message: 'Unexpected character ";"', start: 2 } })
    expect(tokenize('1e999')).toMatchObject({ ok: false, error: { message: 'This number is too large' } })
  })

  it('keeps the tokens read before an error', () => {
    const result = tokenize('prop("A") + "open')
    expect(result.ok).toBe(false)
    expect(result.tokens.map((t) => t.text)).toEqual(['prop', '(', '"A"', ')', '+'])
  })

  it('refuses a formula longer than the limit', () => {
    const result = tokenize('1'.repeat(FORMULA_LIMITS.length + 1))
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('at most') } })
  })
})

describe('the formula parser', () => {
  it('follows the usual precedence', () => {
    expect(tree('1 + 2 * 3')).toBe('(+ 1 (* 2 3))')
    expect(tree('(1 + 2) * 3')).toBe('(* (+ 1 2) 3)')
    expect(tree('1 - 2 - 3')).toBe('(- (- 1 2) 3)')
    expect(tree('8 / 4 % 3')).toBe('(% (/ 8 4) 3)')
    expect(tree('2 ^ 3 ^ 2')).toBe('(^ 2 (^ 3 2))')
    expect(tree('-2 ^ 2')).toBe('(- (^ 2 2))')
    expect(tree('2 ^ -1')).toBe('(^ 2 (- 1))')
    expect(tree('--1')).toBe('(- (- 1))')
    expect(tree('1 + 2 > 2 and true')).toBe('(and (> (+ 1 2) 2) true)')
    expect(tree('a() or b() and c()')).toBe('(or a() (and b() c()))')
    expect(tree('not 1 == 2')).toBe('(not (== 1 2))')
    expect(tree('!true || false && true')).toBe('(or (not true) (and false true))')
    expect(tree('"a" + "b" == "ab"')).toBe('(== (+ "a" "b") "ab")')
  })

  it('reads calls, property references and literals', () => {
    expect(tree('if(prop("Done"), "yes", "no")')).toBe('if(prop[Done], "yes", "no")')
    expect(tree('now()')).toBe('now()')
    expect(tree("prop('It\\'s')")).toBe("prop[It's]")
    expect(tree('true')).toBe('true')
    expect(tree('  ')).toBe('∅')
    expect(tree('1\n+\n2')).toBe('(+ 1 2)')
  })

  it('records where each node is', () => {
    const result = parseFormula('1 + prop("A")')
    expect(result.ok && result.ast).toMatchObject({ kind: 'binary', start: 0, end: 13, right: { kind: 'prop', start: 4, end: 13 } })
  })

  it('reports the first problem and where it is', () => {
    expect(problem('1 +')).toMatchObject({ message: 'The formula ends early: expected a value', start: 3 })
    expect(problem('(1 + 2')).toMatchObject({ message: 'The formula ends early: expected ")"' })
    expect(problem('1 + 2)')).toMatchObject({ message: expect.stringContaining('there is no "("'), start: 5, end: 6 })
    expect(problem('1 2')).toMatchObject({ message: expect.stringContaining('expected an operator'), start: 2 })
    expect(problem('round(1,)')).toMatchObject({ message: 'Remove the "," before ")"', start: 8 })
    expect(problem('round(1 2)')).toMatchObject({ message: expect.stringContaining('expected "," or ")"') })
    expect(problem('1 < 2 < 3')).toMatchObject({ message: expect.stringContaining('cannot be chained'), start: 6 })
    expect(problem('Price * 2')).toMatchObject({
      message: 'Unknown name "Price". To read a property, write prop("Price")',
      start: 0,
      end: 5
    })
    expect(problem('round + 1')).toMatchObject({ message: 'round is a function: write round(…)' })
    expect(problem('prop(Price)')).toMatchObject({ message: expect.stringContaining('in quotes') })
    expect(problem('prop("A", "B")')).toMatchObject({ message: expect.stringContaining('in quotes') })
    expect(problem('prop()')).toMatchObject({ message: expect.stringContaining('in quotes') })
    expect(problem('and')).toMatchObject({ message: '"and" needs a value on both sides' })
  })

  it('stops at the nesting, height and size limits instead of overflowing', () => {
    const deep = '('.repeat(FORMULA_LIMITS.depth + 1) + '1' + ')'.repeat(FORMULA_LIMITS.depth + 1)
    expect(problem(deep).message).toBe('This formula is nested too deeply')
    expect(problem('-'.repeat(FORMULA_LIMITS.depth + 1) + '1').message).toBe('This formula is nested too deeply')
    expect(problem('not '.repeat(FORMULA_LIMITS.depth + 1) + 'true').message).toBe('This formula is nested too deeply')
    const tall = Array.from({ length: FORMULA_LIMITS.height + 5 }, () => '1').join('+')
    expect(problem(tall).message).toBe('This formula is nested too deeply')
    const wide = `round(${Array.from({ length: 1200 }, () => '1').join(',')})`
    expect(problem(wide).message).toBe('This formula is too long')
    // A thousand levels of nesting in a hostile text never reach the call stack.
    expect(parseFormula('('.repeat(3000)).ok).toBe(false)
  })

  it('never throws, whatever it is given', () => {
    for (const text of ['', ')', '(((', '"', "'", '\\', 'prop(', 'prop("', 'if(', ',', '^^', '1e', '.', '..5', 'a.b']) {
      expect(() => parseFormula(text)).not.toThrow()
    }
    expect(parseFormula(undefined as unknown as string)).toEqual({ ok: true, ast: null })
  })
})

describe('property references in a formula text', () => {
  it('are found on the tokens, even when the formula has errors further on', () => {
    expect(propReferences('prop("A") + prop(\'B\') * (')).toEqual([
      { ref: 'A', start: 5, end: 8 },
      { ref: 'B', start: 17, end: 20 }
    ])
    expect(propReferences('"prop(\\"A\\")"')).toEqual([])
  })

  it('are rewritten without touching anything else', () => {
    const text = 'if(prop("A"),  prop("B"), "prop(\\"A\\")")'
    expect(rewriteReferences(text, (ref) => (ref === 'A' ? 'id-a' : null))).toBe('if(prop("id-a"),  prop("B"), "prop(\\"A\\")")')
    expect(rewriteReferences('prop("A")', () => 'say "hi" \\ there')).toBe('prop("say \\"hi\\" \\\\ there")')
    expect(rewriteReferences('1 + 1', () => 'x')).toBe('1 + 1')
  })

  it('quote text so that it reads back the same', () => {
    for (const name of ['plain', 'with "quotes"', 'back\\slash', 'two\nlines', 'tab\there', "it's"]) {
      const result = tokenize(quoteText(name))
      expect(result.ok && result.tokens[0].value).toBe(name)
    }
  })
})

describe('positions', () => {
  it('turn into lines and columns', () => {
    expect(lineColumn('abc', 2)).toEqual({ line: 1, column: 3 })
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
    expect(lineColumn('ab', 99)).toEqual({ line: 1, column: 3 })
  })
})
