/**
 * Pure validation, sanitisation and CSS generation for appearance overrides.
 * Nothing here touches the DOM (CSS.supports is used only when it exists), so it runs in node tests.
 */
import { parseColor } from './color'
import { TOKENS, TOKEN_MAP, defaultValue } from './schema'
import type { ThemeName, TokenDef } from './schema'

export interface AppearanceData {
  /** Overrides for themed tokens in the light theme. */
  light: Record<string, string>
  /** Overrides for themed tokens in the dark theme. */
  dark: Record<string, string>
  /** Overrides for tokens that are the same in both themes. */
  shared: Record<string, string>
  customCss: string
  presetId: string | null
}

export const MAX_VALUE_LENGTH = 2000
/** Image values may be data: urls, so they get more room. */
export const MAX_IMAGE_LENGTH = 400_000
export const MAX_CUSTOM_CSS_LENGTH = 50_000

export function emptyAppearance(): AppearanceData {
  return { light: {}, dark: {}, shared: {}, customCss: '', presetId: null }
}

// ---- numeric tokens ----

const SCALED = /^calc\(\s*(\d+(?:\.\d+)?)px\s*\*\s*var\(--font-scale\)\s*\)$/
const NUMERIC = /^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]*)$/

export function isNumericKind(token: TokenDef): boolean {
  return token.kind === 'length' || token.kind === 'number' || token.kind === 'percent' || token.kind === 'duration'
}

/** The number a numeric token's value stands for (the px base for scaled text sizes), or null. */
export function parseNumeric(token: TokenDef, value: string): number | null {
  const text = value.trim()
  if (token.scaled) {
    const match = SCALED.exec(text)
    return match ? Number(match[1]) : null
  }
  const match = NUMERIC.exec(text)
  if (!match || match[2] !== (token.unit ?? '')) return null
  return Number(match[1])
}

function decimals(step: number | undefined): number {
  const text = String(step ?? 1)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** The CSS value for a number edited in a numeric control. */
export function formatNumeric(token: TokenDef, n: number): string {
  const rounded = Number(n.toFixed(Math.max(decimals(token.step), 3)))
  if (token.scaled) return `calc(${rounded}px * var(--font-scale))`
  return `${rounded}${token.unit ?? ''}`
}

// ---- single values ----

/** Functions that can load a resource; only image tokens may use url(), and only with a local scheme. */
const RESOURCE_FN = /(url|image-set|image|src|cross-fade|element|expression)\s*\(/i
/** C0 controls (other than the whitespace that gets collapsed) and DEL never belong in a value. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/
const LOCAL_IMAGE = /^url\((["'])(?:sel-file:|data:image\/)[^"'()\\\s{}<>]*\1\)$/i

/** Unbalanced brackets or quotes would let a value swallow the declarations that follow it. */
function isBalanced(text: string): boolean {
  const stack: string[] = []
  let quote = ''
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') stack.push(ch === '(' ? ')' : ']')
    else if (ch === ')' || ch === ']') {
      if (stack.pop() !== ch) return false
    }
  }
  return !quote && stack.length === 0
}

const SUPPORTS_PROPERTY: Partial<Record<TokenDef['kind'], string>> = {
  color: 'color',
  font: 'font-family',
  shadow: 'box-shadow',
  easing: 'transition-timing-function'
}

function cssSupports(property: string, value: string): boolean | null {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return null
  return CSS.supports(property, value)
}

/**
 * Returns the sanitised form of `raw` if it is an acceptable value for the token, otherwise null.
 * Strips `;{}` and `</style`, caps the length, and rejects anything that could escape the
 * declaration or load a remote resource.
 */
