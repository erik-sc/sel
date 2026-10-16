// The small part of LaTeX documents that is always loaded: what a LaTeX document is, making one
// ("New page ▸ LaTeX document", the palette), and the commands that reach the one on screen.
// The screen itself (editor, preview, KaTeX) is a chunk of its own, see ./lazy.tsx.
import type { Block } from '@shared/types'
import { registerCommands } from '@/commands/registry'
import { applyOps, getBlock, newId } from '@/store/blocks'
import { activeTab, openPage, tabPage } from '@/store/tabs'
import { loadTreeChildren, refreshTree } from '@/store/tree'
import { setExpanded } from '@/store/ui'
import { notifyError } from '@/ui/toast'
import { preloadLatex } from './lazy'
import { currentLatexLocale, latexShellCopy } from './locale'

/** The language of the code block that holds a document's source. */
export const LATEX_LANGUAGE = 'latex'

export function isLatexDocument(block: Block | null | undefined): boolean {
  return !!block && block.type === 'page' && block.props.kind === 'latex'
}

/** Creates a LaTeX document, its source an `article` skeleton in the app's language, and opens it. */
export async function createLatexDocument(parentId: string | null, opts: { newTab?: boolean } = {}): Promise<string> {
  const locale = currentLatexLocale()
  preloadLatex()
  const { skeleton } = await import('./words')
  const id = newId()
  const done = applyOps([
    { op: 'create', input: { id, type: 'page', parentId, props: { title: [[latexShellCopy().untitled]], kind: 'latex' } } },
    {
      op: 'create',
      input: { id: newId(), type: 'code', parentId: id, afterId: null, props: { title: [[skeleton(locale)]], language: LATEX_LANGUAGE } }
    }
  ])
  if (parentId) setExpanded(parentId, true)
  openPage(id, { newTab: opts.newTab })
  try {
    await done
  } finally {
    await (parentId ? loadTreeChildren(parentId) : refreshTree()).catch((error: unknown) => console.error('tree refresh failed', error))
  }
  return id
}

export function newLatexDocument(parentId: string | null = null): void {
  void createLatexDocument(parentId).catch((error: unknown) => notifyError('Could not create the LaTeX document.', error))
}

// ---- the open document's own actions

export type LatexAction = 'export-pdf' | 'find'

const screens = new Set<(pageId: string, action: LatexAction) => boolean>()

/** A LaTeX screen listens for the actions on its document while it is mounted. */
export function onLatexAction(handler: (pageId: string, action: LatexAction) => boolean): () => void {
  screens.add(handler)
  return () => screens.delete(handler)
}

/** The LaTeX document in the active tab, if that is what it shows. */
export function activeLatexDocument(): Block | null {
  const block = getBlock(tabPage(activeTab()))
  return block && !block.trashedAt && isLatexDocument(block) ? block : null
}

/** Asks the screen of the active LaTeX document to do `action`; false when there is none. */
export function runLatexAction(action: LatexAction): boolean {
  const page = activeLatexDocument()
  if (!page) return false
  for (const handler of screens) if (handler(page.id, action)) return true
  return false
}

export function exportLatexTex(pageId: string): void {
  window.api.pages.exportTex(pageId).catch((error: unknown) => notifyError('Could not export the document.', error))
}

registerCommands([
  {
    id: 'latex-new',
    get title() {
      return latexShellCopy().commandNew
    },
    get keywords() {
      return latexShellCopy().keywords
    },
    run: () => newLatexDocument(null)
  },
  {
    id: 'latex-export-tex',
    get title() {
      return latexShellCopy().commandExportTex
    },
    keywords: ['latex', 'tex', 'save', 'download', 'file'],
    when: () => !!activeLatexDocument(),
    run: () => {
      const page = activeLatexDocument()
      if (page) exportLatexTex(page.id)
    }
  },
  {
    id: 'latex-export-pdf',
    get title() {
      return latexShellCopy().commandExportPdf
    },
    keywords: ['latex', 'pdf', 'print', 'save', 'download', 'file'],
    when: () => !!activeLatexDocument(),
    run: () => void runLatexAction('export-pdf')
  }
])
