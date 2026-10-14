// The always-loaded part of feedback: whether its dialog is open, and the one action every entry
// point (the sidebar button, the Help menu) shares. The dialog itself is a chunk of its own.
import { create } from 'zustand'
import type { FeedbackKind } from '@shared/feedback'

interface FeedbackGate {
  open: boolean
  /** Which kind the form starts on when it opens. */
  kind: FeedbackKind
}

export const useFeedbackGate = create<FeedbackGate>(() => ({ open: false, kind: 'bug' }))

export function openFeedback(kind: FeedbackKind = 'bug'): void {
  useFeedbackGate.setState({ open: true, kind })
}

export function closeFeedback(): void {
  useFeedbackGate.setState({ open: false })
}