export function cleanValue(token: TokenDef, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (token.kind === 'image') {
    // Checked against one strict shape instead of being stripped: a `;` inside the quoted
    // url is harmless and data: urls need it.
    const image = raw.trim()
    if (image.toLowerCase() === 'none') return 'none'
    return image.length <= MAX_IMAGE_LENGTH && LOCAL_IMAGE.test(image) ? image : null
  }
  const value = raw
    .slice(0, MAX_VALUE_LENGTH)
    .replace(/<\/style/gi, '')
    .replace(/[;{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!value || value.includes('/*') || value.includes('\\') || /[<>]/.test(value) || !isBalanced(value)) return null

  if (CONTROL_CHARS.test(value) || RESOURCE_FN.test(value)) return null

  if (isNumericKind(token)) {
    // Out-of-range numbers (a 0px font, a 9999px blur) could make the app unusable, settings included.
    const n = parseNumeric(token, value)
    if (n === null || !Number.isFinite(n)) return null
    if (token.min !== undefined && n < token.min) {
      // Saved before the floor was raised: read as the floor. The setting keeps what it holds.
      return token.floorFrom !== undefined && n >= token.floorFrom ? formatNumeric(token, token.min) : null
    }
    if (token.max !== undefined && n > token.max) return null
    return value
  }

  if (token.kind === 'color') {
    if (parseColor(value)) return value
    return cssSupports('color', value) === true ? value : null
  }

  const property = SUPPORTS_PROPERTY[token.kind]
  if (property && cssSupports(property, value) === false) return null
  return value
}

// ---- custom css ----

/*
 * Policy: custom CSS (typed by the user or carried by an imported theme) must never make the
 * app talk to a remote host. The only urls it may reference are `sel-file:` (files copied
 * into the app's data directory) and `data:image/`. Enforced on CSS tokens, not on text, so
 * that escapes (`\75rl(`), case, comments and whitespace cannot hide anything:
 *   - `@import` and `@namespace` rules are removed;
 *   - every `url(...)` that is not local is removed (which voids its declaration);
 *   - functions that turn a plain string (possibly smuggled in through `var()`) into a fetch
 *     (`image-set()`, `image()`, `src()`) and `expression()` are removed with their arguments.
 * Names are matched by their ending (`xurl(` counts as `url(`): tokenizers have disagreed on
 * where such a name starts, and nothing legitimate ends that way. Nothing is ever added, and
 * the result is always a fixed point of the sanitiser, so removing one construct can never
 * splice a new one together. The stylesheet is written with `textContent`, which cannot leave
 * the <style> element; `</style` is stripped anyway.
 */

const LOCAL_URL = /^(?:sel-file:|data:image\/)/i
const BLOCKED_AT_RULES = ['import', 'namespace']
const URL_FUNCTION = ['url']
const BLOCKED_FUNCTIONS = ['image-set', 'image', 'src', 'expression']
const MAX_SANITIZE_PASSES = 8

const HEX_DIGIT = /[0-9a-fA-F]/
const isCssSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t' || ch === '\n'
const isNameChar = (ch: string): boolean => /[A-Za-z0-9_-]/.test(ch) || ch > '\u007f'

/** Decodes the escape starting at the backslash at `i`; null for a backslash before a newline or the end. */
function readEscape(css: string, i: number): { text: string; end: number } | null {
  const next = css[i + 1]
  if (next === undefined || next === '\n') return null
  if (HEX_DIGIT.test(next)) {
    let j = i + 1
    let hex = ''
    while (j < css.length && hex.length < 6 && HEX_DIGIT.test(css[j])) hex += css[j++]
    if (isCssSpace(css[j])) j += 1
    const code = parseInt(hex, 16)
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return { text: valid ? String.fromCodePoint(code) : '�', end: j }
  }
  const char = String.fromCodePoint(css.codePointAt(i + 1)!)
  return { text: char, end: i + 1 + char.length }
}

/** Reads an identifier-like run (name characters and escapes) and returns it decoded. */
function readName(css: string, i: number): { name: string; end: number } {
  let name = ''
  let j = i
  while (j < css.length) {
    const ch = css[j]
    if (ch === '\\') {
      const escape = readEscape(css, j)
      if (!escape) break
      name += escape.text
      j = escape.end
    } else if (isNameChar(ch)) {
      name += ch
      j += 1
    } else break
  }
  return { name, end: j }
}

/** True when the decoded name ends with one of `targets`, compared ASCII case-insensitively. */
function nameIs(name: string, targets: readonly string[]): boolean {
  const lower = name.replace(/[A-Z]/g, (ch) => ch.toLowerCase())
  return targets.some((target) => lower.endsWith(target))
}

/**
 * Reads the string whose opening quote is at `i`. `closed` is false for a string cut short by
 * a newline (a "bad string": the tokenizer resumes at the newline, so must we). A string that
 * runs into the end of the text is valid CSS and counts as closed.
 */
function readString(css: string, i: number): { value: string; end: number; closed: boolean } {
  const quote = css[i]
  let value = ''
  let j = i + 1
  while (j < css.length) {
    const ch = css[j]
    if (ch === quote) return { value, end: j + 1, closed: true }
    if (ch === '\n') return { value, end: j, closed: false }
    if (ch === '\\') {
      if (j + 1 >= css.length) j += 1
      else if (css[j + 1] === '\n') j += 2
      else {
        const escape = readEscape(css, j)!
        value += escape.text
        j = escape.end
      }
    } else {
      value += ch
      j += 1
    }
  }
  return { value, end: j, closed: true }
}

function skipSpace(css: string, i: number): number {
  let j = i
  while (isCssSpace(css[j])) j += 1
  return j
}

/** Reads the argument of `url(`, starting after the parenthesis. `value` is null when it is not one plain url. */
function readUrl(css: string, i: number): { value: string | null; end: number } {
  let j = skipSpace(css, i)
  if (css[j] === '"' || css[j] === "'") {
    const text = readString(css, j)
    if (!text.closed) return { value: null, end: text.end }
    j = skipSpace(css, text.end)
    if (j >= css.length) return { value: text.value, end: j }
    if (css[j] === ')') return { value: text.value, end: j + 1 }
    // url modifiers or junk after the string: not worth understanding
    return { value: null, end: text.end }
  }
  let value = ''
  let bad = false
  while (j < css.length) {
    const ch = css[j]
    if (ch === ')') return { value: bad ? null : value, end: j + 1 }
    if (ch === '\\') {
      const escape = readEscape(css, j)
      if (escape) {
        value += escape.text
        j = escape.end
        continue
      }
      bad = true
    } else if (isCssSpace(ch)) {
      const after = skipSpace(css, j)
      if (after < css.length && css[after] !== ')') bad = true
      j = after
      continue
    } else if (ch === '"' || ch === "'" || ch === '(') bad = true
    else value += ch
    j += 1
  }
  return { value: bad ? null : value, end: j }
}

function commentEnd(css: string, i: number): number {
  const close = css.indexOf('*/', i + 2)
  return close < 0 ? css.length : close + 2
}

/**
 * Skips forward from `i` over comments, strings and escapes. With `stopAtRuleEnd` it returns
 * just past the first top-level `;`, or at the first top-level brace (the end of an at-rule
 * prelude); without, just past the parenthesis closing the one at `i`.
 */
function skipBalanced(css: string, i: number, stopAtRuleEnd: boolean): number {
  let depth = 0
  let j = i
  while (j < css.length) {
    const ch = css[j]
    if (ch === '/' && css[j + 1] === '*') j = commentEnd(css, j)
    else if (ch === '"' || ch === "'") j = readString(css, j).end
    else if (ch === '\\') j = readEscape(css, j)?.end ?? j + 1
    else if (stopAtRuleEnd && depth === 0 && ch === ';') return j + 1
    else if (stopAtRuleEnd && depth === 0 && (ch === '{' || ch === '}')) return j
    else {
      if (ch === '(') depth += 1
      else if (ch === ')' && depth > 0) {
        depth -= 1
        if (depth === 0 && !stopAtRuleEnd) return j + 1
      }
      j += 1
    }
  }
  return j
}

function isLocalUrl(value: string): boolean {
  // No trimming: a url parser strips leading junk, so only an exact prefix is trusted.
  return LOCAL_URL.test(value)
}

function sanitizeCssPass(input: string): string {
  // What a CSS parser does first (newlines), plus dropping characters no stylesheet needs.
  const css = input
    .replace(/\r\n?|\f/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
    .replace(/<\/style/gi, '')
  let out = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    let end = i + 1
    if (ch === '/' && css[i + 1] === '*') end = commentEnd(css, i)
    else if (ch === '"' || ch === "'") end = readString(css, i).end
    else if (ch === '@') {
      const word = readName(css, i + 1)
      end = word.end
      if (nameIs(word.name, BLOCKED_AT_RULES)) {
        i = skipBalanced(css, end, true)
        continue
      }
    } else if (ch === '\\' || isNameChar(ch)) {
      const word = readName(css, i)
      end = Math.max(word.end, i + 1)
      if (css[word.end] === '(') {
        if (nameIs(word.name, URL_FUNCTION)) {
          const url = readUrl(css, word.end + 1)
          if (url.value !== null && isLocalUrl(url.value)) out += css.slice(i, url.end)
          i = url.end
          continue
        }
        if (nameIs(word.name, BLOCKED_FUNCTIONS)) {
          i = skipBalanced(css, word.end, false)
          continue
        }
      }
    }
    out += css.slice(i, end)
    i = end
  }
  return out
}

/** Applies the custom CSS policy above. Returns '' for input it cannot bring to a stable, safe form. */
export function sanitizeCustomCss(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let css = raw.slice(0, MAX_CUSTOM_CSS_LENGTH)
  // A pass only ever removes text, so this settles; the bound is for hostile nesting.
  for (let pass = 0; pass < MAX_SANITIZE_PASSES; pass++) {
    const next = sanitizeCssPass(css)
    if (next === css) return css
    css = next
  }
  return ''
}

// ---- whole state ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanMap(input: unknown, theme: ThemeName, themed: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(input)) return out
  for (const [name, raw] of Object.entries(input)) {
    const token = TOKEN_MAP[name]
    if (!token || token.themed !== themed) continue
    const value = cleanValue(token, raw)
    if (value !== null && value !== defaultValue(token, theme)) out[name] = value
  }
  return out
}

/** Builds a safe AppearanceData from anything (stored settings, another window, an imported file). */
export function sanitizeAppearance(input: unknown): AppearanceData {
  if (!isRecord(input)) return emptyAppearance()
  const presetId = input.presetId
  return {
    light: cleanMap(input.light, 'light', true),
    dark: cleanMap(input.dark, 'dark', true),
    shared: cleanMap(input.shared, 'light', false),
    customCss: sanitizeCustomCss(input.customCss),
    presetId: typeof presetId === 'string' && /^[\w-]{1,64}$/.test(presetId) ? presetId : null
  }
}

/** What windows send each other over the `appearance` BroadcastChannel. */
export interface AppearanceMessage {
  type: 'appearance'
  version: 1
  data: AppearanceData
}

/**
 * The state carried by a channel message, sanitised like any other untrusted input, or null
 * when the message is not one of ours (which must not reset this window's look).
 */
export function readAppearanceMessage(message: unknown): AppearanceData | null {
  if (!isRecord(message) || message.type !== 'appearance' || message.version !== 1) return null
  return isRecord(message.data) ? sanitizeAppearance(message.data) : null
}

function declarations(map: Record<string, string>): string {
  let out = ''
  for (const token of TOKENS) {
    const value = map[token.name]
    if (value !== undefined) out += `${token.name}:${value};`
  }
  return out
}

/** The text of the single override stylesheet. Expects sanitised data. */
export function buildCss(data: AppearanceData): string {
  let css = ''
  const root = declarations(data.shared) + declarations(data.light)
  if (root) css += `:root{${root}}\n`
  const dark = declarations(data.dark)
  if (dark) css += `:root[data-theme='dark']{${dark}}\n`
  if (data.customCss.trim()) css += `${data.customCss}\n`
  return css
}

export function effectiveValueIn(data: AppearanceData, name: string, theme: ThemeName): string {
  const token = TOKEN_MAP[name]
  if (!token) return ''
  const override = token.themed ? data[theme][name] : data.shared[name]
  return override ?? defaultValue(token, theme)
}

export function countOverrides(data: AppearanceData): number {
  return Object.keys(data.light).length + Object.keys(data.dark).length + Object.keys(data.shared).length
}
