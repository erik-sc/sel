import { lstat, open, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { FILE_PROTOCOL } from '../../shared/api'
import { RECORDINGS_HOST, type MeetingStream } from '../../shared/meetings'
import { isValidId } from '../db/blocks'

/**
 * Playback of a recording: `selida-file://recordings/<meeting id>/<mic|system>.<webm|wav>`.
 * A route of its own beside the images (../files.ts), just as narrow: GET only, exactly the
 * four file names a recording has, inside the folder of one meeting whose name is a valid
 * block id, never through a symbolic link, served as audio and as nothing else. Byte ranges
 * are answered so that a player can seek. Free of Electron imports (unit-tested).
 */

export const AUDIO_TYPES = { webm: 'audio/webm', wav: 'audio/wav' } as const
export type AudioFormat = keyof typeof AUDIO_TYPES

const NAME_RE = /^(mic|system)\.(webm|wav)$/
/** One answer never carries more than this; a player asks again for what follows. */
const MAX_RANGE_BYTES = 4 * 1024 * 1024

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'no-store'
}

export function recordingUrl(pageId: string, stream: MeetingStream, format: AudioFormat): string {
  return `${FILE_PROTOCOL}://${RECORDINGS_HOST}/${pageId}/${stream}.${format}`
}

/** Maps a recording url to a path inside `dir`, or null. */
export function resolveRecordingUrl(url: string, dir: string): { file: string; folder: string; format: AudioFormat } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${FILE_PROTOCOL}:` || parsed.hostname !== RECORDINGS_HOST) return null
  if (parsed.username || parsed.password || parsed.port || parsed.search) return null
  // Compared as written: an encoded character anywhere is simply not one of the names.
  const parts = parsed.pathname.split('/')
  if (parts.length !== 3 || parts[0] !== '') return null
  const [, id, name] = parts
  const match = NAME_RE.exec(name)
  if (!isValidId(id) || !match) return null
  const base = resolve(dir)
  const folder = resolve(base, id)
  const file = resolve(folder, name)
  if (!folder.startsWith(base + sep) || !file.startsWith(folder + sep)) return null
  return { file, folder, format: match[2] as AudioFormat }
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: code, headers: { ...BASE_HEADERS, ...headers } })
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes; null when it cannot be satisfied. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | undefined {
  if (!header) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  let start: number
  let end: number
  if (match[1] === '') {
    const tail = Number(match[2])
    if (tail === 0) return null
    start = Math.max(0, size - tail)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null
  return { start, end }
}

export async function serveRecording(request: { method: string; url: string; headers?: { get(name: string): string | null } }, dir: string): Promise<Response> {
  if (request.method !== 'GET') return status(405, { Allow: 'GET' })
  const target = resolveRecordingUrl(request.url, dir)
  if (!target) return status(404)
  try {
    // lstat: a link planted in the folder is not a regular file. And neither the folder nor
    // the recordings directory may lead somewhere else underneath us.
    const info = await lstat(target.file)
    if (!info.isFile()) return status(404)
    const [realFile, realDir] = await Promise.all([realpath(target.file), realpath(dir)])
    if (realFile !== join(realDir, target.file.slice(resolve(dir).length + 1))) return status(404)
    const size = info.size
    const range = parseRange(request.headers?.get('range') ?? null, size)
    if (range === null || size === 0) return status(416, { 'Content-Range': `bytes */${size}` })
    const start = range?.start ?? 0
    const end = Math.min(range?.end ?? size - 1, start + MAX_RANGE_BYTES - 1)
    const length = end - start + 1
    const handle = await open(target.file, 'r')
    try {
      const body = Buffer.alloc(length)
      const { bytesRead } = await handle.read(body, 0, length, start)
      const whole = !range && bytesRead === size
      return new Response(new Uint8Array(body.buffer, body.byteOffset, bytesRead), {
        status: whole ? 200 : 206,
        headers: {
          ...BASE_HEADERS,
          'Content-Type': AUDIO_TYPES[target.format],
          'Content-Length': String(bytesRead),
          ...(whole ? {} : { 'Content-Range': `bytes ${start}-${start + bytesRead - 1}/${size}` })
        }
      })
    } finally {
      await handle.close()
    }
  } catch {
    return status(404)
  }
}
