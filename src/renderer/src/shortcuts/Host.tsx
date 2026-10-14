// Mount point for the keyboard shortcuts screen (Ctrl+/). Its contents are fetched on demand.
import { Suspense, lazy } from 'react'
import { Modal } from '@/ui/Modal'
import { closeShortcuts, useShortcutsGate } from './gate'

const load = (): Promise<typeof import('./ShortcutsBody')> => import('./ShortcutsBody')
const ShortcutsBody = lazy(() => load().then((module) => ({ default: module.ShortcutsBody })))

/** Fetches the screen's contents (done at idle time after start-up). */
export function preloadShortcuts(): void {
  load().catch(() => undefined)
}

export function ShortcutsHost() {
  const open = useShortcutsGate((state) => state.open)
  return (
    <Modal open={open} onClose={closeShortcuts} label="Keyboard shortcuts" align="top" className="shortcuts">
      <Suspense fallback={null}>
        <ShortcutsBody />
      </Suspense>
    </Modal>
  )
}
