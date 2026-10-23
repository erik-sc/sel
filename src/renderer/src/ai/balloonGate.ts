// The small, always-loaded side of the conversation balloon: where it is anchored (the corner the
// persona keeps), and the doors other features use to reach it without loading it.
//
// - `offerInBalloon`: something that ran on its own (a routine) has an answer ready. The persona
//   says a line in its corner bubble ("I put together a plan for today, want to see it?"); the
//   user's "Show me" opens the balloon on that answer, proposal and all. Nothing is applied.
// - `openInBalloon`: the same, at once, for something the user just asked for.
// - `onReplyDone`: told each time an answer finishes in the balloon (the persona's memory listens
//   here to pick out what to remember).
// - `addReplyNote`: a small line under an answer ("Remembered: …" with "Undo").
// Everything with a face is in Balloon.tsx, fetched the first time the balloon opens.
import { create } from 'zustand'
import type { AiTurn } from '@shared/ai'
import type { AiSent } from '@shared/aiContext'
import type { HermanCorner } from '@shared/herman'
import { toast } from '../ui/toast'
import { useAiGate } from './gate'

/** An answer that arrived without the balloon being open. */
export interface BalloonDelivery {
  /** The conversation's title in "Earlier". */
  title: string
  /** What was asked (shown as the user's side of the conversation). */
  request: string
  /** The answer, Markdown; a `sel-actions` block in it shows as a proposal with Apply. */
  answer: string
  /** Who produced it: `routine:morning`, for instance. Shown nowhere; kept with the conversation. */
  source: string
  /** What the answer is about: a page, or the day. */
  pageId?: string
  today?: boolean
  sent?: AiSent
}

export interface BalloonOffer {
  id: number
  /** What the persona says in the corner. */
  line: string
  /** The button that opens it. */
  label: string
  /** The answer the button opens; absent for a line said by `sayInCorner`. */
  delivery?: BalloonDelivery
  /** What the button does instead (`sayInCorner`); no button when neither is there. */
  run?: () => void
}

/** One finished answer of the balloon, as `onReplyDone` hears it. */
export interface BalloonReply {
  conversationId: string
  messageId: number
  question: string
  answer: string
  /** The turns before this one, oldest first. */
  history: AiTurn[]
  pageId: string | null
  /**
   * The tab route it was asked from (a page id, or a screen's), when known. On a page private from
   * the AI `pageId` is null, since the question went without it; this still names the page.
   */
  route?: string | null
}

/** A small line under an answer. Not stored: it is for the moment. */
export interface ReplyNote {
  id: number
  text: string
  action?: { label: string; run(): void | Promise<void> }
}

interface BalloonGate {
  /** Where the persona is docked, and how large; null while it is off (the balloon then keeps the bottom-right corner alone). */
  anchor: { corner: HermanCorner; size: 'small' | 'medium' } | null
  /** An answer waiting behind a line of the persona. */
  offer: BalloonOffer | null
  /** An answer the balloon opens on next. */
  pending: BalloonDelivery | null
  /** Notes by `${conversationId}:${messageId}`. */
  notes: Record<string, ReplyNote[]>
  /** The last answer that finished: where `addReplyNote` puts a note by default. */
  lastReply: { conversationId: string; messageId: number } | null
}

export const useBalloon = create<BalloonGate>(() => ({ anchor: null, offer: null, pending: null, notes: {}, lastReply: null }))

let nextId = 0

/** Called by the persona's corner while it is shown. */
export function setBalloonAnchor(anchor: BalloonGate['anchor']): void {
  const current = useBalloon.getState().anchor
  if (current?.corner === anchor?.corner && current?.size === anchor?.size) return
  useBalloon.setState({ anchor })
}

function open(): void {
  const gate = useAiGate.getState()
  if (gate.enabled && !gate.balloonOpen) useAiGate.setState({ balloonOpen: true })
}

/** Opens the balloon on an answer that is ready. */
export function openInBalloon(delivery: BalloonDelivery): void {
  if (!useAiGate.getState().enabled) return
  useBalloon.setState({ pending: delivery, offer: null })
  open()
}

/**
 * Has the persona offer an answer that is ready: a line in its corner with a button that opens
 * it. Replaces an offer not yet taken. With the persona off, the line is a toast with that button.
 */
export function offerInBalloon(line: string, delivery: BalloonDelivery, label = 'Show me'): void {
  if (!useAiGate.getState().enabled) return
  if (!useBalloon.getState().anchor) {
    toast(line, { action: { label, run: () => openInBalloon(delivery) } })
    return
  }
  useBalloon.setState({ offer: { id: ++nextId, line, label, delivery } })
}

/**
 * Has the persona say a line in its corner that opens no answer: with a button that does
 * something else ("Open the review"), or none ("That is all the routines for today"). With the
 * persona off, the line is a toast.
 */
export function sayInCorner(line: string, action?: { label: string; run(): void }): void {
  if (!useBalloon.getState().anchor) {
    toast(line, action ? { action: { label: action.label, run: action.run } } : {})
    return
  }
  useBalloon.setState({ offer: { id: ++nextId, line, label: action?.label ?? '', ...(action ? { run: action.run } : {}) } })
}

/** Takes back an offer not yet taken (the routine that made it was turned off, say). */
export function dropOffer(): void {
  if (useBalloon.getState().offer) useBalloon.setState({ offer: null })
}

const replyListeners = new Set<(reply: BalloonReply) => void>()

/** Hears every answer that finishes in the balloon. Returns an unsubscribe function. */
export function onReplyDone(listener: (reply: BalloonReply) => void): () => void {
  replyListeners.add(listener)
  return () => replyListeners.delete(listener)
}

/** Called by the balloon when an answer finishes. */
export function emitReplyDone(reply: BalloonReply): void {
  useBalloon.setState({ lastReply: { conversationId: reply.conversationId, messageId: reply.messageId } })
  for (const listener of replyListeners) {
    try {
      listener(reply)
    } catch (error) {
      console.error('a listener of the balloon failed', error)
    }
  }
}

/**
 * Puts a small line under an answer: the one given, or the last that finished. Returns a
 * function that takes it away again (also what an "Undo" in it would call once done).
 */
export function addReplyNote(
  note: Omit<ReplyNote, 'id'>,
  at: { conversationId: string; messageId: number } | null = useBalloon.getState().lastReply
): () => void {
  if (!at) return () => undefined
  const key = `${at.conversationId}:${at.messageId}`
  const full: ReplyNote = { ...note, id: ++nextId }
  useBalloon.setState((state) => ({ notes: { ...state.notes, [key]: [...(state.notes[key] ?? []), full] } }))
  return () =>
    useBalloon.setState((state) => ({ notes: { ...state.notes, [key]: (state.notes[key] ?? []).filter((entry) => entry.id !== full.id) } }))
}
