import { writeFile } from 'node:fs/promises'
import type { BrowserWindow, WebContents } from 'electron'
import type { Block } from '../shared/types'
import { plainText } from '../shared/richtext'
import type { Repository } from './db/repository'
import { safeFileName } from './markdown'

/**
 * Export of a LaTeX document (a page with `props.kind: 'latex'`). Its source is read here from
 * the database, not handed over by the renderer, and both exports go through a native dialog:
 * the renderer never names a path.
 */

export type PdfPageSize = 'A4' | 'Letter'

export function pdfPageSize(value: unknown): PdfPageSize {
  if (value !== 'A4' && value !== 'Letter') throw new Error('Invalid page size')
  return value
}

/** The block holding a LaTeX document's source: its first code child, a `latex` one first. */
export function latexSourceBlock(children: readonly Block[]): Block | undefined {
  const code = children.filter((b) => b.type === 'code' && b.trashedAt === null)
  return code.find((b) => b.props.language === 'latex') ?? code[0]
}

export function latexDocument(repo: Repository, id: string): { title: string; source: string } {
  const page = repo.get(id)
  if (!page || page.type !== 'page' || page.props.kind !== 'latex') throw new Error('This page is not a LaTeX document')
  const source = plainText(latexSourceBlock(repo.children(id))?.props.title)
  return { title: plainText(page.props.title).trim() || 'Untitled', source }
}

async function saveDialog(
  win: BrowserWindow | null,
  title: string,
  defaultPath: string,
  filter: { name: string; extensions: string[] }
): Promise<string | null> {
  const { dialog } = await import('electron')
  const options = { title, defaultPath, filters: [filter] }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export async function exportTex(repo: Repository, win: BrowserWindow | null, id: string): Promise<{ saved: boolean; path?: string }> {
  const { title, source } = latexDocument(repo, id)
  const path = await saveDialog(win, 'Export as LaTeX', `${safeFileName(title)}.tex`, { name: 'LaTeX', extensions: ['tex'] })
  if (!path) return { saved: false }
  await writeFile(path, source.endsWith('\n') ? source : `${source}\n`, 'utf8')
  return { saved: true, path }
}

/**
 * Prints the window that asked, whose print stylesheet shows only the document's preview
 * (see renderer/src/latex/print.ts), on A4 or Letter paper with LaTeX-like margins.
 */
export async function exportPdf(
  repo: Repository,
  win: BrowserWindow | null,
  contents: WebContents,
  id: string,
  pageSize: PdfPageSize
): Promise<{ saved: boolean; path?: string }> {
  const { title } = latexDocument(repo, id)
  const path = await saveDialog(win, 'Export as PDF', `${safeFileName(title)}.pdf`, { name: 'PDF', extensions: ['pdf'] })
  if (!path) return { saved: false }
  const data = await contents.printToPDF({
    pageSize,
    printBackground: false,
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    generateDocumentOutline: true
  })
  await writeFile(path, data)
  return { saved: true, path }
}
