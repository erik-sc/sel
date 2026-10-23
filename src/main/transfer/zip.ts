import { open, rename, rm, type FileHandle } from 'node:fs/promises'
import { promisify } from 'node:util'
import { deflateRaw, inflateRaw } from 'node:zlib'

/**
 * A small zip reader and writer on node:zlib, enough for exports from Notion (and from sel
 * itself) and for writing sel's own: stored and deflated entries, UTF-8 names, the central
 * directory, and Zip64 when reading. No encryption, no spanning. Entries are read on demand
 * (a large export is never held in memory whole), and every read is capped, so a zip bomb
 * stops at the cap instead of filling the memory.
 */

const inflate = promisify(inflateRaw)
const deflate = promisify(deflateRaw)

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50
const SIG_END64 = 0x06064b50
const SIG_END64_LOCATOR = 0x07064b50
/** The end record is 22 bytes plus a comment of at most 65535. */
const END_SEARCH = 22 + 0xffff
/** More entries than this and the archive is refused rather than listed. */
export const MAX_ZIP_ENTRIES = 200_000
const FLAG_ENCRYPTED = 0x1
const FLAG_UTF8 = 0x800

// ------------------------------------------------------------------- crc32

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return ~crc >>> 0
}

// ------------------------------------------------------------------- reading

/** Where the bytes of an archive are: a file read piece by piece, or a buffer already in memory. */
export interface RandomAccess {
  size: number
  read(position: number, length: number): Promise<Buffer>
  close(): Promise<void>
}

export async function fileAccess(path: string): Promise<RandomAccess> {
  const handle: FileHandle = await open(path, 'r')
  const { size } = await handle.stat()
  return {
    size,
    async read(position, length) {
      const buffer = Buffer.alloc(length)
      let done = 0
      while (done < length) {
        const { bytesRead } = await handle.read(buffer, done, length - done, position + done)
        if (bytesRead === 0) throw new ZipError('The zip file ends too soon')
        done += bytesRead
      }
      return buffer
    },
    close: () => handle.close()
  }
}

export function bufferAccess(buffer: Buffer): RandomAccess {
  return {
    size: buffer.length,
    async read(position, length) {
      if (position < 0 || position + length > buffer.length) throw new ZipError('The zip file ends too soon')
      return buffer.subarray(position, position + length)
    },
    close: async () => undefined
  }
}

/** A problem with the archive itself: its message is safe to show. */
export class ZipError extends Error {}

export interface ZipEntry {
  /** The path inside the archive, with `/` between folders, as written (not yet checked). */
  name: string
  isDirectory: boolean
  /** Bytes once extracted. */
  size: number
  compressedSize: number
  method: number
  crc: number
  flags: number
  localOffset: number
}

