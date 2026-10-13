import { Suspense, lazy, useEffect, useState } from 'react'
import { useUi } from '@/store/ui'

// The settings window and the appearance editor behind it are only fetched when somebody
// opens them. The appearance *engine* (appearance/store.ts) is not part of this chunk: saved
// overrides are applied at start-up whether or not the editor is ever shown.
const load = (): Promise<typeof import('./SettingsDialog')> => import('./SettingsDialog')
const SettingsDialog = lazy(() => load().then((module) => ({ default: module.SettingsDialog })))

/** Starts fetching the settings window; call it when the pointer or the focus reaches its trigger. */
export function preloadSettings(): void {
  load().catch(() => undefined)
}

export function SettingsModal() {
  const open = useUi((state) => state.settingsOpen)
  // Stays mounted once shown, so that closing and reopening never suspends again.
  const [wanted, setWanted] = useState(open)
  useEffect(() => {
    if (open) setWanted(true)
  }, [open])
  if (!open && !wanted) return null
  return (
    <Suspense fallback={null}>
      <SettingsDialog />
    </Suspense>
  )
}
