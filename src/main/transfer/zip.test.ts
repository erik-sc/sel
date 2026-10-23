/**
 * The zip reader and writer: what one writes the other reads, names in UTF-8, stored and
 * deflated entries, the caps, damage, and a zip made by another tool (Windows' own).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { bufferAccess, crc32, fileAccess, openZip, ZipError, ZipWriter } from './zip'
import { cleanPath, zipSource } from './source'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-zip-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

async function written(entries: [string, string | Uint8Array, boolean?][]): Promise<string> {
  const path = join(ROOT, `${Math.random().toString(36).slice(2)}.zip`)
  const writer = await ZipWriter.create(path)
  for (const [name, content, compress] of entries) await writer.add(name, content, { compress: compress ?? true })
  await writer.close()
  return path
}

describe('crc32', () => {
  it('is the standard one', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('a zip written and read back', () => {
  it('keeps names, folders and contents, compressed or stored', async () => {
    const long = 'Lorem ipsum dolor sit amet. '.repeat(200)
    const path = await written([
      ['Notas/Café ☕.md', '# Café\n'],
      ['Notas/long.md', long],
      ['files/a.png', new Uint8Array([1, 2, 3, 4]), false]
    ])
    const zip = await openZip(await fileAccess(path))
    try {
      expect(zip.entries.map((e) => e.name)).toEqual(['Notas/Café ☕.md', 'Notas/long.md', 'files/a.png'])
      const [cafe, longEntry, png] = zip.entries
      expect((await zip.read(cafe, 1000)).toString('utf8')).toBe('# Café\n')
      expect(longEntry.method).toBe(8)
      expect(longEntry.compressedSize).toBeLessThan(long.length)
      expect((await zip.read(longEntry, 1_000_000)).toString('utf8')).toBe(long)
      expect(png.method).toBe(0)
      expect([...(await zip.read(png, 10))]).toEqual([1, 2, 3, 4])
    } finally {
      await zip.close()
    }
  })

  it('refuses an entry larger than asked for, before and while inflating', async () => {
    const path = await written([['big.md', 'x'.repeat(10_000)]])
    const zip = await openZip(await fileAccess(path))
    try {
      await expect(zip.read(zip.entries[0], 100)).rejects.toThrow(ZipError)
      // A header that lies about the size is caught by the inflater's own cap.
      await expect(zip.read({ ...zip.entries[0], size: 50 }, 100)).rejects.toThrow(ZipError)
    } finally {
      await zip.close()
    }
  })

  it('says when a file is not a zip, or is damaged', async () => {
    await expect(openZip(bufferAccess(Buffer.from('not a zip at all, just some text here')))).rejects.toThrow('not a zip')
    const path = await written([['a.md', 'hello hello hello hello hello hello hello hello hello hello hello hello hello']])
    const bytes = readFileSync(path)
    // Flip a byte of the compressed data: the checksum no longer matches.
    bytes[40] ^= 0xff
    const zip = await openZip(bufferAccess(bytes))
    await expect(zip.read(zip.entries[0], 1000)).rejects.toThrow(ZipError)
  })

  it('leaves no file behind when the export is abandoned', async () => {
    const path = join(ROOT, 'abandoned.zip')
    const writer = await ZipWriter.create(path)
    await writer.add('a.md', 'a')
    await writer.abort()
    expect(() => readFileSync(path)).toThrow()
    expect(() => readFileSync(`${path}.partial`)).toThrow()
  })
})

describe('a zip made by Windows (Compress-Archive)', () => {
  it('is read, with its backslashes turned into folders', async () => {
    const source = await zipSource(join(__dirname, 'fixtures', 'windows-compress-archive.zip'))
    try {
      const paths = source.files.map((f) => f.path).sort()
      expect(paths).toEqual(['Notes.md', 'Notes/Sub page.md', 'Ünïcode.md'])
      const notes = source.files.find((f) => f.path === 'Notes.md')
      expect((await notes!.read(1000)).toString('utf8')).toContain('[Sub page](Notes/Sub%20page.md)')
    } finally {
      await source.close()
    }
  })
})

describe('paths inside an archive', () => {
  it('are cleaned, and those that leave it or are hidden are skipped', () => {
    expect(cleanPath('a\\b/./c.md')).toBe('a/b/c.md')
    expect(cleanPath('/a/b.md')).toBe('a/b.md')
    expect(cleanPath('../evil.md')).toBeNull()
    expect(cleanPath('a/../../evil.md')).toBeNull()
    expect(cleanPath('.obsidian/app.json')).toBeNull()
    expect(cleanPath('__MACOSX/a.md')).toBeNull()
  })

  it('lose the one folder everything is wrapped in, and parts of a split export are opened', async () => {
    const inner = await written([['Page.md', '# Page\n']])
    const outer = await written([['Export-1-Part-1.zip', readFileSync(inner), false]])
    const source = await zipSource(outer)
    expect(source.files.map((f) => f.path)).toEqual(['Page.md'])
    await source.close()

    const wrapped = await written([
      ['Vault/A.md', 'a'],
      ['Vault/B/C.md', 'c']
    ])
    const vault = await zipSource(wrapped)
    expect(vault.files.map((f) => f.path)).toEqual(['A.md', 'B/C.md'])
    await vault.close()
    writeFileSync(join(ROOT, 'empty.zip'), Buffer.alloc(0))
    await expect(zipSource(join(ROOT, 'empty.zip'))).rejects.toThrow(ZipError)
  })
})
