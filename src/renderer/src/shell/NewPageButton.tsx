// "New page" in the sidebar: a click makes a blank page; the chevron (or a right click) offers
// the other kinds of page, such as a LaTeX document.
import { useState } from 'react'
import type { JSX } from 'react'
import { latexShellCopy } from '@/latex/locale'
import { newLatexDocument } from '@/latex/gate'
import type { MenuItem } from '@/ui/Menu'
import { Menu } from '@/ui/Menu'
import { Popover, type PopoverAnchor } from '@/ui/Popover'
import { ChevronDown, Page, Plus, Sigma } from '@/ui/icons'
import { createPage, reportError } from './actions'
import './newPage.css'

/** The kinds of page "New page ▸" offers, made under `parentId` (the workspace root when null). */
export function newPageItems(parentId: string | null): MenuItem[] {
  return [
    { id: 'new-page-blank', label: 'Page', icon: <Page />, onSelect: () => void createPage(parentId).catch(reportError('create the page')) },
    { id: 'new-page-latex', label: latexShellCopy().newDocument, icon: <Sigma />, onSelect: () => newLatexDocument(parentId) }
  ]
}

export function NewPageButton(): JSX.Element {
  const [anchor, setAnchor] = useState<PopoverAnchor>(null)
  const close = (): void => setAnchor(null)
  return (
    <div className="sidebar-action new-page-action">
      <button
        type="button"
        className="new-page-main"
        onClick={() => void createPage(null).catch(reportError('create the page'))}
        onContextMenu={(e) => {
          e.preventDefault()
          setAnchor({ x: e.clientX, y: e.clientY })
        }}
      >
        <Plus />
        <span>New page</span>
      </button>
      <button
        type="button"
        className="new-page-more"
        aria-label="New page of another kind"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <ChevronDown size={12} />
      </button>
      {anchor && (
        <Popover open anchor={anchor} onClose={close}>
          <Menu items={newPageItems(null)} onClose={close} autoFocus />
        </Popover>
      )}
    </div>
  )
}
