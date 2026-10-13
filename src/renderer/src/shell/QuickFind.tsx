import { Suspense, lazy } from 'react'
import { setQuickFindOpen, useUi } from '@/store/ui'
import { Modal } from '@/ui/Modal'

const load = (): Promise<typeof import('./QuickFindBody')> => import('./QuickFindBody')
const QuickFindBody = lazy(() => load().then((module) => ({ default: module.QuickFindBody })))

/** Starts fetching the search dialog's contents (done at idle time after start-up). */
export function preloadQuickFind(): void {
  load().catch(() => undefined)
}

export function QuickFind() {
  const open = useUi((state) => state.quickFindOpen)
  return (
    <Modal open={open} onClose={() => setQuickFindOpen(false)} label="Quick find" align="top" className="quickfind">
      <Suspense fallback={<div className="quickfind-input" aria-busy="true" />}>
        <QuickFindBody />
      </Suspense>
    </Modal>
  )
}
