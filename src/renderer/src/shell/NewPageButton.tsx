// "New page" in the sidebar: a click makes a blank page; the chevron (or a right click) offers
// the other kinds of page, such as a LaTeX document.
import { useState } from 'react'
import type { JSX } from 'react'
import { latexShellCopy } from '@/latex/locale'
import { newLatexDocument } from '@/latex/gate'
import type { MenuItem } from '@/ui/Menu'
import { Menu } from '@/ui/Menu'
import { Popover, type PopoverAnchor } from '@/ui/Popover'
import { Board, ChevronDown, Page, Plus, Sigma } from '@/ui/icons'
import { openTemplates, templatesCopy } from '@/templates/gate'
import { preloadTemplates } from '@/templates/Host'
import { useSidebarCopy } from './sidebarLayout'
import { createPage, reportError } from './actions'
import './newPage.css'

/** The kinds of page "New page ▸" offers, made under `parentId` (the workspace root when null). */
export function newPageItems(parentId: string | null): MenuItem[] {
  return [
    {
      id: 'new-page-blank',
      label: 'Page',
      icon: <Page />,
      onSelect: () => void createPage(parentId).catch(reportError('create the page'))
    },
    { id: 'new-page-latex', label: latexShellCopy().newDocument, icon: <Sigma />, onSelect: () => newLatexDocument(parentId) },
    {
      id: 'new-page-template',
      label: templatesCopy().open,
      icon: <Board />,
      onSelect: () => (parentId ? openTemplates({ pageId: parentId, inside: true }) : openTemplates())
    }
  ]
}

export function NewPageButton(): JSX.Element {
  const copy = useSidebarCopy()
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
        <span>{copy.items['new-page']}</span>
      </button>
      <button
        type="button"
        className="new-page-more"
        aria-label="New page of another kind"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onPointerEnter={preloadTemplates}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <ChevronDown size={12} />
      </button>
      {anchor && (
        <Popover open anchor={anchor} role="none" onClose={close}>
          <Menu items={newPageItems(null)} onClose={close} autoFocus />
        </Popover>
      )}
    </div>
  )
}
