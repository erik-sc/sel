// Mount point for the feedback dialog. What it renders is fetched the first time it opens.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useFeedbackGate } from './gate'

const load = (): Promise<typeof import('./FeedbackDialog')> => import('./FeedbackDialog')
const FeedbackDialog = lazy(() => load().then((module) => ({ default: module.FeedbackDialog })))

/** Starts fetching the dialog; call it when the pointer or the focus reaches its trigger. */
export function preloadFeedback(): void {
  load().catch(() => undefined)
}

export function FeedbackHost(): JSX.Element | null {
  const open = useFeedbackGate((state) => state.open)
  // Stays mounted once shown, so that closing and reopening never suspends again.
  const [wanted, setWanted] = useState(open)
  useEffect(() => {
    if (open) setWanted(true)
  }, [open])
  if (!open && !wanted) return null
  return (
    <Suspense fallback={null}>
      <FeedbackDialog />
    </Suspense>
  )
}
