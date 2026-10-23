/**
 * Bringing notes in and taking them out: an import of a Notion export (a zip of Markdown and CSV)
 * or of an Obsidian vault (a folder of Markdown), and an export of the workspace, or of one page
 * with everything under it, as a zip that opens well in Obsidian. The main process reads and
 * writes every file, chosen in native dialogs: no path crosses to a window. An import is shown
 * first (what it will make), then made under one new page, "Imported on <day>", which deleting
 * undoes. See src/main/transfer/.
 */

import type { InvokeChannels } from './ipc'

export type ImportFormat = 'notion' | 'obsidian'

/** What an import makes, or made. */
export interface ImportCounts {
  /** Pages, the rows of databases included. */
  pages: number
  databases: number
  /** Images copied in. */
  attachments: number
  /** Files the pages show or link to that sel cannot keep (a PDF, a missing image): their name stays as text. */
  skipped: number
  /** Links to pages that are not in the import: their text stays, without the link. */
  unresolved: number
}

/** An import read and planned, waiting for "Import" or "Cancel". */
export interface ImportPreview {
  /** Names the plan kept in the main process, for `runImport` and `cancelImport`. */
  token: string
  format: ImportFormat
  /** The zip's or the folder's name. */
  source: string
  counts: ImportCounts
}

export type ImportPick = { outcome: 'cancelled' } | { outcome: 'ready'; preview: ImportPreview } | { outcome: 'invalid'; message: string }

export interface ImportResult {
  /** The page everything was made under. */
  pageId: string
  counts: ImportCounts
}

/** How far an import or an export is: `done` of `total` steps. */
export interface TransferProgress {
  kind: 'import' | 'export'
  done: number
  total: number
}

export interface ExportZipResult {
  saved: boolean
  pages?: number
  databases?: number
  images?: number
}

/** `window.api.transfer`. */
export interface TransferApi {
  /** Opens the dialog for a Notion zip or an Obsidian folder, reads it and answers what an import would make. */
  pickImport(format: ImportFormat): Promise<ImportPick>
  /** Makes the import a preview described, under a new page at the end of the workspace. */
  runImport(token: string): Promise<ImportResult>
  /** Forgets a preview that will not be imported. */
  cancelImport(token: string): Promise<void>
  /** Moves the page an import made (this session) to the trash, with everything in it. */
  undoImport(pageId: string): Promise<void>
  /** Asks where to save, and writes the workspace (or `pageId` with everything under it) as a zip. */
  exportZip(pageId: string | null): Promise<ExportZipResult>
  /** Progress of the import or export this window started. Returns the unsubscribe function. */
  onProgress(listener: (progress: TransferProgress) => void): () => void
}

/** The event channel of `onProgress`. */
export const TRANSFER_PROGRESS_CHANNEL = 'transfer:progress'

/** The invoke channels of `api.transfer` (see `INVOKE` in ./api.ts). */
export const TRANSFER_INVOKE = {
  'transfer:pickImport': true,
  'transfer:runImport': true,
  'transfer:cancelImport': true,
  'transfer:undoImport': true,
  'transfer:exportZip': true
} as const satisfies Record<InvokeChannels<{ transfer: TransferApi }>, true>
