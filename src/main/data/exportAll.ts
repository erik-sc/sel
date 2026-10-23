import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cellText } from '../../shared/database/cell'
import { normalizeDatabase } from '../../shared/database/normalize'
import { cellContext } from '../../shared/database/resolve'
import { sourceIdOf } from '../../shared/linked'
import type { Block } from '../../shared/types'
import type { Repository } from '../db/repository'
import { pageToMarkdown, safeFileName } from '../markdown'
import { csvCell } from '../transfer/columns'
import { toCsv } from '../transfer/csv'

/**
 * The whole workspace as Markdown files, for any editor to open: one `.md` per page, the pages
 * under a page in a folder of the same name, databases as tables (a row with writing of its own
 * gets a file too), archived pages in a folder of their own, the trash left out. Links between
 * pages and to images become relative paths, and the images are copied into `files/`.
 *
 * Planned first (pure: what to write, read from the repository), then written.
 */

export interface ExportFile {
  /** Path segments under the export folder; the last one is the file name. */
  path: string[]
  text: string
}

export interface ExportPlan {
  files: ExportFile[]
  /** Names of images in the app's files folder that the pages show. */
  images: string[]
}

export const IMAGES_FOLDER = 'files'
/** Deeper than this, sub-pages are written next to their page instead of in a folder of their own. */
const MAX_DEPTH = 24
/** The name of an image the app stored (files.ts): generated, with no separators. */
const IMAGE_NAME = '[A-Za-z0-9_-]{1,80}\\.[A-Za-z0-9]{2,5}'
const PAGE_LINK_RE = /\]\(sel:\/\/page\/([A-Za-z0-9_-]{1,64})\)/g
const IMAGE_LINK_RE = new RegExp(`\\]\\(sel-file://files/(${IMAGE_NAME})\\)`, 'g')

