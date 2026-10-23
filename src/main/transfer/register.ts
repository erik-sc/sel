import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog } from 'electron'
import { dataLocale } from '../../shared/dataCopy'
import {
  TRANSFER_PROGRESS_CHANNEL,
  type ImportFormat,
  type ImportPick,
  type ImportResult,
  type TransferProgress
} from '../../shared/transfer'
import { TRANSFER_COPY, type TransferCopy } from '../../shared/transferCopy'
import { defineFeature, type Registered } from '../feature'
import { filesDir, MAX_IMAGE_BYTES, storeImage } from '../files'
import type { Handlers } from '../invoke'
import { safeFileName } from '../markdown'
import * as arg from '../validate'
import { plainText } from '../../shared/richtext'
import { exportZip } from './exportZip'
import { planImport, type ImportPlan } from './plan'
import { runImport, undoImport } from './run'
import { folderSource, zipSource, type ImportSource } from './source'
import { ZipError } from './zip'

/** A preview not imported is forgotten after this long. */
const PENDING_MS = 30 * 60_000
/** Progress reaches a window at most this often. */
const PROGRESS_EVERY_MS = 100

const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** The local day, `YYYY-MM-DD`: in the name of the zip and of the page an import goes under. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function format(value: unknown): ImportFormat {
  if (value !== 'notion' && value !== 'obsidian') throw new Error('Invalid import format')
  return value
}

/** Tells the window that asked how far its import or export is, at most every so often (and always at the end). */
function reporter(sender: Electron.WebContents, kind: TransferProgress['kind']): (done: number, total: number) => void {
  let last = 0
  return (done, total) => {
    const now = Date.now()
    if (done < total && now - last < PROGRESS_EVERY_MS) return
    last = now
    if (!sender.isDestroyed()) sender.send(TRANSFER_PROGRESS_CHANNEL, { kind, done, total } satisfies TransferProgress)
  }
}

/**
 * The `transfer:*` channel: importing a Notion export or an Obsidian vault (read and planned
 * first, made only on "Import"), undoing it, and exporting as a zip. Every file is chosen in a
 * native dialog; the window only ever holds a token for a planned import.
 */
export const transferFeature = defineFeature({
  namespace: 'transfer',
  register: (ctx): Registered<'transfer'> => {
    const { repo } = ctx
    const pending = new Map<string, { plan: ImportPlan; source: ImportSource; timer: NodeJS.Timeout }>()
    /** The pages imports made since sel started: the only ones "Undo import" may move to the trash. */
    const imported = new Set<string>()

    const copy = (): TransferCopy => TRANSFER_COPY[dataLocale(repo.getSetting('ai.language'), app.getLocale())]
    const ownerOf = (sender: Electron.WebContents): BrowserWindow | null => BrowserWindow.fromWebContents(sender)
    const forget = (token: string): void => {
      const entry = pending.get(token)
      if (!entry) return
      pending.delete(token)
      clearTimeout(entry.timer)
      void entry.source.close()
    }

    const pick = async (win: BrowserWindow | null, kind: ImportFormat): Promise<ImportPick> => {
      const words = copy()
      const options: Electron.OpenDialogOptions =
        kind === 'notion'
          ? { title: words.chooseNotion, properties: ['openFile'], filters: [{ name: words.notionFilter, extensions: ['zip'] }] }
          : { title: words.chooseObsidian, properties: ['openDirectory'] }
      const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      const path = picked.filePaths[0]
      if (picked.canceled || !path) return { outcome: 'cancelled' }
      let source: ImportSource
      try {
        source = kind === 'notion' || /\.zip$/i.test(path) ? await zipSource(path) : await folderSource(path)
      } catch (err) {
        if (err instanceof ZipError) return { outcome: 'invalid', message: err.message }
        throw err
      }
      try {
        const plan = await planImport(source, kind, pause)
        if (!plan.nodes.length) {
          await source.close()
          return { outcome: 'invalid', message: words.nothingToImport }
        }
        const token = randomUUID()
        pending.set(token, { plan, source, timer: setTimeout(() => forget(token), PENDING_MS) })
        return { outcome: 'ready', preview: { token, format: kind, source: plan.sourceName, counts: plan.counts } }
      } catch (err) {
        await source.close()
        if (err instanceof ZipError) return { outcome: 'invalid', message: err.message }
        throw err
      }
    }

    const run = async (sender: Electron.WebContents, token: string): Promise<ImportResult> => {
      const entry = pending.get(token)
      if (!entry) throw new Error('This import is no longer ready: choose the file again')
      pending.delete(token)
      clearTimeout(entry.timer)
      const words = copy()
      try {
        const result = await runImport(repo, entry.plan, {
          title: words.importedOn(today()),
          storeImage: async (file) => storeImage(await file.read(MAX_IMAGE_BYTES)),
          progress: reporter(sender, 'import'),
          pause
        })
        imported.add(result.pageId)
        return result
      } finally {
        await entry.source.close()
      }
    }

    const handlers: Handlers<'transfer'> = {
      'transfer:pickImport': ([kind], event) => pick(ownerOf(event.sender), format(kind)),
      'transfer:runImport': ([token], event) => run(event.sender, arg.text(token, 'token', 64)),
      'transfer:cancelImport': ([token]) => forget(arg.text(token, 'token', 64)),
      'transfer:undoImport': ([pageId]) => {
        const id = arg.id(pageId, 'pageId')
        if (!imported.has(id)) throw new Error('Only an import made since sel started can be undone here')
        imported.delete(id)
        undoImport(repo, id)
      },
      'transfer:exportZip': async ([pageId], event) => {
        const rootId = arg.nullableId(pageId, 'pageId') ?? undefined
        const words = copy()
        const root = rootId ? repo.get(rootId) : null
        if (rootId && !root) throw new Error('The page is not there')
        const name = root ? `${safeFileName(plainText(root.props.title) || 'Untitled')}.zip` : words.zipName(today())
        const options: Electron.SaveDialogOptions = {
          title: words.saveZip,
          defaultPath: name,
          filters: [{ name: words.zipFilter, extensions: ['zip'] }]
        }
        const win = ownerOf(event.sender)
        const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        if (picked.canceled || !picked.filePath) return { saved: false }
        const target = /\.zip$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.zip`
        const written = await exportZip(repo, target, filesDir(), {
          rootId,
          words: { archive: words.archiveFolder, indexTitle: words.indexTitle },
          progress: reporter(event.sender, 'export'),
          pause
        })
        return { saved: true, ...written }
      }
    }
    return { handlers }
  }
})
