// The always-loaded part of importing and exporting (shared/transfer.ts): where an import stands,
// the actions every entry point shares (Settings → Data, the command palette), and the palette's
// commands. The dialog that shows an import is a chunk of its own (Host.tsx).
import { create } from 'zustand'
import type { ImportFormat, ImportPreview, ImportResult } from '@shared/transfer'
import { TRANSFER_COPY, type TransferCopy } from '@shared/transferCopy'
import type { Block } from '@shared/types'
import { dataLocaleNow, useDataCopy } from '@/backup/locale'
import { registerCommands } from '@/commands/registry'
import { routeTitle } from '@/screens'
import { getBlock } from '@/store/blocks'
import { activeTab, tabPage } from '@/store/tabs'
import { notifyError, toast } from '@/ui/toast'

export type ImportState =
  | { step: 'closed' }
  | { step: 'reading'; format: ImportFormat }
  | { step: 'preview'; preview: ImportPreview }
  | { step: 'importing'; preview: ImportPreview; done: number; total: number }
  | { step: 'done'; result: ImportResult; undone: boolean }
  | { step: 'error'; format: ImportFormat; message: string }

interface TransferGate {
  import: ImportState
  /** An export to a zip under way: how far. */
  exporting: { done: number; total: number } | null
}

export const useTransfer = create<TransferGate>(() => ({ import: { step: 'closed' }, exporting: null }))

const copy = (): TransferCopy => TRANSFER_COPY[dataLocaleNow()]

/** The words of importing and exporting, for a component that redraws when the language changes. */
export function useTransferCopy(): TransferCopy {
  return TRANSFER_COPY[useDataCopy().locale]
}
const setImport = (next: ImportState): void => useTransfer.setState({ import: next })

let listening = false
/** Progress from the main process reaches the step it belongs to. */
function listen(): void {
  if (listening) return
  listening = true
  window.api.transfer.onProgress(({ kind, done, total }) => {
    if (kind === 'export') {
      if (useTransfer.getState().exporting) useTransfer.setState({ exporting: { done, total } })
      return
    }
    const state = useTransfer.getState().import
    if (state.step === 'importing') setImport({ ...state, done, total })
  })
}

/** Asks for a Notion zip or an Obsidian folder, then shows what it would make. */
export function chooseImport(format: ImportFormat): void {
  const now = useTransfer.getState().import.step
  if (now === 'reading' || now === 'importing') return
  listen()
  setImport({ step: 'reading', format })
  window.api.transfer.pickImport(format).then(
    (pick) => {
      if (pick.outcome === 'cancelled') setImport({ step: 'closed' })
      else if (pick.outcome === 'invalid') setImport({ step: 'error', format, message: pick.message })
      else setImport({ step: 'preview', preview: pick.preview })
    },
    (error: unknown) => {
      window.api.app.log('An import could not be read', error)
      setImport({ step: 'error', format, message: copy().failed })
    }
  )
}

export function confirmImport(): void {
  const state = useTransfer.getState().import
  if (state.step !== 'preview') return
  const { preview } = state
  setImport({ step: 'importing', preview, done: 0, total: 0 })
  window.api.transfer.runImport(preview.token).then(
    (result) => setImport({ step: 'done', result, undone: false }),
    (error: unknown) => {
      window.api.app.log('An import failed', error)
      setImport({ step: 'error', format: preview.format, message: copy().failed })
    }
  )
}

export function undoLastImport(): void {
  const state = useTransfer.getState().import
  if (state.step !== 'done' || state.undone) return
  window.api.transfer.undoImport(state.result.pageId).then(
    () => setImport({ ...state, undone: true }),
    (error: unknown) => notifyError(copy().failed, error)
  )
}

/** Closes the dialog; a preview not imported is forgotten. An import under way goes on. */
export function closeImport(): void {
  const state = useTransfer.getState().import
  if (state.step === 'importing' || state.step === 'reading') return
  if (state.step === 'preview') void window.api.transfer.cancelImport(state.preview.token).catch(() => undefined)
  setImport({ step: 'closed' })
}

/** Exports the workspace, or `pageId` with everything under it, to a zip the user names. Resolves with what was saved. */
export function exportZip(pageId: string | null): Promise<{ pages: number; databases: number; images: number } | null> {
  if (useTransfer.getState().exporting) return Promise.resolve(null)
  listen()
  useTransfer.setState({ exporting: { done: 0, total: 0 } })
  return window.api.transfer
    .exportZip(pageId)
    .then((result) => (result.saved ? { pages: result.pages ?? 0, databases: result.databases ?? 0, images: result.images ?? 0 } : null))
    .finally(() => useTransfer.setState({ exporting: null }))
}

/** The page (or database) in the active tab, if it is one and not in the Trash. */
function currentPage(): Block | null {
  const pageId = tabPage(activeTab())
  if (!pageId || routeTitle(pageId)) return null
  const block = getBlock(pageId)
  return block && !block.trashedAt && (block.type === 'page' || block.type === 'database') ? block : null
}

function exportFromPalette(pageId: string | null): void {
  exportZip(pageId).then(
    (saved) => {
      if (saved) toast(copy().exported(saved.pages, saved.databases, saved.images), { kind: 'success' })
    },
    (error: unknown) => notifyError(copy().failed, error)
  )
}

const KEYWORDS = ['import', 'importar', 'export', 'exportar', 'zip', 'markdown', 'md', 'csv', 'backup', 'migrate', 'migrar']

registerCommands([
  {
    id: 'transfer-import-notion',
    get title() {
      return copy().commandImportNotion
    },
    keywords: [...KEYWORDS, 'notion'],
    run: () => chooseImport('notion')
  },
  {
    id: 'transfer-import-obsidian',
    get title() {
      return copy().commandImportObsidian
    },
    keywords: [...KEYWORDS, 'obsidian', 'vault', 'cofre', 'wikilinks'],
    run: () => chooseImport('obsidian')
  },
  {
    id: 'transfer-export-zip',
    get title() {
      return copy().commandExportZip
    },
    keywords: [...KEYWORDS, 'obsidian', 'everything', 'tudo', 'workspace'],
    run: () => exportFromPalette(null)
  },
  {
    id: 'transfer-export-page-zip',
    get title() {
      return copy().commandExportPageZip
    },
    keywords: [...KEYWORDS, 'obsidian', 'page', 'página', 'project', 'projeto', 'subpages'],
    when: () => !!currentPage(),
    run: () => {
      const page = currentPage()
      if (page) exportFromPalette(page.id)
    }
  }
])
