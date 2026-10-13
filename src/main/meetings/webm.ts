import { createReadStream, createWriteStream } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

/**
 * The compact copy of a recording is WebM/Opus written by the browser's own recorder, a few
 * seconds at a time. A file made that way does not say how long it is (the recorder cannot
 * know while it runs), and a player cannot show its length or seek in it. When the recording
 * stops, `patchWebmDuration` adds the one missing field. Free of Electron imports (unit-tested).
 *
 * Layout written by the recorder: EBML header, then a Segment of unknown size whose first
 * children are Info (timestamp scale, the application's name) and Tracks, then the clusters.
 * The patch appends a Duration to Info and rewrites Info's size; everything after it is copied.
 */

const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_SCALE = 0x2ad7b1
const ID_DURATION = 0x4489

interface Element {
  id: number
  /** Where the id starts, where the content starts, and the content's length (null: unknown). */
  at: number
  data: number
  size: number | null
}

function readElement(bytes: Buffer, at: number): Element | null {
  if (at >= bytes.length) return null
  const first = bytes[at]
  let idLength = 1
  while (idLength <= 4 && !(first & (0x80 >> (idLength - 1)))) idLength++
  if (idLength > 4 || at + idLength >= bytes.length) return null
  const id = bytes.readUIntBE(at, idLength)
  const sizeAt = at + idLength
  const head = bytes[sizeAt]
  let sizeLength = 1
  while (sizeLength <= 8 && !(head & (0x80 >> (sizeLength - 1)))) sizeLength++
  if (sizeLength > 8 || sizeAt + sizeLength > bytes.length) return null
  let size = head & (0xff >> sizeLength)
  let unknown = size === 0xff >> sizeLength
  for (let i = 1; i < sizeLength; i++) {
    const byte = bytes[sizeAt + i]
    if (byte !== 0xff) unknown = false
    size = size * 256 + byte
  }
  return { id, at, data: sizeAt + sizeLength, size: unknown ? null : size }
}

/**
 * The bytes that replace the start of the file up to the end of Info, or null when the file
 * is not laid out as expected (it is then left as it is). `head` is the first part of the file.
 */
export function patchedHead(head: Buffer, seconds: number): { replace: number; bytes: Buffer } | null {
  const ebml = readElement(head, 0)
  if (!ebml || ebml.id !== 0x1a45dfa3 || ebml.size === null) return null
  const segment = readElement(head, ebml.data + ebml.size)
  // Only a Segment of unknown size can grow without rewriting sizes further out.
  if (!segment || segment.id !== ID_SEGMENT || segment.size !== null) return null
  let at = segment.data
  for (let guard = 0; guard < 16; guard++) {
    const element = readElement(head, at)
    if (!element || element.size === null) return null
    const end = element.data + element.size
    if (end > head.length) return null
    if (element.id !== ID_INFO) {
      at = end
      continue
    }
    let scale = 1_000_000
    for (let inner = element.data; inner < end; ) {
      const child = readElement(head, inner)
      if (!child || child.size === null) return null
      if (child.id === ID_DURATION) return null // already there
      if (child.id === ID_SCALE && child.size > 0 && child.size <= 6) scale = head.readUIntBE(child.data, child.size)
      inner = child.data + child.size
    }
    const duration = Buffer.alloc(11)
    duration.writeUInt16BE(ID_DURATION, 0)
    duration[2] = 0x88 // an 8-byte float
    duration.writeDoubleBE((seconds * 1e9) / scale, 3)
    const content = Buffer.concat([head.subarray(element.data, end), duration])
    const size = Buffer.alloc(8)
    size.writeBigUInt64BE(BigInt(content.length))
    size[0] = 0x01 // an 8-byte size
    const id = Buffer.from([0x15, 0x49, 0xa9, 0x66])
    return { replace: end, bytes: Buffer.concat([head.subarray(0, element.at), id, size, content]) }
  }
  return null
}

const HEAD_BYTES = 64 * 1024

/** Writes the length into a recorder's WebM file. Returns false when the file was left alone. */
export async function patchWebmDuration(file: string, seconds: number): Promise<boolean> {
  if (!(seconds > 0)) return false
  let patch: { replace: number; bytes: Buffer } | null
  const handle = await open(file, 'r')
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0)
    patch = patchedHead(head.subarray(0, bytesRead), seconds)
  } finally {
    await handle.close()
  }
  if (!patch) return false
  const temp = `${file}.tmp`
  try {
    const out = createWriteStream(temp)
    out.write(patch.bytes)
    await pipeline(createReadStream(file, { start: patch.replace }), out)
    await rename(temp, file)
    return true
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined)
    console.error('[meetings] the length could not be written into the audio file', err)
    return false
  }
}
