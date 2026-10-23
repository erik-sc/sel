import type { SettingsSpec } from './settings'
import type { InvokeChannels } from './ipc'
import type { CommandSpec } from './commands'
import {
  AI_CONTEXT_CAPS,
  AI_CONTEXT_KEY,
  AI_CONTEXT_PAGES_KEY,
  AI_MCP_SERVERS_KEY,
  cleanMcpChoices,
  contextPageIds,
  type AiSent,
  type ClaudeServerList
} from './aiContext'
import { AI_APPLIED_KEY, AI_CONVERSATIONS_KEY, cleanAppliedLog, cleanConversations } from './aiHistory'

/**
 * AI workflows: the shapes shared by the main process (which finds and drives the Claude Code
 * program installed on this computer) and the renderer (which asks for an action and shows what
 * streams back). sel stores no API key and makes no network request itself.
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
  /**
   * `ask` only, without a page: the question is about the day. The main process adds today's
   * agenda and open tasks, as it has them stored; the window sends none of it.
   */
  today?: boolean
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
  /** What went along with the request from Settings → AI: the context, pinned pages and Claude's tools. */
  sent?: AiSent
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

export const AI_KEYS = [
  'ai.enabled',
  'ai.cliPath',
  'ai.model',
  'ai.timeoutSec',
  'ai.language',
  AI_CONTEXT_KEY,
  AI_CONTEXT_PAGES_KEY,
  AI_MCP_SERVERS_KEY,
  AI_CONVERSATIONS_KEY,
  AI_APPLIED_KEY
] as const
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
export function cleanAiSetting(key: string, value: unknown): unknown {
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
    case AI_CONTEXT_KEY:
      return typeof value === 'string' && value.length <= AI_CONTEXT_CAPS.text ? value : undefined
    case AI_CONTEXT_PAGES_KEY: {
      if (!Array.isArray(value) || value.length > AI_CONTEXT_CAPS.pages) return undefined
      const ids = contextPageIds(value)
      return ids.length === value.length ? ids : undefined
    }
    case AI_MCP_SERVERS_KEY:
      return cleanMcpChoices(value)
    case AI_CONVERSATIONS_KEY:
      return cleanConversations(value)
    case AI_APPLIED_KEY:
      return cleanAppliedLog(value)
    default:
      return undefined
  }
}

/** `emoji title` lines → suggestions; tolerant of numbering and stray Markdown. What the `title` action replies with. */
export function parseTitleSuggestions(text: string): { emoji: string; title: string }[] {
  const out: { emoji: string; title: string }[] = []
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/[*_`#"]/g, '')
      .trim()
    if (!line) continue
    const match = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*(.+)$/u.exec(line)
    const title = (match ? match[2] : line).trim().slice(0, 120)
    if (title) out.push({ emoji: match ? match[1] : '', title })
    if (out.length === 5) break
  }
  return out
}

/**
 * Which AI settings a renderer may write: each typed, since they decide what the main process runs.
 * The program's path is the exception: a renderer can clear it but never name one; a path only
 * comes out of the native file dialog (`ai:pickCli`).
 */
export const AI_SETTINGS: SettingsSpec = {
  keys: AI_KEYS,
  clean: cleanAiSetting,
  dialogOnly: { keys: ['ai.cliPath'], message: 'The program can only be chosen with the file dialog' }
}

export interface AiApi {
  /** Whether the program was found and answers; cached unless `refresh`. */
  status(refresh?: boolean): Promise<AiStatus>
  /**
   * Starts a request and resolves with its id at once. Its text, its end and any failure
   * (including the program missing) arrive through `onEvent`. Rejects only for an invalid request.
   */
  run(request: AiRequest): Promise<{ id: string }>
  /** Stops a request of this window. Resolves false when it was already over. */
  cancel(id: string): Promise<boolean>
  /**
   * Opens a file dialog to choose the program and stores the choice (`ai.cliPath`), the only way
   * that setting gets a value. Null when cancelled; otherwise the status with the chosen file.
   */
  pickCli(): Promise<AiStatus | null>
  /**
   * The MCP servers set up for Claude Code on this computer (Settings → AI → Claude's tools):
   * those in its configuration file, read now, and the claude.ai connectors as last looked up.
   */
  servers(): Promise<ClaudeServerList>
  /** Asks Claude Code which claude.ai connectors the account has (`claude mcp list`); takes a while. */
  scanServers(): Promise<ClaudeServerList>
  /** Starts Claude Code with one server and notes its tools (it may count as one small request). */
  serverTools(id: string): Promise<ClaudeServerList>
  /** `ai:delta`, `ai:done` and `ai:error` for this window's requests. Returns an unsubscribe function. */
  onEvent(listener: (event: AiEvent) => void): () => void
}

/** The invoke channels of `api.ai` (see `INVOKE` in ./api.ts): every method of AiApi that returns a promise, and no other. */
export const AI_INVOKE = {
  'ai:status': true,
  'ai:run': true,
  'ai:cancel': true,
  'ai:pickCli': true,
  'ai:servers': true,
  'ai:scanServers': true,
  'ai:serverTools': true
} as const satisfies Record<InvokeChannels<{ ai: AiApi }>, true>

/** The conversation balloon, by Herman or on its own (see ./commands.ts). The palette lists it while AI is on. */
export const AI_COMMANDS = [
  {
    id: 'toggle-assistant',
    shortcut: { accelerator: 'CmdOrCtrl+J', key: 'j', ctrl: true },
    menu: { submenu: 'view', label: 'Toggle Assistant', order: 310 },
    palette: { title: 'Herman, the assistant', keywords: ['ai', 'ask', 'chat', 'claude'], order: 140 },
    catalog: { group: 'herman', label: 'Talk to Herman, the assistant', keywords: ['ai', 'ask'], order: 10, ai: true }
  }
] as const satisfies readonly CommandSpec[]
