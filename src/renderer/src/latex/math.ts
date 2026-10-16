// One formula through KaTeX, never throwing: what it refuses comes back as a problem, drawn in red.
// Used by LaTeX documents (convert.ts) and by equation blocks. Pure: the engine is handed in.

export interface KatexOptions {
  displayMode: boolean
  throwOnError: boolean
  strict: 'ignore'
  trust: false
  output: 'htmlAndMathml'
  maxExpand: number
  maxSize: number
  macros: Record<string, string>
}

/** The part of KaTeX this file uses. */
export interface MathEngine {
  renderToString(tex: string, options: KatexOptions): string
}

export interface MathOutcome {
  html: string
  /** What KaTeX refused; `offset` is where in the formula, `detail` its message (or the command). */
  problem?: { kind: 'error' | 'unsupported'; offset: number; detail: string }
}

/** Rendered formulas by source, shared between renders of the same document. */
export type MathCache = Map<string, MathOutcome>

const MAX_CACHE = 2000
const MATH_LIMITS = { maxExpand: 1000, maxSize: 50 }

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Renders one formula, never throwing: what KaTeX refuses comes back as `problem`, drawn in red. */
export function renderMath(
  engine: MathEngine,
  tex: string,
  display: boolean,
  macros: Record<string, string> = {},
  cache?: MathCache,
  macrosKey = ''
): MathOutcome {
  const key = `${display ? 'D' : 'I'}\u0000${macrosKey}\u0000${tex}`
  const hit = cache?.get(key)
  if (hit) return hit
  const options: KatexOptions = {
    displayMode: display,
    throwOnError: true,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
    ...MATH_LIMITS,
    // KaTeX writes \gdef into the object it is given: each formula gets its own copy.
    macros: { ...macros }
  }
  let outcome: MathOutcome
  try {
    outcome = { html: engine.renderToString(tex, options) }
  } catch (error) {
    const err = (error ?? {}) as { position?: unknown; rawMessage?: unknown; message?: unknown }
    const raw = typeof err.rawMessage === 'string' ? err.rawMessage : typeof err.message === 'string' ? err.message : String(error)
    const undefinedCommand = /^Undefined control sequence: (\\\S+)/.exec(raw)
    let html: string
    try {
      html = engine.renderToString(tex, { ...options, throwOnError: false, macros: { ...macros } })
    } catch {
      html = `<span class="latex-math-error">${escapeHtml(tex)}</span>`
    }
    outcome = {
      html,
      problem: {
        kind: undefinedCommand ? 'unsupported' : 'error',
        offset: typeof err.position === 'number' ? err.position : 0,
        detail: undefinedCommand ? undefinedCommand[1] : raw
      }
    }
  }
  if (cache) {
    if (cache.size >= MAX_CACHE) cache.clear()
    cache.set(key, outcome)
  }
  return outcome
}
