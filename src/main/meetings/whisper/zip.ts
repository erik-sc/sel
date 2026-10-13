import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'

/**
 * A reader for the one archive sel unpacks: the whisper.cpp release, after its digest was
 * verified. Written here rather than handed to `Expand-Archive` or `tar` because unpacking is
 * exactly where an archive attacks: this reads the directory first, refuses the whole archive
 * for a single entry that is not a plain relative file, and then writes only the few entries
 * it was asked for, under names it chose itself, with every size checked against a cap before
 * and after inflating. No shell, no other program, and the same behaviour on every Windows.
 *
 * Supported: stored and deflated entries, as every ordinary zip has. Refused: encryption,
 * multi-disk and zip64 archives, symbolic links, absolute or climbing paths.
 * Free of Electron imports (unit-tested).
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(`The archive could not be unpacked: ${message}`)
    this.name = 'ZipError'
  }
}

export const ZIP_LIMITS = {
  archiveBytes: 128 * 1024 * 1024,
  entries: 4096,
  /** Everything that is extracted, inflated, in total. */
  extractedBytes: 512 * 1024 * 1024,
  /** Inflated size over packed size of one entry: beyond it, it is a bomb. */
  ratio: 200
} as const

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  crc: number
  /** Where the entry's local header starts. */
  offset: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** True for a name that stays inside the directory it is unpacked into. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 512 || name.includes('\0')) return false
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) return false
  if (name.includes('\\')) return false
  return !name.split('/').some((part) => part === '..' || part === '.')
}

/** The entries of an archive, every one of them checked. Throws a `ZipError` for anything unusual. */
export function readZipDirectory(archive: Buffer): ZipEntry[] {
  if (archive.length > ZIP_LIMITS.archiveBytes) throw new ZipError('it is too large')
  // The end record is the last 22 bytes, or sits before a comment of up to 64 KiB.
  let end = -1
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 0xffff); at--) {
    if (archive.readUInt32LE(at) === EOCD) {
      end = at
      break
    }
  }
  if (end < 0) throw new ZipError('it is not a zip file')
  if (archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0) throw new ZipError('it spans several disks')
  const count = archive.readUInt16LE(end + 10)
  const directorySize = archive.readUInt32LE(end + 12)
  const directoryAt = archive.readUInt32LE(end + 16)
  if (count === 0xffff || directoryAt === 0xffffffff || directorySize === 0xffffffff) throw new ZipError('zip64 archives are not supported')
  if (count !== archive.readUInt16LE(end + 8) || count > ZIP_LIMITS.entries) throw new ZipError('it has too many entries')
  if (directoryAt + directorySize > end) throw new ZipError('its directory is damaged')

  const entries: ZipEntry[] = []
  let at = directoryAt
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || archive.readUInt32LE(at) !== CENTRAL) throw new ZipError('its directory is damaged')
    const madeBy = archive.readUInt16LE(at + 4)
    const flags = archive.readUInt16LE(at + 8)
    const method = archive.readUInt16LE(at + 10)
    const crc = archive.readUInt32LE(at + 16)
    const compressedSize = archive.readUInt32LE(at + 20)
    const size = archive.readUInt32LE(at + 24)
    const nameLength = archive.readUInt16LE(at + 28)
    const extraLength = archive.readUInt16LE(at + 30)
    const commentLength = archive.readUInt16LE(at + 32)
    const external = archive.readUInt32LE(at + 38)
    const offset = archive.readUInt32LE(at + 42)
    if (at + 46 + nameLength > end) throw new ZipError('its directory is damaged')
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extraLength + commentLength

    if (flags & 0x1) throw new ZipError('it is encrypted')
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError('zip64 archives are not supported')
    if (!isSafeEntryName(name)) throw new ZipError('it has an entry that points outside the folder')
    // Made on a Unix system: the high half of the attributes is the file mode. 0o12 is a symbolic link.
    if (madeBy >> 8 === 3 && ((external >>> 16) & 0o170000) === 0o120000) throw new ZipError('it contains a symbolic link')
    const directory = name.endsWith('/')
    if (!directory && method !== 0 && method !== 8) throw new ZipError('it uses a compression sel does not read')
    if (!directory) entries.push({ name, method, compressedSize, size, crc, offset })
  }
  return entries
}

/** The bytes of one entry: inflated within its declared size and checked against its CRC. */
export function readZipEntry(archive: Buffer, entry: ZipEntry): Buffer {
  const at = entry.offset
  if (at + 30 > archive.length || archive.readUInt32LE(at) !== LOCAL) throw new ZipError('an entry is damaged')
  const start = at + 30 + archive.readUInt16LE(at + 26) + archive.readUInt16LE(at + 28)
  if (start + entry.compressedSize > archive.length) throw new ZipError('an entry is damaged')
  if (entry.method === 0 ? entry.size !== entry.compressedSize : entry.size > Math.max(1, entry.compressedSize) * ZIP_LIMITS.ratio) {
    throw new ZipError('an entry unpacks to far more than it should')
  }
  const packed = archive.subarray(start, start + entry.compressedSize)
  let data: Buffer
  if (entry.method === 0) data = Buffer.from(packed)
  else {
    try {
      // One byte of room beyond the declared size: more than declared is an error, not a truncation.
      data = inflateRawSync(packed, { maxOutputLength: entry.size + 1 })
    } catch {
      throw new ZipError('an entry unpacks to far more than it should')
    }
  }
  if (data.length !== entry.size) throw new ZipError('an entry is not the size it says')
  if (crc32(data) >>> 0 !== entry.crc >>> 0) throw new ZipError('an entry is damaged')
  return data
}

/**
 * Unpacks the entries `pick` gives a name to, flat into `dir` (created), each as a new file.
 * `pick` returns a bare file name; whatever path the entry had in the archive is not used.
 * Returns the names written.
 */
export async function extractZip(archive: Buffer, dir: string, pick: (entry: ZipEntry) => string | null): Promise<string[]> {
  const entries = readZipDirectory(archive)
  const wanted: { entry: ZipEntry; name: string }[] = []
  let total = 0
  for (const entry of entries) {
    const name = pick(entry)
    if (name === null) continue
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,120}$/.test(name) || wanted.some((other) => other.name.toLowerCase() === name.toLowerCase())) {
      throw new ZipError('it has two files of the same name')
    }
    total += entry.size
    if (total > ZIP_LIMITS.extractedBytes) throw new ZipError('it unpacks to far more than it should')
    wanted.push({ entry, name })
  }
  await mkdir(dir, { recursive: true })
  const written: string[] = []
  for (const { entry, name } of wanted) {
    await writeFile(join(dir, name), readZipEntry(archive, entry), { flag: 'wx', mode: 0o755 })
    written.push(name)
  }
  return written
}