export interface ZipArchive {
  entries: ZipEntry[]
  /** The bytes of one entry, refused when larger than `max` once extracted. */
  read(entry: ZipEntry, max: number): Promise<Buffer>
  close(): Promise<void>
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** Names are UTF-8 when the flag says so; otherwise UTF-8 if they decode as such (most tools), else Latin-1. */
function decodeName(bytes: Buffer, flags: number): string {
  if (flags & FLAG_UTF8) return bytes.toString('utf8')
  try {
    return utf8.decode(bytes)
  } catch {
    return bytes.toString('latin1')
  }
}

/** The extra fields of a central record: Zip64 sizes and offset, and Info-ZIP's Unicode path. */
function readExtra(extra: Buffer, entry: ZipEntry, raw: { size: number; compressed: number; offset: number }): string | null {
  let unicodeName: string | null = null
  for (let at = 0; at + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(at)
    const length = extra.readUInt16LE(at + 2)
    const body = extra.subarray(at + 4, at + 4 + length)
    if (id === 0x0001) {
      let p = 0
      const next = (): number => {
        if (p + 8 > body.length) throw new ZipError('The zip file is damaged')
        const value = Number(body.readBigUInt64LE(p))
        p += 8
        return value
      }
      if (raw.size === 0xffffffff) entry.size = next()
      if (raw.compressed === 0xffffffff) entry.compressedSize = next()
      if (raw.offset === 0xffffffff) entry.localOffset = next()
    } else if (id === 0x7075 && body.length > 5 && body[0] === 1) {
      try {
        unicodeName = utf8.decode(body.subarray(5))
      } catch {
        /* a broken Unicode path: the plain name stays */
      }
    }
    at += 4 + length
  }
  return unicodeName
}

export async function openZip(access: RandomAccess): Promise<ZipArchive> {
  if (access.size < 22) throw new ZipError('This is not a zip file')
  const tailLength = Math.min(access.size, END_SEARCH)
  const tail = await access.read(access.size - tailLength, tailLength)
  let end = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_END) {
      end = i
      break
    }
  }
  if (end < 0) throw new ZipError('This is not a zip file')
  let count = tail.readUInt16LE(end + 10)
  let directorySize = tail.readUInt32LE(end + 12)
  let directoryOffset = tail.readUInt32LE(end + 16)
  // Zip64: a locator just before the end record points at the larger one.
  const endAt = access.size - tailLength + end
  if (endAt >= 20) {
    const locator = await access.read(endAt - 20, 20)
    if (locator.readUInt32LE(0) === SIG_END64_LOCATOR) {
      const at = Number(locator.readBigUInt64LE(8))
      const end64 = await access.read(at, 56)
      if (end64.readUInt32LE(0) !== SIG_END64) throw new ZipError('The zip file is damaged')
      count = Number(end64.readBigUInt64LE(32))
      directorySize = Number(end64.readBigUInt64LE(40))
      directoryOffset = Number(end64.readBigUInt64LE(48))
    }
  }
  if (count > MAX_ZIP_ENTRIES) throw new ZipError('The zip file has too many files')
  if (directoryOffset + directorySize > access.size) throw new ZipError('The zip file is damaged')
  const directory = await access.read(directoryOffset, directorySize)

  const entries: ZipEntry[] = []
  let at = 0
  for (let n = 0; n < count; n++) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== SIG_CENTRAL) throw new ZipError('The zip file is damaged')
    const flags = directory.readUInt16LE(at + 8)
    const method = directory.readUInt16LE(at + 10)
    const crc = directory.readUInt32LE(at + 16)
    const compressed = directory.readUInt32LE(at + 20)
    const size = directory.readUInt32LE(at + 24)
    const nameLength = directory.readUInt16LE(at + 28)
    const extraLength = directory.readUInt16LE(at + 30)
    const commentLength = directory.readUInt16LE(at + 32)
    const offset = directory.readUInt32LE(at + 42)
    const nameBytes = directory.subarray(at + 46, at + 46 + nameLength)
    const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength)
    const entry: ZipEntry = {
      name: decodeName(nameBytes, flags),
      isDirectory: false,
      size,
      compressedSize: compressed,
      method,
      crc,
      flags,
      localOffset: offset
    }
    const unicodeName = readExtra(extra, entry, { size, compressed, offset })
    if (unicodeName) entry.name = unicodeName
    entry.name = entry.name.replace(/\\/g, '/')
    entry.isDirectory = entry.name.endsWith('/')
    entries.push(entry)
    at += 46 + nameLength + extraLength + commentLength
  }

  return {
    entries,
    async read(entry, max) {
      if (entry.isDirectory) return Buffer.alloc(0)
      if (entry.flags & FLAG_ENCRYPTED) throw new ZipError('The zip file is protected by a password')
      if (entry.size > max) throw new ZipError('A file in the zip is too large')
      const local = await access.read(entry.localOffset, 30)
      if (local.readUInt32LE(0) !== SIG_LOCAL) throw new ZipError('The zip file is damaged')
      const start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      if (start + entry.compressedSize > access.size) throw new ZipError('The zip file is damaged')
      const data = await access.read(start, entry.compressedSize)
      let out: Buffer
      if (entry.method === 0) out = Buffer.from(data)
      else if (entry.method === 8) {
        try {
          out = await inflate(data, { maxOutputLength: Math.max(1, max) })
        } catch {
          throw new ZipError('A file in the zip is damaged or too large')
        }
      } else throw new ZipError('The zip file uses a compression sel cannot read')
      if (out.length !== entry.size || crc32(out) !== entry.crc) throw new ZipError('A file in the zip is damaged')
      return out
    },
    close: () => access.close()
  }
}

