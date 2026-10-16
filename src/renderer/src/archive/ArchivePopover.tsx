import { Suspense, lazy } from 'react'
import { Popover } from '@/ui/Popover'

const load = (): Promise<typeof import('./ArchiveList')> => import('./ArchiveList')
const ArchiveList = lazy(() => load().then((module) => ({ default: module.ArchiveList })))

/** Starts fetching the Archive list; call it when the pointer or the focus reaches its trigger. */
export function preloadArchive(): void {
  load().catch(() => undefined)
}

export function ArchivePopover({ anchor, open, onClose }: { anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} placement="right-start" className="trash-popover">
      <Suspense fallback={<div className="trash archive" aria-busy="true" />}>
        <ArchiveList onClose={onClose} />
      </Suspense>
    </Popover>
  )
}
