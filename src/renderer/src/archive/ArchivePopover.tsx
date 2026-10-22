import { Suspense, lazy } from 'react'
import { Popover, type PopoverAnchor } from '@/ui/Popover'
import { useArchiveCopy } from './locale'

const load = (): Promise<typeof import('./ArchiveList')> => import('./ArchiveList')
const ArchiveList = lazy(() => load().then((module) => ({ default: module.ArchiveList })))

/** Starts fetching the Archive list; call it when the pointer or the focus reaches its trigger. */
export function preloadArchive(): void {
  load().catch(() => undefined)
}

export function ArchivePopover({ anchor, open, onClose }: { anchor: PopoverAnchor; open: boolean; onClose: () => void }) {
  const copy = useArchiveCopy()
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} placement="right-start" label={copy.section} className="trash-popover">
      <Suspense fallback={<div className="trash archive" aria-busy="true" />}>
        <ArchiveList onClose={onClose} />
      </Suspense>
    </Popover>
  )
}
