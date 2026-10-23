import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { bufferAccess, fileAccess, openZip, ZipError, type ZipArchive } from './zip'

/**
 * What an import reads from: the files of a zip (a Notion export, a zipped vault, a sel export)
 * or of a folder (an Obsidian vault), each with a clean relative path and read only when asked
 * for, up to a size. Paths never reach the file system as names to write: an import only reads.
 */

export interface SourceFile {
  /** Relative, `/` between folders, no `.` or `..` segments, no leading slash. */
  path: string
  size: number
  read(max: number): Promise<Buffer>
}

export interface ImportSource {
  /** The zip's or folder's own name, for the preview. */
  name: string
  files: SourceFile[]
  close(): Promise<void>
}

/** More files than this and the import is refused rather than planned. */
export const MAX_SOURCE_FILES = 200_000
/** A zip inside the zip (Notion splits large exports into parts) is read into memory up to this. */
const MAX_INNER_ZIP_BYTES = 1024 * 1024 * 1024
/** Folders deeper than this are not walked. */
const MAX_DEPTH = 64

/** Folders and files no import wants: an app's own settings, the system's leftovers. */
function ignored(segment: string): boolean {
  return segment.startsWith('.') || segment === '__MACOSX' || segment === 'Thumbs.db' || segment === 'desktop.ini'
}

/** The clean relative path of an archive name, or null when it must be skipped (escapes the root, hidden, empty). */
export function cleanPath(name: string): string | null {
  const segments = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.')
  if (!segments.length || segments.some((s) => s === '..' || ignored(s) || /[\u0000-\u001f]/.test(s))) return null
  return segments.join('/')
}

/** When every file sits in one folder and nothing at the top, that folder is only a wrapper: its name goes. */
function unwrap(files: SourceFile[]): SourceFile[] {
  if (!files.length) return files
  const first = files[0].path.split('/')[0]
  if (!files.every((f) => f.path.includes('/') && f.path.split('/')[0] === first)) return files
  return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }))
}

function filesOf(archive: ZipArchive, prefix = ''): SourceFile[] {
  const out: SourceFile[] = []
  for (const entry of archive.entries) {
    if (entry.isDirectory) continue
    const path = cleanPath(prefix + entry.name)
    if (path) out.push({ path, size: entry.size, read: (max) => archive.read(entry, max) })
  }
  return out
}

export async function zipSource(path: string): Promise<ImportSource> {
  const archive = await openZip(await fileAccess(path))
  const opened: ZipArchive[] = [archive]
  try {
    let files = filesOf(archive)
    // Notion's large exports: a zip of zips ("…-Part-1.zip"). Each part is opened in turn.
    if (files.length && files.every((f) => /\.zip$/i.test(f.path))) {
      const inner: SourceFile[] = []
      for (const part of files) {
        const bytes = await part.read(MAX_INNER_ZIP_BYTES)
        const zip = await openZip(bufferAccess(bytes))
        opened.push(zip)
        inner.push(...filesOf(zip))
      }
      files = inner
    }
    if (files.length > MAX_SOURCE_FILES) throw new ZipError('The zip file has too many files')
    return {
      name: basename(path),
      files: unwrap(files),
      close: async () => {
        for (const zip of opened) await zip.close().catch(() => undefined)
      }
    }
  } catch (err) {
    for (const zip of opened) await zip.close().catch(() => undefined)
    throw err
  }
}

/** A folder, walked without following links; hidden folders (`.obsidian`, `.trash`, `.git`) are left out. */
export async function folderSource(root: string): Promise<ImportSource> {
  const files: SourceFile[] = []
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return
    const items = await readdir(dir, { withFileTypes: true })
    for (const item of items) {
      if (ignored(item.name)) continue
      const full = join(dir, item.name)
      const path = rel ? `${rel}/${item.name}` : item.name
      if (item.isDirectory()) await walk(full, path, depth + 1)
      else if (item.isFile()) {
        if (files.length >= MAX_SOURCE_FILES) throw new Error('The folder has too many files to import')
        const { size } = await lstat(full)
        files.push({
          path,
          size,
          read: async (max) => {
            const info = await lstat(full)
            if (!info.isFile() || info.size > max) throw new Error('A file is too large to import')
            return readFile(full)
          }
        })
      }
    }
  }
  await walk(root, '', 0)
  return { name: basename(root), files, close: async () => undefined }
}

/** For tests: files from memory. */
export function memorySource(name: string, entries: Record<string, string | Uint8Array>): ImportSource {
  const files: SourceFile[] = []
  for (const [raw, content] of Object.entries(entries)) {
    const path = cleanPath(raw)
    if (!path) continue
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
    files.push({
      path,
      size: bytes.length,
      read: async (max) => {
        if (bytes.length > max) throw new Error('A file is too large to import')
        return bytes
      }
    })
  }
  return { name, files, close: async () => undefined }
}