// ------------------------------------------------------------------- writing

/** DOS date and time, as zip headers keep them (local time, two-second steps). */
function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

interface Written {
  name: Buffer
  crc: number
  size: number
  compressedSize: number
  method: number
  offset: number
}

/**
 * Writes a zip file entry by entry. The file is written under a temporary name next to
 * `path` and renamed into place by `close`, so a failed export leaves no half-written zip.
 * Without Zip64: 65535 entries and 4 GB at most, which `add` refuses beyond.
 */
export class ZipWriter {
  private readonly written: Written[] = []
  private offset = 0
  private readonly stamp = dosTime(new Date())

  private constructor(
    private readonly handle: FileHandle,
    private readonly partial: string,
    private readonly path: string
  ) {}

  static async create(path: string): Promise<ZipWriter> {
    const partial = `${path}.partial`
    const handle = await open(partial, 'w')
    return new ZipWriter(handle, partial, path)
  }

  /** Adds a file. Already compressed formats (images) are better stored: `compress: false`. */
  async add(name: string, content: string | Uint8Array, { compress = true }: { compress?: boolean } = {}): Promise<void> {
    const data =
      typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content.buffer, content.byteOffset, content.byteLength)
    if (this.written.length >= 0xffff) throw new ZipError('Too many files for one zip')
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    let body: Buffer = data
    let method = 0
    if (compress && data.length > 64) {
      const packed = await deflate(data)
      if (packed.length < data.length) {
        body = packed
        method = 8
      }
    }
    if (this.offset + 30 + nameBytes.length + body.length > 0xfffffffe) throw new ZipError('The export is too large for one zip')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(SIG_LOCAL, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(FLAG_UTF8, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(this.stamp.time, 10)
    header.writeUInt16LE(this.stamp.day, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(body.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    header.writeUInt16LE(0, 28)
    await this.handle.write(Buffer.concat([header, nameBytes]))
    await this.handle.write(body)
    this.written.push({ name: nameBytes, crc, size: data.length, compressedSize: body.length, method, offset: this.offset })
    this.offset += 30 + nameBytes.length + body.length
  }

  /** Writes the central directory and puts the file in place. */
  async close(): Promise<void> {
    try {
      const records: Buffer[] = []
      let size = 0
      for (const entry of this.written) {
        const record = Buffer.alloc(46)
        record.writeUInt32LE(SIG_CENTRAL, 0)
        record.writeUInt16LE(20, 4)
        record.writeUInt16LE(20, 6)
        record.writeUInt16LE(FLAG_UTF8, 8)
        record.writeUInt16LE(entry.method, 10)
        record.writeUInt16LE(this.stamp.time, 12)
        record.writeUInt16LE(this.stamp.day, 14)
        record.writeUInt32LE(entry.crc, 16)
        record.writeUInt32LE(entry.compressedSize, 20)
        record.writeUInt32LE(entry.size, 24)
        record.writeUInt16LE(entry.name.length, 28)
        record.writeUInt32LE(entry.offset, 42)
        records.push(record, entry.name)
        size += 46 + entry.name.length
      }
      const end = Buffer.alloc(22)
      end.writeUInt32LE(SIG_END, 0)
      end.writeUInt16LE(this.written.length, 8)
      end.writeUInt16LE(this.written.length, 10)
      end.writeUInt32LE(size, 12)
      end.writeUInt32LE(this.offset, 16)
      await this.handle.write(Buffer.concat([...records, end]))
      await this.handle.close()
      await rename(this.partial, this.path)
    } catch (err) {
      await this.abort()
      throw err
    }
  }

  /** Drops what was written. */
  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined)
    await rm(this.partial, { force: true }).catch(() => undefined)
  }
}
