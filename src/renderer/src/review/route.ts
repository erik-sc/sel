// The small part of the weekly review (0.8.0 E1) that is always loaded: the way to reach it, and
// the hook a later wave plugs the persona's summary into. The screen itself is a chunk of its own
// (screens.ts, Host.tsx).
import { create } from 'zustand'
import { REVIEW_ROUTE } from '@/routes'
import { openScreen } from '@/store/tabs'
import type { WeekDigest } from './steps'

export function isReviewRoute(pageId: string | null | undefined): boolean {
  return pageId === REVIEW_ROUTE
}

/**
 * Opens the weekly review. The palette, the View menu and Today's quiet line call it; the AI
 * routines (C1) may offer it on a Friday or Sunday evening through the `week-review` command,
 * which runs this. It never starts by itself.
 */
export function openWeekReview(): void {
  openScreen(REVIEW_ROUTE)
}

/**
 * What writes the optional summary of the week with the persona. Nothing does yet: the review
 * shows its "Summarise with the persona" button only once a later wave (C) registers one here,
 * and that one shows what it sends before it sends anything. The review itself never calls AI.
 */
export type WeekSummarizer = (digest: WeekDigest) => void

export const useWeekSummarizer = create<{ summarize: WeekSummarizer | null }>(() => ({ summarize: null }))

/** Plugs in (or, with null, takes out) the summary of the week. */
export function registerWeekSummarizer(summarize: WeekSummarizer | null): void {
  useWeekSummarizer.setState({ summarize })
}
