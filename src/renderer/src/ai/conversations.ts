// The balloon's conversations: the one in front for each tab route, the requests running in
// them, and the last ones kept between runs of the app ("Earlier", `ai.conversations`). A
// request keeps running when the balloon closes or the tab changes; its answer lands in its own
// conversation. Part of the balloon's chunk.
import { create } from 'zustand'
import { AI_LIMITS, type AiRequest, type AiTurn } from '@shared/ai'
import {
  AI_CONVERSATIONS_KEY,
  cleanConversations,
  conversationTitle,
  fitConversations,
  type StoredConversation,
  type StoredMessage,
  type StoredScope
} from '@shared/aiHistory'
import { emitReplyDone, type BalloonDelivery } from './balloonGate'
import { startRun, type RunHandle } from './client'
import { openAiSetup } from './gate'
import { IDLE, isBusy, reduceRun, type RunEvent, type RunState } from './machine'

export type Outcome =
  | { state: 'applying' | 'dismissed' }
  | { state: 'applied'; done: string[]; skipped: string[]; open: string | null; logId?: string }

export interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  at: number
  /** Assistant messages: the request behind the answer. */
  run?: RunState
  /** User messages: what the question was about, and whether a selection went with it. */
  scope?: StoredScope
  withSelection?: boolean
  /**
   * User messages, in memory only: the tab route the question was asked from. On a page private
   * from the AI the question goes without the page, and this is how the memory still knows.
   */
  route?: string
  /** Assistant messages: what became of the proposal in the answer. */
  proposal?: Outcome
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pageId: string | null
  today?: boolean
  source?: string
  messages: Message[]
}

interface Conversations {
  list: Conversation[]
  /** The conversation in front, by tab route ('' for none); a route without one shows a fresh balloon. */
  active: Record<string, string>
  loaded: boolean
}

export const useConversations = create<Conversations>(() => ({ list: [], active: {}, loaded: false }))

let nextMessageId = 0
let nextConversation = 0
const handles = new Map<string, RunHandle>()

const newConversationId = (): string => `c${Date.now().toString(36)}${(++nextConversation).toString(36)}`

// ---- reading and writing what is kept ----

function fromStored(stored: StoredConversation): Conversation {
  return {
    id: stored.id,
    title: stored.title,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    pageId: stored.pageId,
    ...(stored.today ? { today: true } : {}),
    ...(stored.source ? { source: stored.source } : {}),
    messages: stored.messages.map((message) => {
      const base: Message = { id: ++nextMessageId, role: message.role, text: message.text, at: message.at }
      if (message.role === 'user') {
        if (message.scope) base.scope = message.scope
        if (message.withSelection) base.withSelection = true
        return base
      }
      base.run = {
        ...IDLE,
        status: message.status ?? 'done',
        text: message.text,
        truncated: !!message.truncated,
        error: message.error ?? null,
        ...(message.sent ? { sent: message.sent } : {})
      }
      if (message.proposal?.state === 'dismissed') base.proposal = { state: 'dismissed' }
      else if (message.proposal?.state === 'applied')
        base.proposal = {
          state: 'applied',
          done: message.proposal.done ?? [],
          skipped: message.proposal.skipped ?? [],
          open: message.proposal.open ?? null,
          ...(message.proposal.logId ? { logId: message.proposal.logId } : {})
        }
      return base
    })
  }
}

function toStored(conversation: Conversation): StoredConversation | null {
  const messages: StoredMessage[] = []
  for (const message of conversation.messages) {
    if (message.role === 'user') {
      messages.push({
        role: 'user',
        text: message.text,
        at: message.at,
        ...(message.scope ? { scope: message.scope } : {}),
        ...(message.withSelection ? { withSelection: true } : {})
      })
      continue
    }
    const run = message.run ?? IDLE
    // An answer still on its way is kept once it has ended.
    if (isBusy(run) || run.status === 'idle') continue
    const proposal = message.proposal
    messages.push({
      role: 'assistant',
      text: run.text,
      at: message.at,
      status: run.status === 'error' || run.status === 'cancelled' ? run.status : 'done',
      ...(run.error ? { error: run.error } : {}),
      ...(run.truncated ? { truncated: true } : {}),
      ...(run.sent ? { sent: run.sent } : {}),
      ...(proposal?.state === 'dismissed'
        ? { proposal: { state: 'dismissed' } }
        : proposal?.state === 'applied'
          ? {
              proposal: {
                state: 'applied',
                done: proposal.done,
                skipped: proposal.skipped,
                open: proposal.open,
                ...(proposal.logId ? { logId: proposal.logId } : {})
              }
            }
          : {})
    })
  }
  if (!messages.some((message) => message.role === 'assistant')) return null
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    pageId: conversation.pageId,
    ...(conversation.today ? { today: true } : {}),
    ...(conversation.source ? { source: conversation.source } : {}),
    messages
  }
}

let loading: Promise<void> | null = null
let reading = false

