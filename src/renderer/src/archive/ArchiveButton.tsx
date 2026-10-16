import { useRef, useState } from 'react'
import { Archive } from '@/ui/icons'
import { ArchivePopover, preloadArchive } from './ArchivePopover'
import { useArchiveCopy } from './locale'

/** The sidebar's "Archive" entry, next to the Trash: opens the list of archived pages. */
export function ArchiveButton() {
  const copy = useArchiveCopy()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        ref={ref}
        className={open ? 'sidebar-action is-active' : 'sidebar-action'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={preloadArchive}
        onFocus={preloadArchive}
        onClick={() => setOpen((value) => !value)}
      >
        <Archive />
        <span>{copy.section}</span>
      </button>
      <ArchivePopover anchor={ref.current} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
