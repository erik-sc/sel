import { Suspense, lazy } from 'react'
import { Popover } from '@/ui/Popover'

const load = (): Promise<typeof import('./TrashList')> => import('./TrashList')
const TrashList = lazy(() => load().then((module) => ({ default: module.TrashList })))

/** Starts fetching the Trash list; call it when the pointer or the focus reaches its trigger. */
export function preloadTrash(): void {
  load().catch(() => undefined)
}

export function TrashPopover({
  anchor,
  open,
  onClose
}: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
}) {
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} placement="right-start" className="trash-popover">
      <Suspense fallback={<div className="trash" aria-busy="true" />}>
        <TrashList onClose={onClose} />
      </Suspense>
    </Popover>
  )
}

