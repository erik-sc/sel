/**
 * What the conversation balloon keeps between runs of the app: the last conversations
 * ("Earlier", `ai.conversations`) and the log of what the AI applied, with what it takes to
 * undo each batch (`ai.applied`). Both are settings of this device only: never synced, never
 * sent anywhere. Kept as settings rather than tables so that a feature with no table of its own
 * needs no migration; each value stays well under the settings' size cap (1 MB) because the
 * renderer trims it with `fitConversations` / `fitAppliedLog` before writing, and main checks it
 * again with the cleaners below. Pure: no Electron, no DOM.
 */
import type { AiErrorCode } from './ai'
import type { AiSent } from './aiContext'
import type { Op } from './types'

export const AI_CONVERSATIONS_KEY = 'ai.conversations'
export const AI_APPLIED_KEY = 'ai.applied'

export const AI_HISTORY_CAPS = {
  /** Conversations kept; the oldest go first. */
  conversations: 30,
  /** Messages kept of one conversation: the last ones. */
  messages: 40,
  /** Characters kept of one message. */
  messageChars: 12_000,
  title: 80,
  /** Batches kept in the log of what was applied. */
  applied: 30,
  /** Lines of what was done (and left out) kept with a batch. */
  lines: 60,
  lineChars: 300,
  /** Pages named by one batch. */
  pages: 40,
  /** Characters of the whole stored value; well under the settings' cap of 1 MB. */
  conversationsChars: 600_000,
  appliedChars: 360_000,
  /** One batch's undo larger than this is not kept (the pages' saved versions remain the way back). */
  undoChars: 160_000
} as const

// ---- conversations ----------------------------------------------------------

export type StoredRunStatus = 'done' | 'error' | 'cancelled'

export interface StoredProposal {
  state: 'dismissed' | 'applied'
  /** `applied`: what was done and left out, and the first thing created. */
  done?: string[]
  skipped?: string[]
  open?: string | null
  /** `applied`: the entry of the log that can undo it. */
  logId?: string
}

export interface StoredScope {
  pageId?: string
  today?: true
}

export interface StoredMessage {
  role: 'user' | 'assistant'
  text: string
  at: number
  /** User messages: what the question was about, and whether a selection went with it. */
  scope?: StoredScope
  withSelection?: true
  /** Assistant messages: how the request ended. */
  status?: StoredRunStatus
  error?: { code: AiErrorCode; message: string; detail?: string }
  truncated?: true
  sent?: AiSent
  proposal?: StoredProposal
}

export interface StoredConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** The page it was started on; null for the Today screen or no page. */
  pageId: string | null
  today?: true
  /** Who started it when it was not the user typing: a routine, for instance (`routine:morning`). */
  source?: string
  messages: StoredMessage[]
}

const ERROR_CODES: readonly AiErrorCode[] = ['not-installed', 'not-logged-in', 'rate-limited', 'timeout', 'cancelled', 'failed']
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, max: number): string | undefined => (typeof value === 'string' ? value.slice(0, max) : undefined)
const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
const id = (value: unknown): string | undefined => (typeof value === 'string' && ID_RE.test(value) ? value : undefined)
const lines = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((line): line is string => typeof line === 'string')
        .slice(0, AI_HISTORY_CAPS.lines)
        .map((line) => line.slice(0, AI_HISTORY_CAPS.lineChars))
    : []

function cleanSent(value: unknown): AiSent | undefined {
  if (!isObject(value)) return undefined
  const names = (list: unknown): string[] => lines(list).slice(0, 20)
  return { context: value.context === true, pages: names(value.pages), servers: names(value.servers) }
}

function cleanScope(value: unknown): StoredScope | undefined {
  if (!isObject(value)) return undefined
  const pageId = id(value.pageId)
  if (pageId) return { pageId }
  return value.today === true ? { today: true } : undefined
}

function cleanProposal(value: unknown): StoredProposal | undefined {
  if (!isObject(value)) return undefined
  if (value.state === 'dismissed') return { state: 'dismissed' }
  if (value.state !== 'applied') return undefined
  const logId = id(value.logId)
  return {
    state: 'applied',
    done: lines(value.done),
    skipped: lines(value.skipped),
    open: id(value.open) ?? null,
    ...(logId ? { logId } : {})
  }
}