/** One path segment of a Markdown link: spaces and the characters that end a link are escaped. */
function linkSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[()!'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** The link from the file at `from` to the file at `to`, both given as segments from the export root. */
export function relativeLink(from: readonly string[], to: readonly string[]): string {
  const folder = from.slice(0, -1)
  let common = 0
  while (common < folder.length && common < to.length - 1 && folder[common] === to[common]) common += 1
  const up = folder.length - common
  return [...Array<string>(up).fill('..'), ...to.slice(common).map(linkSegment)].join('/')
}

export interface ExportOptions {
  /** The name of the folder of archived pages. */
  archive: string
  /**
   * The zip export (src/main/transfer/exportZip.ts): each database also as CSV (`Tasks.csv` next
   * to `Tasks.md`), linked to from its page rather than written into it, and an `index.md` that
   * lists every page in order, under this title.
   */
  zip?: { indexTitle: string }
  /** Only this page (or database) and everything under it; no archive folder. */
  rootId?: string
}

/** The front matter that marks the index of a zip export, which an import of it leaves out (src/main/transfer/plan.ts). */
export const INDEX_MARKER = 'sel-export: index'

/** A database as CSV: the title first, then every other property, one line per row. */
export function databaseCsv(repo: Repository, db: Block): string {
  const schema = normalizeDatabase(db).schema
  const ids = Object.keys(schema).sort((a, b) => Number(schema[b].type === 'title') - Number(schema[a].type === 'title'))
  const seen = new Map<string, Block | null>()
  const get = (id: string): Block | undefined => {
    if (!seen.has(id)) seen.set(id, repo.get(id))
    return seen.get(id) ?? undefined
  }
  const ctx = cellContext({ get, isMissing: (id) => get(id) === undefined })
  const rows = repo.children(db.id).filter((row) => row.type === 'page' && row.trashedAt === null)
  return toCsv([
    ids.map((id) => schema[id].name),
    ...rows.map((row) => ids.map((id) => csvCell(schema[id], row, () => cellText(row, schema[id], ctx))))
  ])
}

export function planExport(repo: Repository, words: ExportOptions): ExportPlan {
  const pages: { id: string; path: string[]; markdown: string }[] = []
  /** Every page written, in order, with how deep it sits: what the index lists. */
  const listed: { id: string; title: string; depth: number }[] = []
  const where = new Map<string, string[]>()
  /** Names taken in each folder, lower-cased: a page `Notes` claims both `Notes.md` and `Notes/`. */
  const taken = new Map<string, Set<string>>()

  const claim = (folder: string[], wanted: string): string => {
    const key = folder.join('/')
    let names = taken.get(key)
    if (!names) taken.set(key, (names = new Set()))
    let name = wanted
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${wanted} (${n})`
    names.add(name.toLowerCase())
    return name
  }

  const tables: { path: string[]; text: string }[] = []
  const visit = (block: Block, folder: string[], depth: number): void => {
    if (where.has(block.id)) return
    const { title, markdown } = pageToMarkdown(repo, block.id, { databaseLinks: !!words.zip })
    const name = claim(folder, safeFileName(title))
    const path = [...folder, `${name}.md`]
    where.set(block.id, path)
    pages.push({ id: block.id, path, markdown })
    listed.push({ id: block.id, title, depth })
    if (words.zip && block.type === 'database' && sourceIdOf(block) === null)
      tables.push({ path: [...folder, `${name}.csv`], text: databaseCsv(repo, block) })
    let below = repo.listChildren(block.id)
    // A database's rows are in its table; only those with writing of their own need a file.
    if (block.type === 'database') below = below.filter((row) => row.parentId !== block.id || row.content.length > 0)
    if (!below.length) return
    const inside = depth < MAX_DEPTH ? [...folder, name] : folder
    for (const child of below) visit(child, inside, depth + 1)
  }

  claim([], IMAGES_FOLDER)
  const index = words.zip ? `${claim([], 'index')}.md` : null
  if (words.rootId) {
    const root = repo.get(words.rootId)
    if (!root || root.trashedAt !== null || (root.type !== 'page' && root.type !== 'database')) throw new Error('The page is not there')
    visit(root, [], 0)
  } else {
    for (const block of repo.listRoot()) visit(block, [], 0)
    const archived = repo.listArchived()
    if (archived.length) {
      const folder = [claim([], words.archive)]
      for (const block of archived) visit(block, folder, 1)
    }
  }

  const images = new Set<string>()
  const files = pages.map(({ path, markdown }) => ({
    path,
    text: markdown
      .replace(PAGE_LINK_RE, (link, id: string) => {
        const target = where.get(id)
        return target ? `](${relativeLink(path, target)})` : link
      })
      .replace(IMAGE_LINK_RE, (_link, name: string) => {
        images.add(name)
        return `](${relativeLink(path, [IMAGES_FOLDER, name])})`
      })
  }))
  files.push(...tables)
  if (index && words.zip) {
    const lines = ['---', INDEX_MARKER, '---', '', `# ${words.zip.indexTitle}`, '']
    for (const { id, title, depth } of listed) {
      const target = where.get(id)
      if (target)
        lines.push(
          `${'    '.repeat(Math.min(depth, MAX_DEPTH))}- [${title.replace(/([\\`*_[\]<>~])/g, '\\$1')}](${relativeLink([index], target)})`
        )
    }
    files.unshift({ path: [index], text: `${lines.join('\n')}\n` })
  }
  return { files, images: [...images] }
}

/** Makes `<parent>/<name>`, or `<name> (2)`… when that exists already. Returns its path. */
export async function makeExportFolder(parent: string, name: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const path = join(parent, n === 1 ? name : `${name} (${n})`)
    try {
      await mkdir(path)
      return path
    } catch (err) {
      if ((err as { code?: string }).code !== 'EEXIST') throw err
    }
  }
  throw new Error('No free folder name')
}

/** Writes the plan under `root` (a new, empty folder). Images missing from `filesDir` are skipped. */
export async function writeExport(plan: ExportPlan, root: string, filesDir: string): Promise<{ pages: number; images: number }> {
  const folders = new Set<string>()
  for (const file of plan.files) {
    const folder = join(root, ...file.path.slice(0, -1))
    if (!folders.has(folder)) {
      await mkdir(folder, { recursive: true })
      folders.add(folder)
    }
    await writeFile(join(folder, file.path[file.path.length - 1]), file.text, { encoding: 'utf8', flag: 'wx' })
  }
  let images = 0
  if (plan.images.length) {
    const target = join(root, IMAGES_FOLDER)
    await mkdir(target, { recursive: true })
    for (const name of plan.images) {
      try {
        await copyFile(join(filesDir, name), join(target, name))
        images += 1
      } catch {
        /* an image the page names but this computer does not have */
      }
    }
  }
  return { pages: plan.files.length, images }
}
