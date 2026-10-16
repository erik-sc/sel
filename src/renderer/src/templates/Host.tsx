// Mount point for the template gallery. Its contents (and the templates' data) are fetched on demand.
import { Suspense, lazy } from 'react'
import { Modal } from '@/ui/Modal'
import { closeTemplates, useTemplatesCopy, useTemplatesGate } from './gate'

const load = (): Promise<typeof import('./Gallery')> => import('./Gallery')
const Gallery = lazy(() => load().then((module) => ({ default: module.Gallery })))

/** Fetches the gallery (when a pointer comes near one of its entry points). */
export function preloadTemplates(): void {
  load().catch(() => undefined)
}

export function TemplatesHost() {
  const open = useTemplatesGate((state) => state.open)
  const copy = useTemplatesCopy()
  return (
    <Modal open={open} onClose={closeTemplates} label={copy.title} className="templates">
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    </Modal>
  )
}