export function cleanMessage(value: unknown): StoredMessage | null {
  if (!isObject(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  const text = str(value.text, AI_HISTORY_CAPS.messageChars)
  if (text === undefined) return null
  const message: StoredMessage = { role: value.role, text, at: time(value.at) ?? 0 }
  if (value.role === 'user') {
    const scope = cleanScope(value.scope)
    if (scope) message.scope = scope
    if (value.withSelection === true) message.withSelection = true
    return message
  }
  message.status = value.status === 'error' || value.status === 'cancelled' ? value.status : 'done'
  if (isObject(value.error) && ERROR_CODES.includes(value.error.code as AiErrorCode)) {
    const detail = str(value.error.detail, 500)
    message.error = {
      code: value.error.code as AiErrorCode,
      message: str(value.error.message, 500) ?? '',
      ...(detail ? { detail } : {})
    }
  }
  if (value.truncated === true) message.truncated = true
  const sent = cleanSent(value.sent)
  if (sent) message.sent = sent
  const proposal = cleanProposal(value.proposal)
  if (proposal) message.proposal = proposal
  return message
}

export function cleanConversation(value: unknown): StoredConversation | null {
  if (!isObject(value)) return null
  const conversationId = id(value.id)
  if (!conversationId || !Array.isArray(value.messages)) return null
  const messages = value.messages
    .slice(-AI_HISTORY_CAPS.messages)
    .map(cleanMessage)
    .filter((message): message is StoredMessage => message !== null)
  if (!messages.length) return null
  const createdAt = time(value.createdAt) ?? 0
  const conversation: StoredConversation = {
    id: conversationId,
    title: str(value.title, AI_HISTORY_CAPS.title) ?? '',
    createdAt,
    updatedAt: time(value.updatedAt) ?? createdAt,
    pageId: id(value.pageId) ?? null,
    messages
  }
  if (value.today === true) conversation.today = true
  const source = str(value.source, 64)
  if (source) conversation.source = source
  return conversation
}

/** What main stores for `ai.conversations`: the conversations it can read, newest first, within the caps. */
export function cleanConversations(value: unknown): StoredConversation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.map(cleanConversation).filter((conversation): conversation is StoredConversation => conversation !== null)
  return fitConversations(list)
}

/** Newest first, at most `conversations` of them, and the oldest dropped until the whole fits its size. */
export function fitConversations(list: readonly StoredConversation[]): StoredConversation[] {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AI_HISTORY_CAPS.conversations)
  while (sorted.length > 1 && JSON.stringify(sorted).length > AI_HISTORY_CAPS.conversationsChars) sorted.pop()
  if (sorted.length === 1 && JSON.stringify(sorted).length > AI_HISTORY_CAPS.conversationsChars) {
    // One very long conversation: its oldest messages go.
    const [only] = sorted
    const messages = [...only.messages]
    while (messages.length > 1 && JSON.stringify(messages).length > AI_HISTORY_CAPS.conversationsChars) messages.shift()
    sorted[0] = { ...only, messages }
  }
  return sorted
}

/** A title for a conversation: its first question, on one line. */
export function conversationTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length > AI_HISTORY_CAPS.title ? `${line.slice(0, AI_HISTORY_CAPS.title - 1)}…` : line
}

// ---- what the AI applied ------------------------------------------------------

export interface AppliedPage {
  id: string
  title: string
}

export interface AppliedEntry {
  id: string
  /** When it was applied (ms). Blocks written after this were changed since. */
  at: number
  /** The question behind the proposal. */
  request: string
  /** One line per action done, and per action left out. */
  done: string[]
  skipped: string[]
  /** The pages and databases it changed or created. */
  pages: AppliedPage[]
  /** Blocks the batch wrote. */
  blocks: number
  /** What puts things back: pages to bring back from the trash, then the inverse batch. Null when too large to keep. */
  undo: { restore: string[]; inverse: Op[] } | null
  /** Set once undone. */
  undoneAt?: number
  /** The conversation it came from. */
  conversationId?: string
}

const OPS = new Set(['create', 'update', 'move', 'delete'])

/** The inverse batch as stored: each op must name its kind and its block. What `blocks:apply` checks in full is left to it. */
function cleanUndo(value: unknown): AppliedEntry['undo'] {
  if (!isObject(value) || !Array.isArray(value.inverse) || !Array.isArray(value.restore)) return null
  const restore = value.restore.map(id)
  if (restore.some((entry) => !entry)) return null
  const inverse: Op[] = []
  for (const op of value.inverse) {
    if (!isObject(op) || !OPS.has(op.op as string)) return null
    const target = op.op === 'create' ? (isObject(op.input) ? id(op.input.id) : undefined) : id(op.id)
    if (!target) return null
    inverse.push(op as unknown as Op)
  }
  return { restore: restore as string[], inverse }
}

export function cleanAppliedEntry(value: unknown): AppliedEntry | null {
  if (!isObject(value)) return null
  const entryId = id(value.id)
  const at = time(value.at)
  if (!entryId || at === undefined) return null
  const pages = Array.isArray(value.pages)
    ? value.pages
        .filter(isObject)
        .map((page) => ({ id: id(page.id), title: str(page.title, AI_HISTORY_CAPS.title) ?? '' }))
        .filter((page): page is AppliedPage => !!page.id)
        .slice(0, AI_HISTORY_CAPS.pages)
    : []
  const entry: AppliedEntry = {
    id: entryId,
    at,
    request: str(value.request, AI_HISTORY_CAPS.lineChars) ?? '',
    done: lines(value.done),
    skipped: lines(value.skipped),
    pages,
    blocks: typeof value.blocks === 'number' && Number.isFinite(value.blocks) ? Math.max(0, Math.round(value.blocks)) : 0,
    undo: cleanUndo(value.undo)
  }
  const undoneAt = time(value.undoneAt)
  if (undoneAt !== undefined) entry.undoneAt = undoneAt
  const conversationId = id(value.conversationId)
  if (conversationId) entry.conversationId = conversationId
  return entry
}

/** What main stores for `ai.applied`: the entries it can read, newest first, within the caps. */
export function cleanAppliedLog(value: unknown): AppliedEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  return fitAppliedLog(value.map(cleanAppliedEntry).filter((entry): entry is AppliedEntry => entry !== null))
}

/**
 * Newest first, at most `applied` entries. An undo too large to keep is dropped from its entry
 * (the entry stays, saying what was done); then the oldest entries go until the whole fits.
 */
export function fitAppliedLog(list: readonly AppliedEntry[]): AppliedEntry[] {
  const sorted = [...list]
    .sort((a, b) => b.at - a.at)
    .slice(0, AI_HISTORY_CAPS.applied)
    .map((entry) => (entry.undo && JSON.stringify(entry.undo).length > AI_HISTORY_CAPS.undoChars ? { ...entry, undo: null } : entry))
  while (sorted.length > 1 && JSON.stringify(sorted).length > AI_HISTORY_CAPS.appliedChars) sorted.pop()
  return sorted
}
