import { Archive } from '@/ui/icons'
import { toggleSidebarPanel, useSidebarPanel } from '@/shell/sidebarPanels'
import { preloadArchive } from './ArchivePopover'
import { useArchiveCopy } from './locale'

/** The sidebar's "Archive" entry, next to the Trash: opens the list of archived pages (drawn by the sidebar). */
export function ArchiveButton() {
  const copy = useArchiveCopy()
  const open = useSidebarPanel((state) => state.open === 'archive')
  return (
    <button
      type="button"
      className={open ? 'sidebar-action is-active' : 'sidebar-action'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerEnter={preloadArchive}
      onFocus={preloadArchive}
      onClick={(event) => toggleSidebarPanel('archive', event.currentTarget)}
    >
      <Archive />
      <span>{copy.section}</span>
    </button>
  )
}
