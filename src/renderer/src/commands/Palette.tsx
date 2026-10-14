import { Suspense, lazy } from 'react'
import { Modal } from '@/ui/Modal'
import { closePalette, loadPaletteRecent, usePalette } from './store'
// The registry is filled at start-up, so other screens (and main's menu commands) can rely on it.
import './builtin'

const load = (): Promise<typeof import('./PaletteBody')> => import('./PaletteBody')
const PaletteBody = lazy(() => load().then((module) => ({ default: module.PaletteBody })))

/** Fetches the palette's contents and the recently used commands (done at idle time after start-up). */
export function preloadPalette(): void {
  load().catch(() => undefined)
  void loadPaletteRecent()
}

/** The command palette (Ctrl+K): every command in the registry, searchable. */
export function CommandPalette() {
  const open = usePalette((state) => state.open)
  return (
    <Modal open={open} onClose={closePalette} label="Command palette" align="top" className="quickfind palette">
      <Suspense fallback={<div className="quickfind-input" aria-busy="true" />}>
        <PaletteBody />
      </Suspense>
    </Modal>
  )
}
