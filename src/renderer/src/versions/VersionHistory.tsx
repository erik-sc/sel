import { Suspense, lazy, useEffect, useState } from 'react'
import { useUi } from '@/store/ui'

// The version history window (timeline, read-only preview, diff) is only fetched when
// somebody opens it; nothing of it is part of the start-up bundle.
const load = (): Promise<typeof import('./VersionHistoryDialog')> => import('./VersionHistoryDialog')
const VersionHistoryDialog = lazy(() => load().then((module) => ({ default: module.VersionHistoryDialog })))

/** Starts fetching the window; call it when its trigger is about to be used. */
export function preloadVersionHistory(): void {
  load().catch(() => undefined)
}

export function VersionHistory() {
  const open = useUi((state) => state.historyPageId !== null)
  // Stays mounted once shown, so that closing and reopening never suspends again.
  const [wanted, setWanted] = useState(open)
  useEffect(() => {
    if (open) setWanted(true)
  }, [open])
  if (!open && !wanted) return null
  return (
    <Suspense fallback={null}>
      <VersionHistoryDialog />
    </Suspense>
  )
}
