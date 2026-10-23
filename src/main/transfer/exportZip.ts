import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Repository } from '../db/repository'
import { IMAGES_FOLDER, planExport } from '../data/exportAll'
import { ZipWriter } from './zip'

/**
 * The workspace, or one page with everything under it, as a zip that opens as an Obsidian vault:
 * one Markdown file per page in folders that follow the pages (../data/exportAll.ts plans them),
 * each database also as CSV, the images in `files/`, an `index.md` listing every page, and the
 * links between pages relative paths. An import of it (./plan.ts, as Obsidian) makes the same
 * pages again, nested the same way, linked the same way.
 */

export interface ExportZipOptions {
  /** One page (or database) and what is under it; absent: the workspace. */
  rootId?: string
  words: { archive: string; indexTitle: string }
  progress?(done: number, total: number): void
  pause?(): Promise<void>
}

export async function exportZip(
  repo: Repository,
  target: string,
  filesDir: string,
  options: ExportZipOptions
): Promise<{ pages: number; databases: number; images: number }> {
  const plan = planExport(repo, { archive: options.words.archive, zip: { indexTitle: options.words.indexTitle }, rootId: options.rootId })
  const total = plan.files.length + plan.images.length
  let done = 0
  const step = async (): Promise<void> => {
    done += 1
    options.progress?.(done, total)
    await options.pause?.()
  }
  const writer = await ZipWriter.create(target)
  let images = 0
  try {
    for (const file of plan.files) {
      await writer.add(file.path.join('/'), file.text)
      await step()
    }
    for (const name of plan.images) {
      try {
        await writer.add(`${IMAGES_FOLDER}/${name}`, await readFile(join(filesDir, name)), { compress: false })
        images += 1
      } catch {
        /* an image the page names but this computer does not have */
      }
      await step()
    }
    await writer.close()
  } catch (err) {
    await writer.abort()
    throw err
  }
  const named = (ext: string): number => plan.files.filter((f) => f.path.length && f.path[f.path.length - 1].endsWith(ext)).length
  const databases = named('.csv')
  return { pages: named('.md') - 1 - databases, databases, images }
}
