/**
 * AI workflows: the shapes shared by the main process (which finds and drives the Claude Code
 * program installed on this computer) and the renderer (which asks for an action and shows what
 * streams back). Selida stores no API key and makes no network request itself.
 */

export const AI_ACTIONS = [
  'summarize',
  'continue',
  'expand',
  'improve',
  'fix',
  'shorten',
  'lengthen',
  'simplify',
  'tone',
  'translate',
  'outline',
  'actions',
  'title',
  'explain',
  'custom',
  'ask',
  'consolidate'
] as const
export type AiAction = (typeof AI_ACTIONS)[number]

export const AI_TONES = ['professional', 'casual', 'friendly', 'confident', 'direct', 'formal'] as const
export type AiTone = (typeof AI_TONES)[number]

export const AI_TONE_LABELS: Record<AiTone, string> = {
  professional: 'Professional',
  casual: 'Casual',
  friendly: 'Friendly',
  confident: 'Confident',
  direct: 'Direct',
  formal: 'Formal'
}

/** Languages the model can be asked to write in. `auto` (settings only) follows the content. */
export const AI_LANGUAGES = ['pt-BR', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh'] as const
export type AiLanguage = (typeof AI_LANGUAGES)[number]

export const AI_LANGUAGE_LABELS: Record<AiLanguage, string> = {
  'pt-BR': 'Portuguese (Brazil)',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese'
}

/** Bounds on what a renderer may send; the main process caps the assembled prompt as well. */
export const AI_LIMITS = {
  instruction: 4000,
  selection: 60_000,
  blockIds: 500,
  historyTurns: 20,
  historyTurnChars: 8000,
  transcript: 400_000,
  notes: 60_000
} as const

export interface AiTurn {
  role: 'user' | 'assistant'
  text: string
}

/** What a renderer asks for. The prompt itself is built in the main process, never here. */
export interface AiRequest {
  action: AiAction
  /** The page the action is about; the main process reads its content itself. */
  pageId?: string
  /** Blocks of that page the action applies to, instead of a text selection. */
  blockIds?: string[]
  /** The selected text (or, for `continue`, the text right before the caret). */
  selectionText?: string
  /** A free instruction (`custom`), the question (`ask`), or a refinement of a draft. */
  instruction?: string
  language?: AiLanguage
  /** `tone` only. */
  tone?: AiTone
  /** `ask` only: the earlier turns of the conversation, oldest first. */
  history?: AiTurn[]
  /** `consolidate` only: the raw transcript and the rough notes taken meanwhile. */
  transcript?: string
  notes?: string
}

export type AiUnavailableReason = 'not-found' | 'not-executable' | 'unknown-version' | 'disabled'

export interface AiStatus {
  available: boolean
  path?: string
  version?: string
  reason?: AiUnavailableReason
}

export type AiErrorCode = 'not-installed' | 'not-logged-in' | 'rate-limited' | 'timeout' | 'cancelled' | 'failed'

export interface AiDelta {
  id: string
  text: string
}

export interface AiDone {
  id: string
  text: string
  truncated: boolean
  durationMs: number
}

export interface AiError {
  id: string
  code: AiErrorCode
  message: string
  /** One short, sanitised line from the program, when it said anything useful. */
  detail?: string
}

export type AiEvent = ({ type: 'delta' } & AiDelta) | ({ type: 'done' } & AiDone) | ({ type: 'error' } & AiError)

export const AI_CHANNELS = { delta: 'ai:delta', done: 'ai:done', error: 'ai:error' } as const

// ---- settings ---------------------------------------------------------------

export const AI_KEYS = ['ai.enabled', 'ai.cliPath', 'ai.model', 'ai.timeoutSec', 'ai.language'] as const
export type AiKey = (typeof AI_KEYS)[number]

export const AI_DEFAULTS = { enabled: true, timeoutSec: 120 } as const
export const AI_TIMEOUT_LIMITS = { min: 10, max: 900 } as const

/** A model alias or full name, as the program's `--model` takes it: nothing a shell could read as syntax. */
export const AI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isAiLanguage(value: unknown): value is AiLanguage {
  return typeof value === 'string' && (AI_LANGUAGES as readonly string[]).includes(value)
}

export function isAiTone(value: unknown): value is AiTone {
  return typeof value === 'string' && (AI_TONES as readonly string[]).includes(value)
}

export function isAiAction(value: unknown): value is AiAction {
  return typeof value === 'string' && (AI_ACTIONS as readonly string[]).includes(value)
}

/**
 * The value an AI setting accepts from a renderer, or undefined when it does not.
 * `ai.cliPath` is never accepted here: a path only comes from the native file dialog
 * (`ai.pickCli`); a renderer can only clear it (null, handled by the caller).
 */
export function cleanAiSetting(key: string, value: unknown): boolean | number | string | undefined {
  switch (key) {
    case 'ai.enabled':
      return typeof value === 'boolean' ? value : undefined
    case 'ai.model':
      return typeof value === 'string' && AI_MODEL_RE.test(value) ? value : undefined
    case 'ai.timeoutSec':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
      return Math.min(AI_TIMEOUT_LIMITS.max, Math.max(AI_TIMEOUT_LIMITS.min, Math.round(value)))
    case 'ai.language':
      return value === 'auto' || isAiLanguage(value) ? value : undefined
    default:
      return undefined
  }
}

/** `emoji title` lines → suggestions; tolerant of numbering and stray Markdown. What the `title` action replies with. */
export function parseTitleSuggestions(text: string): { emoji: string; title: string }[] {
  const out: { emoji: string; title: string }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/[*_`#"]/g, '').trim()
    if (!line) continue
    const match = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*(.+)$/u.exec(line)
    const title = (match ? match[2] : line).trim().slice(0, 120)
    if (title) out.push({ emoji: match ? match[1] : '', title })
    if (out.length === 5) break
  }
  return out
}