export function loadConversations(): Promise<void> {
  // Read once; a store that was reset (by a test) reads again.
  if (loading && (reading || useConversations.getState().loaded)) return loading
  reading = true
  loading = window.api.app
    .getSetting<unknown>(AI_CONVERSATIONS_KEY)
    .then((value) => {
      const stored = (cleanConversations(value) ?? []).map(fromStored)
      useConversations.setState((state) => {
        const known = new Set(state.list.map((conversation) => conversation.id))
        return { list: [...state.list, ...stored.filter((conversation) => !known.has(conversation.id))], loaded: true }
      })
    })
    .catch((error: unknown) => {
      console.error('the earlier conversations could not be read', error)
      useConversations.setState({ loaded: true })
    })
    .finally(() => {
      reading = false
    })
  return loading
}

let timer: ReturnType<typeof setTimeout> | undefined
let saving: Promise<void> = Promise.resolve()
const SAVE_DELAY_MS = 400

/** Writes what is kept, a moment after the last change (and only once what was there has been read). */
export function persistSoon(delay = SAVE_DELAY_MS): void {
  clearTimeout(timer)
  timer = setTimeout(() => void persistNow(), delay)
}

export function persistNow(): Promise<void> {
  clearTimeout(timer)
  saving = saving
    .catch(() => undefined)
    .then(() => loadConversations())
    .then(() => {
      const stored = fitConversations(
        useConversations
          .getState()
          .list.map(toStored)
          .filter((conversation): conversation is StoredConversation => conversation !== null)
      )
      return window.api.app.setSetting(AI_CONVERSATIONS_KEY, stored.length ? stored : null)
    })
    .catch((error: unknown) => console.error('the conversations could not be kept', error))
  return saving
}

// ---- reading the state ----

export function conversationOf(id: string | undefined): Conversation | undefined {
  return id ? useConversations.getState().list.find((conversation) => conversation.id === id) : undefined
}

/** The conversation in front for a route, if any. */
export function activeConversation(key: string): Conversation | undefined {
  return conversationOf(useConversations.getState().active[key])
}

export function isRunning(conversation: Conversation | undefined): boolean {
  const last = conversation?.messages[conversation.messages.length - 1]
  return !!last?.run && isBusy(last.run)
}

/** The finished turns before `upTo`, as the main process wants them: capped in number and size. */
export function historyOf(messages: readonly Message[], upTo: number): AiTurn[] {
  const turns: AiTurn[] = []
  for (const message of messages.slice(0, upTo)) {
    if (message.role === 'assistant' && message.run?.status !== 'done') continue
    const text = message.text.slice(0, AI_LIMITS.historyTurnChars)
    if (text.trim()) turns.push({ role: message.role, text })
  }
  return turns.slice(-(AI_LIMITS.historyTurns - 2))
}

// ---- changing it ----

function update(id: string, change: (conversation: Conversation) => Conversation): void {
  useConversations.setState((state) => ({
    list: state.list.map((conversation) => (conversation.id === id ? change(conversation) : conversation))
  }))
}

function updateMessage(conversationId: string, messageId: number, change: (message: Message) => Message): void {
  update(conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => (message.id === messageId ? change(message) : message))
  }))
}

