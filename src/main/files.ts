import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { app, dialog, protocol, type BrowserWindow } from 'electron'
import { FILE_PROTOCOL } from '../shared/api'
import { readFileCapped } from './fsutil'
import { RECORDINGS_HOST } from '../shared/meetings'
import { serveRecording } from './meetings/serve'

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024
/**
 * The only file types the app stores and serves, with the content type each is
 * served as. Raster formats only: SVG can carry script and is deliberately absent.
 */
const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp'
} as const
export type ImageExtension = keyof typeof IMAGE_TYPES
export const IMAGE_EXTENSIONS = Object.keys(IMAGE_TYPES) as ImageExtension[]

/** `<generated name>.<allowed extension>`: no separators, no dots-only names, nothing executable. */
const FILE_NAME_RE = new RegExp(`^[A-Za-z0-9_-]{1,80}\\.(${IMAGE_EXTENSIONS.join('|')})$`)
const HOST = 'files'
const TOO_LARGE = `The image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`

export function filesDir(): string {
  return join(app.getPath('userData'), 'files')
}

/** Identifies an image by its magic bytes; null when it is not an accepted format. */
export function sniffImage(bytes: Uint8Array): ImageExtension | null {
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && ascii(1, 8) === 'PNG\r\n\x1a\n') return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (ascii(4, 8) === 'ftyp' && /^(avif|avis)$/.test(ascii(8, 12))) return 'avif'
  // "BM" alone is two bytes of evidence; the reserved header fields must be zero as well.
  if (ascii(0, 2) === 'BM' && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0) return 'bmp'
  return null
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('Image data must be an ArrayBuffer')
}

/** Validates image bytes and writes them under a generated name. Returns the `sel-file://` url. */
export async function storeImage(bytes: Uint8Array, dir: string = filesDir()): Promise<string> {
  if (bytes.byteLength === 0) throw new Error('The image is empty')
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(TOO_LARGE)
  const kind = sniffImage(bytes)
  if (!kind) throw new Error('Unsupported image format')
  await mkdir(dir, { recursive: true })
  // The name is generated here and the extension comes from the content:
  // nothing from the caller reaches the file system path.
  const name = `${randomUUID()}.${kind}`
  await writeFile(join(dir, name), bytes, { flag: 'wx' })
  return `${FILE_PROTOCOL}://${HOST}/${name}`
}

export async function saveImage(data: unknown, extension: unknown): Promise<string> {
  const ext = typeof extension === 'string' && extension.length <= 16 ? extension.toLowerCase().replace(/^\./, '') : ''
  if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) throw new Error('Unsupported image extension')
  return storeImage(toBytes(data))
}

export async function pickImage(win: BrowserWindow | null): Promise<string | null> {
  const options = {
    title: 'Choose an image',
    properties: ['openFile' as const],
    filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const file = result.filePaths[0]
  if (result.canceled || !file) return null
  return storeImage(await readFileCapped(file, MAX_IMAGE_BYTES, TOO_LARGE))
}

/**
 * Writes a picture the renderer generated (a chart copied as an image) to a file the
 * user chooses. The renderer never names a path: the save dialog does, and the bytes
 * were checked to be a PNG before they got here (`validate.pngBytes`).
 */
export async function saveGeneratedImage(win: BrowserWindow | null, png: Uint8Array): Promise<{ saved: boolean; path?: string }> {
  const options = {
    title: 'Save image',
    defaultPath: 'chart.png',
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false }
  // Whatever was typed in the dialog, what is written is a PNG and is named like one.
  const named = /\.png$/i.test(result.filePath)
  const path = named ? result.filePath : `${result.filePath}.png`
  // The dialog only confirmed replacing the path it returned: a name completed here must be new.
  await writeFile(path, png, named ? {} : { flag: 'wx' })
  return { saved: true, path }
}

/** Maps a `sel-file://files/<name>` url to a path inside the files dir, or null. */
export function resolveFileUrl(url: string, dir = filesDir()): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${FILE_PROTOCOL}:` || parsed.hostname !== HOST) return null
  if (parsed.username || parsed.password || parsed.port) return null
  let name: string
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  } catch {
    return null
  }
  // A flat directory of generated names: anything with a separator, a dots-only
  // segment or an extension the app never writes is rejected outright.
  if (!FILE_NAME_RE.test(name)) return null
  const base = resolve(dir)
  const full = resolve(base, name)
  if (!full.startsWith(base + sep)) return null
  return full
}

function contentType(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1) as ImageExtension
  return IMAGE_TYPES[ext] ?? 'application/octet-stream'
}

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // Should a response ever be opened as a document, it can do nothing.
  'Content-Security-Policy': "default-src 'none'; sandbox"
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: code, headers: { ...BASE_HEADERS, ...headers } })
}

/**
 * Answers one `sel-file:` request: GET only, a single stored image, never a
 * directory listing, never a path outside `dir` (also not through a symlink).
 */
export async function serveFile(request: { method: string; url: string }, dir: string = filesDir()): Promise<Response> {
  if (request.method !== 'GET') return status(405, { Allow: 'GET' })
  const file = resolveFileUrl(request.url, dir)
  if (!file) return status(404)
  try {
    // lstat: a symlink is not a regular file, so links planted in the directory are refused.
    const info = await lstat(file)
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return status(404)
    // And the directory itself must not be redirected somewhere else underneath us.
    const [realFile, realDir] = await Promise.all([realpath(file), realpath(dir)])
    if (!realFile.startsWith(realDir + sep)) return status(404)
    const body = await readFile(file)
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': contentType(file),
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'private, max-age=31536000, immutable'
      }
    })
  } catch {
    return status(404)
  }
}

/** Must run before `app` is ready. */
export function registerFileScheme(): void {
  // `standard` + `secure` is all an <img>/background needs; `stream` lets an <audio> element
  // play (and seek in) a recording. No fetch, no CORS, no service workers: the scheme serves
  // stored images and the audio of meetings, and nothing else.
  protocol.registerSchemesAsPrivileged([{ scheme: FILE_PROTOCOL, privileges: { standard: true, secure: true, stream: true } }])
}

/** Must run after `app` is ready. */
export function handleFileProtocol(): void {
  protocol.handle(FILE_PROTOCOL, (request) => {
    // Two routes, told apart by the host: `files` (images) and `recordings` (the audio of meetings).
    let host = ''
    try {
      host = new URL(request.url).hostname
    } catch {
      /* not an address: the image route answers 404 */
    }
    return host === RECORDINGS_HOST ? serveRecording(request, join(app.getPath('userData'), 'recordings')) : serveFile(request)
  })
}