function createConversation(key: string, init: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Conversation {
  const now = Date.now()
  const conversation: Conversation = { ...init, id: newConversationId(), createdAt: now, updatedAt: now }
  useConversations.setState((state) => ({ list: [conversation, ...state.list], active: { ...state.active, [key]: conversation.id } }))
  return conversation
}

/** The route gets a fresh balloon; the conversation it had stays in "Earlier". */
export function startOver(key: string): void {
  useConversations.setState((state) => {
    const active = { ...state.active }
    delete active[key]
    return { active }
  })
}

/** Brings an earlier conversation to the front of a route. */
export function reopen(key: string, id: string): void {
  if (conversationOf(id)) useConversations.setState((state) => ({ active: { ...state.active, [key]: id } }))
}

export interface AskScope {
  pageId?: string
  today?: boolean
}

function requestOf(question: string, scope: AskScope, selection: string | null, history: AiTurn[]): AiRequest {
  return {
    action: 'ask',
    instruction: question,
    ...(scope.pageId ? { pageId: scope.pageId } : scope.today ? { today: true } : {}),
    ...(selection ? { selectionText: selection.slice(0, AI_LIMITS.selection) } : {}),
    ...(history.length ? { history } : {})
  }
}

/** Starts the answer to `question` as a new assistant message at the end of the conversation. */
function answer(conversationId: string, question: string, request: AiRequest): void {
  const id = ++nextMessageId
  update(conversationId, (conversation) => ({
    ...conversation,
    updatedAt: Date.now(),
    messages: [...conversation.messages, { id, role: 'assistant', text: '', at: Date.now(), run: IDLE }]
  }))
  const emit = (event: RunEvent): void => {
    if (event.type === 'error' && event.code === 'not-installed') openAiSetup('not-installed')
    const before = conversationOf(conversationId)?.messages.find((message) => message.id === id)?.run
    // The conversation was deleted meanwhile: nothing to show it in.
    if (!before) return
    const run: RunState = reduceRun(before, event)
    if (run === before) return
    updateMessage(conversationId, id, (message) => ({ ...message, run, text: run.text }))
    if (!isBusy(before) || isBusy(run)) return
    handles.delete(conversationId)
    update(conversationId, (conversation) => ({ ...conversation, updatedAt: Date.now() }))
    persistSoon()
    if (run.status !== 'done') return
    const conversation = conversationOf(conversationId)
    const index = conversation?.messages.findIndex((message) => message.id === id) ?? -1
    const asked = index > 0 ? conversation?.messages[index - 1] : undefined
    const route =
      asked?.route ?? Object.entries(useConversations.getState().active).find(([, active]) => active === conversationId)?.[0] ?? null
    emitReplyDone({
      route: route || null,
      conversationId,
      messageId: id,
      question,
      answer: run.text,
      history: conversation ? historyOf(conversation.messages, Math.max(0, index - 1)) : [],
      pageId: request.pageId ?? null
    })
  }
  handles.set(conversationId, startRun(request, emit))
}

/**
 * Asks in the conversation in front of a route (a new one when there is none). The caller has
 * checked that AI can run (`aiReady`). Returns the conversation's id, or null when one is running.
 */
export function ask(key: string, question: string, scope: AskScope, selection: string | null): string | null {
  const text = question.trim().slice(0, AI_LIMITS.instruction)
  if (!text) return null
  let conversation = activeConversation(key)
  if (isRunning(conversation)) return null
  conversation ??= createConversation(key, {
    title: conversationTitle(text),
    pageId: scope.pageId ?? null,
    ...(scope.today ? { today: true } : {}),
    messages: []
  })
  const history = historyOf(conversation.messages, Number.MAX_SAFE_INTEGER)
  const stored: StoredScope | undefined = scope.pageId ? { pageId: scope.pageId } : scope.today ? { today: true } : undefined
  const id = conversation.id
  update(id, (current) => ({
    ...current,
    messages: [
      ...current.messages,
      {
        id: ++nextMessageId,
        role: 'user',
        text,
        at: Date.now(),
        ...(key ? { route: key } : {}),
        ...(stored ? { scope: stored } : {}),
        ...(selection ? { withSelection: true } : {})
      }
    ]
  }))
  answer(id, text, requestOf(text, scope, selection, history))
  return id
}

/** Asks the question behind an answer again, replacing that answer and what came after. */
export function retry(conversationId: string, index: number, selection: string | null): void {
  const conversation = conversationOf(conversationId)
  if (!conversation || isRunning(conversation)) return
  const question = conversation.messages[index - 1]
  if (!question || question.role !== 'user') return
  const history = historyOf(conversation.messages, index - 1)
  update(conversationId, (current) => ({ ...current, messages: current.messages.slice(0, index) }))
  const scope: AskScope = question.scope?.pageId ? { pageId: question.scope.pageId } : question.scope?.today ? { today: true } : {}
  answer(conversationId, question.text, requestOf(question.text, scope, question.withSelection ? selection : null, history))
}

/** Stops the request running in a conversation; what streamed stays. */
export function cancel(conversationId: string | undefined): void {
  if (!conversationId) return
  handles.get(conversationId)?.cancel()
}

export function setOutcome(conversationId: string, messageId: number, outcome: Outcome | undefined): void {
  updateMessage(conversationId, messageId, (message) => {
    const next = { ...message }
    if (outcome) next.proposal = outcome
    else delete next.proposal
    return next
  })
  if (outcome?.state !== 'applying') persistSoon()
}

/** An answer that arrived without being asked here (a routine's): a conversation of its own, in front of the route. */
export function deliver(key: string, delivery: BalloonDelivery): string {
  const now = Date.now()
  const scope: StoredScope | undefined = delivery.pageId ? { pageId: delivery.pageId } : delivery.today ? { today: true } : undefined
  const conversation = createConversation(key, {
    title: conversationTitle(delivery.title || delivery.request),
    pageId: delivery.pageId ?? null,
    ...(delivery.today ? { today: true } : {}),
    source: delivery.source,
    messages: [
      { id: ++nextMessageId, role: 'user', text: delivery.request, at: now, ...(scope ? { scope } : {}) },
      {
        id: ++nextMessageId,
        role: 'assistant',
        text: delivery.answer,
        at: now,
        run: { ...IDLE, status: 'done', text: delivery.answer, ...(delivery.sent ? { sent: delivery.sent } : {}) }
      }
    ]
  })
  persistSoon()
  return conversation.id
}

/** Forgets every conversation, here and on disk. Running requests stop. */
export async function deleteAllConversations(): Promise<void> {
  await loadConversations()
  for (const handle of handles.values()) handle.cancel()
  handles.clear()
  useConversations.setState({ list: [], active: {} })
  await persistNow()
}
